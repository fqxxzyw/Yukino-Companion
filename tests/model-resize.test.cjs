const test=require('node:test'),assert=require('node:assert/strict');

test('a model resize redraws immediately and ignores duplicate observer reports',async t=>{
 const THREE=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs');
 const previous=globalThis.document;globalThis.document={hidden:false};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous});
 const calls=[],renderer=Object.create(GlbAvatarRenderer.prototype),container={clientWidth:300,clientHeight:500};
 Object.assign(renderer,{container,root:{},scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(30,1,.01,100),gl:{setSize:(...args)=>calls.push(['size',...args]),render:()=>calls.push(['render']),setPixelRatio:()=>calls.push(['ratio'])}});
 renderer.resize();renderer.resize();assert.deepEqual(calls,[['size',300,500,false],['render']]);
 container.clientHeight=510;renderer.resize();assert.deepEqual(calls.slice(-2),[['size',300,510,false],['render']]);
 globalThis.document.hidden=true;container.clientHeight=520;renderer.resize();assert.deepEqual(calls.at(-1),['size',300,520,false]);
});
