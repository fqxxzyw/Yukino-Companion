const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { extractPinnedWeight } = require('./voice-archive.cjs');

function fileHash(file) {
  const hash = createHash(file.algorithm);
  // Hugging Face Git objects use the Git blob header for non-LFS files.
  if (file.algorithm === 'sha1') hash.update(`blob ${file.bytes}\0`);
  return hash;
}
async function verified(filename, file) {
  try {
    if ((await fs.stat(filename)).size !== file.bytes) return false;
    const hash=fileHash(file); for await(const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex')===file.digest;
  } catch(e) { if(e.code==='ENOENT')return false;throw e; }
}
function safeDestination(root, relative) {
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').includes('..')||path.isAbsolute(relative))throw Error('无效资源路径');
  const destination=path.resolve(root,relative);
  if(!destination.startsWith(path.resolve(root)+path.sep))throw Error('资源路径越界');
  return destination;
}

class VoiceResources {
  constructor({ root, catalog, bundledRoot=null, bundledPackId=null, fetcher=fetch, notify=()=>{} }) {
    Object.assign(this,{root,catalog,bundledRoot,bundledPackId,fetcher,notify});this.controller=null;this.status={phase:'idle'};
  }
  emit(status){this.status=status;this.notify(status)}
  summary(){return { ...this.status, root:this.root,packs:Object.entries(this.catalog.packs).map(([id,p])=>({id,label:p.label,kind:p.kind||'core',version:p.version,requiresReference:Boolean(p.requiresReference),bundled:id===this.bundledPackId,bytes:p.files.reduce((n,f)=>n+f.bytes,0)})) }}
  async packAvailable(pack,root,{hash=false}={}) {
    if(!root)return false;
    for(const file of pack.files){
      const item=file.extract?{path:file.extract.path,bytes:file.extract.bytes,algorithm:'sha256',digest:file.extract.digest}:file;
      const filename=safeDestination(root,item.path);
      if(hash){if(!await verified(filename,item))return false;}
      else {try{const stat=await fs.stat(filename);if(!stat.isFile()||stat.size!==item.bytes)return false;}catch{return false;}}
    }
    return true;
  }
  async inspect() {
    const summary=this.summary();
    for(const item of summary.packs){
      const pack=this.catalog.packs[item.id];
      item.bundled=pack.kind==='voice'&&item.id===this.bundledPackId&&await this.packAvailable(pack,this.bundledRoot);
      item.installed=item.bundled||await this.packAvailable(pack,this.root);
    }
    summary.coreReady=Boolean(summary.packs.find(pack=>pack.id==='core')?.installed);
    return summary;
  }
  async install(id='core') {
    const pack=this.catalog.packs[id];if(!pack)throw Error('未知公共模型组件');
    if(this.controller)throw Error('已有资源下载进行中');
    const controller=new AbortController();this.controller=controller;
    const total=pack.files.reduce((n,f)=>n+f.bytes,0);let complete=0;
    try {
    if(pack.kind==='voice'&&id===this.bundledPackId&&await this.packAvailable(pack,this.bundledRoot,{hash:true})){
      controller.signal.throwIfAborted();
      this.emit({phase:'complete',source:'bundled',packId:id,received:0,total:0});
      return {gpt:safeDestination(this.bundledRoot,pack.paths.gpt),sovits:safeDestination(this.bundledRoot,pack.paths.sovits),version:pack.version,textLang:'all_ja'};
    }
      await fs.mkdir(this.root,{recursive:true});
      for(const file of pack.files){
        controller.signal.throwIfAborted();
        const dest=safeDestination(this.root,file.path);
        this.emit({phase:'checking',file:file.path,received:complete,total});
        if(await verified(dest,file)){complete+=file.bytes;await this.extract(file,dest,controller.signal,complete,total);controller.signal.throwIfAborted();continue}
        controller.signal.throwIfAborted();
        const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<file.bytes+128*1024*1024)throw Error('磁盘剩余空间不足，请释放空间后重试');
        await fs.mkdir(path.dirname(dest),{recursive:true});
        const part=dest+'.part';let offset=0;
        try{offset=(await fs.stat(part)).size}catch(e){if(e.code!=='ENOENT')throw e}
        if(offset>=file.bytes){await fs.rm(part,{force:true});offset=0}
        controller.signal.throwIfAborted();
        const response=await this.fetcher(file.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(1800000)]),headers:offset?{Range:`bytes=${offset}-`}:{}});
        if(!response.ok||!response.body)throw Error(`下载失败 HTTP ${response.status}：${file.path}`);
        if(offset&&response.status===200)offset=0;
        if(response.status===206&&!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw Error('下载服务器返回了不匹配的续传范围');
        if(![200,206].includes(response.status))throw Error('不支持的资源下载响应');
        const hash=fileHash(file);
        if(offset)for await(const chunk of createReadStream(part))hash.update(chunk);
        let received=offset,last=0;
        const meter=new Transform({transform: (chunk,encoding,callback)=>{
          received+=chunk.length;
          if(received>file.bytes)return callback(Error('下载内容超出预期长度'));
          hash.update(chunk);
          if(Date.now()-last>200){last=Date.now();this.emit({phase:'downloading',file:file.path,received:complete+received,total})}
          callback(null,chunk);
        }});
        await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal:controller.signal});
        if(received!==file.bytes||hash.digest('hex')!==file.digest){await fs.rm(part,{force:true});throw Error(`文件校验失败，请重试：${file.path}`)}
        await fs.rm(dest,{force:true});await fs.rename(part,dest);complete+=file.bytes;
        await this.extract(file,dest,controller.signal,complete,total);
      }
      controller.signal.throwIfAborted();
      this.emit({phase:'complete',received:total,total});
      if(pack.kind==='voice')return {gpt:safeDestination(this.root,pack.paths.gpt),sovits:safeDestination(this.root,pack.paths.sovits),version:pack.version,textLang:'all_ja'};
      return {bert:path.join(this.root,'chinese-roberta-wwm-ext-large'),hubert:path.join(this.root,'chinese-hubert-base')};
    }catch(e){this.emit({phase:controller.signal.aborted?'cancelled':'error',error:controller.signal.aborted?'已取消，保留可续传的临时文件':e.message,received:complete,total});throw e}
    finally{if(this.controller===controller)this.controller=null}
  }
  async extract(file,archive,signal,received,total){
    if(!file.extract)return;
    const item=file.extract,destination=safeDestination(this.root,item.path);
    if(await verified(destination,{bytes:item.bytes,algorithm:'sha256',digest:item.digest}))return;
    const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<item.bytes+128*1024*1024)throw Error('磁盘剩余空间不足，无法解压语音权重');
    this.emit({phase:'extracting',file:item.path,received,total});
    await extractPinnedWeight({archive,member:item.member,destination,bytes:item.bytes,digest:item.digest,signal});
  }
  cancel(){this.controller?.abort()}
}
module.exports={VoiceResources,verified,safeDestination};
