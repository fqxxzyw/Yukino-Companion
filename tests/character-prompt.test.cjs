const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const jsx=require('react/jsx-runtime');

// Run the real compiled component handlers with local hooks and a fake clipboard.
// No browser, desktop IPC, AI request, model renderer or GUI is started.
async function harness(t,{clipboard,props={}}={}){
 const {transformWithOxc}=await import('vite');
 const {getSkinStatus}=await import('../src/companion/skin-unlocks.mjs');
 const {buildCharacterPrompt}=await import('../src/ui/character-prompt.mjs');
 const source=await fs.readFile(path.join(__dirname,'../src/ui/CharacterSettings.jsx'),'utf8');
 let {code}=await transformWithOxc(source,'CharacterSettings.jsx');
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],cleanups=new Map();let cursor=0,effects=[],dirty=false,tree,stateWrites=0;
 const hooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true;stateWrites++;}}];},
  useRef(value){const n=cursor++;return values[n]||(values[n]={current:value});},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((value,i)=>!Object.is(value,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn());});}},
 };
 const Select=()=>null,SkinPicker=()=>null;
 const deps={React:{},...hooks,Select,SkinPicker,getSkinStatus,buildCharacterPrompt,modelCardPreviews:{get(){throw Error('No preview rendering in handler tests');}},globalThis:{navigator:clipboard===undefined?undefined:{clipboard}},_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment};
 const component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 let currentProps={characters:[{id:'yukino',name:'雪之下雪乃',builtin:true}],current:{id:'yukino',name:'雪之下雪乃',builtin:true},models:[],onCreate:async()=>{},onSelect(){},onModelChange(){},...props};
 function render(next=currentProps){currentProps=next;let limit=0;do{cursor=0;dirty=false;tree=component(currentProps);effects.splice(0).forEach(fn=>fn());assert.ok(++limit<12,'effects must settle');}while(dirty);return tree;}
 function walk(node){return !node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];}
 const nodes=()=>walk(tree),byType=type=>nodes().filter(node=>node.type===type);
 const h={render,nodes,byType,get props(){return currentProps;},get stateWrites(){return stateWrites;},input:()=>byType('input')[0],persona:()=>byType('textarea').find(node=>node.props.placeholder==='身份、性格与交流风格'),preview:()=>byType('textarea').find(node=>node.props['aria-label']==='角色设定提示词'),copy:()=>byType('button').find(node=>node.props.className==='secondary'),create:()=>byType('button').find(node=>node.props.type==='submit'),submit:()=>byType('form')[0].props.onSubmit({preventDefault(){}}),selects:()=>byType(Select),picker:()=>byType(SkinPicker)[0],dispose(){for(const cleanup of cleanups.values())cleanup?.();}};
 h.name=value=>{h.input().props.onChange({target:{value}});render();};
 h.setPersona=value=>{h.persona().props.onChange({target:{value}});render();};
 render();t.after(()=>h.dispose());return h;
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const messages=(h,role)=>h.nodes().filter(node=>node.props?.role===role).map(node=>node.props.children).join(' ');

test('prompt names follow actual creation trim and UTF-16 length rules, including duplicate names',async()=>{
 const {buildCharacterPrompt}=await import('../src/ui/character-prompt.mjs');
 const {createCharacter,normalizeCharacters}=await import('../src/companion/characters.mjs');
 const state=normalizeCharacters({});
 for(const name of ['  三笠  ','雪之下雪乃','x'.repeat(60),' '.repeat(20)+'x'.repeat(60)+'  ','😀'.repeat(30),'原创「A」\n同名','<img src=x onerror=alert(1)>']){
  const next=createCharacter(state,{name}),created=next.characters.at(-1),prompt=buildCharacterPrompt(name);
  assert.equal(created.name,name.trim());assert.ok(prompt.includes(JSON.stringify(created.name)));
 }
 for(const name of ['', ' \n\t ', 'x'.repeat(61), '😀'.repeat(31),null,undefined]){
  assert.throws(()=>buildCharacterPrompt(name),/请填写 1–60 字符的角色姓名/);
  assert.throws(()=>createCharacter(state,{name}),/请填写 1–60 字符的角色姓名/);
 }
});

test('Chinese prompt requests editable persona text, not a generated import or model resource',async()=>{
 const {buildCharacterPrompt}=await import('../src/ui/character-prompt.mjs');
 const prompt=buildCharacterPrompt('绫波丽');
 for(const expected of ['身份','背景','核心价值观','性格','说话方式','相处边界','原作','先询问','原创角色','中文纯文本','最多 6000 字符','不要 JSON','手动完成角色创建'])assert.ok(prompt.includes(expected),expected);
 assert.ok(prompt.length<6000);assert.ok(!prompt.includes('```'));
});

