const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const jsx=require('react/jsx-runtime'),{providerCatalog}=require('../electron/providers.cjs'),{apiServiceCatalog}=require('../electron/api-management.cjs');
const helpers=import('../src/ui/api-management-ui.mjs');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const Select=()=>null,ApiSettingsChild=()=>null,icon=()=>null;

// Compile the real form and exercise its handlers with deterministic local hooks.
// No app, server, browser, account, secure store, microphone or cloud request starts.
async function harness(t,name,initial={}){
 const {transformWithOxc}=await import('vite'),metadata=await helpers;
 let {code}=await transformWithOxc(await fs.readFile(path.join(__dirname,`../src/ui/${name}.jsx`),'utf8'),`${name}.jsx`);
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],cleanups=new Map(),patches=[],calls={save:[],keys:[],credentials:[],models:[],tests:[]};let cursor=0,effects=[],dirty=false,tree;
 const api={apiProviders:async()=>providerCatalog(),apiServiceCatalog:async()=>apiServiceCatalog(),apiValidationStatus:async()=>({}),
  async save(value){calls.save.push(structuredClone(value));},async saveKey(...args){calls.keys.push(args);},async apiCredentialSave(...args){calls.credentials.push(args);},
  async apiModels(request){calls.models.push(request);return {status:'ready',verified:true,models:[{id:'account-model',name:'Account model'}],message:'Synthetic account-list fixture'};},async test(id){calls.tests.push(id);return 'Synthetic connection fixture';},...initial.api};
 let props={state:{profiles:[{id:'blank',name:'我的 API',base:'',model:''}],activeProfile:'blank'},keyIds:[],...initial,api};
 const callerChange=initial.onChange,callerKeys=initial.onKeyIds;
 props.onChange=patch=>{patches.push(structuredClone(patch));props={...props,state:{...props.state,...patch}};dirty=true;callerChange?.(patch);};
 props.onKeyIds=ids=>{props={...props,keyIds:ids};dirty=true;callerKeys?.(ids);};
 const hooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true;}}];},
  useRef(value){const n=cursor++;return values[n]||(values[n]={current:value});},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((value,i)=>!Object.is(value,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn());});}}
 };
 const deps={React:{},...hooks,...metadata,isSecret:metadata.secretProviderField,Select,ApiSettings:ApiSettingsChild,ArrowUpRight:icon,Check:icon,KeyRound:icon,LoaderCircle:icon,Plus:icon,Settings2:icon,CheckCircle2:icon,ChevronDown:icon,RefreshCw:icon,Search:icon,_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment};
 const component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 function render(next=props){props=next;let count=0;do{cursor=0;dirty=false;tree=component(props);effects.splice(0).forEach(fn=>fn());assert.ok(++count<16,'form effects must settle');}while(dirty);return tree;}
 const expanded=new WeakMap();
 function children(node){if(node?.type?.name==='DynamicField'){if(!expanded.has(node))expanded.set(node,node.type(node.props));return expanded.get(node);}return node?.props?.children;}
 function walk(node,ancestors=[]){return node==null||node===false?[]:Array.isArray(node)?node.flatMap(item=>walk(item,ancestors)):typeof node==='object'?[{node,ancestors},...walk(children(node),[...ancestors,node])]:[];}
 function text(node){return node==null||node===false?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(children(node)):String(node);}
 const h={calls,patches,render,get props(){return props;},get state(){return props.state;},get api(){return api;},all:()=>walk(tree),nodes:()=>walk(tree).map(item=>item.node),text:()=>text(tree),byLabel(label){return walk(tree).find(({node})=>node.props?.['aria-label']===label)?.node;},button(label){return walk(tree).find(({node})=>node.type==='button'&&text(node)===label)?.node;},field(label){return walk(tree).find(({node})=>node.type==='label'&&text(node).startsWith(label))?.node;},input(label){const field=this.field(label);return walk(field).find(({node})=>node.type==='input')?.node;},select(label){const field=this.field(label);return walk(field).find(({node})=>node.type===Select)?.node;},async settle(){for(let i=0;i<8;i++)await Promise.resolve();render();},dispose(){for(const cleanup of cleanups.values())cleanup?.();}};
 render();t.after(()=>h.dispose());return h;
}
const choose=(h,id)=>{h.byLabel('API 服务商').props.onChange({target:{value:id}});h.render();};
const enter=(h,label,value)=>{const input=h.input(label);assert.ok(input,label);input.props.onChange({target:{value}});h.render();};
const nativeConfig=state=>state.apiManagement.configs.find(config=>config.providerId==='aliyun-asr');

