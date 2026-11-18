// Thin helpers over the D1 API. Every security counter lives in SQLite because
// Worker memory is per-isolate and is not a reliable rate-limit primitive.
export async function first(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

export async function all(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).all();
  return Array.isArray(result?.results) ? result.results : [];
}

export async function run(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).run();
  return {changes: Number(result?.meta?.changes || 0), result};
}

export async function consumeRate(db, key, {limit, windowMs, now = Date.now()}) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await first(
    db,
    `INSERT INTO rate_limits(key, window_start, count) VALUES(?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
    String(key).slice(0, 240),
    windowStart,
  );
  const count = Number(row?.count || 1);
  const resetAt = windowStart + windowMs;
  return {allowed: count <= limit, count, limit, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)), resetAt};
}

export async function audit(db, userId, kind, detail = '', now = Date.now()) {
  await run(
    db,
    'INSERT INTO audit_events(user_id, kind, detail, created_at) VALUES(?,?,?,?)',
    userId || null,
    String(kind).slice(0, 80),
    String(detail).slice(0, 300),
    now,
  );
}

export async function cacheGet(db, key, {allowStale = false, now = Date.now()} = {}) {
  const row = await first(db, 'SELECT value, updated_at FROM app_cache WHERE key = ?', key);
  if (!row) return null;
  if (!allowStale && Number(row.updated_at) + 15 * 60 * 1000 < now) return null;
  try { return {value: JSON.parse(row.value), updatedAt: Number(row.updated_at), stale: Number(row.updated_at) + 15 * 60 * 1000 < now}; }
  catch { return null; }
}

export async function cachePut(db, key, value, now = Date.now()) {
  await run(
    db,
    `INSERT INTO app_cache(key, value, updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    now,
  );
}

export async function loginDayCount(db, userId) {
  const row = await first(db, 'SELECT COUNT(*) AS total FROM login_days WHERE user_id = ?', userId);
  return Number(row?.total || 0);
}

export function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}
