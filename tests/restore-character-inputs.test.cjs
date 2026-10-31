'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),asar=require('@electron/asar');
const {restore}=require('../scripts/restore-character-inputs.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-reuse-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source','dist','characters');await fs.mkdir(source,{recursive:true});const models=[];
 for(let i=0;i<17;i++){const name=`fixture-${i}.glb`,data=Buffer.from(`synthetic model ${i}`);await fs.writeFile(path.join(source,name),data);models.push({url:'./characters/'+name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),outfitGroup:'outfit-'+(i%7),bundled:true});}
 const archive=path.join(dir,'input.asar');await asar.createPackage(path.join(dir,'source'),archive);
 return {dir,archive,catalog:{models},destination:path.join(dir,'output')};
}
test('recovers and verifies all 17 bundled model inputs from an actual ASAR without overwriting equal inputs',async t=>{
 const f=await fixture(t);assert.deepEqual(await restore(f.archive,f.catalog,f.destination),{variants:17,outfits:7});assert.equal((await fs.readdir(f.destination)).length,17);
 assert.deepEqual(await restore(f.archive,f.catalog,f.destination),{variants:17,outfits:7});
});
test('base-only recovery restores exactly seven original entries without altering hold flags',async t=>{
 const f=await fixture(t);
 for(let i=0;i<7;i++)f.catalog.models[i].id=`yukino-0${i+1}-v1`;
 Object.assign(f.catalog.models[0],{ready:false,hold:true,status:'HOLD_eight_weight_GPU_validation'});
 const before=structuredClone(f.catalog);
 assert.deepEqual(await restore(f.archive,f.catalog,f.destination,{baseOnly:true}),{variants:7,outfits:7});
 assert.equal((await fs.readdir(f.destination)).length,7);
 assert.deepEqual(f.catalog,before);
 await assert.rejects(fs.stat(path.join(f.destination,'fixture-7.glb')),{code:'ENOENT'});
});
test('rejects corruption before writing any inputs and preserves a conflicting existing file',async t=>{
 const f=await fixture(t);f.catalog.models[16].sha256='0'.repeat(64);await assert.rejects(restore(f.archive,f.catalog,f.destination),/does not match/);await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
 f.catalog.models[16].sha256=crypto.createHash('sha256').update('synthetic model 16').digest('hex');await fs.mkdir(f.destination);await fs.writeFile(path.join(f.destination,'fixture-16.glb'),'keep');await assert.rejects(restore(f.archive,f.catalog,f.destination),/Existing model input differs/);assert.deepEqual(await fs.readdir(f.destination),['fixture-16.glb']);assert.equal(await fs.readFile(path.join(f.destination,'fixture-16.glb'),'utf8'),'keep');
});
test('rejects traversal, case-insensitive duplicate names and missing outfits',async t=>{
 const f=await fixture(t);const invalid=structuredClone(f.catalog);invalid.models[0].url='./characters/../../secret.glb';await assert.rejects(restore(f.archive,invalid,f.destination),/Invalid/);
 const duplicate=structuredClone(f.catalog);duplicate.models[1].url=duplicate.models[0].url.toUpperCase().replace('./CHARACTERS/','./characters/');await assert.rejects(restore(f.archive,duplicate,f.destination),/duplicate/);
 const missing=structuredClone(f.catalog);missing.models.forEach(m=>m.outfitGroup='one');await assert.rejects(restore(f.archive,missing,f.destination),/seven outfits/);
});
