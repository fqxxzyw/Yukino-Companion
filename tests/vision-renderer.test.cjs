const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const image='data:image/png;base64,U1lOVEhFVElDX09OTFk=';
const preview=()=>({sources:[{token:'synthetic-one',preview:image,name:'Synthetic one'},{token:'synthetic-two',preview:image,name:'Synthetic two'}],expires:Date.now()+120000,destination:'https://example.test',model:'test'});

// Execute the actual component hooks and handlers. Only JSX rendering is replaced
// with an inspection surface; this is lifecycle coverage, not pixel/layout QA.
function visionHooks(){
 const filename=path.resolve(__dirname,'../src/ui/VisionDialog.jsx');
 const original=fs.readFileSync(filename,'utf8'),selection=original.match(/onClick=\{\(\)=>\{(setSelected\(source\.token\);[^}]+)\}\}/);
 assert.ok(selection,'The source-selection event handler must remain covered');
 let source=original.replace(/^import .*$/gm,'').replace('export default function','function');
 assert.match(source,/\n return <div/);
 source=source.replace(/\n return <div[\s\S]*/,`\n return {capture,analyze,watch,stop,chooseSource:source=>{${selection[1]}},controls:{setCaptureConsent,setSendConsent,setWatchConsent},snapshot:{captureConsent,sendConsent,sources,selected,details,phase,error,result,watchConsent,watching}};\n}\nthis.Component=VisionDialog;`);
 let index=0,dirty=false,now=Date.now(),timerId=0,status=()=>{};
 const slots=[],effects=[],timers=new Map(),calls={cancel:0,sources:[],analyze:[],watch:[]};
 const api={onVisionStatus:callback=>{status=callback;return()=>{status=()=>{}};},visionCancel:async()=>{calls.cancel++;},visionSources:async options=>{calls.sources.push(options);return {...preview(),expires:now+120000};},visionAnalyze:async options=>{calls.analyze.push(options);throw Error('synthetic analyze rejected');},visionWatch:async options=>{calls.watch.push(options);throw Error('synthetic watch rejected');}};
 const props={api,profile:{id:'test',base:'https://example.test/v1',model:'test',visionEnabled:true},onClose(){}};
 const context={URL,Promise,Date:class extends Date{static now(){return now;}},friendlyError:error=>error?.message||String(error),setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
  useState:initial=>{const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return [slots[slot],value=>{const next=typeof value==='function'?value(slots[slot]):value;if(!Object.is(next,slots[slot])){slots[slot]=next;dirty=true;}}];},
  useRef:value=>{const slot=index++;if(!(slot in slots))slots[slot]={current:value};return slots[slot];},
  useEffect:(callback,deps)=>{const slot=index++,prior=slots[slot];if(!prior||!deps||deps.some((value,i)=>!Object.is(value,prior.deps?.[i]))){slots[slot]={deps,cleanup:prior?.cleanup};effects.push(()=>{slots[slot].cleanup?.();slots[slot].cleanup=callback();});}},
 };
 vm.runInNewContext(source,context,{filename});
 function render(){let rendered;for(let pass=0;pass<10;pass++){index=0;dirty=false;rendered=context.Component(props);while(effects.length)effects.shift()();if(!dirty)return rendered;}throw Error('Hook fixture did not settle');}
 function advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}return render();}
 function unmount(){for(const value of slots)value?.cleanup?.();}
 render();
 return {api,calls,timers,render,advance,unmount,status:value=>{status(value);return render();},setProfile:patch=>{props.profile={...props.profile,...patch};return render();}};
}
async function captureAndSelect(f){f.render().controls.setCaptureConsent(true);await f.render().capture();f.render().chooseSource({token:'synthetic-one'});f.render().controls.setSendConsent(true);return f.render();}
function assertCleared(f){const state=f.render().snapshot;assert.equal(state.sources.length,0);assert.equal(state.selected,'');assert.equal(state.details,null);assert.equal(state.sendConsent,false);assert.equal(state.watchConsent,false);assert.equal(f.timers.size,0);}

