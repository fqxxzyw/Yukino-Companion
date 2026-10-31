const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TranslationService } = require('../electron/translation.cjs');
const { mainHarness } = require('./helpers/main-harness.cjs');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-entrypoints-'));
  const script = path.join(directory, 'worker.py'), data = Buffer.from('pinned tiny translation fixture');
  await fs.writeFile(script, '');
  await fs.writeFile(path.join(directory, 'model-manifest.json'), JSON.stringify({
    id: 'translation-test', directory: 'translation-test', baseUrl: 'https://example.invalid/pinned',
    files: [{ path: 'model.gguf', size: data.length, sha256: createHash('sha256').update(data).digest('hex') }]
  }));
  const entered = deferred(), release = deferred(), instances = [];
  let fetches = 0, aborts = 0;
  class RealTranslation extends TranslationService {
    constructor(options) {
      super({ ...options, script, stateDir: directory, modelDir: '', python: process.execPath,
        fetcher: async (_url, { signal }) => {
          fetches++; entered.resolve();
          await new Promise((resolve, reject) => {
            const abort = () => { aborts++; reject(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
            release.promise.then(() => { signal.removeEventListener('abort', abort); resolve(); });
            if (signal.aborted) abort();
          });
          return new Response(data);
        }
      });
      instances.push(this);
    }
    configure(config) { return super.configure({ ...config, python: process.execPath }); }
  }
  const app = await mainHarness({ state: {}, translationClass: RealTranslation });
  t.after(async () => { release.resolve(); instances.forEach(service => service.dispose()); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  return { app, entered: entered.promise, release: release.resolve, service: instances[0], fetches: () => fetches, aborts: () => aborts };
}
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));

test('translation settings cancel IPC stops the real installer, not just translation requests', async t => {
  const f = await fixture(t), install = outcome(f.app.invoke('translation-install'));
  await f.entered;
  await f.app.invoke('translation-cancel');
  const cancelled = f.service.installToken.cancelled;
  f.release();
  const result = await install;
  assert.equal(cancelled, true, 'the download token must be cancelled by the settings action');
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(f.aborts(), 1);
  assert.equal(f.service.installToken, null);
  assert.equal(f.service.phase, 'paused');
  assert.equal(f.app.storage.has('translation.json'), false, 'cancelled installs cannot publish new configuration');
});

test('settings download and deployment wizard join one real translation install', async t => {
  const f = await fixture(t), settings = outcome(f.app.invoke('translation-install'));
  await f.entered;
  const wizard = outcome(f.app.invoke('setup-install', { features: ['translation'], runtimeFlavor: 'cpu' }));
  await new Promise(setImmediate); await new Promise(setImmediate);
  f.release();
  const [a, b] = await Promise.all([settings, wizard]);
  assert.equal(a.error, undefined, 'opening setup must not cancel the settings-owned download');
  assert.equal(b.error, undefined, 'setup should reuse the in-flight install instead of reporting busy');
  assert.equal(a.value.modelInstalled, true);
  assert.equal(b.value.ready, true);
  assert.equal(f.fetches(), 1);
  assert.equal(f.aborts(), 0);
});

test('cancelling only the wizard leaves the settings-owned download alive', async t => {
  const f = await fixture(t), settings = outcome(f.app.invoke('translation-install'));
  await f.entered;
  const wizard = outcome(f.app.invoke('setup-install', { features: ['translation'] }));
  await new Promise(setImmediate); await new Promise(setImmediate);
  await f.app.invoke('setup-cancel');
  f.release();
  const [a, b] = await Promise.all([settings, wizard]);
  assert.equal(a.error, undefined);
  assert.equal(a.value.modelInstalled, true);
  assert.match(b.error?.message || '', /已取消准备/);
  assert.equal(f.aborts(), 0);
  assert.equal(f.fetches(), 1);
});

test('wizard-only cancellation aborts its real download without committing the incomplete model', async t => {
  const f = await fixture(t), wizard = outcome(f.app.invoke('setup-install', { features: ['translation'] }));
  await f.entered;
  const previousModelDir = f.service.config.modelDir;
  await f.app.invoke('setup-cancel');
  const result = await wizard;
  assert.match(result.error?.message || '', /已取消准备/);
  assert.equal(f.aborts(), 1);
  assert.equal(f.service.installToken, null);
  assert.equal(f.service.config.modelDir, previousModelDir);
  assert.equal(JSON.parse(f.app.storage.get('translation.json')).modelDir, previousModelDir, 'runtime refresh may save Python, but cannot select incomplete weights');
  f.release();
  const retry = await f.app.invoke('setup-install', { features: ['translation'] });
  assert.equal(retry.ready, true);
  assert.equal(f.fetches(), 2);
});

test('a runtime failure in setup does not cancel a shared settings-owned translation download', async t => {
  const f = await fixture(t), settings = outcome(f.app.invoke('translation-install'));
  await f.entered;
  f.app.runtime.install = async () => { throw Error('runtime source failed'); };
  const wizard = outcome(f.app.invoke('setup-install', { features: ['translation'] }));
  await new Promise(setImmediate); await new Promise(setImmediate); f.release();
  const [a, b] = await Promise.all([settings, wizard]);
  assert.equal(a.error, undefined); assert.equal(a.value.modelInstalled, true);
  assert.match(b.error?.message || '', /runtime source failed/);
  assert.equal(f.fetches(), 1); assert.equal(f.aborts(), 0);
  assert.equal(f.app.setup.failedStep, 'runtime');
});

test('idle wizard cancel and request-specific translation cancel do not touch a settings download', async t => {
  const f = await fixture(t), settings = outcome(f.app.invoke('translation-install'));
  await f.entered;
  await f.app.invoke('setup-cancel');
  await f.app.invoke('translation-cancel', 'one-preview');
  f.release();
  const result = await settings;
  assert.equal(result.error, undefined);
  assert.equal(result.value.modelInstalled, true);
  assert.equal(f.aborts(), 0);
});
