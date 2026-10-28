const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const {finished} = require('node:stream/promises');
const {verifyOfflinePackage, inside, REQUIRED_ASAR, REQUIRED_EXTERNAL, SOVITS_REVISION} = require('../scripts/verify-offline-package.cjs');
const {verifyReleaseAssets, LIMIT} = require('../scripts/verify-release-assets.cjs');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-package-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),resources=path.join(root,'resources');
  async function write(base, name, data) {const file=path.join(base,...name.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);}
  for(const name of REQUIRED_ASAR)await write(source,name,'test runtime');
  for(const name of REQUIRED_EXTERNAL)await write(resources,name,'test external');
  await fs.cp(path.resolve(__dirname,'../characters'),path.join(source,'characters'),{recursive:true});
  await write(source,'package.json',JSON.stringify({version:'0.3.0'}));
  const icon=Buffer.from('89504e470d0a1a0a','hex');await write(source,'dist/yukino-icon.png',icon);
  const artwork=Buffer.from('test artwork');
  await write(source,'electron/companion-view/assets/spritesheet.png',artwork);
  await write(source,'electron/companion-view/assets/provenance.json',JSON.stringify({files:[{path:'assets/spritesheet.png',bytes:artwork.length,sha256:digest(artwork)}]}));
  const model=Buffer.from('GGUF_TEST_ONLY');
  const manifest={id:'test-model',directory:'test-model',modelId:'test-only',files:[{path:'model.gguf',size:model.length,sha256:digest(model)}]};
  await write(source,'translation/model-manifest.json',JSON.stringify(manifest));
  await write(resources,'translation/model-manifest.json',JSON.stringify(manifest));
  await write(resources,'translation-models/test-model/model.gguf',model);
  const variants = {};
  for (const flavor of ['cpu','cu124']) {
    const filename=`Yukino-Runtime-0.4.0-windows-x64-${flavor}.zip.part001`;
    variants[flavor]={id:`windows-x64-${flavor}`,bytes:10,unpackedBytes:20,archiveSha256:'a'.repeat(64),parts:[{path:filename,bytes:10,algorithm:'sha256',digest:'b'.repeat(64),url:`https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-test/${filename}`}]};
  }
  await write(resources,'runtime-catalog.json',JSON.stringify({schemaVersion:1,version:'0.4.0',variants}));
  await write(resources,'local-model/yukino-1.5b-persona-q4/manifest.json',JSON.stringify({name:'test persona',file:'model.gguf',bytes:model.length,sha256:digest(model),training:{fixture:true}}));
  await write(resources,'local-model/yukino-1.5b-persona-q4/model.gguf',model);
  const files=[];
  for(const kind of ['gpt','sovits','reference']) { const data=Buffer.from(kind);await write(resources,`voice-models/${kind}.bin`,data);files.push({kind,path:`${kind}.bin`,bytes:data.length,sha256:digest(data)}); }
  await write(resources,'voice-models/preset.json',JSON.stringify({schemaVersion:1,promptText:'こんにちは。',promptLang:'all_ja',files}));
  const ogg=Buffer.from('OggS fixture');
  await write(source,'electron/companion-view/assets/voices/fixture.ogg',ogg);
  await write(source,'electron/companion-view/assets/voices.json',JSON.stringify({count:1,files:[{file:'fixture.ogg',bytes:ogg.length,sha256:digest(ogg)}]}));
  // asar 3.x returns an ending WriteStream before pending writes are flushed.
  await finished(await asar.createPackage(source,path.join(resources,'app.asar')));
  return {root,source,resources,manifest,write};
}

