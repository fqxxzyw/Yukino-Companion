const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar');
const {verifyBundledProviderLogos}=require('../scripts/build-base-app.cjs');
const brands=require('../resources/api-brands.json').brands;
test('packaging verifies retrieved official logo bytes and keeps unavailable brands explicit',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'provider-logo-package-'));
 try{
  const files=path.join(root,'files'),icons=path.join(files,'dist/provider-logos');await fs.mkdir(icons,{recursive:true});
  const bytes=Buffer.from([0,0,1,0,1,0,16,16,0,0]);
  const manifest={version:1,brands:Object.fromEntries(Object.entries(brands).map(([id,brand])=>[id,{status:brand.logoSources.length?'missing':'not-applicable'}]))};
  manifest.brands.openai={status:'cached',file:'openai.ico',sourceUrl:'https://openai.com/favicon.ico',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  await fs.writeFile(path.join(icons,'openai.ico'),bytes);
  const pack=async name=>{await fs.writeFile(path.join(icons,'manifest.json'),JSON.stringify(manifest));const archive=path.join(root,name);await asar.createPackage(files,archive);return archive};
  const report=verifyBundledProviderLogos(await pack('good.asar'));assert.deepEqual(report.cached,['openai']);assert.ok(report.missing.includes('aliyun'));assert.equal(report.displayVerified,false);
  await fs.writeFile(path.join(icons,'openai.ico'),Buffer.from([0,0,1,0,1,0,32,32,0,0]));const changed=await pack('changed.asar');assert.throws(()=>verifyBundledProviderLogos(changed),/Provider logo integrity/);
  await fs.writeFile(path.join(icons,'openai.ico'),bytes);manifest.brands.openai.sourceUrl='https://logo-service.invalid/openai.ico';const foreign=await pack('foreign.asar');assert.throws(()=>verifyBundledProviderLogos(foreign),/official provider logo/);
  manifest.brands.openai.sourceUrl='https://openai.com/favicon.ico';delete manifest.brands.aliyun;const omitted=await pack('omitted.asar');assert.throws(()=>verifyBundledProviderLogos(omitted),/Missing provider logo outcome/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
