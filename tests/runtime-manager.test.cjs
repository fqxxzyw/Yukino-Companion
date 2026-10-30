const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const {RuntimeManager, extractRuntimeZip, safeEntry, detectNvidia} = require('../electron/runtime-manager.cjs');
const execute = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const isOwnedStage = name => /^runtime-[0-9a-f-]{36}$/.test(name);

// Small stored ZIP fixture writer. ZIP offsets, lengths, attributes and CRCs are
// explicit so adversarial archive entries do not require external programs.
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {value ^= byte; for (let bit=0;bit<8;bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;}
  return (value ^ 0xffffffff) >>> 0;
}
function zipBuffer(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data || '');
    const header = Buffer.alloc(30), directory = Buffer.alloc(46), flags = entry.flags || 0;
    header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(flags,6);
    header.writeUInt32LE(crc32(data),14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50,0); directory.writeUInt16LE(0x0314,4); directory.writeUInt16LE(20,6); directory.writeUInt16LE(flags,8);
    directory.writeUInt32LE(crc32(data),16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(data.length,24); directory.writeUInt16LE(name.length,28);
    directory.writeUInt32LE(((entry.mode || (entry.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0,38); directory.writeUInt32LE(offset,42);
    local.push(header,name,data); central.push(directory,name); offset += header.length + name.length + data.length;
  }
  const directories = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directories.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directories,end]);
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-runtime-test-'));
  t.after(() => fs.rm(root,{recursive:true,force:true})); return root;
}
async function fixture(t, {flavor='cu124', run=async()=>({stdout:JSON.stringify({torch:'test',cpuTensor:true,cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:true,gpuTensor:true,translationGpuBuild:true})}), hardwareRun=async()=>({stdout:'Intel UHD'}), fetcher, notify} = {}) {
  const temp = await temporary(t), resourceRoot = path.join(temp,'resources'), dataRoot = path.join(temp,'data');
  await fs.mkdir(resourceRoot,{recursive:true});
  const entries = [{name:'python-runtime/python.exe',data:'synthetic Python fixture'}, {name:'python-runtime/ffmpeg.exe',data:'synthetic ffmpeg'}, {name:'python-runtime/yukino-runtime-build.json',data:JSON.stringify({flavor})}];
  const archive = zipBuffer(entries), half = Math.floor(archive.length/2), chunks = [archive.subarray(0,half),archive.subarray(half)];
  const pack = {id:`runtime-${flavor}`,archiveSha256:digest(archive),unpackedBytes:entries.reduce((sum,e)=>sum+Buffer.byteLength(e.data),0),parts:chunks.map((chunk,index)=>({path:`runtime.zip.part${index+1}`,url:`https://github.com/fqxxzyw/Yukino-Companion/releases/download/test/runtime.zip.part${index+1}`,algorithm:'sha256',digest:digest(chunk),bytes:chunk.length}))};
  const catalog = {schemaVersion:1,version:'test-1',variants:{[flavor]:pack}}, catalogPath = path.join(temp,'runtime.json'), calls = [];
  await fs.writeFile(catalogPath,JSON.stringify(catalog));
  const manager = new RuntimeManager({dataRoot,resourceRoot,catalogPath,platform:'win32',run,hardwareRun,notify,fetcher:async(url,options)=>{
    calls.push(url); if(fetcher)return fetcher(url,options);
    const index=pack.parts.findIndex(part=>part.url===url); assert.ok(index>=0,'only declared runtime files may be downloaded');
    return new Response(chunks[index]);
  }});
  return {temp,resourceRoot,dataRoot,manager,catalog,catalogPath,archive,chunks,pack,calls};
}
async function previousRuntime(fixture, flavor='cpu') {
  const directory='previous-runtime', root=path.join(fixture.manager.root,directory);
  await fs.mkdir(path.join(root,'python-runtime'),{recursive:true});
  await fs.writeFile(path.join(root,'python-runtime/python.exe'),'previous working Python');
  await fs.writeFile(path.join(root,'python-runtime/yukino-runtime-build.json'),JSON.stringify({flavor}));
  const pointer={directory,flavor,version:'previous',metadata:{torch:'previous'}};
  await fs.writeFile(path.join(fixture.manager.root,'current.json'),JSON.stringify(pointer));
  return {root,pointer};
}

