import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/dev-verification');
const report = {checks:[], screenshots:[], rendererErrors:[], externalRequests:[], purpose:'Real Windows browser and Electron development verification; no model/API/audio/camera validation'};
const owned = [], clients = [];
let browser;
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn, label, timeout=30000) {
  const start=Date.now(); let last;
  while(Date.now()-start < timeout) {
    try { const value=await fn(); if(value)return value; } catch(error) {last=error;}
    await pause(100);
  }
  throw Error(`Timed out: ${label}${last ? ': '+last.message : ''}`);
}
function check(name, details) {report.checks.push({name,passed:true,details});console.log('PASS '+name);}
function run(args) {
  const proc=spawn(process.execPath, ['scripts/dev.mjs', ...args, '--port', args.includes('--desktop') ? '5274' : '5273', '--control-stdin'], {cwd:root, env:{...process.env}, stdio:['pipe','pipe','pipe']});
  const item={proc,log:'',pids:[]};owned.push(item);
  for(const stream of [proc.stdout,proc.stderr])stream.on('data', chunk=>{
    const text=chunk.toString();item.log+=text;
    for(const match of text.matchAll(/Electron starting pid=(\d+)/g))item.pids.push(Number(match[1]));
  });
  return item;
}
async function stop(item) {
  if(item.proc.exitCode!==null || item.proc.signalCode!==null)return;
  const done=once(item.proc,'exit');
  item.proc.stdin.end('q\n');
  await Promise.race([done, pause(15000).then(()=>{throw Error('Development command did not stop');})]);
}
async function available(port) {
  try {const response=await fetch(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(700)});return response.ok;}catch{return false;}
}
async function desktopPage() {
  const client=await until(()=>chromium.connectOverCDP('http://127.0.0.1:9334'), 'Electron CDP');
  clients.push(client);
  return until(()=>client.contexts()[0]?.pages().find(page=>page.url().startsWith('http://127.0.0.1:5274/')), 'Electron renderer');
}
async function screenshot(page,name) {
  await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');
}
function observe(page) {
  page.on('pageerror', error=>report.rendererErrors.push(error.message));
  page.on('request', request=>{if(/^https?:/.test(request.url()) && new URL(request.url()).hostname!=='127.0.0.1')report.externalRequests.push(request.url());});
}
async function hotUpdate(page,label) {
  const appFile=path.join(root,'src/main.jsx'),cssFile=path.join(root,'src/dev/preview.css');
  const jsx=await fs.readFile(appFile,'utf8'), css=await fs.readFile(cssFile,'utf8');
  const marker=label+'-'+Date.now();
  await page.getByRole('textbox',{name:'消息',exact:true}).fill(marker);
  await page.evaluate(value=>{window.__devDocumentMarker=value},marker);
  try {
    await fs.writeFile(cssFile,css+'\n.development-notice { border-bottom: 5px solid rgb(220, 70, 90); }\n');
    // Windows display scaling rounds CSS border widths (5px may compute to 4.66667px).
    await page.waitForFunction(()=>{const style=getComputedStyle(document.querySelector('.development-notice'));return parseFloat(style.borderBottomWidth)>4&&style.borderBottomColor==='rgb(220, 70, 90)';});
    assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),marker);
    assert.equal(await page.evaluate(()=>window.__devDocumentMarker),marker);
    check(label+' CSS HMR preserves document and draft');
    const changed = jsx.replace('<h1>与{currentCharacter.name}开始对话</h1>', '<h1>开发热更新实测通过</h1>');
    assert.notEqual(changed, jsx, 'Fast Refresh probe must change the actual Release source');
    await fs.writeFile(appFile,changed);
    await page.getByRole('heading',{name:'开发热更新实测通过'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),marker);
    assert.equal(await page.evaluate(()=>window.__devDocumentMarker),marker);
    check(label+' React Fast Refresh preserves document and draft');
    await screenshot(page,label+'-hmr');
  } finally {
    await fs.writeFile(appFile,jsx);await fs.writeFile(cssFile,css);
  }
  await page.getByRole('heading',{name:'与雪之下雪乃开始对话'}).waitFor();
}

