// CPU event-flow test harness; not browser or Windows graphical evidence.
const fs=require('node:fs/promises'),path=require('node:path');
const {sanitizePreferences}=require('../../electron/companions.cjs');
async function videoRendererHarness(options={}){
 const vm=require('node:vm');let now=1000,stateListener,actionListener;const calls=[],painted=[],frames=[],timers=[],windowEvents=new Map(),mediaEvents=new Map();
 const classList=()=>{const keys=new Set();return {add:key=>keys.add(key),remove:key=>keys.delete(key),toggle:(key,value)=>value?keys.add(key):keys.delete(key),contains:key=>keys.has(key)}};
 const context2d={clearRect(){},drawImage(...args){painted.push(args);},getImageData(){return {data:new Uint8Array([0,0,0,255])};}};
 function element(id=''){return {id,hidden:['bubble','pet-menu','model','chat-status','menu-error','focus-badge'].includes(id),value:'',textContent:'',style:{setProperty(){}},classList:classList(),dataset:{},events:new Map(),getContext:()=>context2d,setAttribute(){},getBoundingClientRect:()=>({left:70,top:180,x:70,y:180,width:192,height:208}),addEventListener(name,fn){this.events.set(name,fn);},matches:()=>false,closest:()=>null,focus(){},blur(){},append(){},replaceChildren(){},querySelectorAll:()=>[],hasPointerCapture:()=>false};}
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
 const media={matches:false,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:(name,fn)=>{if(mediaEvents.get(name)===fn)mediaEvents.delete(name);}};
 let quoteResult=null,cursorResult={x:170,y:220};
 const bridge={onState:fn=>stateListener=fn,onAction:fn=>actionListener=fn,call:async(action,payload)=>{calls.push({action,payload});if(action==='video-pack')return options.videoPack?options.videoPack():{};if(action==='catalog')return {voices:[]};if(action==='quote')return quoteResult;if(action==='cursor')return cursorResult;return true;}};
 const documentEvents=new Map(),cancelledFrames=[];const sandbox={console,URLSearchParams,AbortController,Date,Math,Uint8Array,Promise,location:{search:''},loadVideoModule:options.loadVideoModule||(()=>Promise.resolve({createVideoCompanion:async()=>{throw Error('test module unavailable')}})),performance:{now:()=>now},innerWidth:330,innerHeight:458,matchMedia:()=>media,Image:class{constructor(){this.complete=true;this.naturalWidth=4096;}},Audio:class{pause(){}},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},requestAnimationFrame:fn=>frames.push(fn),document:{hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn),getElementById:get,querySelector:()=>get('menu-title'),createElement:tag=>element(tag),createTextNode:text=>({textContent:text}),body:element('body'),documentElement:element('html')},window:{companion:bridge,cancelAnimationFrame:id=>cancelledFrames.push(id),addEventListener:(name,fn)=>windowEvents.set(name,fn)}};
 const context=vm.createContext(sandbox);const source=await fs.readFile(path.join(__dirname,'../../electron/companion-view/view.js'),'utf8');
 // Only the ESM loader is injected: all native state/event/IPC wiring is real.
 const code=source.replace("import('./animation/video-companion.mjs')",'loadVideoModule()');if(code===source)throw Error('Video import boundary changed');vm.runInContext(code,context);
 const evaluate=code=>vm.runInContext(code,context);
 const state={kind:'pet',character:{id:'yukino',name:'雪乃'},preferences:{...sanitizePreferences(),soundEnabled:false,randomQuotes:false,nightReminders:false},reply:null,focus:{active:false},voiceRevision:0};
 stateListener(state);await Promise.resolve();await Promise.resolve();
 return {calls,painted,media,cancelledFrames,documentEvents,windowEvents,sandbox,settle:()=>new Promise(setImmediate),setHidden:value=>{sandbox.document.hidden=value;documentEvents.get('visibilitychange')?.();},mediaEvents,nodes,state,evaluate,emit:value=>stateListener(value),act:name=>actionListener({name}),setTime:value=>now=value,setReduced:value=>{media.matches=value;mediaEvents.get('change')?.({matches:value});},setQuote:value=>quoteResult=value,setCursor:value=>cursorResult=value,cursor:()=>timers[0](),frame:time=>{now=time;frames.shift()?.(time);},unload:()=>windowEvents.get('beforeunload')()};
}

module.exports={videoRendererHarness};