test('runtime ZIP extracts nested files and enforces traversal, links, duplicates and size/count limits',async t=>{
  const root=await temporary(t);
  const cases=[
    {name:'parent traversal',entries:[{name:'../escape',data:'bad'}]},
    {name:'absolute',entries:[{name:'/escape',data:'bad'}]},
    {name:'drive path',entries:[{name:'C:/escape',data:'bad'}]},
    {name:'backslash traversal',entries:[{name:'..\\escape',data:'bad'}]},
    {name:'alternate data stream',entries:[{name:'file:stream',data:'bad'}]},
    {name:'Windows trailing-dot alias',entries:[{name:'python-runtime./evil',data:'bad'}]},
    {name:'symlink',entries:[{name:'link',data:'../escape',mode:0o120777}]},
    {name:'case duplicate',entries:[{name:'A.txt',data:'one'},{name:'a.txt',data:'two'}]},
    {name:'encrypted',entries:[{name:'secret',data:'bad',flags:1}]},
    {name:'oversize',entries:[{name:'large',data:'123456'}],limits:{maxBytes:5}},
    {name:'entry limit',entries:[{name:'a',data:'a'},{name:'b',data:'b'}],limits:{maxEntries:1}},
    {name:'Windows NUL device',entries:[{name:'python-runtime/NUL',data:'bad'}]},
    {name:'Windows COM device with extension',entries:[{name:'COM1.txt',data:'bad'}]},
    {name:'Windows reserved superscript device',entries:[{name:'LPT².txt',data:'bad',flags:0x800}]},
  ];
  for(let index=0;index<cases.length;index++) {
    const item=cases[index], archive=path.join(root,`${index}.zip`);
    await fs.writeFile(archive,zipBuffer(item.entries));
    await assert.rejects(extractRuntimeZip(archive,path.join(root,`out-${index}`),item.limits),undefined,item.name);
  }
  assert.equal(await fs.readFile(path.join(root,'out-7/A.txt'),'utf8'),'one');
  await assert.rejects(fs.access(path.join(root,'escape')));
  const good=path.join(root,'good.zip');
  await fs.writeFile(good,zipBuffer([{name:'nested/'},{name:'nested/good.txt',data:'valid'}]));
  const summary=await extractRuntimeZip(good,path.join(root,'good'));
  assert.equal(await fs.readFile(path.join(root,'good/nested/good.txt'),'utf8'),'valid'); assert.equal(summary.bytes,5);
});

test('cancelled extraction stops before publishing subsequent entries',async t=>{
  const root=await temporary(t),archive=path.join(root,'archive.zip'),controller=new AbortController();
  await fs.writeFile(archive,zipBuffer([{name:'one',data:'one'},{name:'two',data:'two'}]));
  await assert.rejects(extractRuntimeZip(archive,path.join(root,'stage'),{signal:controller.signal,onProgress:()=>controller.abort()}),/取消|abort/i);
  await assert.rejects(fs.access(path.join(root,'stage/two')));
});

