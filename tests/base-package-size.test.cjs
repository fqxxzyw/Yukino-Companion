'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {MAX_UNPACKED_BYTES,validateUnpackedBudget,inspectDetachedResources,readExact,verifyWindowsExecutable,verifyBaseApp}=require('../scripts/build-base-app.cjs');

async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-base-size-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}

test('expanded base budget accepts the measured complete 17-variant footprint without changing installer policy',()=>{
  assert.doesNotThrow(()=>validateUnpackedBudget(658292971));
  assert.doesNotThrow(()=>validateUnpackedBudget(MAX_UNPACKED_BYTES));
  assert.throws(()=>validateUnpackedBudget(MAX_UNPACKED_BYTES+1),/unpacked budget/);
  for(const bytes of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateUnpackedBudget(bytes),/invalid size/);
});

test('base measurement includes real files recursively, not just the ASAR or compressed estimate',async t=>{
  const directory=await fixture(t);await fs.mkdir(path.join(directory,'resources'));
  await fs.writeFile(path.join(directory,'Yukino Companion.exe'),Buffer.alloc(23));
  await fs.writeFile(path.join(directory,'resources/app.asar'),Buffer.alloc(41));
  assert.equal(await inspectDetachedResources(directory),64);
});

test('larger expanded budget still rejects detached model weights, audio, and visual files',async t=>{
  const directory=await fixture(t);await fs.mkdir(path.join(directory,'resources'));
  for(const extension of ['gguf','ckpt','pth','safetensors','onnx','ogg','glb']){
    const filename=path.join(directory,'resources/unexpected.'+extension);await fs.writeFile(filename,'small forbidden fixture');
    await assert.rejects(inspectDetachedResources(directory),/Unexpected weight\/audio/);await fs.unlink(filename);
  }
});

test('expanded budget still rejects embedded runtime/model directories',async t=>{
  const directory=await fixture(t);
  for(const name of ['python-runtime','inference-engine','translation-models','local-model']){
    const folder=path.join(directory,name);await fs.mkdir(folder);
    await assert.rejects(inspectDetachedResources(directory),/Heavy runtime/);await fs.rmdir(folder);
  }
});

test('unfinished build copies cannot silently enter a private candidate',async t=>{
  const directory=await fixture(t);await fs.mkdir(path.join(directory,'resources'));
  await fs.writeFile(path.join(directory,'resources/.app.asar.abc123'),'partial archive');
  await assert.rejects(inspectDetachedResources(directory),/temporary\/hidden file/);
});

test('base inspection refuses links instead of following content outside the candidate',async t=>{
  const directory=await fixture(t);const target=path.join(directory,'target');await fs.mkdir(target);
  await fs.symlink(target,path.join(directory,'linked'),'junction');
  await assert.rejects(inspectDetachedResources(directory),/Unexpected link/);
});

function syntheticPE(){
  const b=Buffer.alloc(400);b.write('MZ');b.writeUInt32LE(64,60);b.write('PE\0\0',64);b.writeUInt16LE(0x8664,68);b.writeUInt16LE(1,70);b.writeUInt16LE(240,84);b.writeUInt16LE(2,86);b.writeUInt16LE(0x20b,88);b.writeUInt32LE(16,344);b.writeUInt32LE(384,348);return b;
}

test('verify-only refuses a candidate missing its main executable before declaring package success',async t=>{
  const directory=await fixture(t);await assert.rejects(verifyBaseApp(directory),/ENOENT/);
});

test('main executable gate rejects wrong architecture, broken signatures, and truncated sections',async t=>{
  const directory=await fixture(t),filename=path.join(directory,'test.exe');
  const good=syntheticPE();await fs.writeFile(filename,good);
  assert.deepEqual(await verifyWindowsExecutable(filename),{bytes:400,machine:'AMD64',format:'PE32+',executed:false});
  for(const mutate of [b=>b.write('XX',0),b=>b.writeUInt16LE(0x14c,68),b=>b.writeUInt32LE(4000,348),b=>b.writeUInt16LE(0x2002,86),b=>b.writeUInt16LE(0x10b,88)]){
    const bad=Buffer.from(good);mutate(bad);await fs.writeFile(filename,bad);await assert.rejects(verifyWindowsExecutable(filename),/Invalid|Truncated|PE32/);
  }
  await fs.writeFile(filename,good.subarray(0,30));await assert.rejects(verifyWindowsExecutable(filename),/regular complete/);
});

test('short header reads are completed and early EOF cannot become zero-filled section data',async()=>{
  const source=Buffer.from('complete-header'),handle={async read(buffer,offset,length,position){const bytesRead=Math.min(2,length,Math.max(0,source.length-position));source.copy(buffer,offset,position,position+bytesRead);return {bytesRead};}};
  assert.deepEqual(await readExact(handle,source.length,0),source);
  await assert.rejects(readExact(handle,source.length+1,0),/Truncated/);
});
