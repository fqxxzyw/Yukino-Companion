const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const jsx = require('react/jsx-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const state = overrides => ({ enabled: false, retentionDays: 7, root: 'E:\\CurrentInstall\\speech-cache', files: 2, bytes: 2048, error: null, ...overrides });

// Compile the actual JSX without starting Vite, Electron, a browser or a service.
// Only React hooks are substituted; real component handlers/effects are executed.
async function harness(t, initial = {}) {
  const { transformWithOxc } = await import('vite');
  const source = await fs.readFile(path.join(__dirname, '../src/speech/SpeechCacheSettings.jsx'), 'utf8');
  let { code } = await transformWithOxc(source, 'SpeechCacheSettings.jsx');
  code = code.replace(/^import .*;\s*$/gm, '').replace('export default function', 'return function');
  const values = [], cleanups = new Map();
  let cursor = 0, effects = [], dirty = false, props = initial, tree, disposed = false, lateUpdates = 0;
  const hooks = {
    useState(initial) {
      const n = cursor++;
      if (!(n in values)) values[n] = typeof initial === 'function' ? initial() : initial;
      return [values[n], value => {
        if (disposed) { lateUpdates++; return; }
        const next = typeof value === 'function' ? value(values[n]) : value;
        if (!Object.is(next, values[n])) { values[n] = next; dirty = true; }
      }];
    },
    useRef(value) { const n = cursor++; return values[n] || (values[n] = { current: value }); },
    useId() { return `cache-settings-${cursor++}`; },
    useEffect(fn, deps) {
      const n = cursor++, old = values[n];
      if (!old || deps.some((value, index) => !Object.is(value, old[index]))) {
        values[n] = deps; effects.push(() => { cleanups.get(n)?.(); cleanups.set(n, fn()); });
      }
    },
  };
  const deps = { React: {}, ...hooks, _jsx: jsx.jsx, _jsxs: jsx.jsxs, _Fragment: jsx.Fragment };
  const component = new Function('deps', `const {${Object.keys(deps).join(',')}} = deps;\n${code}`)(deps);
  function render(next = props) {
    props = next; let limit = 0;
    do {
      cursor = 0; dirty = false; tree = component(props);
      effects.splice(0).forEach(fn => fn()); assert.ok(++limit < 12, 'effects settle');
    } while (dirty);
    return tree;
  }
  function walk(node) {
    return !node ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
  }
  function text(node) {
    return node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
  }
  const dispose = () => { for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); disposed = true; };
  t.after(dispose); render();
  return {
    render, text: () => text(tree), dispose,
    get lateUpdates() { return lateUpdates; },
    async settle() { for (let n = 0; n < 6; n++) { await tick(); if (dirty) render(); } },
    nodes: () => walk(tree),
    button: label => walk(tree).find(node => node.type === 'button' && text(node) === label),
    input: type => walk(tree).find(node => node.type === 'input' && node.props.type === type),
    alerts: () => walk(tree).filter(node => node.props?.role === 'alert').map(text).join('\n'),
  };
}

test('without real desktop methods controls are disabled and no pretend save is offered', async t => {
  for (const api of [undefined, {}, { speechCacheStatus() { throw Error('must not be called without save'); } }]) {
    const h = await harness(t, { api }); await h.settle();
    assert.match(h.text(), /需要桌面版及真实 IPC/);
    assert.match(h.text(), /默认关闭以保护对话隐私/);
    assert.ok(h.nodes().filter(node => ['button', 'input'].includes(node.type)).every(node => node.props.disabled));
    assert.doesNotMatch(h.text(), /设置已保存/);
  }
});

test('reads actual install root and usage, explains privacy and cleanup limits without a clear button', async t => {
  let reads = 0;
  const h = await harness(t, { api: { speechCacheStatus: async () => { reads++; return state(); }, speechCacheSave: async () => state() } });
  await h.settle();
  assert.equal(reads, 1); assert.match(h.text(), /E:\\CurrentInstall\\speech-cache/);
  assert.match(h.text(), /当前安装的专用缓存目录/); assert.match(h.text(), /2 个，占用 2\.0 KiB/);
  assert.match(h.text(), /不是加密保险箱/); assert.match(h.text(), /不会自动删除已有文件/);
  assert.match(h.text(), /关闭缓存或退出应用后不会按时清理/);
  assert.equal(h.input('checkbox').props.checked, false);
  assert.equal(h.input('number').props.value, '7');
  assert.equal(h.button('保存缓存设置').props.disabled, true);
  assert.equal(h.button('刷新状态').props.disabled, false);
  assert.equal(h.nodes().filter(node => node.type === 'button').length, 2);
  assert.equal(h.nodes().filter(node => node.type === 'input' && node.props.type === 'text').length, 0);
});

test('saving sends only enabled and integer days; success appears only after the actual reply', async t => {
  const saved = deferred(), payloads = [];
  const api = { speechCacheStatus: async () => state(), speechCacheSave: payload => { payloads.push(payload); return saved.promise; } };
  const h = await harness(t, { api }); await h.settle();
  h.input('checkbox').props.onChange({ target: { checked: true } }); h.render();
  h.input('number').props.onChange({ target: { value: '12' } }); h.render();
  assert.equal(h.button('保存缓存设置').props.disabled, false);
  h.button('保存缓存设置').props.onClick(); h.render();
  assert.deepEqual(payloads, [{ enabled: true, retentionDays: 12 }]);
  assert.ok(h.button('正在保存…').props.disabled); assert.doesNotMatch(h.text(), /设置已保存/);
  saved.resolve(state({ enabled: true, retentionDays: 12 })); await h.settle();
  assert.match(h.text(), /音频缓存设置已保存/); assert.match(h.text(), /已确认配置：开启/);
  assert.equal(h.button('保存缓存设置').props.disabled, true);
});

