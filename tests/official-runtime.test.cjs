const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {officialCudaCommands,installOfficialCuda,validateProbe,R2_CUDA_WHEELS_INDEX}=require('../electron/official-runtime.cjs');

test('official CUDA commands pin matching upstream binary wheels and expose verified official and mirror routes',()=>{
 const commands=officialCudaCommands('D:\\Yukino Data\\pip-cache');
 assert.equal(commands.length,2);
 assert.ok(commands[0].args.includes('torch==2.5.1'));
 assert.ok(commands[0].args.includes('torchaudio==2.5.1'));
 assert.ok(commands[0].args.includes('https://download.pytorch.org/whl/cu124'));
 assert.ok(commands[0].routes.length>=4);
 assert.ok(commands[0].routes.some(r=>r.args.includes('https://mirror.nju.edu.cn/pytorch/whl/cu124')));
 assert.ok(commands[0].routes.some(r=>r.args.includes('https://mirrors.aliyun.com/pytorch-wheels/cu124/')));
 assert.ok(commands[1].args.includes('llama-cpp-python==0.3.36'));
 assert.ok(commands[1].args.includes('https://abetlen.github.io/llama-cpp-python/whl/cu124'));
 assert.ok(commands[1].routes.some(r=>r.args.includes(R2_CUDA_WHEELS_INDEX)));
 for(const command of commands){
  for(const route of command.routes){
   assert.ok(route.args.includes('--only-binary=:all:'));
   assert.ok(route.args.includes('--isolated'));
   assert.ok(!route.args.includes('--user'));
  }
 }
 const mirrorFirst=officialCudaCommands('D:\\Yukino Data\\pip-cache',{sourceMode:'mirror'});
 assert.equal(mirrorFirst[0].routes[0].kind,'mirror');
 assert.equal(mirrorFirst[0].routes.at(-1).kind,'official');
 assert.ok(mirrorFirst[1].routes[0].args.includes(R2_CUDA_WHEELS_INDEX));
 const autoMode=officialCudaCommands('D:\\Yukino Data\\pip-cache',{sourceMode:'auto'});
 assert.equal(autoMode[0].routes[0].kind,'official');
 assert.ok(autoMode[1].routes[0].args.includes(R2_CUDA_WHEELS_INDEX));
});

test('official installation keeps cache, temporary files and complete command logs in the selected resource directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-official-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const events=[],calls=[],python=path.join(root,'staged Python','python.exe'),signal=new AbortController().signal;
 const installed=await installOfficialCuda({python,root,signal,notify:value=>events.push(value),run:async(executable,args,options)=>{
  calls.push({executable,args,options});return {stdout:'Downloading upstream wheel\nSuccessfully installed\n'};
 }});
 assert.equal(calls.length,2);
 for(const call of calls){
  assert.equal(call.executable,python);
  assert.equal(call.options.shell,undefined);
  assert.equal(call.options.signal,signal);
  assert.equal(call.options.env.TMP,path.join(root,'pip-temp'));
  assert.equal(call.args[call.args.indexOf('--cache-dir')+1],path.join(root,'pip-cache'));
 }
 const log=await fs.readFile(installed.logPath,'utf8');
 assert.match(log,/torch==2\.5\.1/);
 assert.match(log,/llama-cpp-python==0\.3\.36/);
 assert.match(log,/Successfully installed/);
 assert.ok(events.some(event=>event.progress.log.includes('Downloading upstream wheel')));
 assert.ok(events.every(event=>event.phase==='installing'));
});

test('CUDA installation automatically falls back to mirror routes when primary route fails',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-official-fallback-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const tried=[],events=[];
 const installed=await installOfficialCuda({
  python:'managed-python.exe',
  root,
  sourceMode:'official',
  notify:v=>events.push(v),
  run:async(_exe,args)=>{
   const idx=args.includes('--index-url')?args[args.indexOf('--index-url')+1]:args.includes('-f')?args[args.indexOf('-f')+1]:'';
   tried.push(idx);
   if(idx.includes('download.pytorch.org')||idx.includes('abetlen.github.io')){
    throw Object.assign(Error('network timeout'),{stderr:'connection timed out'});
   }
   return {stdout:'Successfully installed via mirror\n'};
  },
 });
 assert.equal(tried[0],'https://download.pytorch.org/whl/cu124');
 assert.equal(tried[1],'https://mirror.nju.edu.cn/pytorch/whl/cu124');
 assert.equal(tried[2],'https://abetlen.github.io/llama-cpp-python/whl/cu124');
 assert.equal(tried[3],R2_CUDA_WHEELS_INDEX);
 assert.equal(installed.commands[0].routeId,'nju-mirror');
 assert.equal(installed.commands[1].routeId,'yukino-r2-mirror');
 assert.ok(events.some(e=>e.progress.sourceSwitch===true));
});

test('failed official install exhausts step routes, preserves diagnosis and never runs later steps',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-official-fail-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const calledPackages=[];
 await assert.rejects(installOfficialCuda({python:'managed-python.exe',root,run:async(_exe,args)=>{
  calledPackages.push(args.includes('llama-cpp-python==0.3.36')?'llama':'torch');
  throw Object.assign(Error('upstream disconnected'),{stderr:'could not reach mirror'});
 }}),/官方安装失败.*已尝试.*条路线.*could not reach mirror/);
 assert.ok(calledPackages.length>=4);
 assert.ok(calledPackages.every(p=>p==='torch'),'step 2 must never run when step 1 exhausts all routes');
 assert.match(await fs.readFile(path.join(root,'official-install.log'),'utf8'),/upstream disconnected/);
});

test('CUDA package installation is separate from physical device validation and incomplete builds are rejected',()=>{
 const metadata={cpuTensor:true,cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:false,gpuTensor:false};
 assert.equal(validateProbe(metadata,'cu124'),metadata,'a GPU-less Windows build can prove dependencies installed without pretending device inference passed');
 assert.throws(()=>validateProbe({...metadata,cudaBuild:null},'cu124'),/CUDA/);
 assert.throws(()=>validateProbe({...metadata,translationCudaBinary:false},'cu124'),/CUDA/);
 assert.throws(()=>validateProbe({...metadata,cpuTensor:false},'cpu'),/CPU/);
});
