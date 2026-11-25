const path=require('node:path');
const fs=require('node:fs/promises');
// Upstream binary installation commands with verified official and mirror
// routes. The verified base runtime supplies Python and GPT-SoVITS; no
// compiler or CUDA toolkit is needed.
const OFFICIAL_CUDA_VERSION='official-cu124-1';
const CUDA_SOURCE_MODES=Object.freeze(['auto','official','mirror']);
const R2_CUDA_WHEELS_INDEX='https://dl.yukino.fqxxzyw.cn/wheels/cu124/llama-cpp-python/index.html';

function normalizeSourceMode(sourceMode='official'){
 return CUDA_SOURCE_MODES.includes(sourceMode)?sourceMode:'official';
}

function officialCudaCommands(cache,{sourceMode='official'}={}){
 const mode=normalizeSourceMode(sourceMode);
 const common=['-m','pip','--isolated','--disable-pip-version-check','install','--no-input','--retries','3','--timeout','60','--cache-dir',cache];
 const pytorchOfficial={
  id:'pytorch-official',
  kind:'official',
  label:'PyTorch 官方源 (download.pytorch.org)',
  args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','--index-url','https://download.pytorch.org/whl/cu124'],
 };
 const pytorchMirrors=[
  {
   id:'nju-mirror',
   kind:'mirror',
   label:'南京大学镜像源 (mirror.nju.edu.cn)',
   args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','--index-url','https://mirror.nju.edu.cn/pytorch/whl/cu124','--extra-index-url','https://mirror.nju.edu.cn/pypi/web/simple'],
  },
  {
   id:'aliyun-mirror',
   kind:'mirror',
   label:'阿里云镜像源 (mirrors.aliyun.com)',
   args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','-f','https://mirrors.aliyun.com/pytorch-wheels/cu124/','--index-url','https://mirrors.aliyun.com/pypi/simple'],
  },
  {
   id:'tencent-aliyun-mirror',
   kind:'mirror',
   label:'腾讯云 PyPI + 阿里云 PyTorch 镜像',
   args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','-f','https://mirrors.aliyun.com/pytorch-wheels/cu124/','--index-url','https://mirrors.cloud.tencent.com/pypi/simple'],
  },
  {
   id:'ustc-aliyun-mirror',
   kind:'mirror',
   label:'中科大 PyPI + 阿里云 PyTorch 镜像',
   args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','-f','https://mirrors.aliyun.com/pytorch-wheels/cu124/','--index-url','https://pypi.mirrors.ustc.edu.cn/simple'],
  },
 ];
 const llamaOfficial={
  id:'abetlen-official',
  kind:'official',
  label:'官方源 (abetlen.github.io)',
  args:[...common,'--upgrade','--force-reinstall','--no-deps','--only-binary=:all:','llama-cpp-python==0.3.36','--index-url','https://abetlen.github.io/llama-cpp-python/whl/cu124'],
 };
 const llamaR2Mirror={
  id:'yukino-r2-mirror',
  kind:'mirror',
  label:'国内加速镜像 (dl.yukino.fqxxzyw.cn)',
  args:[...common,'--upgrade','--force-reinstall','--no-deps','--only-binary=:all:','llama-cpp-python==0.3.36','--no-index','-f',R2_CUDA_WHEELS_INDEX],
 };
 // Official PyTorch is already served from global Cloudflare R2, so in "auto"
 // mode try official first then China mirrors; llama-cpp-python official redirects
 // to GitHub Releases, so in "auto" mode prefer our R2 mirror then official.
 const pytorchRoutes=mode==='mirror'?[...pytorchMirrors,pytorchOfficial]:[pytorchOfficial,...pytorchMirrors];
 const llamaRoutes=mode==='official'?[llamaOfficial,llamaR2Mirror]:[llamaR2Mirror,llamaOfficial];
 return [
  {id:'pytorch-cu124',label:'PyTorch CUDA 12.4',args:pytorchRoutes[0].args,routes:pytorchRoutes},
  {id:'llama-cpp-cu124',label:'llama.cpp CUDA 12.4（对话与翻译）',args:llamaRoutes[0].args,routes:llamaRoutes},
 ];
}

