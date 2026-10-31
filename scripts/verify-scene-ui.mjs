// Real app + original preload in a disposable profile. Never touches installed data.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'build/scene-ui-review');
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'profile-'));
const entry=path.join(output,'entry.cjs');
await fs.writeFile(entry,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false}});
let application;const report={passed:false,errors:[],screenshots:[],checks:[]};
try{
 await server.listen();const url='http://127.0.0.1:'+server.httpServer.address().port+'/';
 const env={...process.env,YUKINO_DEV_SERVER_URL:url};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});
 const page=await application.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(()=>typeof window.desktop?.load==='function');
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor({timeout:60000});
 const setup=page.locator('.setup-dialog');if(await setup.count())await setup.locator('footer .text-link').click();
 const skip=page.getByRole('button',{name:'稍后再说',exact:true});if(await skip.count())await skip.click();
 await page.waitForFunction(()=>!document.querySelector('.voice-chat-wizard'));
 assert.equal(await page.locator('.chat-scroll .message').count(),0);
 assert.equal(await page.locator('.chat-scroll').innerText(),'');
 assert.equal(await page.locator('.chat-scroll button,.chat-scroll .welcome,.chat-scroll .suggestions').count(),0);
 assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).isEditable(),true);
 report.checks.push('Empty chat has no welcome text or topic options; composer remains editable');
 const ids={city:'街角便利店',school:'雪乃学校',kasai:'葛西临海公园',wedding:'海边婚礼礼堂',forest:'林间小径',bookshop:'街边书店',classroom:'放课后教室'};
 for(const [id,label]of Object.entries(ids)){
  await page.getByRole('button',{name:'场景小菜单',exact:true}).click();
  await page.locator('.scene-menu-popover').getByRole('button',{name:label,exact:true}).click();
  await page.waitForFunction(id=>{const host=document.querySelector('.environment-backdrop-canvas');return host?.dataset.scene===id&&!host.dataset.loading;},id,{timeout:120000});
  await page.waitForTimeout(1800);
  await page.screenshot({path:path.join(output,id+'.png')});report.screenshots.push(id+'.png');
 }
 const actor=await page.locator('.character-panel').boundingBox();
 await page.keyboard.down('Control');await page.mouse.move(700,400);for(let i=0;i<6;i++)await page.mouse.wheel(0,180);await page.waitForTimeout(2200);
 await page.mouse.down();await page.mouse.move(1000,400,{steps:15});await page.mouse.up();
 await page.screenshot({path:path.join(output,'miniature-orbit.png')});report.screenshots.push('miniature-orbit.png');
 assert.deepEqual(await page.locator('.character-panel').boundingBox(),actor,'background inspection must not move or resize Yukino');
 await page.keyboard.up('Control');await page.waitForTimeout(3000);
 report.checks.push('Seven actual app scene selections','Ctrl miniature horizontal orbit preserves original character panel');
 // Rapid input, including a request overtaken during compilation. Record visible frames, not mock renders.
 for(const label of ['街角便利店','雪乃学校','葛西临海公园']){
  await page.getByRole('button',{name:'场景小菜单',exact:true}).click();await page.locator('.scene-menu-popover').getByRole('button',{name:label,exact:true}).click();
  await page.screenshot({path:path.join(output,'switch-'+report.screenshots.length+'.png')});report.screenshots.push('switch-'+report.screenshots.length+'.png');
 }
 await page.waitForFunction(()=>{const h=document.querySelector('.environment-backdrop-canvas');return h?.dataset.scene==='kasai'&&!h.dataset.loading;},null,{timeout:120000});
 report.backend=await page.evaluate(()=>{const canvas=document.querySelector('.environment-backdrop-canvas canvas');const gl=canvas?.getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';});
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{
 await application?.close();await server.close();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
