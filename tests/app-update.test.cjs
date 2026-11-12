const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createUpdater,newer,trustedAsset}=require('../electron/app-update.cjs');
test('only newer numeric stable versions and trusted GitHub assets qualify',()=>{assert.equal(newer('v0.5.0','0.4.0'),true);assert.equal(newer('v0.4.0-base.4','0.4.0'),false);assert.equal(newer('v0.4.0','0.4.0'),false);assert.equal(trustedAsset({browser_download_url:'https://evil.example/a',size:2}),false)});
test('download verifies bytes before replacing the chosen file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-update-'));const dest=path.join(dir,'installer.exe');const payload=Buffer.from('test installer');const digest=crypto.createHash('sha256').update(payload).digest('hex');const asset={name:'Yukino-Companion-0.5.0-Base-Setup.exe',size:payload.length,digest:'sha256:'+digest,browser_download_url:'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.5.0/setup.exe'};const oldFetch=global.fetch;let bad=false;
 global.fetch=async url=>url.includes('api.github.com')?new Response(JSON.stringify([{tag_name:'v0.5.0',assets:[asset]}])):new Response(bad?Buffer.from('bad installer!'):payload);
 try{const updater=createUpdater({app:{getVersion:()=> '0.4.0',getPath:()=>dir},dialog:{showSaveDialog:async()=>({filePath:dest})},shell:{showItemInFolder(){}},send(){}});assert.deepEqual(await updater.check(),{version:'v0.5.0',downloadable:true});await updater.download();assert.deepEqual(await fs.readFile(dest),payload);bad=true;await assert.rejects(updater.download());assert.deepEqual(await fs.readFile(dest),payload);assert.deepEqual((await fs.readdir(dir)),['installer.exe'])}finally{global.fetch=oldFetch;await fs.rm(dir,{recursive:true,force:true})}
});

test('newer releases without installer still appear with GitHub as the available route',async()=>{const oldFetch=global.fetch;global.fetch=async()=>new Response(JSON.stringify([{tag_name:'v0.5.0',assets:[]} ]));try{const updater=createUpdater({app:{getVersion:()=> '0.4.0'},dialog:{},shell:{},send(){}});assert.deepEqual(await updater.check(),{version:'v0.5.0',downloadable:false});await assert.rejects(updater.download(),/GitHub/)}finally{global.fetch=oldFetch}});
