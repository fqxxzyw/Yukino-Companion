const test=require('node:test'),assert=require('node:assert/strict');
const entry=id=>({id,custom:true,ready:true,sha256:id});
const png='data:image/png;base64,ZmFrZQ==';
test('model cards serialize render work and reuse only successful content-specific snapshots',async()=>{
 const {createModelPreviewQueue}=await import('../src/ui/model-card-preview.mjs');let active=0,max=0,calls=0;
 const queue=createModelPreviewQueue(async()=>{calls++;active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return png;});
 assert.deepEqual(await Promise.all([queue.get(entry('one')),queue.get(entry('two')),queue.get(entry('one'))]),[png,png,png]);assert.equal(max,1);assert.equal(calls,2);
 await queue.get({...entry('one'),sha256:'updated'});assert.equal(calls,3);
});
test('cancelled and failed previews release the queue and never become cached',async()=>{
 const {createModelPreviewQueue}=await import('../src/ui/model-card-preview.mjs');let calls=0;
 const queue=createModelPreviewQueue(async e=>{calls++;if(e.id==='bad')throw Error('invalid model');return png;});
 const controller=new AbortController();controller.abort();await assert.rejects(queue.get(entry('cancel'),{signal:controller.signal}),/abort/i);
 await assert.rejects(queue.get(entry('bad')),/invalid/);assert.equal(await queue.get(entry('good')),png);await assert.rejects(queue.get(entry('bad')),/invalid/);assert.equal(calls,3);
 await assert.rejects(queue.get({...entry('no'),ready:false}),/不可预览/);
});
test('character cards show name, introduction, current state and an explicit no-model value without a duplicate character selector',async t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{createServer}=await import('vite');
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});t.after(()=>server.close());
 const {default:Characters}=await server.ssrLoadModule('/src/ui/CharacterSettings.jsx'),character={id:'a',name:'测试角色',persona:'独立角色介绍',modelId:''};
 const html=renderToStaticMarkup(React.createElement(Characters,{characters:[character],current:character,models:[],relationship:{},usedDates:[]}));
 assert.match(html,/测试角色/);assert.match(html,/独立角色介绍/);assert.match(html,/使用中/);assert.match(html,/<small>无<\/small>/);assert.equal((html.match(/>当前角色</g)||[]).length,0);
});
