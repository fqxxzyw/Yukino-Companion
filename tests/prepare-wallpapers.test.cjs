'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('wallpaper parts reconstruct original bytes and refuse corrupt or conflicting files',async()=>{
 const source=path.resolve(__dirname,'..'),root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-parts-'));
 try{
  await fs.mkdir(path.join(root,'scripts'),{recursive:true});await fs.mkdir(path.join(root,'resources'),{recursive:true});
  await fs.copyFile(path.join(source,'scripts/prepare-wallpapers.cjs'),path.join(root,'scripts/prepare-wallpapers.cjs'));
  await fs.copyFile(path.join(source,'resources/default-wallpapers.json'),path.join(root,'resources/default-wallpapers.json'));
  await fs.cp(path.join(source,'resources/default-wallpaper-parts'),path.join(root,'resources/default-wallpaper-parts'),{recursive:true});
  const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/prepare-wallpapers.cjs')],{encoding:'utf8'});
  assert.equal(run().status,0);
  for(const name of ['yukino-sky-01.png','yukino-sky-02.png'])assert.deepEqual(await fs.readFile(path.join(root,'public/wallpapers',name)),await fs.readFile(path.join(source,'public/wallpapers',name)));
  const image=path.join(root,'public/wallpapers/yukino-sky-01.png');await fs.writeFile(image,'do not overwrite');assert.notEqual(run().status,0);assert.equal(await fs.readFile(image,'utf8'),'do not overwrite');
  await fs.rm(image);const part=path.join(root,'resources/default-wallpaper-parts/sky-01-01.b64');const original=await fs.readFile(part,'utf8');await fs.writeFile(part,(original[0]==='A'?'B':'A')+original.slice(1));assert.notEqual(run().status,0);await assert.rejects(fs.access(image));
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
