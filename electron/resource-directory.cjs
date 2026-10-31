const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');

function absoluteDirectory(value){return typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\0')&&path.isAbsolute(value);}
function sameDirectory(first,second){return absoluteDirectory(first)&&absoluteDirectory(second)&&path.relative(path.resolve(first),path.resolve(second))==='';}
function installationScope({packaged,executable,sourceRoot}){
  const directory=packaged&&absoluteDirectory(executable)?path.dirname(executable):!packaged?sourceRoot:null;
  if(!absoluteDirectory(directory))throw Error('当前安装目录无效');
  return path.resolve(directory);
}
const scopedResourceNames=new Set(['speech.json','translation.json','local-chat.json','resource-directory.json','speech-cache.json','speech-cache']);
// Keep credentials/chat/profile data where they are. Only resource selections,
// their atomic-write siblings and speech cache belong to an installation.
function installationResourceLocation(options,name){
  const target=name.endsWith('.json.tmp')?name.slice(0,-4):name;
  if(!scopedResourceNames.has(target))return path.join(options.userData,name);
  const scope=installationScope(options),key=process.platform==='win32'?scope.toLowerCase():scope;
  return path.join(options.userData,'installations',createHash('sha256').update(key).digest('hex'),name);
}

// The installer places the EXE at the root chosen by the user. Keep downloaded
// payloads separate from app files and leave the Electron profile unchanged.
function defaultResourceDirectory({packaged,executable,userData}){
  return packaged ? path.join(path.dirname(executable),'Yukino-Data') : userData;
}
function selectResourceDirectory({configured,configuredInstallDirectory,installDirectory,packaged,executable,userData}){
  // A profile can outlive the executable. An unbound or differently bound old
  // choice must never make a new installation use another installation's data.
  if((installDirectory===undefined||sameDirectory(installDirectory,configuredInstallDirectory))&&absoluteDirectory(configured))return path.resolve(configured);
  return defaultResourceDirectory({packaged,executable,userData});
}
async function assertWritableDirectory(dir){
  let probe;
  try{
    await fs.mkdir(dir,{recursive:true});
    probe=await fs.mkdtemp(path.join(dir,'.yukino-write-test-'));
  }catch(error){
    throw Error(`资源目录不可写：${dir}。请在首次配置中选择有写入权限的目录，重启应用后再下载。`);
  }finally{if(probe)await fs.rmdir(probe).catch(()=>{});}
}
// Persist only resource roots that this application has actually selected.
// Paths outside the known managed subdirectories are always user custom paths.
function resourceDirectoryHistory(values=[]){
  if(!Array.isArray(values))return [];
  return [...new Set(values.filter(value=>typeof value==='string'&&value.length<=4096&&!value.includes('\0')&&path.isAbsolute(value)).map(value=>path.resolve(value)).filter(value=>value!==path.parse(value).root))];
}
function resourceDirectoryRecord(directory,{currentDirectory,previousDirectories=[],installDirectory}={}){
  const selected=path.resolve(directory);
  if(installDirectory!==undefined&&!absoluteDirectory(installDirectory))throw Error('当前安装目录无效');
  return {directory:selected,previousDirectories:resourceDirectoryHistory([currentDirectory,...resourceDirectoryHistory(previousDirectories)]).filter(value=>value!==selected),...(installDirectory===undefined?{}:{installDirectory:path.resolve(installDirectory)})};
}
function insideResourceRoot(value,root){const relative=path.relative(root,value);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function rebaseManagedResourcePath(value,{dataRoot,legacyDataRoot,previousDirectories=[],managedDirectories=[]}){
  if(typeof value!=='string'||!value||!path.isAbsolute(value))return value;
  const selected=path.resolve(dataRoot),filename=path.resolve(value);
  if(insideResourceRoot(filename,selected))return value;
  // Most specific root first: an earlier chosen directory can be nested under
  // another known root, and it must retain its own relative managed layout.
  const oldRoots=resourceDirectoryHistory([legacyDataRoot,...resourceDirectoryHistory(previousDirectories)]).filter(root=>root!==selected).sort((a,b)=>b.length-a.length);
  for(const root of oldRoots){
    if(!insideResourceRoot(filename,root))continue;
    const relative=path.relative(root,filename);
    if(managedDirectories.includes(relative.split(path.sep)[0]))return path.join(selected,relative);
  }
  return value;
}
// For explicit import/recovery of a saved configuration, expose only paths
// belonging to this installation until the user confirms an external choice.
// Keep the original record (including custom paths/text) untouched on disk.
function isolateResourceConfiguration(saved={}, {installDirectory,configuredInstallDirectory,dataRoot,resourceRoot,pathFields=['root','python','ffmpeg','bert','hubert','gpt','sovits','reference','modelDir']}={}){
  const active={...saved},inactive={};
  if(installDirectory===undefined||sameDirectory(installDirectory,configuredInstallDirectory))return {active,inactive};
  const roots=[dataRoot,resourceRoot].filter(absoluteDirectory).map(root=>path.resolve(root));
  for(const field of pathFields){
    const value=saved[field];
    if(typeof value!=='string'||!value)continue;
    if(absoluteDirectory(value)&&roots.some(root=>insideResourceRoot(path.resolve(value),root)))continue;
    inactive[field]=value;active[field]='';
  }
  return {active,inactive};
}
// Selection is exclusive with downloads/imports, including while awaiting the
// native directory dialog and filesystem work. Operations reserve their slot
// synchronously, before their first await.
class ResourceDirectoryGate {
  constructor(){this.selecting=false;this.operations=0;this.pending=null;}
  async run(action){
    if(this.selecting)throw Error('正在选择资源目录，请先完成选择。');
    if(this.pending)throw Error('已选择新的资源目录，请先重启应用，再开始下载。');
    this.operations++;
    try{return await action();}finally{this.operations--;}
  }
  async select(action,externallyBusy=()=>false){
    if(this.selecting||this.operations||externallyBusy())throw Error('正在选择目录或安装资源，请先等待完成或取消。');
    this.selecting=true;
    try{return await action();}finally{this.selecting=false;}
  }
}
module.exports={defaultResourceDirectory,selectResourceDirectory,assertWritableDirectory,ResourceDirectoryGate,rebaseManagedResourcePath,resourceDirectoryRecord,resourceDirectoryHistory,installationScope,installationResourceLocation,isolateResourceConfiguration};
