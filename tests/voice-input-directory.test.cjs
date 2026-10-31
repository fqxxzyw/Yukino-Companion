const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const metadata=import('../src/speech/asr-provider-directory.mjs');
const {apiServiceCatalog,officialProviderLink}=require('../electron/api-management.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Compile only: no Vite server, browser, microphone, ASR connection or GUI starts.
// Real component handlers run with local hooks and inert recording boundaries.
async function harness(t,initial={}){
 const {transformWithOxc}=await import('vite'),directory=await metadata,{VOICE_INPUT_DEFAULTS}=await import('../src/speech/voice-input-session.mjs');
 let {code}=await transformWithOxc(await fs.readFile(path.join(__dirname,'../src/speech/VoiceInputSettings.jsx'),'utf8'),'VoiceInputSettings.jsx');
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],cleanups=new Map();let cursor=0,effects=[],dirty=false,tree,props=initial,writes=0,microphoneStarts=0;
 const hooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],value=>{const next=typeof value==='function'?value(values[n]):value;if(!Object.is(next,values[n])){values[n]=next;dirty=true;writes++;}}];},
  useRef(value){const n=cursor++;return values[n]||(values[n]={current:value});},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||deps.some((value,i)=>!Object.is(value,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn());});}}
 };
 const target={addEventListener(){},removeEventListener(){}},Select=props=>React.createElement('select',props),VoiceInputControl=()=>null;
 class MicrophoneCapture{constructor(){microphoneStarts++;throw Error('No recording in directory tests');}}
 const deps={React,...hooks,...directory,Select,VoiceInputControl,VOICE_INPUT_DEFAULTS,MicrophoneCapture,microphoneDevices:async()=>[],navigator:{mediaDevices:target},document:target,_jsx:jsx.jsx,_jsxs:jsx.jsxs,_Fragment:jsx.Fragment};
 const component=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 function render(next=props){props=next;let count=0;do{cursor=0;dirty=false;tree=component(props);effects.splice(0).forEach(fn=>fn());assert.ok(++count<12,'effects must settle');}while(dirty);return tree;}
 function walk(node){return !node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];}
 const h={render,nodes:()=>walk(tree),html:()=>renderToStaticMarkup(tree),get writes(){return writes;},get microphoneStarts(){return microphoneStarts;},async settle(){for(let i=0;i<6;i++)await Promise.resolve();render();},button(label){return walk(tree).find(node=>node.type==='button'&&node.props['aria-label']===label);},dispose(){for(const cleanup of cleanups.values())cleanup?.();}};
 render();t.after(()=>h.dispose());return h;
}

test('browser references reuse eight known identities and official branding, without configuration or adapter claims',async()=>{
 const {ASR_DOCUMENTATION_EXAMPLES,asrAdaptationLabel,asrOfficialLinks}=await metadata;
 const providers=apiServiceCatalog().providers.filter(provider=>provider.kind==='asr');
 assert.deepEqual(ASR_DOCUMENTATION_EXAMPLES.map(provider=>provider.id),providers.map(provider=>provider.id));
 for(const example of ASR_DOCUMENTATION_EXAMPLES){
  assert.equal(example.documentationOnly,true);assert.match(asrAdaptationLabel(example),/仅官方文档示例/);
  for(const field of ['model','fields','apiKey','implementation','validation','verification'])assert.equal(Object.hasOwn(example,field),false);
  for(const link of asrOfficialLinks(example)){assert.equal(new URL(link.url).protocol,'https:');assert.equal(link.url,officialProviderLink(example.id,link.kind));}
 }
});

test('desktop directory derives ASR entries and adaptation status solely from the existing service catalog',async()=>{
 const {asrDirectoryProviders,asrAdaptationLabel}=await metadata,providers=asrDirectoryProviders(apiServiceCatalog());
 assert.equal(providers.length,8);assert.equal(providers.filter(provider=>asrAdaptationLabel(provider)==='协议已实现 · 尚未实测').length,1);
 assert.equal(providers.find(provider=>asrAdaptationLabel(provider)==='协议已实现 · 尚未实测').id,'aliyun-asr');
 for(const provider of providers.filter(provider=>provider.id!=='aliyun-asr'))assert.equal(asrAdaptationLabel({...provider,apiKey:'not-proof',verification:'passed'}),'仅文档 / 待接入');
 assert.deepEqual(asrDirectoryProviders({providers:[{id:'chat',capabilities:['chat']},{id:'asr',capabilities:['asr']}]}).map(provider=>provider.id),['asr']);
 assert.deepEqual(asrDirectoryProviders({providers:[]}),[]);assert.throws(()=>asrDirectoryProviders({}),/格式无效/);
});

test('official opening sends only provider identity and allowlisted kind, never a renderer URL',async()=>{
 const {openAsrOfficial,asrOfficialLinks}=await metadata,calls=[],api={async apiOpenOfficial(request){calls.push(request);return true;}};
 await openAsrOfficial(api,'aliyun-asr','docs');assert.deepEqual(calls,[{providerId:'aliyun-asr',kind:'docs'}]);
 await assert.rejects(openAsrOfficial(api,'aliyun-asr','https://untrusted.invalid'),/未知/);assert.equal(calls.length,1);
 await assert.rejects(openAsrOfficial(undefined,'aliyun-asr','docs'),/桌面版.*受信/);
 assert.deepEqual(asrOfficialLinks({consoleUrl:'javascript:alert(1)',keyUrl:'https://name:password@example.com/',docsUrl:'http://example.com'}),[]);
});

