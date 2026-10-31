const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let server;
test.before(async()=>{const {createServer}=await import('vite');server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});});
test.after(async()=>{await server?.close();});

test('settings routes preserve contextual entries and independently expose advanced pages',async()=>{
 const {SETTINGS_PAGES,settingsPage,filterSettingsPages,settingsFamily}=await import('../src/ui/settings-pages.mjs');
 assert.equal(new Set(SETTINGS_PAGES.map(item=>item.id)).size,SETTINGS_PAGES.length);
 const primary=SETTINGS_PAGES.filter(item=>!item.hiddenInNavigation);
 assert.deepEqual(primary.map(item=>item.id),['general','appearance','characters','conversation','api','translation','memory','speech-input','voice','vision','desktop-companion','advanced']);
 assert.deepEqual(settingsFamily('speech-input').map(item=>item.id),['speech-input'],'microphone/ASR has its own primary page');
 assert.deepEqual(settingsFamily('voice-resources').map(item=>item.id),['voice','voice-resources']);
 assert.deepEqual(settingsFamily('characters').map(item=>item.id),['characters','persona']);
 assert.deepEqual(settingsFamily('desktop-companion').map(item=>item.id),['desktop-companion','relationship']);
 for(const id of ['conversation','api','translation','memory'])assert.deepEqual(settingsFamily(id).map(item=>item.id),[id],`${id} has a separate sidebar page`);
 assert.deepEqual(settingsFamily('unknown'),[]);
 for(const root of primary){const family=settingsFamily(root.id);for(const item of family)assert.equal(item.parent||item.id,root.id);}
 assert.equal(primary.flatMap(item=>settingsFamily(item.id)).length,SETTINGS_PAGES.length,'every route belongs to exactly one reachable primary section');
 for(const item of SETTINGS_PAGES){assert.equal(settingsPage(item.id),item.id);if(item.parent)assert.ok(SETTINGS_PAGES.some(parent=>parent.id===item.parent));}
 assert.equal(settingsPage('avatar'),'characters');assert.equal(settingsPage('personal'),'general');assert.equal(settingsPage('memory'),'memory');assert.equal(settingsPage(null),null);assert.equal(settingsPage('unknown'),'general');
 assert.ok(filterSettingsPages('GPU').some(item=>item.id==='voice-advanced'));
 assert.ok(filterSettingsPages('参考 音频').some(item=>item.id==='voice-resources'));
 assert.deepEqual(filterSettingsPages('no-such-setting-012345'),[]);
});

test('settings is a named workspace region, not a modal or a focus trap',async()=>{
 const {default:Shell}=await server.ssrLoadModule('/src/ui/SettingsShell.jsx');
 const html=renderToStaticMarkup(React.createElement(Shell,{page:'general',onNavigate(){},onBack(){}},React.createElement('p',null,'settings content')));
 assert.match(html,/<section class="settings settings-page" aria-label="设置">/);
 assert.doesNotMatch(html,/role="dialog"|aria-modal|modal-backdrop/);
 assert.match(html,/aria-current="page"/);assert.match(html,/aria-label="搜索设置"/);assert.match(html,/返回对话/);
 assert.match(html,/<h1[^>]+id="settings-page-title"/);assert.match(html,/settings content/);
 assert.doesNotMatch(html,/音色与参考声音|语音环境与诊断|人格与提示词/,'technical subpages do not crowd the primary navigation');
 const nested=renderToStaticMarkup(React.createElement(Shell,{page:'voice-advanced',onNavigate(){},onBack(){}}));
 assert.match(nested,/返回高级与资源/);assert.match(nested,/aria-current="location"/);
 assert.doesNotMatch(nested,/class="settings-subnav"/,'advanced uses a short destination list, not another technical tab bar');
 assert.equal((html.match(/aria-label="返回对话"/g)||[]).length,1,'one explicit return control');
 assert.equal((html.match(/class="selected"/g)||[]).length,1);
 assert.doesNotMatch(html,/settings-brand|settings-nav-group/);
});

