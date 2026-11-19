// Exercises the real React account gate and account center with a deterministic
// in-memory desktop bridge. No Electron window, network request or real account
// is used. Screenshots are written to build/account-review.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

let fixture = await fs.readFile(new URL('../scripts/ui-capture/preload.cjs', import.meta.url), 'utf8');
fixture = fixture.replace("const {contextBridge} = require('electron');", "const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};");
fixture = fixture.replace("modelId:'',builtin:true", "modelId:'summer-uniform-v2',builtin:true").replace("setupDismissedVersion:''", "setupDismissedVersion:'0.4.0-base.1'");
const accountStart = "let accountState={version:1,onboardingComplete:false,profileId:'guest',mode:'guest',status:'guest',reachable:null,sync:'local',pendingCount:0,credentialsUnavailable:false,profile:null,progress:null,cloudSkins:[],lastError:'',profileRevision:0,checkedInToday:false};\n";
fixture = accountStart + fixture;
const accountBridge = `
  accountState:async()=>({ok:true,state:copy(accountState)}),onAccountState:fn=>on('account-state',fn),onAccountProfile:fn=>on('account-profile',fn),
  accountSkip:async()=>{accountState={...accountState,onboardingComplete:true};emit('account-state',copy(accountState));return {ok:true,state:copy(accountState)}},
  accountLogin:async input=>{
    if(input.password==='wrong password long enough')return {ok:false,error:{code:'invalid_credentials',message:'邮箱或密码不正确。'}};
    if(input.password==='network offline long enough')return {ok:false,error:{code:'network_error',message:'无法连接账号服务，已继续使用本地档案。'}};
    accountState={...accountState,onboardingComplete:true,profileId:'11111111-1111-4111-8111-111111111111',mode:'account',status:'authenticated-online',reachable:true,sync:'synced',pendingCount:0,profile:{id:'11111111-1111-4111-8111-111111111111',email:'us***@example.com',emailHint:'user@example.com',nickname:'雪乃',remember:true},progress:{affection:37,loginDays:3,checkedInToday:true,skins:[{id:'summer-uniform-v2',label:'夏日制服',kind:'base',target:0,current:0,unlocked:true},{id:'winter-uniform-v2',label:'冬季制服',kind:'base',target:0,current:0,unlocked:true},{id:'swimsuit-v2',label:'泳装',kind:'login-days',target:2,current:3,unlocked:true},{id:'twin-tail-v2',label:'双马尾',kind:'login-days',target:3,current:3,unlocked:true},{id:'beret-v2',label:'贝雷帽',kind:'affection',target:45,current:37,unlocked:false}]},cloudSkins:['summer-uniform-v2','winter-uniform-v2','swimsuit-v2','twin-tail-v2']};
    emit('account-state',copy(accountState));emit('account-profile',{profileId:accountState.profileId,revision:1});return {ok:true,state:copy(accountState)};
  },
  accountRegisterRequest:async()=>({ok:true,data:{challengeId:'11111111-1111-4111-8111-111111111111',retryAfter:60,expiresIn:600,delivery:'accepted-by-provider'}}),
  accountRegister:async()=>({ok:false,error:{code:'test',message:'界面验证不创建真实账号。'}}),
  accountForgotRequest:async()=>({ok:true,data:{challengeId:'11111111-1111-4111-8111-111111111111',retryAfter:60,expiresIn:600}}),
  accountForgotVerify:async()=>({ok:true,data:{resetToken:'test-reset-token'}}),accountResetPassword:async()=>({ok:true,data:{ok:true,loginRequired:true}}),
  accountSwitchGuest:async()=>{accountState={...accountState,mode:'guest',activeProfile:'guest',profileId:'guest',status:'guest'};emit('account-state',copy(accountState));emit('account-profile',{profileId:'guest',revision:2});return {ok:true,state:copy(accountState)}},
  accountLogout:async()=>({ok:true,state:{...accountState,mode:'guest',profileId:'guest',status:'guest',remoteRevoked:true}}),
  accountLogoutAll:async()=>({ok:true,state:{...accountState,mode:'guest',profileId:'guest',status:'guest',remoteRevoked:true}}),
  accountSessions:async()=>({ok:true,data:{sessions:[{id:'11111111-1111-4111-8111-111111111111',client:'desktop',deviceLabel:'桌面端',current:true,lastUsedAt:Date.now(),expiresAt:Date.now()+86400000},{id:'22222222-2222-4222-8222-222222222222',client:'web',deviceLabel:'网页端',current:false,lastUsedAt:Date.now()-3600000,expiresAt:Date.now()+86400000}]}}),
  accountRevokeSession:async()=>({ok:true,data:{ok:true}}),accountChangePassword:async()=>({ok:true,state:copy(accountState)}),
  accountCheckin:async()=>({ok:true,state:{...accountState,progress:{...accountState.progress,affection:39,checkedInToday:true}}}),accountSync:async()=>({ok:true,state:copy(accountState)}),accountRefresh:async()=>({ok:true,state:copy(accountState)}),
  accountEvent:async()=>{if(accountState.mode==='account')accountState={...accountState,pendingCount:(accountState.pendingCount||0)+1};emit('account-state',copy(accountState));return {ok:true,state:copy(accountState)}},accountOpenWeb:async()=>({ok:true,data:true}),
  accountMemorySettings:async()=>({ok:true,data:{settings:{syncMemory:true,syncChat:true,updatedAt:Date.now()}}}),
  accountSetMemorySettings:async input=>({ok:true,data:{settings:{syncMemory:input.syncMemory===true,syncChat:input.syncChat===true,updatedAt:Date.now()}}}),
  accountMemoryList:async()=>({ok:true,data:{memories:[{characterId:'yukino',characters:9,version:2,updatedAt:Date.now()}]}}),
  accountMemoryGet:async id=>({ok:true,data:{characterId:id,memory:{text:'云端记忆：喜欢蓝色',version:2,updatedAt:Date.now(),deleted:false}}}),
  accountMemorySave:async input=>({ok:true,data:{characterId:input.id,memory:{text:input.text,version:(Number(input.baseVersion)||0)+1,updatedAt:Date.now(),deleted:false}}}),
  accountMemoryDelete:async id=>({ok:true,data:{ok:true,characterId:id,deleted:true}}),
  accountCloudChat:async()=>({ok:true,data:{characterId:'yukino',messages:[{id:'cloud-m1',conversationId:'conv-1',role:'user',text:'你好，这是云端文字。',createdAt:Date.now()}],nextBefore:null}}),
  accountPushCloudChat:async input=>({ok:true,data:{ok:true,accepted:(input.messages||[]).map(message=>message.id)}}),
  accountDeleteCloudChat:async()=>({ok:true,data:{ok:true,deleted:true}}),
  qaSetAccount:async value=>{accountState={...accountState,...copy(value)};emit('account-state',copy(accountState));return copy(accountState)},
`;
fixture = fixture.replace("contextBridge.exposeInMainWorld('desktop',{", `contextBridge.exposeInMainWorld('desktop',{${accountBridge}`);

