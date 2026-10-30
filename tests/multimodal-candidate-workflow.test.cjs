'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..'),workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/windows-multimodal-candidate.yml'),'utf8'));
test('multimodal candidate keeps builds read-only and checks current source, wallpaper transport and renderer flows',()=>{
 assert.deepEqual(workflow.on.push.branches,['candidate/multimodal-20261030-safe']);assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'));
 assert.deepEqual(workflow.permissions,{contents:'read'});assert.deepEqual(Object.keys(workflow.jobs),['candidate','native_smoke']);
 const steps=workflow.jobs.candidate.steps;
 const regression=steps.find(step=>step.name==='Check source behavior').run;for(const marker of ['npm test','python -m unittest','community/tests'])assert.ok(regression.includes(marker));
 const renderer=steps.find(step=>step.name==='Prepare renderer and check the current settings and wizard').run;for(const marker of ['npm run build','capture-provider-logos','capture-voice-wizard','capture-wallpaper-opacity'])assert.ok(renderer.includes(marker));
 const logo=steps.find(step=>step.name==='Cache official provider icons and record unavailable assets');assert.ok(logo.run.includes('cache-provider-logos.cjs --allow-missing'));assert.ok(logo.run.includes('GITHUB_STEP_SUMMARY'));
 const evidence=steps.find(step=>step.name==='Preserve interface and official logo evidence');assert.equal(evidence.if,'always()');assert.ok(evidence.with.path.includes('public/provider-logos/manifest.json'));
 const build=fs.readFileSync(path.join(root,'scripts/build-base-app.cjs'),'utf8');assert.ok(build.includes("'prepare-wallpapers.cjs'"));assert.ok(build.includes('verifyBundledProviderLogos'));
 for(const job of Object.values(workflow.jobs)){assert.equal(job.permissions,undefined);for(const step of job.steps){assert.notEqual(step['continue-on-error'],true);assert.doesNotMatch(step.run||'',/gh release|git push|--clobber|ExecutionPolicy Bypass/);}}
});
test('multimodal native smoke binds the exact new commit and run while preserving failure evidence',()=>{
 assert.equal(workflow.jobs.native_smoke.needs,'candidate');const steps=workflow.jobs.native_smoke.steps;
 const identity=steps.find(step=>step.name==='Verify exact source and installer bytes').run;for(const marker of ['GITHUB_SHA','GITHUB_RUN_ID','HEAD^{tree}','$source.sha256','$source.bytes'])assert.ok(identity.includes(marker));
 assert.ok(steps.some(step=>step.run==='python scripts/run-native-smoke.py'));assert.equal(steps.find(step=>step.name==='Preserve native smoke evidence').if,'always()');
 const upload=workflow.jobs.candidate.steps.find(step=>step.name==='Preserve unpublished candidate').with.path;
 assert.doesNotMatch(upload,/\*\*|\.glb|\.ckpt|\.pth|voice-models|local-model/);assert.ok(upload.includes('release/candidate-source.json'));
});