test('browser page displays the official example list but disables opening and never simulates credentials or validation',async t=>{
 let changes=0;const h=await harness(t,{onChange(){changes++;}});await h.settle();const html=h.html();
 for(const name of ['OpenAI','阿里云百炼','火山引擎','腾讯云','Deepgram','ElevenLabs','Google Cloud Speech','Azure Speech'])assert.ok(html.includes(name),name);
 assert.match(html,/浏览器仅展示只读官方示例/);assert.match(html,/不保存凭据或执行识别验证/);assert.match(html,/官方跳转请在桌面版使用受信入口/);
 assert.equal(h.nodes().filter(node=>node.type==='li').length,8);
 const buttons=h.nodes().filter(node=>node.type==='button'&&node.props['aria-label']);assert.equal(buttons.length,24);assert.ok(buttons.every(button=>button.props.disabled));
 await buttons[0].props.onClick();h.render();assert.match(h.html(),/请在桌面版使用受信的官方页面入口/);
 assert.doesNotMatch(html,/<a |<script|type="password"|验证成功|协议已实现 · 尚未实测/);assert.equal(changes,0);assert.equal(h.microphoneStarts,0);
});

test('actual desktop handlers open catalog-backed official pages and preserve the existing ASR configuration entry',async t=>{
 const catalog=apiServiceCatalog(),calls=[];let changes=0,openedSettings=0,recognition=0;
 const api={apiServiceCatalog:async()=>catalog,apiOpenOfficial:async request=>{calls.push(request);},asrStart(){recognition++;},apiCredentialSave(){throw Error('must not save credentials');},apiConfigValidate(){throw Error('must not validate');}};
 const h=await harness(t,{api,value:{apiKey:'not-a-real-key',verification:'passed'},onChange(){changes++;},onOpenApiManagement(){openedSettings++;}});await h.settle();const html=h.html();
 assert.match(html,/协议已实现 · 尚未实测/);assert.equal((html.match(/仅文档 \/ 待接入/g)||[]).length,7);assert.doesNotMatch(html,/仅官方文档示例|not-a-real-key/);
 assert.match(html,/填写密钥不会自动变为可用/);assert.match(html,/连接成功不算通过/);
 for(const provider of catalog.providers.filter(provider=>provider.kind==='asr'))for(const [kind,label]of [['console','官方开通'],['key','获取凭据'],['docs','ASR 文档']]){
  const button=h.button(`${provider.name} · ${label}`);assert.ok(button);assert.equal(button.props.disabled,false);await button.props.onClick();assert.deepEqual(calls.at(-1),{providerId:provider.id,kind});
 }
 h.nodes().find(node=>node.type==='button'&&node.props.children==='配置语音识别 API').props.onClick();assert.equal(openedSettings,1);
 assert.equal(calls.length,24);assert.equal(changes,0);assert.equal(recognition,0);assert.equal(h.microphoneStarts,0);
});

test('catalog failures retain honest read-only examples and official-link failures remain visible without success claims',async t=>{
 let fail=true;const api={apiServiceCatalog:async()=>{throw Error('catalog unavailable');},apiOpenOfficial:async()=>{if(fail)throw Error("Error invoking remote method 'api-open-official': Error: 无法打开官方页面");}};
 const h=await harness(t,{api});await h.settle();assert.match(h.html(),/厂商目录暂时无法读取/);assert.equal(h.nodes().filter(node=>node.type==='li').length,8);assert.doesNotMatch(h.html(),/协议已实现 · 尚未实测/);
 await h.button('OpenAI · ASR 文档').props.onClick();h.render();assert.match(h.html(),/role="alert">无法打开官方页面/);assert.doesNotMatch(h.html(),/Error invoking remote/);
 fail=false;await h.button('OpenAI · ASR 文档').props.onClick();h.render();assert.doesNotMatch(h.html(),/role="alert"/);
});

test('malformed catalog responses become read-only examples instead of a perpetual loading state',async t=>{
 for(const response of [null,undefined,{}]){
  const h=await harness(t,{api:{apiServiceCatalog:async()=>response}});await h.settle();assert.match(h.html(),/厂商目录暂时无法读取/);assert.doesNotMatch(h.html(),/正在读取本机适配目录/);assert.equal(h.nodes().filter(node=>node.type==='li').length,8);
 }
});

test('empty catalogs stay empty, and late metadata responses cannot replace a newer API catalog',async t=>{
 const pending=deferred(),first={apiServiceCatalog:()=>pending.promise},second={apiServiceCatalog:async()=>({providers:[]})};
 const h=await harness(t,{api:first});await h.settle();h.render({api:second});await h.settle();assert.match(h.html(),/当前目录没有语音识别服务/);assert.equal(h.nodes().filter(node=>node.type==='li').length,0);
 pending.resolve(apiServiceCatalog());await h.settle();assert.equal(h.nodes().filter(node=>node.type==='li').length,0);
 const late=deferred();h.render({api:{apiServiceCatalog:()=>late.promise}});await h.settle();h.dispose();const writes=h.writes;late.resolve(apiServiceCatalog());await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(h.writes,writes,'unmounted page must ignore the response');
});