const server = await createServer({server: {host: '127.0.0.1', port: 0, watch: {ignored: ['**/*']}}, logLevel: 'silent'});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 920}, reducedMotion: 'reduce'});
  await context.addInitScript({content: fixture});
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.locator('.app').waitFor({state: 'attached', timeout: 30000});
  await page.locator('.account-gate').waitFor({state: 'visible', timeout: 15000});
  await fs.mkdir(new URL('../build/account-review/', import.meta.url), {recursive: true});
  await page.screenshot({path: 'build/account-review/desktop-account-gate.png'});

  // Skipping is always visible and returns to the untouched guest app.
  await page.getByRole('button', {name: '暂不登录，本地使用'}).click();
  await page.locator('.account-gate').waitFor({state: 'detached', timeout: 10000});
  assert.equal(await page.locator('.account-gate').count(), 0);
  await page.screenshot({path: 'build/account-review/desktop-guest-app.png'});

  // Guest account center: both profile choice and the no-merge explanation.
  await page.getByRole('button', {name: '账号与进度'}).click();
  await page.locator('.account-center').waitFor({state: 'visible', timeout: 10000});
  assert.match(await page.locator('.account-hero').innerText(), /游客模式/);
  await page.screenshot({path: 'build/account-review/desktop-account-guest.png'});

  // Open the login gate from the account center and show a real inline error.
  await page.getByRole('button', {name: '登录或注册'}).click();
  await page.locator('.account-gate').waitFor({state: 'visible', timeout: 10000});
  await page.fill('#account-email', 'user@example.com');
  await page.fill('#account-password', 'wrong password long enough');
  await page.locator('.account-submit[type="submit"]').click();
  await page.locator('.account-error').waitFor({state: 'visible', timeout: 10000});
  assert.match(await page.locator('.account-error').innerText(), /邮箱或密码不正确/);

  // Network failure keeps the skip entry available.
  await page.fill('#account-password', 'network offline long enough');
  await page.locator('.account-submit[type="submit"]').click();
  await page.waitForFunction(() => /无法连接账号服务/.test(document.querySelector('.account-error')?.textContent || ''), null, {timeout: 10000});
  assert.equal(await page.getByRole('button', {name: '暂不登录，本地使用'}).isVisible(), true);

  // Successful login switches state and reveals the account center.
  await page.fill('#account-password', 'correct horse battery staple 123');
  await page.locator('.account-submit[type="submit"]').click();
  await page.locator('.account-gate').waitFor({state: 'detached', timeout: 10000});
  await page.getByRole('button', {name: '账号与进度'}).click();
  await page.locator('.account-center').waitFor({state: 'visible', timeout: 10000});
  await page.screenshot({path: 'build/account-review/desktop-account-center.png'});
  const accountText = await page.locator('.account-center').innerText();
  assert.match(accountText, /us\*\*\*@example.com/);
  assert.match(accountText, /已确认好感度/);
  assert.match(accountText, /网页端/);
  assert.match(accountText, /夏日制服/);
  assert.match(accountText, /好感度 37 \/ 45/);
  assert.equal(await page.locator('.account-outfit-card').count(), 9);
  await page.setViewportSize({width: 820, height: 920});
  await page.locator('.settings-body').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({path: 'build/account-review/desktop-account-820.png'});
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('.settings-body').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({path: 'build/account-review/desktop-account-390.png'});
  await page.locator('.settings-body').evaluate(el => { el.scrollTop = 620; });
  await page.screenshot({path: 'build/account-review/desktop-account-outfits.png'});
  await page.locator('.settings-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({path: 'build/account-review/desktop-account-security.png'});
  // Password fields can each reveal their own value, and the visible rule is the
  // same six-character/four-class rule enforced by the Worker.
  await page.locator('#account-current-password').fill('Old-Password-123!');
  await page.locator('#account-new-password').fill('New-Password-123!');
  await page.locator('#account-new-password + .account-eye, .account-input-wrap:has(#account-new-password) .account-eye').click();
  assert.equal(await page.locator('#account-new-password').getAttribute('type'), 'text');
  assert.match(await page.locator('#account-new-password').locator('xpath=..').locator('xpath=..').innerText(), /至少 6 个字符/);

  // The cloud-memory panel renders only with a deterministic bridge; restore
  // writes into the same local memory field that is sent to the model.
  await page.keyboard.press('Escape');
  await page.locator('.account-center').waitFor({state: 'detached', timeout: 10000});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.getByTitle('设置').first().click();
  await page.getByRole('button', {name: '个人记忆'}).click();
  const cloudPanel = page.locator('.cloud-memory-panel');
  await cloudPanel.waitFor({state: 'visible', timeout: 10000});
  assert.match(await cloudPanel.innerText(), /云端长期记忆/);
  assert.match(await cloudPanel.innerText(), /文字记忆同步已开启/);
  await cloudPanel.locator('.cloud-memory-preview summary').first().click();
  assert.match(await cloudPanel.innerText(), /云端记忆：喜欢蓝色/);
  await cloudPanel.getByRole('button', {name: '从云端恢复'}).click();
  assert.equal(await page.locator('.settings-page-content textarea').first().inputValue(), '云端记忆：喜欢蓝色');
  await cloudPanel.getByRole('button', {name: '上传当前记忆'}).click();
  await page.getByText('当前文字记忆已同步到云端。').first().waitFor({state: 'visible', timeout: 10000});
  await cloudPanel.getByRole('button', {name: '查看云端对话'}).click();
  await page.getByText('你好，这是云端文字。').waitFor({state: 'visible', timeout: 10000});
  await page.screenshot({path: 'build/account-review/desktop-cloud-memory.png'});

  assert.deepEqual(errors, []);
  console.log('PASS account gate, skip, offline error, auto-login, account center, session list');
} finally {
  await browser?.close();
  await server.close();
}