test('optional prompt stays collapsed, validates names and never replaces the editable persona',async t=>{
 const h=await harness(t);
 assert.equal(h.byType('details').length,1);assert.equal(h.byType('details')[0].props.open,undefined);
 assert.match(h.byType('summary')[0].props.children,/可选/);assert.equal(h.copy().props.type,'button');
 assert.equal(h.input().props.maxLength,60);assert.equal(h.persona().props.maxLength,6000);
 assert.equal(h.copy().props.disabled,true);assert.equal(h.create().props.disabled,true);assert.equal(h.preview(),undefined);
 h.setPersona('保留手写设定');h.name(' '.repeat(3));assert.equal(h.copy().props.disabled,true);
 h.name('x'.repeat(61));assert.equal(h.copy().props.disabled,true);assert.equal(h.preview(),undefined);
 h.name('  绫波丽  ');assert.equal(h.copy().props.disabled,false);assert.equal(h.persona().props.value,'保留手写设定');
 assert.ok(h.preview().props.value.includes('"绫波丽"'));assert.equal(h.input().props.value,'  绫波丽  ');
 assert.equal(h.preview().props.readOnly,true);assert.equal(h.preview().props.rows,4);
 let selected=0;h.preview().props.onFocus({target:{select(){selected++;}}});assert.equal(selected,1);
});

test('actual copy waits for clipboard success, coalesces pending clicks and does not create or import',async t=>{
 const gate=deferred(),writes=[],actions=[];
 const clipboard={writeText(value){assert.equal(this,clipboard);writes.push(value);return gate.promise;}};
 const h=await harness(t,{clipboard,props:{onCreate:async value=>actions.push(value),onSelect:()=>actions.push('select'),onModelChange:()=>actions.push('model')}});
 h.name('  薇尔莉特  ');h.setPersona('用户的设定');const text=h.preview().props.value,copy=h.copy().props.onClick;
 const first=copy(),second=copy();h.render();
 assert.deepEqual(writes,[text]);assert.equal(h.copy().props.disabled,true);assert.equal(messages(h,'status'),'');
 assert.equal(h.persona().props.value,'用户的设定');assert.equal(h.create().props.disabled,false);
 gate.resolve();await Promise.all([first,second]);h.render();
 assert.match(messages(h,'status'),/提示词已复制/);assert.equal(h.copy().props.disabled,false);assert.deepEqual(actions,[]);
 h.name('阿尔托莉雅');assert.equal(messages(h,'status'),'');assert.ok(h.preview().props.value.includes('阿尔托莉雅'));
});

for(const kind of ['missing','rejected','invalid'])test(`actual ${kind} clipboard reports readable failure with selectable fallback`,async t=>{
 const clipboard=kind==='missing'?undefined:kind==='invalid'?{writeText:0}:{writeText:async()=>{throw Error('Permission denied');}};
 const h=await harness(t,{clipboard});h.name('远坂凛');const text=h.preview().props.value;
 await h.copy().props.onClick();h.render();
 assert.equal(messages(h,'status'),'');assert.match(messages(h,'alert'),/剪贴板.*全选.*手动复制/);
 assert.equal(h.preview().props.value,text);assert.equal(h.preview().props.readOnly,true);assert.equal(h.copy().props.disabled,false);
 if(kind==='rejected'){
  clipboard.writeText=async()=>{};await h.copy().props.onClick();h.render();
  assert.equal(messages(h,'alert'),'');assert.match(messages(h,'status'),/已复制/);
 }
});

test('older clipboard completion cannot report success or clear a newer pending attempt',async t=>{
 const first=deferred(),second=deferred(),writes=[];
 const h=await harness(t,{clipboard:{writeText(value){writes.push(value);return writes.length===1?first.promise:second.promise;}}});
 h.name('角色 A');const old=h.copy().props.onClick();h.name('角色 B');const latest=h.copy().props.onClick();h.render();
 first.resolve();await old;h.render();assert.equal(messages(h,'status'),'');assert.equal(h.copy().props.disabled,true);
 second.reject(Error('blocked'));await latest;h.render();assert.match(messages(h,'alert'),/手动复制/);
 assert.ok(h.preview().props.value.includes('角色 B'));assert.equal(h.copy().props.disabled,false);
});

