'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {record,verify}=require('../scripts/base-payload.cjs');
test('installed payload accepts exact bytes and rejects tampering, missing files and traversal',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-payload-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'resources'));const file=path.join(dir,'resources/app.asar');await fs.writeFile(file,'exact candidate');
  const manifest=await record(dir);assert.deepEqual(await verify(dir,manifest),{verifiedFiles:1});
  await fs.writeFile(file,'wrong candidate');await assert.rejects(verify(dir,manifest),/mismatch/);
  await fs.unlink(file);await assert.rejects(verify(dir,manifest),/ENOENT/);
  for(const entry of ['../escape','/absolute','resources/../escape','C:/escape','resources\\escape'])await assert.rejects(verify(dir,{...manifest,files:[{...manifest.files[0],path:entry}]}),/Invalid payload entry/);
  await fs.writeFile(file,'exact candidate');await assert.rejects(verify(dir,{...manifest,files:[...manifest.files,...manifest.files]}),/Invalid payload entry/);
});
test('payload verification refuses a linked ancestor',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-payload-link-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'real'));await fs.writeFile(path.join(dir,'real/file'),'data');
  const manifest=await record(dir);await fs.rename(path.join(dir,'real'),path.join(dir,'other'));await fs.symlink(path.join(dir,'other'),path.join(dir,'real'),'junction');
  await assert.rejects(verify(dir,manifest),/links are forbidden/);
});
