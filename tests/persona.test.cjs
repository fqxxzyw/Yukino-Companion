const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {finished} = require('node:stream/promises');
const { LEGACY_PERSONA, migratePersonaState, buildPersonaPrompt, preparePersonaChat, characterDocument, isYukinoLocal } = require('../electron/persona.cjs');
const { chat } = require('../electron/chat.cjs');
const { verifyCharacterPackage } = require('../scripts/verify-character-package.cjs');
const remote = { base: 'https://example.com/v1', model: 'provider-model' };
const local = { base: 'http://127.0.0.1:8000/v1', model: 'oregairu-small' };
const prompt = [{ role: 'user', content: '你好' }];
function fixture(t, suffix = '') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yukino-persona-'));
  const root = path.join(temp, suffix);
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const manifest = { schema_version: 2, id: 'yukino', version: '1.0.0', runtime_path: 'runtime.md', compact_path: 'compact.md', bible_path: 'CHARACTER.md', training_path: 'training.md', evidence_path: 'evidence.md' };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'runtime.md'), 'COMPLETE_PERSONALITY: 稳定人格与边界，锋芒与温柔属于同一个人');
  fs.writeFileSync(path.join(root, 'compact.md'), 'COMPACT_PERSONALITY: 完整人格的精简表达');
  fs.writeFileSync(path.join(root, 'CHARACTER.md'), 'FULL_DOCUMENT: 完整详细人格可阅读');
  fs.writeFileSync(path.join(root, 'training.md'), 'TRAINING_PERSONALITY');
  fs.writeFileSync(path.join(root, 'evidence.md'), 'EVIDENCE');
  return { temp, root, manifest };
}
async function payload(state, profile, incoming, root) {
  let body;
  await chat({ ...preparePersonaChat(state, profile, incoming, root), profile, onToken() {}, fetcher: async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: '收到' } }] });
  } });
  return body;
}

test('legacy migration removes only the original stub and preserves custom text and memory', () => {
  assert.deepEqual(migratePersonaState({ persona: LEGACY_PERSONA, memory: '喜欢蓝色' }), { persona: '', memory: '喜欢蓝色', personaEnabled: true, personaPromptMode: 'detailed' });
  assert.equal(migratePersonaState({ persona: '我的角色补充', personaStage: 'future' }).persona, '我的角色补充');
  assert.ok(!('personaStage' in migratePersonaState({ personaStage: 'late', personaEnabled: false })));
  assert.equal(migratePersonaState({ personaEnabled: false }).personaEnabled, false);
});

test('the detailed request uses one unified personality and full document remains separately readable', t => {
  const { root } = fixture(t);
  const result = buildPersonaPrompt({}, remote, root);
  assert.match(result.content, /COMPLETE_PERSONALITY/);
  assert.doesNotMatch(result.content, /FULL_DOCUMENT|当前阶段/);
  assert.ok(!('stage' in result));
  assert.match(characterDocument(root).text, /FULL_DOCUMENT/);
});

test('built-in off keeps custom settings and optional memory without loading any assets', () => {
  const result = buildPersonaPrompt({ personaEnabled: false, persona: '扮演我的数学老师', useMemory: true, memory: '我在学微积分' }, remote, '/does-not-exist');
  assert.match(result.content, /数学老师/);
  assert.match(result.content, /微积分/);
  assert.doesNotMatch(result.content, /当前阶段/);
  assert.match(result.content, /内置雪乃人格不生效/);
  assert.doesNotMatch(buildPersonaPrompt({ personaEnabled: false, memory: 'NEVER_SEND', useMemory: false }, remote).content, /NEVER_SEND/);
});