test('form metadata provides official defaults without copying secrets, and retains all exceptional required fields',async()=>{
 const {providerConfigDefaults,providerFormFields,preferredBrandService}=await helpers,catalog=apiServiceCatalog().providers;
 for(const provider of catalog){const config=providerConfigDefaults(provider,'new-id');assert.equal(config.base,provider.base);assert.equal(config.model,provider.model||'');assert.equal(config.credentialId,'new-id');assert.ok(!Object.values(config.fields).includes('secret'));for(const field of provider.fields||[])if(field.secret)assert.equal(Object.hasOwn(config.fields,field.id),false);}
 const ali=catalog.find(provider=>provider.id==='aliyun-asr'),fields=providerFormFields(ali);assert.deepEqual(fields.basic.map(field=>field.id),['apiKey','region']);assert.ok(fields.advanced.some(field=>field.id==='sampleRate'));
 assert.deepEqual(providerFormFields(catalog.find(provider=>provider.id==='tencent-asr')).basic.map(field=>field.id),['appId','secretId','secretKey','engineModelType']);
 assert.deepEqual(providerFormFields(catalog.find(provider=>provider.id==='google-asr')).basic.map(field=>field.id),['projectId']);
 assert.deepEqual(providerFormFields(catalog.find(provider=>provider.id==='azure-asr')).basic.map(field=>field.id),['apiKey','region']);
 const openai=catalog.filter(provider=>provider.brand==='openai');assert.equal(preferredBrandService(openai).id,'openai');assert.equal(preferredBrandService(openai,'asr').id,'openai-asr');
});

test('fresh chat forms require a vendor first, fill its official URL, and clear a typed key when changing vendor',async t=>{
 const h=await harness(t,'ApiSettings');await h.settle();assert.equal(h.byLabel('API 服务商').props.value,'');assert.equal(h.input('API 密钥').props.disabled,true);assert.equal(h.input('自定义 API 地址'),undefined);
 choose(h,'openai');assert.equal(h.state.profiles[0].base,providerCatalog().find(provider=>provider.id==='openai').base);assert.equal(h.input('API 密钥').props.disabled,false);assert.equal(h.input('自定义 API 地址'),undefined);
 enter(h,'API 密钥','draft-only-secret');assert.equal(h.input('API 密钥').props.value,'draft-only-secret');assert.ok(!JSON.stringify(h.state).includes('draft-only-secret'));
 choose(h,'deepseek');assert.equal(h.state.profiles[0].base,'https://api.deepseek.com');assert.equal(h.input('API 密钥').props.value,'');assert.equal(h.state.profiles[0].model,'');assert.deepEqual(h.calls.save,[]);assert.deepEqual(h.calls.models,[]);assert.deepEqual(h.calls.keys,[]);
});

test('metadata loading preserves existing custom URLs, and switching a configured chat vendor uses an independent identity',async t=>{
 const original={id:'old',name:'OpenAI proxy',providerId:'openai',base:'https://proxy.example.invalid/v1',model:'existing-model'},h=await harness(t,'ApiSettings',{state:{profiles:[original],activeProfile:'old'},keyIds:['old']});await h.settle();assert.deepEqual(h.state.profiles[0],original);assert.equal(h.input('自定义 API 地址'),undefined);assert.ok(h.text().includes(original.base));
 h.button('高级设置 · 自定义地址与模型').props.onClick();h.render();assert.equal(h.input('自定义 API 地址').props.value,original.base);
 enter(h,'API 密钥','old-draft-secret');choose(h,'deepseek');const current=h.state.profiles.find(profile=>profile.id===h.state.activeProfile);assert.notEqual(current.id,'old');assert.equal(current.providerId,'deepseek');assert.equal(current.base,'https://api.deepseek.com');assert.deepEqual(h.state.profiles.find(profile=>profile.id==='old'),original);assert.equal(h.input('API 密钥').props.value,'');assert.equal(h.button('验证密钥并获取模型').props.disabled,true);assert.equal(h.input('自定义 API 地址'),undefined);assert.deepEqual(h.calls.keys,[]);
 choose(h,'openai');assert.equal(h.state.activeProfile,'old');assert.equal(h.state.profiles.length,2);assert.equal(h.input('API 密钥').props.value,'');assert.equal(h.state.profiles[0].base,original.base);
});

