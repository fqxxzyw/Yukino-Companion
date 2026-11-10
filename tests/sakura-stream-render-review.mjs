// Real production scene, isolated hidden GPU renderer; no user data or API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';

const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'build/sakura-stream-review');await fs.mkdir(output,{recursive:true});
const entry=path.join(output,'entry.cjs');await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});app.whenReady().then(()=>new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}}).loadURL(process.env.REVIEW_URL));`);
const server=await createServer({root,cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/build/**']}},plugins:[{name:'sakura-stream-review',configureServer(server){server.middlewares.use('/__sakura-review',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><div id="stage"></div><script type="module">import {EnvironmentBackdrop} from '/src/ui/environment-backdrop.mjs';window.review=new EnvironmentBackdrop(document.querySelector('#stage'),{interactive:false,reducedMotion:true,onError:error=>window.reviewError=String(error.stack||error)});</script>`)});}}]});
const report={errors:[],views:[]};let application;
try{
 await server.listen();const env={...process.env,REVIEW_URL:`http://127.0.0.1:${server.httpServer.address().port}/__sakura-review`};delete env.ELECTRON_RUN_AS_NODE;application=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});
 const page=await application.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())});await page.waitForFunction(()=>window.review);
 for(const [name,hour,weather]of [['day',14,null],['night',23,null],['rain',14,{cloud:.8,rain:.6,fog:.1,wind:.7}]]){
  const info=await page.evaluate(async({hour,weather})=>{const r=window.review;await r.update('sakura',hour,weather);r.setAnimationEnabled(false);r.render();r.gl.getContext().finish();if(window.reviewError)throw Error(window.reviewError);const start=performance.now();for(let i=0;i<4;i++){r.render();r.gl.getContext().finish();}return {camera:r.camera.position.toArray(),target:r.target.toArray(),drawCalls:r.gl.info.render.calls,triangles:r.gl.info.render.triangles,meanFrameMs:(performance.now()-start)/4,bounds:{min:r.bounds.min.toArray(),max:r.bounds.max.toArray()}};},{hour,weather});
  await page.screenshot({path:path.join(output,name+'.png')});report.views.push({name,...info});
 }
 await page.evaluate(async()=>{const r=window.review;await r.update('sakura',14,null);const p=r.current.cameraPresets.photo;r.camera.position.fromArray(p.position);r.target.fromArray(p.target);r.camera.fov=p.fov;r.camera.updateProjectionMatrix();r.camera.lookAt(r.target);r.render();r.gl.getContext().finish();});await page.screenshot({path:path.join(output,'water-close.png')});
 for(const [name,time]of [['motion-0',0],['motion-2',2]]){
  await page.evaluate(async time=>{const r=window.review;await r.update('sakura',14,null);r.current.setMotion({enabled:true});if(time===0)r.current.update(.04,0);else for(let t=.04;t<=time+.001;t+=.04)r.current.update(.04,t);r.render();r.gl.getContext().finish();},time);
  await page.screenshot({path:path.join(output,name+'.png')});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;await page.evaluate(()=>window.review.dispose());
}catch(error){report.errors.push(String(error.stack||error));process.exitCode=1;}
finally{await application?.close();await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({output,...report},null,2));