test('actual API payload uses persisted persona, drops all supplied system messages, and keeps the unified personality across API changes', async t => {
  const { root } = fixture(t);
  const incoming = [{ role: 'system', content: 'UNTRUSTED_SYSTEM' }, { role: 'user', content: '上一轮' }, { role: 'assistant', content: '你好' }, { role: 'system', content: 'HISTORICAL_OVERRIDE' }, ...prompt];
  const first = await payload({ persona: '称呼我小林' }, remote, incoming, root);
  const second = await payload({ persona: '称呼我小林' }, { base: 'https://other.example/v1', model: 'another-api' }, incoming, root);
  for (const body of [first, second]) {
    assert.equal(body.messages.filter(m => m.role === 'system').length, 1);
    assert.match(body.messages[0].content, /COMPLETE_PERSONALITY/);
    assert.match(body.messages[0].content, /称呼我小林/);
    assert.doesNotMatch(JSON.stringify(body), /UNTRUSTED_SYSTEM|HISTORICAL_OVERRIDE/);
    assert.equal(body.messages.at(-1).content, '你好');
    assert.ok(!('use_knowledge' in body));
  }
  assert.equal(first.messages[0].content, second.messages[0].content);
  assert.ok(!('character_stage' in first));
  assert.ok(!('personaStage' in second));
});

test('only our named loopback model forces compact and disables knowledge retrieval on the wire', async t => {
  const { root } = fixture(t);
  for (const base of ['http://localhost:8000/v1', 'https://127.0.0.1/v1', 'http://[::1]:8000/v1']) assert.equal(isYukinoLocal({ ...local, base }), true);
  for (const base of ['https://localhost.example/v1', 'https://remote.example/v1', 'file:///tmp/']) assert.equal(isYukinoLocal({ ...local, base }), false);
  const body = await payload({ personaPromptMode: 'detailed' }, local, prompt, root);
  assert.equal(body.use_knowledge, false);
  assert.match(body.messages[0].content, /TRAINING_PERSONALITY/);
  assert.doesNotMatch(body.messages[0].content, /COMPLETE_PERSONALITY/);
  for (const profile of [{ ...local, model: 'other-model' }, { ...remote, model: 'oregairu-small' }]) {
    const generic = await payload({}, profile, prompt, root);
    assert.ok(!('use_knowledge' in generic));
    assert.match(generic.messages[0].content, /COMPLETE_PERSONALITY/);
  }
});

test('local requests fit server message and text budgets, retaining the newest question', t => {
  const { root } = fixture(t);
  const incoming = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) + '文'.repeat(950) })).concat(prompt);
  const result = preparePersonaChat({}, local, incoming, root);
  assert.ok(result.messages.length <= 29);
  assert.ok(result.messages.reduce((sum, item) => sum + item.content.length, 0) <= 20000);
  assert.equal(result.messages.at(-1).content, '你好');
  assert.throws(() => preparePersonaChat({}, local, [{ role: 'user', content: '文'.repeat(6001) }], root), /6000/);
});

test('oversized custom settings, enabled memories, and core fail explicitly rather than truncate', t => {
  const { root } = fixture(t);
  assert.throws(() => buildPersonaPrompt({ persona: 'a'.repeat(501) }, local, root), /500/);
  assert.throws(() => buildPersonaPrompt({ useMemory: true, memory: 'a'.repeat(701) }, local, root), /700/);
  assert.throws(() => buildPersonaPrompt({ persona: 'a'.repeat(6001) }, remote, root), /6000/);
  assert.throws(() => buildPersonaPrompt({ useMemory: true, memory: 'a'.repeat(12001) }, remote, root), /12000/);
  fs.writeFileSync(path.join(root, 'runtime.md'), '文'.repeat(30001));
  assert.throws(() => buildPersonaPrompt({}, remote, root), /30000.*不会被静默截断/);
});

test('packaged app-relative paths work and traversal fails', t => {
  const { root, manifest } = fixture(t, 'resources/app.asar/characters/yukino');
  assert.match(buildPersonaPrompt({}, remote, root).content, /COMPLETE_PERSONALITY/);
  manifest.runtime_path = '../outside.md';
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => buildPersonaPrompt({}, remote, root), /越界/);
  const config = require('../package.json');
  assert.ok(config.build.files.includes('characters/**/*'));
});

