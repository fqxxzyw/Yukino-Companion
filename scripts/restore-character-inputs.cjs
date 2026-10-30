'use strict';
// Recover only the pinned, already-distributed visual inputs from an installed
// trusted EXE. This never downloads or publishes individual model files.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function restore(archive,catalog,destination){
 const models=catalog?.models?.filter(m=>m.bundled===true);
 if(!models||models.length!==17||new Set(models.map(m=>m.outfitGroup)).size!==7)throw Error('Expected 17 bundled variants across seven outfits');
 const names=new Set(),items=[];
 for(const model of models){
  const match=/^\.\/characters\/([A-Za-z0-9_-]+\.glb)$/.exec(model.url||'');
  if(!match||names.has(match[1].toLowerCase())||!Number.isSafeInteger(model.bytes)||model.bytes<1||!/^[a-f0-9]{64}$/.test(model.sha256||''))throw Error('Invalid or duplicate model catalog entry');
  names.add(match[1].toLowerCase());items.push({name:match[1],bytes:model.bytes,sha256:model.sha256});
 }
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-character-reuse-'));
 try{
  // Validate every payload before changing any target file.
  for(const item of items){
   const bytes=asar.extractFile(archive,path.join('dist','characters',item.name));
   if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw Error('Bundled character does not match pinned catalog: '+item.name);
   await fs.writeFile(path.join(stage,item.name),bytes,{flag:'wx'});
  }
  await fs.mkdir(destination,{recursive:true});
  for(const item of items){
   const target=path.join(destination,item.name);let existing;
   try{const info=await fs.lstat(target);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe existing model input: '+item.name);existing=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(existing&&(existing.length!==item.bytes||digest(existing)!==item.sha256))throw Error('Existing model input differs: '+item.name);
  }
  for(const item of items){
   const target=path.join(destination,item.name);
   try{await fs.copyFile(path.join(stage,item.name),target,require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;const existing=await fs.readFile(target);if(existing.length!==item.bytes||digest(existing)!==item.sha256)throw Error('Model input changed during recovery: '+item.name);}
  }
  return {variants:items.length,outfits:7};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.length!==1){console.error('Usage: node scripts/restore-character-inputs.cjs <installed-app.asar>');process.exitCode=1;}
 else restore(path.resolve(args[0]),require('../resources/character-models.json'),path.join(root,'public','characters')).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={restore};
