export const API_TASKS=Object.freeze([['chat','文字对话'],['proactive','主动消息'],['vision','屏幕与摄像头理解'],['asr','语音识别'],['translation','日语翻译'],['tts','语音输出']]);
export function managementFrom(state={}){
 const saved=state.apiManagement||{},configs=[...(saved.configs||[])].map(item=>({...item}));
 for(const profile of state.profiles||[]){const existing=configs.find(item=>item.id===profile.id),capabilities=new Set(existing?.capabilities||['chat','proactive','translation']);if(profile.visionEnabled===true)capabilities.add('vision');if(profile.visionEnabled===false)capabilities.delete('vision');const item={...existing,...profile,credentialId:existing?.credentialId||profile.id,protocol:existing?.protocol||'openai-chat',capabilities:[...capabilities]};if(existing)Object.assign(existing,item);else configs.push(item);}
 const defaultRoute=task=>['asr','vision'].includes(task)?'unassigned':task==='tts'||(['chat','proactive'].includes(task)&&state.chatMode==='local')||(task==='translation'&&state.translationMode==='local')?'builtin-local':'inherit';
 return {...saved,version:1,configs,defaultConfigId:saved.defaultConfigId||state.activeProfile||configs[0]?.id||'',taskRoutes:{...Object.fromEntries(API_TASKS.map(([id])=>[id,defaultRoute(id)])),...saved.taskRoutes}};
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
