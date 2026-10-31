const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const jsx=require('react/jsx-runtime');
// Exercise actual component event handlers, substituting only hooks and the
// recording boundary. No microphone, ASR request, browser or GUI is started.
async function harness(initial={}){
 const {transformWithOxc}=await import('vite'),{VOICE_INPUT_DEFAULTS}=await import('../src/speech/voice-input-session.mjs');
 const source=await fs.readFile(path.join(__dirname,'../src/speech/VoiceInputControl.jsx'),'utf8');
 let {code}=await transformWithOxc(source,'VoiceInputControl.jsx');
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],cleanups=new Map(),instances=[],listeners=new Map();let cursor=0,effects=[],dirty=false,props=initial,tree;
 const hooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true;}}];},
  useRef(value){const n=cursor++;return values[n]||(values[n]={current:value});},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((value,i)=>!Object.is(value,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn());});}},
 };
 class Session{
  constructor(callbacks){this.callbacks=callbacks;this.state={phase:'idle'};this.calls={start:0,finish:0,cancel:0};instances.push(this);}
  emit(value){this.state={...this.state,...value};this.callbacks.onStatus(this.state);}
  async start(value){this.calls.start++;this.settings=value;this.emit({phase:'connecting'});this.emit({phase:'listening'});}
  async finish(){this.calls.finish++;this.emit({phase:'finishing'});}
  async cancel(){this.calls.cancel++;this.emit({phase:'idle'});}
  async dispose(){await this.cancel();}
  setMuted(value){this.emit({muted:value});}
 }
 const eventTarget={hidden:false,addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
 const icon=()=>null,deps={React:{},...hooks,Mic:icon,MicOff:icon,Square:icon,LoaderCircle:icon,VoiceInputSession:Session,VOICE_INPUT_DEFAULTS,_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment,document:eventTarget,window:{addEventListener(){},removeEventListener(){}}};
 const component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 function render(next=props){props=next;let limit=0;do{cursor=0;dirty=false;tree=component(props);effects.splice(0).forEach(fn=>fn());assert.ok(++limit<12,'effects must settle');}while(dirty);return tree;}
 function walk(node){return !node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];}
 render();
 return {render,get tree(){return tree;},get session(){return instances[0];},button(label){return walk(tree).find(node=>node.type==='button'&&node.props['aria-label']===label);},mic(){return walk(tree).find(node=>node.type==='button'&&node.props.className?.includes('voice-mic'));},hide(){eventTarget.hidden=true;listeners.get('visibilitychange')?.();},dispose(){for(const cleanup of cleanups.values())cleanup?.();}};
}
const pointer=(extra={})=>({button:0,isPrimary:true,pointerId:1,preventDefault(){},currentTarget:{setPointerCapture(){}},...extra});

test('composer has a genuine disabled microphone reason without desktop IPC',async t=>{
 const h=await harness({variant:'composer'});t.after(()=>h.dispose());
 assert.equal(h.mic().props.disabled,true);assert.match(h.mic().props.title,/Electron 桌面版/);h.mic().props.onClick();assert.equal(h.session.calls.start,0);
});
test('click mode starts once, finishes once, and remains cancellable while awaiting final text',async t=>{
 const h=await harness({api:{asrStart(){}}});t.after(()=>h.dispose());
 h.mic().props.onClick();h.mic().props.onClick();assert.equal(h.session.calls.start,1);h.render();
 assert.equal(h.mic().props['aria-label'],'结束本次语音输入');h.mic().props.onClick();h.render();
 assert.equal(h.session.calls.finish,1);assert.equal(h.mic().props.disabled,true);
 h.button('停止监听并取消本次识别').props.onClick();h.render();assert.equal(h.session.state.phase,'idle');
});
test('hold mode ignores secondary pointers and coalesces pointer release with lost capture',async t=>{
 const h=await harness({api:{asrStart(){}},settings:{mode:'hold'}});t.after(()=>h.dispose());
 h.mic().props.onPointerDown(pointer({button:2}));h.mic().props.onPointerDown(pointer({isPrimary:false}));assert.equal(h.session.calls.start,0);
 h.mic().props.onPointerDown(pointer());h.render();assert.equal(h.session.calls.start,1);
 const cancelled=h.session.calls.cancel;
 h.mic().props.onPointerUp(pointer({isPrimary:false,pointerId:2}));
 h.mic().props.onPointerCancel(pointer({isPrimary:false,pointerId:2}));
 assert.equal(h.session.calls.finish,0,'a secondary touch cannot end the primary recording');
 assert.equal(h.session.calls.cancel,cancelled);
 h.mic().props.onPointerUp(pointer());h.mic().props.onLostPointerCapture();assert.equal(h.session.calls.finish,1);
});
test('hold mode supports keyboard release and focus-loss cleanup',async t=>{
 const h=await harness({api:{asrStart(){}},settings:{mode:'hold'}});t.after(()=>h.dispose());
 const key={key:' ',repeat:false,preventDefault(){}};
 h.mic().props.onKeyDown({...key,repeat:true});assert.equal(h.session.calls.start,0);
 h.mic().props.onKeyDown(key);h.render();h.mic().props.onKeyUp(key);assert.equal(h.session.calls.finish,1);
 await h.session.cancel();h.render();h.mic().props.onKeyDown(key);h.render();h.mic().props.onBlur();assert.equal(h.session.calls.finish,2);
});
test('leaving the composer or hiding the window cancels rather than leaves a live microphone',async t=>{
 const props={api:{asrStart(){}},settings:{mode:'continuous'}};
 const h=await harness(props);t.after(()=>h.dispose());
 h.mic().props.onClick();h.render();const before=h.session.calls.cancel;
 h.render({...props,disabled:true});assert.equal(h.session.state.phase,'idle');assert.equal(h.session.calls.cancel,before+1);
 h.render(props);h.mic().props.onClick();h.render();h.hide();h.render();assert.equal(h.session.state.phase,'idle');
});
