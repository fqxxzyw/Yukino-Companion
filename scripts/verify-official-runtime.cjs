// Windows Actions / user diagnostics. Uses the same production RuntimeManager.
const fs=require('node:fs/promises'),path=require('node:path');
const {RuntimeManager}=require('../electron/runtime-manager.cjs');
async function main(){
 const args=process.argv.slice(2),get=name=>{const index=args.indexOf(name);return index<0?null:args[index+1];};
 const directory=path.resolve(get('--directory')||'build/official-runtime-qa'),catalogPath=path.resolve(get('--catalog')||'build/runtime-distribution/runtime-catalog.json'),flavor=get('--flavor')||'cu124';
 await fs.mkdir(directory,{recursive:true});const report=path.join(directory,'official-runtime-qa.json');
 const manager=new RuntimeManager({dataRoot:directory,resourceRoot:path.join(directory,'unbundled'),catalogPath,notify:value=>{console.log(JSON.stringify(value));}});
 try{
  const status=await manager.install(flavor),python=path.resolve(status.python);
  if(!python.startsWith(directory+path.sep))throw Error('Installed Python is outside the selected directory');
  if(!status.verified||status.metadata?.cpuTensor!==true)throw Error('Runtime import/CPU tensor validation failed');
  if(flavor==='cu124'&&(!status.metadata.cudaBuild||!status.metadata.translationCudaBinary))throw Error('CUDA binaries not installed');
  const result={passed:true,flavor,directory,python,root:status.root,metadata:status.metadata,physicalGpuInference:status.metadata.gpuTensor===true,logPath:path.join(directory,'runtime','official-install.log'),note:'Installation/import/CPU tensor result; GPU inference requires gpuTensor=true and a separate model inference test.'};
  await fs.writeFile(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(report,JSON.stringify({passed:false,directory,flavor,error:error.message},null,2));throw error;}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
