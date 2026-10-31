'use strict';
// SIMULATED environment manager tests: actual temporary files, controlled
// run/fetch, no pip, downloads, imported Aqua code or GPU work. Successful
// trusted-wheel paths use an explicitly simulated SHA sentinel in a VM module;
// changed bytes still fail the real SHA-256 comparison against that sentinel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const real = require('../electron/aqua-environment.cjs');
const FAKE_WHEEL = Buffer.from('SIMULATED inert wheel fixture; never installed or executed');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const dependencies = {numpy: '1.26.4', soundfile: '0.12.1', librosa: '0.10.2', peft: '0.13.2'};
const probe = () => ({aquaVersion: '0.3.0', aquaLocal: true, pythonImplementation: 'CPython', pythonVersion: '3.11.7',
  torch: '2.5.1+cu124', cudaBuild: '12.4', cudaAvailable: true, cudaKernel: true,
  gpuName: 'SIMULATED GPU', dependencies});

async function simulatedModule() {
  const source = await fs.readFile(path.join(__dirname, '../electron/aqua-environment.cjs'), 'utf8');
  const module = {exports: {}};
  const simulatedCrypto = {...crypto, createHash: algorithm => {
    assert.equal(algorithm, 'sha256');
    const hash = crypto.createHash(algorithm);
    return {update(bytes) { hash.update(bytes); return this; }, digest(encoding) {
      const actual = hash.digest(encoding);
      return actual === digest(FAKE_WHEEL) ? real.WHEEL_SHA256 : actual;
    }};
  }};
  vm.runInNewContext(source, {module, exports: module.exports, require: name => name === 'node:crypto' ? simulatedCrypto : require(name),
    process, Buffer, AbortController, AbortSignal, fetch, console, setTimeout, clearTimeout},
  {filename: 'SIMULATED-aqua-environment.cjs'});
  return module.exports;
}

