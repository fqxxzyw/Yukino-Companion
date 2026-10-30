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
const {OFFICIAL_CUDA_VERSION,RUNTIME_PROBE,validateProbe,installOfficialCuda}=require('./official-runtime.cjs');
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
async function detectNvidiaDetails(platform=process.platform,run=execute,signal){
  signal?.throwIfAborted();
  try{
    const result=platform==='win32'?await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-CimInstance Win32_VideoController).Name | ConvertTo-Json -Compress'],{windowsHide:true,timeout:10000,maxBuffer:65536,signal}):await run('nvidia-smi',['--query-gpu=name','--format=csv,noheader'],{timeout:5000,maxBuffer:65536,signal});
    signal?.throwIfAborted();
    const names=String(result.stdout||'').trim().slice(0,500);return {checked:true,nvidia:/nvidia|geforce|quadro|tesla/i.test(names)};
  }catch(error){if(signal?.aborted)throw error;return {checked:false,nvidia:false};}
}
async function detectNvidia(platform=process.platform,run=execute,signal){return (await detectNvidiaDetails(platform,run,signal)).nvidia;}
class RuntimeManager{
  constructor({dataRoot,legacyDataRoot,resourceRoot,catalogPath,fetcher=fetch,notify=()=>{},platform=process.platform,run=execute,hardwareRun=execute}){
    Object.assign(this,{dataRoot,legacyDataRoot,resourceRoot,catalogPath,fetcher,notify,platform,run,hardwareRun});
    this.root=path.join(dataRoot,'runtime');this.phase='idle';this.error=null;this.progress=null;this.controller=null;this.downloader=null;
  }
  emit(phase,extra={}){this.phase=phase;this.error=extra.error||null;this.progress=extra.progress||null;this.notify({phase,...extra});}
  async catalog(){try{const catalog=JSON.parse(await fs.readFile(this.catalogPath,'utf8'));if(this.platform==='win32'&&catalog.variants?.cpu&&!catalog.variants.cu124)catalog.variants.cu124={...catalog.variants.cpu,officialPip:true,baseFlavor:'cpu'};return catalog;}catch(e){if(e.code==='ENOENT')return {schemaVersion:1,variants:{}};throw Error('运行环境下载清单无法读取');}}
  async current(){
    const roots=[];
    for(const dataRoot of [this.dataRoot]){
      const runtimeRoot=path.join(dataRoot,'runtime');let saved;
      try{saved=JSON.parse(await fs.readFile(path.join(runtimeRoot,'current.json'),'utf8'));}catch{}
      if(saved?.directory&&/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(saved.directory))roots.push({root:path.join(runtimeRoot,saved.directory),saved});
    }
    roots.push({root:this.resourceRoot,saved:null});
    for(const {root,saved} of roots){
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
  async verify(current,signal){
    if(!current.ready)return {valid:false,metadata:null,error:null};
    try{const result=await this.run(current.python,['-X','utf8','-c',RUNTIME_PROBE],{windowsHide:true,timeout:180000,maxBuffer:1024**2,signal,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1'}});const metadata=validateProbe(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),current.flavor);return {valid:true,metadata,error:null};}
    catch(error){if(signal?.aborted)throw error;return {valid:false,metadata:null,error:error.message};}
  }
  async status(){
    const [current,catalog,hardware]=await Promise.all([this.current(),this.catalog(),this.hardwarePromise||=detectNvidiaDetails(this.platform,this.hardwareRun)]);
    let validation={valid:false,metadata:null,error:null};
    if(current.ready){
      const key=current.python+'|'+current.version+'|'+current.archiveSha256;
      if(!this.validationCache||this.validationCache.key!==key||Date.now()-this.validationCache.at>30000)this.validationCache={key,at:Date.now(),promise:this.verify(current)};
      validation=await this.validationCache.promise;
    }
    return {...current,ready:current.ready&&validation.valid,filesPresent:current.ready,verified:validation.valid,validationError:validation.error,metadata:validation.metadata||current.metadata,hardware,phase:this.phase,error:this.error,progress:this.progress,variants:Object.keys(catalog.variants||{}),officialInstall:Boolean(catalog.variants?.cu124?.officialPip),version:catalog.version};
  }
  async choose(requested,catalog,signal){
    signal?.throwIfAborted();
    if(!['auto','cpu','cu124'].includes(requested))throw Error('无效的运行环境选项');
    if(requested!=='auto')return requested;
    return catalog.variants?.cu124&&await detectNvidia(this.platform,this.hardwareRun,signal)?'cu124':'cpu';
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
      const version=pack?.officialPip?catalog.version+'-'+OFFICIAL_CUDA_VERSION:catalog.version;
      if(current.ready&&current.flavor===flavor&&(!pack||(current.version===version&&current.archiveSha256===pack.archiveSha256))){const checked=await this.status();controller.signal.throwIfAborted();if(checked.ready){this.emit('ready');return checked;}}
      if(this.platform!=='win32')throw Error('一键运行环境适用于 Windows；开发环境请配置本机 Python。');
      if(!pack||!Array.isArray(pack.parts)||!pack.parts.length)throw Error('此版本尚未提供所选运行环境，请选择其他环境或稍后重试。');
      if(catalog.schemaVersion!==1||typeof catalog.version!=='string'||!catalog.version.trim()||catalog.version.length>64||!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(pack.id)||!/^[a-f0-9]{64}$/.test(pack.archiveSha256)||!Number.isSafeInteger(pack.unpackedBytes)||pack.unpackedBytes<1||pack.unpackedBytes>16*1024**3)throw Error('运行环境下载清单不合法');
      for(const part of pack.parts){safeEntry(this.root,part.path);if(!/^https:\/\/github\.com\/fqxxzyw\/Yukino-Companion\/releases\/download\//.test(part.url)||part.algorithm!=='sha256'||!/^[a-f0-9]{64}$/.test(part.digest)||!Number.isSafeInteger(part.bytes)||part.bytes<1)throw Error('运行环境文件清单不合法');}
      await fs.mkdir(this.root,{recursive:true});
      const disk=await fs.statfs(this.root),downloadBytes=pack.parts.reduce((a,p)=>a+p.bytes,0);
      controller.signal.throwIfAborted();
      if(disk.bavail*disk.bsize<pack.unpackedBytes+downloadBytes*2+(pack.officialPip?8*1024**3:256*1024**2))throw Error('磁盘空间不足，无法下载并解压运行环境。');
      const cache=path.join(this.root,'downloads',pack.id);
      this.downloader=new VoiceResources({root:cache,catalog:{packs:{runtime:{files:pack.parts,label:'共享推理运行环境'}}},fetcher:this.fetcher,notify:progress=>this.emit(progress.phase,{progress:{...progress,bytes:progress.received||0}})});
      const onAbort=()=>this.downloader?.cancel();controller.signal.addEventListener('abort',onAbort,{once:true});
      controller.signal.throwIfAborted();
      try{await this.downloader.install('runtime');}finally{controller.signal.removeEventListener('abort',onAbort);}controller.signal.throwIfAborted();
      const archive=path.join(cache,'runtime.zip');this.emit('assembling');
      const out=await fs.open(archive,'w');try{for(const part of pack.parts){for await(const chunk of createReadStream(safeEntry(cache,part.path))){controller.signal.throwIfAborted();let offset=0;while(offset<chunk.length){const written=await out.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw Error('运行环境文件写入失败');offset+=written.bytesWritten;}}}}finally{await out.close();}
      if(await hashFile(archive)!==pack.archiveSha256)throw Error('运行环境完整校验失败，请重新下载。');
      // A fresh directory is owned by this operation. Never remove a prior
      // deterministic destination: it may contain user data or be selected by
      // an older current.json whose metadata no longer matches the catalog.
      const nextStage=path.join(this.root,'runtime-'+crypto.randomUUID());
      await fs.mkdir(nextStage);stage=nextStage;this.emit('extracting',{progress:{bytes:0,total:pack.unpackedBytes}});
      let last=0;await extractRuntimeZip(archive,stage,{signal:controller.signal,maxBytes:pack.unpackedBytes,onProgress:progress=>{if(Date.now()-last>200){last=Date.now();this.emit('extracting',{progress:{bytes:progress.bytes,total:pack.unpackedBytes}});}}});
      const python=path.join(stage,'python-runtime/python.exe');await fs.access(python);
      const marker=JSON.parse(await fs.readFile(path.join(stage,'python-runtime/yukino-runtime-build.json'),'utf8'));
      if(marker.flavor!==(pack.officialPip?'cpu':flavor))throw Error('下载的运行环境类型与所选版本不一致。');
      this.emit('checking');
      let official=null;
      if(pack.officialPip)official=await installOfficialCuda({python,root:this.root,run:this.run,signal:controller.signal,notify:value=>this.emit(value.phase,{progress:value.progress})});
      this.emit('checking');
      const result=await this.run(python,['-X','utf8','-c',RUNTIME_PROBE],{windowsHide:true,timeout:180000,maxBuffer:1024**2,signal:controller.signal,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1'}});
      const metadata=validateProbe(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),flavor);controller.signal.throwIfAborted();
      if(official)await fs.writeFile(path.join(stage,'python-runtime/yukino-runtime-build.json'),JSON.stringify({...marker,flavor,installSource:'official-pip',commands:official.commands}));
      const directory=path.basename(stage);
      controller.signal.throwIfAborted();
      await fs.writeFile(path.join(this.root,'current.json.tmp'),JSON.stringify({directory,flavor,version,archiveSha256:pack.archiveSha256,metadata}));
      controller.signal.throwIfAborted();
      await fs.rename(path.join(this.root,'current.json.tmp'),path.join(this.root,'current.json'));
      this.validationCache={key:python+'|'+version+'|'+pack.archiveSha256,at:Date.now(),promise:Promise.resolve({valid:true,metadata,error:null})};
      stage=null; // The new pointer owns the validated directory from this point.
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
module.exports={RuntimeManager,extractRuntimeZip,safeEntry,hashFile,detectNvidia,detectNvidiaDetails};
