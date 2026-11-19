'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {createAccountStore, AccountError, canonicalJson} = require('../electron/account-store.cjs');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^encrypted:/, ''),
  };
}

function session(userId, {email = 'user@example.com'} = {}) {
  return {
    user: {id: userId, email: 'us***@example.com', emailHint: email, createdAt: Date.now()},
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresIn: 900,
    persistent: true,
  };
}

function progressData({affection = 35, loginDays = 0, entitlement = null} = {}) {
  return {
    affection,
    loginDays,
    checkedInToday: false,
    rulesVersion: 'test',
    skins: [{id: 'yukino-07-v1', kind: 'base', target: 0, current: 0, eligible: true, unlocked: true}],
    entitlement,
  };
}

function fakeClient({loginData, refreshError, eventsResult, progress = progressData()} = {}) {
  return {
    baseUrl: 'http://127.0.0.1:8787',
    setBase(value) { this.baseUrl = value; return value; },
    calls: [],
    async request(route, options = {}) {
      this.calls.push({route, options});
      if (route === '/api/v1/auth/login') return loginData || session('11111111-1111-4111-8111-111111111111');
      if (route === '/api/v1/auth/refresh') {
        if (refreshError) throw refreshError;
        return {...session('11111111-1111-4111-8111-111111111111'), refreshToken: 'refresh-rotated'};
      }
      if (route === '/api/v1/progress') return progress;
      if (route === '/api/v1/progress/events') return {outcomes: (options.body?.events || []).map((event) => ({eventId: event.eventId, status: 'accepted'})), ...progress};
      if (route === '/api/v1/auth/logout' || route === '/api/v1/auth/logout-all') return {ok: true};
      if (route === '/api/v1/sessions') return {sessions: []};
      if (route === '/api/v1/public/entitlement-key') return {keyId: '', publicJwk: null};
      throw new Error(`unexpected route ${route}`);
    },
  };
}

async function tempStore(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-account-'));
  const store = createAccountStore({
    userData: dir,
    safeStorage: options.safeStorage || fakeSafeStorage(),
    client: options.client || fakeClient(),
    now: () => Date.now(),
  });
  await store.initialize();
  return {dir, store, async cleanup() { await store.dispose(); await fs.rm(dir, {recursive: true, force: true}); }};
}

