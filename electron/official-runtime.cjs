const path=require('node:path');
const fs=require('node:fs/promises');
// These are upstream binary installation commands. The existing, verified base
// runtime supplies Python and GPT-SoVITS; no compiler or CUDA toolkit is needed.
const OFFICIAL_CUDA_VERSION='official-cu124-1';
function officialCudaCommands(cache){
 const common=['-m','pip','--isolated','--disable-pip-version-check','install','--no-input','--retries','3','--timeout','60','--cache-dir',cache];
 return [
  {label:'PyTorch CUDA 12.4',args:[...common,'--upgrade','--force-reinstall','--only-binary=:all:','torch==2.5.1','torchaudio==2.5.1','--index-url','https://download.pytorch.org/whl/cu124']},
  {label:'llama.cpp CUDA 12.4（对话与翻译）',args:[...common,'--upgrade','--force-reinstall','--no-deps','--only-binary=:all:','llama-cpp-python==0.3.36','--index-url','https://abetlen.github.io/llama-cpp-python/whl/cu124']},
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
async function installOfficialCuda({python,root,run,signal,notify=()=>{}}){
 const cache=path.join(root,'pip-cache'),temporary=path.join(root,'pip-temp'),logPath=path.join(root,'official-install.log');
 await fs.mkdir(cache,{recursive:true});await fs.mkdir(temporary,{recursive:true});
 const commands=officialCudaCommands(cache);let log='';
 for(let index=0;index<commands.length;index++){
  signal?.throwIfAborted();const command=commands[index];
  const heading=`\n[${index+1}/${commands.length}] ${command.label}\n${python} ${command.args.join(' ')}\n`;
  await fs.appendFile(logPath,heading);log=(log+heading).slice(-12000);
  const report=()=>notify({phase:'installing',progress:{engine:'pip',sourceLabel:command.label,step:index+1,steps:commands.length,log,logPath}});report();
  const pending=run(python,['-X','utf8',...command.args],{windowsHide:true,timeout:60*60*1000,maxBuffer:16*1024**2,signal,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',TMP:temporary,TEMP:temporary}});
  const chunks=[];
  const receive=chunk=>{const text=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');chunks.push(text);log=(log+text).slice(-12000);report();};
  pending.child?.stdout?.on('data',receive);pending.child?.stderr?.on('data',receive);
  try{
   const result=await pending;
   if(!pending.child){receive(result.stdout||'');receive(result.stderr||'');}
   await fs.appendFile(logPath,chunks.join(''));
  }catch(error){
   await fs.appendFile(logPath,chunks.join('')+'\nERROR: '+error.message+'\n');
   if(signal?.aborted)throw error;
   throw Error(`${command.label} 官方安装失败：${String(error.stderr||error.stdout||error.message).slice(-1800)}。日志：${logPath}`);
  }
 }
 return {commands:commands.map(command=>({label:command.label,args:command.args})),logPath};
}
module.exports={OFFICIAL_CUDA_VERSION,officialCudaCommands,RUNTIME_PROBE,validateProbe,installOfficialCuda};
