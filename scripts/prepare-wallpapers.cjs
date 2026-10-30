'use strict';
// Reconstruct the approved PNGs byte-for-byte from small transport parts.
const fs=require('node:fs/promises'), path=require('node:path'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), partsDir=path.join(root,'resources/default-wallpaper-parts');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function prepare(){
  const manifest=JSON.parse(await fs.readFile(path.join(partsDir,'manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==2)throw Error('Invalid wallpaper parts manifest');
  const approved=require('../resources/default-wallpapers.json').items;
  for(const item of manifest.files){
    if(!/^wallpapers\/yukino-sky-0[12]\.png$/.test(item.target)||!Number.isSafeInteger(item.bytes)||!Array.isArray(item.parts)||!item.parts.length||!item.parts.every(x=>/^sky-0[12]-\d{2}\.b64$/.test(x)))throw Error('Invalid wallpaper part entry');
    if(!approved.some(x=>x.url==='./'+item.target&&x.id===item.sha256&&x.bytes===item.bytes))throw Error('Wallpaper manifest is not approved');
    const chunks=[];
    for(const name of item.parts){const text=await fs.readFile(path.join(partsDir,name),'utf8');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length%4)throw Error('Invalid wallpaper part encoding');chunks.push(Buffer.from(text,'base64'));}
    const data=Buffer.concat(chunks);
    if(data.length!==item.bytes||digest(data)!==item.sha256)throw Error('Wallpaper reconstruction integrity failed: '+item.target);
    const target=path.join(root,'public',item.target);await fs.mkdir(path.dirname(target),{recursive:true});
    try{const existing=await fs.readFile(target);if(digest(existing)!==item.sha256)throw Error('Existing wallpaper differs from approved image: '+item.target);}
    catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(target,data,{flag:'wx'});}
    console.log('Prepared verified wallpaper: '+item.target);
  }
}
if(require.main===module)prepare().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={prepare};
