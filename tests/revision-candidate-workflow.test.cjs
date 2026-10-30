'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..');
const workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-revision-candidate.yml'),'utf8'));

test('candidate and native validation are read-only; publication is restricted to the authorized branch',()=>{
 assert.deepEqual(workflow.on.push.branches,['fix/liquid-glass-pet-voice-20261030','fix/private-model-release-20261030']);
 assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'));
 assert.deepEqual(workflow.permissions,{contents:'read'});
 for(const job of [workflow.jobs.candidate,workflow.jobs.native_smoke]){
  assert.equal(job.permissions,undefined);
  for(const step of job.steps){assert.notEqual(step['continue-on-error'],true);assert.doesNotMatch(step.run||'',/gh\s+release|git\s+push|--clobber/i);}
 }
 const publish=workflow.jobs.publish_release;
 assert.deepEqual(publish.needs,['candidate','native_smoke']);
 assert.equal(publish.if,"github.event_name == 'push' && github.ref == 'refs/heads/fix/private-model-release-20261030'");
 assert.deepEqual(publish.permissions,{contents:'write',actions:'read'});
 assert.equal(publish.uses,'./.github/workflows/windows-revision-publish.yml');
 const upload=workflow.jobs.candidate.steps.find(step=>step.name==='Preserve unpublished candidate');
 const steps=workflow.jobs.candidate.steps,restore=steps.findIndex(step=>step.name==='Recover verified character inputs from the previously published installer');
 assert.ok(restore>steps.findIndex(step=>step.run==='npm ci --no-audit --no-fund'));
 assert.ok(restore<steps.findIndex(step=>step.name==='Build application and record installed payload'));
 assert.equal(steps[restore].run,'./scripts/restore-character-inputs-windows.ps1');
 assert.ok(upload);assert.equal(upload.with['if-no-files-found'],'error');
 const files=upload.with.path.trim().split(/\r?\n/);
 assert.deepEqual(files,[
  'release/Yukino-Companion-0.4.0-Base-Setup.exe','release/base-installer.json',
  'release/candidate-source.json','release/SHA256SUMS.txt','build/base-package.json','build/base-payload.json'
 ]);
});
test('native smoke binds the installer to the same source and verifies the installed payload',()=>{
 assert.equal(workflow.jobs.native_smoke.needs,'candidate');
 const steps=workflow.jobs.native_smoke.steps;
 const download=steps.find(step=>step.uses==='actions/download-artifact@v4');
 assert.equal(download.with.name,'Yukino-revision-candidate-${{ github.sha }}');
 const identity=steps.find(step=>step.name==='Verify exact source and installer bytes').run;
 for(const marker of ['GITHUB_SHA','GITHUB_RUN_ID','HEAD^{tree}','Get-FileHash','$source.sha256','$source.bytes'])assert.ok(identity.includes(marker));
 const smoke=steps.find(step=>step.run?.includes('smoke-base-installer.ps1 -PayloadManifest build/base-payload.json -VerifyCurrentFeatures'));
 assert.ok(smoke);assert.equal(smoke['timeout-minutes'],10);
 const check=fs.readFileSync(path.join(root,'scripts/verify-current-window.cjs'),'utf8');
 assert.match(check,/Installed renderer connection timed out/);assert.match(check,/Installed feature check exceeded 150 seconds/);
 assert.equal(steps.find(step=>step.name==='Preserve native smoke evidence').if,'always()');
});
test('clean-source Windows checks disclose the absent optional blink model and still run all other tests',()=>{
 const check=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-revision-check.yml'),'utf8'));
 assert.ok(check.on.push.branches.includes('fix/private-model-release-20261030'));assert.ok(Object.hasOwn(check.on,'workflow_dispatch'));
 const steps=check.jobs.windows.steps,restore=steps.findIndex(step=>step.name==='Recover verified character inputs from the previously published installer'),regression=steps.findIndex(step=>step.name==='Source and Python regression');
 assert.ok(restore>steps.findIndex(step=>step.run==='npm ci --no-audit --no-fund'));assert.ok(restore<regression);
 const script=steps[regression].run;for(const marker of ['Test-Path -LiteralPath','npm test','Seven private blink-review asset tests skipped','GITHUB_STEP_SUMMARY','python -m unittest','community/tests'])assert.ok(script.includes(marker),marker);
});