test('failed runtime validation preserves the selected working runtime and retries verified downloads',async t=>{
  let attempts=0, env, previous;
  env=await fixture(t,{run:async(executable,args,options)=>{
    attempts++;
    assert.ok(path.isAbsolute(executable)); assert.ok(isOwnedStage(path.basename(path.dirname(path.dirname(executable))))); assert.equal(args[0],'-X'); assert.equal(options.shell,undefined);
    assert.equal((await env.manager.current()).root,previous.root,'old runtime is selected during staged validation');
    if(attempts===1)throw Error('synthetic probe failure');
    return {stdout:JSON.stringify({torch:'tested',cpuTensor:true,cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:true,gpuTensor:true})};
  }});
  previous=await previousRuntime(env);
  const pointerPath=path.join(env.manager.root,'current.json'), original=await fs.readFile(pointerPath,'utf8');
  // Model payloads belong to the application package, not the shared runtime.
  await fs.mkdir(path.join(env.resourceRoot,'translation-models'),{recursive:true});
  await fs.writeFile(path.join(env.resourceRoot,'translation-models/keep.gguf'),'bundled model sentinel');
  await assert.rejects(env.manager.install('cu124'),/synthetic probe failure/);
  assert.equal(await fs.readFile(pointerPath,'utf8'),original);
  assert.equal(await fs.readFile(path.join(previous.root,'python-runtime/python.exe'),'utf8'),'previous working Python');
  assert.equal((await fs.readdir(env.manager.root)).some(isOwnedStage),false);
  assert.equal(env.manager.controller,null); assert.equal(env.calls.length,2);
  const installed=await env.manager.install('cu124');
  assert.equal(installed.ready,true); assert.equal(installed.flavor,'cu124'); assert.equal(installed.metadata.torch,'tested');
  assert.equal(env.calls.length,2,'retry must reuse already verified archive parts');
  const pointer=JSON.parse(await fs.readFile(pointerPath,'utf8'));
  assert.equal(installed.root,path.join(env.manager.root,pointer.directory)); assert.notEqual(pointer.directory,previous.pointer.directory);
  assert.equal(await fs.readFile(path.join(env.resourceRoot,'translation-models/keep.gguf'),'utf8'),'bundled model sentinel');
  await fs.access(path.join(previous.root,'python-runtime/python.exe'));
  await assert.rejects(fs.access(path.join(env.manager.root,'current.json.tmp')));
  await env.manager.install('cu124'); assert.equal(env.calls.length,2,'an installed matching runtime must not download again'); assert.equal(attempts,2);
});

test('bad assembled archive digest never alters the selected runtime',async t=>{
  const env=await fixture(t),previous=await previousRuntime(env);
  env.catalog.variants.cu124.archiveSha256='0'.repeat(64); await fs.writeFile(env.catalogPath,JSON.stringify(env.catalog));
  await assert.rejects(env.manager.install('cu124'),/完整校验失败/);
  assert.equal((await env.manager.current()).root,previous.root);
  assert.equal((await fs.readdir(env.manager.root)).some(isOwnedStage),false);
});

test('cancelling a runtime probe aborts only its owned process and keeps the old runtime selected',async t=>{
  let started, probePromise;
  const ready=new Promise(resolve=>started=resolve);
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  t.after(()=>unrelated.kill());
  const env=await fixture(t,{run:async(executable,args,options)=>{
    probePromise=execute(process.execPath,['-e','setInterval(()=>{},1000)'],options);
    started(); return probePromise;
  }}),previous=await previousRuntime(env);
  const pending=env.manager.install('cu124');
  await ready; assert.equal(env.manager.phase,'checking');
  env.manager.cancel();
  await assert.rejects(pending,/abort|cancel|取消/i);
  assert.equal(probePromise.child.killed,true); assert.equal(unrelated.killed,false); assert.doesNotThrow(()=>process.kill(unrelated.pid,0));
  assert.equal(env.manager.phase,'cancelled'); assert.equal((await env.manager.current()).root,previous.root);
  assert.equal((await fs.readdir(env.manager.root)).some(isOwnedStage),false);
  assert.equal(env.manager.controller,null);
});

test('cancel during network download propagates to the downloader and retains the previous runtime',async t=>{
  let started; const ready=new Promise(resolve=>started=resolve);
  const env=await fixture(t,{fetcher:async(url,options)=>{
    started(); return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('network aborted')),{once:true}));
  }}),previous=await previousRuntime(env);
  const pending=env.manager.install('cu124'); await ready; env.manager.cancel(); await assert.rejects(pending,/aborted/);
  assert.equal(env.manager.phase,'cancelled'); assert.equal((await env.manager.current()).root,previous.root);
});

test('hardware auto-selection uses an argument-vector probe and falls back to CPU without NVIDIA',async()=>{
  let invoked;
  assert.equal(await detectNvidia('win32',async(executable,args,options)=>{invoked={executable,args,options};return {stdout:'["Intel UHD", "NVIDIA GeForce RTX"]'};}),true);
  assert.equal(invoked.executable,'powershell.exe'); assert.equal(invoked.options.shell,undefined); assert.ok(invoked.args.includes('-NonInteractive'));
  assert.equal(await detectNvidia('win32',async()=>({stdout:'AMD Radeon'})),false);
  assert.equal(await detectNvidia('win32',async()=>{throw Error('missing utility');}),false);
  assert.throws(()=>safeEntry('/tmp/test','../escape'));
});
test('hardware detection reports NVIDIA even before Python or a CUDA runtime is installed',async t=>{
 let checks=0;const env=await fixture(t,{flavor:'cpu',hardwareRun:async()=>{checks++;return {stdout:'NVIDIA GeForce RTX 3060'};}});
 const status=await env.manager.status();assert.equal(status.ready,false);assert.equal(status.hardware.checked,true);assert.equal(status.hardware.nvidia,true);assert.deepEqual(status.variants,['cpu','cu124']);
 await env.manager.status();assert.equal(checks,1,'repeated status checks reuse the hardware probe');
});

