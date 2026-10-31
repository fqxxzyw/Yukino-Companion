const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {configureDevelopment, developmentURL, developmentRendererURL} = require('../electron/development.cjs');

test('unpackaged startup isolates data and Chromium before any ready/lock call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yukino-dev-unit-'));
  try {
    const official = path.join(root, 'Yukino Companion');
    fs.mkdirSync(official);
    fs.writeFileSync(path.join(official, 'state.json'), 'KEEP');
    const calls = [], paths = {appData:root, userData:official};
    const app = {isPackaged:false, getPath:name=>paths[name],
      setPath:(name,value)=>{calls.push(name);paths[name]=value;},
      setName:name=>calls.push(name)};
    const config = configureDevelopment(app, {YUKINO_DEV_SERVER_URL:'http://127.0.0.1:5174/'});
    assert.equal(config.enabled, true);
    assert.equal(paths.userData, path.join(root, 'yukino-companion-development'));
    assert.equal(paths.sessionData, path.join(paths.userData, 'chromium'));
    assert.equal(fs.readFileSync(path.join(official, 'state.json'), 'utf8'), 'KEEP');
    assert.deepEqual(calls.slice(0,2), ['userData', 'sessionData']);
    assert.equal(config.url, 'http://127.0.0.1:5174/');
    assert.equal(configureDevelopment(app, {}).url, null);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('packaged startup ignores development URLs and never touches data paths', () => {
  const app = {isPackaged:true, getPath(){throw Error('must not access');}, setPath(){throw Error('must not modify');}};
  assert.deepEqual(configureDevelopment(app, {YUKINO_DEV_SERVER_URL:'http://evil.example/'}), {enabled:false, url:null});
});

test('development URL rejects remote origins, credentials and non-root paths', () => {
  for (const url of ['https://127.0.0.1:5174/', 'http://localhost:5174/', 'http://example.com:5174/',
    'file:///tmp/index.html', 'http://user:pass@127.0.0.1:5174/', 'http://127.0.0.1:5174/elsewhere',
    'http://127.0.0.1:5174/?token=secret', 'http://127.0.0.1:5174/#fragment']) {
    assert.throws(()=>developmentURL(url));
  }
  assert.equal(developmentURL(''), null);
});

test('secondary renderers allow only known pages on the validated development origin', () => {
  const env = {YUKINO_DEV_SERVER_URL:'http://127.0.0.1:5274/'};
  const app = {isPackaged:false};
  assert.equal(developmentRendererURL(app, 'model-window.html', env), 'http://127.0.0.1:5274/model-window.html');
  assert.equal(developmentRendererURL(app, 'visual-window.html', env), 'http://127.0.0.1:5274/visual-window.html');
  assert.throws(()=>developmentRendererURL(app, '../secret', env));
  assert.throws(()=>developmentRendererURL(app, 'visual-window.html', {YUKINO_DEV_SERVER_URL:'http://evil.example:5274/'}));
  assert.equal(developmentRendererURL({isPackaged:true}, 'visual-window.html', env), null);
  assert.equal(developmentRendererURL(app, 'model-window.html', {}), null);
});

test('main configures isolation before lock/imports and preserves production loadFile and sandbox', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const isolation = main.indexOf("configureDevelopment(app)");
  assert.ok(isolation < main.indexOf("require('./chat.cjs')"));
  assert.ok(isolation < main.indexOf('requestSingleInstanceLock'));
  assert.match(main, /development\.url\) await win\.loadURL\(development\.url\)/);
  assert.match(main, /else await win\.loadFile/);
  assert.match(main, /contextIsolation:true,nodeIntegration:false,sandbox:true/);
});
