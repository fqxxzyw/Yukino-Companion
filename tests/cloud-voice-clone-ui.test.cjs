'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),jsx=require('react/jsx-runtime');
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),resolve:value=>resolve(value)};};
async function harness(t,options={}){
 const {transformWithOxc}=await import('vite'),source=await fs.readFile(path.join(__dirname,'../src/speech/CloudVoiceClone.jsx'),'utf8');
 let {code}=await transformWithOxc(source,'CloudVoiceClone.jsx');code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],cleanups=new Map();let cursor=0,effects=[],dirty=false,tree;
 const hooks={useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true}}];},useRef(value){const n=cursor++;return values[n]||(values[n]={current:value})},useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((value,i)=>!Object.is(value,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn())})}}};
 const Select=()=>null,document={hidden:false,addEventListener(){},removeEventListener(){}},deps={React:{},...hooks,Select,document,MicrophoneCapture:function(){},encodeCloneWav(){},CheckCircle2(){},LoaderCircle(){},Mic(){},_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment};
 const Component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps),calls=[],api={voiceClonePick:async()=>({name:'voice.wav',bytes:1000}),voiceCloneCancel:async()=>{},microphoneRelease:async()=>{},voiceCloneCreate:async value=>{calls.push(value);return {configId:'created',voiceId:'sound',model:'qwen-audio-3.1-tts-flash'}},...options.api},created=[];
 const props={api,configs:[{id:'source',name:'百炼'}],onPrepare:options.onPrepare,onCreated:value=>created.push(value)};
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const text=node=>!node?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
 function render(){let n=0;do{cursor=0;dirty=false;tree=Component(props);effects.splice(0).forEach(fn=>fn());assert.ok(++n<12)}while(dirty)}
 const nodes=()=>walk(tree),button=label=>nodes().find(node=>node.type==='button'&&text(node)===label),checkbox=()=>nodes().find(node=>node.type==='input'&&node.props.type==='checkbox');
 render();t.after(()=>{for(const fn of cleanups.values())fn?.()});return {render,nodes,button,checkbox,calls,created,props};
}
test('clone UI requires explicit authorization and coalesces duplicate create clicks',async t=>{
 const gate=deferred(),h=await harness(t,{api:{voiceCloneCreate:async value=>{h.calls.push(value);return gate.promise}}});
 await h.button('选择录音').props.onClick();h.render();assert.equal(h.button('上传并创建音色').props.disabled,true);h.checkbox().props.onChange({target:{checked:true}});h.render();
 const create=h.button('上传并创建音色').props.onClick,first=create(),second=create();await Promise.resolve();assert.equal(h.calls.length,1);assert.equal(h.calls[0].authorized,true);assert.equal(h.calls[0].configId,'source');
 gate.resolve({configId:'created',voiceId:'sound',model:'qwen-audio-3.1-tts-flash'});await Promise.all([first,second]);h.render();assert.equal(h.created.length,1);
});
test('cancellation while saving settings prevents a later upload',async t=>{
 const prep=deferred(),h=await harness(t,{onPrepare:()=>prep.promise});await h.button('选择录音').props.onClick();h.render();h.checkbox().props.onChange({target:{checked:true}});h.render();const running=h.button('上传并创建音色').props.onClick();h.render();h.button('取消').props.onClick();h.render();prep.resolve();await running;assert.deepEqual(h.calls,[]);assert.deepEqual(h.created,[]);
});
test('server-created voice is shown for manual recovery if local binding fails',async t=>{
 const h=await harness(t,{api:{voiceCloneCreate:async()=>({configId:'',voiceId:'voice-123',model:'qwen-audio-3.1-tts-flash',message:'保存失败'})}});await h.button('选择录音').props.onClick();h.render();h.checkbox().props.onChange({target:{checked:true}});h.render();await h.button('上传并创建音色').props.onClick();h.render();
 const alert=h.nodes().find(node=>node.props?.role==='alert');assert.ok(alert);assert.match(JSON.stringify(alert.props.children),/voice-123/);assert.deepEqual(h.created,[]);
});