test('offline package opens real asar and verifies external model/source bytes',async t=>{
  const f=await fixture(t),result=await verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1});
  assert.equal(result.version,'0.3.0');assert.equal(result.runtime,'downloadable-cpu-cu124');assert.equal(result.localModelBytes,14);assert.equal(result.petVoiceCount,1);assert.equal(result.modelBytes,14);
  assert.equal(result.audioSynthesisValidated,false);assert.equal(result.artwork,1);
  await f.write(f.resources,'translation-models/test-model/model.gguf','GGUF_TEST_FAKE');
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1}),/长度|SHA-256/);
});
test('offline package rejects absent icon, mismatched manifests and missing trained weights',async t=>{
  const f=await fixture(t);
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:{...f.manifest,id:'wrong'}}),/清单/);
  await fs.rm(path.join(f.resources,'local-model/yukino-1.5b-persona-q4/model.gguf'));
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1}),/model.gguf/);
  await f.write(f.resources,'local-model/yukino-1.5b-persona-q4/model.gguf','GGUF_TEST_ONLY');
  await fs.rm(path.join(f.source,'dist/yukino-icon.png'));
  const archive=path.join(f.resources,'no-icon.asar');await finished(await asar.createPackage(f.source,archive));
  // asar caches headers by path; use a fresh directory for an independent artifact.
  const noIcon=path.join(f.root,'no-icon');await fs.mkdir(noIcon);await fs.rename(archive,path.join(noIcon,'app.asar'));
  await assert.rejects(verifyOfflinePackage(noIcon,{expectedManifest:f.manifest,expectedPetVoiceCount:1}),/图标|yukino-icon/);
});
test('CPU-only runtime catalogues are accepted while all bundled model and voice checks still run',async t=>{
  const f=await fixture(t),catalogPath=path.join(f.resources,'runtime-catalog.json');
  const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));delete catalog.variants.cu124;
  await fs.writeFile(catalogPath,JSON.stringify(catalog));
  const result=await verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1});
  assert.equal(result.runtime,'downloadable-cpu');assert.deepEqual(result.runtimeVariants,['cpu']);
  assert.equal(result.localModelBytes,14);assert.equal(result.modelBytes,14);assert.equal(result.petVoiceCount,1);
  await f.write(f.resources,'voice-models/reference.bin','broken reference');
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1}),/资源长度|SHA-256/);
});
test('runtime catalogue still requires CPU and rejects unknown or invalid present variants',async t=>{
  const f=await fixture(t),catalogPath=path.join(f.resources,'runtime-catalog.json'),original=JSON.parse(await fs.readFile(catalogPath,'utf8'));
  const cases=[
    [{...original,variants:{cu124:original.variants.cu124}},/CPU/],
    [{...original,variants:{...original.variants,unverified:original.variants.cpu}},/未知类型/],
    [{...original,variants:{cpu:{...original.variants.cpu,archiveSha256:'invalid'}}},/有效分卷/],
    [{...original,variants:{...original.variants,cu124:{...original.variants.cu124,parts:[]}}},/有效分卷/],
    [{...original,variants:{cpu:{...original.variants.cpu,parts:[{...original.variants.cpu.parts[0],digest:'invalid'}]}}},/分卷清单/],
    [{...original,variants:{cpu:{...original.variants.cpu,bytes:11}}},/总长度/],
  ];
  for(const [catalog,expected] of cases){await fs.writeFile(catalogPath,JSON.stringify(catalog));await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest,expectedPetVoiceCount:1}),expected);}
});
test('release checks reject missing, tiny or over-limit installers and write hashes',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-release-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await assert.rejects(verifyReleaseAssets(directory),/未找到/);
  const file=path.join(directory,'Yukino-Setup.exe');await fs.writeFile(file,'MZ');
  await assert.rejects(verifyReleaseAssets(directory),/无效/);
  const handle=await fs.open(file,'r+');await handle.truncate(LIMIT);await handle.close();
  await assert.rejects(verifyReleaseAssets(directory),/2 GiB/);
  await fs.writeFile(file,Buffer.alloc(1024*1024,7));
  await assert.rejects(verifyReleaseAssets(directory),/格式无效/);
  const pe=Buffer.alloc(1024*1024);pe.write('MZ');pe.writeUInt32LE(128,60);pe.write('PE\0\0',128);
  await fs.writeFile(file,pe);
  const result=await verifyReleaseAssets(directory);assert.equal(result[0].bytes,1024*1024);
  assert.match(await fs.readFile(path.join(directory,'SHA256SUMS.txt'),'utf8'),/^[a-f0-9]{64}  Yukino-Setup.exe\n$/);
});
test('manifest resource traversal is rejected before disk access',()=>{
  for(const candidate of ['../secret','a/../../secret','/absolute','a\\b'])assert.throws(()=>inside(os.tmpdir(),candidate),/路径/);
});
