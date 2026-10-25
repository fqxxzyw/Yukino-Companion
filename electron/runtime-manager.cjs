const fs = require('node:fs/promises');
const {createReadStream,createWriteStream} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const yauzl = require('yauzl');
const {VoiceResources} = require('./voice-resources.cjs');
const execute = promisify(execFile);
async function hashFile(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function safeEntry(root,name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||/[<>:"|?*\x00-\x1f\x7f]/.test(name)||name.split('/').some((v,index,parts)=>v==='..'||v==='.'||(!v&&index!==parts.length-1)||/[. ]$/.test(v)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v)))throw Error('运行环境压缩包路径不安全');
  const destination=path.resolve(root,name);
  if(!destination.startsWith(path.resolve(root)+path.sep))throw Error('运行环境文件路径越界');
  return destination;
}
async function extractRuntimeZip(archive,destination,{signal,maxBytes=16*1024**3,maxEntries=200000,onProgress=()=>{}}={}){
  signal?.throwIfAborted();await fs.mkdir(destination,{recursive:true});
  const zip=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true,autoClose:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z)));
  return new Promise((resolve,reject)=>{
    let settled=false,count=0,bytes=0,active,entryTask,stopped;const names=new Set();
    function finish(error){if(settled)return;settled=true;signal?.removeEventListener('abort',abort);zip.close();error?reject(error):resolve({files:count,bytes});}
    // Wait for the active pipeline (including the destination file close) before
    // settling, so Windows staging cleanup does not race a still-open handle.
    function stop(error){if(settled)return;stopped=stopped||error;active?.destroy(stopped);zip.close();if(!entryTask)finish(stopped);}
    function abort(){stop(Error('运行环境安装已取消'));}
    signal?.addEventListener('abort',abort,{once:true});
    zip.on('error',stop);zip.on('end',()=>finish(stopped));
    zip.on('entry',entry=>{entryTask=(async()=>{
      signal?.throwIfAborted();const target=safeEntry(destination,entry.fileName),key=entry.fileName.toLowerCase();
      if(names.has(key)||++count>maxEntries||entry.generalPurposeBitFlag&1||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw Error('运行环境压缩包含重复、加密或链接文件');
      names.add(key);bytes+=entry.uncompressedSize;
      if(bytes>maxBytes)throw Error('运行环境解压大小超出清单限制');
      if(entry.fileName.endsWith('/'))await fs.mkdir(target,{recursive:true});
      else{
        await fs.mkdir(path.dirname(target),{recursive:true});
        signal?.throwIfAborted();
        active=await new Promise((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s)));
        try{await pipeline(active,createWriteStream(target,{flags:'wx'}),{signal});}finally{active=null;}
      }
      onProgress({files:count,bytes});
    })();entryTask.then(()=>{entryTask=null;if(stopped)finish(stopped);else if(!settled)zip.readEntry();},error=>{entryTask=null;stop(error);});});
    if(signal?.aborted)abort();else zip.readEntry();
  });
}
async function detectNvidia(platform=process.platform,run=execute,signal){
  signal?.throwIfAborted();
  try{
    const result=platform==='win32'?await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-CimInstance Win32_VideoController).Name | ConvertTo-Json -Compress'],{windowsHide:true,timeout:10000,maxBuffer:65536,signal}):await run('nvidia-smi',['--query-gpu=name','--format=csv,noheader'],{timeout:5000,maxBuffer:65536,signal});
    signal?.throwIfAborted();
    return /nvidia|geforce|quadro|tesla/i.test(result.stdout);
  }catch(error){if(signal?.aborted)throw error;return false;}
}
class RuntimeManager{
  constructor({dataRoot,resourceRoot,catalogPath,fetcher=fetch,notify=()=>{},platform=process.platform,run=execute}){
    Object.assign(this,{dataRoot,resourceRoot,catalogPath,fetcher,notify,platform,run});
    this.root=path.join(dataRoot,'runtime');this.phase='idle';this.error=null;this.progress=null;this.controller=null;this.downloader=null;
  }
  emit(phase,extra={}){this.phase=phase;this.error=extra.error||null;this.progress=extra.progress||null;this.notify({phase,...extra});}
  async catalog(){try{return JSON.parse(await fs.readFile(this.catalogPath,'utf8'));}catch(e){if(e.code==='ENOENT')return {schemaVersion:1,variants:{}};throw Error('运行环境下载清单无法读取');}}
  async current(){
    let saved;try{saved=JSON.parse(await fs.readFile(path.join(this.root,'current.json'),'utf8'));}catch{}
    const roots=[];
    if(saved?.directory&&/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(saved.directory))roots.push(path.join(this.root,saved.directory));
    roots.push(this.resourceRoot);
    for(const root of roots){
      try{
        const python=path.join(root,'python-runtime',this.platform==='win32'?'python.exe':'bin/python');
        await fs.access(python);
        const marker=JSON.parse(await fs.readFile(path.join(root,'python-runtime/yukino-runtime-build.json'),'utf8'));
        if(!['cpu','cu124'].includes(marker.flavor))continue;
        const selected=root!==this.resourceRoot;
        return {ready:true,root,python,ffmpeg:path.join(root,'python-runtime',this.platform==='win32'?'ffmpeg.exe':'ffmpeg'),flavor:marker.flavor,bundled:!selected,metadata:selected?saved?.metadata||null:null,version:selected?saved?.version||null:null,archiveSha256:selected?saved?.archiveSha256||null:null};
      }catch{}
    }
    return {ready:false,root:null,python:'',ffmpeg:'',flavor:null};
  }
  async status(){const current=await this.current(),catalog=await this.catalog();return {...current,phase:this.phase,error:this.error,progress:this.progress,variants:Object.keys(catalog.variants||{}),version:catalog.version};}
  async choose(requested,catalog,signal){
    signal?.throwIfAborted();
    if(!['auto','cpu','cu124'].includes(requested))throw Error('无效的运行环境选项');
    if(requested!=='auto')return requested;
    return catalog.variants?.cu124&&await detectNvidia(this.platform,this.run,signal)?'cu124':'cpu';
  }
  async install(requested='auto'){
    if(this.controller)throw Error('运行环境正在安装');
    const controller=new AbortController();this.controller=controller;
    let stage;
    try{
      const catalog=await this.catalog();controller.signal.throwIfAborted();
      const flavor=await this.choose(requested,catalog,controller.signal);controller.signal.throwIfAborted();
      const current=await this.current();controller.signal.throwIfAborted();
      const pack=catalog.variants?.[flavor];
      if(current.ready&&current.flavor===flavor&&(!pack||(current.version===catalog.version&&current.archiveSha256===pack.archiveSha256))){this.emit('ready');return this.status();}
      if(this.platform!=='win32')throw Error('一键运行环境适用于 Windows；开发环境请配置本机 Python。');
      if(!pack||!Array.isArray(pack.parts)||!pack.parts.length)throw Error('此版本尚未提供所选运行环境，请选择其他环境或稍后重试。');
      if(catalog.schemaVersion!==1||typeof catalog.version!=='string'||!catalog.version.trim()||catalog.version.length>64||!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(pack.id)||!/^[a-f0-9]{64}$/.test(pack.archiveSha256)||!Number.isSafeInteger(pack.unpackedBytes)||pack.unpackedBytes<1||pack.unpackedBytes>16*1024**3)throw Error('运行环境下载清单不合法');
      for(const part of pack.parts){safeEntry(this.root,part.path);if(!/^https:\/\/github\.com\/fqxxzyw\/Yukino-Companion\/releases\/download\//.test(part.url)||part.algorithm!=='sha256'||!/^[a-f0-9]{64}$/.test(part.digest)||!Number.isSafeInteger(part.bytes)||part.bytes<1)throw Error('运行环境文件清单不合法');}
      await fs.mkdir(this.root,{recursive:true});
      const disk=await fs.statfs(this.root),downloadBytes=pack.parts.reduce((a,p)=>a+p.bytes,0);
      controller.signal.throwIfAborted();
      if(disk.bavail*disk.bsize<pack.unpackedBytes+downloadBytes*2+256*1024**2)throw Error('磁盘空间不足，无法下载并解压运行环境。');
      const cache=path.join(this.root,'downloads',pack.id);
      this.downloader=new VoiceResources({root:cache,catalog:{packs:{runtime:{files:pack.parts,label:'共享推理运行环境'}}},fetcher:this.fetcher,notify:progress=>this.emit(progress.phase,{progress:{...progress,bytes:progress.received||0}})});
      const onAbort=()=>this.downloader?.cancel();controller.signal.addEventListener('abort',onAbort,{once:true});
      controller.signal.throwIfAborted();
      try{await this.downloader.install('runtime');}finally{controller.signal.removeEventListener('abort',onAbort);}controller.signal.throwIfAborted();
      const archive=path.join(cache,'runtime.zip');this.emit('assembling');
      const out=await fs.open(archive,'w');try{for(const part of pack.parts){for await(const chunk of createReadStream(safeEntry(cache,part.path))){controller.signal.throwIfAborted();let offset=0;while(offset<chunk.length){const written=await out.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw Error('运行环境文件写入失败');offset+=written.bytesWritten;}}}}finally{await out.close();}
      if(await hashFile(archive)!==pack.archiveSha256)throw Error('运行环境完整校验失败，请重新下载。');
      stage=path.join(this.root,'.install-'+crypto.randomUUID());this.emit('extracting',{progress:{bytes:0,total:pack.unpackedBytes}});
      let last=0;await extractRuntimeZip(archive,stage,{signal:controller.signal,maxBytes:pack.unpackedBytes,onProgress:progress=>{if(Date.now()-last>200){last=Date.now();this.emit('extracting',{progress:{bytes:progress.bytes,total:pack.unpackedBytes}});}}});
      const python=path.join(stage,'python-runtime/python.exe');await fs.access(python);
      const marker=JSON.parse(await fs.readFile(path.join(stage,'python-runtime/yukino-runtime-build.json'),'utf8'));
      if(marker.flavor!==flavor)throw Error('下载的运行环境类型与所选版本不一致。');
      this.emit('checking');
      const probe="import os,sys,json; dll=os.path.join(sys.prefix,'Lib','site-packages','torch','lib'); handle=os.add_dll_directory(dll) if hasattr(os,'add_dll_directory') and os.path.isdir(dll) else None; import torch,llama_cpp; print(json.dumps({'torch':torch.__version__,'gpuAvailable':torch.cuda.is_available(),'gpuName':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,'translationGpuBuild':bool(llama_cpp.llama_supports_gpu_offload())}))";
      const result=await this.run(python,['-X','utf8','-c',probe],{windowsHide:true,timeout:180000,maxBuffer:1024**2,signal:controller.signal});
      const metadata=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));controller.signal.throwIfAborted();
      // Include the catalogue version in the directory identity: even a version
      // update that reuses an archive cannot remove the selected working tree.
      const directory=pack.id+'-'+crypto.createHash('sha256').update(catalog.version+'\n'+pack.archiveSha256).digest('hex').slice(0,16),installed=path.join(this.root,directory);
      // Only this app's versioned staging destination is replaced; the old
      // selected runtime stays usable until the atomic pointer update below.
      await fs.rm(installed,{recursive:true,force:true});await fs.rename(stage,installed);stage=null;
      controller.signal.throwIfAborted();
      await fs.writeFile(path.join(this.root,'current.json.tmp'),JSON.stringify({directory,flavor,version:catalog.version,archiveSha256:pack.archiveSha256,metadata}));
      controller.signal.throwIfAborted();
      await fs.rename(path.join(this.root,'current.json.tmp'),path.join(this.root,'current.json'));
      await fs.rm(cache,{recursive:true,force:true});this.emit('ready',{metadata});return this.status();
    }catch(error){this.emit(controller.signal.aborted?'cancelled':'error',{error:controller.signal.aborted?'安装已取消；已下载的部分可在下次继续。':error.message});throw error;}
    finally{
      try{if(stage)await fs.rm(stage,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
      catch{this.notify({phase:this.phase,error:this.error,cleanupWarning:'临时文件暂时被占用；已保留原运行环境，可以重试安装。'});}
      finally{this.downloader=null;if(this.controller===controller)this.controller=null;}
    }
  }
  cancel(){this.controller?.abort();this.downloader?.cancel();}
}
module.exports={RuntimeManager,extractRuntimeZip,safeEntry,hashFile,detectNvidia};
