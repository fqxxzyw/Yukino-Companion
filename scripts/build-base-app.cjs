'use strict';
// This build only packages the application. Model/environment downloads belong to the app's opt-in wizard.
const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),asar=require('@electron/asar');
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
  run([path.join(__dirname,'prepare-companion-assets.cjs'),'--artwork-only']);
  run([path.join(root,'node_modules/vite/bin/vite.js'),'build']);
  run([require.resolve('electron-builder/out/cli/cli.js'),'--win','--x64','--dir','--publish','never','--config',filename]);
  await fs.rm(output,{recursive:true,force:true});await fs.rename(path.join(root,'build/base-electron/win-unpacked'),output);
  const resources=path.join(output,'resources'),entries=asar.listPackage(path.join(resources,'app.asar')).map(x=>x.replaceAll('\\','/'));
  if(entries.some(x=>/\/assets\/voices\//.test(x)||/\.(gguf|ckpt|pth|safetensors|onnx)$/i.test(x)))throw Error('Heavy model/audio resources entered the base app');
  for(const file of ['electron/main.cjs','electron/preload.cjs','electron/persona.cjs','dist/index.html'])if(!entries.includes('/'+file))throw Error('Missing application file '+file);
  for(const file of ['runtime-catalog.json','aria2/aria2c.exe','aria2/COPYING','aria2/LICENSE.OpenSSL','aria2/aria2-1.37.0.tar.xz','inference/worker.py','translation/worker.py','local-chat/desktop_worker.py'])await fs.access(path.join(resources,file));
  let bytes=0;async function check(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('Unexpected link in base app');if(item.isDirectory()){if(['python-runtime','inference-engine','translation-models','local-model'].includes(item.name))throw Error('Heavy runtime embedded');await check(file);}else{if(/\.(gguf|ckpt|pth|safetensors|onnx|ogg)$/i.test(item.name))throw Error('Unexpected weight/audio file');bytes+=(await fs.stat(file)).size;}}}
  await check(output);if(bytes>512*1024**2)throw Error('Base application exceeds 512 MiB');
  const report={schemaVersion:1,version:pkg.version,bytes,modelsEmbedded:false,runtimeEmbedded:false,petVoicesEmbedded:false,bundledAria2:true};await fs.writeFile(path.join(root,'build/base-package.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