test('invalid retention disables save rather than silently clamping or submitting', async t => {
  let writes = 0;
  const h = await harness(t, { api: { speechCacheStatus: async () => state(), speechCacheSave: async () => { writes++; return state(); } } });
  await h.settle();
  for (const value of ['', '0', '31', '1.5', '1e1', '-1']) {
    h.input('number').props.onChange({ target: { value } }); h.render();
    assert.ok(h.button('保存缓存设置').props.disabled); assert.match(h.alerts(), /1 到 30/);
  }
  assert.equal(writes, 0);
});

test('save rejection, invalid response and disk errors are explicit and never reported as success', async t => {
  for (const save of [async () => { throw Error('磁盘拒绝访问'); }, async () => undefined, async () => state({ enabled: true, error: { code: 'EACCES', message: '缓存目录不可写' } })]) {
    const h = await harness(t, { api: { speechCacheStatus: async () => state(), speechCacheSave: save } }); await h.settle();
    h.input('checkbox').props.onChange({ target: { checked: true } }); h.render();
    h.button('保存缓存设置').props.onClick(); await h.settle();
    assert.match(h.alerts(), /保存失败|保存后缓存不可用/);
    assert.doesNotMatch(h.text(), /设置已保存/);
    assert.equal(h.button('刷新状态').props.disabled, false);
  }
});

test('a valid response that did not apply the requested configuration is not called a successful save', async t => {
  const h = await harness(t, { api: { speechCacheStatus: async () => state(), speechCacheSave: async () => state() } }); await h.settle();
  h.input('checkbox').props.onChange({ target: { checked: true } }); h.render();
  h.button('保存缓存设置').props.onClick(); await h.settle();
  assert.match(h.alerts(), /保存未确认/); assert.doesNotMatch(h.text(), /设置已保存/);
  assert.equal(h.input('checkbox').props.checked, true);
  assert.equal(h.button('保存缓存设置').props.disabled, false);
});

test('failed initial IPC leaves editing locked and offers a genuine retry', async t => {
  let fail = true;
  const api = { speechCacheStatus: async () => { if (fail) throw Error('IPC 不可用'); return state(); }, speechCacheSave: async () => state() };
  const h = await harness(t, { api }); await h.settle();
  assert.match(h.alerts(), /读取状态失败：IPC 不可用/);
  assert.ok(h.input('checkbox').props.disabled); assert.ok(h.button('保存缓存设置').props.disabled);
  fail = false; h.button('刷新状态').props.onClick(); await h.settle();
  assert.equal(h.input('checkbox').props.disabled, false); assert.equal(h.alerts(), '');
});

test('refresh updates genuine usage but does not overwrite unsaved preferences', async t => {
  let reads = 0;
  const h = await harness(t, { api: { speechCacheStatus: async () => state({ files: ++reads }), speechCacheSave: async () => state() } });
  await h.settle();
  h.input('checkbox').props.onChange({ target: { checked: true } }); h.render();
  h.input('number').props.onChange({ target: { value: '9' } }); h.render();
  h.button('刷新状态').props.onClick(); await h.settle();
  assert.match(h.text(), /模块缓存文件：2 个/);
  assert.equal(h.input('checkbox').props.checked, true); assert.equal(h.input('number').props.value, '9');
  assert.equal(h.button('保存缓存设置').props.disabled, false);
});

test('unmount guards initial read and pending save callbacks against late updates', async t => {
  const initial = deferred();
  const loading = await harness(t, { api: { speechCacheStatus: () => initial.promise, speechCacheSave: async () => state() } });
  loading.dispose(); initial.resolve(state()); await tick(); await tick();
  assert.equal(loading.lateUpdates, 0);
  const saving = deferred();
  const h = await harness(t, { api: { speechCacheStatus: async () => state(), speechCacheSave: () => saving.promise } }); await h.settle();
  h.input('checkbox').props.onChange({ target: { checked: true } }); h.render();
  h.button('保存缓存设置').props.onClick(); h.dispose(); saving.reject(Error('late failure')); await tick(); await tick();
  assert.equal(h.lateUpdates, 0);
});

test('changing API invalidates an older install response instead of displaying its directory', async t => {
  const old = deferred();
  const h = await harness(t, { api: { speechCacheStatus: () => old.promise, speechCacheSave: async () => state() } });
  const next = { speechCacheStatus: async () => state({ root: 'F:\\NewInstall\\speech-cache', files: 0 }), speechCacheSave: async () => state() };
  h.render({ api: next }); await h.settle();
  old.resolve(state({ root: 'E:\\OldInstall\\speech-cache', files: 99 })); await h.settle();
  assert.match(h.text(), /F:\\NewInstall\\speech-cache/); assert.doesNotMatch(h.text(), /OldInstall/);
});
