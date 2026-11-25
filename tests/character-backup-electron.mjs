import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
import {createTestApp} from '../server/test/helpers.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-characters-ui-'));
const api=await createTestApp();
const uploads=[];
let refuseBackup=false;
const backend=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    const bytes=[];
    for await(const chunk of req) bytes.push(chunk);
    const body=bytes.length?JSON.parse(Buffer.concat(bytes).toString('utf8')):undefined;
    if(url.pathname.startsWith('/api/v1/characters/')&&req.method==='PUT') {
      uploads.push(body);
      if(refuseBackup) {res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'offline',message:'测试服务暂不可用。'}}));return;}
    }
    const reply=await api.call(url.pathname,{method:req.method,body,headers:req.headers});
    res.writeHead(reply.status,{'content-type':'application/json'});res.end(JSON.stringify(reply.data));
  }catch(error){res.writeHead(500);res.end(error.message);}
});
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
const vite=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'error'});
await vite.listen();
const email='companion-test@example.com',password='Character-Test-123!';
const nickname='👩‍🚀'+ '星'.repeat(34);
let app,page;
const button=name=>page.getByRole('button',{name,exact:true});
const shot=async name=>page.screenshot({path:path.join(root,'build','account-review',name+'.png')});
async function launch(device){
  const dir=path.join(temp,device),profile=path.join(dir,'yukino-companion-development');
  await fs.mkdir(profile,{recursive:true});
  await fs.writeFile(path.join(profile,'state.json'),JSON.stringify({setupDismissedVersion:'0.4.0-base.1',voiceChatWizard:{version:1,status:'not-configured'},showAvatar:false,presentation:{sceneEnabled:false},reduce:true}));
  const entry=path.join(dir,'main.cjs');
  await fs.writeFile(entry,"require('electron').app.setPath('appData',__dirname);require("+JSON.stringify(path.join(root,'electron/main.cjs'))+");");
  const env={...process.env,YUKINO_DEV_SERVER_URL:`http://127.0.0.1:${vite.httpServer.address().port}/`,
    YUKINO_API_BASE:`http://127.0.0.1:${backend.address().port}`};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[entry],cwd:root,env,timeout:60000});
  page=await app.firstWindow();
  await page.locator('.app').waitFor();
  page.setDefaultTimeout(10000);
}
async function openCharacters(){
  if(!await page.locator('.character-summary-list').isVisible()){
    if(!await page.locator('.settings-nav').isVisible())await page.getByTitle('设置',{exact:true}).first().click();
    if(!await page.locator('.character-summary-list').isVisible())await page.getByRole('button',{name:/角色管理/}).first().click();
  }
}
async function createCharacter(name,persona){
  const toggle=page.locator('.character-create-toggle');
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await page.getByLabel('角色姓名',{exact:true}).fill(name);
  await page.getByPlaceholder('身份、性格与交流风格').fill(persona);
  await button('创建角色').click();
  await page.locator('.character-summary.selected .character-summary-name').getByText(name,{exact:true}).waitFor();
}
async function account(){
  if(await page.locator('.settings-nav').isVisible())await page.getByTitle('返回对话',{exact:true}).first().click();
  await button('账号与进度').click();
  await page.locator('.account-center').waitFor();
}
async function close(){
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=null;}
}
try {
  await fs.mkdir(path.join(root,'build','account-review'),{recursive:true});
  await launch('device-a');
  await openCharacters();
  await createCharacter('访客角色','访客的本地文字。');
  assert.equal(uploads.length,0);
  assert.equal(await button('备份当前角色文字').count(),0);
  await account(); await button('登录或注册').click(); await button('注册').click();
  await page.locator('#account-register-email').fill(email);
  await button('发送验证码').click();
  await page.waitForFunction(()=>document.querySelector('.account-code-row button')?.textContent.includes('重发'));
  await page.locator('#account-code').fill(api.lastCode());
  await page.locator('#account-register-password').fill(password);
  await page.locator('#account-register-confirm').fill(password);
  await button('注册并登录').click();
  await page.locator('.account-gate').waitFor({state:'detached'});
  await account(); await button('修改昵称').click();
  await page.getByRole('textbox',{name:'昵称',exact:true}).fill(nickname); await button('保存昵称').click();
  await page.getByText(nickname,{exact:true}).first().waitFor();
  assert.equal(await page.locator('.account-avatar').first().innerText(),'👩‍🚀');
  await openCharacters();
  assert.equal(await page.getByText('访客角色',{exact:true}).count(),0);
  await createCharacter('海风','在海边收集风的来信。');
  await button('备份当前角色文字').click();
  await page.getByText('角色文字已备份。',{exact:true}).waitFor();
  assert.equal(uploads.length,2);
  assert.deepEqual(uploads[0],{name:'海风',persona:'在海边收集风的来信。'});
  await shot('desktop-character-backup');
  refuseBackup=true;
  await createCharacter('归鸟','离线创建的设定。');
  await page.getByRole('alert').filter({hasText:'角色已保存在本机，云端备份未完成'}).waitFor();
  assert.ok((await page.evaluate(()=>window.desktop.load())).state.characters.some(c=>c.name==='归鸟'));
  await shot('desktop-character-backup-failure');
  refuseBackup=false;
  await close(); await launch('device-b');
  await account(); await button('登录或注册').click();
  await page.locator('#account-email').fill(email); await page.locator('#account-password').fill(password);
  await page.locator('.account-submit[type="submit"]').click(); await page.locator('.account-gate').waitFor({state:'detached'});
  await openCharacters(); assert.equal(await page.getByText('海风',{exact:true}).count(),0);
  await button('恢复本机缺少的角色').click(); await page.getByText('已恢复 1 个角色。',{exact:true}).waitFor();
  await page.getByText('在海边收集风的来信。',{exact:true}).waitFor();
  assert.equal(await page.getByText('归鸟',{exact:true}).count(),0);
  await button('恢复本机缺少的角色').click(); await page.getByText('云端角色均已在本机。',{exact:true}).waitFor();
  await shot('desktop-character-restored');
  console.log('PASS isolated Electron devices: optional registration nickname, grapheme avatar, guest isolation, automatic/manual text backup, offline error, restore once');
} catch(error){
  if(page) console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-2200));
  throw error;
} finally {
  await close(); await vite.close(); backend.closeAllConnections(); await new Promise(resolve=>backend.close(resolve)); api.db.close();
  await fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
