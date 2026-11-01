export const API_TASKS=Object.freeze([['chat','文字对话'],['proactive','主动消息'],['vision','屏幕与摄像头理解'],['asr','语音识别'],['translation','翻译回复'],['tts','语音输出']]);
export const TASK_LABELS=Object.freeze(Object.fromEntries(API_TASKS));
// Plain-language purposes, shown before any protocol wording.
export const CAPABILITY_PURPOSES=Object.freeze({chat:'和角色聊天',proactive:'主动发消息',asr:'把说话转成文字',tts:'让角色开口说话',translation:'翻译回复',vision:'看懂图片或画面'});
export const CAPABILITY_ORDER=Object.freeze(['chat','tts','asr','translation','vision','proactive']);
export function purposesFor(capabilities=[]){const set=new Set(capabilities);return CAPABILITY_ORDER.filter(task=>set.has(task)).map(task=>CAPABILITY_PURPOSES[task]);}
export function providerPurposes(entries=[]){return purposesFor([...new Set(entries.flatMap(entry=>entry.capabilities||[]))]);}
// Which saved configuration currently answers a task, following "inherit".
export function routeConfigId(management,task){const route=management?.taskRoutes?.[task];return route==='inherit'?management.defaultConfigId:route;}
export function assignedTasks(management,configId){if(!management||!configId)return [];return API_TASKS.filter(([task])=>routeConfigId(management,task)===configId).map(([task])=>task);}
export function assignedTaskLabels(management,configId){return assignedTasks(management,configId).map(task=>TASK_LABELS[task]).filter(Boolean);}
export function configStatusKind(validation,config){
 const record=validation?.[config?.id]||{};const kinds=Object.values(record);
 if(kinds.some(item=>item?.code||item?.status==='failed'))return 'error';
 if(kinds.some(item=>item?.status==='passed'))return 'ready';
 return 'idle';
}
export function configStatusDetail(validation,config,validationLabel){
 const record=validation?.[config?.id]||{};const failed=Object.entries(record).find(([,item])=>item?.code||item?.status==='failed');
 const passed=Object.entries(record).find(([,item])=>item?.status==='passed');
 if(failed)return failed[1].message||validationLabel(failed[1]);
 if(passed)return `已验证 ${validationLabel(passed[1])}${passed[1].checkedAt?' · '+(passed[1].checkedAt.slice(0,10)):''}`;
 return '尚未通过实际任务验证';
}
export function providerEditorKind(provider){
 const capabilities=provider?.capabilities||[];
 if(capabilities.includes('asr')&&!capabilities.includes('chat'))return '语音识别';
 if(capabilities.includes('tts')&&!capabilities.includes('chat'))return '语音合成';
 const purposes=purposesFor(capabilities);
 return purposes.length?purposes.slice(0,3).join('、'):'对话与理解';
}
export const TRANSLATION_MODES=Object.freeze([['none','不翻译'],['local','本地翻译'],['api','已配置 API 翻译']]);
export function translationModeFromRoute(route){if(route==='unassigned')return 'none';if(route==='builtin-local')return 'local';return 'api';}
export function translationRouteFor(mode){return mode==='none'?'unassigned':mode==='local'?'builtin-local':'inherit';}
export function managementFrom(state={}){
 const saved=state.apiManagement||{},configs=[...(saved.configs||[])].map(item=>({...item}));
 for(const profile of state.profiles||[]){const existing=configs.find(item=>item.id===profile.id),capabilities=new Set(existing?.capabilities||['chat','proactive','translation']);if(profile.visionEnabled===true)capabilities.add('vision');if(profile.visionEnabled===false)capabilities.delete('vision');const item={...existing,...profile,credentialId:existing?.credentialId||profile.id,protocol:existing?.protocol||'openai-chat',capabilities:[...capabilities]};if(existing)Object.assign(existing,item);else configs.push(item);}
 const defaultRoute=task=>['asr','vision'].includes(task)?'unassigned':task==='tts'||(['chat','proactive'].includes(task)&&state.chatMode==='local')||(task==='translation'&&state.translationMode==='local')?'builtin-local':'inherit';
 return {...saved,version:1,configs,defaultConfigId:saved.defaultConfigId||state.activeProfile||configs[0]?.id||'',taskRoutes:{...Object.fromEntries(API_TASKS.map(([id])=>[id,defaultRoute(id)])),...saved.taskRoutes}};
}
// Form defaults come only from the supplied main-process provider metadata.
export function providerForProfile(profile={},catalog=[]){
 const normalized=value=>String(value||'').replace(/\/$/,'').replace(/\/chat\/completions$/,'');
 return catalog.find(provider=>provider.id===profile.providerId)||catalog.find(provider=>provider.base&&normalized(profile.base)===normalized(provider.base))||(profile.base||profile.providerId?catalog.find(provider=>provider.id==='custom'):undefined);
}
export function providerConfigDefaults(provider,id){
 const fields=Object.fromEntries((provider.fields||[]).filter(field=>!secretProviderField(field)&&!['base','model'].includes(field.id)&&field.defaultValue!==undefined).map(field=>[field.id,field.defaultValue]));
 return {id,name:provider.name,providerId:provider.id,credentialId:id,protocol:provider.protocol||'openai-chat',base:provider.base||'',model:provider.model||'',capabilities:[...(provider.defaultCapabilities||provider.capabilities||['chat','proactive','translation'])],fields};
}
export function secretProviderField(field){return field.secret===true||['secret','password'].includes(field.type);}
export function providerFormFields(provider){
 const basic=field=>secretProviderField(field)||['region','appId','resourceId'].includes(field.id)||field.required&&field.defaultValue===undefined&&!['base','model'].includes(field.id);
 return {basic:(provider.fields||[]).filter(basic),advanced:(provider.fields||[]).filter(field=>!basic(field))};
}
export function preserveProfileOnProviderSwitch(profile,provider,savedKey){
 const normalized=value=>String(value||'').replace(/\/$/,'').replace(/\/chat\/completions$/,'');
 return Boolean(savedKey||profile?.model||profile?.base&&normalized(profile.base)!==normalized(provider?.base));
}
export function preferredBrandService(entries,task,need='all'){
 const requested=task||(['chinese','bilingual','latency','yukino','cloud'].includes(need)?'asr':'chat');
 return entries.find(entry=>(entry.capabilities||[]).includes(requested))||entries[0];
}
export function configSupports(config,task){const capabilities=config?.capabilities||[];return capabilities.includes(task)||(task==='proactive'&&capabilities.includes('chat'));}
export function validationLabel(value){const state=typeof value==='string'?value:value?.code||value?.state||value?.status;return ({unconfigured:'未配置',saved:'已保存',untested:'未验证',checking:'验证中',valid:'已验证可用',verified:'已验证可用',ready:'已验证可用',passed:'已验证',failed:'验证失败',invalid:'无效凭据',invalid_credentials:'无效凭据',unsupported_model:'模型不支持',unsupported:'协议未适配',protocol_unadapted:'协议未适配',permission_denied:'权限不足',quota_exceeded:'额度或频率限制',network_error:'网络失败',error:'验证失败'})[state]||'未验证';}
export function providerBrand(provider={}){if(provider.brand)return provider.brand;const id=provider.id||'';if(id.startsWith('dashscope')||id==='aliyun-asr')return 'aliyun';if(id.startsWith('volcengine')||id.startsWith('doubao'))return 'volcengine';if(id.startsWith('tencent'))return 'tencent';return id.replace(/-asr$/,'');}
export function safeProviderLogo(value){if(value&&typeof value==='object')value=value.status==='cached'?value.path:'';return typeof value==='string'&&/^\.\/provider-logos\/[a-z0-9._-]+\.(?:png|jpe?g|svg|ico|webp)$/i.test(value)?value:'';}
export function providerTaskBadges(entries=[]){
 const chat=entries.filter(entry=>(entry.capabilities||[]).includes('chat'));
 const asr=entries.filter(entry=>(entry.capabilities||[]).includes('asr'));
 const implemented=entry=>entry.implementation!=='catalog-only'&&entry.realAdaptationStatus!=='catalog-only';
 return [...(chat.length?[chat.some(implemented)?'文字协议已接入 · 账户待验证':'文字协议待接入']:[]),...(asr.length?[asr.some(implemented)?'实时 ASR 已接入 · 未验证':'实时 ASR 待接入']:[])];
}
export const API_NEEDS=Object.freeze({
 all:{label:'全部服务',note:'按服务类型分别显示适配状态；保存凭据后仍需真实任务验证。'},
 chinese:{label:'中文实时输入',note:'优先展示本版本已接入的实时识别协议。中文识别效果仍需使用所选模型实际测试。'},
 openai:{label:'希望使用 OpenAI',note:'将 OpenAI 放在前面，文字对话与实时语音识别的适配状态分别列出。'},
 bilingual:{label:'中日双语输入',note:'中文与日语支持范围以官方模型文档为准，需分别测试；这里只按协议接入状态调整顺序。'},
 latency:{label:'低延迟实时输入',note:'先选择已接入的流式服务，再用当前网络与麦克风测试延迟；此处不保证哪家最快。'},
 yukino:{label:'保留雪乃专属音色',note:'推荐云端语音识别配合本地 GPT-SoVITS 输出；云端普通 TTS 音色不会替代你的雪乃音色。'},
 cloud:{label:'减少本地计算负担',note:'这些语音识别服务将音频交给云端，无需本地加载识别模型；GPT-SoVITS 朗读仍使用本机资源。'}
});
export function orderProviderBrands(brands,providers,need='all'){
 const rank=brand=>need==='openai'?(brand==='openai'?0:1):['chinese','bilingual','cloud','latency','yukino'].includes(need)?(providers.some(entry=>providerBrand(entry)===brand&&(entry.capabilities||[]).includes('asr')&&entry.implementation!=='catalog-only'&&entry.realAdaptationStatus!=='catalog-only')?0:1):0;
 return brands.map((brand,index)=>({brand,index,rank:rank(brand)})).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(entry=>entry.brand);
}
