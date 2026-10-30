const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {allowed,imageExtension,fetchAsset,cacheProviderLogos}=require('../scripts/cache-provider-logos.cjs');
const {apiServiceCatalog,officialProviderLink,normalizeApiManagement}=require('../electron/api-management.cjs');
const icon=Buffer.from([0,0,1,0,1,0,16,16,0,0]);

test('official resource cache accepts only bounded bitmap signatures and official HTTPS redirect hosts',async()=>{
 assert.equal(imageExtension(icon),'ico');assert.throws(()=>imageExtension(Buffer.from('<html>not an image</html>')),/拒绝HTML/);
 assert.equal(allowed('https://cdn.example.org/logo.ico',['example.org']),true);assert.equal(allowed('https://example.org.evil.test/logo.ico',['example.org']),false);assert.equal(allowed('https://key:secret@example.org/logo.ico',['example.org']),false);
 let calls=0;await assert.rejects(fetchAsset('https://example.org/favicon.ico',['example.org'],async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://unrelated.test/logo.ico'}});}),/官方域名/);assert.equal(calls,1);
 const result=await fetchAsset('https://example.org/favicon.ico',['example.org'],async()=>new Response(icon));assert.equal(result.extension,'ico');assert.deepEqual(result.bytes,icon);
});

test('cache records only retrieved official icons and marks failures explicitly',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-brand-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const brands={one:{logoSources:['https://one.example/favicon.ico'],assetDomains:['one.example']},two:{logoSources:['https://two.example/favicon.ico'],assetDomains:['two.example']},custom:{logoSources:[],assetDomains:[]}};
 const result=await cacheProviderLogos({outputRoot:root,brands,fetcher:async url=>url.includes('one.example')?new Response(icon):new Response('<html>no icon</html>')});
 assert.equal(result.brands.one.status,'cached');assert.match(result.brands.one.sha256,/^[a-f0-9]{64}$/);assert.equal(result.brands.one.sourceUrl,'https://one.example/favicon.ico');
 assert.equal(result.brands.two.status,'missing');assert.equal(result.brands.custom.status,'not-applicable');assert.deepEqual(await fs.readFile(path.join(root,'one.ico')),icon);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).brands.two.status,'missing');
});

test('provider external links come only from fixed catalogue kinds and missing logos are never called official',()=>{
 const catalog=apiServiceCatalog();
 for(const provider of catalog.providers){for(const name of ['websiteUrl','consoleUrl','docsUrl','tutorialUrl'])if(provider[name])assert.equal(new URL(provider[name]).protocol,'https:');if(provider.logo.status!=='cached')assert.equal(provider.logo.official,false);}
 assert.equal(officialProviderLink('aliyun-asr','website'),'https://www.aliyun.com/');assert.throws(()=>officialProviderLink('aliyun-asr','https://attacker.test'),/未知/);assert.throws(()=>officialProviderLink('custom','console'),/没有/);
});

test('legacy local users retain their local task routes when first saving API management',()=>{
 const local=normalizeApiManagement({}, {chatMode:'local',translationMode:'local',profiles:[],activeProfile:''});
 assert.equal(local.taskRoutes.chat,'builtin-local');assert.equal(local.taskRoutes.proactive,'builtin-local');assert.equal(local.taskRoutes.translation,'builtin-local');assert.equal(local.taskRoutes.asr,'unassigned');assert.equal(local.taskRoutes.vision,'unassigned');
 const explicit=normalizeApiManagement({taskRoutes:{chat:'inherit'}},{chatMode:'local'});assert.equal(explicit.taskRoutes.chat,'inherit');
});
