import brandMetadata from '../../resources/api-brands.json' with {type:'json'};

// Read-only references for browsers without IPC, not another service catalog.
// No models, credential fields, adapter claims or validation state live here.
// Public ASR documentation checked on 2026-10-31; URLs otherwise reuse branding metadata.
const references=[
 ['openai','OpenAI','https://developers.openai.com/api/docs/guides/realtime-transcription'],
 ['aliyun','阿里云百炼','https://www.alibabacloud.com/help/en/model-studio/qwen-asr-realtime-interaction-process'],
 ['volcengine','火山引擎 · 豆包'],
 ['tencent','腾讯云'],
 ['deepgram','Deepgram'],
 ['elevenlabs','ElevenLabs'],
 ['google','Google Cloud Speech'],
 ['azure','Azure Speech']
];
export const ASR_DOCUMENTATION_EXAMPLES=Object.freeze(references.map(([brand,name,docsUrl])=>Object.freeze({
 id:`${brand}-asr`,name,docsUrl:docsUrl||brandMetadata.brands[brand].docsUrl,
 consoleUrl:brandMetadata.brands[brand].consoleUrl,keyUrl:brandMetadata.brands[brand].keyUrl,
 documentationOnly:true
})));

export function asrDirectoryProviders(catalog){
 if(catalog===null)return ASR_DOCUMENTATION_EXAMPLES;
 if(!Array.isArray(catalog?.providers))throw Error('语音识别厂商目录格式无效');
 return catalog.providers.filter(provider=>provider?.kind==='asr'||provider?.capabilities?.includes('asr'));
}
export function asrAdaptationLabel(provider){
 if(provider.documentationOnly)return '仅官方文档示例 · 非可用配置';
 return provider.implementation==='protocol-implemented'?'协议已实现 · 尚未实测':'仅文档 / 待接入';
}
export function asrOfficialLinks(provider){
 return [['console','官方开通','consoleUrl'],['key','获取凭据','keyUrl'],['docs','ASR 文档','docsUrl']].flatMap(([kind,label,field])=>{
  const url=provider[field];
  try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)return [];}catch{return [];}
  return [{kind,label,url}];
 });
}
export async function openAsrOfficial(api,providerId,kind){
 if(typeof api?.apiOpenOfficial!=='function')throw Error('请在桌面版使用受信的官方页面入口。');
 if(!['console','key','docs'].includes(kind))throw Error('未知的语音识别官方入口');
 // Only identity and link kind cross IPC. The main process resolves its trusted URL.
 return api.apiOpenOfficial({providerId,kind});
}
