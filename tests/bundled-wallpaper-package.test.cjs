const {finished:finishArchive}=require('node:stream/promises');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),asar=require('@electron/asar');
const {verifyBundledWallpapers}=require('../scripts/build-base-app.cjs');
test('packaged default wallpapers retain the approved image bytes and reject changed payloads',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-package-'));
 try{
  const files=path.join(root,'files'),images=path.join(files,'dist/wallpapers'),archive=path.join(root,'app.asar');await fs.mkdir(images,{recursive:true});
  for(const item of require('../resources/default-wallpapers.json').items)await fs.copyFile(path.join(__dirname,'../public',item.url.slice(2)),path.join(images,path.basename(item.url)));
  await finishArchive(await asar.createPackage(files,archive));assert.equal(verifyBundledWallpapers(archive),2);
  await fs.writeFile(path.join(images,'yukino-sky-01.png'),'changed');await finishArchive(await asar.createPackage(files,path.join(root,'changed.asar')));assert.throws(()=>verifyBundledWallpapers(path.join(root,'changed.asar')),/wallpaper integrity/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
