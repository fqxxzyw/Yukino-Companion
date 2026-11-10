'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {CompanionManager}=require('../electron/companions.cjs');

test('reopening after moving and resizing the desktop model transfers its actual canvas and view',async()=>{
 const screen={getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}})};
 const manager=new CompanionManager({electron:{screen,app:{quit(){}}},dataDir:'.'});manager.preferences.animation=false;manager.preferences.mode='model';manager.character.modelId='fixture';
 const received=[];let acknowledge=true;
 const main={bounds:{x:100,y:100,width:900,height:700},visible:false,opacity:1,isDestroyed:()=>false,isVisible(){return this.visible},isMinimized:()=>false,isMaximized:()=>false,getBounds(){return {...this.bounds}},getContentBounds(){return {...this.bounds}},setPosition(x,y){this.bounds.x=x;this.bounds.y=y},setOpacity(v){this.opacity=v},getOpacity(){return this.opacity},show(){this.visible=true},restore(){},focus(){},webContents:{send(channel,data){if(channel==='avatar-handoff'){received.push(data);if(acknowledge&&data.phase==='prepare')manager.avatarHandoffReady(data.sequence);}}}};
 const web=new EventEmitter();web.mainFrame={};const model={bounds:{x:1230,y:330,width:420,height:650},visible:true,isDestroyed:()=>false,isVisible(){return this.visible},isMinimized:()=>false,getBounds(){return {...this.bounds}},getContentBounds(){return {...this.bounds}},getOpacity:()=>1,setOpacity(){},hide(){this.visible=false},webContents:web};
 manager.mainWindow=main;manager.windows.set('model',model);manager.appAvatarRect={x:550,y:90,width:300,height:500,relative:true};
 const event={sender:web,senderFrame:web.mainFrame};
 for(const [bounds,rect,view] of [
  [{x:1230,y:330,width:420,height:650},{x:0,y:56,width:420,height:534},{zoom:1.7,yaw:45}],
  [{x:600,y:240,width:300,height:560},{x:0,y:130,width:300,height:370},{zoom:1.1,yaw:-30}],
 ]){
  model.bounds=bounds;model.visible=true;main.visible=false;
  await manager.viewCall(event,'model-view',{rect,view});await manager.revealMain();
  const sent=received.filter(x=>x.phase==='prepare').at(-1);
  assert.deepEqual(sent.view,view);assert.deepEqual({x:sent.rect.x+main.bounds.x,y:sent.rect.y+main.bounds.y,width:sent.rect.width,height:sent.rect.height},{x:bounds.x+rect.x,y:bounds.y+rect.y,width:rect.width,height:rect.height});
  assert.equal(model.visible,false);assert.equal(received.at(-1).phase,'finish');
 }
 await assert.rejects(manager.viewCall(event,'model-view',{rect:{x:0,y:0,width:-1,height:10},view:{zoom:1,yaw:0}}),/无效/);
 acknowledge=false;model.visible=true;main.visible=false;assert.equal(await manager.revealMain(),false);assert.equal(received.at(-1).phase,'cancel');assert.equal(model.visible,false);assert.equal(main.visible,true);
});

test('temporary in-app canvas geometry restores its original inline styles',async()=>{
 const {prepareAvatarReturn}=await import('../src/ui/avatar-return.mjs');
 const values=new Map([['left','4px']]),style={getPropertyValue:name=>values.get(name)||'',getPropertyPriority:()=>'',setProperty:(name,value)=>values.set(name,value),removeProperty:name=>values.delete(name)};
 const host={style,dataset:{},offsetParent:{clientLeft:1,clientTop:2,getBoundingClientRect:()=>({left:100,top:80})}};
 const restore=prepareAvatarReturn(host,{x:180,y:200,width:320,height:470});
 assert.equal(values.get('left'),'79px');assert.equal(values.get('top'),'118px');assert.equal(values.get('width'),'320px');assert.equal(host.dataset.avatarHandoff,'true');
 restore();assert.equal(values.get('left'),'4px');assert.equal(values.has('width'),false);assert.equal(host.dataset.avatarHandoff,undefined);
});
