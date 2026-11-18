'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLive2DAssets,live2dAssetRequest}=require('../electron/live2d-assets.cjs');
const {verifyBundledLive2D}=require('../scripts/build-base-app.cjs');
const root=path.resolve(__dirname,'..'),live2dRoot=path.join(root,'resources/live2d');

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-live2d-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return directory;
}

function protocolHarness(){
  let handler;
  return {
    get handler(){return handler;},
    session:{defaultSession:{protocol:{handle(scheme,fn){assert.equal(scheme,'yukino-live2d');handler=fn;}}}},
    request:(url,method='GET')=>handler(new Request(url,{method})),
  };
}

test('Live2D resource URLs are restricted to known viewer files and model assets',()=>{
  assert.equal(live2dAssetRequest('yukino-live2d://local/index.html')?.name,'index.html');
  assert.equal(live2dAssetRequest('yukino-live2d://local/model/Yukino.model3.json')?.type,'application/json');
  assert.equal(live2dAssetRequest('yukino-live2d://local/model/Yukino.4096/texture_00.png')?.type,'image/png');
  assert.equal(live2dAssetRequest('yukino-live2d://local/runtime/Shaders/WebGL/vertshadersrc.vert')?.type,'text/plain; charset=utf-8');
  for(const url of [
    'yukino-live2d://other/index.html',
    'https://local/index.html',
    'yukino-live2d://local/../secret.txt',
    'yukino-live2d://local/model/../../secret.txt',
    'yukino-live2d://local/runtime/other.js',
    'yukino-live2d://user:pass@local/index.html',
  ])assert.equal(live2dAssetRequest(url),null,url);
});

test('bundled Live2D assets contain the model, texture, viewer, shaders, and Cubism Core',async()=>{
  const result=await verifyBundledLive2D(path.join(root,'resources'));
  assert.equal(result.model,'Yukino');
  assert.ok(result.references>=7);
  const required=[
    'index.html','viewer-bridge.js','parameters.json',
    'model/Yukino.model3.json','model/Yukino.moc3','model/Yukino.4096/texture_00.png',
    'runtime/renderer.js','runtime/live2dcubismcore.min.js',
    'runtime/Shaders/WebGL/vertshadersrc.vert',
  ];
  for(const file of required)assert.ok((await fs.stat(path.join(live2dRoot,file))).size>0,file);
  const core=await fs.readFile(path.join(live2dRoot,'runtime/live2dcubismcore.min.js'),'utf8');
  assert.match(core,/Live2D Cubism Core/);
  assert.match(core,/Redistributable Code/);
});

test('packaged app prefers its bundled Live2D copy over a stale per-user copy',async t=>{
  const directory=await fixture(t),userData=path.join(directory,'profile');
  await fs.mkdir(path.join(userData,'live2d'),{recursive:true});
  await fs.writeFile(path.join(userData,'live2d/viewer-bridge.js'),'stale');
  const oldResourcesPath=process.resourcesPath;
  process.resourcesPath=path.join(root,'resources');
  t.after(()=>{process.resourcesPath=oldResourcesPath;});
  const app={isPackaged:true,getPath:()=>userData};
  const harness=protocolHarness();
  const assets=createLive2DAssets({app,session:harness.session,env:{}});
  assets.initialize();
  assert.equal(await assets.viewerUrl(),'yukino-live2d://local/index.html');
  const moc=await harness.request('yukino-live2d://local/model/Yukino.moc3');
  assert.equal(moc.status,200);
  assert.equal(moc.headers.get('content-type'),'application/octet-stream');
  assert.deepEqual(Buffer.from(await moc.arrayBuffer()),await fs.readFile(path.join(live2dRoot,'model/Yukino.moc3')));
});

test('development mode loads the repository copy and explains an unavailable override',async t=>{
  const directory=await fixture(t),userData=path.join(directory,'profile');
  const app={isPackaged:false,getPath:()=>userData};
  const dev=protocolHarness();
  const assets=createLive2DAssets({app,session:dev.session,env:{}});
  assets.initialize();
  assert.equal(await assets.viewerUrl(),'yukino-live2d://local/index.html');

  const missing=protocolHarness();
  const overridden=createLive2DAssets({app,session:missing.session,env:{YUKINO_LIVE2D_DIR:'relative/path'}});
  overridden.initialize();
  assert.equal(await overridden.viewerUrl(),null);
  assert.equal((await missing.request('yukino-live2d://local/index.html')).status,404);
});

test('Live2D protocol serves only GET/HEAD and rejects traversal or missing files',async t=>{
  const directory=await fixture(t),userData=path.join(directory,'profile');
  const app={isPackaged:false,getPath:()=>userData};
  const harness=protocolHarness();
  const assets=createLive2DAssets({app,session:harness.session,env:{YUKINO_LIVE2D_DIR:live2dRoot}});
  assets.initialize();
  assert.equal((await harness.request('yukino-live2d://local/index.html','POST')).status,405);
  assert.equal((await harness.request('yukino-live2d://local/../package.json')).status,404);
  assert.equal((await harness.request('yukino-live2d://local/model/missing.png')).status,404);
  const head=await harness.request('yukino-live2d://local/index.html','HEAD');
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
});

test('both packaging paths copy resources/live2d to the detached live2d resource directory',async()=>{
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const all=JSON.stringify(pkg.build.extraResources);
  assert.match(all,/"from":"resources\/live2d","to":"live2d"/);
  const build=await fs.readFile(path.join(root,'scripts/build-base-app.cjs'),'utf8');
  assert.match(build,/\{from:'resources\/live2d',to:'live2d'/);
});