async function fixture(t, {trusted = true, run, fetcher, notify} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-aqua-simulated-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const dataRoot = path.join(root, 'current-install');
  const base = path.join(root, process.platform === 'win32' ? 'base-python.exe' : 'base-python');
  await fs.writeFile(base, 'base interpreter sentinel: must never change');
  const api = trusted ? await simulatedModule() : real;
  const commands = [], downloads = [], notifications = [];
  const defaultRun = async (python, args, options) => {
    if (args.includes('venv')) {
      const target = args.at(-1);
      const created = path.join(target, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      await fs.mkdir(path.dirname(created), {recursive: true});
      await fs.writeFile(created, 'SIMULATED venv interpreter; never executed');
      return {stdout: '', stderr: ''};
    }
    if (args.includes(api.VENV_PROBE)) return {stdout: JSON.stringify({venv: true, systemSitePackages: true, pythonImplementation: 'CPython', pythonVersion: '3.11.7'})};
    if (args.includes(api.ENVIRONMENT_PROBE)) return {stdout: JSON.stringify(probe())};
    return {stdout: 'SIMULATED pip success', stderr: ''};
  };
  const manager = new api.AquaEnvironmentManager({dataRoot,
    run: async (python, args, options) => { commands.push({python, args, options}); return run ? run(python, args, options, defaultRun) : defaultRun(python, args, options); },
    fetcher: async (url, options) => { downloads.push({url, options}); return fetcher ? fetcher(url, options) : new Response(FAKE_WHEEL); },
    notify: value => { notifications.push(value); notify?.(value); }});
  return {root, dataRoot, base, api, manager, commands, downloads, notifications, defaultRun};
}
function installCommands(f) { return f.commands.filter(command => command.args.includes('install')); }
async function attempts(f) { return (await fs.readdir(f.manager.root)).filter(name => /^aqua-[0-9a-f-]{36}$/.test(name)); }

// All assertions below concern orchestration/validation, NOT real environment
// installation or model-inference success.
test('pinned wheel metadata is exact and initial status is current-install scoped overlay', async t => {
  assert.equal(real.WHEEL_URL, 'https://files.pythonhosted.org/packages/ee/ec/802e7cddaef8b22b085d29ae3e147d1537d273e4a1a545a1c931dff6cf31/aqua_tts-0.3.0-py3-none-any.whl');
  assert.equal(real.WHEEL_SHA256, '9ca7e351b2bebfec59e4e75d276b842053adb88e8b4a6793393370da6102065a');
  assert.equal(real.MAX_WHEEL_BYTES, 1024 * 1024);
  const f = await fixture(t);
  const status = await f.manager.status();
  assert.equal(status.ready, false); assert.equal(status.verified, false);
  assert.equal(status.isolation, 'overlay'); assert.equal(status.modelInferenceVerified, false);
  assert.match(status.guidance, /不是完全独立环境/);
  assert.equal(f.commands.length, 0); assert.equal(f.downloads.length, 0);
});

test('simulated success creates unique venv, verifies local wheel, checks dependencies and probes before publishing', async t => {
  const f = await fixture(t);
  const result = await f.manager.install(f.base);
  assert.equal(result.ready, true); assert.equal(result.verified, true);
  assert.equal(result.isolation, 'overlay'); assert.equal(result.modelInferenceVerified, false);
  assert.equal(result.validation, 'environment-imports-and-cuda-kernel');
  assert.equal(result.engineVersion, '0.3.0'); assert.equal(result.basePython, f.base);
  assert.equal(result.metadata.cudaKernel, true);
  assert.equal(result.metadata.aquaVersion, '0.3.0');
  assert.equal(f.commands.length, 5);
  assert.equal(f.commands[0].python, f.base);
  assert.deepEqual(Array.from(f.commands[0].args.slice(0, 5)), ['-I', '-B', '-m', 'venv', '--system-site-packages']);
  for (const command of f.commands.slice(1)) assert.equal(command.python, result.python);
  for (const command of f.commands) {
    assert.equal(command.options.shell, false);
    assert.equal(command.options.windowsHide, true);
    assert.equal(command.options.signal.aborted, false);
    assert.equal(command.options.cwd, f.manager.root);
    assert.equal(command.options.env.HF_HUB_OFFLINE, '1');
    assert.equal(command.options.env.TRANSFORMERS_OFFLINE, '1');
    assert.equal(command.options.env.PIP_CONFIG_FILE, process.platform === 'win32' ? 'NUL' : '/dev/null');
  }
  const install = installCommands(f)[0];
  for (const flag of ['--no-deps', '--no-index', '--no-cache-dir', '--isolated', '--ignore-installed']) assert.ok(install.args.includes(flag));
  assert.equal(path.basename(install.args.at(-1)), real.WHEEL_NAME);
  assert.deepEqual(await fs.readFile(install.args.at(-1)), FAKE_WHEEL);
  assert.ok(f.commands[3].args.includes('check'));
  assert.ok(f.commands[4].args.includes(f.api.ENVIRONMENT_PROBE));
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].url, real.WHEEL_URL);
  assert.equal(f.downloads[0].options.redirect, 'error');
  assert.equal(await fs.readFile(f.base, 'utf8'), 'base interpreter sentinel: must never change');
  const pointer = JSON.parse(await fs.readFile(path.join(f.manager.root, 'current.json'), 'utf8'));
  assert.equal(result.root, path.join(f.manager.root, pointer.directory));
  const marker = JSON.parse(await fs.readFile(path.join(result.root, 'aqua-environment.json'), 'utf8'));
  assert.equal(marker.complete, true); assert.equal(marker.wheelSha256, real.WHEEL_SHA256);
  assert.equal(marker.modelInferenceVerified, false);
  assert.equal(f.manager.pending, null); assert.equal(f.manager.controller, null);
});

test('streamed wheel chunks are hashed and written in order before pip', async t => {
  const f = await fixture(t, {fetcher: async () => ({ok: true, headers: new Headers(),
    body: {async *[Symbol.asyncIterator]() { yield FAKE_WHEEL.subarray(0, 7); yield FAKE_WHEEL.subarray(7, 23); yield FAKE_WHEEL.subarray(23); }}})});
  assert.equal((await f.manager.install(f.base)).verified, true);
  assert.deepEqual(await fs.readFile(installCommands(f)[0].args.at(-1)), FAKE_WHEEL);
});

