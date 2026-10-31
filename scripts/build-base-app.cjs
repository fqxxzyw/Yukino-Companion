'use strict';
// Base includes approved character art. LLM/TTS weights and environments stay opt-in downloads.
const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),asar=require('@electron/asar');
// Expanded Electron + all 17 approved variants is about 628 MiB on Electron 45.
// This is a disk-footprint budget, separate from the installer's 512 MiB cap.
const MAX_UNPACKED_BYTES=768*1024**2;
function validateUnpackedBudget(bytes){
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_UNPACKED_BYTES)throw Error(`Base application exceeds its 768 MiB unpacked budget or has an invalid size: ${bytes}`);
}
async function readExact(handle,length,position){
  const buffer=Buffer.alloc(length);let done=0;
  while(done<length){const {bytesRead}=await handle.read(buffer,done,length-done,position+done);if(!Number.isInteger(bytesRead)||bytesRead<1||bytesRead>length-done)throw Error('Truncated Windows executable header');done+=bytesRead;}
  return buffer;
}
async function verifyWindowsExecutable(filename){
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.size<64)throw Error('Expected a regular complete AMD64 Windows executable');
  const handle=await fs.open(filename,'r');
  try{
    const dos=await readExact(handle,64,0);
    const offset=dos.readUInt32LE(60);
    if(dos.toString('ascii',0,2)!=='MZ'||offset<64||offset>stat.size-24)throw Error('Invalid AMD64 PE header');
    const coff=await readExact(handle,24,offset);
    const sections=coff.readUInt16LE(6),optionalSize=coff.readUInt16LE(20),characteristics=coff.readUInt16LE(22);
    if(coff.toString('ascii',0,4)!=='PE\0\0'||coff.readUInt16LE(4)!==0x8664||sections<1||sections>96||optionalSize<112||!(characteristics&2)||(characteristics&0x2000)||offset+24+optionalSize+sections*40>stat.size)throw Error('Invalid AMD64 PE header');
    const headers=await readExact(handle,optionalSize+sections*40,offset+24);
    if(headers.readUInt16LE(0)!==0x20b)throw Error('Expected PE32+ executable');
    for(let i=0;i<sections;i++){const section=optionalSize+i*40,size=headers.readUInt32LE(section+16),start=headers.readUInt32LE(section+20);if(size&&(!start||start+size>stat.size))throw Error('Truncated Windows executable section');}
    return {bytes:stat.size,machine:'AMD64',format:'PE32+',executed:false};
  }finally{await handle.close();}
}
async function inspectDetachedResources(directory){
  let bytes=0;
  async function check(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    if(item.isSymbolicLink())throw Error('Unexpected link in base app');
    if(item.name.startsWith('.'))throw Error('Unexpected temporary/hidden file in base app: '+file);
    if(item.isDirectory()){
      if(['python-runtime','inference-engine','translation-models','local-model'].includes(item.name))throw Error('Heavy runtime embedded');
      await check(file);
    }else{
      if(!item.isFile())throw Error('Unexpected non-file in base app: '+file);
      if(/\.(gguf|ckpt|pth|safetensors|onnx|ogg|glb)$/i.test(item.name))throw Error('Unexpected weight/audio file');
      bytes+=(await fs.stat(file)).size;
    }
  }}
  await check(directory);return bytes;
}
async function main(){
  const output=path.join(root,'build/base-app');
  const config={...pkg.build,extends:null,files:[...pkg.build.files,'resources/*.json','resources/voice-presets/**/*','!electron/companion-view/assets/voices/**/*','!electron/companion-view/assets/voices.json'],directories:{output:'build/base-electron'},extraResources:[
    {from:'inference',to:'inference',filter:['*.py','requirements.txt']},
    {from:'translation',to:'translation',filter:['*.py','*.json','*.txt','NOTICE.md','README.md']},
    {from:'model-service/desktop_worker.py',to:'local-chat/desktop_worker.py'},
    {from:'build/base-resource-catalog/runtime-catalog.json',to:'runtime-catalog.json'},
    {from:'resources/voice-presets',to:'voice-presets',filter:['**/*']},
    {from:'build/aria2',to:'aria2',filter:['**/*']}
  ]};
  await fs.mkdir(path.join(root,'build'),{recursive:true});
  const filename=path.join(root,'build/electron-builder-base.json');await fs.writeFile(filename,JSON.stringify(config,null,2));
  const run=args=>{const r=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,YUKINO_BASE_BUILD:'1',CSC_IDENTITY_AUTO_DISCOVERY:'false'},stdio:'inherit',shell:false});if(r.error||r.status!==0)throw r.error||Error('Base build failed: '+args[0]);};
  run([path.join(__dirname,'prepare-character-assets.cjs'),'--base-only']);
  run([path.join(__dirname,'prepare-companion-assets.cjs'),'--artwork-only']);
  run([path.join(__dirname,'prepare-wallpapers.cjs')]);
  await fs.access(path.join(root,'public/provider-logos/manifest.json')).catch(()=>run([path.join(__dirname,'cache-provider-logos.cjs'),'--allow-missing']));
  run([path.join(root,'node_modules/vite/bin/vite.js'),'build']);
  run([require.resolve('electron-builder/out/cli/cli.js'),'--win','--x64','--dir','--publish','never','--config',filename]);
  await fs.rm(output,{recursive:true,force:true});await fs.rename(path.join(root,'build/base-electron/win-unpacked'),output);
  return verifyBaseApp(output);
}
function verifyBundledCharacters(archive,models){
  const entries=new Set(asar.listPackage(archive).map(name=>name.replaceAll('\\','/'))),crypto=require('node:crypto');
  for(const model of models.filter(item=>item.bundled)){
    const file='dist/'+model.url.slice(2);
    if(!entries.has('/'+file))throw Error('Missing bundled character '+model.id);
    // ASAR's directory traversal uses the host path separator, including Windows.
    const data=asar.extractFile(archive,path.join(...file.split('/')));
    if(data.length!==model.bytes||crypto.createHash('sha256').update(data).digest('hex')!==model.sha256)throw Error('Bundled character integrity failed: '+model.id);
  }
}
function verifyBundledWallpapers(archive){
  const crypto=require('node:crypto'),manifest=require('../resources/default-wallpapers.json');
  for(const item of manifest.items){
    if(!/^[a-f0-9]{64}$/.test(item.id)||!/^\.\/wallpapers\/[a-z0-9-]+\.png$/.test(item.url))throw Error('Invalid bundled wallpaper manifest');
    const data=asar.extractFile(archive,path.join('dist',...item.url.slice(2).split('/')));
    if(data.length!==item.bytes||crypto.createHash('sha256').update(data).digest('hex')!==item.id)throw Error('Bundled wallpaper integrity failed: '+item.name);
  }
  return manifest.items.length;
}
function verifyBundledProviderLogos(archive){
  const crypto=require('node:crypto'),{allowed,imageExtension}=require('./cache-provider-logos.cjs'),brands=require('../resources/api-brands.json').brands;
  const manifest=JSON.parse(asar.extractFile(archive,path.join('dist','provider-logos','manifest.json')).toString('utf8'));
  if(manifest.version!==1||!manifest.brands||typeof manifest.brands!=='object')throw Error('Invalid provider logo manifest');
  const cached=[],missing=[];
  for(const [brand,definition] of Object.entries(brands)){
    const item=manifest.brands[brand];
    if(!item)throw Error('Missing provider logo outcome: '+brand);
    if(item.status==='not-applicable'&&!definition.logoSources.length)continue;
    if(item.status==='missing'){missing.push(brand);continue;}
    if(item.status!=='cached'||!new RegExp('^'+brand+'\\.(png|ico|jpg|webp)$').test(item.file)||!allowed(item.sourceUrl,definition.assetDomains))throw Error('Invalid official provider logo record: '+brand);
    const data=asar.extractFile(archive,path.join('dist','provider-logos',item.file));
    if(imageExtension(data)!==path.extname(item.file).slice(1)||data.length!==item.bytes||crypto.createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Provider logo integrity failed: '+brand);
    cached.push(brand);
  }
  return {cached,missing,validation:'official-source-and-package-bytes-only',displayVerified:false};
}
async function verifyBaseApp(output){
  const executable=await verifyWindowsExecutable(path.join(output,'Yukino Companion.exe'));
  const resources=path.join(output,'resources'),entries=asar.listPackage(path.join(resources,'app.asar')).map(x=>x.replaceAll('\\','/'));
  if(entries.some(x=>/\/assets\/voices\//.test(x)||/\.(gguf|ckpt|pth|safetensors|onnx)$/i.test(x)))throw Error('Heavy model/audio resources entered the base app');
  const characterCatalog={...require('../resources/character-models.json'),models:require('../resources/character-models.json').models.filter(model=>/^yukino-0[1-7]-v1$/.test(model.id))};
  if(characterCatalog.models.length!==7)throw Error('Expected the original seven character models');
  verifyBundledCharacters(path.join(resources,'app.asar'),characterCatalog.models);
  const approved=new Set(characterCatalog.models.map(model=>'/dist/'+model.url.slice(2)));
  if(entries.some(entry=>entry.endsWith('.glb')&&!approved.has(entry)))throw Error('Unrequested extension model entered the base package');
  const wallpapersEmbedded=verifyBundledWallpapers(path.join(resources,'app.asar'));
  const providerLogos=verifyBundledProviderLogos(path.join(resources,'app.asar'));
  for(const file of ['electron/main.cjs','electron/preload.cjs','electron/persona.cjs','dist/index.html'])if(!entries.includes('/'+file))throw Error('Missing application file '+file);
  for(const file of ['runtime-catalog.json','aria2/aria2c.exe','aria2/COPYING','aria2/LICENSE.OpenSSL','aria2/aria2-1.37.0.tar.xz','inference/worker.py','translation/worker.py','local-chat/desktop_worker.py'])await fs.access(path.join(resources,file));
  const bytes=await inspectDetachedResources(output);validateUnpackedBudget(bytes);
  const outfits=new Set(characterCatalog.models.filter(item=>item.bundled).map(item=>item.outfitGroup));
  if(outfits.size!==7)throw Error('Expected all seven character outfits');
  const report={schemaVersion:1,version:pkg.version,bytes,maxUnpackedBytes:MAX_UNPACKED_BYTES,maxInstallerBytes:512*1024**2,modelsEmbedded:false,legacyModelsEmbeddedMeaning:'LLM/TTS weights only; visual character models are recorded separately',languageWeightsEmbedded:false,voiceWeightsEmbedded:false,characterModelsEmbedded:true,characterVariants:characterCatalog.models.filter(item=>item.bundled).length,characterOutfits:outfits.size,wallpapersEmbedded,providerLogos,runtimeEmbedded:false,petVoicesEmbedded:false,bundledAria2:true,executable,validation:'static-package-only',windowsExecutionVerified:false,installerBuilt:false};await fs.writeFile(path.join(root,'build/base-package.json'),JSON.stringify(report,null,2)+'\n');console.log(report);return report;
}
if(require.main===module){
  const args=process.argv.slice(2);
  const work=args.length===0?main:args.length===2&&args[0]==='--verify-only'?()=>verifyBaseApp(path.resolve(args[1])):()=>Promise.reject(Error('Usage: node scripts/build-base-app.cjs [--verify-only DIRECTORY]'));
  work().catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={MAX_UNPACKED_BYTES,validateUnpackedBudget,inspectDetachedResources,readExact,verifyWindowsExecutable,verifyBundledCharacters,verifyBundledWallpapers,verifyBundledProviderLogos,verifyBaseApp};
