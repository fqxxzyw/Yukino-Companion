// Exercises the real React account gate and account center with a deterministic
// in-memory desktop bridge. No Electron window, network request or real account
// is used. Screenshots are written to build/account-review.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

let fixture = await fs.readFile(new URL('../scripts/ui-capture/preload.cjs', import.meta.url), 'utf8');
fixture = fixture.replace("const {contextBridge} = require('electron');", "const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};");
fixture = fixture.replace("modelId:'',builtin:true", "modelId:'yukino-07-v1',builtin:true").replace("setupDismissedVersion:''", "setupDismissedVersion:'0.4.0-base.1'");
const accountStart = "let accountState={version:1,onboardingComplete:false,profileId:'guest',mode:'guest',status:'guest',reachable:null,sync:'local',pendingCount:0,credentialsUnavailable:false,profile:null,progress:null,cloudSkins:[],lastError:'',profileRevision:0,checkedInToday:false};\n";
fixture = accountStart + fixture;
const accountBridge = `
  accountState:async()=>({ok:true,state:copy(accountState)}),onAccountState:fn=>on('account-state',fn),onAccountProfile:fn=>on('account-profile',fn),
  accountSkip:async()=>{accountState={...accountState,onboardingComplete:true};emit('account-state',copy(accountState));return {ok:true,state:copy(accountState)}},
  accountLogin:async input=>{
    if(input.password==='wrong password long enough')return {ok:false,error:{code:'invalid_credentials',message:'邮箱或密码不正确。'}};
    if(input.password==='network offline long enough')return {ok:false,error:{code:'network_error',message:'无法连接账号服务，已继续使用本地档案。'}};
    accountState={...accountState,onboardingComplete:true,profileId:'11111111-1111-4111-8111-111111111111',mode:'account',status:'authenticated-online',reachable:true,sync:'synced',pendingCount:0,profile:{id:'11111111-1111-4111-8111-111111111111',email:'us***@example.com',emailHint:'user@example.com',remember:true},progress:{affection:37,loginDays:3,checkedInToday:true,skins:[{id:'yukino-02-v1',kind:'affection',target:40,current:37,unlocked:false},{id:'yukino-07-v1',kind:'base',target:0,current:0,unlocked:true}]},cloudSkins:['yukino-07-v1']};
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
  await page.waitForFunction(() => /us\*\*\*@example.com/.test(document.body.innerText), null, {timeout: 10000});
  await page.getByRole('button', {name: '账号与进度'}).click();
  await page.locator('.account-center').waitFor({state: 'visible', timeout: 10000});
  await page.screenshot({path: 'build/account-review/desktop-account-center.png'});
  assert.match(await page.locator('.account-center').innerText(), /已确认好感度/);
  assert.match(await page.locator('.account-center').innerText(), /网页端/);

  assert.deepEqual(errors, []);
  console.log('PASS account gate, skip, offline error, auto-login, account center, session list');
} finally {
  await browser?.close();
  await server.close();
}