test('voice playback, resources and diagnostics render distinct pages without losing original controls',async()=>{
 const {default:VoiceSettings,voiceDefaults}=await server.ssrLoadModule('/src/speech/VoiceSettings.jsx');
 let invoked=0;
 const props={config:{...voiceDefaults},status:{phase:'unloaded'},onChange(){},onSave(){invoked++;},onPreview(){invoked++;},onStop(){},onOpenSetup(){},onOpenResources(){},onOpenAdvanced(){}};
 const render=page=>renderToStaticMarkup(React.createElement(VoiceSettings,{...props,page}));
 const playback=render('playback');assert.match(playback,/自动朗读新回复/);assert.match(playback,/播放音量/);assert.match(playback,/音色与参考声音/);assert.doesNotMatch(playback,/Python 可执行文件|CPU 线程（1–32）|GPT 权重（\.ckpt）/);
 const resources=render('resources');assert.match(resources,/GPT 权重（\.ckpt）/);assert.match(resources,/参考音频对应文本/);assert.doesNotMatch(resources,/自动朗读新回复|Python 可执行文件/);
 const advanced=render('advanced');assert.match(advanced,/Python 可执行文件/);assert.match(advanced,/CPU 线程（1–32）/);assert.doesNotMatch(advanced,/自动朗读新回复|参考音频对应文本/);
 for(const html of [playback,resources,advanced])assert.doesNotMatch(html,/<details class="advanced-settings"/);
 assert.match(playback,/settings-inline-setup/);assert.match(playback,/settings-related-links/);
 assert.doesNotMatch(playback,/resource-help|释放音色模型内存|完整中文配置教程|CPU 运行环境即使/,'playback has no resource tutorial or technical memory controls');
 assert.match(advanced,/释放音色模型内存/);assert.match(advanced,/完整中文配置教程/);
 assert.equal(invoked,0,'rendering a settings page cannot save, infer, record or play');
});