test('legacy guest state stays at the legacy path, is backed up, and is never moved on login', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-account-legacy-'));
  const legacy = {version: 1, conversations: [{id: 'guest-chat'}], relationship: {affection: 42}};
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(legacy));
  const store = createAccountStore({userData: dir, safeStorage: fakeSafeStorage(), client: fakeClient()});
  try {
    const snapshot = await store.initialize();
    assert.equal(snapshot.onboardingComplete, true);
    assert.equal(snapshot.mode, 'guest');
    assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), JSON.stringify(legacy));
    const backups = await fs.readdir(path.join(dir, 'account', 'backups'));
    assert.equal(backups.length, 1);
    await store.login({email: 'user@example.com', password: 'correct horse battery staple'});
    assert.notEqual(store.stateLocation('state.json', path.join(dir, 'state.json')), path.join(dir, 'state.json'));
    assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), JSON.stringify(legacy), 'guest data must not be moved');
  } finally {
    await store.dispose();
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('guest and account state.json files are isolated and pending events never cross accounts', async () => {
  const client = fakeClient({loginData: session('11111111-1111-4111-8111-111111111111')});
  const {dir, store, cleanup} = await tempStore({client});
  try {
    const guestPath = path.join(dir, 'state.json');
    await fs.writeFile(guestPath, JSON.stringify({owner: 'guest'}));
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    const aPath = store.stateLocation('state.json', guestPath);
    assert.notEqual(aPath, guestPath);
    await fs.mkdir(path.dirname(aPath), {recursive: true});
    await fs.writeFile(aPath, JSON.stringify({owner: 'a'}));
    await store.enqueueEvent('message');
    await store.enqueueEvent('message');
    assert.equal(store.snapshot().pendingCount, 1, 'same type is deduped per local business day');

    await store.switchProfile('guest');
    assert.equal(store.stateLocation('state.json', guestPath), guestPath);
    assert.equal(JSON.parse(await fs.readFile(guestPath, 'utf8')).owner, 'guest');

    client.request = (async (route, options = {}) => {
      if (route === '/api/v1/auth/login') return session('22222222-2222-4222-8222-222222222222', {email: 'b@example.com'});
      if (route === '/api/v1/progress') return progressData();
      if (route === '/api/v1/progress/events') return {outcomes: []};
      return {ok: true};
    }).bind(client);
    await store.login({email: 'b@example.com', password: 'correct horse battery staple'});
    const bPath = store.stateLocation('state.json', guestPath);
    assert.notEqual(bPath, aPath);
    assert.equal(store.snapshot().pendingCount, 0);

    await store.switchProfile('11111111-1111-4111-8111-111111111111');
    assert.equal(store.snapshot().pendingCount, 1);
    assert.equal(JSON.parse(await fs.readFile(aPath, 'utf8')).owner, 'a');
    assert.equal(JSON.parse(await fs.readFile(guestPath, 'utf8')).owner, 'guest');
  } finally {
    await cleanup();
  }
});

test('network failure keeps local data and the refresh credential, marking the account offline', async () => {
  const client = fakeClient();
  const {dir, store, cleanup} = await tempStore({client});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    store.access.clear();
    client.request = async () => { throw new AccountError('connection refused', {code: 'network_error', network: true}); };
    await assert.rejects(() => store.ensureAccess({force: true}), /connection refused/);
    assert.equal(store.snapshot().status, 'authenticated-offline');
    assert.equal(store.memoryRefresh.has('11111111-1111-4111-8111-111111111111'), true, 'refresh token remains usable after reconnect');
    const credentials = JSON.parse(await fs.readFile(path.join(dir, 'account', 'credentials.json'), 'utf8'));
    assert.ok(credentials.users['11111111-1111-4111-8111-111111111111']?.ciphertext);
  } finally {
    await cleanup();
  }
});

test('explicit 401 clears only the unusable token, not the account profile or local state', async () => {
  const client = fakeClient();
  const {dir, store, cleanup} = await tempStore({client});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    const profilePath = store.stateLocation('state.json', path.join(dir, 'state.json'));
    await fs.mkdir(path.dirname(profilePath), {recursive: true});
    await fs.writeFile(profilePath, JSON.stringify({chat: 'keep me'}));
    store.access.clear();
    client.request = async () => { throw new AccountError('session revoked', {code: 'session_revoked', status: 401}); };
    await assert.rejects(() => store.ensureAccess({force: true}));
    assert.equal(store.snapshot().status, 'reauth-required');
    assert.equal(store.memoryRefresh.has('11111111-1111-4111-8111-111111111111'), false);
    assert.equal(JSON.parse(await fs.readFile(profilePath, 'utf8')).chat, 'keep me');
    assert.equal(await fs.readFile(path.join(dir, 'account', 'account.json'), 'utf8').then(Boolean), true);
  } finally {
    await cleanup();
  }
});

test('offline logout clears local credentials but preserves profile data; online logout reports remote revocation', async () => {
  const client = fakeClient();
  const {dir, store, cleanup} = await tempStore({client});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    const profilePath = store.stateLocation('state.json', path.join(dir, 'state.json'));
    await fs.mkdir(path.dirname(profilePath), {recursive: true});
    await fs.writeFile(profilePath, JSON.stringify({chat: 'still here'}));
    client.request = async () => { throw new AccountError('offline', {network: true}); };
    const result = await store.logout();
    assert.equal(result.mode, 'guest');
    assert.equal(result.remoteRevoked, false);
    assert.equal(await fs.readFile(path.join(dir, 'account', 'credentials.json'), 'utf8').then((text) => JSON.parse(text).users['11111111-1111-4111-8111-111111111111']), undefined);
    assert.equal(JSON.parse(await fs.readFile(profilePath, 'utf8')).chat, 'still here');

    const online = fakeClient();
    const second = await tempStore({client: online});
    try {
      await second.store.login({email: 'a@example.com', password: 'correct horse battery staple'});
      const state = await second.store.logout();
      assert.equal(state.remoteRevoked, true);
      assert.equal(state.mode, 'guest');
    } finally { await second.cleanup(); }
  } finally {
    await cleanup();
  }
});

