'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'..');
test('integration checks restore verified EXE inputs on each OS before the complete test command',()=>{
 const w=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/inference-checks.yml'),'utf8'));
 assert.equal(w.jobs.checks.strategy['fail-fast'],false);
 const steps=w.jobs.checks.steps,testing=steps.findIndex(s=>s.run==='npm test');
 for(const [name,os,command] of [['Recover verified character inputs on Linux','Linux','bash scripts/restore-character-inputs-linux.sh'],['Recover verified character inputs on Windows','Windows','./scripts/restore-character-inputs-windows.ps1']]){
  const index=steps.findIndex(s=>s.name===name);assert.ok(index>=0&&index<testing);assert.equal(steps[index].if,`runner.os == '${os}'`);assert.equal(steps[index].run,command);
 }
 const report=steps.find(s=>s.name==='Report unavailable private blink-review fixture');assert.match(report.run,/Seven private blink-review asset tests skipped/);
 const script=fs.readFileSync(path.join(root,'scripts/restore-character-inputs-linux.sh'),'utf8');
 assert.ok(script.indexOf('sha256sum --check --status')<script.indexOf('innoextract --silent'));assert.match(script,/258519106/);assert.match(script,/9303829072f1e97eba172bf88f2c3e279312dae13a8879308142f7aae4ef0011/);assert.match(script,/node scripts\/restore-character-inputs\.cjs/);assert.match(script,/trap 'rm -rf/);
});
