'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {verify}=require('../scripts/verify-installed-window.cjs');
test('installed renderer that never opens its debugger socket times out and closes it',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-installed-timeout-'));
 const oldFetch=global.fetch,oldSocket=global.WebSocket,oldTimeout=global.setTimeout;let socket;
 t.after(async()=>{global.fetch=oldFetch;global.WebSocket=oldSocket;global.setTimeout=oldTimeout;await fs.rm(dir,{recursive:true,force:true});});
 await fs.writeFile(path.join(dir,'DevToolsActivePort'),'1234\n');
 global.fetch=async()=>({json:async()=>[{type:'page',url:'file:///app.asar/dist/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:1234'}]});
 global.WebSocket=class{constructor(){socket=this}addEventListener(){}close(){this.closed=true}};
 global.setTimeout=(fn,ms,...args)=>oldTimeout(fn,ms===10000?5:ms,...args);
 await assert.rejects(verify(dir),/connection timed out/);assert.equal(socket.closed,true);
});