test('main keeps settings inside the workspace and suspends hidden microphone controls',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../src/main.jsx'),'utf8');
 assert.ok(source.indexOf('<SettingsShell')>source.indexOf('<div className="workspace">'));
 assert.ok(source.indexOf('</SettingsShell>')<source.indexOf('{setupOpen&&<SetupWizard'));
 assert.match(source,/<main[^>]+hidden=\{Boolean\(modal\)\}/);
 assert.doesNotMatch(source,/settings-backdrop|modalClosing|modalTimer/);
 assert.ok(source.indexOf('<VoiceInputControl variant="composer"')>source.indexOf('<div className="composer"><textarea'));
 assert.match(source,/disabled=\{Boolean\(modal\)\|\|setupOpen\|\|voiceWizardOpen/);
 assert.match(source,/选择屏幕或摄像头预览/);
 assert.match(source,/const sidebarCollapsed=s\.collapsed\|\|Boolean\(modal\)/);
 assert.match(source,/collapsed=\{sidebarCollapsed\}/);
 assert.doesNotMatch(source,/patch\(\{collapsed:(?:true|Boolean\(modal\))\}\)/,'opening settings does not persist a collapsed-sidebar preference');
 const general=source.slice(source.indexOf("{modal==='general'"),source.indexOf("{modal==='characters'"));
 assert.match(general,/本机资料/);assert.match(general,/UsageSummary/);assert.match(general,/使用帮助/);
 assert.doesNotMatch(general,/CapabilitySummary|settings-shortcuts|setup-entry/);
 assert.match(source,/modal==='diagnostics'&&<CapabilitySummary/);
 const characters=source.slice(source.indexOf("{modal==='characters'"),source.indexOf("{modal==='desktop-companion'"));
 assert.match(characters,/<CharacterSettings/);assert.doesNotMatch(characters,/显示人物区域|CompanionSettings/);
 const desktop=source.slice(source.indexOf("{modal==='desktop-companion'"),source.indexOf("{modal==='appearance'"));
 assert.match(desktop,/显示人物区域/);assert.match(desktop,/<CompanionSettings[^>]+section="display"/);
 assert.equal((source.match(/modal==='desktop-companion'/g)||[]).length,1,'display is rendered on one route only');
 assert.match(source,/resourceNotice=\{<ResourceReadinessNotice api=\{api\} onOpenSetup=\{openSetup\}/);
 const advanced=source.slice(source.indexOf("{modal==='advanced'"),source.indexOf("{modal==='speech-input'"));
 const {SETTINGS_PAGES}=await import('../src/ui/settings-pages.mjs');
 for(const item of SETTINGS_PAGES.filter(item=>item.parent==='advanced'))assert.ok(advanced.includes(`['${item.id}',`),`${item.id} is reachable from the advanced destination list`);
});

test('each family shows its own subnavigation and keeps the primary parent selected',async()=>{
 const {default:Shell}=await server.ssrLoadModule('/src/ui/SettingsShell.jsx');
 const {SETTINGS_PAGES,settingsFamily}=await import('../src/ui/settings-pages.mjs');
 for(const page of SETTINGS_PAGES.filter(item=>item.parent&&item.parent!=='advanced')){
  const html=renderToStaticMarkup(React.createElement(Shell,{page:page.id,onNavigate(){},onBack(){}}));
  const subnav=html.match(/<nav class="settings-subnav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(subnav,`${page.id} has direct sibling navigation`);
  for(const item of settingsFamily(page.id))assert.ok(subnav.includes(item.tabLabel||item.label));
  assert.equal((subnav.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,/aria-current="location"/);
 }
});

test('workspace API, voice input and desktop pages omit duplicate headings without changing standalone views',async()=>{
 const {default:Api}=await server.ssrLoadModule('/src/ui/ApiManagementSettings.jsx');
 const props={state:{profiles:[]},onChange(){},keyIds:[]};
 const render=embedded=>renderToStaticMarkup(React.createElement(Api,{...props,embedded}));
 assert.match(render(false),/API 管理中心/);assert.doesNotMatch(render(true),/API 管理中心/);
 assert.match(render(true),/API 管理视图/);
 const {default:Input}=await server.ssrLoadModule('/src/speech/VoiceInputSettings.jsx');
 const input=embedded=>renderToStaticMarkup(React.createElement(Input,{embedded,onChange(){}}));
 assert.match(input(false),/<h3>语音输入<\/h3>/);assert.doesNotMatch(input(true),/<h3>语音输入<\/h3>/);
 assert.match(input(true),/真实转写测试/);assert.match(input(true),/麦克风/);
 const {default:Companion}=await server.ssrLoadModule('/src/ui/CompanionSettings.jsx');
 const html=renderToStaticMarkup(React.createElement(Companion,{state:{},section:'display',onChange(){}}));
 assert.doesNotMatch(html,/<h3[^>]*>桌面陪伴<\/h3>/);
 for(const label of ['陪伴方式','气泡与语录','桌宠预录语音','使用电脑休息提醒','专注一会儿'])assert.ok(html.includes(label));
 assert.doesNotMatch(html,/主动发起聊天|自动观察与问候/,'separate conversation and vision sections remain separate');
});

// CPU-only event coverage. The actual Shell is compiled, with hook/ref boundaries
// supplied here; this is not a browser layout or native focus acceptance test.
async function shellHarness(){
 const {transformWithOxc}=await import('vite');
 const registry=await import('../src/ui/settings-pages.mjs'),runtime=require('react/jsx-runtime');
 const source=await fs.readFile(path.join(__dirname,'../src/ui/SettingsShell.jsx'),'utf8');
 let {code}=await transformWithOxc(source,'SettingsShell.jsx');
 code=code.replace(/^import .*;\s*$/gm,'').replace('export default function','return function');
 const values=[],events=[],navigations=[];let cursor=0,effects=[],props,tree,backs=0;
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const hooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=initial;return [values[n],value=>{values[n]=value;}];},
  useRef(initial){const n=cursor++;return values[n]||(values[n]={current:initial});},
  useLayoutEffect(fn,deps){const n=cursor++;if(!values[n]||deps.some((value,i)=>!Object.is(value,values[n][i]))){values[n]=deps;effects.push(fn);}},
 };
 const icon=()=>null,deps={React:{},...hooks,...registry,ArrowLeft:icon,Search:icon,X:icon,_jsx:runtime.jsx,_jsxs:runtime.jsxs};
 const Shell=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code}`)(deps);
 function render(page=props?.page||'general'){
  props={page,onNavigate:id=>navigations.push(id),onBack:()=>{backs++;}};cursor=0;tree=Shell(props);
  for(const node of walk(tree))if(node.props.ref&&!node.props.ref.current){const label=node.props['aria-label']||node.props.id||node.props.className;node.props.ref.current={focus:options=>events.push(['focus',label,options]),scrollTo:(...args)=>events.push(['scroll',label,...args])};}
  effects.splice(0).forEach(fn=>fn());return tree;
 }
 render();
 return {render,events,navigations,get backs(){return backs;},node:predicate=>walk(tree).find(predicate),nodes:predicate=>walk(tree).filter(predicate)};
}

test('settings search, navigation, reset, return and route-focus handlers use the actual shell',async()=>{
 const h=await shellHarness();
 const input=()=>h.node(node=>node.type==='input');
 const primary=()=>h.node(node=>node.type==='nav'&&node.props['aria-label']==='设置页面');
 assert.equal(React.Children.count(primary().props.children[0]),12);
 input().props.onChange({target:{value:'GPU'}});h.render();
 assert.equal(React.Children.count(primary().props.children[0]),1);
 h.node(node=>node.type==='button'&&node.props.children?.[1]?.props?.children==='语音环境与诊断').props.onClick();
 assert.deepEqual(h.navigations,['voice-advanced']);h.render('voice-advanced');
 assert.equal(input().props.value,'');
 assert.ok(h.events.some(event=>event[0]==='focus'&&event[1]==='settings-page-title'&&event[2].preventScroll===true));
 assert.ok(h.events.some(event=>event[0]==='scroll'&&event[1]==='settings-body'&&event[2]===0&&event[3]===0));
 h.node(node=>node.props.className==='text-link settings-parent').props.onClick();assert.equal(h.navigations.at(-1),'advanced');
 input().props.onChange({target:{value:'不存在的页面'}});h.render();
 assert.ok(h.node(node=>node.props.role==='status'));
 h.node(node=>node.props['aria-label']==='清除设置搜索').props.onClick();h.render();assert.equal(input().props.value,'');
 assert.equal(h.events.at(-1)[1],'搜索设置');
 h.node(node=>node.type==='button'&&node.props['aria-label']==='返回对话').props.onClick();assert.equal(h.backs,1);
});

test('settings CSS parses strictly and includes bounded layouts for every new shell control',async()=>{
 const {createRequire}=require('node:module'),requireFromVite=createRequire(require.resolve('vite'));
 const {transform}=requireFromVite('lightningcss');
 for(const file of ['src/style.css','src/ui/CompanionSettings.css','src/ui/CharacterSettings.css','src/ui/api-management.css','src/ui/api-settings.css']){
  const code=await fs.readFile(path.join(__dirname,'..',file));
  assert.doesNotThrow(()=>transform({filename:file,code,errorRecovery:false}),file);
 }
 const css=await fs.readFile(path.join(__dirname,'../src/style.css'),'utf8');
 for(const name of ['settings-heading','settings-subnav','settings-name-row','settings-help','settings-inline-setup','settings-related-links'])assert.ok(css.includes(`.${name}`),name);
 assert.match(css,/--settings-width:840px/);assert.match(css,/@container\(max-width:580px\)/);assert.match(css,/forced-colors:active/);
 assert.match(css,/\.settings\{[^}]*background:color-mix\(in srgb,var\(--surface\) 72%,transparent\);backdrop-filter:blur\(16px\)/);
 assert.match(css,/@media\(prefers-reduced-transparency:reduce\)\{\.settings,\.settings-nav,\.settings-main>header\{background:var\(--surface\);backdrop-filter:none\}\}/);
 assert.match(css,/\.settings-resource-notice\{/);
 assert.doesNotMatch(css,/\.main\{[^}]*transition:grid-template-columns/,'grid columns must commit before paired FLIP measurement');
 assert.match(css,/\.app:not\(\.reduce\) \.main \.chat,[^{]+\{filter:blur\(0px\);transition:filter \.5s/,'background gradually clears after release');
 assert.match(css,/:has\(\.character-panel\.is-dragging\)[^{]*\{filter:blur\(3px\);transition-duration:\.32s/,'drag defocus has its own gradual transition, independent of paired FLIP');
 assert.match(css,/@media\(prefers-reduced-motion:reduce\),\(prefers-reduced-transparency:reduce\),\(forced-colors:active\)\{[^}]+filter:none!important/);
 assert.match(css,/\.character-drag-handle\{[^}]*-webkit-app-region:no-drag/);
});