test('even same-origin providers do not inherit an encrypted key when selecting another vendor',async t=>{
 const source={id:'custom',name:'Existing compatible config',providerId:'custom',base:'https://api.openai.com/v1',model:''},h=await harness(t,'ApiSettings',{state:{profiles:[source],activeProfile:source.id},keyIds:[source.id]});await h.settle();choose(h,'openai');assert.notEqual(h.state.activeProfile,source.id);assert.equal(h.input('API 密钥').props.value,'');assert.equal(h.button('验证密钥并获取模型').props.disabled,true);assert.deepEqual(h.state.profiles.find(profile=>profile.id===source.id),source);assert.deepEqual(h.calls.keys,[]);
});

test('custom URL stays advanced, local official defaults need no invented credential, and an empty profile list can start by choosing a vendor',async t=>{
 const h=await harness(t,'ApiSettings',{state:{profiles:[],activeProfile:''}});await h.settle();choose(h,'custom');assert.equal(h.state.profiles.length,1);assert.equal(h.state.profiles[0].base,'');assert.equal(h.input('自定义 API 地址'),undefined);h.button('高级设置 · 自定义地址与模型').props.onClick();h.render();enter(h,'自定义 API 地址','https://custom.example.invalid/v1');assert.equal(h.state.profiles[0].base,'https://custom.example.invalid/v1');
 choose(h,'local');assert.equal(h.state.profiles.find(profile=>profile.id===h.state.activeProfile).base,'http://127.0.0.1:1234/v1');assert.equal(h.button('获取本机模型').props.disabled,false);assert.equal(h.input('API 密钥').props.value,'');assert.deepEqual(h.calls.models,[]);
});

test('chat save retains secure key API and explicit source binding without adding a key to ordinary state',async t=>{
 const h=await harness(t,'ApiSettings');await h.settle();choose(h,'openai');enter(h,'API 密钥','test-only-secret');await h.button('保存配置').props.onClick();h.render();assert.deepEqual(h.calls.keys,[['blank','test-only-secret','https://api.openai.com/v1']]);assert.equal(h.input('API 密钥').props.value,'');assert.ok(h.props.keyIds.includes('blank'));assert.ok(!JSON.stringify([h.state,h.patches,h.calls.save]).includes('test-only-secret'));assert.deepEqual(h.calls.models,[]);assert.deepEqual(h.calls.tests,[]);assert.ok(h.text().includes('本次尚未测试'));
});

test('model discovery remains an explicit action and an unsupported list never saves or validates a key',async t=>{
 const h=await harness(t,'ApiSettings',{api:{async apiModels(request){h.calls.models.push(request);return {status:'unsupported',verified:false,models:[],suggestions:[{id:'documented-example'}],message:'Fixture: unsupported list; credentials unverified'};}}});await h.settle();choose(h,'openai');enter(h,'API 密钥','test-only-secret');await h.button('验证密钥并获取模型').props.onClick();h.render();assert.equal(h.calls.models.length,1);assert.equal(h.calls.models[0].base,'https://api.openai.com/v1');assert.deepEqual(h.calls.keys,[]);assert.ok(h.text().includes('尚未验证你的账户可用性'));assert.equal(h.state.profiles[0].model,'');assert.equal(h.input('API 密钥').props.value,'test-only-secret');
});

