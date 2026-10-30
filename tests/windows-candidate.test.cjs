'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..'),workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-candidate.yml'),'utf8'));
test('only explicit test release jobs can write; build and native validation remain read-only',()=>{
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.deepEqual(workflow.on.push.branches,['handoff/codex-current-20261028']);
  assert.match(workflow.concurrency.group,/github\.sha/);
  assert.equal(workflow.jobs.candidate['runs-on'],'windows-2022');
  assert.deepEqual(workflow.jobs.publish_test.permissions,{contents:'write'});
  assert.deepEqual(workflow.jobs.mark_prior_test.permissions,{contents:'write'});
  assert.equal(workflow.jobs.mark_prior_test.needs,'publish_test');
  assert.equal(workflow.jobs.publish_test.if,"github.ref == 'refs/heads/handoff/codex-current-20261028'");
  for(const [name,job] of Object.entries(workflow.jobs)){
    if(!['publish_test','mark_prior_test'].includes(name))assert.equal(job.permissions,undefined);
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
  assert.ok(validation.some(s=>s.run?.includes('-VerifyCurrentFeatures')));
  assert.ok(validation.some(s=>s.run?.includes('node scripts/smoke-aria2-parts.cjs')));
  assert.equal(validation.find(s=>s.name==='Preserve native screenshots and failure evidence').if,'always()');
  const source=fs.readFileSync(path.join(root,'scripts/smoke-base-installer.ps1'),'utf8');
  assert.equal((source.match(/base-payload\.cjs/g)||[]).length,2);
  assert.ok(source.indexOf('Installed payload does not match this build')<source.indexOf('$report.passed=$true'));
  assert.ok(source.indexOf('scripts/verify-installed-window.cjs')<source.indexOf(' Stop-InstalledApp\n $stderrFile'));
  assert.match(source,/scripts\/verify-current-window\.cjs/);
  assert.match(source,/Error occurred in handler for/);
});

test('revalidation is read-only and binds the exact previously published installer',()=>{
  const verify=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-revalidate.yml'),'utf8'));
  assert.deepEqual(verify.permissions,{contents:'read',actions:'read'});
  assert.equal(verify.jobs.validation['runs-on'],'windows-2022');
  const steps=verify.jobs.validation.steps,download=steps.find(s=>s.uses==='actions/download-artifact@v4');
  assert.equal(download.with['run-id'],40856946334);
  assert.match(steps.find(s=>s.name==='Bind the downloaded installer to the exact published candidate').run,/b22423d646d4927ce106d8f5156f6cc48128e271a3a29b102bf33ea2e984bae5/);
  assert.ok(steps.some(s=>s.run?.includes('smoke-base-installer.ps1 -PayloadManifest')));
  assert.equal(steps.find(s=>s.name==='Preserve native screenshots and failure evidence').if,'always()');
});
test('independent native check binds the newest exact candidate and keeps bounded failures visible',()=>{
 const quick=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-quick-verify.yml'),'utf8'));assert.deepEqual(quick.permissions,{contents:'read',actions:'read'});
 const steps=quick.jobs.installer.steps,download=steps.find(s=>s.uses==='actions/download-artifact@v4');assert.equal(download.with['run-id'],40913001300);assert.match(download.with.name,/3f7eb207d7bb15ede50bce1f9165da7778bc18e0/);
 assert.equal(steps.find(s=>s.name==='Preserve independent validation evidence').if,'always()');for(const job of Object.values(quick.jobs))for(const step of job.steps)assert.notEqual(step['continue-on-error'],true);
 assert.ok(quick.jobs.source_regression.steps.some(step=>step.run?.includes('npm test')&&step.run?.includes('python -m unittest')));
 const script=fs.readFileSync(path.join(root,'scripts/smoke-quick-installer.ps1'),'utf8');assert.match(script,/Get-FileHash/);assert.match(script,/base-payload\.cjs/);assert.match(script,/verify-character-package\.cjs/);assert.match(script,/verify-installed-window\.cjs/);assert.match(script,/verify-current-window\.cjs/);assert.match(script,/WaitForExit\(120000\)/);assert.match(script,/Uninstall did not preserve/);
});