test('probe code imports runtime dependencies and validates a real CUDA kernel, never imports Aqua inferencer', () => {
  for (const token of ['import torch,numpy,soundfile,librosa,peft', "metadata.version('aqua-tts')", "torch.ones(2,device='cuda:0')", 'torch.cuda.synchronize', 'value.cpu().item()==4', 'metadata.distribution']) assert.ok(real.ENVIRONMENT_PROBE.includes(token), token);
  assert.doesNotMatch(real.ENVIRONMENT_PROBE, /(?:from|import)\s+aquatts|TTSInferencer/);
  assert.ok(real.VENV_PROBE.includes('sys.prefix!=sys.base_prefix'));
  assert.ok(real.VENV_PROBE.includes("include-system-site-packages"));
  assert.ok(real.VENV_PROBE.includes('settings[key.strip()]=value.strip()'), 'CPython pyvenv.cfg has spaces around =');
});

test('real hash mismatch rejects untrusted bytes before pip and retains incomplete stage', async t => {
  const f = await fixture(t, {trusted: false});
  await assert.rejects(f.manager.install(f.base), /AQUA_WHEEL_HASH/);
  assert.equal(installCommands(f).length, 0);
  assert.equal((await attempts(f)).length, 1);
  const incomplete = path.join(f.manager.root, (await attempts(f))[0], 'aqua-environment.json');
  assert.equal(JSON.parse(await fs.readFile(incomplete, 'utf8')).complete, false);
  await assert.rejects(fs.access(path.join(f.manager.root, 'current.json')));
  assert.equal((await f.manager.status()).verified, false);
});

test('tampered streamed bytes cannot use the simulated trusted hash sentinel', async t => {
  const f = await fixture(t, {fetcher: async () => new Response(Buffer.concat([FAKE_WHEEL, Buffer.from('tampered')]))});
  await assert.rejects(f.manager.install(f.base), /AQUA_WHEEL_HASH/);
  assert.equal(installCommands(f).length, 0);
});

test('oversized declared or streamed wheels are rejected before pip', async t => {
  for (const declared of [true, false]) {
    const f = await fixture(t, {fetcher: async () => new Response(Buffer.alloc(real.MAX_WHEEL_BYTES + 1), declared ? {headers: {'content-length': String(real.MAX_WHEEL_BYTES + 1)}} : {})});
    await assert.rejects(f.manager.install(f.base), /AQUA_WHEEL_TOO_LARGE/);
    assert.equal(installCommands(f).length, 0);
  }
});

test('http failure and private network diagnostics are sanitized', async t => {
  const secret = 'https://user:password@private-proxy.invalid/private-index';
  for (const fetcher of [async () => new Response('unavailable', {status: 503}), async () => { throw Error(secret); }]) {
    const f = await fixture(t, {fetcher});
    await assert.rejects(f.manager.install(f.base), error => error.message.includes('AQUA_DOWNLOAD_FAILED') && !error.message.includes(secret));
    assert.doesNotMatch(JSON.stringify(f.notifications), /password|private-index/);
    assert.equal(installCommands(f).length, 0);
  }
});

test('embedded/unsupported base venv fails truthfully without download or base changes', async t => {
  const f = await fixture(t, {run: async () => { throw Error('No module named venv; private stdout'); }});
  await assert.rejects(f.manager.install(f.base), /AQUA_VENV_FAILED.*完整 CPython/);
  assert.equal(f.downloads.length, 0); assert.equal(f.commands.length, 1);
  assert.equal((await attempts(f)).length, 1);
  assert.equal(await fs.readFile(f.base, 'utf8'), 'base interpreter sentinel: must never change');
});

test('failed overlay identity check never permits pip to run against the base', async t => {
  const f = await fixture(t, {run: async (python, args, options, fallback) => args.includes(real.VENV_PROBE)
    ? {stdout: JSON.stringify({venv: false, systemSitePackages: false, pythonImplementation: 'CPython', pythonVersion: '3.11.7'})}
    : fallback(python, args, options)});
  await assert.rejects(f.manager.install(f.base), /AQUA_VENV_INVALID/);
  assert.equal(f.downloads.length, 0); assert.equal(installCommands(f).length, 0);
});