test('a confirmed account list can select its sole model and save the key only through the bound secure API',async t=>{
 const h=await harness(t,'ApiSettings');await h.settle();choose(h,'openai');enter(h,'API 密钥','account-list-test-secret');await h.button('验证密钥并获取模型').props.onClick();h.render();assert.equal(h.calls.models.length,1);assert.equal(h.state.profiles[0].model,'account-model');assert.deepEqual(h.calls.keys,[['blank','account-list-test-secret','https://api.openai.com/v1']]);assert.equal(h.input('API 密钥').props.value,'');assert.ok(!JSON.stringify([h.state,h.patches,h.calls.save]).includes('account-list-test-secret'));assert.deepEqual(h.calls.tests,[]);
});

test('editing an advanced chat endpoint clears the typed key and saves a replacement against the new origin',async t=>{
 const profile={id:'source',providerId:'openai',name:'Original',base:'https://api.openai.com/v1',model:'account-model'},h=await harness(t,'ApiSettings',{state:{profiles:[profile],activeProfile:profile.id},keyIds:[profile.id]});await h.settle();enter(h,'API 密钥','discard-this-key');h.button('高级设置 · 自定义地址与模型').props.onClick();h.render();enter(h,'自定义 API 地址','https://new-origin.example.invalid/v1');assert.equal(h.input('API 密钥').props.value,'');enter(h,'API 密钥','replacement-test-key');await h.button('保存配置').props.onClick();h.render();assert.deepEqual(h.calls.keys,[['source','replacement-test-key','https://new-origin.example.invalid/v1']]);assert.ok(!JSON.stringify(h.calls.save).includes('replacement-test-key'));assert.deepEqual(h.calls.models,[]);assert.deepEqual(h.calls.tests,[]);
});

test('late chat saves stop before writing a key or testing after a profile switch',async t=>{
 const gate=deferred(),h=await harness(t,'ApiSettings',{api:{save:()=>gate.promise}});await h.settle();choose(h,'openai');enter(h,'API 密钥','old-pending-secret');const pending=h.button('保存配置').props.onClick();h.render();const state={...h.state,profiles:[...h.state.profiles,{id:'other',providerId:'deepseek',name:'Other',base:'https://api.deepseek.com',model:''}],activeProfile:'other'};h.render({...h.props,state});gate.resolve();await pending;h.render();assert.deepEqual(h.calls.keys,[]);assert.deepEqual(h.calls.tests,[]);assert.equal(h.input('API 密钥').props.value,'');
});

test('choosing ASR exposes the key immediately with official defaults while URL and model remain folded',async t=>{
 const h=await harness(t,'ApiManagementSettings',{initialTask:'asr'});await h.settle();const config=nativeConfig(h.state);assert.ok(config);assert.equal(config.base,'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');assert.equal(config.model,'qwen3-asr-flash-realtime');assert.equal(config.fields.sampleRate,16000);assert.ok(h.input('API Key'));assert.ok(h.select('地域'));
 for(const label of ['服务地址','识别模型 ID','配置名称']){const input=h.input(label);assert.ok(input,label);const entry=h.all().find(item=>item.node===input);assert.ok(entry.ancestors.some(parent=>parent.type==='details'),`${label} is advanced`);}
 const key=h.input('API Key');assert.equal(h.all().find(item=>item.node===key).ancestors.some(parent=>parent.type==='details'),false);assert.deepEqual(h.calls.save,[]);assert.deepEqual(h.calls.credentials,[]);assert.ok(h.text().includes('尚未通过')===false);assert.ok(h.text().includes('未验证'));
 enter(h,'API Key','asr-test-only-secret');await h.button('保存配置').props.onClick();h.render();assert.equal(h.calls.credentials.length,1);assert.deepEqual(h.calls.credentials[0],[config.id,{apiKey:'asr-test-only-secret'}]);assert.equal(h.calls.save[0].apiManagement.configs.find(item=>item.id===config.id).base,config.base);assert.ok(!JSON.stringify([h.state,h.patches,h.calls.save]).includes('asr-test-only-secret'));assert.ok(h.text().includes('尚未通过实际转写验证'));
});

