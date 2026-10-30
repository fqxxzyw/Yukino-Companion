const fs=require('node:fs/promises');
const path=require('node:path');

// The installer places the EXE at the root chosen by the user. Keep downloaded
// payloads separate from app files and leave the Electron profile unchanged.
function defaultResourceDirectory({packaged,executable,userData}){
  return packaged ? path.join(path.dirname(executable),'Yukino-Data') : userData;
}
function selectResourceDirectory({configured,packaged,executable,userData}){
  if(typeof configured==='string' && configured.length<=4096 && !configured.includes('\0') && path.isAbsolute(configured)) return path.resolve(configured);
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
module.exports={defaultResourceDirectory,selectResourceDirectory,assertWritableDirectory,ResourceDirectoryGate};
