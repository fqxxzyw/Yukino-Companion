const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {ResourcePacks}=require('../electron/resource-packs.cjs');
const {SetupService}=require('../electron/setup.cjs');
const {zipBuffer}=require('./helpers/zip-fixture.cjs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t,id,entries,options={}){
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-pack-'));t.after(()=>fs.rm(dataRoot,{recursive:true,force:true}));const archive=zipBuffer(entries),calls=[];
 const catalog={schemaVersion:1,packs:{[id]:{url:'https://example.test/model.zip',bytes:archive.length,sha256:hash(archive),maxUnpackedBytes:1024**2,expectedFiles:options.expectedFiles||2}}};
 const service=new ResourcePacks({dataRoot,catalog,fetcher:async(url,init)=>{calls.push(url);return new Response(archive);},...options});return{dataRoot,service,calls};
}
function chatEntries(overrides={}){const model=Buffer.from('GGUFactual-small-test-fixture');const manifest={file:'model.gguf',bytes:model.length,sha256:hash(model),training:{completed:true},...overrides};return[{name:'trained/manifest.json',data:JSON.stringify(manifest)},{name:'trained/model.gguf',data:model}];}
test('chat installs a verified trained GGUF into userData and reuses it without fetching',async t=>{
 const {service,calls,dataRoot}=await fixture(t,'chat',chatEntries());assert.equal((await service.status('chat')).installed,false);const result=await service.install('chat');assert.equal(result.installed,true);assert.ok(result.root.startsWith(path.join(dataRoot,'resources')));assert.equal((await fs.readFile(path.join(result.root,'model.gguf'))).subarray(0,4).toString(),'GGUF');await service.install('chat');assert.equal(calls.length,1);
});
test('untrusted ZIP path and invalid model digest never publish an installed directory',async t=>{
 for(const entries of [[{name:'../escape',data:'bad'}],chatEntries({sha256:'0'.repeat(64)})]){const {service}=await fixture(t,'chat',entries);await assert.rejects(service.install('chat'));assert.equal((await service.status('chat')).installed,false);assert.equal(service.controller,null);}
});
test('pet archive becomes a catalog of validated local audio paths',async t=>{
 const {service}=await fixture(t,'pet',[{name:'A.ogg',data:'OggSone'},{name:'B.ogg',data:'OggStwo'}]);const result=await service.install('pet');const index=JSON.parse(await fs.readFile(path.join(result.root,'voices.json')));assert.equal(index.count,2);assert.deepEqual(index.files.map(row=>row.file),['A.ogg','B.ogg']);assert.equal(await fs.readFile(path.join(result.root,'voices/A.ogg'),'utf8'),'OggSone');
});
test('resource cancellation reserves no permanent directory and permits a later retry',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve);const {service}=await fixture(t,'chat',chatEntries(),{downloader:async({signal})=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});const operation=service.install('chat');await started;service.cancel();await assert.rejects(operation,/cancelled/);assert.equal(service.controller,null);assert.equal((await service.status('chat')).installed,false);
});
test('unknown existing resource directory is preserved rather than recursively overwritten',async t=>{
 const {service}=await fixture(t,'chat',chatEntries());await fs.mkdir(service.directory('chat'),{recursive:true});const keep=path.join(service.directory('chat'),'personal.txt');await fs.writeFile(keep,'preserve');await assert.rejects(service.install('chat'),/原文件已保留/);assert.equal(await fs.readFile(keep,'utf8'),'preserve');
});
test('pet-only first setup never installs Python and skips inference steps',async()=>{
 const calls=[];let ready=false;const setup=new SetupService({inspect:async()=>({steps:[{id:'runtime',state:'missing'},{id:'chat',state:'missing'},{id:'translation',state:'missing'},{id:'voiceCore',state:'missing'},{id:'voicePreset',state:'missing'},{id:'pet',state:ready?'ready':'missing'}]}),installRuntime:async()=>calls.push('runtime'),refresh:async()=>calls.push('refresh'),installPet:async()=>{calls.push('pet');ready=true;}});const state=await setup.install({features:['pet']});assert.deepEqual(calls,['pet']);assert.equal(state.ready,true);assert.equal(state.steps.find(row=>row.id==='runtime').state,'skipped');
});