const RUNTIME_PROBE=String.raw`import os,sys,json
library=os.path.join(sys.prefix,'Lib','site-packages','torch','lib')
handle=os.add_dll_directory(library) if hasattr(os,'add_dll_directory') and os.path.isdir(library) else None
import torch,torchaudio,importlib.util
spec=importlib.util.find_spec('llama_cpp')
llama_library=os.path.join(os.path.dirname(spec.origin),'lib') if spec and spec.origin else ''
cuda_binary=bool(llama_library and any('cuda' in name.lower() and name.lower().endswith(('.dll','.so')) for name in os.listdir(llama_library)))
if sys.platform=='win32' and cuda_binary and not os.path.isfile(os.path.join(os.environ.get('SystemRoot',r'C:\Windows'),'System32','nvcuda.dll')):
 raise RuntimeError('CUDA packages were installed, but the NVIDIA display driver (nvcuda.dll) is missing. Install the official NVIDIA driver or select the CPU environment.')
import llama_cpp
cpu=torch.ones(2).sum().item()==2
available=bool(torch.cuda.is_available())
gpu=False
gpu_error=None
if available:
 try:
  value=torch.ones(2,device='cuda').sum()
  torch.cuda.synchronize()
  gpu=bool(torch.isfinite(value).item() and value.item()==2)
 except Exception as error:
  gpu_error=str(error)
print(json.dumps({'torch':torch.__version__,'cudaBuild':torch.version.cuda,'translationCudaBinary':cuda_binary,'gpuError':gpu_error,'torchaudio':torchaudio.__version__,'llamaCpp':llama_cpp.__version__,'cpuTensor':cpu,'gpuAvailable':available,'gpuTensor':gpu,'gpuName':torch.cuda.get_device_name(0) if available else None,'translationGpuBuild':bool(llama_cpp.llama_supports_gpu_offload()),'validation':'imports-and-tensor'}))`;

function validateProbe(metadata,flavor){
 if(!metadata||metadata.cpuTensor!==true)throw Error('Python 推理依赖检查失败：CPU 张量测试未通过。');
 if(flavor==='cu124'&&(!metadata.cudaBuild||!metadata.translationCudaBinary))throw Error('官方 CUDA 包安装结果不完整：缺少 PyTorch CUDA 构建或 llama.cpp CUDA 库。请查看安装日志后重试。');
 return metadata;
}

async function installOfficialCuda({python,root,run,signal,sourceMode='auto',notify=()=>{}}){
 const cache=path.join(root,'pip-cache'),temporary=path.join(root,'pip-temp'),logPath=path.join(root,'official-install.log');
 await fs.mkdir(cache,{recursive:true});await fs.mkdir(temporary,{recursive:true});
 const mode=normalizeSourceMode(sourceMode);
 const commands=officialCudaCommands(cache,{sourceMode:mode});
 const installed=[];
 let log='';
 for(let index=0;index<commands.length;index++){
  signal?.throwIfAborted();
  const command=commands[index];
  const routes=Array.isArray(command.routes)&&command.routes.length?command.routes:[{id:'default',kind:'official',label:command.label,args:command.args}];
  let succeeded=null,lastError=null;
  for(let routeIndex=0;routeIndex<routes.length;routeIndex++){
   signal?.throwIfAborted();
   const route=routes[routeIndex];
   const sourceLabel=`${command.label} · ${route.label}`;
   const heading=`\n[${index+1}/${commands.length}] ${command.label}（路线 ${routeIndex+1}/${routes.length}：${route.label}）\n${python} ${route.args.join(' ')}\n`;
   await fs.appendFile(logPath,heading);
   log=(log+heading).slice(-12000);
   const report=()=>notify({
    phase:'installing',
    progress:{
     engine:'pip',
     sourceLabel,
     sourceId:route.id,
     sourceKind:route.kind,
     sourceIndex:routeIndex,
     sourceCount:routes.length,
     sourceSwitch:routeIndex>0,
     fallback:routeIndex>0,
     step:index+1,
     steps:commands.length,
     log,
     logPath,
    },
   });
   report();
   const pending=run(python,['-X','utf8',...route.args],{windowsHide:true,timeout:60*60*1000,maxBuffer:16*1024**2,signal,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',TMP:temporary,TEMP:temporary}});
   const chunks=[];
   const receive=chunk=>{const text=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');chunks.push(text);log=(log+text).slice(-12000);report();};
   pending.child?.stdout?.on('data',receive);pending.child?.stderr?.on('data',receive);
   try{
    const result=await pending;
    if(!pending.child){receive(result.stdout||'');receive(result.stderr||'');}
    await fs.appendFile(logPath,chunks.join(''));
    succeeded=route;
    break;
   }catch(error){
    const detail=String(error.stderr||error.stdout||error.message);
    await fs.appendFile(logPath,chunks.join('')+'\nERROR ('+route.label+'): '+error.message+'\n');
    if(signal?.aborted)throw error;
    lastError={route,detail,error};
    if(routeIndex<routes.length-1){
     const switchNote=`\n[切换路线] ${route.label} 未成功，正在自动尝试下一路线：${routes[routeIndex+1].label}\n`;
     await fs.appendFile(logPath,switchNote);
     log=(log+switchNote).slice(-12000);
     report();
    }
   }
  }
  if(!succeeded){
   throw Error(`${command.label} 官方安装失败（已尝试 ${routes.length} 条路线）：${String(lastError?.detail||'未知错误').slice(-1800)}。日志：${logPath}`);
  }
  installed.push({id:command.id,label:command.label,routeId:succeeded.id,routeLabel:succeeded.label,routeKind:succeeded.kind,args:succeeded.args});
 }
 return {sourceMode:mode,commands:installed,logPath};
}

module.exports={OFFICIAL_CUDA_VERSION,CUDA_SOURCE_MODES,R2_CUDA_WHEELS_INDEX,normalizeSourceMode,officialCudaCommands,RUNTIME_PROBE,validateProbe,installOfficialCuda};
