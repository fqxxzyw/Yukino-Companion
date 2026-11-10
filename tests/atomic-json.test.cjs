'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {writeAtomicJson} = require('../electron/atomic-json.cjs');

test('temporarily locked Windows file is retried without losing the old state', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-json-test-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const destination = path.join(dir, 'state.json');
 await fs.writeFile(destination, '{"value":"old"}');
 let attempts = 0;
 const io = {...fs, async rename(from, to) {
   attempts++;
   if (attempts < 3) { assert.equal(await fs.readFile(to, 'utf8'), '{"value":"old"}'); const err = Error('locked'); err.code='EPERM'; throw err; }
   await fs.rename(from,to);
 }};
 await writeAtomicJson(io,destination,'{"value":"new"}',{pause:async()=>{}});
 assert.equal(attempts,3);
 assert.equal(JSON.parse(await fs.readFile(destination,'utf8')).value,'new');
 assert.deepEqual(await fs.readdir(dir),['state.json']);
});

test('persistent failure keeps both original state and recovery file', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-json-test-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const destination = path.join(dir, 'state.json');
 await fs.writeFile(destination, '{"value":"old"}');
 const io = {...fs, async rename(){const err=Error('locked');err.code='EPERM';throw err;}};
 await assert.rejects(writeAtomicJson(io,destination,'{"value":"new"}',{delays:[0,0],pause:async()=>{}}),{code:'EPERM'});
 assert.equal(JSON.parse(await fs.readFile(destination,'utf8')).value,'old');
 const files = (await fs.readdir(dir)).filter(name=>name!=='state.json');
 assert.equal(files.length,1);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,files[0]),'utf8')).value,'new');
});

test('concurrent writes never share or delete the other pending temporary file', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-json-test-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const destination = path.join(dir, 'state.json');
 await Promise.all(Array.from({length:20},(_,n)=>writeAtomicJson(fs,destination,JSON.stringify({n}))));
 const result=JSON.parse(await fs.readFile(destination,'utf8'));
 assert.ok(Number.isInteger(result.n) && result.n>=0 && result.n<20);
 assert.deepEqual(await fs.readdir(dir),['state.json']);
});
