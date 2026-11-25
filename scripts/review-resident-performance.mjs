// Run after a production Vite build. The actual desktop main, preload, model
// catalog and presentation UI are used. Each scene gets a fresh guest profile.
// --short exercises the four scene/style combinations for 6.5 seconds each.
// --confirm-toon buffers six minutes of LAWSON gouache inside the renderer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {_electron} from 'playwright-core';
import {attachResidentProbe} from './resident-frame-probe.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const quick = process.argv.includes('--short');
const confirmToon = process.argv.includes('--confirm-toon');
assert.ok(!(confirmToon && quick), 'Choose one of --short or --confirm-toon.');
const now = () => new Date().toISOString();
const date = now().replaceAll(':','-');
const mode = confirmToon ? 'confirm-toon' : quick ? 'short' : 'full';
const output = path.resolve(root, 'build', 'resident-performance', mode + '-' + date);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (file, data) => fs.writeFile(path.join(output, file), JSON.stringify(data,null,2));
const report = {created: now(), mode, scenes: [], errors: [],
  method: 'Callbacks group actual scene/character WebGL draws by rAF timestamp. Display means rAF cadence, not compositor presentation. callbackMs is JS wall time, including animation, submission and possible driver stalls. Sampled GPU timer spans the first draw through callback end on every seventeenth drawing callback where available. Windows working set totals can count shared pages more than once.'};