test('cancel during hardware selection does not start a download after the probe returns',async t=>{
  let started,release; const ready=new Promise(resolve=>started=resolve);
  const env=await fixture(t,{hardwareRun:async()=>{started();return new Promise(resolve=>release=()=>resolve({stdout:'NVIDIA GeForce'}));},fetcher:async()=>{throw Error('download must not start after cancellation');}});
  const pending=env.manager.install('auto'); await ready; env.manager.cancel(); release();
  await assert.rejects(pending);
  assert.equal(env.calls.length,0,'an aborted preflight must never start a network request');
  assert.equal(env.manager.phase,'cancelled'); assert.equal(env.manager.controller,null);
});

test('invalid runtime identifiers and extraction limits fail before any download or old-runtime mutation',async t=>{
  for(const invalid of [{id:'..'},{id:'.'},{unpackedBytes:0},{unpackedBytes:-1},{unpackedBytes:1.5}]) {
    const env=await fixture(t),previous=await previousRuntime(env);
    Object.assign(env.catalog.variants.cu124,invalid); await fs.writeFile(env.catalogPath,JSON.stringify(env.catalog));
    await assert.rejects(env.manager.install('cu124'));
    assert.equal(env.calls.length,0,`invalid catalogue must not download: ${JSON.stringify(invalid)}`);
    assert.equal((await env.manager.current()).root,previous.root);
  }
});

test('current runtime pointer cannot select a parent directory outside the runtime root',async t=>{
  const env=await fixture(t);
  await fs.mkdir(path.join(env.dataRoot,'python-runtime'),{recursive:true});
  await fs.mkdir(env.manager.root,{recursive:true});
  await fs.writeFile(path.join(env.dataRoot,'python-runtime/python.exe'),'outside runtime root');
  await fs.writeFile(path.join(env.dataRoot,'python-runtime/yukino-runtime-build.json'),JSON.stringify({flavor:'cpu'}));
  await fs.writeFile(path.join(env.manager.root,'current.json'),JSON.stringify({directory:'..',flavor:'cpu'}));
  assert.equal((await env.manager.current()).ready,false);
});

test('failure to commit the atomic pointer leaves the prior runtime selected',async t=>{
  const env=await fixture(t),previous=await previousRuntime(env),rename=fs.rename;
  fs.rename=async(source,destination)=>{
    if(destination===path.join(env.manager.root,'current.json'))throw Object.assign(Error('synthetic pointer commit failure'),{code:'EACCES'});
    return rename(source,destination);
  };
  try {await assert.rejects(env.manager.install('cu124'),/synthetic pointer commit failure/);}
  finally {fs.rename=rename;}
  assert.equal((await env.manager.current()).root,previous.root);
  assert.equal(await fs.readFile(path.join(previous.root,'python-runtime/python.exe'),'utf8'),'previous working Python');
  assert.equal((await fs.readdir(env.manager.root)).some(isOwnedStage),false);
});

