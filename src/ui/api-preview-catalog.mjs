// UI-only provider metadata for the browser preview. It mirrors the shape the
// main process returns; nothing here performs a request or reports success.
const LOGOS={openai:'openai.png',aliyun:'aliyun.png',volcengine:'volcengine.png',tencent:'tencent.ico',deepseek:'deepseek.ico',siliconflow:'siliconflow.png',moonshot:'moonshot.ico',zhipu:'zhipu.png',google:'google.ico',azure:'azure.ico',local:'local.ico',deepgram:'deepgram.ico',elevenlabs:'elevenlabs.ico'};
const provider=(id,brand,name,capabilities,extra={})=>({
 id,brand,name,kind:extra.kind||'chat',capabilities,
 implementation:extra.implementation||'compatible-chat',
 realAdaptationStatus:extra.realAdaptationStatus||(extra.kind==='asr'?'catalog-only':'implemented-unverified'),
 protocol:extra.protocol||'chat-completions',
 base:extra.base||'',model:extra.model||'',defaultCapabilities:extra.defaultCapabilities||capabilities.filter(task=>task!=='vision'),
 description:extra.description||'',note:extra.note||'',keyOptional:Boolean(extra.keyOptional),
 websiteUrl:'https://example.com/',consoleUrl:'https://example.com/',keyUrl:'https://example.com/',docsUrl:'https://example.com/',tutorialUrl:'https://example.com/',
 fields:extra.fields||[{id:'apiKey',label:'API Key',type:'password',secret:true,required:true}],
 tutorialSteps:[{title:'注册或登录',description:'打开官方平台，使用你自己的账户登录。',linkKind:'website'},{title:'创建凭据',description:'按平台要求创建 API 凭据，只保存在本机。',linkKind:'key'},{title:'选择模型',description:'使用账户已开通、实际支持此任务的模型。',linkKind:'docs'}],
 logo:LOGOS[brand]?{status:'cached',path:'./provider-logos/'+LOGOS[brand],url:'./provider-logos/'+LOGOS[brand]}:{status:'not-applicable',url:null,path:null},
});
export function previewCatalog(){
 const chat=(id,brand,name,base,extra={})=>provider(id,brand,name,['chat','proactive','translation','vision'],{base,...extra});
 const asr=(id,brand,name,base,extra={})=>provider(id,brand,name,['asr'],{kind:'asr',base,implementation:extra.implementation||'catalog-only',...extra});
 return {version:1,tasks:[],providers:[
  chat('deepseek','deepseek','DeepSeek','https://api.deepseek.com'),
  chat('openai','openai','OpenAI','https://api.openai.com/v1'),
  chat('dashscope-cn','aliyun','通义千问 · 北京','https://dashscope.aliyuncs.com/compatible-mode/v1'),
  chat('dashscope-intl','aliyun','通义千问 · 新加坡','https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  chat('siliconflow','siliconflow','硅基流动','https://api.siliconflow.cn/v1'),
  chat('moonshot-cn','moonshot','Kimi · 国内','https://api.moonshot.cn/v1'),
  chat('moonshot-intl','moonshot','Kimi · 国际','https://api.moonshot.ai/v1'),
  chat('zhipu','zhipu','智谱 GLM','https://open.bigmodel.cn/api/paas/v4'),
  chat('hunyuan','tencent','腾讯混元','https://api.hunyuan.cloud.tencent.com/v1'),
  chat('ark','volcengine','火山方舟 · 豆包','https://ark.cn-beijing.volces.com/api/v3'),
  chat('qianfan','baidu','百度智能云千帆','https://qianfan.baidubce.com/v2'),
  chat('spark','xinghuo','讯飞星火','https://spark-api-open.xf-yun.com/v1'),
  chat('minimax','minimax','MiniMax','https://api.minimaxi.com/v1'),
  chat('stepfun','stepfun','阶跃星辰','https://api.stepfun.com/v1'),
  chat('yi','yi','零一万物','https://api.lingyiwanwu.com/v1'),
  chat('sensenova','sensenova','商汤日日新','https://api.sensenova.cn/compatible-mode/v1'),
  chat('mistral','mistral','Mistral AI','https://api.mistral.ai/v1'),
  chat('groq','groq','Groq','https://api.groq.com/openai/v1'),
  chat('together','together','Together AI','https://api.together.xyz/v1'),
  chat('openrouter','openrouter','OpenRouter','https://openrouter.ai/api/v1'),
  chat('xai','xai','xAI Grok','https://api.x.ai/v1'),
  chat('gemini','google','Google Gemini · 兼容入口','https://generativelanguage.googleapis.com/v1beta/openai/'),
  chat('azure-openai','azure','Azure OpenAI','',{note:'需要填写自己的资源终结点。'}),
  chat('ollama','local','Ollama · 本机','http://127.0.0.1:11434/v1',{keyOptional:true}),
  chat('local','local','LM Studio · 本机','http://127.0.0.1:1234/v1',{keyOptional:true}),
  chat('custom','custom','自定义兼容服务','',{keyOptional:true}),
  asr('openai-asr','openai','OpenAI · 实时识别','https://api.openai.com/v1',{model:'gpt-live-transcribe',protocol:'openai-realtime-transcription'}),
  asr('aliyun-asr','aliyun','阿里云百炼 · 实时识别','wss://dashscope.aliyuncs.com/api-ws/v1/realtime',{model:'qwen3-asr-flash-realtime',protocol:'dashscope-asr',implementation:'protocol-implemented',realAdaptationStatus:'implemented-unverified'}),
  provider('dashscope-tts','aliyun','阿里云百炼 · 语音合成',['tts'],{kind:'tts',base:'https://dashscope.aliyuncs.com/api/v1',model:'qwen3-tts-flash',protocol:'dashscope-tts',implementation:'protocol-implemented',realAdaptationStatus:'implemented-unverified'}),
  asr('volcengine-asr','volcengine','火山引擎豆包 · 实时识别','wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',{protocol:'volcengine-seedasr'}),
  asr('tencent-asr','tencent','腾讯云 · 实时识别','wss://asr.cloud.tencent.com/asr/v2',{protocol:'tencent-signed-asr'}),
  asr('deepgram-asr','deepgram','Deepgram · 实时识别','wss://api.deepgram.com/v1/listen',{protocol:'deepgram-listen'}),
  asr('elevenlabs-asr','elevenlabs','ElevenLabs · 实时识别','wss://api.elevenlabs.io/v1/speech-to-text/realtime',{model:'scribe_v2_realtime',protocol:'elevenlabs-scribe'}),
  asr('google-asr','google','Google Cloud Speech','',{protocol:'google-grpc-speech'}),
  asr('azure-asr','azure','Azure Speech','',{protocol:'azure-speech-sdk'}),
 ]};
}
