// Same-camera lit/toon review of the production scene factories in an isolated
// Electron window. Usage:
//   node scripts/review-scene-styles.mjs <phase>
// Env: REVIEW_SCENES=kasai,sakura  REVIEW_STYLES=lit,toon
//      REVIEW_VIEWS=companion,photo,overview  REVIEW_STATES=day,dusk,rainnight
//      REVIEW_PLAN='{"kasai":{"day":["glazing","overview"],"rainnight":["companion"]}}'
//      REVIEW_ROUNDTRIP=1 records a frozen lit → toon → lit pixel comparison.
//      REVIEW_TIMING_BATCHES=7 repeats the eight-frame timing on the last view.
//      REVIEW_PETAL_CLIP=1 records the two live Sakura companion styles and their particle states.
// Output: build/style-review/<phase>/<scene>-<state>-<view>-<style>.png + report.json
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const phase=process.argv[2]||'after';
const output=path.join(root,'build/style-review',phase);
await fs.mkdir(output,{recursive:true});
const list=(name,fallback)=>(process.env[name]||fallback).split(',').map(v=>v.trim()).filter(Boolean);
const plan=process.env.REVIEW_PLAN?JSON.parse(process.env.REVIEW_PLAN):null;
const scenes=plan?Object.keys(plan):list('REVIEW_SCENES','kasai,sakura,city,inage,kyoto,school,forest,bookshop,classroom,wedding');
const styles=list('REVIEW_STYLES','lit,toon');
const petalClip=process.env.REVIEW_PETAL_CLIP==='1';
const timingBatches=Math.min(30,Math.max(1,Math.floor(Number(process.env.REVIEW_TIMING_BATCHES)||1)));
const views=list('REVIEW_VIEWS','companion,photo,overview');
const states=list('REVIEW_STATES','day');
const climates={
 day:{hour:14,weather:{cloud:.18,rain:0,fog:0,snow:0,wind:.3}},
 noon:{hour:12,weather:{cloud:.1,rain:0,fog:0,snow:0,wind:.2}},
 golden:{hour:17.3,weather:{cloud:.22,rain:0,fog:0,snow:0,wind:.2}},
 dusk:{hour:18.75,weather:{cloud:.3,rain:0,fog:0,snow:0,wind:.25}},
 night:{hour:22,weather:{cloud:.1,rain:0,fog:0,snow:0,wind:.2}},
 rainnight:{hour:21.5,weather:{cloud:1,rain:.8,fog:.12,snow:0,wind:.5}},
 rain:{hour:14,weather:{cloud:1,rain:.8,fog:.12,snow:0,wind:.5}},
 overcast:{hour:12,weather:{cloud:.85,rain:0,fog:0,snow:0,wind:.3}},
};
const entry=path.join(output,'entry.cjs');
const width=Number(process.env.REVIEW_WIDTH||1280),height=Number(process.env.REVIEW_HEIGHT||800);
await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:${width},height:${height},useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.REVIEW_URL);});`);
const server=await createServer({root,logLevel:'warn',cacheDir:path.join(root,'build/style-review/.vite'),optimizeDeps:{entries:['src/ui/environment-backdrop.mjs']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{
 name:'style-review',configureServer(server){server.middlewares.use('/__style-review',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden;background:#bbc8cf}canvas{display:block;width:100%;height:100%}</style><div id="stage"></div><script type="module">
 import {EnvironmentBackdrop} from '/src/ui/environment-backdrop.mjs';
 window.review=new EnvironmentBackdrop(document.querySelector('#stage'),{interactive:${!petalClip},reducedMotion:${!petalClip},onError:e=>{window.reviewError=String(e.stack||e)}});
 </script>`);});}
}]});
let application;const report={phase,errors:[],warnings:[],scenes:[]};
try{
 await server.listen();const env={...process.env,REVIEW_URL:`http://127.0.0.1:${server.httpServer.address().port}/__style-review`};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});
 const page=await application.firstWindow({timeout:90000});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',e=>{
  const message=e.text();
  if(e.type()==='error'||/VALIDATE_STATUS false|shader error|failed to compile/i.test(message))report.errors.push(message);
  else if(/warning|THREE\.WebGLProgram/i.test(message)&&!report.warnings.includes(message))report.warnings.push(message);
 });
 await page.waitForFunction(()=>window.review,{},{timeout:90000});
 if(petalClip){
  // An initially hidden native window can report document.hidden === false
  // and still get one compositor frame per second on Windows.
  await application.evaluate(({BrowserWindow})=>{
   const window=BrowserWindow.getAllWindows()[0];
   window.showInactive();
   window.setAlwaysOnTop(true,'floating');
  });
  await page.waitForFunction(()=>!document.hidden);
 }
 for(const id of scenes){
  const record={id,shots:[],frames:{},timing:{}};
  for(const state of plan?Object.keys(plan[id]):states){
   const {hour,weather}=climates[state];
   const t0=Date.now();
   await page.evaluate(async({id,hour,weather})=>{
    const r=window.review;await r.update(id,hour,weather);
    if(window.reviewError)throw Error(window.reviewError);
    r.key('Home');
    r.overviewHome={position:r.camera.position.toArray(),target:r.target.toArray(),fov:r.camera.fov};
   },{id,hour,weather});
   record.timing[state+'-load']=Date.now()-t0;
   for(const style of styles){
    for(const view of plan?plan[id][state]:views){
     const frame=await page.evaluate(async({style,view,inspect})=>{
      const r=window.review;r.setRenderStyle(style);
      if(r.styleAnimation)await r.styleAnimation.finished.catch(()=>{});
      const presets=r.current.cameraPresets||{};
      const inspection={
       city:{interior:{position:[1.86,1.64,1.9],target:[-1.54,2.0,-3.3],fov:62}},
       inage:{side:{position:[0,8,42],target:[0,6,0],fov:45}},
       sakura:{
        side:{position:[9.5,3.8,3],target:[-5.6,3.7,.5],fov:50},
        profile:{position:[-2.25,4.25,-17.8],target:[-4.05,5.93,.4],fov:40},
       },
       kasai:{
        glazing:{position:[4.8,5.6,8],target:[4.8,5.1,-22],fov:42},
        stairs:{position:[31.9,4.35,-6.8],target:[29,3.45,-17.7],fov:37},
       },
      };
      const p=view==='overview'?r.overviewHome:presets[view]||inspection[r.environmentScene]?.[view]||(view==='photo'?presets.companion:null);
      if(!p)return false;
      if(inspect&&r.controls){
       // The overview's orbit limits otherwise move an inspection camera
       // away from the glazing between the draw and the compositor capture.
       r.controls.minDistance=.05;r.controls.maxDistance=3000;
       r.controls.minPolarAngle=.001;r.controls.maxPolarAngle=Math.PI-.001;
      }
      r.camera.position.fromArray(p.position);r.target.fromArray(p.target);r.controls?.target.copy(r.target);
      r.camera.fov=p.fov||38;r.camera.clearViewOffset?.();r.camera.updateProjectionMatrix();r.camera.lookAt(r.target);
      r.controls&&(r.controls.enabled=false);
      r.gl.shadowMap.needsUpdate=true;r.render();r.render();return true;
     },{style,view,inspect:Boolean(plan)});
     if(!frame)continue;
     const file=`${id}-${state}-${view}-${style}.png`;
     await page.screenshot({path:path.join(output,file)});
     record.shots.push(file);
     record.frames[file]=await page.evaluate(()=>{
      const r=window.review;
      return {position:r.camera.position.toArray(),target:r.target.toArray(),fov:r.camera.fov,
       projection:r.camera.projectionMatrix.toArray(),bounds:[r.bounds.min.toArray(),r.bounds.max.toArray()]};
     });
     if(petalClip&&id==='sakura'&&view==='companion'){
      const clip=await page.evaluate(async()=>{
       const r=window.review,metadata=r.current.sakuraLife.metadata;
       if(document.hidden||r.reducedMotion||!metadata.motionEnabled)throw Error('Petal capture requires the active animated companion view');
       const stream=r.gl.domElement.captureStream(15);
       const type=['video/webm;codecs=vp9','video/webm;codecs=vp8'].find(t=>MediaRecorder.isTypeSupported(t));
       const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:3500000});
       const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
       const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;});
       function sample(){
        const visible=[];
        for(const p of metadata.petals){
         const q=r.camera.position.clone().set(p.x,p.y,p.z).project(r.camera);
         if(Math.abs(q.x)<=1&&Math.abs(q.y)<=1&&Math.abs(q.z)<=1)visible.push([p.id,p.kind,p.x,p.y,p.z,(q.x+1)*.5,(1-q.y)*.5]);
        }
        return {time:performance.now(),phase:metadata.phase,falling:metadata.falling,
         floating:metadata.floating,releases:metadata.releases,contacts:metadata.contacts,visible};
       }
       recorder.start();r.requestRender();
       const samples=[sample()];
       for(let i=0;i<6;i++){await new Promise(ok=>setTimeout(ok,1000));samples.push(sample());}
       recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
       if(samples.at(-1).phase-samples[0].phase<1.7)throw Error('Visible companion did not advance at its normal animation rate');
       const blob=new Blob(chunks,{type});if(!blob.size)throw Error('Empty petal capture');
       const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
       return {data,samples};
      });
      const movie=file.replace('.png','.webm');
      await fs.writeFile(path.join(output,movie),Buffer.from(clip.data,'base64'));
      (record.motion??={})[movie]=clip.samples;
     }
    }
   }
  }
  record.stats=await page.evaluate(batches=>{
   const r=window.review,info=r.gl.info,gl=r.gl.getContext();
   info.autoReset=false;info.reset();r.render();
   const {calls,triangles}=info.render;info.autoReset=true;
   const samples=[];
   for(let batch=0;batch<batches;batch++){
    const start=performance.now();
    for(let frame=0;frame<8;frame++){r.render();gl.finish();}
    samples.push(Math.round((performance.now()-start)/8*10)/10);
   }
   const stats={drawCalls:calls,triangles,programs:info.programs.length,
    textures:info.memory.textures,geometries:info.memory.geometries,meanFrameMs:samples[0]};
   if(batches>1)stats.eightFrameBatchesMs=samples;
   return stats;
  },timingBatches);
  if((process.env.REVIEW_ROUNDTRIP??(plan?'1':'0'))==='1'){
   if(plan){
    await page.evaluate(async({id,weather})=>{
     const r=window.review;await r.update(id,14,weather);
     const p=r.current.cameraPresets.companion;
     r.camera.position.fromArray(p.position);r.target.fromArray(p.target);r.controls?.target.copy(r.target);
     r.camera.fov=p.fov||38;r.camera.clearViewOffset();r.camera.updateProjectionMatrix();r.camera.lookAt(r.target);
     r.gl.shadowMap.needsUpdate=true;r.render();
    },{id,weather:climates.day.weather});
   }
   record.roundtrip=await page.evaluate(()=>{
    const r=window.review,probe=document.createElement('canvas');probe.width=192;probe.height=120;
    const ctx=probe.getContext('2d',{willReadFrequently:true});
    // Alpha-to-coverage flowers retain fractional alpha at their edges.
    // Overwriting the probe prevents an earlier style bleeding into a read.
    ctx.globalCompositeOperation='copy';
    const read=style=>{
     r.setRenderStyle(style);r.render();r.render();
     ctx.drawImage(r.gl.domElement,0,0,probe.width,probe.height);
     return ctx.getImageData(0,0,probe.width,probe.height).data;
    };
    const baseline=read('lit'),cameraBefore=r.camera.matrixWorld.toArray(),skyBefore=r.scene.background;
    const repeat=read('lit');
    const painted=read('toon'),restored=read('lit');
    const compare=image=>{
     let sum=0,different=0,max=0;
     for(let i=0;i<image.length;i+=4){
      let delta=0;
      for(let c=0;c<3;c++){const channel=Math.abs(image[i+c]-baseline[i+c]);sum+=channel;delta=Math.max(delta,channel);}
      if(delta>2)different++;max=Math.max(max,delta);
     }
     return {meanRGB:sum/(probe.width*probe.height*3),pixelsOver2:different,max};
    };
    const result={composite:'copy',styleDifference:compare(painted),restoredDifference:compare(restored),litRepeatDifference:compare(repeat),pixels:probe.width*probe.height,
     sameCamera:cameraBefore.every((v,i)=>v===r.camera.matrixWorld.elements[i]),sameBackground:r.scene.background===skyBefore};
    if(result.restoredDifference.pixelsOver2){
     const delta=ctx.createImageData(probe.width,probe.height);
     for(let i=0;i<restored.length;i+=4){
      const distance=Math.max(...[0,1,2].map(c=>Math.abs(restored[i+c]-baseline[i+c])));
      for(let c=0;c<3;c++)delta.data[i+c]=Math.min(255,baseline[i+c]*.28+(c===0?distance*21:0));
      delta.data[i+3]=255;
     }
     ctx.putImageData(delta,0,0);result.deltaPNG=probe.toDataURL('image/png').split(',')[1];
    }
    return result;
   });
   if(plan)record.roundtrip.frame={state:'day',view:'companion'};
   if(record.roundtrip.deltaPNG){
    const name=id+'-return-difference.png';
    await fs.writeFile(path.join(output,name),Buffer.from(record.roundtrip.deltaPNG,'base64'));
    delete record.roundtrip.deltaPNG;record.roundtrip.differenceImage=name;
   }
  }
  if(styles.includes('lit')){await page.evaluate(()=>window.review.setRenderStyle('lit'));}
  report.scenes.push(record);console.log(id,JSON.stringify(record.stats));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 }
 await page.evaluate(()=>window.review.dispose());
}catch(error){report.errors.push(String(error.stack||error));console.error(error);}
finally{await application?.close().catch(()=>{});await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({output,scenes:report.scenes.length,errors:report.errors.slice(0,10)}));
if(report.errors.length)process.exitCode=1;