test('archive verification opens real asar resources and fails on a missing runtime file', async t => {
  const { temp, root } = fixture(t, 'source/characters/yukino');
  const source = path.join(temp, 'source');
  fs.mkdirSync(path.join(source, 'electron'));
  for (const file of ['persona.cjs', 'main.cjs', 'preload.cjs']) fs.writeFileSync(path.join(source, 'electron', file), '// runtime');
  const archive = path.join(temp, 'app.asar');
  await finished(await asar.createPackage(source, archive));
  assert.equal(verifyCharacterPackage(archive).resources, 6);
  fs.rmSync(path.join(root, 'compact.md'));
  const incomplete = path.join(temp, 'incomplete.asar');
  await finished(await asar.createPackage(source, incomplete));
  assert.throws(() => verifyCharacterPackage(incomplete), /compact/);
  fs.writeFileSync(path.join(root, 'compact.md'), 'COMPACT_PERSONALITY');
  fs.mkdirSync(path.join(root, 'stages'));
  fs.writeFileSync(path.join(root, 'stages/early.md'), 'STALE_PERSONALITY');
  const stale = path.join(temp, 'stale.asar');
  await finished(await asar.createPackage(source, stale));
  assert.throws(() => verifyCharacterPackage(stale), /旧版分阶段资源/);
});


test('disabled built-in and manually selected compact modes remain correct on the network', async t => {
  const { root } = fixture(t);
  const disabled = await payload({ personaEnabled: false, persona: '用平和语气解释数学', useMemory: true, memory: '正在准备考试' }, remote, prompt, root);
  assert.match(disabled.messages[0].content, /数学/);
  assert.match(disabled.messages[0].content, /正在准备考试/);
  assert.doesNotMatch(disabled.messages[0].content, /COMPLETE_PERSONALITY/);
  const compact = await payload({ personaPromptMode: 'compact' }, remote, prompt, root);
  assert.match(compact.messages[0].content, /COMPACT_PERSONALITY/);
  assert.doesNotMatch(compact.messages[0].content, /COMPLETE_PERSONALITY/);
  assert.ok(!('use_knowledge' in compact));
  assert.throws(() => preparePersonaChat({}, remote, [null], root), /消息格式不正确/);
});

