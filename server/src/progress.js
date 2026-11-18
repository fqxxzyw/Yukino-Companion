import {all, first, loginDayCount, run} from './db.js';
import {authenticate} from './session.js';
import {entitlementPayload, signSnapshot} from './entitlement.js';
import {ApiError, fail, json} from './util.js';
import {
  businessDate,
  clampAffection,
  eligibleSkins,
  EVENT_TYPES,
  MAX_EVENTS_PER_REQUEST,
  PROGRESS_RULES,
  skinCatalog,
} from '../../shared/progress-rules.mjs';

function progressMessage(type) {
  if (type === 'message') return '对话互动已确认';
  if (type === 'pet-interaction') return '桌宠互动已确认';
  if (type === 'manual-voice') return '语音互动已确认';
  return '互动已确认';
}

async function progressRow(db, userId, now) {
  let row = await first(db, 'SELECT * FROM user_progress WHERE user_id = ?', userId);
  if (!row) {
    await run(
      db,
      'INSERT INTO user_progress(user_id, affection, version, rules_version, updated_at) VALUES(?,?,?,?,?)',
      userId, PROGRESS_RULES.affection.initial, 1, PROGRESS_RULES.version, now,
    );
    row = {user_id: userId, affection: PROGRESS_RULES.affection.initial, version: 1, rules_version: PROGRESS_RULES.version};
  }
  return row;
}

async function addEligibleSkins(db, userId, affection, loginDays, now) {
  const ids = eligibleSkins({affection, loginDays});
  if (!ids.length) return;
  await db.batch(ids.map((skinId) => db.prepare(
    `INSERT INTO skin_unlocks(user_id, skin_id, reason, rules_version, unlocked_at)
     VALUES(?,?,?,?,?) ON CONFLICT(user_id, skin_id) DO NOTHING`,
  ).bind(userId, skinId, 'server-confirmed', PROGRESS_RULES.version, now)));
}

export async function readProgress(db, userId, now = Date.now()) {
  const row = await progressRow(db, userId, now);
  const loginDays = await loginDayCount(db, userId);
  const today = businessDate(now);
  const todayRow = await first(db, 'SELECT 1 AS ok FROM login_days WHERE user_id = ? AND business_date = ?', userId, today);
  const unlocks = await all(db, 'SELECT skin_id, reason, rules_version, unlocked_at FROM skin_unlocks WHERE user_id = ?', userId);
  const unlockedIds = unlocks.map((item) => item.skin_id);
  return {
    affection: clampAffection(Number(row.affection)),
    loginDays,
    businessDate: today,
    checkedInToday: Boolean(todayRow),
    rulesVersion: PROGRESS_RULES.version,
    skins: skinCatalog({affection: Number(row.affection), loginDays, unlocked: unlockedIds}),
    unlocks: unlocks.map((item) => ({
      id: item.skin_id, reason: item.reason, rulesVersion: item.rules_version, unlockedAt: Number(item.unlocked_at),
    })),
    updatedAt: Number(row.updated_at || now),
  };
}

export async function progressResponse(db, userId, env, now = Date.now()) {
  const progress = await readProgress(db, userId, now);
  let entitlement = null;
  try {
    entitlement = await signSnapshot(entitlementPayload({
      userId,
      affection: progress.affection,
      loginDays: progress.loginDays,
      skins: progress.skins.filter((skin) => skin.unlocked).map((skin) => skin.id),
      now,
      rulesVersion: progress.rulesVersion,
    }), env);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // Missing signing config must not block account use; the client treats
    // "no snapshot" as unconfirmed cloud skins, not as zero progress.
    entitlement = null;
  }
  return {...progress, entitlement};
}