test('reinstall preserves a selected runtime at the historical deterministic destination',async t=>{
  const env=await fixture(t);
  const oldName=env.pack.id+'-'+digest(env.catalog.version+'\n'+env.pack.archiveSha256).slice(0,16);
  const oldRoot=path.join(env.manager.root,oldName),oldPython=path.join(oldRoot,'python-runtime');
  await fs.mkdir(oldPython,{recursive:true});
  await fs.writeFile(path.join(oldPython,'python.exe'),'previous runtime');
  await fs.writeFile(path.join(oldPython,'yukino-runtime-build.json'),JSON.stringify({flavor:'cu124'}));
  await fs.writeFile(path.join(oldRoot,'user-file.txt'),'do not remove');
  // A stale pointer forces installation even though it names that same folder.
  await fs.writeFile(path.join(env.manager.root,'current.json'),JSON.stringify({directory:oldName,version:'outdated'}));
  const next=await env.manager.install('cu124');
  assert.notEqual(next.root,oldRoot);
  assert.equal(await fs.readFile(path.join(oldRoot,'user-file.txt'),'utf8'),'do not remove');
  assert.equal(await fs.readFile(path.join(oldPython,'python.exe'),'utf8'),'previous runtime');
  assert.equal((await env.manager.current()).root,next.root);
});

test('short filesystem writes still assemble every archive byte before verification',async t=>{
  const env=await fixture(t),open=fs.open; let shortWrites=0;
  fs.open=async(filename,flags,...rest)=>{
    const handle=await open(filename,flags,...rest);
    if(path.basename(String(filename))==='runtime.zip'&&flags==='w'){
      const write=handle.write.bind(handle);
      handle.write=async(buffer,offset=0,length=buffer.length-offset,...other)=>{
        shortWrites++; return write(buffer,offset,Math.min(7,length),...other);
      };
    }
    return handle;
  };
  let installed;
  try {installed=await env.manager.install('cu124');}
  finally {fs.open=open;}
  assert.equal(installed.ready,true); assert.ok(shortWrites>20,'the archive write must handle repeated partial writes');
  assert.equal(await fs.readFile(path.join(installed.root,'python-runtime/python.exe'),'utf8'),'synthetic Python fixture');
});

test('cleanup errors cannot leave the installer permanently busy or replace the original failure',async t=>{
  const notices=[],env=await fixture(t,{run:async()=>{throw Error('original probe failure');},notify:value=>notices.push(value)}),previous=await previousRuntime(env),remove=fs.rm;
  fs.rm=async(filename,...args)=>{
    if(isOwnedStage(path.basename(String(filename))))throw Object.assign(Error('temporary Windows sharing violation'),{code:'EPERM'});
    return remove(filename,...args);
  };
  try {await assert.rejects(env.manager.install('cu124'),/original probe failure/);}
  finally {fs.rm=remove;}
  assert.equal(env.manager.controller,null); assert.equal(env.manager.downloader,null);
  assert.equal((await env.manager.current()).root,previous.root);
  assert.ok(notices.some(value=>value.cleanupWarning));
});

test('a new catalogue version of the same flavor stages separately and preserves the previously selected tree',async t=>{
  let previous,env,probes=0;
  env=await fixture(t,{run:async()=>{
    probes++;
    if(previous){assert.equal((await env.manager.current()).root,previous.root); await fs.access(previous.python);}
    return {stdout:JSON.stringify({torch:'test',cpuTensor:true,cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:true,gpuTensor:true})};
  }});
  previous=await env.manager.install('cu124');
  env.catalog.version='test-2'; await fs.writeFile(env.catalogPath,JSON.stringify(env.catalog));
  const next=await env.manager.install('cu124');
  assert.equal(probes,2); assert.notEqual(previous.root,next.root);
  await fs.access(previous.python);
  const current=await env.manager.current();
  assert.equal(current.version,'test-2'); assert.equal(current.archiveSha256,env.pack.archiveSha256);
  await env.manager.install('cu124'); assert.equal(probes,2,'matching version and hash may be reused');
});

test('hardware detection is cancelled through its owned process signal',async()=>{
  const controller=new AbortController();let received;
  const pending=detectNvidia('win32',async(executable,args,options)=>{
    received=options.signal;
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('hardware probe aborted')),{once:true}));
  },controller.signal);
  controller.abort(); await assert.rejects(pending,/aborted/); assert.equal(received,controller.signal);
});

test('a CPU-only catalogue advertises upstream CUDA installation and keeps CPU auto without NVIDIA',async t=>{
 const env=await fixture(t,{flavor:'cpu',run:async()=>({stdout:JSON.stringify({torch:'cpu-test',cpuTensor:true,gpuAvailable:false,translationGpuBuild:false})})});
 const result=await env.manager.install('auto');assert.equal(result.flavor,'cpu');assert.deepEqual(result.variants,['cpu','cu124']);assert.equal(result.officialInstall,true);
 const catalog=await env.manager.catalog();assert.equal(catalog.variants.cu124.officialPip,true);assert.equal(catalog.variants.cu124.baseFlavor,'cpu');
});

