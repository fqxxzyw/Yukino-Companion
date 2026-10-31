const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createSceneLocationPermission}=require('../electron/scene-location-permission.cjs');
const make=async({url='http://127.0.0.1:5174/',answer=true}={})=>{
 let current=url,prompts=0;const contents={getURL:()=>current},win={isDestroyed:()=>false,webContents:contents};
 const permission=createSceneLocationPermission({getWindow:()=>win,trustedURL:url,confirm:async()=>{prompts++;return answer}});
 return {contents,win,permission,get prompts(){return prompts},navigate:url=>{current=url},request:(details={},who=contents,kind='geolocation')=>new Promise(resolve=>permission.request(who,kind,resolve,details))};
};
test('location requires separate consent for only the trusted main frame; no microphone/camera grant',async()=>{
 for(const url of ['http://127.0.0.1:5174/','file:///E:/JAVA/yukino-companion/dist/index.html']){
  const h=await make({url});assert.equal(h.permission.check(h.contents,'geolocation'),false);
  for(const details of [{isMainFrame:false},{requestingUrl:'https://example.com/'},{requestingUrl:url+'other'}])assert.equal(await h.request(details),false);
  assert.equal(await h.request({}, {getURL:()=>url}),false);assert.equal(await h.request({},h.contents,'media'),false);assert.equal(h.prompts,0);
  assert.deepEqual(await Promise.all([h.request(),h.request()]),[true,true]);assert.equal(h.prompts,1);
  assert.equal(h.permission.check(h.contents,'geolocation'),true);assert.equal(h.permission.check(h.contents,'media'),false);
  h.navigate('https://example.com/');assert.equal(h.permission.check(h.contents,'geolocation'),false);assert.equal(await h.request(),false);
 }
});
test('native rejection, dialog failure and post-prompt navigation never grant location',async()=>{
 const h=await make({answer:false});assert.equal(await h.request(),false);assert.equal(h.permission.check(h.contents,'geolocation'),false);
 for(const confirm of [async()=>{throw Error('unavailable')},async()=>{h.navigate('https://example.com/');return true}]){
  h.navigate('http://127.0.0.1:5174/');const p=createSceneLocationPermission({getWindow:()=>h.win,trustedURL:h.contents.getURL(),confirm});
  assert.equal(await new Promise(resolve=>p.request(h.contents,'geolocation',resolve)),false);
 }
});
test('weather CSP admits only its fixed HTTPS provider and preserves independent microphone permission gate',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),main=fs.readFileSync(require('node:path').join(__dirname,'../electron/main.cjs'),'utf8');
 assert.match(html,/connect-src[^;]*https:\/\/api\.open-meteo\.com;/);assert.doesNotMatch(html,/connect-src[^;]*(?:https:\*|https:;)/);
 assert.match(main,/permission==='geolocation'\)sceneLocation\.request/);assert.match(main,/else callback\(canUseMicrophone/);assert.match(main,/Date\.now\(\)<microphoneAllowedUntil/);
});
