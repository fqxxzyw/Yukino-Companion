const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..');
// js-yaml rejects duplicate mapping keys by default (json:true would disable it).
const workflows=Object.fromEntries(['base-installer','windows'].map(name=>[name,yaml.load(fs.readFileSync(path.join(root,'.github/workflows',name+'.yml'),'utf8'))]));
const commands=job=>job.steps.filter(s=>s.run).map(s=>s.run).join('\n');
const dependencies=job=>[].concat(job.needs||[]);
const step=(workflow,name)=>workflow.jobs.validation.steps.find(s=>s.name===name);
const python=source=>{const match=/python - <<'PY'\n([\s\S]*?)\nPY(?:\n|$)/.exec(source);assert.ok(match,'workflow must contain an inspectable Python gate');return match[1]};
function runPython(code,cwd,extra={}){return spawnSync('python',['-c',code],{cwd,encoding:'utf8',env:{...process.env,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'71',GITHUB_REPOSITORY:'synthetic/fixture',RELEASE_TAG:'v0.4.0-test.71',...extra}})}
function fixture(t,workflow){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'yukino-release-gate-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));for(const name of ['release','build/runtime-distribution','build/model-distribution'])fs.mkdirSync(path.join(folder,name),{recursive:true});fs.writeFileSync(path.join(folder,'release/fixture.exe'),'synthetic PE gate fixture, not an installer');fs.writeFileSync(path.join(folder,'build/base-package.json'),'{}');fs.writeFileSync(path.join(folder,'build/runtime-distribution/runtime-catalog.json'),'{}');fs.writeFileSync(path.join(folder,'build/model-distribution/model.zip'),'synthetic archive');const record=step(workflow,'Record successful pre-publication validation and exact candidate bytes');const result=runPython(python(record.run),folder);assert.equal(result.status,0,result.stderr);return folder;}
function condition(expression,context){const source=expression.replace(/^\$\{\{\s*/,'').replace(/\s*\}\}$/,'');return Boolean(new Function('github','inputs','needs','success','cancelled','always',`return (${source});`)(context.github,context.inputs,context.needs,()=>context.success!==false,()=>context.cancelled===true,()=>true));}
function context(){return {github:{event_name:'workflow_dispatch'},inputs:{confirm_publish:true,publish_resource_mirrors:true,cleanup_transfer_branch:true,build_cuda:false},needs:{metadata:{result:'success'},source_checks:{result:'success'},runtime_cpu:{result:'success'},target:{result:'success',outputs:{validate_only:'false'}},build:{result:'success'},package:{result:'success'},validation:{result:'success'},runtime_cuda:{result:'skipped'},model:{result:'success',outputs:{transfer_used:'true'}},publish:{result:'success'}}};}

test('workflow parser rejects duplicate keys and both changed workflows form acyclic job graphs',()=>{assert.throws(()=>yaml.load('jobs:\n  publish: 1\n  publish: 2\n'),/duplicated mapping key/);for(const w of Object.values(workflows)){const visited=new Set();function visit(name,stack=[]){assert.ok(w.jobs[name],name);assert.ok(!stack.includes(name),'cyclic needs: '+name);if(visited.has(name))return;for(const dep of dependencies(w.jobs[name]))visit(dep,[...stack,name]);visited.add(name)}for(const name of Object.keys(w.jobs))visit(name);}});
test('pushes and unconfirmed manual runs never publish, and tokens default to read-only',()=>{for(const w of Object.values(workflows)){assert.equal(w.permissions.contents,'read');assert.equal(w.on.workflow_dispatch.inputs.confirm_publish.default,false);for(const event of ['push','pull_request','workflow_dispatch'])for(const confirmed of [undefined,false,true]){const c=context();c.github.event_name=event;c.inputs.confirm_publish=confirmed;assert.equal(condition(w.jobs.publish.if,c),event==='workflow_dispatch'&&confirmed===true);}}});
test('failed, cancelled or skipped build/validation gates cannot reach application publication',()=>{for(const [name,w] of Object.entries(workflows)){const build=name==='windows'?'package':'build';assert.ok(dependencies(w.jobs.publish).includes('validation'));assert.ok(dependencies(w.jobs.validation).includes(build));for(const gate of [build,'validation'])for(const result of ['failure','cancelled','skipped']){const c=context();c.needs[gate].result=result;assert.equal(condition(w.jobs.publish.if,c),false,`${name} ${gate} ${result}`)}}const c=context();c.inputs.build_cuda=true;assert.equal(condition(workflows.windows.jobs.publish.if,c),false);c.needs.runtime_cuda.result='success';assert.equal(condition(workflows.windows.jobs.publish.if,c),true);});
test('existing-release validation, mirror publication and transfer deletion are distinct explicit scopes',()=>{const base=workflows['base-installer'],full=workflows.windows,c=context();c.needs.target.outputs.validate_only='true';assert.equal(condition(base.jobs.publish.if,c),false);assert.equal(condition(base.jobs.mirror_resources.if,c),false);assert.equal(base.on.workflow_dispatch.inputs.publish_resource_mirrors.default,false);assert.equal(full.on.workflow_dispatch.inputs.cleanup_transfer_branch.default,false);for(const flag of ['publish_resource_mirrors','cleanup_transfer_branch']){const value=context();value.inputs[flag]=false;assert.equal(condition((flag==='publish_resource_mirrors'?base.jobs.mirror_resources:full.jobs.cleanup_transfer).if,value),false)}assert.doesNotMatch(commands(base.jobs.validation),/gh release (?:create|edit|upload)/);assert.ok(dependencies(full.jobs.cleanup_transfer).includes('publish'));});
test('write permissions and all Release mutations are confined to gated publisher jobs',()=>{for(const [name,w] of Object.entries(workflows))for(const [id,job] of Object.entries(w.jobs)){const mutates=/gh release (?:create|edit|upload)|\['gh','release','(?:create|edit|upload)'|gh api --method DELETE/.test(commands(job));if(mutates){assert.equal(job.permissions?.contents,'write',`${name}/${id}`);assert.ok(['publish','mirror_resources','cleanup_transfer'].includes(id));assert.match(job.if,/inputs.confirm_publish == true/);assert.ok(dependencies(job).includes(id==='cleanup_transfer'?'publish':'validation'));}else assert.notEqual(job.permissions?.contents,'write');}});
test('native UI, model GPU and installer checks run before validation stamps with no continue-on-error',()=>{for(const [name,w] of Object.entries(workflows)){const steps=w.jobs.validation.steps,stamp=steps.findIndex(s=>s.name==='Record successful pre-publication validation and exact candidate bytes');for(const command of ['npm test','python -m unittest','npm run qa:ui','npm run qa:models','npm run qa:skin8',name==='windows'?'Start-Process -FilePath $installer':'scripts/smoke-base-installer.ps1']){const index=steps.findIndex(s=>s.run?.includes(command));assert.ok(index>=0&&index<stamp,`${name}: ${command} before stamp`);assert.notEqual(steps[index]['continue-on-error'],true)}assert.doesNotMatch(steps[stamp].if||'',/always|failure/);}for(const command of ['evaluate_desktop.cjs','translation/smoke.py','smoke_bundled_voice.py','install-app-payload.ps1'])assert.match(commands(workflows.windows.jobs.validation),new RegExp(command.replaceAll('.','\\.')));});
test('candidate and validation artifacts preserve exact commit/run stamps and destination paths',()=>{for(const [name,w] of Object.entries(workflows)){const build=w.jobs[name==='windows'?'package':'build'];assert.match(commands(build),/GITHUB_SHA/);assert.match(commands(build),/GITHUB_RUN_ID/);assert.match(commands(w.jobs.validation),/Candidate source\/run mismatch/);assert.match(commands(w.jobs.publish),/Validation does not belong to this exact commit\/run/);const downloads=w.jobs.publish.steps.filter(s=>s.uses==='actions/download-artifact@v4');assert.ok(downloads.some(s=>s.with.name.includes('candidate-${{ github.run_id }}')&&s.with.path==='.'));const validation=downloads.find(s=>s.with.name.includes('validation-${{ github.run_id }}'));assert.equal(validation.with.path,name==='windows'?'.':'build');const upload=w.jobs.validation.steps.find(s=>s.uses==='actions/upload-artifact@v4'&&s.with.name.includes('validation-${{ github.run_id }}'));assert.ok(upload.with.path.includes('build/prepublication-validation.json'));assert.equal(upload.with['if-no-files-found'],'error');}});
test('local publication byte gate executes against synthetic artifacts and rejects changed bytes or source identity',t=>{for(const w of Object.values(workflows)){const folder=fixture(t,w),code=python(w.jobs.publish.steps.find(s=>s.name==='Reverify the exact validated artifact before any Release mutation').run);assert.equal(runPython(code,folder).status,0);const exe=path.join(folder,'release/fixture.exe'),original=fs.readFileSync(exe);fs.appendFileSync(exe,'tampered');assert.notEqual(runPython(code,folder).status,0);fs.writeFileSync(exe,original);assert.notEqual(runPython(code,folder,{GITHUB_SHA:'b'.repeat(40)}).status,0);assert.notEqual(runPython(code,folder,{GITHUB_RUN_ID:'72'}).status,0);const p=path.join(folder,'build/prepublication-validation.json'),report=JSON.parse(fs.readFileSync(p));report.files[0].path='../not-allowed';fs.writeFileSync(p,JSON.stringify(report));assert.notEqual(runPython(code,folder).status,0);}});
test('an existing tag or inconclusive tag lookup fails before any draft write',()=>{for(const w of Object.values(workflows)){const script=w.jobs.publish.steps.find(s=>s.name?.startsWith('Stage a new draft')).run,prefix=script.slice(0,script.indexOf("python - <<'PY'"));for(const code of [0,1,2,128]){const result=spawnSync('bash',['-c',`git(){ return ${code}; }\n${prefix}\nprintf authorized-to-stage`],{encoding:'utf8',env:{...process.env,RELEASE_TAG:'v0.4.0-test'}});assert.equal(result.status===0,code===2,result.stderr);}}});
test('actual inline publication logic keeps bad remote bytes private and only promotes a fully verified draft',t=>{for(const w of Object.values(workflows))for(const scenario of ['ok','digest-mismatch','not-draft','create-failure']){const folder=fixture(t,w),code=python(w.jobs.publish.steps.find(s=>s.name?.startsWith('Stage a new draft')).run);const mock=`import subprocess,json,hashlib,os\nfrom pathlib import Path\n_calls=[]\n_count=0\ndef fake_run(args,**kwargs):\n    _calls.append(args);Path('calls.json').write_text(json.dumps(_calls))\n    if os.environ['SCENARIO']=='create-failure' and args[2]=='create':raise subprocess.CalledProcessError(1,args)\n    return subprocess.CompletedProcess(args,0)\ndef fake_output(args,**kwargs):\n    global _count\n    _count+=1\n    report=json.loads(Path('build/prepublication-validation.json').read_text())\n    paths=[item['path'] for item in report['files']]+['build/prepublication-validation.json']\n    assets=[]\n    for name in paths:\n        p=Path(name);assets.append({'name':p.name,'size':p.stat().st_size,'digest':'sha256:'+hashlib.sha256(p.read_bytes()).hexdigest()})\n    if os.environ['SCENARIO']=='digest-mismatch':assets[0]['digest']='sha256:'+('0'*64)\n    return json.dumps({'draft':_count==1 and os.environ['SCENARIO']!='not-draft','assets':assets,'html_url':'https://example.invalid/test'}).encode()\nsubprocess.run=fake_run\nsubprocess.check_output=fake_output\n`;const result=runPython(mock+'\n'+code,folder,{SCENARIO:scenario}),calls=JSON.parse(fs.readFileSync(path.join(folder,'calls.json'))),promoted=calls.some(args=>args.includes('--draft=false'));assert.equal(result.status===0,scenario==='ok',result.stderr);assert.equal(promoted,scenario==='ok');assert.ok(calls[0].includes('--draft'));assert.ok(calls[0].includes('--target'));assert.ok(calls[0].includes('a'.repeat(40)));assert.ok(calls.every(args=>!args.includes('--clobber')));}});
test('new resource mirror Releases remain drafts until every asset, metadata and license digest is verified',()=>{const source=commands(workflows['base-installer'].jobs.mirror_resources);assert.match(source,/gh release create[^\n]+--draft /);assert.match(source,/MIRROR_CREATED=false/);assert.match(source,/MIRROR_CREATED=true/);assert.match(source,/Refusing to replace a published resource with different bytes/);assert.ok(source.indexOf('Mirror metadata/license digest mismatch')<source.indexOf("'--draft=false'"));assert.match(source,/if os.environ\['MIRROR_CREATED'\]=='true'/);});
test('all embedded workflow Python gates compile without network or native execution',()=>{for(const w of Object.values(workflows))for(const job of Object.values(w.jobs))for(const step of job.steps){if(!step.run)continue;for(const match of step.run.matchAll(/python - <<'(PY|PYCODE)'\n([\s\S]*?)\n\1(?:\n|$)/g)){const result=spawnSync('python',['-c','import sys;compile(sys.stdin.read(),"workflow-gate","exec")'],{input:match[2],encoding:'utf8'});assert.equal(result.status,0,`${step.name||step.id}: ${result.stderr}`);}}});
test('duplicate flat Release asset names fail before even creating a private draft',t=>{for(const w of Object.values(workflows)){const folder=fixture(t,w),reportPath=path.join(folder,'build/prepublication-validation.json'),report=JSON.parse(fs.readFileSync(reportPath));report.files.push({...report.files[0],path:'build/fixture.exe'});fs.writeFileSync(reportPath,JSON.stringify(report));const code=python(w.jobs.publish.steps.find(s=>s.name?.startsWith('Stage a new draft')).run);const result=runPython("import subprocess\ndef deny_write(*args,**kwargs):raise RuntimeError('REMOTE_WRITE_MUST_NOT_OCCUR')\nsubprocess.run=deny_write\n"+code,folder);assert.notEqual(result.status,0);assert.match(result.stderr,/Duplicate Release asset basenames/);assert.doesNotMatch(result.stderr,/REMOTE_WRITE_MUST_NOT_OCCUR/);}});
test('native UI, models and eight-weight captures do not force-disable production hardware acceleration',()=>{for(const name of ['capture-ui.cjs','capture-model-ui.cjs','capture-eight-weight-skinning.cjs']){const source=fs.readFileSync(path.join(root,'scripts',name),'utf8');assert.doesNotMatch(source,/app\.disableHardwareAcceleration\s*\(/,name);assert.doesNotMatch(source,/appendSwitch\s*\(\s*['"](?:disable-gpu|disable-webgl|use-gl|use-angle)['"]/,name);}});
test('all explicit Bash gate scripts pass bash syntax validation without execution',()=>{for(const w of Object.values(workflows))for(const job of Object.values(w.jobs))for(const step of job.steps){if(step.shell!=='bash'||!step.run)continue;const result=spawnSync('bash',['-n'],{input:step.run,encoding:'utf8'});assert.equal(result.status,0,`${step.name||step.id}: ${result.stderr}`);}});

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
