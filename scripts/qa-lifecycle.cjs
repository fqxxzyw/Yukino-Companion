'use strict';
function withTimeout(promise,label,milliseconds=10000){
 let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out after ${milliseconds} ms`)),milliseconds)})]).finally(()=>clearTimeout(timer));
}
async function finalizeCapture({report,failed=false,dispose,cleanup,save,exit,timeout=10000}){
 let failure=failed;
 try{
  try{if(dispose)await withTimeout(dispose(),'Companion cleanup',timeout)}catch(error){failure=true;report.errors.push(`Cleanup: ${error.message}`)}
  // Chromium still owns userData handles until app.exit on Windows. Removing
  // that temporary folder is best effort, and must never prevent process exit.
  try{if(cleanup)await withTimeout(cleanup(),'Temporary profile removal',timeout)}catch(error){(report.cleanupWarnings??=[]).push(error.message)}
  try{await withTimeout(save(),'QA report save',timeout)}catch(error){failure=true;report.errors.push(`Report: ${error.message}`);console.error(error)}
 }finally{exit(failure?1:0)}
}
module.exports={withTimeout,finalizeCapture};