for(const action of ['clear','unmount'])test(`clipboard completion after ${action} does not publish stale feedback`,async t=>{
 const gate=deferred(),h=await harness(t,{clipboard:{writeText:()=>gate.promise}});
 h.name('名字');const pending=h.copy().props.onClick();
 if(action==='clear')h.name('');else h.dispose();
 const writes=h.stateWrites;gate.resolve();await pending;
 assert.equal(h.stateWrites,writes);assert.equal(messages(h,'status'),'');
 if(action==='clear')assert.equal(h.preview(),undefined);
});

test('real creation keeps raw payload, pending guard and success reset after manual persona editing',async t=>{
 const creation=deferred(),copying=deferred(),created=[];
 const h=await harness(t,{clipboard:{writeText:()=>copying.promise},props:{models:[{id:'custom-local',label:'本地模型',ready:true}],onCreate:async value=>{created.push(value);await creation.promise;}}});
 h.name('  新角色  ');const copy=h.copy().props.onClick();h.setPersona('从外部 AI 粘贴后，用户手动修改的人设');
 h.selects()[1].props.onChange({target:{value:'custom-local'}});h.render();
 const submit=h.byType('form')[0].props.onSubmit,first=submit({preventDefault(){}}),second=submit({preventDefault(){}});h.render();
 assert.equal(h.create().props.disabled,true);assert.deepEqual(created,[{name:'  新角色  ',persona:'从外部 AI 粘贴后，用户手动修改的人设',modelId:'custom-local'}]);
 creation.resolve();await Promise.all([first,second]);h.render();
 assert.equal(h.input().props.value,'');assert.equal(h.persona().props.value,'');assert.equal(h.selects()[1].props.value,'');
 copying.resolve();await copy;h.render();assert.equal(messages(h,'status'),'');assert.equal(h.copy().props.disabled,true);
});

test('prompt validation does not change real creation validation, busy state or failed draft retention',async t=>{
 const {createCharacter,normalizeCharacters}=await import('../src/companion/characters.mjs');const state=normalizeCharacters({}),received=[];
 const h=await harness(t,{props:{onCreate:async value=>{received.push(value);createCharacter(state,value);}}});
 h.name('x'.repeat(61));h.setPersona('保留草稿');assert.equal(h.copy().props.disabled,true);
 assert.equal(h.create().props.disabled,false,'creation retains its existing name.trim() UI rule');
 await h.submit();h.render();assert.match(messages(h,'alert'),/1–60/);assert.equal(received[0].name,'x'.repeat(61));assert.equal(h.persona().props.value,'保留草稿');
 h.name('  雪之下雪乃  ');h.render({...h.props,busy:true});assert.equal(h.create().props.disabled,true);assert.equal(h.selects()[0].props.disabled,true);
 h.render({...h.props,busy:false});await h.submit();h.render();assert.equal(received.length,2);assert.equal(h.input().props.value,'');assert.equal(messages(h,'alert'),'');
});

test('prompt UI preserves built-in hold, resource and progression model gates and selection callbacks',async t=>{
 const models=[{id:'yukino-07-v1',label:'校服',ready:true},{id:'yukino-02-v1',label:'日常服',ready:true},{id:'yukino-03-v1',label:'泳装',ready:true},{id:'yukino-06-v1',label:'待确认',ready:true,hold:true},{id:'custom-hold',label:'待确认导入',ready:true,status:'HOLD'},{id:'custom-missing',label:'未准备',ready:false},{id:'custom-ready',label:'本地导入',ready:true}],changes=[];
 const h=await harness(t,{props:{models,onModelChange:value=>changes.push(value),relationship:{affection:35},usedDates:[]}});
 const options=select=>h.byType('option').filter(node=>{
  const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
  return walk(select.props.children).includes(node);
 });
 const selected=()=>options(h.selects()[1]).map(node=>node.props.value);
 assert.deepEqual(selected(),['','yukino-07-v1','custom-ready']);
 for(const node of options(h.selects()[0]).filter(node=>node.props.value))assert.equal(node.props.disabled,!['yukino-07-v1','custom-ready'].includes(node.props.value));
 h.name('原创角色');assert.deepEqual(selected(),['','yukino-07-v1','custom-ready']);
 h.selects()[0].props.onChange({target:{value:'custom-ready'}});assert.deepEqual(changes,['custom-ready']);
 h.render({...h.props,relationship:{affection:100},usedDates:Array.from({length:7},(_,i)=>`2026-10-0${i+1}`)});
 assert.deepEqual(selected(),['','yukino-07-v1','yukino-02-v1','yukino-03-v1','custom-ready']);
 assert.equal(h.picker().props.models,models);assert.equal(h.picker().props.selectedId,undefined);
 assert.equal(h.nodes().find(node=>typeof node.type==='function'&&node.props.character?.builtin).props.character.name,'雪之下雪乃');
});
