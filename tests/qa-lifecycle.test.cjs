'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withTimeout,finalizeCapture}=require('../scripts/qa-lifecycle.cjs');
test('Windows locked Chromium profile cannot prevent QA report and process exit',async()=>{
 const report={errors:[]},calls=[];await finalizeCapture({report,dispose:async()=>calls.push('dispose'),cleanup:async()=>{throw Error('EPERM: Chromium profile is still open')},save:()=>calls.push('report'),exit:code=>calls.push(code)});
 assert.deepEqual(calls,['dispose','report',0]);assert.equal(report.cleanupWarnings.length,1);assert.deepEqual(report.errors,[]);
});
test('failed disposal still attempts report and exits unsuccessfully',async()=>{
 const report={errors:[]},calls=[];await finalizeCapture({report,dispose:()=>Promise.reject(Error('write failed')),cleanup:()=>calls.push('cleanup'),save:()=>calls.push('report'),exit:code=>calls.push(code)});
 assert.deepEqual(calls,['cleanup','report',1]);assert.match(report.errors[0],/write failed/);
});
test('a hung renderer operation fails within its deadline',async()=>{
 await assert.rejects(withTimeout(new Promise(()=>{}),'capturePage',10),/capturePage timed out/);
});
test('a hung final cleanup does not hold CI forever',async()=>{
 const report={errors:[]},calls=[];await finalizeCapture({report,dispose:()=>new Promise(()=>{}),cleanup:async()=>{},save:()=>calls.push('report'),exit:code=>calls.push(code),timeout:10});
 assert.deepEqual(calls,['report',1]);assert.match(report.errors[0],/timed out/);
});