test('remember=false never writes a reusable refresh token to disk', async () => {
  const {dir, store, cleanup} = await tempStore();
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple', remember: false});
    const credentials = JSON.parse(await fs.readFile(path.join(dir, 'account', 'credentials.json'), 'utf8'));
    assert.equal(credentials.users['11111111-1111-4111-8111-111111111111'], undefined);
    assert.equal(store.memoryRefresh.has('11111111-1111-4111-8111-111111111111'), true);
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'account', 'account.json'), 'utf8'));
    assert.equal(meta.profiles['11111111-1111-4111-8111-111111111111'].remember, false);
  } finally {
    await cleanup();
  }

  const restarted = await tempStore();
  try {
    await restarted.store.login({email: 'a@example.com', password: 'correct horse battery staple', remember: false});
    await restarted.store.dispose();
    const second = createAccountStore({userData: restarted.dir, safeStorage: fakeSafeStorage(), client: fakeClient()});
    try {
      const snapshot = await second.initialize();
      assert.equal(snapshot.profileId, '11111111-1111-4111-8111-111111111111');
      assert.equal(snapshot.status, 'reauth-required');
    } finally { await second.dispose(); }
  } finally { await restarted.cleanup(); }
});

test('unavailable system secure storage never falls back to plaintext', async () => {
  const {dir, store, cleanup} = await tempStore({safeStorage: fakeSafeStorage(false)});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    const credentials = await fs.readFile(path.join(dir, 'account', 'credentials.json'), 'utf8').catch(() => '{}');
    assert.doesNotMatch(credentials, /refresh-/);
    assert.equal(store.snapshot().credentialsUnavailable, true);
    assert.equal(store.snapshot().mode, 'account');
  } finally { await cleanup(); }
});

test('signed entitlement snapshots are verified, tampering is rejected, and cloud skins stay cached', async () => {
  const pair = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const {store, cleanup} = await tempStore();
  try {
    store.entitlementKey = {keyId: 'test', publicJwk};
    const payload = {v: 1, uid: '11111111-1111-4111-8111-111111111111', affection: 60, loginDays: 9, skinIds: ['yukino-02-v1', 'yukino-07-v1'], rulesVersion: 'test', issuedAt: Date.now()};
    const signature = new Uint8Array(await webcrypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, pair.privateKey, new TextEncoder().encode(canonicalJson(payload))));
    const envelope = {alg: 'ES256', keyId: 'test', snapshot: payload, signature: Buffer.from(signature).toString('base64url')};
    assert.equal((await store.verifyEntitlement(envelope, '11111111-1111-4111-8111-111111111111')).ok, true);
    assert.equal((await store.verifyEntitlement({...envelope, snapshot: {...payload, affection: 100}}, '11111111-1111-4111-8111-111111111111')).ok, false);
    assert.equal((await store.verifyEntitlement(envelope, '22222222-2222-4222-8222-222222222222')).ok, false);
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    await store.applyProgress(progressData({entitlement: envelope}));
    assert.deepEqual([...store.snapshot().cloudSkins].sort(), ['beret-v2', 'summer-uniform-v2', 'winter-uniform-v2']);
    assert.equal(store.snapshot().entitlementUnverified, false);
    void privateJwk;
  } finally { await cleanup(); }
});

test('pending events are removed only after server outcomes and failures keep the queue', async () => {
  const client = fakeClient();
  const {store, cleanup} = await tempStore({client});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    await store.enqueueEvent('message');
    await store.enqueueEvent('pet-interaction');
    assert.equal(store.snapshot().pendingCount, 2);
    client.request = async (route) => {
      if (route === '/api/v1/progress/events') throw new AccountError('offline', {network: true});
      throw new Error(route);
    };
    await assert.rejects(() => store.syncPending());
    assert.equal(store.snapshot().pendingCount, 2);
    client.request = async (route, options = {}) => {
      if (route === '/api/v1/progress/events') return {outcomes: options.body.events.map((event) => ({eventId: event.eventId, status: 'accepted'})), ...progressData()};
      throw new Error(route);
    };
    await store.syncPending();
    assert.equal(store.snapshot().pendingCount, 0);
  } finally { await cleanup(); }
});

