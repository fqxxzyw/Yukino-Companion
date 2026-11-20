'use strict';
// Desktop account lifecycle. The account server is optional: local profiles are
// always readable, and none of the network failures below delete local data.
const path = require('node:path');
const fs = require('node:fs/promises');
const {createHash, randomUUID, webcrypto} = require('node:crypto');
const {writeAtomicJson} = require('./atomic-json.cjs');
const {AccountClient, AccountError, DEFAULT_BASE, LOOPBACK} = require('./account-client.cjs');
const {canonicalOutfitIds} = require('./skin-policy.cjs');

const EVENT_TYPES = new Set(['message', 'pet-interaction', 'manual-voice']);
const MAX_QUEUE = 40;
const HEARTBEAT_MS = 5 * 60 * 1000;
const ACCESS_SKEW_MS = 60 * 1000;
const CLOUD_SKIN_LIMIT = 40;

function hashId(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function localDate(now = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function decodeBase64url(value) {
  return Uint8Array.from(Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function accountError(error) {
  if (error instanceof AccountError) return error;
  return new AccountError('账号操作没有完成，请稍后再试。', {code: 'account_error'});
}

function publicSnapshotProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.emailMasked || '',
    emailHint: profile.emailHint || '',
    nickname: profile.nickname || '',
    createdAt: Number(profile.createdAt || 0),
    remember: profile.remember !== false,
  };
}

class AccountStore {
  constructor({userData, safeStorage, client, apiBase = '', emit = () => {}, now = Date.now, fs: files = fs, path: paths = path}) {
    this.userData = userData;
    this.safeStorage = safeStorage;
    this.client = client;
    this.initialBase = apiBase;
    this.emit = emit;
    this.now = now;
    this.fs = files;
    this.path = paths;
    this.accountDir = paths.join(userData, 'account');
    this.metaFile = paths.join(this.accountDir, 'account.json');
    this.credentialsFile = paths.join(this.accountDir, 'credentials.json');
    this.queueDir = paths.join(this.accountDir, 'queue');
    this.configFile = paths.join(this.accountDir, 'config.json');
    this.backupDir = paths.join(this.accountDir, 'backups');
    this.profileRoot = paths.join(userData, 'profiles');
    this.meta = null;
    this.credentials = {version: 1, users: {}};
    this.memoryRefresh = new Map();
    this.access = new Map();
    this.refreshPromise = null;
    this.progressPromise = null;
    this.syncPromise = null;
    this.syncTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatBusy = null;
    this.retryDelay = 30 * 1000;
    this.heartbeatScheduled = 0;
    this.credentialsUnavailable = false;
    this.disposed = false;
    this.writeQueue = Promise.resolve();
    this.lastError = '';
    this.entitlementKey = null;
    this.status = 'guest';
    this.reachable = null;
    this.profileRevision = 0;
  }

  get activeProfile() { return this.meta?.activeProfile || 'guest'; }

  get activeAccount() {
    const id = this.activeProfile;
    return id === 'guest' ? null : this.meta?.profiles?.[id] || null;
  }

  profileDir(userId) {
    return this.path.join(this.profileRoot, hashId(userId));
  }

  // The only per-profile file. Guest keeps the existing userData/state.json in
  // place so upgrading never moves or rewrites the old profile.
  stateLocation(name, fallback) {
    if (name !== 'state.json' || this.activeProfile === 'guest') return fallback;
    return this.path.join(this.profileDir(this.activeProfile), 'state.json');
  }

  queueFile(userId = this.activeProfile) {
    return this.path.join(this.queueDir, `${hashId(userId)}.json`);
  }

  async readJson(file, fallback) {
    let raw;
    try { raw = await this.fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    try { return JSON.parse(raw); }
    catch {
      const corrupt = `${file}.corrupt-${this.now()}`;
      try { await this.fs.rename(file, corrupt); } catch { /* keep original if rename fails */ }
      return fallback;
    }
  }

  async writeJson(file, value) {
    if (this.disposed) return;
    const encoded = JSON.stringify(value);
    const job = this.writeQueue.then(() => writeAtomicJson(this.fs, file, encoded));
    this.writeQueue = job.catch(() => {});
    return job;
  }

  async exists(file) {
    try { await this.fs.access(file); return true; } catch { return false; }
  }

  async initialize() {
    await this.fs.mkdir(this.accountDir, {recursive: true});
    await this.fs.mkdir(this.queueDir, {recursive: true});
    await this.fs.mkdir(this.backupDir, {recursive: true});
    const legacy = await this.exists(this.path.join(this.userData, 'state.json'));
    const saved = await this.readJson(this.metaFile, null);
    this.meta = saved && typeof saved === 'object' ? saved : {
      version: 1,
      onboardingComplete: legacy,
      activeProfile: 'guest',
      profiles: {},
      backups: {},
      createdAt: this.now(),
    };
    this.meta.profiles = this.meta.profiles && typeof this.meta.profiles === 'object' ? this.meta.profiles : {};
    this.meta.backups = this.meta.backups && typeof this.meta.backups === 'object' ? this.meta.backups : {};
    if (legacy && !this.meta.backups.legacyState) {
      // One-time safety copy before any account feature writes local state.
      const source = this.path.join(this.userData, 'state.json');
      const target = this.path.join(this.backupDir, `state-guest-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.json`);
      try {
        await this.fs.copyFile(source, target);
        this.meta.backups.legacyState = this.path.basename(target);
      } catch { /* the original file remains untouched */ }
    }
    if (legacy) this.meta.onboardingComplete = true;
    const requested = this.meta.activeProfile;
    if (requested !== 'guest' && !Object.hasOwn(this.meta.profiles, requested)) this.meta.activeProfile = 'guest';
    this.credentials = await this.readJson(this.credentialsFile, {version: 1, users: {}});
    this.credentials.users = this.credentials.users && typeof this.credentials.users === 'object' ? this.credentials.users : {};
    const config = await this.readJson(this.configFile, {});
    const base = process.env.YUKINO_API_BASE || config.apiBase || this.meta.apiBase || this.initialBase || DEFAULT_BASE;
    try { this.client.setBase(base); } catch (error) { this.lastError = error.message; }
    if (this.activeProfile !== 'guest') {
      const token = await this.loadRefreshToken(this.activeProfile);
      this.status = token ? 'authenticated-offline' : 'reauth-required';
      this.reachable = null;
    } else {
      this.status = 'guest';
    }
    await this.writeJson(this.metaFile, this.meta);
    return this.snapshot();
  }

  setApiBase(value) {
    const base = this.client.setBase(value);
    this.meta.apiBase = base;
    return this.writeJson(this.metaFile, this.meta).then(() => base);
  }

  async loadRefreshToken(userId) {
    if (this.memoryRefresh.has(userId)) return this.memoryRefresh.get(userId);
    const record = this.credentials.users[userId];
    if (!record?.ciphertext) return '';
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      this.credentialsUnavailable = true;
      return '';
    }
    try {
      const token = this.safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'));
      this.memoryRefresh.set(userId, token);
      return token;
    } catch {
      this.credentialsUnavailable = true;
      return '';
    }
  }

  async saveRefreshToken(userId, token, remember) {
    if (!token) return;
    this.memoryRefresh.set(userId, token);
    this.meta.profiles[userId].remember = remember !== false;
    if (remember === false) {
      delete this.credentials.users[userId];
      await this.writeJson(this.credentialsFile, this.credentials);
      return;
    }
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      this.credentialsUnavailable = true;
      delete this.credentials.users[userId];
      await this.writeJson(this.credentialsFile, this.credentials);
      return;
    }
    this.credentials.users[userId] = {
      ciphertext: this.safeStorage.encryptString(token).toString('base64'),
      remember: true,
      savedAt: this.now(),
    };
    await this.writeJson(this.credentialsFile, this.credentials);
  }

  async clearRefreshToken(userId) {
    this.memoryRefresh.delete(userId);
    this.access.delete(userId);
    if (Object.hasOwn(this.credentials.users, userId)) {
      delete this.credentials.users[userId];
      await this.writeJson(this.credentialsFile, this.credentials);
    }
  }

  accessFor(userId = this.activeProfile) {
    const value = this.access.get(userId);
    if (!value || !value.token) return '';
    if (value.expiresAt && value.expiresAt <= this.now() + ACCESS_SKEW_MS) return '';
    return value.token;
  }

  saveAccess(userId, token, expiresIn = 900) {
    if (!token) return;
    this.access.set(userId, {token, expiresAt: this.now() + Math.max(60, Number(expiresIn) || 900) * 1000});
  }

  pendingCount(userId = this.activeProfile) {
    if (userId === 'guest') return 0;
    return this.meta?.profiles?.[userId]?.pendingCount || 0;
  }

  snapshot() {
    const profile = this.activeAccount;
    const pending = this.pendingCount();
    return {
      version: 1,
      onboardingComplete: Boolean(this.meta?.onboardingComplete),
      profileId: this.activeProfile,
      mode: this.activeProfile === 'guest' ? 'guest' : 'account',
      status: this.status,
      reachable: this.reachable,
      sync: this.activeProfile === 'guest' ? 'local' : pending > 0 ? (this.status === 'authenticated-online' ? 'pending' : 'waiting') : 'synced',
      pendingCount: pending,
      credentialsUnavailable: this.credentialsUnavailable,
      apiBase: this.client.baseUrl,
      profile: publicSnapshotProfile(profile),
      progress: profile?.progress || null,
      cloudSkins: [...canonicalOutfitIds(profile?.cloudSkins)].slice(0, CLOUD_SKIN_LIMIT),
      entitlementUnverified: Boolean(profile?.entitlementUnverified),
      lastSyncAt: Number(profile?.lastSyncAt || 0),
      lastError: this.lastError,
      profileRevision: this.profileRevision,
      checkedInToday: Boolean(profile?.progress?.checkedInToday),
    };
  }

  emitState() { this.emit('account-state', this.snapshot()); }
  emitProfile() {
    this.profileRevision += 1;
    this.emit('account-profile', {profileId: this.activeProfile, revision: this.profileRevision});
    this.emitState();
  }

  async completeOnboarding() {
    this.meta.onboardingComplete = true;
    this.meta.activeProfile = 'guest';
    this.status = 'guest';
    await this.writeJson(this.metaFile, this.meta);
    this.emitProfile();
    return this.snapshot();
  }

  async switchProfile(profileId) {
    if (profileId !== 'guest' && !Object.hasOwn(this.meta.profiles, profileId)) throw new AccountError('未找到该账号的本地档案。', {code: 'profile_not_found'});
    this.meta.activeProfile = profileId;
    this.status = profileId === 'guest' ? 'guest' : (await this.loadRefreshToken(profileId)) ? 'authenticated-offline' : 'reauth-required';
    this.reachable = profileId === 'guest' ? null : null;
    await this.writeJson(this.metaFile, this.meta);
    this.emitProfile();
    if (profileId !== 'guest') void this.heartbeat().catch(() => {});
    return this.snapshot();
  }

  async switchGuest() {
    return this.switchProfile('guest');
  }

  async applySession(data, {remember = true} = {}) {
    const user = data.user || {};
    const userId = String(user.id || '');
    if (!/^[0-9a-f-]{20,}$/i.test(userId)) throw new AccountError('账号服务返回了无效的用户信息。', {code: 'invalid_user'});
    const existing = this.meta.profiles[userId] || {};
    this.meta.profiles[userId] = {
      ...existing,
      id: userId,
      emailMasked: user.email || existing.emailMasked || '',
      emailHint: user.emailHint || user.email || existing.emailHint || '',
      nickname: user.nickname || existing.nickname || '',
      createdAt: Number(user.createdAt || existing.createdAt || this.now()),
      remember: remember !== false,
      pendingCount: Number(existing.pendingCount || 0),
      progress: existing.progress || null,
      cloudSkins: Array.isArray(existing.cloudSkins) ? existing.cloudSkins : [],
      lastSyncAt: Number(existing.lastSyncAt || 0),
    };
    this.meta.activeProfile = userId;
    this.meta.onboardingComplete = true;
    this.status = 'authenticated-online';
    this.reachable = true;
    this.lastError = '';
    this.saveAccess(userId, data.accessToken, data.expiresIn);
    await this.saveRefreshToken(userId, data.refreshToken, remember !== false);
    this.emitProfile();
  }

  async login({email, password, remember = true} = {}) {
    const data = await this.client.request('/api/v1/auth/login', {method: 'POST', body: {email, password, remember: remember !== false, client: 'desktop'}});
    await this.applySession(data, {remember});
    await this.writeJson(this.metaFile, this.meta);
    await this.refreshProgress().catch((error) => this.noteSoftFailure(error));
    this.scheduleSync();
    return this.snapshot();
  }

  async registerRequest({email} = {}) {
    return this.client.request('/api/v1/auth/register/request-code', {method: 'POST', body: {email, client: 'desktop'}});
  }

  async register({email, nickname, code, challengeId, password} = {}) {
    const data = await this.client.request('/api/v1/auth/register', {
      method: 'POST', body: {email, nickname, code, challengeId, password, client: 'desktop'},
    });
    await this.applySession(data, {remember: true});
    await this.writeJson(this.metaFile, this.meta);
    await this.refreshProgress().catch((error) => this.noteSoftFailure(error));
    this.scheduleSync();
    return this.snapshot();
  }

  async forgotRequest({email} = {}) {
    return this.client.request('/api/v1/auth/password/forgot', {method: 'POST', body: {email, client: 'desktop'}});
  }

  async forgotVerify({email, code, challengeId} = {}) {
    return this.client.request('/api/v1/auth/password/verify-reset', {method: 'POST', body: {email, code, challengeId, client: 'desktop'}});
  }

  async resetPassword({resetToken, newPassword} = {}) {
    await this.client.request('/api/v1/auth/password/reset', {method: 'POST', body: {resetToken, newPassword, client: 'desktop'}});
    return {ok: true, loginRequired: true};
  }

  async ensureAccess({force = false} = {}) {
    const userId = this.activeProfile;
    if (userId === 'guest') throw new AccountError('当前是游客档案。', {code: 'guest_profile'});
    if (!force) {
      const token = this.accessFor(userId);
      if (token) return token;
    }
    return this.refreshAccess();
  }

  async refreshAccess() {
    if (this.refreshPromise) return this.refreshPromise;
    const userId = this.activeProfile;
    if (userId === 'guest') throw new AccountError('当前是游客档案。', {code: 'guest_profile'});
    const refreshToken = await this.loadRefreshToken(userId);
    if (!refreshToken) {
      this.status = 'reauth-required';
      this.reachable = null;
      this.lastError = '需要重新登录账号。本地档案仍可继续使用。';
      this.emitState();
      throw new AccountError(this.lastError, {code: 'reauth_required'});
    }
    this.refreshPromise = (async () => {
      try {
        const data = await this.client.request('/api/v1/auth/refresh', {
          method: 'POST', body: {refreshToken, remember: this.meta.profiles[userId]?.remember !== false, client: 'desktop'},
        });
        if (data.user?.id===userId && data.user.nickname) this.meta.profiles[userId].nickname=data.user.nickname;
        this.saveAccess(userId, data.accessToken, data.expiresIn);
        await this.saveRefreshToken(userId, data.refreshToken, this.meta.profiles[userId]?.remember !== false);
        this.status = 'authenticated-online';
        this.reachable = true;
        this.lastError = '';
        await this.writeJson(this.metaFile, this.meta);
        return data.accessToken;
      } catch (error) {
        const normalized = accountError(error);
        if ([401, 403].includes(normalized.status)) {
          // The server explicitly rejected the refresh token. Clear only the
          // unusable credential; profile state and downloaded data stay intact.
          await this.clearRefreshToken(userId);
          this.status = 'reauth-required';
          this.reachable = true;
          this.lastError = '账号会话已失效，请重新登录；本地功能仍可使用。';
        } else if (normalized.status === 409 && normalized.code === 'refresh_in_progress') {
          this.status = 'authenticated-online';
          this.reachable = true;
        } else {
          this.status = 'authenticated-offline';
          this.reachable = false;
          this.lastError = normalized.message;
        }
        this.emitState();
        throw normalized;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  noteSoftFailure(error) {
    this.lastError = accountError(error).message;
    if (this.status !== 'guest' && this.status !== 'reauth-required') this.status = 'authenticated-offline';
    this.emitState();
  }

  async requestWithAuth(path, {method = 'GET', body, retry = true} = {}) {
    const token = await this.ensureAccess();
    try {
      return await this.client.request(path, {method, body, token});
    } catch (error) {
      if (retry && error instanceof AccountError && error.status === 401) {
        const fresh = await this.refreshAccess();
        return this.client.request(path, {method, body, token: fresh});
      }
      throw error;
    }
  }

  async refreshProgress() {
    if (this.activeProfile === 'guest') return this.snapshot();
    if (this.progressPromise) return this.progressPromise;
    this.progressPromise = (async () => {
      const data = await this.requestWithAuth('/api/v1/progress');
      await this.applyProgress(data);
      this.status = 'authenticated-online';
      this.reachable = true;
      this.lastError = '';
      await this.writeJson(this.metaFile, this.meta);
      this.emitState();
      return this.snapshot();
    })().finally(() => { this.progressPromise = null; });
    return this.progressPromise;
  }

  async applyProgress(data) {
    const userId = this.activeProfile;
    const profile = this.meta.profiles[userId];
    if (!profile || !data) return;
    profile.progress = {
      affection: Number(data.affection) || 0,
      loginDays: Number(data.loginDays) || 0,
      checkedInToday: Boolean(data.checkedInToday),
      skins: Array.isArray(data.skins) ? data.skins : [],
      rulesVersion: data.rulesVersion || '',
      confirmedAt: this.now(),
    };
    // Never remove a previously server-confirmed outfit. New rules add
    // entitlements; they do not silently revoke permanent rights. The signed
    // snapshot is preferred, while an authenticated progress response is a
    // valid fallback when this build has no verification key configured.
    const confirmed = new Set(canonicalOutfitIds(profile.cloudSkins));
    let entitlementVerified = false;
    if (data.entitlement) {
      const verified = await this.verifyEntitlement(data.entitlement, userId);
      if (verified.ok) {
        entitlementVerified = true;
        for (const id of canonicalOutfitIds(verified.snapshot.skinIds)) confirmed.add(id);
        profile.entitlementVerifiedAt = this.now();
      }
    }
    if (!entitlementVerified) {
      for (const skin of Array.isArray(data.skins) ? data.skins : []) {
        if (skin?.unlocked === true) for (const id of canonicalOutfitIds([skin.id])) confirmed.add(id);
      }
    }
    profile.cloudSkins = [...confirmed].slice(0, CLOUD_SKIN_LIMIT);
    profile.entitlementUnverified = !entitlementVerified;
    profile.lastSyncAt = this.now();
    profile.lastSyncError = '';
    profile.pendingCount = await this.queueSize(userId);
  }

  async verifyEntitlement(envelope, userId) {
    if (!envelope || envelope.alg !== 'ES256' || !envelope.signature || !envelope.snapshot) return {ok: false, reason: 'missing'};
    const key = await this.getEntitlementKey();
    if (!key?.publicJwk) return {ok: false, reason: 'no-key'};
    if (key.keyId && envelope.keyId && key.keyId !== envelope.keyId) return {ok: false, reason: 'key-mismatch'};
    try {
      const imported = await webcrypto.subtle.importKey('jwk', key.publicJwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
      const bytes = new TextEncoder().encode(canonicalJson(envelope.snapshot));
      const ok = await webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, imported, decodeBase64url(envelope.signature), bytes);
      if (!ok) return {ok: false, reason: 'bad-signature'};
      if (envelope.snapshot.uid !== userId || envelope.snapshot.v !== 1) return {ok: false, reason: 'wrong-user'};
      return {ok: true, snapshot: envelope.snapshot};
    } catch {
      return {ok: false, reason: 'verify-error'};
    }
  }

  async getEntitlementKey() {
    if (this.entitlementKey) return this.entitlementKey;
    try {
      const file = this.path.join(__dirname, '..', 'shared', 'entitlement-public-key.json');
      const configured = await this.readJson(file, {});
      if (configured?.publicJwk && configured.publicJwk.x && configured.publicJwk.y) {
        this.entitlementKey = {keyId: configured.keyId || '', publicJwk: configured.publicJwk};
        return this.entitlementKey;
      }
      if (LOOPBACK.test(this.client.baseUrl)) {
        const response = await this.client.request('/api/v1/public/entitlement-key');
        if (response?.publicJwk?.x) this.entitlementKey = {keyId: response.keyId || '', publicJwk: response.publicJwk};
      }
    } catch { /* verified cloud skins remain optional */ }
    return this.entitlementKey;
  }

  async queueData(userId = this.activeProfile) {
    if (userId === 'guest') return {userId, events: []};
    const value = await this.readJson(this.queueFile(userId), {userId, events: []});
    const events = Array.isArray(value?.events) ? value.events.filter((event) => event && typeof event.eventId === 'string' && EVENT_TYPES.has(event.type)).slice(0, MAX_QUEUE) : [];
    return {userId, events};
  }

  async queueSize(userId = this.activeProfile) {
    return (await this.queueData(userId)).events.length;
  }

  async enqueueEvent(type) {
    if (this.activeProfile === 'guest' || !EVENT_TYPES.has(type)) return this.snapshot();
    const userId = this.activeProfile;
    const queue = await this.queueData(userId);
    const today = localDate(this.now());
    if (queue.events.some((event) => event.type === type && event.localDate === today)) return this.snapshot();
    if (queue.events.length >= MAX_QUEUE) queue.events.shift();
    queue.events.push({eventId: randomUUID(), type, localDate: today, createdAt: this.now()});
    await this.writeJson(this.queueFile(userId), queue);
    this.meta.profiles[userId].pendingCount = queue.events.length;
    await this.writeJson(this.metaFile, this.meta);
    this.emitState();
    this.scheduleSync();
    return this.snapshot();
  }

  scheduleSync() {
    if (this.syncTimer || this.activeProfile === 'guest') return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncPending().catch(() => {});
    }, 3000);
  }

  async syncPending() {
    if (this.syncPromise) return this.syncPromise;
    if (this.activeProfile === 'guest') return this.snapshot();
    this.syncPromise = (async () => {
      const userId = this.activeProfile;
      let queue = await this.queueData(userId);
      if (!queue.events.length) return this.snapshot();
      for (let batch = 0; batch < 4 && queue.events.length; batch += 1) {
        const chunk = queue.events.slice(0, 10);
        let data;
        try {
          data = await this.requestWithAuth('/api/v1/progress/events', {
            method: 'POST', body: {events: chunk.map(({eventId, type}) => ({eventId, type}))},
          });
        } catch (error) {
          const normalized = accountError(error);
          this.meta.profiles[userId].lastSyncError = normalized.message;
          await this.writeJson(this.metaFile, this.meta);
          this.emitState();
          throw normalized;
        }
        const settled = new Set((data.outcomes || []).map((outcome) => outcome.eventId));
        queue.events = queue.events.filter((event) => !settled.has(event.eventId));
        await this.writeJson(this.queueFile(userId), queue);
        await this.applyProgress(data);
        this.meta.profiles[userId].pendingCount = queue.events.length;
        this.meta.profiles[userId].lastSyncError = '';
        await this.writeJson(this.metaFile, this.meta);
      }
      this.emitState();
      return this.snapshot();
    })().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async checkIn() {
    if (this.activeProfile === 'guest') throw new AccountError('请先登录账号。', {code: 'guest_profile'});
    const data = await this.requestWithAuth('/api/v1/progress/check-in', {method: 'POST', body: {}});
    await this.applyProgress(data);
    this.meta.profiles[this.activeProfile].lastAutoCheckin = localDate(this.now());
    this.meta.profiles[this.activeProfile].lastCheckinAt = this.now();
    await this.writeJson(this.metaFile, this.meta);
    this.emitState();
    return this.snapshot();
  }

  async autoDailyCheckin() {
    const profile = this.activeAccount;
    if (!profile) return;
    const today = localDate(this.now());
    if (profile.lastAutoCheckin === today || profile.progress?.checkedInToday) return;
    try {
      await this.checkIn();
    } catch (error) {
      // No cloud backfill: the client never invents a past business date.
      this.noteSoftFailure(error);
    }
  }

  async heartbeat() {
    if (this.heartbeatBusy) return this.heartbeatBusy;
    if (this.activeProfile === 'guest') return this.snapshot();
    this.heartbeatBusy = (async () => {
      try {
        await this.ensureAccess();
        await this.refreshProgress();
        await this.syncPending().catch(() => {});
        await this.autoDailyCheckin();
        this.status = 'authenticated-online';
        this.reachable = true;
        this.emitState();
      } catch (error) {
        this.noteSoftFailure(error);
        throw error;
      } finally {
        this.heartbeatBusy = null;
      }
      return this.snapshot();
    })();
    return this.heartbeatBusy;
  }

  scheduleHeartbeat(delay) {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    const jitter = delay === HEARTBEAT_MS ? 0 : Math.round(delay * (Math.random() * 0.4 - 0.2));
    this.heartbeatTimer = setTimeout(async () => {
      this.heartbeatTimer = null;
      try {
        await this.heartbeat();
        this.retryDelay = 30 * 1000;
        this.scheduleHeartbeat(HEARTBEAT_MS);
      } catch {
        // heartbeat() normally swallows errors; keep the bounded backoff even
        // if a future change lets one escape.
        this.scheduleHeartbeat(this.nextRetryDelay());
      }
    }, Math.max(1000, delay + jitter));
    this.heartbeatTimer.unref?.();
  }

  nextRetryDelay() {
    const value = Math.min(5 * 60 * 1000, this.retryDelay) * (0.8 + Math.random() * 0.4);
    this.retryDelay = Math.min(5 * 60 * 1000, this.retryDelay * 2);
    return Math.round(value);
  }

  startHeartbeat() {
    if (this.heartbeatTimer || this.heartbeatScheduled) return;
    this.heartbeatScheduled = 1;
    this.scheduleHeartbeat(1500);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatScheduled = 0;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
  }

  async profileRequest(profileId, path, options = {}) {
    const check = token => {
      if (this.activeProfile !== profileId || profileId === 'guest' || this.accessFor(profileId) !== token) throw new AccountError('账号已切换，请重新打开设置。');
      return this.client.request(path, {...options, token});
    };
    try { return await check(await this.ensureAccess()); }
    catch (error) {
      if (error.status !== 401 || this.activeProfile !== profileId) throw error;
      return check(await this.refreshAccess());
    }
  }

  async updateNickname({profileId,nickname}) {
    const data=await this.profileRequest(profileId, '/api/v1/me', {method:'PATCH',body:{nickname}});
    if(data.user?.id!==profileId || !data.user.nickname) throw new AccountError('账号资料无效。');
    this.meta.profiles[profileId].nickname=data.user.nickname;
    await this.writeJson(this.metaFile,this.meta);
    this.emitState();
    return this.snapshot();
  }

  async memorySettings() {
    return this.requestWithAuth('/api/v1/memory/settings');
  }

  async setMemorySettings({syncMemory = false, syncChat = false} = {}) {
    return this.requestWithAuth('/api/v1/memory/settings', {
      method: 'PUT', body: {syncMemory: syncMemory === true, syncChat: syncChat === true},
    });
  }

  async cloudMemories() {
    return this.requestWithAuth('/api/v1/memory?limit=50');
  }

  async cloudMemory(characterId) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}`);
  }

  async saveCloudMemory({characterId, text, baseVersion = 0} = {}) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}`, {
      method: 'PUT', body: {text: String(text ?? ''), baseVersion: Number(baseVersion) || 0},
    });
  }

  async deleteCloudMemory(characterId) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}`, {method: 'DELETE', body: {}});
  }

  async cloudChat({characterId, conversationId = '', before = 0} = {}) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    const query = new URLSearchParams({limit: '30'});
    if (conversationId) query.set('conversationId', conversationId);
    if (before) query.set('before', String(before));
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}/chat?${query}`);
  }

  async pushCloudChat({characterId, conversationId, messages} = {}) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}/chat`, {
      method: 'POST', body: {conversationId, messages: Array.isArray(messages) ? messages : []},
    });
  }

  async deleteCloudChat({characterId, conversationId = ''} = {}) {
    if (typeof characterId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) throw new AccountError('角色编号无效。', {code: 'invalid_character'});
    return this.requestWithAuth(`/api/v1/memory/${encodeURIComponent(characterId)}/chat`, {
      method: 'DELETE', body: {conversationId},
    });
  }

  async sessions() {
    return this.requestWithAuth('/api/v1/sessions');
  }

  async revokeSession(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new AccountError('会话编号无效。', {code: 'invalid_session'});
    return this.requestWithAuth(`/api/v1/sessions/${id}`, {method: 'DELETE'});
  }

  async changePassword({currentPassword, newPassword} = {}) {
    const data = await this.requestWithAuth('/api/v1/auth/password/change', {
      method: 'POST', body: {currentPassword, newPassword, client: 'desktop'},
    });
    const userId = this.activeProfile;
    this.saveAccess(userId, data.accessToken, data.expiresIn);
    await this.saveRefreshToken(userId, data.refreshToken, this.meta.profiles[userId]?.remember !== false);
    this.status = 'authenticated-online';
    this.reachable = true;
    await this.refreshProgress().catch(() => {});
    this.emitState();
    return {...this.snapshot(), otherSessionsRevoked: data.otherSessionsRevoked === true};
  }

  async logoutRemote(path) {
    const token = await this.ensureAccess();
    return this.client.request(path, {method: 'POST', token});
  }

  async logout({all = false} = {}) {
    const userId = this.activeProfile;
    let remoteRevoked = false;
    let remoteError = '';
    if (userId !== 'guest') {
      try {
        await this.logoutRemote(all ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout');
        remoteRevoked = true;
      } catch (error) {
        // Offline logout still clears the local credential immediately. The UI
        // is told that the remote revocation is pending.
        remoteError = accountError(error).message;
      }
      await this.clearRefreshToken(userId);
    }
    this.meta.activeProfile = 'guest';
    this.meta.onboardingComplete = true;
    this.status = 'guest';
    this.reachable = null;
    this.lastError = '';
    await this.writeJson(this.metaFile, this.meta);
    this.emitProfile();
    return {...this.snapshot(), remoteRevoked, remoteError};
  }

  async listSessions() {
    return this.sessions();
  }

  dispose() {
    this.stopHeartbeat();
    this.disposed = true;
    return this.writeQueue.catch(() => {});
  }
}

function createAccountStore(options) {
  return new AccountStore(options);
}

module.exports = {AccountStore, createAccountStore, AccountError, localDate, hashId, canonicalJson};
