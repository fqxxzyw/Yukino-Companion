'use strict';
// These are harness contract/source tests, NOT evidence of GPU execution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {REQUIRED_CASES, validateFixtureResult, isAllowedLocalRequest, captureExitCode, runCapture} = require('../scripts/capture-eight-weight-skinning.cjs');
const root = path.resolve(__dirname, '..');
function exampleResult() {
  return {done: true, passed: true, renderer: 'TEST CONTRACT ONLY — NOT A GPU RESULT', errors: [],
    checks: REQUIRED_CASES.map(name => ({name, passed: true, meanAbsolute: 0, pixelsOver3: 0, max: 0, referenceForegroundPixels: 1000})),
    negativeControl: {passed: true, pixelsOver3: 1000},
    shadowNegativeControls: ['directional-shadow', 'point-shadow'].map(name => ({name, passed: true, pixelsOver3: 100}))};
}
test('skin8 harness accepts a complete comparison contract, not a pass flag alone', () => {
  assert.equal(validateFixtureResult(exampleResult()), true);
  assert.throws(() => validateFixtureResult({done: true, passed: true}), /renderer/);
  for (const mutate of [r=>r.done=false, r=>r.passed=false, r=>r.renderer='', r=>r.errors.push('shader failed'),
    r=>r.checks.pop(), r=>r.checks[1].name=r.checks[0].name, r=>r.checks[0].passed=false,
    r=>r.checks[0].meanAbsolute=NaN, r=>r.checks[0].meanAbsolute=.2,
    r=>r.checks[0].pixelsOver3=64, r=>r.checks[0].referenceForegroundPixels=500,
    r=>r.checks[0].max=Infinity, r=>r.negativeControl.pixelsOver3=500,
    r=>r.shadowNegativeControls.pop(), r=>r.shadowNegativeControls[0].pixelsOver3=25]) {
    const result=exampleResult(); mutate(result); assert.throws(()=>validateFixtureResult(result), /evidence rejected/);
  }
});
test('skin8 request gate allows checkout modules but denies network and out-of-root files', () => {
  assert.equal(isAllowedLocalRequest(pathToFileURL(path.join(root,'tests/eight-weight-skinning-webgl.html')).href), true);
  assert.equal(isAllowedLocalRequest(pathToFileURL(path.join(root,'node_modules/three/build/three.module.js')).href), true);
  for (const url of ['https://example.com/a.js','http://127.0.0.1/a.js','ws://localhost/socket','ftp://example.com/a','not a URL']) {
    assert.equal(isAllowedLocalRequest(url), false, url);
  }
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'skin8-request-gate-'));
  try {const file=path.join(temp,'fixture.txt');fs.writeFileSync(file,'test only');assert.equal(isAllowedLocalRequest(pathToFileURL(file).href),false);}
  finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('skin8 Windows command preserves real renderer evidence and does not weaken Electron security', () => {
  const script=fs.readFileSync(path.join(root,'scripts/capture-eight-weight-skinning.cjs'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/inference-checks.yml'),'utf8');
  assert.equal(pkg.scripts['qa:skin8'],'electron scripts/capture-eight-weight-skinning.cjs --output build/eight-weight-skinning-review');
  assert.match(workflow,/name: Prove eight-weight WebGL[\s\S]*?if: always\(\) && runner\.os == 'Windows'[\s\S]*?run: npm run qa:skin8/);
  assert.match(workflow,/path: \|[\s\S]*?build\/eight-weight-skinning-review/);
  for(const pattern of [/app\.setPath\('userData', temp\)/,/app\.setPath\('sessionData'/,/session\.fromPartition\('skin8-qa-'/,
    /setPermissionCheckHandler\(\(\) => false\)/,/setDisplayMediaRequestHandler/,/callback\(null\)/,
    /contextIsolation: true/,/sandbox: true/,/nodeIntegration: false/,/webSecurity: true/,
    /app\.on\('window-all-closed'/,/finalizeCapture\(/,/watchdog/,/capturePage\(rect\)/,/validateFixtureResult\(result\)/,/window\.eightWeightResult/]) assert.match(script,pattern);
  assert.doesNotMatch(script,/disableHardwareAcceleration|disable-web-security|no-sandbox|desktopCapturer|electron\/main\.cjs/);
});

test('skin8 last-window teardown saves its failed report before process exit', async () => {
  // Fake Electron only exercises lifecycle ordering. No render result or PNG is
  // fabricated: screenshot intentionally fails and report.passed must be false.
  const {EventEmitter}=require('node:events');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'skin8-lifecycle-test-'));
  const output=path.join(temp,'output'),events=[],paths={};
  const app=new EventEmitter();
  app.setPath=(name,value)=>{paths[name]=value;};
  app.commandLine={appendSwitch(){}};app.whenReady=()=>Promise.resolve();
  app.exit=code=>events.push({kind:'exit',code,reportExists:fs.existsSync(path.join(output,'report.json'))});
  const partition=new EventEmitter();
  for(const name of ['setPermissionCheckHandler','setPermissionRequestHandler','setDevicePermissionHandler','setDisplayMediaRequestHandler'])partition[name]=()=>{};
  partition.webRequest={onBeforeRequest(){}};
  partition.clearCache=()=>new Promise(resolve=>setTimeout(()=>{events.push({kind:'cleanup'});resolve();},5));
  partition.clearStorageData=()=>Promise.resolve();
  class FakeWindow {
    constructor(){this.destroyed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};
      this.webContents.executeJavaScript=async source=>source.includes('window.eightWeightResult')?{done:true,passed:false,errors:['intentional test failure']}:undefined;
      this.webContents.capturePage=async()=>{throw Error('intentional test screenshot failure; GPU not run');};}
    loadFile(){return Promise.resolve();}isDestroyed(){return this.destroyed;}
    destroy(){this.destroyed=true;events.push({kind:'destroy'});if(!app.listenerCount('window-all-closed'))app.exit(0);else app.emit('window-all-closed');}
  }
  try {
    await runCapture(['node','capture','--output',output],{app,BrowserWindow:FakeWindow,session:{fromPartition:()=>partition}});
    const report=JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8'));
    assert.equal(report.passed,false);assert.equal(report.webglReadbacksVerified,false);assert.deepEqual(report.screenshots,[]);
    assert.match(report.failure,/intentional test screenshot failure/);
    assert.deepEqual(events.map(event=>event.kind),['destroy','cleanup','exit']);
    assert.deepEqual(events.at(-1),{kind:'exit',code:1,reportExists:true});
    assert.equal(fs.existsSync(paths.userData),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true});if(paths.userData)fs.rmSync(paths.userData,{recursive:true,force:true});}
});

test('skin8 late cleanup failure cannot produce a successful process exit', async () => {
  const {finalizeCapture}=require('../scripts/qa-lifecycle.cjs');
  const report={passed:true,errors:[]};let saved,exitCode;
  await finalizeCapture({report,failed:false,dispose:()=>{},cleanup:async()=>{
    await new Promise(resolve=>setTimeout(resolve,1));report.passed=false;report.errors.push('late renderer failure');
  },save:()=>{saved=structuredClone(report);},exit:code=>{exitCode=captureExitCode(code,report);}});
  assert.equal(saved.passed,false);assert.equal(exitCode,1);
  assert.equal(captureExitCode(0,{passed:true,errors:[]}),0);
  assert.equal(captureExitCode(1,{passed:true,errors:[]}),1);
  assert.equal(captureExitCode(0,{passed:true,errors:['late']}),1);
});