test('legacy runtime is not reported installed in an empty selected directory',async t=>{
 const env=await fixture(t);const legacy=path.join(env.temp,'legacy');const root=path.join(legacy,'runtime','old','python-runtime');
 await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'python.exe'),'old Python');await fs.writeFile(path.join(root,'yukino-runtime-build.json'),JSON.stringify({flavor:'cpu'}));
 await fs.writeFile(path.join(legacy,'runtime','current.json'),JSON.stringify({directory:'old',version:'previous',metadata:{gpuAvailable:false}}));
 env.manager.legacyDataRoot=legacy;assert.equal((await env.manager.current()).ready,false);assert.ok(env.manager.root.startsWith(env.dataRoot+path.sep));
 assert.equal(await fs.readFile(path.join(root,'python.exe'),'utf8'),'old Python');
});

test('NVIDIA auto install uses official CUDA wheels in a new stage even when no custom CUDA archive exists',async t=>{
 const calls=[];const env=await fixture(t,{flavor:'cpu',hardwareRun:async()=>({stdout:'NVIDIA RTX 3060'}),run:async(executable,args,options)=>{
  calls.push({executable,args,options});if(args.includes('pip'))return {stdout:'Downloading upstream package\nSuccessfully installed\n'};
  return {stdout:JSON.stringify({cpuTensor:true,torch:'2.5.1+cu124',cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:false,gpuTensor:false,translationGpuBuild:false})};
 }});
 const installed=await env.manager.install('auto');assert.equal(installed.flavor,'cu124');assert.equal(installed.verified,true);assert.equal(installed.metadata.gpuTensor,false);assert.ok(installed.root.startsWith(env.dataRoot+path.sep));
 const pip=calls.filter(call=>call.args.includes('pip'));assert.equal(pip.length,2);assert.ok(pip.every(call=>call.executable===installed.python));assert.ok(pip[0].args.includes('https://download.pytorch.org/whl/cu124'));
 const marker=JSON.parse(await fs.readFile(path.join(installed.root,'python-runtime/yukino-runtime-build.json'),'utf8'));assert.equal(marker.installSource,'official-pip');assert.equal(marker.flavor,'cu124');
 await fs.access(path.join(env.manager.root,'official-install.log'));assert.equal(env.calls.length,2,'only the checked CPU base archive is downloaded before official dependencies');
});
test('existing executable and old metadata cannot make a broken environment ready',async t=>{
 const env=await fixture(t,{run:async()=>{throw Error('No module named torch');}});await previousRuntime(env);
 const status=await env.manager.status();assert.equal(status.filesPresent,true);assert.equal(status.ready,false);assert.equal(status.verified,false);assert.match(status.validationError,/torch/);
});
test('official pip failure preserves prior runtime and leaves retry logs/cache in selected storage',async t=>{
 let failed=true;const env=await fixture(t,{flavor:'cpu',hardwareRun:async()=>({stdout:'NVIDIA RTX 3060'}),run:async(executable,args)=>{
  if(args.includes('pip')){if(failed)throw Error('upstream connection reset');return {stdout:'installed'};}
  return {stdout:JSON.stringify({cpuTensor:true,torch:'test',cudaBuild:'12.4',translationCudaBinary:true,gpuAvailable:false,gpuTensor:false})};
 }}),previous=await previousRuntime(env);
 await assert.rejects(env.manager.install('cu124'),/官方安装失败/);assert.equal((await env.manager.current()).root,previous.root);assert.equal(env.manager.controller,null);assert.equal((await fs.readdir(env.manager.root)).some(isOwnedStage),false);
 assert.match(await fs.readFile(path.join(env.manager.root,'official-install.log'),'utf8'),/connection reset/);await fs.access(path.join(env.manager.root,'pip-cache'));
 failed=false;const installed=await env.manager.install('cu124');assert.equal(installed.flavor,'cu124');assert.equal(env.calls.length,2,'retry reuses the previously checked base archive parts');await fs.access(previous.root);
});