test('bundled unified character resources fit both request budgets with user supplements', () => {
  const detailed = buildPersonaPrompt({ persona: '设'.repeat(6000), useMemory: true, memory: '忆'.repeat(12000) }, remote);
  const compact = buildPersonaPrompt({ persona: '设'.repeat(500), useMemory: true, memory: '忆'.repeat(700) }, local);
  assert.ok(detailed.content.length <= 30000);
  assert.ok(compact.content.length <= 5000);
  assert.match(detailed.content, /雪之下雪乃/);
  assert.match(compact.content, /雪之下雪乃/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../characters/yukino/manifest.json'), 'utf8'));
  assert.equal(manifest.schema_version, 2);
  assert.ok(!('stages' in manifest));
  assert.ok(!('default_stage' in manifest));
});

test('main-process IPC compiles persisted settings before the real HTTP transport', async () => {
  const {mainHarness} = require('./helpers/main-harness.cjs');
  const {BILINGUAL_INSTRUCTION} = require('../electron/bilingual.cjs');
  const saved = { profiles: [{ ...remote, id: 'saved-api' }], activeProfile: 'saved-api', conversations: [], persona: 'PERSISTED_PERSONA', useMemory: true, memory: 'PERSISTED_MEMORY', personaStage: 'early' };
  const harness = await mainHarness({state:saved});
  const result = await harness.invoke('chat', {id:'test-request',profileId:'saved-api',messages:[{role:'system',content:'FORGED_SYSTEM'},...prompt]});
  const request = harness.requests[0];
  assert.equal(request.messages[0].content, buildPersonaPrompt(saved,remote).content + '\n\n' + BILINGUAL_INSTRUCTION);
  assert.match(request.messages[0].content, /PERSISTED_PERSONA/);
  assert.match(request.messages[0].content, /PERSISTED_MEMORY/);
  assert.doesNotMatch(JSON.stringify(request), /FORGED_SYSTEM/);
  assert.equal(request.messages.filter(item=>item.role==='system').length,1);
  assert.equal(result.bilingual.zh,'收到。');
  assert.equal(result.bilingual.ja,'わかりました。');
  assert.equal(harness.translated.length,0);
  const preview = await harness.invoke('character-preview');
  assert.equal(preview.characters, request.messages[0].content.length);
  const loaded = await harness.invoke('load');
  assert.ok(!('personaStage' in loaded.state));
});


test('archive verification uses Windows separators with the real asar directory traversal', async t => {
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const { temp } = fixture(t, 'source/characters/yukino');
  const source = path.join(temp, 'source');
  fs.mkdirSync(path.join(source, 'electron'));
  for (const file of ['persona.cjs', 'main.cjs', 'preload.cjs']) fs.writeFileSync(path.join(source, 'electron', file), '// runtime');
  const archive = path.join(temp, 'app.asar');
  await finished(await asar.createPackage(source, archive));

  function loadWithWindowsPaths(filename, overrides = {}) {
    const module = { exports: {} };
    const originalRequire = createRequire(filename);
    const simulatedRequire = name => {
      if (name === 'path' || name === 'node:path') return path.win32;
      return overrides[name] || originalRequire(name);
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: simulatedRequire }, { filename });
    return module.exports;
  }
  const asarDirectory = path.dirname(require.resolve('@electron/asar'));
  const { Filesystem: WindowsFilesystem } = loadWithWindowsPaths(path.join(asarDirectory, 'filesystem.js'));
  const archiveHeader = asar.getRawHeader(archive);
  const windowsFilesystem = new WindowsFilesystem(archive);
  windowsFilesystem.setHeader(archiveHeader.header, archiveHeader.headerSize);
  // Keep the physical archive accessible on the test host; only the archive lookup uses Windows semantics.
  windowsFilesystem.getRootPath = () => archive;
  assert.throws(() => windowsFilesystem.getFile('characters/yukino/manifest.json'), /was not found in this archive/);
  const disk = require(path.join(asarDirectory, 'disk.js'));
  const requestedNames = [];
  const windowsAsar = {
    extractFile: (_archive, filename) => {
      requestedNames.push(filename);
      return disk.readFileSync(windowsFilesystem, filename, windowsFilesystem.getFile(filename));
    },
    listPackage: () => windowsFilesystem.listFiles(),
  };
  const windowsVerifier = loadWithWindowsPaths(path.resolve(__dirname, '../scripts/verify-character-package.cjs'), { '@electron/asar': windowsAsar });
  assert.equal(windowsVerifier.verifyCharacterPackage(archive).resources, 6);
  assert.equal(requestedNames[0], path.win32.join('characters', 'yukino', 'manifest.json'));
  assert.ok(requestedNames.every(filename => !filename.includes('/')));
  delete archiveHeader.header.files.characters.files.yukino.files['compact.md'];
  assert.throws(() => windowsVerifier.verifyCharacterPackage(archive), /compact.*was not found in this archive/);
});


test('normal identity and relationship requests keep the first-person contract after remembered context', async () => {
  const {NATURAL_DIALOGUE_CONTRACT} = require('../electron/persona.cjs');
  for (const question of ['你是谁？', '你和八幡是什么关系？']) {
    const body = await payload({useMemory:true,memory:'用户喜欢蓝色。'},remote,[
      {role:'user',content:'你好'},
      {role:'assistant',content:'我是按角色设定交流的数字角色。在原著中……'},
      {role:'user',content:question},
    ]);
    assert.ok(body.messages[0].content.endsWith(NATURAL_DIALOGUE_CONTRACT));
    assert.match(body.messages[0].content,/普通交谈直接用雪乃的第一人称回答/);
    assert.match(body.messages[0].content,/只有明确追问现实或技术身份时才简短诚实说明/);
    assert.equal(body.messages.at(-1).content,question);
    // Preserve history as supplied; prevent its incidental wording from becoming policy.
    assert.match(body.messages[2].content,/数字角色/);
  }
});

test('explicit technical identity and literary questions are preserved rather than keyword-filtered', async () => {
  for (const question of ['你实际上是软件里的AI还是真人？', '请分析原著中雪乃与八幡的关系变化。']) {
    const body = await payload({},remote,[{role:'user',content:question}]);
    assert.equal(body.messages.at(-1).content,question);
    assert.match(body.messages[0].content,/明确要求作品、剧情、章节或改编分析/);
  }
  const disabled = buildPersonaPrompt({personaEnabled:false,persona:'以普通助手回答'},remote);
  assert.doesNotMatch(disabled.content,/【本轮表达】|普通交谈直接用雪乃/);
});
