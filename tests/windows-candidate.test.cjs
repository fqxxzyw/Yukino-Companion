'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..'),workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-candidate.yml'),'utf8'));
test('candidate CI uses a disposable Windows worker without publishing or repository write permission',()=>{
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.deepEqual(workflow.on.push.branches,['handoff/codex-current-20261028']);
  assert.equal(workflow.jobs.candidate['runs-on'],'windows-2022');
  for(const job of Object.values(workflow.jobs)){
    assert.equal(job.permissions,undefined);
    for(const step of job.steps){assert.notEqual(step['continue-on-error'],true);assert.doesNotMatch(step.run||'',/gh release|git push|workflow_dispatch|--no-sandbox|ExecutionPolicy Bypass/);}
  }
});
test('candidate upload follows real install, launch and byte verification, with failure evidence retained',()=>{
  const steps=workflow.jobs.candidate.steps;
  const smoke=steps.findIndex(s=>s.run?.includes('smoke-base-installer.ps1 -PayloadManifest build/base-payload.json'));
  const upload=steps.findIndex(s=>s.name==='Upload tested installer and exact payload identity');
  assert.ok(smoke>steps.findIndex(s=>s.run?.includes('./scripts/build-base-installer.ps1')));
  assert.ok(upload>smoke);assert.equal(steps[upload].if,undefined);
  assert.match(steps[upload].with.path,/Setup\.exe/);
  assert.equal(steps.find(s=>s.name==='Preserve native screenshots and failure evidence').if,'always()');
  const source=fs.readFileSync(path.join(root,'scripts/smoke-base-installer.ps1'),'utf8');
  assert.equal((source.match(/base-payload\.cjs/g)||[]).length,2);
  assert.ok(source.indexOf('Installed payload does not match this build')<source.indexOf('$report.passed=$true'));
});