await fs.mkdir(output,{recursive:true});
try {
  assert.equal(await available(5273),false,'Stop existing web preview before qa:dev');
  assert.equal(await available(5274),false,'Stop existing desktop preview before qa:dev');
  const web=run([]);
  await until(()=>available(5273),'web server');
  check('dev:web binds 127.0.0.1:5273');
  // Do not steal keyboard focus from the user's VS Code/chat while probing the web UI.
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:840}});observe(page);
  await page.goto('http://127.0.0.1:5273/');
  await page.getByRole('heading',{name:'与雪之下雪乃开始对话'}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.desktop),'undefined');
  await page.getByText('浏览器 UI 预览 · 无 Electron IPC',{exact:true}).waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();
  await screenshot(page,'web-settings');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await hotUpdate(page,'web');
  await page.getByRole('button',{name:'收起或展开侧边栏',exact:true}).click();
  await page.reload();await page.locator('.app.collapsed').waitFor();
  assert.match(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),/^web-/);
  check('browser refresh restores UI preferences and draft');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'这是界面预览'}).waitFor();
  assert.equal(await page.locator('.message').count(),0);
  check('browser send reports unavailable IPC, never simulates a model response');

  const desktop=run(['--desktop','--inspect-renderer','9334']);
  await until(()=>desktop.log.includes('[dev] Electron ready'),'actual desktop startup');
  let appPage=await desktopPage();observe(appPage);
  await appPage.getByRole('heading',{name:'与雪之下雪乃开始对话'}).waitFor();
  await appPage.waitForFunction(()=>typeof window.desktop?.load==='function');
  // Dismiss first-use prompts without starting downloads, microphone or paid services.
  await pause(900);
  const setup=appPage.locator('.setup-dialog');
  if(await setup.count())await setup.locator('footer .text-link').click();
  await pause(700);
  const skip=appPage.getByRole('button',{name:'稍后再说',exact:true});
  if(await skip.count())await skip.click();
  await until(async()=>await appPage.locator('.voice-chat-wizard').count()===0,'first-use wizard dismissed');
  const dataRoot=path.join(process.env.APPDATA,'yukino-companion-development');
  assert.ok(desktop.log.includes('[development] userData='+dataRoot));
  const data=await fs.readFile(path.join(dataRoot,'state.json'),'utf8');assert.ok(data);
  check('real Electron loads Vite with original preload IPC and isolated userData',dataRoot);
  await screenshot(appPage,'desktop-home');
  await appPage.evaluate(()=>window.desktop.window('minimize'));
  await appPage.getByRole('button',{name:'设置',exact:true}).click();
  await appPage.getByRole('region',{name:'设置',exact:true}).waitFor();
  assert.equal(await appPage.getByRole('dialog',{name:'设置',exact:true}).count(),0);
  assert.equal(await appPage.locator('.workspace > .settings-page').count(),1);
  await screenshot(appPage,'desktop-settings');
  await appPage.locator('.settings-main').getByRole('button',{name:'返回对话',exact:true}).click();
  await hotUpdate(appPage,'desktop');

  const duplicate=run(['--desktop']);
  await until(()=>duplicate.proc.exitCode!==null,'duplicate developer exit');
  assert.notEqual(duplicate.proc.exitCode,0);
  assert.equal(duplicate.pids.length,0);
  assert.match(duplicate.log,/EADDRINUSE|already in use/);
  check('duplicate desktop command fails without spawning another Electron');

  for(const filename of ['electron/main.cjs','electron/preload.cjs']) {
    const file=path.join(root,filename),original=await fs.readFile(file,'utf8');
    const previous=desktop.pids.at(-1),readyBefore=(desktop.log.match(/Electron ready/g)||[]).length;
    try {
      await fs.writeFile(file,original+'\n// Temporary controlled-restart verification.\n');
      await until(()=>(desktop.log.match(/Electron ready/g)||[]).length>readyBefore,'controlled restart '+filename);
      assert.notEqual(desktop.pids.at(-1),previous);
      appPage=await desktopPage();observe(appPage);
      await appPage.evaluate(()=>window.desktop.window('minimize'));
      await appPage.getByRole('heading',{name:'与雪之下雪乃开始对话'}).waitFor();
      assert.equal(await appPage.evaluate(()=>typeof window.desktop.load),'function');
      assert.match(await appPage.getByRole('textbox',{name:'消息',exact:true}).inputValue(),/^desktop-/);
      check(filename+' controlled restart changes PID and preserves IPC/development draft');
    } finally {await fs.writeFile(file,original);}
    const restoredCount=(desktop.log.match(/Electron ready/g)||[]).length;
    await until(()=>(desktop.log.match(/Electron ready/g)||[]).length>restoredCount,'restart after restoring '+filename);
  }
  await stop(desktop);await stop(web);
  await until(async()=>!(await available(5273))&&!(await available(5274)),'released development ports');
  assert.ok(desktop.log.includes('[dev] Stopped; owned processes and Vite released.'));
  assert.ok(!desktop.log.includes('未及时退出'));
  // Process liveness is checked by PID, never by image name (other apps may use Electron).
  for(const pid of desktop.pids)assert.throws(()=>process.kill(pid,0));
  check('graceful stop flushes state, releases ports and all created Electron main PIDs');
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.rendererErrors,[]);
  const forbidden=['runtime','resources','voice-models','speech-runtime'];
  const names=await fs.readdir(dataRoot);
  report.developmentDataEntries=names;
  for(const name of forbidden) {
    const directory=path.join(dataRoot,name);
    const exists=await fs.stat(directory).catch(()=>null);
    if(exists) {
      const all=await fs.readdir(directory,{recursive:true,withFileTypes:true});
      const big=await Promise.all(all.filter(x=>x.isFile()).map(x=>fs.stat(path.join(x.parentPath,x.name))));
      assert.ok(!big.some(stat=>stat.size>1024*1024),'unexpected large inference resource');
    }
  }
  check('no renderer external requests, errors or large inference resources downloaded');
  report.success=true;
} catch(error) {
  report.success=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  const pages=[...(browser?.contexts()||[]),...clients.flatMap(client=>client.contexts())].flatMap(context=>context.pages());
  for(const [index,page] of pages.entries())if(!page.isClosed())await screenshot(page,'failure-'+index).catch(()=>{});
}
finally {
  for(const item of owned) {
    await stop(item).catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
    await fs.writeFile(path.join(output,`process-${item.proc.pid}.log`),item.log);
  }
  // Electron clients can already be disconnected after controlled restarts.
  for(const client of clients)await client.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  report.platform=process.platform;report.node=process.version;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Report: '+path.join(output,'report.json'));
}
