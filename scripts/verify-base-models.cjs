'use strict';
// File/HTTP validation is deliberately separate from real WebGL and product locks.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {inspectGlb}=require('../electron/character-models.cjs');
const catalog=require('../resources/character-models.json');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2),built=args.includes('--dist'),urlIndex=args.indexOf('--url');
const directory=path.join(root,built?'dist':'public');
const report={scope:'Original seven pinned GLBs: integrity, embedded textures/materials, skeletons, animations; not a WebGL or unlock verdict',directory,models:[],errors:[]};
const digest=data=>createHash('sha256').update(data).digest('hex');
async function main(){
  let origin;
  if(urlIndex>=0){
    origin=new URL(args[urlIndex+1]);
    if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('HTTP verification requires a loopback development root URL');
  }
  const models=catalog.models.filter(model=>/^yukino-0[1-7]-v1$/.test(model.id));
  if(models.length!==7)throw Error('Expected exactly seven base entries');
  const expected=new Set(models.map(model=>path.basename(model.url)));
  const actual=(await fs.readdir(path.join(directory,'characters'))).filter(name=>name.endsWith('.glb'));
  if(actual.length!==7||actual.some(name=>!expected.has(name)))throw Error('The selected asset directory must contain only the original seven GLBs');
  for(const model of models){
    const filename=path.join(directory,model.url.slice(2)),stat=await fs.lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Model is not a regular file: '+model.id);
    const data=await fs.readFile(filename);
    if(data.length!==model.bytes||digest(data)!==model.sha256)throw Error('Pinned size/hash mismatch: '+model.id);
    const inspection=inspectGlb(data);
    for(const [name,clip] of Object.entries(model.clips||{})){
      if(!inspection.clips[name]||Math.abs(inspection.clips[name].duration-clip.duration)>.001)throw Error('Missing or changed animation: '+model.id+' / '+name);
    }
    let httpVerified=false;
    if(origin){
      const response=await fetch(new URL(model.url,origin),{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Model HTTP response '+response.status+': '+model.id);
      const served=Buffer.from(await response.arrayBuffer());
      if(served.length!==model.bytes||digest(served)!==model.sha256)throw Error('Served GLB differs: '+model.id);
      httpVerified=true;
    }
    report.models.push({id:model.id,filename:path.basename(filename),bytes:data.length,sha256:inspection.sha256,hold:model.hold===true,ready:model.ready,status:model.status,httpVerified,meshes:inspection.meshes,textures:inspection.textures,bones:inspection.bones,skins:inspection.skins,animations:inspection.animations,clips:inspection.clips,warnings:inspection.warnings,renderValidated:false});
    console.log('PASS '+model.id+' / '+data.length+' bytes / '+inspection.textures+' textures / '+inspection.bones+' bones'+(model.hold?' / HOLD preserved':''));
  }
  report.passed=true;
}
main().catch(error=>{report.passed=false;report.errors.push(error.message);console.error(error);process.exitCode=1;}).finally(async()=>{
  const output=path.join(root,'build/base-model-verification');
  await fs.mkdir(output,{recursive:true});
  const file=path.join(output,built?'dist.json':urlIndex>=0?'public-http.json':'public.json');
  await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');
  console.log('Report: '+file);
});
