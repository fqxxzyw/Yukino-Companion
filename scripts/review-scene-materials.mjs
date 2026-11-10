// Real app scene renderer, isolated browser and deterministic review climates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const phase=process.argv[2]||'after';
const output=path.join(root,'build/material-review',phase);
await fs.mkdir(output,{recursive:true});
const entry=path.join(output,'entry.cjs');
await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.REVIEW_URL);});`);
const server=await createServer({root,cacheDir:path.join(root,'build/material-review/.vite'),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
 name:'material-review',configureServer(server){server.middlewares.use('/__material-review',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden;background:#bbc8cf}canvas{display:block;width:100%;height:100%}</style><div id="stage"></div><script type="module">
 import {EnvironmentBackdrop} from '/src/ui/environment-backdrop.mjs';
 import * as THREE from '/node_modules/three/build/three.module.js';window.reviewThree=THREE;
 window.review=new EnvironmentBackdrop(document.querySelector('#stage'),{interactive:${process.env.REVIEW_HOME?'false':'true'},reducedMotion:true,onError:e=>{window.reviewError=String(e.stack||e)}});
 </script>`);});}
}]});
let application;const report={errors:[],scenes:[]};
try{
 await server.listen();const env={...process.env,REVIEW_URL:`http://127.0.0.1:${server.httpServer.address().port}/__material-review`};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});
 const page=await application.firstWindow({timeout:90000});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')report.errors.push(e.text())});
 await page.waitForFunction(()=>window.review,{},{timeout:90000});
 for(const id of (process.env.REVIEW_SCENES||'school,wedding,kasai,city,classroom,bookshop,forest,inage,kyoto').split(',')){
  console.log(`Review ${phase}: ${id}`);
  const info=await page.evaluate(async id=>{
   const r=window.review;await r.update(id,14,null);if(window.reviewError)throw Error(window.reviewError);
   const materials=new Map(),meshes=[];
   r.current.root.traverse(o=>{if(o.isMesh){meshes.push({name:o.name,position:o.position.toArray(),scale:o.scale.toArray(),material:[o.material].flat().map(m=>m.name)});for(const m of [o.material].flat()){const v=materials.get(m.uuid)||{name:m.name,type:m.type,color:m.color?.getHexString(),roughness:m.roughness,metalness:m.metalness,map:m.map?.name,opacity:m.opacity,profile:m.userData.surfaceProfile,meshes:[]};v.meshes.push(o.name);materials.set(m.uuid,v)}}});
   r.render();return {id,materials:[...materials.values()],meshes,stats:{...r.gl.info.render},presets:r.current.cameraPresets};
  },id);
  await page.screenshot({path:path.join(output,id+'-overview.png')});
  for(const [view,hour,weather] of [['photo',14,null],...(phase==='before'?[]:[['rain',14,{cloud:1,rain:.85,fog:.15,snow:0,wind:.4}],['night',23,null]])]){
   await page.evaluate(async({view,hour,weather,home})=>{const r=window.review;await r.update(r.environmentScene,hour,weather);const p=home?r.current.cameraPresets.companion:r.current.cameraPresets.photo||r.current.cameraPresets.companion;if(p?.position){r.camera.position.fromArray(p.position);r.target.fromArray(p.target);r.controls?.target.copy(r.target);r.camera.fov=p.fov||38;r.camera.updateProjectionMatrix();r.camera.lookAt(r.target);}r.render();},{view,hour,weather,home:Boolean(process.env.REVIEW_HOME)});
   await page.screenshot({path:path.join(output,id+'-'+view+'.png')});
  }
  if(id==='forest'){
   const frames=[];
   for(const time of [2,5]){
    await page.evaluate(async time=>{const r=window.review;await r.update('forest',14,null);r.current.setMotion({enabled:true});r.current.update(.016,time);r.render();},time);
    frames.push(await page.screenshot({path:path.join(output,`forest-sway-${time}.png`)}));
   }
   if(frames[0].equals(frames[1]))throw Error('Bamboo wind produced identical rendered frames');
   await page.evaluate(()=>window.review.current.setMotion({enabled:false}));
  }
  info.validation=await page.evaluate(async()=>{
   const r=window.review,api=r.current;
   if(r.environmentScene==='forest'){
    const T=window.reviewThree;api.root.updateMatrixWorld(true);
    for(const z of [7,0,-6,-9]){const x=z===-9?0:.8*Math.sin(z*.2)+.35*Math.sin(z*.4+1),ray=new T.Raycaster(new T.Vector3(x,1,z),new T.Vector3(0,-1,0));
     const hit=ray.intersectObject(api.framingRoot,true).find(hit=>hit.object.material?.isMeshStandardMaterial);
     if(!hit||!hit.object.material.name.startsWith('asphalt:'))throw Error('Bamboo path is not the upward-facing visible walking surface at '+z+': '+hit?.object.material.name);
    }
   }
   const before=[];api.root.traverse(o=>{if(o.isMesh)before.push(o.geometry.uuid)});
   const camera=r.camera.position.toArray();
   const weather={cloud:1,rain:.85,fog:.15,snow:0,wind:.4};
   await r.update(r.environmentScene,{kind:'solar',elevation:38,hourAngle:-35},weather);
   const lights=[];api.root.traverse(o=>{if(o.isDirectionalLight)lights.push(o.position.toArray())});
   await r.update(r.environmentScene,{kind:'solar',elevation:38,hourAngle:35},weather);
   const moved=[];api.root.traverse(o=>{if(o.isDirectionalLight)moved.push(o.position.toArray())});
   if(JSON.stringify(lights)===JSON.stringify(moved))throw Error('Sun direction did not follow real solar position');
   const after=[];api.root.traverse(o=>{if(o.isMesh)after.push(o.geometry.uuid)});
   if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Weather replaced geometry');
   if(JSON.stringify(camera)!==JSON.stringify(r.camera.position.toArray()))throw Error('Climate changed camera');
   await r.update(r.environmentScene,14,null);
   let wet=0;api.root.traverse(o=>{for(const m of [o.material].flat().filter(Boolean))wet+=m.userData.surfaceUniforms?.uSurfaceRain.value||0});
   if(wet!==0)throw Error('Dry weather left wet materials');
   const start=performance.now();for(let i=0;i<6;i++){r.render();r.gl.getContext().finish()}
   return {sameGeometry:true,sameCamera:true,solarDirectionChanged:true,wetnessReset:true,meanFrameMs:Math.round((performance.now()-start)/6*10)/10,drawCalls:r.gl.info.render.calls,triangles:r.gl.info.render.triangles,programs:r.gl.info.programs.length};
  });
  report.scenes.push(info);
 }
 report.backend=await page.evaluate(()=>{const gl=window.review.gl.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'});
 await page.evaluate(()=>window.review.dispose());
}catch(error){report.errors.push(String(error.stack||error));throw error;}finally{await application?.close();await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({output,scenes:report.scenes.length,errors:report.errors,backend:report.backend}));
if(report.errors.length)process.exitCode=1;
