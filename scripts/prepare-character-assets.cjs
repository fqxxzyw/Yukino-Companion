'use strict';
// Lossless source transport only. Existing approved GLBs are never rewritten.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const manifest=require('../resources/character-source/sources.json');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');

async function main(){
  const baseOnly=process.argv.includes('--base-only');
  const sources=baseOnly
    ? require('../resources/character-models.json').models
      .filter(model=>/^yukino-0[1-7]-v1$/.test(model.id))
      .map(model=>({
        ...manifest.sources.find(entry=>entry.target==='public/'+model.url.slice(2)),
        target:'public/'+model.url.slice(2),bytes:model.bytes,sha256:model.sha256,
      }))
    : manifest.sources;
  if(baseOnly&&sources.length!==7)throw Error('Expected the original seven character models');
  for(const entry of sources){
    const target=path.join(root,entry.target);
    let data;
    try{data=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(data){
      if(data.length!==entry.bytes||hash(data)!==entry.sha256)throw Error('Existing character asset differs from approved version: '+entry.target);
      continue;
    }
    if(!entry.path)throw Error('Missing pinned base model: '+entry.target+'. Restore it with npm run restore:characters -- <installed-app.asar>.');
    const compressed=await fs.readFile(path.join(root,entry.path));
    if(compressed.length!==entry.compressedBytes||hash(compressed)!==entry.compressedSha256)throw Error('Character source archive integrity failed');
    data=zlib.gunzipSync(compressed,{maxOutputLength:entry.bytes});
    if(data.length!==entry.bytes||hash(data)!==entry.sha256)throw Error('Reconstructed character integrity failed');
    await fs.mkdir(path.dirname(target),{recursive:true});
    // Exclusive creation also preserves a different file created during preparation.
    try{await fs.writeFile(target,data,{flag:'wx'});}catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await fs.readFile(target);
      if(existing.length!==entry.bytes||hash(existing)!==entry.sha256)throw Error('Character changed during preparation: '+entry.target);
    }
    console.log('Prepared verified character source: '+entry.target);
  }
  if(baseOnly)console.log('Verified the original seven models; catalogue hold/unlock rules unchanged.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
