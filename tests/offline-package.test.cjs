const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
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
  const engine=Buffer.from('test engine source');
  await write(resources,'inference-engine/GPT_SoVITS/TTS_infer_pack/TTS.py',engine);
  await write(resources,'inference-engine/yukino-runtime.json',JSON.stringify({revision:SOVITS_REVISION,files:[{path:'GPT_SoVITS/TTS_infer_pack/TTS.py',bytes:engine.length,sha256:digest(engine)}]}));
  await write(resources,'python-runtime/yukino-runtime-build.json',JSON.stringify({flavor:'cpu',revision:SOVITS_REVISION,translationRuntime:'llama-cpp-python-0.3.36',inputFingerprint:'a'.repeat(64)}));
  await write(resources,'python-runtime/python312._pth','python312.zip\n.\nLib/site-packages\nimport site\n');
  await asar.createPackage(source,path.join(resources,'app.asar'));
  return {root,source,resources,manifest,write};
}

test('offline package opens real asar and verifies external model/source bytes',async t=>{
  const f=await fixture(t),result=await verifyOfflinePackage(f.resources,{expectedManifest:f.manifest});
  assert.equal(result.version,'0.3.0');assert.equal(result.runtime,'cpu');assert.equal(result.modelBytes,14);
  assert.equal(result.audioSynthesisValidated,false);assert.equal(result.artwork,1);
  await f.write(f.resources,'translation-models/test-model/model.gguf','GGUF_TEST_FAKE');
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest}),/长度|SHA-256/);
});
test('offline package rejects absent icon, mismatched manifests and missing Python',async t=>{
  const f=await fixture(t);
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:{...f.manifest,id:'wrong'}}),/清单/);
  await fs.rm(path.join(f.resources,'python-runtime/python.exe'));
  await assert.rejects(verifyOfflinePackage(f.resources,{expectedManifest:f.manifest}),/python.exe/);
  await f.write(f.resources,'python-runtime/python.exe','MZ');
  await fs.rm(path.join(f.source,'dist/yukino-icon.png'));
  const archive=path.join(f.resources,'no-icon.asar');await asar.createPackage(f.source,archive);
  // asar caches headers by path; use a fresh directory for an independent artifact.
  const noIcon=path.join(f.root,'no-icon');await fs.mkdir(noIcon);await fs.rename(archive,path.join(noIcon,'app.asar'));
  await assert.rejects(verifyOfflinePackage(noIcon,{expectedManifest:f.manifest}),/图标|yukino-icon/);
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