function summary(values) {
  const sorted = values.toSorted((a,b) => a-b);
  const at = p => {
    if (!sorted.length) return null;
    const i = (sorted.length-1)*p, j = Math.floor(i);
    return +((1-i+j)*sorted[j] + (i-j)*sorted[Math.ceil(i)]).toFixed(3);
  };
  return {n: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1)};
}
function stats(rows) {
  const result = {};
  for (const role of ['display','actor','scene']) {
    const frames = role === 'display' ? rows : rows.filter(row => row[role] > 0);
    const dt = frames.slice(1).map((f,i) => f.t-frames[i].t);
    const series = {count: frames.length, intervalMs: summary(dt)};
    if (role !== 'display') {
      series.callbackMs = summary(frames.map(f => f[role+'Cpu']));
      series.draws = summary(frames.map(f => f[role]));
    }
    result[role] = series;
  }
  return result;
}
function pageState() {
  function canvas(host) {
    const c = host?.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height,visible:r.width>0 && r.height>0 && r.right>0 && r.bottom>0 && r.x<innerWidth && r.y<innerHeight && c.checkVisibility({opacityProperty:true,visibilityProperty:true})};
  }
  const a=document.querySelector('.character-model-host'),b=document.querySelector('.environment-backdrop-canvas');
  return {model:a?.dataset.modelReady,rendered:a?.querySelector('canvas')?.dataset.rendered,scene:b?.dataset.scene,
    style:b?.dataset.renderStyle,sceneReady:b?.dataset.ready,loading:!!b?.dataset.loading,fallback:!!b?.dataset.fallback,
    actorCanvas:canvas(a),sceneCanvas:canvas(b),modal:!!document.querySelector('[role="dialog"],.settings-page,.scene-style-fade'),
    dpr:devicePixelRatio,hidden:document.hidden,focused:document.hasFocus(),viewport:[innerWidth,innerHeight]};
}
function valid(s, scene, style) {
  return s.model==='summer-uniform-v2' && s.rendered==='true' && s.scene===scene && s.style===style &&
    s.actorCanvas?.visible && s.sceneCanvas?.visible && !s.modal && !s.hidden && !s.loading && !s.fallback;
}
async function ready(page, scene, style) {
  const timeout = Date.now()+120000;
  while (Date.now()<timeout) {
    for (const el of [page.locator('.account-skip'),page.locator('.setup-dialog footer .text-link'),page.getByRole('button',{name:'稍后再说',exact:true})]) {
      if(await el.isVisible()) await el.click({timeout:4500});
    }
    const s=await page.evaluate(pageState);
    if(valid(s,scene,style)) return s;
    await delay(750);
  }
  throw Error('Missing unobscured native scene or ready default avatar: '+JSON.stringify(await page.evaluate(pageState)));
}
async function changeStyle(page) {
  await page.getByTitle('设置',{exact:true}).first().click();
  await page.getByRole('button',{name:'外观',exact:true}).click();
  await page.getByRole('switch',{name:'吉卜力水粉场景渲染',exact:true}).check();
  await page.locator('.settings-page').getByRole('button',{name:'返回对话',exact:true}).click();
  await page.locator('.settings-page').waitFor({state:'hidden'});
}
const memory = app => app.evaluate(({app}) => app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingSetKiB:p.memory.workingSetSize,privateKiB:p.memory.privateBytes??null})));
async function segment(app,page,scene,style) {
  const prefix=scene+'-'+style, duration=confirmToon?360000:quick?6500:scene==='city'?900000:120000;
  if(style==='toon' && !confirmToon) await changeStyle(page);
  await ready(page,scene,style);
  await delay(quick?1800:12000);
  const state=await page.evaluate(pageState);
  assert.ok(valid(state,scene,style),'Scene changed during warmup');
  await page.screenshot({path:path.join(output,prefix+'.png')});
  const s={scene,style,state,minutes:[],rss:[],started:now(),durationTargetMs:duration,screenshot:prefix+'.png',
    transport:confirmToon?'Renderer buffers all frames until the stop call.':'Frame data is transferred every 60 seconds.'};
  s.rss.push(await memory(app));
  const all=[], started=Date.now(), end=started+duration;
  console.log('Sampling',prefix,s.started);
  const origin=await page.evaluate(()=>window.yukinoResidentProbe.start());
  if (confirmToon) await delay(duration);
  while(!confirmToon && Date.now()<end) {
    await delay(Math.max(1,Math.min(60000,end-Date.now())));
    const frames=await page.evaluate(()=>window.yukinoResidentProbe.drain());
    const status=await page.evaluate(pageState);
    assert.ok(valid(status,scene,style),'Window, avatar or scene disappeared: '+JSON.stringify(status));
    all.push(...frames);s.minutes.push({elapsedSeconds:(Date.now()-started)/1000,...stats(frames)});
    s.rss.push(await memory(app));
    await save(prefix+'-progress.json',{started:s.started,minutes:s.minutes,rss:s.rss});
  }
  const final=await page.evaluate(()=>window.yukinoResidentProbe.stop());
  for (const frame of final.tail) all.push(frame);
  s.finalState=await page.evaluate(pageState);
  assert.ok(valid(s.finalState,scene,style),'Window, avatar or scene disappeared: '+JSON.stringify(s.finalState));
  s.windowEvents=final.windowEvents;
  s.droppedWindowEvents=final.droppedWindowEvents;
  if (confirmToon) s.rss.push(await memory(app));
  s.startPerformanceMs=origin;s.durationMs=final.time-origin;s.stats=stats(all);s.contexts=final.contexts;
  s.gpuMs=Object.fromEntries(Object.entries(final.gpuSamples).map(([role,ms])=>[role,summary(ms)]));
  for(const role of ['scene','actor','display']) {
    const rows=role==='display'?all:all.filter(r=>r[role]>0);
    assert.ok(rows.length>1,'No actual '+role+' frames');
    s.stats[role].wallFps=+(rows.length*1000/s.durationMs).toFixed(2);
    s.stats[role].firstGapMs=Math.max(0,rows[0].t-origin);
    s.stats[role].lastGapMs=Math.max(0,final.time-rows.at(-1).t);
  }
  s.raw=prefix+'-frames.json.gz';await fs.writeFile(path.join(output,s.raw),gzipSync(JSON.stringify(all)));
  return s;
}
async function measureScene(scene) {
  const tempRoot=await fs.realpath(os.tmpdir());
  const profile=await fs.mkdtemp(path.join(tempRoot,'Yukino-resident-benchmark-'));
  let app;
  try {
    const privateData=path.join(profile,'yukino-companion-development');
    await fs.mkdir(privateData,{recursive:true});
    const prefs={showAvatar:true,reduce:false,profiles:[{id:'default',name:'API',base:'',model:''}],conversations:[],setupDismissedVersion:'0.4.0-base.1',voiceChatWizard:{version:1,status:'not-configured',step:0,evidence:{}},presentation:{scene,sceneEnabled:true,sceneToon:confirmToon,spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}}};
    await fs.writeFile(path.join(privateData,'state.json'),JSON.stringify(prefs));
    const entry=path.join(profile,'bench-entry.cjs');
    await fs.writeFile(entry,"const {app}=require('electron');app.setPath('appData',__dirname);app.setAppPath(process.cwd());require(require('node:path').join(process.cwd(),'electron/main.cjs'));");
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.YUKINO_DEV_SERVER_URL;
    app=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});
    const page=await app.firstWindow({timeout:90000});
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.locator('.app').first().waitFor({state:'attached',timeout:120000});
    await page.addInitScript(attachResidentProbe);
    await page.reload({waitUntil:'domcontentloaded'});
    const native=await app.evaluate(({app,BrowserWindow})=>{
      const w=BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&win.webContents.getURL().endsWith('index.html'));
      if(!w) throw Error('Desktop main window unavailable');
      if(!w.isVisible()) w.showInactive();
      return {pid:process.pid,rendererPid:w.webContents.getOSProcessId(),electron:process.versions.electron,os:process.getSystemVersion(),url:w.webContents.getURL(),userData:app.getPath('userData'),contentSize:w.getContentSize(),visible:w.isVisible(),minimized:w.isMinimized(),backgroundThrottling:w.webContents.getBackgroundThrottling()};
    });
    assert.equal(path.relative(profile,await fs.realpath(native.userData)),'yukino-companion-development');
    const record={scene,native,segments:[]};report.scenes.push(record);
    for(const style of (confirmToon ? ['toon'] : ['lit','toon'])) {record.segments.push(await segment(app,page,scene,style));await save('report.json',report);}
  } finally {
    try {await app?.close();} finally {
      // Only remove the newly allocated, direct child of the resolved OS temp root.
      const actual=await fs.realpath(profile);
      assert.equal(path.relative(tempRoot,actual),path.basename(profile));
      assert.match(path.basename(actual),/^Yukino-resident-benchmark-[\w-]{6}$/);
      await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:200});
    }
  }
}
await fs.access(path.join(root,'dist','index.html'));
await fs.mkdir(output,{recursive:true});
console.log(output);
try {
  for(const scene of (confirmToon ? ['city'] : ['city','classroom'])) await measureScene(scene);
  if(report.errors.length) process.exitCode=1;
} catch(error) {
  report.errors.push(String(error.stack||error));
  console.error(error);process.exitCode=1;
} finally {
  report.finished=now();await save('report.json',report);
}
