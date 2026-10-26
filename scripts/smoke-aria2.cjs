'use strict';
const path=require('node:path'),fs=require('node:fs/promises');
const {downloadResource}=require('../electron/resource-download.cjs');
(async()=>{
 const dest=path.resolve('build/aria2-smoke/runtime-catalog.json');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rm(dest,{force:true});
 const result=await downloadResource({url:'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-local.13/runtime-catalog.json',dest,bytes:703,sha256:'81f3ba2946e665d63fc1e03937e4eff1ec714e202b51dc321b8fe5c65a63f29c',aria2Path:path.resolve('build/aria2/aria2c.exe'),signal:AbortSignal.timeout(120000)});
 if(result.engine!=='aria2')throw Error('Actual Windows aria2 did not complete the smoke download');
 console.log('Official Windows aria2 completed a real SHA-256 verified HTTPS download');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
