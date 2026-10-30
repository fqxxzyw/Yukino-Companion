const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar');
const {finished}=require('node:stream/promises');
const {verifyBundledProviderLogos}=require('../scripts/build-base-app.cjs');
const brands=require('../resources/api-brands.json').brands;
test('packaging verifies retrieved official logo bytes and keeps unavailable brands explicit',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'provider-logo-package-'));
 try{
  const files=path.join(root,'files'),icons=path.join(files,'dist/provider-logos');await fs.mkdir(icons,{recursive:true});
  // Complete, decodable 32px PNG fixture; not a vendor image or a claimed fetch.
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMJqQh050hxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAceuqqMaswf6TMAAAAASUVORK5CYII=','base64');
  const manifest={version:1,brands:Object.fromEntries(Object.entries(brands).map(([id,brand])=>[id,{status:brand.logoSources.length?'missing':'not-applicable'}]))};
  manifest.brands.openai={status:'cached',file:'openai.png',sourceUrl:'https://developers.openai.com/favicon.png',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  await fs.writeFile(path.join(icons,'openai.png'),bytes);
  const pack=async name=>{await fs.writeFile(path.join(icons,'manifest.json'),JSON.stringify(manifest));const archive=path.join(root,name);const output=await asar.createPackage(files,archive);await finished(output);assert.equal(output.writableFinished,true);return archive};
  // createPackage resolves with a stream before its final buffered writes finish.
 const good=await pack('good.asar');assert.deepEqual(asar.extractFile(good,path.join('dist','provider-logos','openai.png')),bytes);
 const report=verifyBundledProviderLogos(good);assert.deepEqual(report.cached,['openai']);assert.ok(report.missing.includes('aliyun'));assert.equal(report.displayVerified,false);
  const altered=Buffer.from(bytes);altered[altered.length-1]^=1;await fs.writeFile(path.join(icons,'openai.png'),altered);const changed=await pack('changed.asar');assert.throws(()=>verifyBundledProviderLogos(changed),/Provider logo integrity/);
  await fs.writeFile(path.join(icons,'openai.png'),bytes);manifest.brands.openai.sourceUrl='https://logo-service.invalid/openai.ico';const foreign=await pack('foreign.asar');assert.throws(()=>verifyBundledProviderLogos(foreign),/official provider logo/);
  manifest.brands.openai.sourceUrl='https://developers.openai.com/favicon.png';delete manifest.brands.aliyun;const omitted=await pack('omitted.asar');assert.throws(()=>verifyBundledProviderLogos(omitted),/Missing provider logo outcome/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