test('native vendor switches clear draft credentials, preserve required multi-field exceptions, and leave catalog-only ASR disabled',async t=>{
 const h=await harness(t,'ApiManagementSettings',{initialTask:'asr'});await h.settle();const ali=nativeConfig(h.state);enter(h,'API Key','ali-draft-only');
 const tencent=h.nodes().find(node=>node.type==='article'&&node.props.className?.includes('provider-card')&&node.props.children.some?.(child=>child?.type==='button'&&child.props.className==='provider-title'&&child.props.children.some?.(part=>part?.type==='strong'&&part.props.children==='腾讯云')));assert.ok(tencent);const configure=tencent.props.children.find(node=>node?.type==='button'&&node.props.className==='secondary');configure.props.onClick();h.render();assert.equal(h.input('API Key'),undefined);for(const field of ['APPID','SecretID','SecretKey','引擎型号'])assert.ok(h.input(field),field);assert.equal(h.input('SecretID').props.value,'');assert.equal(h.input('SecretKey').props.value,'');assert.equal(h.button('去语音输入测试').props.disabled,true);assert.ok(h.text().includes('协议待接入'));assert.equal(h.state.apiManagement.configs.find(config=>config.id===ali.id).base,ali.base);assert.deepEqual(h.calls.credentials,[]);
});

test('ASR region selection updates automatic URLs but never overwrites a pre-existing custom base',async t=>{
 const h=await harness(t,'ApiManagementSettings',{initialTask:'asr'});await h.settle();enter(h,'API Key','region-specific-secret');h.select('地域').props.onChange({target:{value:'ap-southeast-1'}});h.render();assert.equal(h.input('API Key').props.value,'');assert.equal(h.input('服务地址').props.value,'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime');
 const config={...nativeConfig(h.state),base:'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime'},state={profiles:[],apiManagement:{configs:[config],taskRoutes:{asr:config.id}}};const existing=await harness(t,'ApiManagementSettings',{state,initialTask:'asr',keyIds:[config.id]});await existing.settle();existing.select('地域').props.onChange({target:{value:'ap-southeast-1'}});existing.render();assert.equal(existing.input('服务地址').props.value,config.base);assert.deepEqual(existing.calls.credentials,[]);
});

test('opening an inherited chat task preserves its existing custom configuration instead of creating another vendor',async t=>{
 const profile={id:'existing-chat',providerId:'openai',name:'Existing proxy',base:'https://existing-proxy.example.invalid/v1',model:'existing-account-model'},state={profiles:[profile],activeProfile:profile.id,apiManagement:{defaultConfigId:profile.id,configs:[],taskRoutes:{chat:'inherit'}}},h=await harness(t,'ApiManagementSettings',{state,initialTask:'chat',keyIds:[profile.id]});await h.settle();const child=h.nodes().find(node=>node.type===ApiSettingsChild);assert.ok(child);assert.equal(child.props.editingProfileId,profile.id);assert.deepEqual(h.state.profiles,[profile]);assert.equal(h.patches.length,0);assert.deepEqual(h.calls.save,[]);
});

test('normal brand cards prefer chat and create its form without the extra new-configuration click',async t=>{
 const h=await harness(t,'ApiManagementSettings',{state:{profiles:[]}});await h.settle();const title=h.nodes().find(node=>node.type==='button'&&node.props.className==='provider-title'&&node.props.children.some?.(part=>part?.type==='strong'&&part.props.children==='OpenAI'));const card=h.all().find(item=>item.node===title).ancestors.at(-1);card.props.children.find(node=>node?.type==='button'&&node.props.className==='secondary').props.onClick();h.render();const child=h.nodes().find(node=>node.type===ApiSettingsChild);assert.ok(child);assert.equal(h.state.profiles.length,1);assert.equal(h.state.profiles[0].providerId,'openai');assert.equal(h.state.profiles[0].base,'https://api.openai.com/v1');assert.equal(child.props.editingProfileId,h.state.profiles[0].id);assert.deepEqual(h.calls.save,[]);
 const form=await harness(t,'ApiSettings',child.props);await form.settle();assert.ok(form.input('API 密钥'));assert.equal(form.input('自定义 API 地址'),undefined);assert.ok(!form.input('API 密钥').props.disabled);
});
