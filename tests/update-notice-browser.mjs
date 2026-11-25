import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

// Exercise the renderer with controlled IPC responses, including an in-flight
// transfer. Installer integrity and NSIS are tested separately in the main process.
const harness = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import UpdateNotice from '../../src/ui/UpdateNotice.jsx';
  let release=null, progress, finish;
  window.calls={checks:0,installs:0};
  const api={
    appUpdateCheck:async()=>{window.calls.checks++;return release},
    onAppUpdateProgress:fn=>{progress=fn;return ()=>{}},
    appUpdateDownload:()=>new Promise(resolve=>{finish=resolve}),
    appUpdateCancel:async()=>finish({cancelled:true}),
    appUpdateInstall:async()=>{window.calls.installs++;return {installing:true}},
    appUpdateOpen:async()=>{}
  };
  window.fixture={set:value=>{release=value}, progress:value=>progress(value), finish:value=>finish(value)};
  createRoot(document.querySelector('#root')).render(React.createElement(UpdateNotice,{api}));
`;

await mkdir('build',{recursive:true});
const directory=await mkdtemp(path.resolve('build','update-ui-'));
await writeFile(path.join(directory,'index.html'),'<div id="root"></div><script type="module" src="/harness.jsx"></script>');
await writeFile(path.join(directory,'harness.jsx'),harness);
const vite=await createServer({root:directory,configFile:false,cacheDir:path.join(directory,'cache'),logLevel:'error',
  optimizeDeps:{include:['react','react-dom/client','lucide-react']},
  server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve('.')]}}});
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  const page=await browser.newPage();
  page.on('pageerror', error=>console.error(error.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const visible=async text=>page.getByText(text,{exact:true}).first().waitFor({state:'visible'});
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/`);
  await page.waitForFunction(()=>window.calls?.checks===1);
  assert.equal(await page.getByRole('dialog').count(),0);
  await button('应用更新').click();
  await visible('当前没有可用的正式版更新');
  const installed={releaseNotes:'- 衣橱：增加春季外套\n- 稳定性：修复启动时的异常 <script>',version:'v0.4.4',downloadable:true,fullSize:1048576,portable:false};
  await page.evaluate(v=>window.fixture.set(v),installed);
  await button('检查更新').click();
  await visible('发现新版本 v0.4.4');
  const notes=page.getByRole('region',{name:'更新内容'});
  assert.deepEqual(await notes.locator('b').allTextContents(),['衣橱','稳定性']);
  assert.equal(await notes.locator('script').count(),0);
  assert.match(await notes.innerText(),/异常 <script>/);
  await button('下载更新').click();
  await page.evaluate(()=>window.fixture.progress({bytes:512,total:2048,differential:true,percent:25}));
  await visible('变化部分'); await visible('512 B / 2.0 KiB'); await visible('25%');
  await page.evaluate(()=>window.fixture.progress({bytes:0,total:1048576,differential:false,percent:0}));
  await visible('完整安装包'); await visible('0 B / 1.0 MiB');
  await button('取消下载').click(); await visible('已取消下载，可以重新下载。');
  await button('下载更新').click();
  await page.evaluate(()=>window.fixture.finish({ready:true,bytes:1048576,total:1048576,differential:false}));
  await visible('更新已下载，重启完成更新');
  await button('稍后').click(); assert.equal(await page.getByRole('dialog').count(),0);
  await button('更新已下载').click(); assert.equal(await page.evaluate(()=>window.calls.installs),0);
  await button('重启并安装').click();
  await page.waitForFunction(()=>window.calls.installs===1);
  await page.reload();
  await button('应用更新').click();
  await page.evaluate(v=>window.fixture.set({...v,portable:true}),installed);
  await button('检查更新').click(); await button('保存完整安装包').click();
  await page.evaluate(()=>window.fixture.finish({saved:true,portable:true}));
  await visible('完整安装包已保存。请关闭当前程序，再手动运行已保存的安装包。');
  assert.equal(await button('重启并安装').count(),0);
  await page.reload();
  await button('应用更新').waitFor();
  await page.evaluate(v=>window.fixture.set(v),installed);
  await page.getByRole('dialog',{name:'应用更新'}).waitFor();
  await visible('发现新版本 v0.4.4');
  await button('稍后').click();
  assert.equal(await page.getByRole('dialog').count(),0);
  console.log('PASS update UI: no update, version, transfer modes, progress, cancellation, defer/install, portable save');
} finally {await browser?.close();await vite.close();await rm(directory,{recursive:true,force:true})}
