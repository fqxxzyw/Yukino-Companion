'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {CompanionManager}=require('../electron/companions.cjs');
class Window extends EventEmitter {
 constructor(opts={}){super();this.bounds={x:opts.x??0,y:opts.y??0,width:opts.width??330,height:opts.height??410};this.visible=true;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};}
 isDestroyed(){return this.destroyed} isVisible(){return this.visible} isMinimized(){return false}
 show(){this.visible=true;this.emit('show')} showInactive(){this.show()} hide(){this.visible=false;this.emit('hide')}
 restore(){} focus(){} setAlwaysOnTop(){} setIgnoreMouseEvents(){}
 loadFile(){return Promise.resolve()} getBounds(){return {...this.bounds}} setBounds(value){this.bounds={...value}} setPosition(x,y){this.bounds={...this.bounds,x,y}} getPosition(){return [this.bounds.x,this.bounds.y]}
 destroy(){this.destroyed=true;this.emit('closed')}
}
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-close-mode-'));
 const screen=new EventEmitter(),powerMonitor=new EventEmitter(),area={x:0,y:0,width:1920,height:1040};
 screen.getPrimaryDisplay=screen.getDisplayNearestPoint=()=>({workArea:area});screen.getCursorScreenPoint=()=>({x:800,y:800});
 const electron={BrowserWindow:Window,screen,powerMonitor,ipcMain:{handle(){},removeHandler(){}},app:{isPackaged:false,quit(){}}};
 const manager=new CompanionManager({electron,dataDir:dir});await manager.initialize();
 const main=new Window();manager.attachMainWindow(main);manager.preferences.animation=false;
 t.after(async()=>{await manager.dispose();await fs.rm(dir,{recursive:true,force:true})});
 return {manager,main,dir};
}
test('one-time close choice controls retained windows without changing the saved display mode',async t=>{
 const {manager,dir}=await fixture(t);await manager.setMode('model');await manager.closeChoice('pet');
 assert.equal(manager.getState().mode,'model');assert.equal(manager.getState().effectiveMode,'pet');assert.deepEqual(manager.getState().active,['pet']);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'companions.json'),'utf8')).mode,'model');
});
test('remembering the close action does not replace the separately saved display mode',async t=>{
 const {manager,dir}=await fixture(t);await manager.setMode('model');await manager.closeChoice('pet',{remember:true});
 const stored=JSON.parse(await fs.readFile(path.join(dir,'companions.json'),'utf8'));
 assert.equal(stored.mode,'model');assert.equal(stored.closeAction,'pet');assert.deepEqual(manager.getState().active,['pet']);
});
test('the configured automatic close action also preserves the display mode',{timeout:3000},async t=>{
 const {manager,main,dir}=await fixture(t);await manager.setMode('model');await manager.setPreferences({closeAction:'pet'});
 const hidden=new Promise(resolve=>main.once('hide',resolve));main.emit('close',{preventDefault(){}});await hidden;await manager.writeQueue;
 assert.equal(manager.getState().mode,'model');assert.deepEqual(manager.getState().active,['pet']);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'companions.json'),'utf8')).mode,'model');
});
test('tray model choice survives reopening and automatically closing chat',async t=>{
 const {manager,main,dir}=await fixture(t);manager.setCharacter({id:'yukino',modelId:'model-a'});
 await manager.setPreferences({mode:'pet',closeAction:'pet'});await manager.closeChoice('pet');
 await manager.setTrayMode('model');assert.deepEqual(manager.getState().active,['model']);
 const model=manager.windows.get('model');manager.modelFrame={win:model,id:'model-a',ready:true};
 assert.equal(await manager.revealMain(),true);
 const hidden=new Promise(resolve=>main.once('hide',resolve));main.emit('close',{preventDefault(){}});await hidden;await manager.writeQueue;
 assert.equal(manager.getState().effectiveMode,'model');assert.deepEqual(manager.getState().active,['model']);
 const stored=JSON.parse(await fs.readFile(path.join(dir,'companions.json'),'utf8'));assert.equal(stored.mode,'model');assert.equal(stored.closeAction,'model');
});
test('tray choice preserves ask and quit close policies',async t=>{
 const {manager}=await fixture(t);
 for(const closeAction of ['ask','quit']){await manager.setPreferences({closeAction});await manager.setTrayMode('model');assert.equal(manager.preferences.closeAction,closeAction);}
 await manager.setPreferences({closeAction:'pet'});await manager.setTrayMode('none');assert.equal(manager.preferences.closeAction,'ask');
});
test('reopening restores the saved display mode and keeps its model host suppressed',async t=>{
 const {manager,main}=await fixture(t);manager.setCharacter({id:'yukino',modelId:'model-a'});
 await manager.setMode('model');await manager.closeChoice('pet');
 assert.equal(main.isVisible(),false);assert.equal(await manager.revealMain(),true);
 assert.equal(manager.getState().mode,'model');assert.deepEqual(manager.getState().active,['model']);
 assert.equal(manager.windows.get('model').handoffSuppressed,true);
});
test('explicit display mode replaces a temporary close choice',async t=>{
 const {manager}=await fixture(t);await manager.setMode('model');await manager.closeChoice('pet');
 await manager.setMode('both');assert.equal(manager.getState().mode,'both');assert.deepEqual(manager.getState().active.sort(),['model','pet']);
 assert.equal(manager.closeMode,null);
});
test('reopening does not hide a pet when it is also the saved display mode',async t=>{
 const {manager}=await fixture(t);await manager.setMode('pet');await manager.closeChoice('pet');
 const pet=manager.windows.get('pet');assert.equal(await manager.revealMain(),true);
 assert.equal(manager.windows.get('pet'),pet);assert.equal(pet.isVisible(),true);
});
test('explicitly selecting model keeps desktop suppressed while the main window owns the character',async t=>{
 const {manager,main}=await fixture(t);manager.setCharacter({id:'yukino',modelId:'model-a'});
 await manager.setMode('model');await manager.closeChoice('pet');await manager.revealMain();
 const model=manager.windows.get('model');model.hide();assert.equal(model.handoffSuppressed,true);
 await manager.setMode('model');
 assert.equal(main.isVisible(),true);assert.equal(model.handoffSuppressed,true);assert.equal(model.isVisible(),false);
 model.emit('ready-to-show');assert.equal(model.isVisible(),false,'a late ready event cannot create a second visible model');
 assert.equal(manager.getState().effectiveMode,'model');
 main.hide();await manager.setMode('model');assert.equal(model.handoffSuppressed,false);assert.equal(model.isVisible(),true);
});

