const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {extractRuntimeZip}=require('./runtime-manager.cjs');
const {downloadResource}=require('./resource-download.cjs');
const {resourceSources}=require('./resource-sources.cjs');
const defaultCatalog=require('../resources/resource-packs.json');
async function hashFile(file,signal){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file)){signal?.throwIfAborted();hash.update(chunk);}return hash.digest('hex');}
async function manifests(root,depth=0){let result=[];for(const item of await fs.readdir(root,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('资源目录不支持链接');const target=path.join(root,item.name);if(item.isDirectory()&&depth<2)result.push(...await manifests(target,depth+1));else if(item.isFile()&&item.name==='manifest.json')result.push(target);}return result;}
class ResourcePacks {
  constructor({dataRoot,catalog=defaultCatalog,fetcher=fetch,notify=()=>{},downloader=downloadResource}){Object.assign(this,{catalog,fetcher,notify,downloader});this.root=path.join(dataRoot,'resources');this.controllers=new Map();this.petCheck=null;}
  get controller(){return this.controllers.values().next().value||null;}
  pack(id){const pack=this.catalog?.packs?.[id];if(!['chat','pet'].includes(id)||!pack||!Number.isSafeInteger(pack.bytes)||pack.bytes<1||!/^[a-f0-9]{64}$/.test(pack.sha256)||!Number.isSafeInteger(pack.maxUnpackedBytes)||pack.maxUnpackedBytes<pack.bytes||pack.maxUnpackedBytes>8*1024**3)throw Error('资源清单无效');return pack;}
  directory(id){return path.join(this.root,id+'-'+this.pack(id).sha256.slice(0,16));}
  async status(id){
    const pack=this.pack(id),directory=this.directory(id);let installed=false,root='';
    try{
      const marker=JSON.parse(await fs.readFile(path.join(directory,'.resource-pack.json'),'utf8'));
      if(marker.sha256!==pack.sha256||typeof marker.root!=='string'||marker.root.includes('\\')||path.isAbsolute(marker.root)||marker.root.split('/').some(x=>x==='..'))throw Error('资源安装标记无效');
      root=path.resolve(directory,marker.root||'.');if(root!==directory&&!root.startsWith(directory+path.sep))throw Error('资源路径越界');
      if(id==='chat'){const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));if(path.basename(manifest.file)!==manifest.file||!manifest.file.endsWith('.gguf')||(await fs.stat(path.join(root,manifest.file))).size!==manifest.bytes)throw Error('角色模型不完整');}
      else {const indexPath=path.join(root,'voices.json'),voicesPath=path.join(root,'voices');const index=JSON.parse(await fs.readFile(indexPath,'utf8'));if(index.archiveSha256!==pack.sha256||!Array.isArray(index.files)||index.files.length!==pack.expectedFiles)throw Error('桌宠资源不完整');
        const key=root+':'+(await fs.stat(indexPath)).mtimeMs+':'+(await fs.stat(voicesPath)).mtimeMs;
        if(this.petCheck!==key){for(const item of index.files){if(!/^[A-Za-z0-9_-]+\.ogg$/.test(item.file)||!Number.isSafeInteger(item.bytes)||item.bytes<1||(await fs.stat(path.join(voicesPath,item.file))).size!==item.bytes)throw Error('桌宠语音索引不完整');}this.petCheck=key;}}
      installed=true;
    }catch{root='';}
    return {id,installed,root,downloadBytes:pack.bytes,downloadSources:resourceSources(pack.url,pack.sources),label:pack.label};
  }
  async install(id,{signal}={}){
    if(this.controllers.has(id))throw Error('此资源正在安装，请等待或先取消');
    const controller=new AbortController();this.controllers.set(id,controller);const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const active=controller.signal;let stage;
    try{
      active.throwIfAborted();const existing=await this.status(id);if(existing.installed)return existing;
      const pack=this.pack(id),destination=this.directory(id);await fs.mkdir(this.root,{recursive:true});
      // Verified chunks are removed before extraction; the peak is either two
      // archive copies while merging, or archive + unpacked payload, not all three.
      const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<pack.bytes+Math.max(pack.bytes,pack.maxUnpackedBytes)+128*1024**2)throw Error('剩余磁盘空间不足，无法下载、合并并解压所选资源');
      const archive=path.join(this.root,'downloads',id+'-'+pack.sha256.slice(0,16)+'.zip');
      await this.downloader({url:pack.url,sources:resourceSources(pack.url,pack.sources),dest:archive,bytes:pack.bytes,sha256:pack.sha256,fetcher:this.fetcher,signal:active,onProgress:progress=>this.notify(id,progress)});
      active.throwIfAborted();stage=path.join(this.root,'.stage-'+crypto.randomUUID());const extracted=path.join(stage,'payload');
      this.notify(id,{phase:'extracting',bytes:0,total:pack.maxUnpackedBytes});
      await extractRuntimeZip(archive,extracted,{signal:active,maxBytes:pack.maxUnpackedBytes,maxEntries:id==='pet'?5000:1000,onProgress:progress=>this.notify(id,{phase:'extracting',bytes:progress.bytes,total:pack.maxUnpackedBytes})});
      let selected;
      if(id==='chat'){
        const found=await manifests(extracted);if(found.length!==1)throw Error('角色模型压缩包必须包含一个清单');selected=path.dirname(found[0]);
        const manifest=JSON.parse(await fs.readFile(found[0],'utf8'));if(typeof manifest.file!=='string'||path.basename(manifest.file)!==manifest.file||manifest.file.includes('\\')||!manifest.file.endsWith('.gguf')||!manifest.training?.completed||!/^[a-f0-9]{64}$/.test(manifest.sha256)||!Number.isSafeInteger(manifest.bytes))throw Error('角色模型训练清单不完整');
        const model=path.join(selected,manifest.file);this.notify(id,{phase:'checking',bytes:0,total:manifest.bytes});
        if((await fs.stat(model)).size!==manifest.bytes||await hashFile(model,active)!==manifest.sha256)throw Error('角色模型解压校验失败');
        const handle=await fs.open(model,'r');try{const magic=Buffer.alloc(4);await handle.read(magic,0,4,0);if(magic.toString()!=='GGUF')throw Error('角色模型不是 GGUF 文件');}finally{await handle.close();}
      }else{
        selected=path.join(stage,'pet');await fs.mkdir(path.join(selected,'voices'),{recursive:true});const files=[];
        async function collect(directory){for(const item of await fs.readdir(directory,{withFileTypes:true})){active.throwIfAborted();const input=path.join(directory,item.name);if(item.isDirectory())await collect(input);else if(item.isFile()){if(!/^[A-Za-z0-9_-]+\.ogg$/.test(item.name)||files.some(x=>x.file.toLowerCase()===item.name.toLowerCase()))throw Error('桌宠音频包包含未登记或重复文件');const bytes=(await fs.stat(input)).size;if(!bytes)throw Error('桌宠音频为空');files.push({file:item.name,bytes,sha256:await hashFile(input,active)});await fs.rename(input,path.join(selected,'voices',item.name));}}}
        await collect(extracted);if(files.length!==pack.expectedFiles)throw Error('桌宠音频数量与清单不符');
        await fs.writeFile(path.join(selected,'voices.json'),JSON.stringify({schemaVersion:1,count:files.length,archiveSha256:pack.sha256,files}));
      }
      const relative=path.relative(stage,selected).split(path.sep).join('/');
      await fs.writeFile(path.join(stage,'.resource-pack.json'),JSON.stringify({schemaVersion:1,id,sha256:pack.sha256,root:relative}));active.throwIfAborted();
      // Never recursively replace an existing directory containing user files.
      try{await fs.access(destination);throw Error('资源目录已存在但不完整，请在帮助文档中查看修复方法；原文件已保留');}catch(error){if(error.code!=='ENOENT')throw error;}
      await fs.rename(stage,destination);stage=null;const result=await this.status(id);if(!result.installed)throw Error('资源安装后的检查未通过');this.notify(id,{phase:'ready',bytes:pack.bytes,total:pack.bytes});return result;
    }finally{signal?.removeEventListener('abort',cancel);if(this.controllers.get(id)===controller)this.controllers.delete(id);if(stage)await fs.rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }
  cancel(){for(const controller of this.controllers.values())controller.abort();}
}
module.exports={ResourcePacks,hashFile};