test('failed Analyze consumes renderer screenshot bytes immediately and they stay cleared past TTL',async()=>{
 const f=visionHooks(),gate=deferred();f.api.visionAnalyze=options=>{f.calls.analyze.push(options);return gate.promise;};await captureAndSelect(f);
 const pending=f.render().analyze();assertCleared(f);assert.equal(f.calls.analyze[0].token,'synthetic-one');assert.equal(f.calls.analyze[0].consent,true);
 gate.reject(Error('synthetic provider rejection'));await pending;assertCleared(f);assert.match(f.render().snapshot.error,/synthetic provider/);f.advance(120001);assertCleared(f);f.unmount();
});
test('failed continuous-start consumes renderer screenshot bytes and both send consents',async()=>{
 const f=visionHooks(),gate=deferred();f.api.visionWatch=options=>{f.calls.watch.push(options);return gate.promise;};await captureAndSelect(f);f.render().controls.setWatchConsent(true);
 const pending=f.render().watch();assertCleared(f);assert.equal(f.calls.watch[0].token,'synthetic-one');assert.equal(f.calls.watch[0].consent,true);assert.equal(f.calls.watch[0].watchConsent,true);
 gate.reject(Error('synthetic watch rejection'));await pending;assertCleared(f);assert.equal(f.render().snapshot.watching,false);f.advance(120001);assertCleared(f);f.unmount();
});
test('backend idle from external minimize, lock or Stop clears renderer previews',async()=>{
 const f=visionHooks();await captureAndSelect(f);f.render().controls.setWatchConsent(true);f.status({phase:'idle',active:false});assertCleared(f);assert.equal(f.render().snapshot.phase,'idle');f.unmount();
});
test('normal backend idle during capture preflight does not discard the successful preview',async()=>{
 const f=visionHooks();f.api.visionSources=async options=>{f.calls.sources.push(options);f.status({phase:'idle',active:false});f.status({phase:'capturing',active:true});return preview();};
 f.render().controls.setCaptureConsent(true);await f.render().capture();const state=f.render().snapshot;assert.equal(state.sources.length,2);assert.equal(state.phase,'preview');assert.equal(f.timers.size,1);f.unmount();
});
test('normal backend idle from a successful Analyze does not discard the returned result',async()=>{
 const f=visionHooks();await captureAndSelect(f);f.api.visionAnalyze=async()=>{f.status({phase:'idle',active:false});return {text:'SYNTHETIC_ANALYSIS_RESULT'};};await f.render().analyze();assert.equal(f.render().snapshot.result,'SYNTHETIC_ANALYSIS_RESULT');assertCleared(f);f.unmount();
});
test('late preview after local Stop cannot resurrect screenshot bytes',async()=>{
 const f=visionHooks(),gate=deferred();f.api.visionSources=()=>gate.promise;f.render().controls.setCaptureConsent(true);const pending=f.render().capture();f.render().stop();gate.resolve(preview());await pending;assertCleared(f);assert.equal(f.render().snapshot.phase,'idle');f.unmount();
});
test('late preview after a profile change cannot resurrect previous-provider screenshot bytes',async()=>{
 const f=visionHooks(),gate=deferred();f.api.visionSources=()=>gate.promise;f.render().controls.setCaptureConsent(true);const pending=f.render().capture();f.setProfile({id:'other',base:'https://other.example.test/v1',model:'other'});gate.resolve(preview());await pending;assertCleared(f);assert.equal(f.render().snapshot.captureConsent,false);f.unmount();
});
test('new source selection and a new capture each reset continuous-send consent',async()=>{
 const f=visionHooks();await captureAndSelect(f);f.render().controls.setWatchConsent(true);f.render().chooseSource({token:'synthetic-two'});let state=f.render().snapshot;assert.equal(state.selected,'synthetic-two');assert.equal(state.watchConsent,false);assert.equal(state.sendConsent,false);
 f.render().controls.setWatchConsent(true);await f.render().capture();state=f.render().snapshot;assert.equal(state.watchConsent,false);assert.equal(state.sendConsent,false);assert.equal(state.sources.length,2);f.unmount();
});
test('unused previews expire locally without dispatching images or retaining source metadata',async()=>{
 const f=visionHooks();await captureAndSelect(f);f.advance(120001);assertCleared(f);assert.match(f.render().snapshot.error,/过期/);assert.equal(f.calls.analyze.length,0);assert.equal(f.calls.watch.length,0);f.unmount();
});