test('the desktop model only becomes opaque after the main window is hidden',async t=>{
 const {manager,main}=await fixture(t);manager.setCharacter({id:'yukino',modelId:'model-a'});
 await manager.setMode('model');const model=manager.windows.get('model');
 let mainOpacity=1,modelOpacity=1;const overlaps=[];
 const sample=()=>{if(main.isVisible()&&mainOpacity>0&&model.isVisible()&&modelOpacity>0)overlaps.push(true)};
 main.setOpacity=value=>{mainOpacity=value;sample()};main.getOpacity=()=>mainOpacity;
 model.setOpacity=value=>{modelOpacity=value;sample()};model.getOpacity=()=>modelOpacity;
 const show=model.showInactive.bind(model);model.showInactive=()=>{show();sample()};
 manager.modelFrame={win:model,id:'model-a',ready:true};await manager.closeChoice('model');
 assert.deepEqual(overlaps,[]);assert.equal(main.isVisible(),false);assert.equal(model.isVisible(),true);assert.equal(modelOpacity,1);
});

test('a new display choice cancels a close while its preference write is pending',async t=>{
 const {manager,main}=await fixture(t);manager.setCharacter({id:'yukino',modelId:'model-a'});await manager.setMode('model');
 const persist=manager.persist.bind(manager);let release,first=true;
 manager.persist=()=>{if(first){first=false;return new Promise(resolve=>{release=resolve})}return persist()};
 const closing=manager.closeChoice('model');assert.ok(release);await manager.setMode('none');release();await closing;
 assert.equal(main.isVisible(),true);assert.equal(manager.windows.has('model'),false);assert.equal(manager.getState().effectiveMode,'none');
});
