'use strict';
// Explicit, diagnostic-only use of existing resources. Never imports selections
// into the app or marks a different installation as deployed. No network calls.
const fs=require('node:fs/promises'),{createReadStream}=require('node:fs');
const path=require('node:path'),{createHash}=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {SpeechService,WorkerClient}=require('../electron/speech.cjs');
const {TranslationService}=require('../electron/translation.cjs');
const {LocalChatService}=require('../electron/local-chat.cjs');
const run=promisify(execFile),repo=path.resolve(__dirname,'..');
function argument(name){const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];}
async function config(name){const file=argument(name);return file?JSON.parse(await fs.readFile(path.resolve(file),'utf8')):null;}
async function hash(file){const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');}
async function main(){
 const speechConfig=await config('--speech-config'),translationConfig=await config('--translation-config'),chatConfig=await config('--chat-config');
 if(!speechConfig&&!translationConfig&&!chatConfig)throw Error('Pass explicit --speech-config / --translation-config / --chat-config. No automatic profile search is performed.');
 const parent=path.join(repo,'build');await fs.mkdir(parent,{recursive:true});
 const root=await fs.mkdtemp(path.join(parent,'backend-verification-'));
 const report={started:new Date().toISOString(),diagnosticOnly:true,installationConfigured:false,root,results:{}};
 const clients=[];
 const workerFactory=options=>{const client=new WorkerClient({...options,spawnImpl:(exe,args,opts)=>spawn(exe,['-B',...args],opts)});clients.push(client);return client;};
 const state=async name=>{const dir=path.join(root,name);await fs.mkdir(dir);return dir;};
 async function close(service){service.dispose();await Promise.all(clients.splice(0).map(client=>client.child.exitCode!==null||client.child.signalCode!==null?null:new Promise(resolve=>client.child.once('exit',resolve))));}
 async function step(name,action){const start=Date.now();console.log(name+': started');try{report.results[name]={passed:true,...await action(),elapsedMs:Date.now()-start};}catch(error){report.results[name]={passed:false,error:String(error.message).slice(0,2500),elapsedMs:Date.now()-start};process.exitCode=1;}await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({step:name,...report.results[name]}));}
 if(speechConfig)await step('speech',async()=>{
  const catalog=require('../resources/voice-models.json'),entries=Object.values(catalog.packs).flatMap(pack=>pack.files||[]);
  const files=[speechConfig.gpt,speechConfig.sovits,path.join(speechConfig.bert,'pytorch_model.bin'),path.join(speechConfig.hubert,'pytorch_model.bin')];
  for(const file of files){const expected=entries.find(item=>item.algorithm==='sha256'&&path.basename(item.path)===path.basename(file)&&(item.path.includes('hubert')===file.includes('hubert'))&&(item.path.includes('roberta')===file.includes('roberta')));if(!expected)throw Error('No pinned model identity for '+path.basename(file));if((await fs.stat(file)).size!==expected.bytes||await hash(file)!==expected.digest)throw Error('Pinned model mismatch: '+path.basename(file));}
  const reference=require('../resources/voice-presets/yukino-default.json').reference;
  if((await fs.stat(speechConfig.reference)).size!==reference.bytes||await hash(speechConfig.reference)!==reference.sha256)throw Error('Default reference identity differs; select/verify a custom reference explicitly.');
  const ffmpeg=(await run(speechConfig.ffmpeg,['-version'],{timeout:15000,windowsHide:true,maxBuffer:1024*1024})).stdout.split(/\r?\n/)[0];
  const stateDir=await state('speech-state'),engine=path.join(root,'engine-snapshot');
  await fs.cp(speechConfig.root,engine,{recursive:true,errorOnExist:true,force:false,filter:async source=>{if((await fs.lstat(source)).isSymbolicLink())throw Error('Engine contains a link');return true;}});
  const service=new SpeechService({script:path.join(repo,'inference/worker.py'),stateDir,workerFactory});
  try{
   const cfg={...speechConfig,root:engine,timeout:300};
   const readiness=await service.readiness(cfg);if(!readiness.configured)throw Error(readiness.message);
   const probe=await service.probe(cfg);console.log(JSON.stringify({step:'speech-probe',...probe}));
   const loaded=await service.load(cfg);service.begin('machine-verification');
   const started=Date.now(),audio=await service.synthesize('machine-verification','こんにちは。');
   await fs.writeFile(path.join(root,'speech-single.wav'),audio);
   const singleMs=Date.now()-started,batchStarted=Date.now();
   const batch=await service.synthesizeBatch('machine-verification',['今日はいい天気ですね。','少しお話ししましょう。']);
   await fs.writeFile(path.join(root,'speech-batch.wav'),batch);
   const batchMs=Date.now()-batchStarted;
   return {verifiedModelFiles:files.length,verifiedReference:true,ffmpeg,probe,loadMetadata:loaded.metadata,single:{bytes:audio.length,elapsedMs:singleMs},batch:{bytes:batch.length,elapsedMs:batchMs,metadata:service.status.metadata},playbackVerified:false};
  }finally{await close(service);}
 });
 if(translationConfig)await step('translation',async()=>{
  const stateDir=await state('translation-state'),service=new TranslationService({script:path.join(repo,'translation/worker.py'),stateDir,workerFactory});
  try{service.configure({...translationConfig,timeout:300});const result=await service.translate({text:'你好，今天可以一起聊聊天吗？',requestId:'machine-translation'});return {result,metadata:service.metadata};}finally{await close(service);}
 });
 if(chatConfig)await step('local-chat',async()=>{
  const stateDir=await state('chat-state'),service=new LocalChatService({script:path.join(repo,'model-service/desktop_worker.py'),stateDir,workerFactory});
  try{service.configure({...chatConfig,contextTokens:2048,maxNewTokens:32,timeout:300});const result=await service.generate([{role:'user',content:'你好，请只用一句简短的中文向我打招呼。'}],{requestId:'machine-chat'});return {result,metadata:service.metadata};}finally{await close(service);}
 });
 console.log('Diagnostic evidence: '+path.join(root,'verification.json'));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
