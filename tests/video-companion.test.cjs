const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../electron/companion-view/animation/video-companion.mjs');
function snapshot(mediaTimeMs,extra={}){return {mode:'video',clipId:'walk_left',mediaTimeMs,paused:false,fading:false,...extra};}
function dom(){const flags=new Set(),paints=[];const context={clearRect(){},drawImage(...args){paints.push(args)},getImageData(){return {data:[0,0,0,255]}}};return {flags,paints,canvas:{classList:{toggle:(key,value)=>value?flags.add(key):flags.delete(key),remove:key=>flags.delete(key)},getContext:()=>context},container:{hidden:true},document:{createElement:()=>({getContext:()=>context})}};}
class Player{
 constructor(options){this.options=options;this.calls=[];this.hidden=false;this.active=null;this.state={mode:'sprite'};options.onState({mode:'sprite',reason:'initial'});}
 setPlacement(value){this.placement=value;}
 setHidden(value){this.hidden=value;this.calls.push(['hidden',value]);if(value){this.active=null;this.state={mode:'hidden'};this.options.onState(this.state)}else if(this.requested)this.switchTo(this.requested);}
 switchTo(id){this.requested=id;this.calls.push(['switch',id]);if(!this.hidden){this.active={video:{videoWidth:640,videoHeight:640,getBoundingClientRect:()=>({left:0,top:0,width:640,height:640})}};this.state=snapshot(0,{clipId:id});this.options.onState(this.state)}return Promise.resolve({status:'playing'});}
 getPlaybackSnapshot(){return this.state;}
 dispose(){this.disposed=true;this.active=null;this.options.onState({mode:'sprite',reason:'disposed'});}
}
async function setup(){const {VideoCompanion}=await load(),d=dom(),modes=[],errors=[];const pack={manifest:{clips:[{id:'idle',width:640,height:640,anchor:{x:320,y:600},subjectHeight:543}]},gait:{durationMs:35000/24},allowedAssetURLs:[]};const adapter=new VideoCompanion({...d,pack,poster:{},onPresentation:mode=>modes.push(mode),onError:message=>errors.push(message),Player});return {...d,adapter,modes,errors};}
test('video preview maps all unrendered body actions to its own idle without changing art',async()=>{const {previewClip,UNSUPPORTED_PREVIEW_ACTIONS}=await load();for(const name of ['wave','lifted','landing','waiting','annoyed','sitting','head-tilt','jump'])assert.equal(previewClip(name),'idle');assert.equal(previewClip('walk-left'),'walk_left');assert.equal(previewClip('walk-right'),'walk_right');assert.deepEqual(UNSUPPORTED_PREVIEW_ACTIONS,['greet','head-tilt','jump','sit']);});
test('video preview keeps preparation layer in layout while poster is visible, then shows exactly one representation',async()=>{const d=await setup();assert.equal(d.container.hidden,false);assert.equal(d.flags.has('video-active'),false);assert.equal(d.modes.at(-1),'poster');assert.equal(d.adapter.player.options.fadeMs,0,'unverified direction transitions must not overlay two people');d.adapter.update({name:'idle'});assert.equal(d.flags.has('video-active'),true);assert.equal(d.modes.at(-1),'video');d.adapter.update({name:'lifted',staticPose:true});assert.equal(d.flags.has('video-active'),false);assert.equal(d.modes.at(-1),'poster');assert.equal(d.adapter.player.hidden,true);d.adapter.dispose();assert.equal(d.container.hidden,true);});
test('video preview static paths unload video and restore only idle, not stale walking',async()=>{const d=await setup();d.adapter.update({name:'walk-right'});d.adapter.update({name:'lifted',staticPose:true});assert.equal(d.adapter.player.requested,'idle');d.adapter.update({name:'landing'});assert.equal(d.adapter.player.state.clipId,'idle');const count=d.adapter.player.calls.length;for(let n=0;n<100;n++)d.adapter.update({name:'landing'});assert.equal(d.adapter.player.calls.length,count);d.adapter.dispose();});
test('video preview uses matching foot anchor and actual viewport scale without changing canvas pixel coordinates',async()=>{const d=await setup();d.adapter.update({name:'idle',scale:.5});assert.deepEqual(d.adapter.player.placement,{subjectHeight:99,footX:47.75,footY:101.5});const rectangle=d.paints[0];assert.ok(Math.abs(rectangle[2]+600*rectangle[4]/640-203)<1e-9);d.adapter.dispose();});
test('video preview active decode failure atomically restores sprite and cleans resources',async()=>{const d=await setup();d.adapter.update({name:'idle'});d.adapter.player.options.onState({mode:'sprite',reason:'decode-error'});assert.equal(d.adapter.failed,true);assert.equal(d.adapter.player.disposed,true);assert.equal(d.container.hidden,true);assert.equal(d.flags.has('video-active'),false);assert.equal(d.modes.at(-1),'sprite');assert.equal(d.errors.length,1);d.adapter.update({name:'walk-left'});assert.equal(d.adapter.movementElapsed(1000),0);});
test('video preview decoded pixel hit-test does not use old sprite silhouette',async()=>{const d=await setup();assert.equal(d.adapter.hitTest(50,50),null);d.adapter.update({name:'idle'});assert.equal(d.adapter.hitTest(50,50),true);assert.equal(d.adapter.hitTest(800,50),false);d.adapter.dispose();});
test('video gait clock follows media progress at varied polling rates including loop wrap',async()=>{const {MediaGaitClock}=await load(),duration=35000/24;for(const fps of[24,60]){const c=new MediaGaitClock();let total=0;c.step(snapshot(0),0,duration);for(let n=1;n<=fps*4;n++){const t=n*1000/fps;total+=c.step(snapshot(t%duration),t,duration)}assert.ok(Math.abs(total-4000)<1e-6);} });
test('a brief delayed walk update catches up over bounded steps without inventing media time',async()=>{
 const {MediaGaitClock}=await load(),c=new MediaGaitClock(),duration=35000/24;let total=0;
 c.step(snapshot(0),0,duration);const delayed=c.step(snapshot(180),180,duration);assert.equal(delayed,100);total+=delayed;
 assert.equal(c.step(snapshot(180),196,duration),0,'a frozen video must not move');
 for(let t=212;t<=292;t+=16){const step=c.step(snapshot(t-16),t,duration);assert.ok(step<=100);total+=step;}
 assert.equal(total,276,'the final distance is based only on the playback timeline');
});
test('suspension, seeking, pause and direction changes clear any pending catch-up',async()=>{
 const {MediaGaitClock}=await load(),duration=35000/24;
 for(const disruption of [
  c=>c.step(snapshot(180,{paused:true}),196,duration),
  c=>c.step(snapshot(180,{fading:true}),196,duration),
  c=>c.step(snapshot(180,{clipId:'walk_right'}),196,duration),
  c=>c.step(snapshot(180),1000,duration),
  c=>c.step(snapshot(450),196,duration)
 ]){const c=new MediaGaitClock();c.step(snapshot(0),0,duration);assert.equal(c.step(snapshot(180),180,duration),100);assert.equal(disruption(c),0);assert.equal(c.pendingMs,0);}
});
test('sustained slow polling cannot accumulate an unbounded movement burst',async()=>{
 const {MediaGaitClock}=await load(),c=new MediaGaitClock(),duration=35000/24;c.step(snapshot(0),0,duration);
 for(let t=180;t<=3600;t+=180){assert.ok(c.step(snapshot(t%duration),t,duration)<=100);assert.ok(c.pendingMs<=100);}
 assert.equal(c.step(snapshot(3600%duration,{paused:true}),3616,duration),0);assert.equal(c.pendingMs,0);
});
test('video gait clock never substitutes wall time, catches up after suspension or moves on idle/pause/fade',async()=>{const {MediaGaitClock}=await load(),c=new MediaGaitClock(),duration=35000/24;c.step(snapshot(0),0,duration);assert.equal(c.step(snapshot(0),100,duration),0);assert.equal(c.step(snapshot(100),5000,duration),0);assert.equal(c.step(snapshot(900),5016,duration),0);assert.equal(c.step(snapshot(200),5032,duration),0);assert.equal(c.step(snapshot(210,{paused:true}),5048,duration),0);assert.equal(c.step(snapshot(220,{fading:true}),5064,duration),0);assert.equal(c.step(snapshot(230,{clipId:'idle'}),5080,duration),0);c.reset();assert.equal(c.step(snapshot(240),5096,duration),0);});
test('video preview failed idle transition cannot leave a walking loop running without world movement',async()=>{const d=await setup();d.adapter.update({name:'walk-left'});d.adapter.player.options.onError({code:'decode-timeout'});assert.equal(d.adapter.failed,true);assert.equal(d.adapter.player.disposed,true);assert.equal(d.modes.at(-1),'sprite');assert.equal(d.adapter.movementElapsed(1000),0);});
test('video preview direction reversal waits for requested gait first frame before any new-direction travel',async()=>{const d=await setup();d.adapter.update({name:'walk-left'});d.adapter.movementElapsed(100);d.adapter.player.state.mediaTimeMs=40;assert.equal(d.adapter.movementElapsed(140),40);d.adapter.player.switchTo=id=>{d.adapter.player.requested=id;return Promise.resolve({status:'loading'})};d.adapter.update({name:'walk-right'});d.adapter.player.state.mediaTimeMs=80;assert.equal(d.adapter.movementElapsed(180),0);d.adapter.player.state.mediaTimeMs=120;assert.equal(d.adapter.movementElapsed(220),0);d.adapter.player.state=snapshot(0,{clipId:'walk_right'});assert.equal(d.adapter.movementElapsed(260),0);d.adapter.player.state.mediaTimeMs=40;assert.equal(d.adapter.movementElapsed(300),40);d.adapter.dispose();});
