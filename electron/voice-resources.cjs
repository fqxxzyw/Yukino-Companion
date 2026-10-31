const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { extractPinnedWeight } = require('./voice-archive.cjs');
const {downloadResource}=require('./resource-download.cjs');
const {resourceSources}=require('./resource-sources.cjs');
const {ResourceJobs}=require('./resource-jobs.cjs');

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

async function downloadGitBlob({file,dest,fetcher,signal,notify=()=>{}}){
  if(file.algorithm!=='sha1'||!/^[a-f0-9]{40}$/.test(file.digest)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>4*1024**2)throw Error('公共模型配置清单无效');
  const sources=resourceSources(file.url,file.sources),part=dest+'.part';let lastError;
  for(let index=0;index<sources.length;index++){
    signal?.throwIfAborted();const source=sources[index],bounded=AbortSignal.any([signal,AbortSignal.timeout(30000)].filter(Boolean));
    try{
      let offset=0;try{const stat=await fs.lstat(part);if(!stat.isFile()||stat.isSymbolicLink())throw Error('下载临时路径不是普通文件');offset=stat.size;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(offset>=file.bytes){await fs.rm(part,{force:true});offset=0;}
      notify({phase:'downloading',received:offset,engine:'https',sourceIndex:index,sourceCount:sources.length,sourceLabel:new URL(source).hostname,sourceSwitch:index>0});
      const response=await fetcher(source,{signal:bounded,headers:offset?{Range:`bytes=${offset}-`}:{}});
      if(![200,206].includes(response.status)||!response.body){await response.body?.cancel();throw Error(`下载配置失败 HTTP ${response.status}`);}
      if(response.status===200)offset=0;
      if(response.status===206){const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');if(!match||Number(match[1])!==offset||Number(match[2])!==file.bytes-1||Number(match[3])!==file.bytes){await response.body.cancel();throw Error('下载服务器返回了不匹配的续传范围');}}
      const hash=fileHash(file);if(offset)for await(const chunk of createReadStream(part))hash.update(chunk);let received=offset;
      const meter=new Transform({transform(chunk,encoding,done){received+=chunk.length;if(received>file.bytes)return done(Error('配置文件超出预期长度'));hash.update(chunk);notify({phase:'downloading',received,engine:'https',sourceIndex:index,sourceCount:sources.length,sourceLabel:new URL(source).hostname});done(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal:bounded});
      if(received!==file.bytes||hash.digest('hex')!==file.digest){await fs.rm(part,{force:true});throw Error('公共模型配置校验失败');}
      signal?.throwIfAborted();await fs.rename(part,dest);return;
    }catch(error){signal?.throwIfAborted();lastError=error;}
  }
  throw Error(`公共模型配置下载未完成，请打开“无法下载，寻求帮助”：${lastError?.message||'所有源均不可用'}`);
}

class VoiceResources {
  constructor({ root, catalog, bundledRoot=null, bundledPackId=null, fetcher=fetch, notify=()=>{} }) {
    Object.assign(this,{root,catalog,bundledRoot,bundledPackId,fetcher,notify});this.jobs=new ResourceJobs();this.controllers=new Map();this.status={phase:'idle'};
  }
  get controller(){return this.jobs.controller;}
  emit(status){this.status=status;this.notify({...status,activePacks:[...this.controllers.keys()]})}
  summary(){return { ...this.status,activePacks:[...this.controllers.keys()],root:this.root,packs:Object.entries(this.catalog.packs).map(([id,p])=>({id,label:p.label,kind:p.kind||'core',version:p.version,requiresReference:Boolean(p.requiresReference),bundled:id===this.bundledPackId,bytes:p.files.reduce((n,f)=>n+f.bytes,0)})) }}
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
      if(pack.kind==='voice'&&pack.paths){item.components={};item.componentDetails={};for(const key of ['gpt','sovits']){const files=pack.files.filter(file=>file.path===pack.paths[key]||file.extract?.path===pack.paths[key]);const component={...pack,files},managed=files.length>0&&await this.packAvailable(component,this.root),bundled=files.length>0&&item.id===this.bundledPackId&&await this.packAvailable(component,this.bundledRoot);item.components[key]=managed||bundled;item.componentDetails[key]={installed:managed||bundled,managed,canDelete:managed,path:safeDestination(managed?this.root:bundled?this.bundledRoot:this.root,pack.paths[key]),bytes:files.reduce((n,file)=>n+(file.extract?.bytes||file.bytes),0)};}}
    }
    summary.coreReady=Boolean(summary.packs.find(pack=>pack.id==='core')?.installed);
    return summary;
  }
  component(id,component){
    const pack=this.catalog.packs[id];
    if(!pack||pack.kind!=='voice'||!['gpt','sovits'].includes(component)||!pack.paths?.[component])throw Error('未知音色模型文件');
    const files=pack.files.filter(file=>file.path===pack.paths[component]||file.extract?.path===pack.paths[component]);
    if(!files.length)throw Error('音色文件不在受管理下载清单中');
    return {...pack,files};
  }
  async inspectSelectedWeight(component,filename){
    if(!['gpt','sovits'].includes(component))throw Error('未知音色模型文件');
    const extension=component==='gpt'?'.ckpt':'.pth';
    if(!filename)return {component,selected:false,readable:false,message:'尚未选择文件。'};
    if(!path.isAbsolute(filename)||path.extname(filename).toLowerCase()!==extension)throw Error(`请选择 ${extension} 音色权重文件。`);
    let stat;
    try{stat=await fs.stat(filename);if(!stat.isFile()||stat.size===0)throw Error('empty');const file=await fs.open(filename,'r');try{const first=Buffer.alloc(1);await file.read(first,0,1,0);}finally{await file.close();}}
    catch{ return {component,selected:true,path:filename,readable:false,message:'文件不存在、为空或没有读取权限，请重新选择。'}; }
    const packEntry=Object.entries(this.catalog.packs).find(([,pack])=>pack.kind==='voice'&&pack.paths?.[component]&&safeDestination(this.root,pack.paths[component])===path.resolve(filename));
    return {component,selected:true,path:filename,bytes:stat.size,readable:true,managed:Boolean(packEntry),packId:packEntry?.[0],message:'文件可读；权重版本、配对及推理兼容性需加载和试听验证。'};
  }
  async verifyComponent(id,component){
    const pack=this.component(id,component),managed=await this.packAvailable(pack,this.root,{hash:true}),bundled=id===this.bundledPackId&&await this.packAvailable(pack,this.bundledRoot,{hash:true});
    return {id,component,verified:managed||bundled,source:managed?'managed':bundled?'bundled':null,path:safeDestination(managed?this.root:bundled?this.bundledRoot:this.root,pack.paths[component]),message:managed||bundled?'大小与内容摘要校验通过；模型兼容性需实际加载验证。':'文件缺失或内容摘要不匹配，请重新下载。'};
  }
  async removeComponent(id,component){
    const pack=this.component(id,component);
    if(this.controller||this.deleting)throw Error('语音资源正在下载或删除，请完成或取消后再删除。');
    this.deleting=true;
    try{
    const targets=[...new Set(pack.files.flatMap(file=>[file.path,...(file.extract?[file.extract.path]:[])]).flatMap(relative=>[relative,relative+'.part',relative+'.https.partial',relative+'.aria2']))];
    const removable=[];
    // Only exact catalog files under the application-managed root may be removed.
    // Walk every existing parent: a symlink must not redirect removal elsewhere.
    for(const relative of targets){
      const target=safeDestination(this.root,relative),parts=path.relative(path.resolve(this.root),target).split(path.sep);let current=path.resolve(this.root),missing=false;
      for(const part of ['',...parts]){if(part)current=path.join(current,part);try{const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Error('受管理资源路径包含符号链接，已拒绝删除。');if(current!==target&&!stat.isDirectory())throw Error('受管理资源父路径不是文件夹。');if(current===target){if(!stat.isFile())throw Error('受管理资源不是普通文件，已拒绝删除。');removable.push(target);}}catch(error){if(error.code==='ENOENT'){missing=true;break;}throw error;}}
      if(missing)continue;
    }
    for(const target of removable)await fs.unlink(target);
    return {id,component,removed:removable,sharedPacks:Object.entries(this.catalog.packs).filter(([,item])=>item.paths?.[component]===pack.paths[component]).map(([key])=>key)};
    }finally{this.deleting=false;}
  }
  async install(id='core',{component,signal}={}) {
    if(this.deleting)throw Error('正在删除音色文件，请稍后再下载。');
    const original=this.catalog.packs[id];if(!original)throw Error('未知公共模型组件');
    if(component!==undefined&&(!['gpt','sovits'].includes(component)||original.kind!=='voice'||!original.paths?.[component]))throw Error('未知音色模型文件');
    const pack=component?{...original,files:original.files.filter(file=>file.path===original.paths[component]||file.extract?.path===original.paths[component])}:original;
    if(!pack.files.length)throw Error('音色文件不在下载清单中');
    const key=component?`${id}:${component}`:id,targets=new Set(pack.files.flatMap(file=>[safeDestination(this.root,file.path),...(file.extract?[safeDestination(this.root,file.extract.path)]:[])]).map(value=>value.toLowerCase()));
    return this.jobs.run(key,controller=>this.installTask({id,component,pack,key,targets,controller}),{signal,targets});
  }
  async installTask({id,component,pack,key,targets,controller}) {
    controller.targets=targets;this.controllers.set(key,controller);
    const voicePaths=root=>({...Object.fromEntries((component?[component]:['gpt','sovits']).map(name=>[name,safeDestination(root,pack.paths[name])])),version:pack.version,textLang:'all_ja'});
    const total=pack.files.reduce((n,f)=>n+f.bytes,0);let failure=null;
    const files=pack.files.map(file=>({file:file.path,received:0,total:file.bytes,phase:'pending'}));
    const fileProgress=(index,progress)=>{
      const file=pack.files[index],received=progress.received??0;
      files[index]={...files[index],phase:progress.phase,received};
      this.emit({...progress,phase:progress.phase==='complete'?'checking':progress.phase,packId:id,file:file.path,fileIndex:index,fileCount:files.length,fileReceived:received,fileTotal:file.bytes,files:files.map(item=>({...item})),received:files.reduce((sum,item)=>sum+item.received,0),total});
    };
    try {
    if(pack.kind==='voice'&&id===this.bundledPackId&&await this.packAvailable(pack,this.bundledRoot,{hash:true})){
      controller.signal.throwIfAborted();
      this.controllers.delete(key);
      this.emit({phase:'complete',source:'bundled',packId:id,received:0,total:0});
      return voicePaths(this.bundledRoot);
    }
      await fs.mkdir(this.root,{recursive:true});
      const destinations=pack.files.map(file=>safeDestination(this.root,file.path));
      if(new Set(destinations.map(item=>item.toLowerCase())).size!==destinations.length)throw Error('资源清单包含重复文件');
      const cached=await Promise.all(pack.files.map((file,index)=>verified(destinations[index],file)));
      const extracted=await Promise.all(pack.files.map(file=>file.extract?verified(safeDestination(this.root,file.extract.path),{bytes:file.extract.bytes,algorithm:'sha256',digest:file.extract.digest}):true));
      controller.signal.throwIfAborted();
      const required=pack.files.reduce((sum,file,index)=>sum+(cached[index]?0:file.bytes*2)+(extracted[index]?0:file.extract.bytes),0);
      if(required){const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<required+128*1024*1024)throw Error('磁盘剩余空间不足，请释放空间后重试');}
      let next=0;
      const downloadOne=async(index)=>{
        const file=pack.files[index];
        controller.signal.throwIfAborted();
        const dest=destinations[index];
        fileProgress(index,{phase:'checking',received:0});
        if(cached[index]){fileProgress(index,{phase:'checking',received:file.bytes,engine:'cache'});await this.extract(file,dest,controller.signal,()=>fileProgress(index,{phase:'extracting',received:file.bytes}));controller.signal.throwIfAborted();fileProgress(index,{phase:'complete',received:file.bytes,engine:'cache'});return;}
        controller.signal.throwIfAborted();
        await fs.mkdir(path.dirname(dest),{recursive:true});
        if(file.algorithm==='sha256'){
          // Older releases used .part for contiguous HTTPS bytes. Adopt only a
          // regular file when the new HTTPS partial does not already exist.
          try{await fs.access(dest+'.https.partial');}catch(error){if(error.code!=='ENOENT')throw error;try{const legacy=await fs.lstat(dest+'.part');if(legacy.isFile()&&!legacy.isSymbolicLink()&&legacy.size<file.bytes)await fs.rename(dest+'.part',dest+'.https.partial');}catch(legacyError){if(legacyError.code!=='ENOENT')throw legacyError;}}
          controller.signal.throwIfAborted();
          await downloadResource({url:file.url,sources:resourceSources(file.url,file.sources),dest,bytes:file.bytes,sha256:file.digest,fetcher:this.fetcher,signal:controller.signal,onProgress:progress=>fileProgress(index,progress)});
          controller.signal.throwIfAborted();await this.extract(file,dest,controller.signal,()=>fileProgress(index,{phase:'extracting',received:file.bytes}));fileProgress(index,{phase:'complete',received:file.bytes});return;
        }
        await downloadGitBlob({file,dest,fetcher:this.fetcher,signal:controller.signal,notify:progress=>fileProgress(index,progress)});fileProgress(index,{phase:'complete',received:file.bytes,engine:'https'});
        await this.extract(file,dest,controller.signal,()=>fileProgress(index,{phase:'extracting',received:file.bytes}));fileProgress(index,{phase:'complete',received:file.bytes});
      };
      const worker=async()=>{while(next<pack.files.length&&!controller.signal.aborted){const index=next++;try{await downloadOne(index);}catch(error){if(!controller.signal.aborted){failure=error;controller.abort(error);}return;}}};
      // Independent files and their real release parts progress concurrently.
      // Wait for every worker to stop before reporting errors or cleaning up.
      await Promise.all(Array.from({length:Math.min(24,pack.files.length)},worker));
      if(failure)throw failure;
      controller.signal.throwIfAborted();
      this.controllers.delete(key);this.emit({phase:'complete',packId:id,files:files.map(item=>({...item})),received:total,total});
      if(pack.kind==='voice')return voicePaths(this.root);
      return {bert:path.join(this.root,'chinese-roberta-wwm-ext-large'),hubert:path.join(this.root,'chinese-hubert-base')};
    }catch(e){const cancelled=controller.signal.aborted&&!failure;this.controllers.delete(key);this.emit({...this.status,packId:id,phase:cancelled?'cancelled':'error',error:cancelled?'已取消，保留可续传的临时文件':e.message,total});throw e}
    finally{if(this.controllers.get(key)===controller)this.controllers.delete(key);}
  }
  async extract(file,archive,signal,report=()=>{}){
    if(!file.extract)return;
    const item=file.extract,destination=safeDestination(this.root,item.path);
    if(await verified(destination,{bytes:item.bytes,algorithm:'sha256',digest:item.digest}))return;
    const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<item.bytes+128*1024*1024)throw Error('磁盘剩余空间不足，无法解压语音权重');
    report();
    await extractPinnedWeight({archive,member:item.member,destination,bytes:item.bytes,digest:item.digest,signal});
  }
  cancel(){this.jobs.cancel()}
}
module.exports={VoiceResources,verified,safeDestination};
