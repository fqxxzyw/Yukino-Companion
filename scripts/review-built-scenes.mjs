// Verify the shipped file:// bundle and bundled texture paths, in an isolated
// hidden Electron profile. No desktop preload, native credentials or API calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron} from 'playwright-core';

const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'build/built-scenes-review');
await fs.mkdir(output,{recursive:true});
const assets=await fs.readdir(path.join(root,'dist/assets'));
const chunk=assets.find(name=>/^environment-backdrop-.*\.js$/.test(name));
assert.ok(chunk,'Build the production bundle before reviewing it');
const moduleUrl=pathToFileURL(path.join(root,'dist/assets',chunk)).href;
const base=pathToFileURL(path.join(root,'dist')+path.sep).href;
const html=path.join(output,'review.html'),entry=path.join(output,'entry.cjs');
await fs.writeFile(html,`<!doctype html><base href="${base}"><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}#root{display:none!important}#stage{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}</style><div id="root" hidden inert></div><div id="stage"></div><script type="module">
 import * as compiled from ${JSON.stringify(moduleUrl)};
 const Backdrop=Object.values(compiled).find(value=>typeof value==='function'&&value.prototype?.update&&value.prototype?.render&&value.prototype?.dispose);
 if(!Backdrop)throw Error('Compiled backdrop export missing');
 window.review=new Backdrop(document.querySelector('#stage'),{interactive:false,reducedMotion:true,onError:error=>window.reviewError=String(error.stack||error)});
 </script>`);
await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});app.whenReady().then(()=>{const window=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{backgroundThrottling:false}});window.loadFile(${JSON.stringify(html)});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;const report={passed:false,errors:[],scenes:[]};
try{
 app=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});const page=await app.firstWindow();
 page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())});
 await page.waitForFunction(()=>window.review,null,{timeout:30000});
 for(const id of ['inage','kyoto','sakura','school','city','bookshop','forest','wedding','kasai','classroom']){
  const info=await page.evaluate(async id=>{
   const r=window.review;if(!await r.update(id,14,null)||window.reviewError)throw Error(window.reviewError||'Compiled scene failed '+id);
   r.setAnimationEnabled(false);r.render();
   const finishes=[];r.current.root.traverse(o=>{for(const m of [o.material].flat().filter(Boolean))if(m.userData.architecturalFinish&&!finishes.some(f=>f.name===m.name))finishes.push({name:m.name,...m.userData.architecturalFinish});});
   return {id,finishes,canvasScene:r.host?.dataset?.scene||null,drawCalls:r.gl.info.render.calls,triangles:r.gl.info.render.triangles};
  },id);
  if(id==='inage')assert.ok(info.finishes.some(f=>f.kind==='concrete'&&f.photographed),'Bundled concrete maps must load through file://');
  if(id==='kyoto')for(const kind of ['wood','stone'])assert.ok(info.finishes.some(f=>f.kind===kind&&f.photographed),'Bundled '+kind+' maps must load through file://');
  if(['inage','sakura','school','wedding','kasai'].includes(id))assert.ok(info.finishes.some(f=>f.kind==='grass'&&f.photographed),'Bundled photographic turf must load through file://');
  await page.screenshot({path:path.join(output,id+'-day.png')});
  await page.evaluate(async id=>{const r=window.review;await r.update(id,23,null);r.render();},id);
  await page.screenshot({path:path.join(output,id+'-night.png')});
  if(id==='sakura'&&process.argv.includes('--record')){
   const bytes=await page.evaluate(async()=>{
    const r=window.review;await r.update('sakura',14,null);r.setAnimationEnabled(false);r.current.setMotion({enabled:true});
    // Hidden review windows may suspend requestAnimationFrame. Drive the same
    // production update/render interface explicitly for the recorded playback.
    let time=r.time;r.current.update(0,time);r.render();
    const stream=r.gl.domElement.captureStream(24),chunks=[],type='video/webm;codecs=vp8';
    const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:6500000});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    const timer=setInterval(()=>{time+=1/24;r.current.update(1/24,time);r.render();},1000/24);
    await new Promise(resolve=>setTimeout(resolve,6500));clearInterval(timer);recorder.stop();await done;
    stream.getTracks().forEach(track=>track.stop());r.setAnimationEnabled(false);
    return Array.from(new Uint8Array(await new Blob(chunks,{type}).arrayBuffer()));
   });
   await fs.writeFile(path.join(output,'sakura-motion.webm'),Buffer.from(bytes));report.motionPreview='sakura-motion.webm';
  }
  report.scenes.push(info);
 }
 await page.evaluate(()=>window.review.dispose());assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.errors.push(String(error.stack||error));process.exitCode=1;}
finally{await app?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
