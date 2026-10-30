const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {officialCudaCommands,installOfficialCuda,validateProbe}=require('../electron/official-runtime.cjs');
test('official CUDA commands pin matching upstream binary wheels and never compile or target user Python',()=>{
 const commands=officialCudaCommands('D:\\Yukino Data\\pip-cache');assert.equal(commands.length,2);
 assert.ok(commands[0].args.includes('torch==2.5.1'));assert.ok(commands[0].args.includes('torchaudio==2.5.1'));
 assert.ok(commands[0].args.includes('https://download.pytorch.org/whl/cu124'));
 assert.ok(commands[1].args.includes('llama-cpp-python==0.3.36'));assert.ok(commands[1].args.includes('https://abetlen.github.io/llama-cpp-python/whl/cu124'));
 for(const command of commands){assert.ok(command.args.includes('--only-binary=:all:'));assert.ok(command.args.includes('--isolated'));assert.ok(!command.args.includes('--user'));}
});
test('official installation keeps cache, temporary files and complete command logs in the selected resource directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-official-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const events=[],calls=[],python=path.join(root,'staged Python','python.exe'),signal=new AbortController().signal;
 const installed=await installOfficialCuda({python,root,signal,notify:value=>events.push(value),run:async(executable,args,options)=>{
  calls.push({executable,args,options});return {stdout:'Downloading upstream wheel\nSuccessfully installed\n'};
 }});
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.executable,python);assert.equal(call.options.shell,undefined);assert.equal(call.options.signal,signal);assert.equal(call.options.env.TMP,path.join(root,'pip-temp'));assert.equal(call.args[call.args.indexOf('--cache-dir')+1],path.join(root,'pip-cache'));}
 const log=await fs.readFile(installed.logPath,'utf8');assert.match(log,/torch==2\.5\.1/);assert.match(log,/llama-cpp-python==0\.3\.36/);assert.match(log,/Successfully installed/);
 assert.ok(events.some(event=>event.progress.log.includes('Downloading upstream wheel')));assert.ok(events.every(event=>event.phase==='installing'));
});
test('failed official install preserves its diagnosis and never runs later commands',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-official-fail-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0;
 await assert.rejects(installOfficialCuda({python:'managed-python.exe',root,run:async()=>{calls++;throw Object.assign(Error('upstream disconnected'),{stderr:'could not reach download.pytorch.org'});}}),/官方安装失败.*download.pytorch.org/);
 assert.equal(calls,1);assert.match(await fs.readFile(path.join(root,'official-install.log'),'utf8'),/upstream disconnected/);
});
test('CUDA package installation is separate from physical device validation and incomplete builds are rejected',()=>{
 const metadata={cpuTensor:true,cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:false,gpuTensor:false};
 assert.equal(validateProbe(metadata,'cu124'),metadata,'a GPU-less Windows build can prove dependencies installed without pretending device inference passed');
 assert.throws(()=>validateProbe({...metadata,cudaBuild:null},'cu124'),/CUDA/);assert.throws(()=>validateProbe({...metadata,translationCudaBinary:false},'cu124'),/CUDA/);assert.throws(()=>validateProbe({...metadata,cpuTensor:false},'cpu'),/CPU/);
});
