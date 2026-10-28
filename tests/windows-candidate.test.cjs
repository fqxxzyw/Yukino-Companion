'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..'),workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-candidate.yml'),'utf8'));
test('only the explicit test prerelease job can write; build and native validation remain read-only',()=>{
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.deepEqual(workflow.on.push.branches,['handoff/codex-current-20261028']);
  assert.equal(workflow.jobs.candidate['runs-on'],'windows-2022');
  assert.deepEqual(workflow.jobs.publish_test.permissions,{contents:'write'});
  assert.equal(workflow.jobs.publish_test.if,"github.ref == 'refs/heads/handoff/codex-current-20261028'");
  for(const [name,job] of Object.entries(workflow.jobs)){
    if(name!=='publish_test')assert.equal(job.permissions,undefined);
    for(const step of job.steps){assert.notEqual(step['continue-on-error'],true);assert.doesNotMatch(step.run||'',/git push|--no-sandbox|ExecutionPolicy Bypass|release delete|--clobber/);}
  }
});
test('requested build then prerelease then native validation order preserves exact installer and failure evidence',()=>{
  assert.equal(workflow.jobs.publish_test.needs,'candidate');assert.equal(workflow.jobs.validation.needs,'publish_test');
  const build=workflow.jobs.candidate.steps,upload=build.findIndex(s=>s.name==='Upload built installer and exact payload identity');
  assert.ok(upload>build.findIndex(s=>s.run?.includes('./scripts/build-base-installer.ps1')));
  assert.match(build[upload].with.path,/Setup\.exe/);assert.equal(build[upload].if,undefined);
  assert.match(build.find(s=>s.name?.startsWith('Record exact source')).run,/nativeInstallLaunchUpgradeUninstall = \$false/);
  const validation=workflow.jobs.validation.steps;
  assert.ok(validation.some(s=>s.run?.includes('smoke-base-installer.ps1 -PayloadManifest build/base-payload.json')));
  assert.equal(validation.find(s=>s.name==='Preserve native screenshots and failure evidence').if,'always()');
  const source=fs.readFileSync(path.join(root,'scripts/smoke-base-installer.ps1'),'utf8');
  assert.equal((source.match(/base-payload\.cjs/g)||[]).length,2);
  assert.ok(source.indexOf('Installed payload does not match this build')<source.indexOf('$report.passed=$true'));
});
