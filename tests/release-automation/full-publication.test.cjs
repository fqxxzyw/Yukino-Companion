'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),yaml=require('js-yaml');
const {registerPublicationContract,python,runPython,condition,context,commands,dependencies,step}=require('../helpers/publication-contract.cjs');
const root=path.resolve(__dirname,'../..');
const input=process.env.YUKINO_PRIVATE_WINDOWS_WORKFLOW;
if(!input)throw Error('Release automation validation requires YUKINO_PRIVATE_WINDOWS_WORKFLOW pointing to the approved private YAML. This suite is not a public source test.');
const workflows={'base-installer':yaml.load(fs.readFileSync(path.join(root,'.github/workflows/base-installer.yml'),'utf8')),windows:yaml.load(fs.readFileSync(path.resolve(input),'utf8'))};
registerPublicationContract(workflows);
test('full publication additionally requires CUDA success when selected',()=>{const c=context();c.inputs.build_cuda=true;assert.equal(condition(workflows.windows.jobs.publish.if,c),false);c.needs.runtime_cuda.result='success';assert.equal(condition(workflows.windows.jobs.publish.if,c),true);});
test('full transfer deletion requires its own flag and successful publication',()=>{const full=workflows.windows;assert.equal(full.on.workflow_dispatch.inputs.cleanup_transfer_branch.default,false);const c=context();c.inputs.cleanup_transfer_branch=false;assert.equal(condition(full.jobs.cleanup_transfer.if,c),false);assert.ok(dependencies(full.jobs.cleanup_transfer).includes('publish'));});
test('full validation includes component inference and offline payload installation',()=>{for(const command of ['evaluate_desktop.cjs','translation/smoke.py','smoke_bundled_voice.py','install-app-payload.ps1'])assert.ok(commands(workflows.windows.jobs.validation).includes(command));});
test('full candidate gate launches the installed app in isolation before uninstall and preserves failure evidence',()=>{
  const steps=workflows.windows.jobs.validation.steps;
  const native=steps.find(s=>s.name==='Install, launch and uninstall the exact candidate on an isolated Windows path');
  assert.ok(native,'an installer-only check cannot replace the packaged application launch');
  assert.notEqual(native['continue-on-error'],true);
  assert.ok(steps.indexOf(native)<steps.findIndex(s=>s.name==='Record successful pre-publication validation and exact candidate bytes'));
  const source=native.run;
  const launch=source.indexOf('if (-not $installedApp.Start())');
  const uninstall=source.indexOf("$uninstaller=Join-Path $target 'Uninstall.exe'");
  assert.ok(launch>=0&&uninstall>launch,'run the actual installed executable before uninstall');
  assert.match(source,/\$start\.FileName=Join-Path \$target 'Yukino Companion\.exe'/);
  assert.match(source,/\$start\.WorkingDirectory=\$target/);
  for(const name of ['APPDATA','LOCALAPPDATA'])assert.ok(source.includes(`$start.EnvironmentVariables['${name}']`));
  assert.match(source,/--user-data-dir=/);
  assert.match(source,/\$installedApp\.HasExited/);
  assert.match(source,/MainWindowTitle -ne 'Yukino Companion'/);
  assert.ok(source.indexOf('Installed candidate did not remain running')>launch);
  assert.ok(source.indexOf('Installed candidate logged an uncaught JavaScript error')<uninstall);
  assert.match(source,/FullCandidateWindow\]::PrintWindow\(\$installedApp\.MainWindowHandle/);
  assert.match(source,/app-first-launch\.png/);
  assert.match(source,/finally \{\n  \$cleanupFailure=\$null\n  try \{ Stop-CandidateApp \}/);
  assert.match(source,/\$report\.passed=\$false; \$report\.cleanupFailure/);
  assert.doesNotMatch(source,/--no-sandbox|--disable-gpu|--disable-web-security/);
  const evidence=steps.find(s=>s.uses==='actions/upload-artifact@v4'&&s.with.name.startsWith('windows-0.4.0-evidence-'));
  assert.equal(evidence.if,'always()');
  assert.ok(evidence.with.path.includes('build/full-installer-review'));
});

test('optional CUDA is gated, cataloged, validated and restored for publication without blocking CPU-only runs',()=>{
  const full=workflows.windows;
  assert.ok(dependencies(full.jobs.package).includes('runtime_cuda'));
  for(const enabled of [false,true])for(const result of ['success','failure','cancelled','skipped']){
    const c=context();c.inputs.build_cuda=enabled;c.needs.runtime_cuda.result=result;
    assert.equal(condition(full.jobs.package.if,c),enabled?result==='success':result==='skipped');
  }
  for(const prerequisite of ['metadata','source_checks','runtime_cpu','model'])for(const result of ['failure','cancelled','skipped']){
    const c=context();c.needs[prerequisite].result=result;assert.equal(condition(full.jobs.package.if,c),false);
  }
  const cancelled=context();cancelled.cancelled=true;assert.equal(condition(full.jobs.package.if,cancelled),false);
  for(const job of ['package','validation','publish']){
    const download=full.jobs[job].steps.find(s=>s.uses==='actions/download-artifact@v4'&&s.with.name==='inference-runtime-cu124');
    assert.ok(download,`${job} must carry the selected CUDA artifact`);
    assert.equal(download.with.path,'build/runtime-distribution');
    for(const enabled of [false,true]){const c=context();c.inputs.build_cuda=enabled;assert.equal(condition(download.if,c),enabled);}
  }
  const merge=full.jobs.package.steps.find(s=>s.name==='Prepare the selected runtime catalog and verify actual trained GGUF');
  assert.match(merge.run,/runtime-catalog-cpu\.json/);assert.match(merge.run,/runtime-catalog-cu124\.json/);
  assert.match(merge.run,/package-runtime\.py --merge \$catalogs/);
  const checks=full.jobs.validation.steps;
  assert.ok(checks.findIndex(s=>s.name==='Verify every selected runtime part and complete archive digest')<checks.findIndex(s=>s.name==='Record successful pre-publication validation and exact candidate bytes'));
  assert.match(step(full,'Record successful pre-publication validation and exact candidate bytes').run,/build\/runtime-distribution/);
});

test('selected runtime byte gate rejects missing flavors, missing parts, tampering and an invalid complete archive digest',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'yukino-selected-runtime-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const directory=path.join(folder,'build/runtime-distribution');fs.mkdirSync(directory,{recursive:true});
  fs.mkdirSync(path.join(folder,'scripts'));fs.copyFileSync(path.join(root,'scripts/package-runtime.py'),path.join(folder,'scripts/package-runtime.py'));
  const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
  const variants={};
  for(const flavor of ['cpu','cu124']){
    const bytes=[Buffer.from(`${flavor} fixture part 1`),Buffer.from(`${flavor} fixture part 2`)];
    const parts=bytes.map((buffer,index)=>{
      const name=`Yukino-Runtime-0.4.0-windows-x64-${flavor}.zip.part${String(index+1).padStart(3,'0')}`;
      fs.writeFileSync(path.join(directory,name),buffer);
      return {path:name,bytes:buffer.length,algorithm:'sha256',digest:hash(buffer),url:`https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-fixture/${name}`};
    });
    variants[flavor]={id:`windows-x64-${flavor}`,bytes:bytes.reduce((sum,b)=>sum+b.length,0),unpackedBytes:1,archiveSha256:hash(Buffer.concat(bytes)),parts};
  }
  const catalogPath=path.join(directory,'runtime-catalog.json');
  const write=selected=>fs.writeFileSync(catalogPath,JSON.stringify({schemaVersion:1,version:'0.4.0',variants:selected}));
  const code=python(step(workflows.windows,'Verify every selected runtime part and complete archive digest').run);
  const run=enabled=>runPython(code,folder,{INCLUDE_CUDA:String(enabled)});
  write({cpu:variants.cpu});assert.equal(run(false).status,0);assert.notEqual(run(true).status,0);
  write(variants);assert.equal(run(true).status,0);assert.notEqual(run(false).status,0);
  const partPath=path.join(directory,variants.cu124.parts[0].path),original=fs.readFileSync(partPath);
  fs.writeFileSync(partPath,Buffer.alloc(original.length,1));assert.notEqual(run(true).status,0);fs.writeFileSync(partPath,original);
  const changed=structuredClone(variants);changed.cu124.archiveSha256='0'.repeat(64);write(changed);assert.notEqual(run(true).status,0);
  write(variants);fs.rmSync(partPath);assert.notEqual(run(true).status,0);
});
