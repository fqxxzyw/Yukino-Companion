'use strict';
// Isolated, explicitly requested Windows CPU verification. It downloads the
// pinned app resources into the runner's temporary directory, then invokes the
// real production services. It never publishes the downloaded models.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {RuntimeManager}=require('../electron/runtime-manager.cjs');
const {ResourcePacks}=require('../electron/resource-packs.cjs');
const {TranslationService}=require('../electron/translation.cjs');
const {VoiceResources}=require('../electron/voice-resources.cjs');
const catalog=require('../resources/voice-models.json');
const preset=require('../resources/voice-presets/yukino-default.json');
const root=path.resolve(__dirname,'..');

async function run(){
 if(process.platform!=='win32')throw Error('This check requires the Windows CPU runtime.');
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-real-offline-'));
 const voiceRoot=path.join(work,'voice'),runtimeCatalog=path.join(root,'build/base-resource-catalog/runtime-catalog.json');
 const runtime=new RuntimeManager({dataRoot:work,resourceRoot:path.join(root,'build/base-resource-catalog'),catalogPath:runtimeCatalog});
 const packs=new ResourcePacks({dataRoot:work});
 const translation=new TranslationService({script:path.join(root,'translation/worker.py'),stateDir:path.join(work,'translation')});
 const voice=new VoiceResources({root:voiceRoot,catalog});
 const tasks=[['runtime',()=>runtime.install('cpu')],['chat',()=>packs.install('chat')],['translation',()=>translation.install()],['voice-core',()=>voice.install('core')],['voice-preset',()=>voice.install(preset.packId)]];
 const results=await Promise.allSettled(tasks.map(async([name,job])=>{console.log(`Preparing ${name}`);const result=await job();console.log(`Prepared ${name}`);return result;}));
 const errors=results.flatMap((result,i)=>result.status==='rejected'?[`${tasks[i][0]}: ${result.reason?.message||result.reason}`]:[]);
 if(errors.length)throw Error('Resource preparation did not complete: '+errors.join('; '));
 const [runtimeStatus,chat,translated]=results.map(result=>result.value);
 const reference=preset.reference,referenceTarget=path.join(voiceRoot,reference.path);
 await fs.mkdir(path.dirname(referenceTarget),{recursive:true});
 await fs.copyFile(path.join(root,'resources/voice-presets',reference.sourcePath),referenceTarget);
 const files=catalog.packs[preset.packId].files.map(file=>file.extract?{kind:'sovits',path:file.extract.path,bytes:file.extract.bytes,sha256:file.extract.digest}:{kind:'gpt',path:file.path,bytes:file.bytes,sha256:file.digest});
 files.push({kind:'reference',path:reference.path,bytes:reference.bytes,sha256:reference.sha256});
 const {reference:_reference,...metadata}=preset;
 await fs.writeFile(path.join(voiceRoot,'preset.json'),JSON.stringify({...metadata,files},null,2));
 const chatPack=packs.pack('chat'),archive=path.join(packs.root,'downloads',`chat-${chatPack.sha256.slice(0,16)}.zip`);
 const output=path.join(root,'build/offline-qa/evidence');await fs.mkdir(path.dirname(output),{recursive:true});
 const args=[path.join(root,'scripts/verify-offline-chain.cjs'),'--python',runtimeStatus.python,'--model',chat.root,'--model-archive',archive,'--translation',translated.modelDir,'--engine',path.join(runtimeStatus.root,'inference-engine'),'--voice',voiceRoot,'--core',voiceRoot,'--ffmpeg',runtimeStatus.ffmpeg,'--output',output,'--device','cpu','--max-tokens','32','--prewarm-voice','true'];
 console.log('Starting real local generation, translation and trained-voice synthesis.');
 const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',shell:false,windowsHide:true});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(value,signal)=>signal?reject(Error('Verification process stopped: '+signal)):resolve(value));});
 translation.dispose();
 if(code!==0)throw Error(`Real offline chain failed with exit code ${code}; inspect its report.`);
 console.log('Real offline generation, translation and synthesis completed. Device playback and motion still need separate verification.');
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