test('missing or conflicting base dependencies fail with independent-environment guidance, never repaired', async t => {
  const secret = 'https://user:password@private-index.invalid';
  const f = await fixture(t, {run: async (python, args, options, fallback) => {
    if (args.includes('check')) {
      const error = Error(secret); error.stdout = secret; error.stderr = secret; error.code = 'AQUA_UNTRUSTED_CHILD_CODE'; throw error;
    }
    return fallback(python, args, options);
  }});
  await assert.rejects(f.manager.install(f.base), error => /AQUA_BASE_DEPENDENCIES.*完整独立/.test(error.message) && !error.message.includes(secret));
  assert.equal(installCommands(f).length, 1);
  assert.equal(f.commands.length, 4);
  assert.doesNotMatch(JSON.stringify(f.notifications), /password|private-index/);
  assert.ok(f.commands.every(command => !command.args.includes('torch') && !command.args.includes('--upgrade') && !command.args.includes('--force-reinstall')));
  assert.equal((await f.manager.status()).ready, false);
});

test('runtime import failure and false/missing CUDA/version metadata cannot publish', async t => {
  const cases = [null, {...probe(), cudaKernel: false}, {...probe(), cudaAvailable: false}, {...probe(), aquaVersion: '0.3.1'},
    {...probe(), aquaLocal: false}, {...probe(), dependencies: {...dependencies, peft: undefined}}];
  for (const value of cases) {
    const f = await fixture(t, {run: async (python, args, options, fallback) => {
      if (args.includes(real.ENVIRONMENT_PROBE)) {
        if (value === null) throw Error('private dependency import failure');
        return {stdout: JSON.stringify(value)};
      }
      return fallback(python, args, options);
    }});
    await assert.rejects(f.manager.install(f.base), /AQUA_(PROBE_FAILED|ENVIRONMENT_INVALID)/);
    await assert.rejects(fs.access(path.join(f.manager.root, 'current.json')));
    assert.equal((await f.manager.status()).modelInferenceVerified, false);
  }
});

test('raw pip stdout/stderr and extra probe fields never enter status or notifications', async t => {
  const secret = 'https://api-user:private-key@private-index.invalid';
  const f = await fixture(t, {run: async (python, args, options, fallback) => {
    const result = await fallback(python, args, options);
    if (args.includes(real.ENVIRONMENT_PROBE)) result.stdout = JSON.stringify({...probe(), extra: secret, stdout: secret});
    else if (args.includes('pip')) { result.stdout = secret; result.stderr = secret; }
    return result;
  }});
  const status = await f.manager.install(f.base);
  assert.doesNotMatch(JSON.stringify({status, notifications: f.notifications}), /private-key|private-index/);
});

test('overlapping calls reuse the exact promise and spawn one installation', async t => {
  let entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, {run: async (python, args, options, fallback) => {
    if (args.includes('venv')) { entered(); await gate; }
    return fallback(python, args, options);
  }});
  const first = f.manager.install(f.base);
  const second = f.manager.install('/not-a-second-environment');
  assert.equal(first, second);
  await started; release();
  assert.equal((await first).ready, true);
  assert.equal(f.commands.filter(command => command.args.includes('venv')).length, 1);
  assert.equal(f.downloads.length, 1);
});

test('cancel during an owned process uses only its signal and preserves incomplete stage', async t => {
  let entered, ownedSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const unrelated = new AbortController();
  const f = await fixture(t, {run: async (_python, _args, options) => {
    ownedSignal = options.signal; entered();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('private process diagnostics')), {once: true}));
  }});
  const pending = f.manager.install(f.base);
  await started; assert.equal(f.manager.cancel(), true);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(ownedSignal.aborted, true); assert.equal(unrelated.signal.aborted, false);
  assert.equal(f.manager.phase, 'cancelled'); assert.equal((await attempts(f)).length, 1);
  assert.equal(f.manager.controller, null); assert.equal(f.manager.pending, null);
  assert.equal(f.manager.cancel(), false);
});

test('immediate cancel starts neither a process nor a download', async t => {
  const f = await fixture(t);
  const pending = f.manager.install(f.base); f.manager.cancel();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(f.commands.length, 0); assert.equal(f.downloads.length, 0);
});

