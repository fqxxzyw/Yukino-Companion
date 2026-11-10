// Optional hidden-board DOM probe: node tests/blackboard-overlay-browser.mjs
// Real React, canvas and Three.js in an isolated browser; no provider or user data.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const server=await createServer({server:{host:'127.0.0.1',port:0},appType:'custom',logLevel:'silent'});
const html=`<!doctype html><html><body>
<div id="host" style="position:fixed;left:0;top:0;width:1000px;height:500px"></div><div id="root"></div>
<script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import*as THREE from'three';import Overlay from'/src/ui/BlackboardOverlay.jsx';
const scene=new THREE.Group(),material=new THREE.MeshStandardMaterial({name:'classroom:blackboard'});
window.original=new THREE.Texture();material.map=window.original;
const board=new THREE.Mesh(new THREE.PlaneGeometry(3.92,1.11),material);board.name='classroom:board';board.position.set(-2.65,1.48,-4.445);scene.add(board);
const camera=new THREE.PerspectiveCamera(40,2,.1,100);camera.position.set(-2.65,1.48,7);camera.lookAt(board.position);camera.updateMatrixWorld(true);
window.material=material;window.controllerRef={current:null};window.renders=0;window.idleCalls=[];window.scopeKey="test:one";
window.rendererRef={current:{current:{root:scene},environmentScene:'classroom',camera,gl:{domElement:document.getElementById('host')},requestRender(){window.renders++}}};
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.setEnabled=enabled=>window.root.render(React.createElement(Overlay,{enabled,controllerRef:window.controllerRef,rendererRef:window.rendererRef,scopeKey:window.scopeKey,onIdle:snapshot=>{window.idleCalls.push(snapshot);return false;}}));window.setEnabled(true);};window.mount();
</script></body></html>`;
server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__blackboard-test')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__blackboard-test',html));});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];await page.clock.install({time:new Date('2026-11-03T11:00:00Z')});page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__blackboard-test');
 await page.waitForFunction(()=>window.controllerRef.current?.project());
 const points=await page.evaluate(()=>window.controllerRef.current.project().points),point=(u,v)=>({x:points[0].x+(points[1].x-points[0].x)*u+(points[3].x-points[0].x)*v,y:points[0].y+(points[1].y-points[0].y)*u+(points[3].y-points[0].y)*v});
 assert.equal(await page.locator('.blackboard-overlay').innerText(),'');assert.equal(await page.locator('.blackboard-tools,.blackboard-drawing-card,.blackboard-canvas-host').count(),0);
 assert.equal(await page.evaluate(()=>window.material.map===window.original),true,'untouched board retains original material');
 const style=await page.locator('.blackboard-hit-surface').evaluate(el=>{const s=getComputedStyle(el);return{clip:el.style.clipPath,expected:window.controllerRef.current.project().clipPath,background:s.backgroundColor,outline:s.outlineWidth,shadow:s.boxShadow,cursor:s.cursor,pointerEvents:s.pointerEvents};});
 assert.equal(style.clip.replaceAll(', ',','),style.expected);assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.outline,'0px');assert.equal(style.shadow,'none');assert.notEqual(style.cursor,'crosshair');assert.equal(style.pointerEvents,'none');
 const center=point(.5,.5);
 await page.evaluate(({x,y})=>{const button=document.createElement('button');button.id='native-button';button.textContent='native';Object.assign(button.style,{position:'fixed',left:(x-40)+'px',top:(y-15)+'px',width:'80px',height:'30px'});button.onclick=()=>window.clicked=(window.clicked||0)+1;document.body.append(button);},center);
 await page.getByRole('button',{name:'native',exact:true}).click();assert.equal(await page.evaluate(()=>window.clicked),1);assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),false);await page.locator('#native-button').evaluate(el=>el.remove());
 await page.evaluate(({x,y})=>{const input=document.createElement('textarea');input.id='native-input';Object.assign(input.style,{position:'fixed',left:(x-40)+'px',top:(y-15)+'px',width:'80px',height:'30px'});document.body.append(input);},center);
 await page.locator('#native-input').click();await page.keyboard.type('retained');assert.equal(await page.locator('#native-input').inputValue(),'retained');assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),false);await page.locator('#native-input').evaluate(el=>el.remove());
 await page.mouse.move(10,700);await page.mouse.down();await page.mouse.move(200,700,{steps:5});await page.mouse.up();assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),false,'outside polygon never draws');
 async function stroke(u){const a=point(u,.35),b=point(u+.22,.7);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}
 await stroke(.2);assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true);assert.equal(await page.evaluate(()=>window.material.map===window.original),true);assert.equal(await page.evaluate(()=>window.controllerRef.current.overlay.material.map.isCanvasTexture),true);assert.deepEqual(await page.evaluate(()=>[...window.controllerRef.current.context.getImageData(0,0,1,1).data]),[0,0,0,0]);assert.ok(await page.evaluate(()=>window.renders>1));
 const receipt=await page.evaluate(()=>window.controllerRef.current.snapshot());assert.match(receipt.image,/^data:image\/png;base64,/);assert.deepEqual(await page.evaluate(()=>[...window.controllerRef.current.exportCanvas.getContext('2d').getImageData(0,0,1,1).data]),[24,60,48,255]);
 await stroke(.5);await page.evaluate(receipt=>window.controllerRef.current.clear(receipt),receipt);assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true,'newer ink survives an earlier acceptance');
 await page.evaluate(()=>window.root.unmount());assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true);assert.equal(await page.evaluate(()=>window.material.map===window.original),true);await page.evaluate(()=>window.mount());await page.waitForFunction(()=>window.controllerRef.current?.board);assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true);
 await page.evaluate(()=>window.controllerRef.current.clear());assert.equal(await page.evaluate(()=>window.material.map===window.original),true,'accepted ink never changes original board');assert.equal(await page.evaluate(()=>window.controllerRef.current.overlay.visible),false);assert.deepEqual(await page.evaluate(()=>[...window.controllerRef.current.context.getImageData(0,0,1,1).data]),[0,0,0,0]);
 await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));await stroke(.2);await page.clock.fastForward(179999);assert.equal(await page.evaluate(()=>window.idleCalls.length),0);await page.clock.fastForward(1);assert.equal(await page.evaluate(()=>window.idleCalls.length),1);assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true,'rejected idle callback preserves ink');await page.clock.fastForward(360000);assert.equal(await page.evaluate(()=>window.idleCalls.length),1,'unchanged rejected snapshot attempts once');
 await page.evaluate(()=>window.controllerRef.current.clear());await stroke(.2);await page.clock.fastForward(100000);await page.evaluate(()=>{window.scopeKey='test:other';window.setEnabled(true);});await page.clock.fastForward(180000);assert.equal(await page.evaluate(()=>window.idleCalls.length),1,'changed scope cancels stale idle send');assert.equal(await page.evaluate(()=>window.controllerRef.current.hasInk()),true);
 assert.deepEqual(errors,[]);console.log('PASS hidden board: scoped exact-three-minute idle, zero UI/cursor/glow, exact polygon, controls preserved, outside input ignored, real white texture, revision-safe clear and remount retention');
}finally{await browser?.close();await server.close();}