export async function getProgress({request, env, db, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  return json(await progressResponse(db, user.id, env, now));
}

async function applyLedgerForDay(db, {userId, eventId, eventType, amount, today, now, dailyCap}) {
  // Batch statements run as one D1 transaction. The ledger insert is guarded by
  // both the per-event type cap and the global daily affection cap. A duplicate
  // event_id changes nothing and does not retry.
  const results = await db.batch([
    db.prepare(
      `INSERT INTO reward_ledger(user_id, event_id, event_type, amount, business_date, applied, created_at)
       SELECT ?,?,?,?,?,0,? WHERE
         (SELECT COUNT(*) FROM reward_ledger WHERE user_id = ? AND business_date = ? AND event_type = ?) < ?
         AND (SELECT COALESCE(SUM(amount),0) FROM reward_ledger WHERE user_id = ? AND business_date = ?) + ? <= ?
       ON CONFLICT(user_id, event_id, event_type) DO NOTHING
       RETURNING id`,
    ).bind(userId, eventId, eventType, amount, today, now,
      userId, today, eventType, dailyCap,
      userId, today, amount, PROGRESS_RULES.globalDailyAffectionCap),
    db.prepare(
      `UPDATE user_progress
       SET affection = MIN(?, MAX(?, affection + COALESCE((SELECT amount FROM reward_ledger WHERE user_id = ? AND event_id = ? AND event_type = ? AND applied = 0), 0))),
           updated_at = ?
       WHERE user_id = ?`,
    ).bind(PROGRESS_RULES.affection.max, PROGRESS_RULES.affection.min, userId, eventId, eventType, now, userId),
    db.prepare('UPDATE reward_ledger SET applied = 1 WHERE user_id = ? AND event_id = ? AND event_type = ? AND applied = 0')
      .bind(userId, eventId, eventType),
  ]);
  const inserted = Array.isArray(results?.[0]?.results) && results[0].results.length > 0;
  return inserted;
}

export async function checkIn({request, env, db, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const today = businessDate(now);
  const already = await first(db, 'SELECT 1 AS ok FROM login_days WHERE user_id = ? AND business_date = ?', user.id, today);
  const insert = await run(
    db,
    'INSERT INTO login_days(user_id, business_date, created_at) VALUES(?,?,?) ON CONFLICT(user_id, business_date) DO NOTHING',
    user.id, today, now,
  );
  const counted = insert.changes === 1 && !already;
  // Always attempt the ledger insert: a previous crash between login_days and
  // reward_ledger can be repaired, while the unique keys prevent a second award.
  await applyLedgerForDay(db, {
    userId: user.id,
    eventId: `checkin:${today}`,
    eventType: 'checkin',
    amount: PROGRESS_RULES.dailyCheckIn.affection,
    today,
    now,
    dailyCap: 1,
  });
  const loginDays = await loginDayCount(db, user.id);
  const row = await progressRow(db, user.id, now);
  await addEligibleSkins(db, user.id, Number(row.affection), loginDays, now);
  return json({ok: true, counted, date: today, ...await progressResponse(db, user.id, env, now)});
}

export async function submitEvents({request, env, db, body, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS_PER_REQUEST) {
    fail(400, 'invalid_events', '互动事件数量不正确。');
  }
  const today = businessDate(now);
  const outcomes = [];
  for (const raw of body.events) {
    const eventId = raw && typeof raw.eventId === 'string' ? raw.eventId : '';
    const type = raw && typeof raw.type === 'string' ? raw.type : '';
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(eventId) || !EVENT_TYPES.includes(type)) {
      outcomes.push({eventId, status: 'rejected', reason: 'invalid_event'});
      continue;
    }
    const duplicate = await first(db, 'SELECT accepted, reason FROM progress_events WHERE user_id = ? AND event_id = ?', user.id, eventId);
    if (duplicate) {
      outcomes.push({eventId, status: 'duplicate', accepted: Boolean(duplicate.accepted), reason: duplicate.reason || 'duplicate'});
      continue;
    }
    const rule = PROGRESS_RULES.events[type];
    const inserted = await run(
      db,
      `INSERT INTO progress_events(user_id, event_id, event_type, business_date, accepted, reason, created_at)
       VALUES(?,?,?,?,0,'',?) ON CONFLICT(user_id, event_id) DO NOTHING`,
      user.id, eventId, type, today, now,
    );
    if (inserted.changes !== 1) {
      outcomes.push({eventId, status: 'duplicate'});
      continue;
    }
    const awarded = await applyLedgerForDay(db, {
      userId: user.id,
      eventId,
      eventType: type,
      amount: rule.affection,
      today,
      now,
      dailyCap: rule.dailyCap,
    });
    if (awarded) {
      await run(db, 'UPDATE progress_events SET accepted = 1, reason = ? WHERE user_id = ? AND event_id = ?', 'accepted', user.id, eventId);
      outcomes.push({eventId, status: 'accepted', type, affection: rule.affection, message: progressMessage(type)});
    } else {
      await run(db, 'UPDATE progress_events SET accepted = 0, reason = ? WHERE user_id = ? AND event_id = ?', 'daily-cap', user.id, eventId);
      outcomes.push({eventId, status: 'capped', type, message: '今天这条互动奖励已达上限，已确认的进度不会减少。'});
    }
  }
  const loginDays = await loginDayCount(db, user.id);
  const row = await progressRow(db, user.id, now);
  await addEligibleSkins(db, user.id, Number(row.affection), loginDays, now);
  return json({ok: true, outcomes, ...await progressResponse(db, user.id, env, now)});
}

export async function skins({request, env, db, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const progress = await readProgress(db, user.id, now);
  return json({
    rulesVersion: progress.rulesVersion,
    skins: progress.skins,
    entitlement: (await progressResponse(db, user.id, env, now)).entitlement,
  });
}

export {progressRow, addEligibleSkins};