test('cancel during download reaches downloader signal and never invokes pip', async t => {
  let entered, downloadSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, {fetcher: async (_url, options) => {
    downloadSignal = options.signal; entered();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted fetch private URL')), {once: true}));
  }});
  const pending = f.manager.install(f.base);
  await started; f.manager.cancel();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(downloadSignal.aborted, true); assert.equal(installCommands(f).length, 0);
  assert.equal((await attempts(f)).length, 1);
});

test('failed and cancelled attempts never replace previous environment, retry uses a new directory', async t => {
  let fail = false;
  const f = await fixture(t, {run: async (python, args, options, fallback) => {
    if (fail && args.includes('check')) throw Error('dependency conflict');
    return fallback(python, args, options);
  }});
  const previous = await f.manager.install(f.base);
  const original = await fs.readFile(path.join(f.manager.root, 'current.json'), 'utf8');
  const userDirectory = path.join(f.manager.root, 'user-stuff');
  await fs.mkdir(userDirectory); await fs.writeFile(path.join(userDirectory, 'keep'), 'do not delete');
  fail = true;
  await assert.rejects(f.manager.install(f.base), /AQUA_BASE_DEPENDENCIES/);
  assert.equal(await fs.readFile(path.join(f.manager.root, 'current.json'), 'utf8'), original);
  assert.equal((await f.manager.status()).python, previous.python);
  fail = false;
  const next = await f.manager.install(f.base);
  assert.notEqual(next.root, previous.root);
  assert.equal((await attempts(f)).length, 3);
  await fs.access(previous.python);
  assert.equal(await fs.readFile(path.join(userDirectory, 'keep'), 'utf8'), 'do not delete');
});

test('cancel at publishing boundary prevents pointer replacement; cancel after ready is harmless', async t => {
  let stopPublishing = false, f;
  f = await fixture(t, {notify: value => { if (stopPublishing && value.phase === 'publishing') f.manager.cancel(); }});
  const previous = await f.manager.install(f.base);
  stopPublishing = true;
  await assert.rejects(f.manager.install(f.base), {name: 'AbortError'});
  assert.equal((await f.manager.status()).root, previous.root);
  stopPublishing = false;
  const installed = await f.manager.install(f.base);
  assert.equal(installed.ready, true); assert.equal(f.manager.cancel(), false);
});

test('status never discovers another installation or accepts malformed/traversing pointers', async t => {
  const f = await fixture(t);
  const installed = await f.manager.install(f.base);
  const other = new f.api.AquaEnvironmentManager({dataRoot: path.join(f.root, 'different-install'), run: () => { throw Error('must not execute'); }});
  assert.equal((await other.status()).ready, false);
  for (const directory of ['../escape', path.resolve(installed.root), 'aqua-user-folder', '']) {
    await fs.writeFile(path.join(f.manager.root, 'current.json'), JSON.stringify({schemaVersion: 1, directory}));
    assert.equal((await f.manager.status()).verified, false);
  }
});

test('status fails closed when selected interpreter or base disappears', async t => {
  const f = await fixture(t);
  const status = await f.manager.install(f.base);
  await fs.rename(f.base, f.base + '.removed');
  assert.equal((await f.manager.status()).ready, false);
  await fs.rename(f.base + '.removed', f.base);
  await fs.rename(status.python, status.python + '.removed');
  assert.equal((await f.manager.status()).ready, false);
});

test('proxy parameters are explicitly unsupported and never exposed or silently ignored', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.install(f.base, {proxy: 'https://user:secret@proxy.invalid'}), /AQUA_PROXY_UNSUPPORTED/);
  assert.equal(f.commands.length, 0); assert.equal(f.downloads.length, 0);
  assert.doesNotMatch(JSON.stringify(f.notifications), /secret|proxy.invalid/);
});

test('notify exceptions do not orphan installation or its controller', async t => {
  const f = await fixture(t, {notify: () => { throw Error('closed renderer'); }});
  assert.equal((await f.manager.install(f.base)).ready, true);
  assert.equal(f.manager.pending, null); assert.equal(f.manager.controller, null);
});
