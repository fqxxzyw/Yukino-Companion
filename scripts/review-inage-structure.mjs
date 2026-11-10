// Capture the production Three.js scene from diagnostic viewpoints in an
// isolated, hidden Electron window. Never loads the user's desktop profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
import {SCENES} from '../src/ui/scene-catalog.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/inage-structure-review');
await fs.mkdir(output,{recursive:true});
const entry=path.join(output,'entry.cjs');
await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.REVIEW_URL);});`);
const server=await createServer({root,cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/build/**']}},plugins:[{
 name:'inage-structure-review',configureServer(server){server.middlewares.use('/__inage-review',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><div id="stage"></div><script type="module">
 import {EnvironmentBackdrop} from '/src/ui/environment-backdrop.mjs';
 window.review=new EnvironmentBackdrop(document.querySelector('#stage'),{interactive:true,reducedMotion:true,onError:e=>{window.reviewError=String(e.stack||e)}});
 </script>`);});}
}]});
const report={errors:[],screenshots:[],checks:[]};
let application;
try{
 await server.listen();
 const url=`http://127.0.0.1:${server.httpServer.address().port}`;
 const env={...process.env,REVIEW_URL:url+'/__inage-review'};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({args:[entry],cwd:root,env,timeout:60000});
 const page=await application.firstWindow();
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())});
 await page.waitForFunction(()=>window.review);
 await page.evaluate(async()=>{const r=window.review;await r.update('inage',14,null);if(window.reviewError)throw Error(window.reviewError);r.current.setMotion({enabled:false});r.render()});
 const companion=await page.evaluate(()=>window.review.current.cameraPresets.companion);
 const views=[
  ['overview',null],
  ['side',{position:[0,8,42],target:[0,6,0],fov:45}],
  ['end',{position:[-36,10,0],target:[5,7,0],fov:44}],
  ['top',{position:[0,54,.01],target:[0,0,0],fov:49}],
  ['walkway',{position:[-5,6.85,0],target:[14,7.7,0],fov:64}],
  ['road-underpass',{position:[-2.2,2.1,15],target:[-2.2,4,-10],fov:58}],
  ['companion',companion],
  ['companion-night',companion],
  ['road-night',{position:[-2.2,2.1,15],target:[-2.2,3,-10],fov:58}],
  ['road-night-without-lamps',{position:[-2.2,2.1,15],target:[-2.2,3,-10],fov:58}],
  ['road-night-lamps-only',{position:[-2.2,2.1,15],target:[-2.2,3,-10],fov:58}],
  ['night',null],
 ];
 for(const [name,view]of views){
  await page.evaluate(async({view,name})=>{const r=window.review;await r.update('inage',name.includes('night')?23:14,null);if(view){r.camera.position.fromArray(view.position);r.target.fromArray(view.target);r.controls.target.copy(r.target);r.camera.fov=view.fov;r.camera.updateProjectionMatrix();r.camera.lookAt(r.target)}else r.key('Home');
   r.lightIsolation=[];if(name.endsWith('without-lamps')||name.endsWith('lamps-only')){
    const lampsOnly=name.endsWith('lamps-only');r.current.root.traverse(o=>{if(o.isLight&&((lampsOnly&&o.name!=='inage:ground-road-downlight')||(!lampsOnly&&o.name==='inage:ground-road-downlight'))){r.lightIsolation.push([o,o.intensity]);o.intensity=0;}});
   }r.gl.shadowMap.needsUpdate=true;r.render();r.gl.getContext().finish();if(window.reviewError)throw Error(window.reviewError);},{view,name});
  await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');
  await page.evaluate(()=>{for(const [light,intensity]of window.review.lightIsolation||[])light.intensity=intensity;window.review.gl.shadowMap.needsUpdate=true;});
 }
 report.geometry=await page.evaluate(()=>{const r=window.review;return {bounds:{min:r.current.bounds.min.toArray(),max:r.current.bounds.max.toArray()},cameraPresets:r.current.cameraPresets,drawCalls:r.gl.info.render.calls,triangles:r.gl.info.render.triangles}});
 report.checks.push('Production scene renders in overview, side, end, top, companion, pedestrian and road views, and at night; road-light isolation uses identical exposure and camera');
 await page.evaluate(()=>window.review.dispose());
 // Render the actual app's browser preview to catch the original menu crash.
 await page.goto(url+'/');
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 const menu=page.getByRole('button',{name:'人物场景选项',exact:true});
 await menu.click();
 await page.locator('.character-scene-menu').waitFor();
 assert.equal(await page.locator('.scene-choice svg').count(),Object.keys(SCENES).length);
 await page.screenshot({path:path.join(output,'scene-menu.png')});report.screenshots.push('scene-menu.png');
 await menu.click();await menu.click();
 assert.equal(await page.locator('.scene-choice svg').count(),Object.keys(SCENES).length);
 assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).isEditable(),true);
 report.checks.push('Actual shared scene menu opens, closes and reopens with every catalogue SVG icon and a usable composer');
 assert.deepEqual(report.errors,[]);
 report.passed=true;
}catch(error){report.errors.push(String(error.stack||error));process.exitCode=1}
finally{await application?.close();await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({output,passed:report.passed||false,checks:report.checks,errors:report.errors},null,2));