test('corrupt account metadata is moved aside, never deleted, and the app still starts as guest', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-account-corrupt-'));
  await fs.mkdir(path.join(dir, 'account'), {recursive: true});
  await fs.writeFile(path.join(dir, 'account', 'account.json'), '{not json');
  const store = createAccountStore({userData: dir, safeStorage: fakeSafeStorage(), client: fakeClient()});
  try {
    const snapshot = await store.initialize();
    assert.equal(snapshot.mode, 'guest');
    const files = await fs.readdir(path.join(dir, 'account'));
    assert.ok(files.some((file) => /account\.json\.corrupt-/.test(file)));
  } finally { await store.dispose(); await fs.rm(dir, {recursive: true, force: true}); }
});

test('cloud memory methods use authenticated routes and reject unsafe character ids before any request', async () => {
  const client = fakeClient();
  const {store, cleanup} = await tempStore({client});
  try {
    await store.login({email: 'a@example.com', password: 'correct horse battery staple'});
    const calls = [];
    client.request = async (route, options = {}) => {
      calls.push({route, method: options.method || 'GET', body: options.body, token: options.token});
      if (route === '/api/v1/memory/yukino' && options.method === 'PUT') return {memory: {id: 'yukino', text: options.body.text, version: 3}};
      if (route.startsWith('/api/v1/memory/yukino/chat') && options.method === 'POST') return {accepted: options.body.messages.length};
      return {ok: true};
    };
    await store.memorySettings();
    await store.setMemorySettings({syncMemory: true, syncChat: false});
    await store.cloudMemories();
    await store.cloudMemory('yukino');
    await store.saveCloudMemory({characterId: 'yukino', text: 'remember this', baseVersion: 2});
    await store.deleteCloudMemory('yukino');
    await store.cloudChat({characterId: 'yukino', conversationId: 'chat-1', before: 99});
    await store.pushCloudChat({characterId: 'yukino', conversationId: 'chat-1', messages: [{id: 'm1', role: 'user', text: 'hi', createdAt: 1}]});
    await store.deleteCloudChat({characterId: 'yukino', conversationId: 'chat-1'});
    assert.deepEqual(calls.map((call) => `${call.method} ${call.route}`), [
      'GET /api/v1/memory/settings',
      'PUT /api/v1/memory/settings',
      'GET /api/v1/memory?limit=50',
      'GET /api/v1/memory/yukino',
      'PUT /api/v1/memory/yukino',
      'DELETE /api/v1/memory/yukino',
      'GET /api/v1/memory/yukino/chat?limit=30&conversationId=chat-1&before=99',
      'POST /api/v1/memory/yukino/chat',
      'DELETE /api/v1/memory/yukino/chat',
    ]);
    assert.deepEqual(calls[1].body, {syncMemory: true, syncChat: false});
    assert.deepEqual(calls[4].body, {text: 'remember this', baseVersion: 2});
    assert.equal(calls[7].body.conversationId, 'chat-1');
    assert.ok(calls.every((call) => call.token), 'every memory call must carry the access token');
    const before = calls.length;
    await assert.rejects(() => store.saveCloudMemory({characterId: '../escape', text: 'x'}), (error) => error.code === 'invalid_character');
    await assert.rejects(() => store.cloudMemory('bad id'), (error) => error.code === 'invalid_character');
    assert.equal(calls.length, before, 'invalid ids must be rejected locally without calling the server');
  } finally { await cleanup(); }
});

test('an explicit local apiBase survives initialization when no config file exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-account-base-'));
  const client = fakeClient();
  const store = createAccountStore({userData: dir, safeStorage: fakeSafeStorage(), client, apiBase: 'http://127.0.0.1:8787'});
  try {
    await store.initialize();
    assert.equal(store.client.baseUrl, 'http://127.0.0.1:8787');
    assert.equal(store.snapshot().apiBase, 'http://127.0.0.1:8787');
  } finally {
    await store.dispose();
    await fs.rm(dir, {recursive: true, force: true});
  }
});
