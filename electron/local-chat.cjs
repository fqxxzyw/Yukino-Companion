const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkerClient } = require('./speech.cjs');
const DEFAULTS = Object.freeze({python:'',modelDir:'',device:'auto',cpuThreads:4,cpuFallback:true,contextTokens:8192,maxNewTokens:256,temperature:0.65,timeout:300});
function validateConfig(input={}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw Error('无效的本地模型设置');
  const config={...DEFAULTS};
  for(const key of Object.keys(DEFAULTS)) if(input[key]!==undefined){if(typeof input[key]!==typeof DEFAULTS[key])throw Error(`无效的本地模型设置：${key}`);config[key]=input[key];}
  for(const key of ['python','modelDir'])if(config[key]&&(!path.isAbsolute(config[key])||config[key].includes('\0')||config[key].length>4096))throw Error('请选择本地模型或 Python 的绝对路径');
  if(!['auto','cpu','cuda'].includes(config.device))throw Error('无效的本地对话设备');
  for(const [key,min,max,integer] of [['cpuThreads',1,32,true],['contextTokens',2048,16384,true],['maxNewTokens',32,1024,true],['temperature',0,1.5,false],['timeout',30,900,false]])if(!Number.isFinite(config[key])||config[key]<min||config[key]>max||(integer&&!Number.isInteger(config[key])))throw Error(`本地模型 ${key} 超出范围`);
  return config;
}
function abortError(){const error=Error('本地回复已停止');error.name='AbortError';return error;}
function localError(error){if(error.name==='AbortError')return error;return Error(String(error.message||error).replaceAll('语音','本地对话'));}
function validateMessages(messages){
  if(!Array.isArray(messages)||!messages.length||messages.length>81)throw Error('本地对话消息无效');
  let total=0;
  const result=messages.map((row,index)=>{if(!row||!['system','user','assistant'].includes(row.role)||typeof row.content!=='string'||!row.content.trim()||(row.role==='system'&&index!==0))throw Error('本地对话消息格式无效');total+=row.content.length;return{role:row.role,content:row.content};});
  if(total>60000||result.at(-1).role!=='user')throw Error('本地对话上下文过长或缺少用户问题');
  return result;
}
class LocalChatService {
  constructor({script,stateDir,modelDir='',python='',notify=()=>{},workerFactory=options=>new WorkerClient(options)}){
    Object.assign(this,{script,stateDir,notify,workerFactory});this.config=validateConfig({modelDir,python});this.worker=null;this.loadedConfig='';this.metadata=null;this.phase='unloaded';this.error=null;this.queue=Promise.resolve();this.pending=new Map();this.active=null;this.disposed=false;this.probes=new Set();
  }
  update(phase,extra={}){this.phase=phase;this.error=extra.error||null;this.notify({phase,...extra,metadata:this.metadata,ready:Boolean(this.worker&&!this.worker.closed&&this.loadedConfig)});}
  configure(input){const config=validateConfig({...this.config,...input});if(JSON.stringify(config)!==JSON.stringify(this.config)){this.unload();this.config=config;}return{...this.config};}
  async status(){
    let runtimeAvailable=false,modelInstalled=false,manifest=null;
    try{await fs.access(this.config.python);await fs.access(this.script);runtimeAvailable=true;}catch{}
    try{manifest=JSON.parse(await fs.readFile(path.join(this.config.modelDir,'manifest.json'),'utf8'));if(typeof manifest.file!=='string'||path.basename(manifest.file)!==manifest.file||!manifest.file.endsWith('.gguf')||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('模型清单无效');const stat=await fs.stat(path.join(this.config.modelDir,manifest.file));modelInstalled=stat.isFile()&&stat.size===manifest.bytes;}catch{}
    const available=runtimeAvailable&&modelInstalled,ready=available&&Boolean(this.worker&&!this.worker.closed&&this.loadedConfig);
    return{phase:this.phase,modelInstalled,runtimeAvailable,available,ready,model:manifest?.name||'雪乃本地角色模型',config:{...this.config},metadata:this.metadata,error:this.error,device:this.metadata?.device||this.config.device,training:manifest?.training||null,offline:true};
  }
  async makeWorker(config){if(!config.python)throw Error('请先在首次配置中安装本地推理运行环境');await fs.access(config.python);await fs.access(this.script);await fs.mkdir(this.stateDir,{recursive:true});return this.workerFactory({python:config.python,script:this.script,cwd:this.stateDir});}
  async probe(){if(this.disposed)throw Error('本地模型服务已关闭');const worker=await this.makeWorker(this.config);this.probes.add(worker);try{return await worker.request('probe',{},60000);}catch(error){throw localError(error);}finally{worker.close();this.probes.delete(worker);}}
  async ensureLoaded(config,token){
    if(token.cancelled||this.disposed)throw abortError();const key=JSON.stringify(config);
    if(this.worker&&!this.worker.closed&&this.loadedConfig===key)return;
    this.worker?.close();this.worker=null;this.loadedConfig='';this.metadata=null;this.update('loading');
    const worker=await this.makeWorker(config);if(token.cancelled||this.disposed){worker.close();throw abortError();}this.worker=worker;
    try{const metadata=await worker.request('load',{config},config.timeout*1000);if(token.cancelled||this.disposed)throw abortError();this.metadata=metadata;this.loadedConfig=key;this.update('ready');}catch(error){worker.close();if(this.worker===worker)this.worker=null;throw localError(error);}
  }
  enqueue(id,callback,signal){
    if(this.disposed)return Promise.reject(Error('本地模型服务已关闭'));if(signal?.aborted)return Promise.reject(abortError());if(this.pending.has(id))return Promise.reject(Error('本地对话请求编号重复'));if(this.pending.size>=4)return Promise.reject(Error('本地模型正在处理其它请求，请稍后再试'));
    const token={id,cancelled:false};this.pending.set(id,token);const onAbort=()=>this.cancel(id);signal?.addEventListener('abort',onAbort,{once:true});
    const execute=async()=>{if(token.cancelled)throw abortError();this.active=token;try{return await callback(token);}catch(error){if(token.cancelled)throw abortError();this.worker?.close();this.worker=null;this.loadedConfig='';this.update('error',{error:localError(error).message});throw localError(error);}finally{if(this.active===token)this.active=null;}};
    const task=this.queue.then(execute);this.queue=task.catch(()=>{});return task.finally(()=>{this.pending.delete(id);signal?.removeEventListener('abort',onAbort);});
  }
  load(input){const config=input?this.configure(input):{...this.config};return this.enqueue('load',async token=>{await this.ensureLoaded(config,token);return this.status();});}
  generate(messages,{requestId,signal,onChunk=()=>{},config:overrides}={}){
    let normalized,config;try{normalized=validateMessages(messages);config=validateConfig({...this.config,...overrides});if(typeof requestId!=='string'||!requestId||requestId.length>200)throw Error('本地对话请求编号无效');}catch(error){return Promise.reject(error);}
    return this.enqueue(requestId,async token=>{await this.ensureLoaded(config,token);if(token.cancelled)throw abortError();this.update('generating');const result=await this.worker.request('generate',{messages:normalized},config.timeout*1000);if(token.cancelled)throw abortError();if(!result||typeof result.text!=='string'||!result.text.trim()||result.text.length>20000)throw Error('本地模型未返回有效正文');this.metadata={...this.metadata,device:result.device,offloadedLayers:result.offloadedLayers};onChunk(result.text);this.update('ready');return result;},signal);
  }
  cancel(requestId){for(const [id,token] of this.pending)if(!requestId||id===requestId)token.cancelled=true;if(!requestId||this.active?.id===requestId){this.worker?.close(abortError());this.worker=null;this.loadedConfig='';this.metadata=null;this.update('unloaded');}}
  unload(){this.cancel();return this.status();}
  dispose(){this.disposed=true;this.cancel();for(const probe of this.probes)probe.close();this.probes.clear();}
}
module.exports={DEFAULTS,validateConfig,validateMessages,LocalChatService};
