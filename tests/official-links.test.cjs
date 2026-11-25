const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('official website is the production domain root and is not an API endpoint',()=>{
 const {OFFICIAL_SITE_URL}=require('../electron/official-links.cjs');
 assert.equal(OFFICIAL_SITE_URL,'https://yukino.fqxxzyw.cn/');
 const url=new URL(OFFICIAL_SITE_URL);
 assert.equal(url.pathname,'/');assert.equal(url.search,'');assert.equal(url.hash,'');
 const {DEFAULT_BASE}=require('../electron/account-client.cjs');
 assert.equal(DEFAULT_BASE,'https://yukino.fqxxzyw.cn');
 const accountSource=fs.readFileSync(path.join(__dirname,'../electron/account-client.cjs'),'utf8');
 assert.match(accountSource,/startsWith\('\/api\/v1\/'\)/);
});

test('opening the official site uses the system shell and reports failures clearly',async()=>{
 const {OFFICIAL_SITE_URL,openOfficialSite}=require('../electron/official-links.cjs');
 const seen=[];
 assert.equal(await openOfficialSite({openExternal:async url=>seen.push(url)}),true);
 assert.deepEqual(seen,[OFFICIAL_SITE_URL]);
 await assert.rejects(openOfficialSite({openExternal:async()=>{throw Error('no handler')}}),error=>{
  assert.equal(error.code,'OFFICIAL_SITE_OPEN_FAILED');
  assert.match(error.message,/无法打开系统默认浏览器/);
  assert.match(error.message,/https:\/\/yukino\.fqxxzyw\.cn\//);
  return true;
 });
});

test('main community IPC opens the exact website root',async()=>{
 const {mainHarness}=require('./helpers/main-harness.cjs');
 const {OFFICIAL_SITE_URL}=require('../electron/official-links.cjs');
 const app=await mainHarness({state:{profiles:[],conversations:[]}});
 assert.equal(await app.invoke('community'),true);
 assert.deepEqual(app.opened,[OFFICIAL_SITE_URL]);
});
