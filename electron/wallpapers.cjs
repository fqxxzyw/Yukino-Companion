const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const MAX_BYTES=16*1024*1024,MAX_IMAGES=20;
function imageMime(data){if(data.length>=8&&data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'image/webp';throw Error('只支持 PNG、JPEG 或 WebP 图片');}
function validId(id){return typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)}
class WallpaperStore{
 constructor(root,{decode}={}){this.root=path.join(root,'wallpapers');this.decode=decode;}
 async import(files){if(!Array.isArray(files)||files.length>MAX_IMAGES)throw Error('一次最多选择 20 张壁纸');const entries=[];
  for(const file of files){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>MAX_BYTES)throw Error('壁纸必须是小于 16 MiB 的图片');const data=await fs.readFile(file);if(data.length!==stat.size||data.length>MAX_BYTES)throw Error('壁纸读取失败');const mime=imageMime(data);if(this.decode){const size=this.decode(data);if(!size||!size.width||!size.height||size.width*size.height>40000000||size.width>12000||size.height>12000)throw Error('壁纸无法解码或分辨率过大');}entries.push({id:createHash('sha256').update(data).digest('hex'),name:path.basename(file).slice(0,120),data,mime});}
  await fs.mkdir(this.root,{recursive:true});for(const entry of entries)await fs.writeFile(path.join(this.root,entry.id),entry.data,{flag:'w'});return entries.map(({id,name})=>({id,name}));
 }
 async copyTo(targetRoot,ids){
  if(!Array.isArray(ids)||ids.length>MAX_IMAGES||ids.some(id=>!validId(id)))throw Error('壁纸清单无效');
  const destination=new WallpaperStore(targetRoot);await fs.mkdir(destination.root,{recursive:true});const rootStat=await fs.lstat(destination.root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('目标壁纸目录无效');
  for(const id of new Set(ids)){
   const {data}=await this.read(id),file=path.join(destination.root,id);
   try{await fs.writeFile(file,data,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
   await destination.read(id);
  }
 }
 async copyAllTo(targetRoot,requiredIds=[]){
  if(!Array.isArray(requiredIds)||requiredIds.length>MAX_IMAGES||requiredIds.some(id=>!validId(id)))throw Error('壁纸清单无效');
  let entries;try{entries=await fs.readdir(this.root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'&&!requiredIds.length)return;throw error;}
  const ids=new Set(requiredIds);
  for(const entry of entries){
   if(!validId(entry.name))continue;
   if(!entry.isFile()||entry.isSymbolicLink())throw Error('源壁纸文件无效');
   ids.add(entry.name);
  }
  // Imported entries can outnumber the active slideshow after users remove
  // items. Never depend on possibly stale state.json to find image bytes.
  const all=[...ids];for(let i=0;i<all.length;i+=MAX_IMAGES)await this.copyTo(targetRoot,all.slice(i,i+MAX_IMAGES));
 }
 async read(id){if(!validId(id))throw Error('壁纸编号无效');const file=path.join(this.root,id),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>MAX_BYTES)throw Error('壁纸文件无效');const data=await fs.readFile(file);if(data.length!==stat.size||createHash('sha256').update(data).digest('hex')!==id)throw Error('壁纸文件损坏');return {mime:imageMime(data),data:new Uint8Array(data)};}
}
module.exports={WallpaperStore,imageMime,validId,MAX_BYTES,MAX_IMAGES};
