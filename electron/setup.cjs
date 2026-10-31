// One shared installer, with checks scoped to the currently selected features.
const FEATURES=['chat','translation','voice','pet'];
function selectedFeatures(features,{allowEmpty=true}={}) {
  if(!Array.isArray(features)||(!allowEmpty&&!features.length)||features.some(id=>!FEATURES.includes(id)))throw Error('请选择要准备的本地功能。');
  return [...new Set(features)];
}
function stepSelected(id,features){
  if(!features)return true;
  if(id==='runtime')return features.some(feature=>feature!=='pet');
  return features.includes({voiceCore:'voice',voicePreset:'voice'}[id]||id);
}
class SetupService {
  constructor({prepare=async()=>{},inspect,installRuntime,refresh,installChat,installPet,installVoicePreset,installTranslation,installVoice,saveVoice,notify=()=>{}}){Object.assign(this,{prepare,inspect,installRuntime,refresh,installChat,installPet,installVoicePreset,installTranslation,installVoice,saveVoice,notify});this.phase='idle';this.active=null;this.activeSteps=new Set();this.progressByStep=new Map();this.progress=null;this.error=null;this.controller=null;this.features=null;this.scheduled=false;this.dirty=false;this.failedStep=null;this.revision=0;this.requestId=0;}
  async status(options={}){
    // The settings notice inspects everything without changing the wizard's
    // selection (including API-only), errors, or any in-flight deployment.
    const all=options?.scope==='all';
    if(!all&&options?.features!==undefined&&!this.controller){
      const features=selectedFeatures(options.features);
      if(JSON.stringify(features)!==JSON.stringify(this.features)){this.features=features;this.revision++;this.phase='idle';this.error=null;this.failedStep=null;}
    }
    const revision=this.revision,requestId=++this.requestId,selected=all?null:this.features&&[...this.features];
    const status=await this.inspect({features:selected});
    // A pre-install/pre-selection disk check must not overwrite a later completed
    // download. During installation the current live progress takes precedence.
    if(revision!==this.revision&&!this.controller)return this.status(all?{scope:'all'}:{});
    const steps=status.steps.map(step=>{
      if(!all&&!stepSelected(step.id,this.features))return {...step,state:'skipped'};
      if(this.failedStep===step.id&&this.phase==='error')return {...step,state:'error',error:this.error,detail:this.error};
      if((this.activeSteps.has(step.id)||this.active===step.id)&&this.controller&&this.phase==='installing'){
        const current=this.progressByStep.get(step.id)||(this.active===step.id?this.progress:null),progress=current?.progress||current;
        return {...step,state:current?.phase||'installing',progress,bytes:progress?.received??progress?.bytes??0,total:progress?.total||0};
      }
      return step;
    });
    return {...status,steps,features:all?[...FEATURES]:this.features,scope:all?'all':'selected',revision:this.revision,requestId,phase:this.phase,error:this.error,progress:this.progress,ready:steps.every(step=>step.state==='ready'||(!all&&step.state==='skipped'))};
  }
  changed(){
    this.revision++;this.dirty=true;if(this.scheduled)return;this.scheduled=true;
    queueMicrotask(async()=>{
      try{do{this.dirty=false;const status=await this.status();if(!this.dirty)this.notify(status);}while(this.dirty);}
      catch{/* Startup diagnostics are reported by their owning service. */}
      finally{this.scheduled=false;if(this.dirty)this.changed();}
    });
  }
  report(id,progress){if(this.controller&&(this.activeSteps.has(id)||this.active===id)){this.progressByStep.set(id,progress);this.progress=progress;this.changed();}}
  async install({runtimeFlavor='auto',features=['chat','translation','voice']}={}){
    if(this.controller)throw Error('首次配置正在进行，请稍候或先取消。');
    features=selectedFeatures(features,{allowEmpty:false});
    const controller=new AbortController();this.controller=controller;this.features=features;this.phase='installing';this.error=null;this.failedStep=null;this.changed();
    let firstFailure=null;
    const step=async(id,fn)=>{
      controller.signal.throwIfAborted();this.activeSteps.add(id);this.active=id;this.progressByStep.delete(id);this.changed();
      try{const result=await fn(controller.signal);controller.signal.throwIfAborted();return result;}
      // A failed feature must not cancel independent resources, especially a
      // shared download that was started from another settings page.
      catch(error){if(!controller.signal.aborted&&!firstFailure){firstFailure=error;this.failedStep=id;}throw error;}
      finally{this.activeSteps.delete(id);this.progressByStep.delete(id);if(this.active===id)this.active=[...this.activeSteps].at(-1)||null;this.changed();}
    };
    const inspect=()=>this.inspect({features});
    try{
      await this.prepare();controller.signal.throwIfAborted();
      const runtimeTask=features.some(id=>id!=='pet')?step('runtime',async signal=>{await this.installRuntime(runtimeFlavor,{signal});signal.throwIfAborted();await this.refresh(signal);}):Promise.resolve();
      const tasks=[runtimeTask];
      if(features.includes('chat'))tasks.push(step('chat',async signal=>{if(this.installChat)await this.installChat(signal);await runtimeTask;signal.throwIfAborted();const state=await inspect();if(state.steps.find(x=>x.id==='chat')?.state!=='ready')throw Error('本地角色模型尚未准备好，请重试下载或打开帮助。');}));
      if(features.includes('translation'))tasks.push(step('translation',this.installTranslation));
      if(features.includes('pet'))tasks.push(step('pet',signal=>this.installPet(signal)));
      if(features.includes('voice')){
        tasks.push(step('voiceCore',async signal=>{const paths=await this.installVoice(signal);signal.throwIfAborted();return this.saveVoice(paths);}));
        tasks.push(step('voicePreset',async signal=>{if(this.installVoicePreset)await this.installVoicePreset(signal);const state=await inspect();if(state.steps.find(x=>x.id==='voicePreset')?.state!=='ready')throw Error('默认音色或参考音频不完整，请在声音设置中检查选择。');}));
      }
      await Promise.allSettled(tasks);if(firstFailure)throw firstFailure;controller.signal.throwIfAborted();
      // Install callbacks are not proof of completed resources. Inspect the final
      // selected set after all writes/refreshes; a no-op or partial installer
      // must not produce a green completion banner.
      const final=await inspect();controller.signal.throwIfAborted();
      const incomplete=final.steps.filter(item=>stepSelected(item.id,features)&&item.state!=='ready');
      if(incomplete.length){this.failedStep=incomplete[0].id;throw Error('资源准备未完成：'+incomplete.map(item=>item.label||item.id).join('、')+'。请检查实际保存位置和错误日志后重试。');}
      this.phase='ready';this.revision++;return await this.status();
    }catch(error){if(!this.failedStep)this.failedStep=this.active;const cancelled=controller.signal.aborted&&!firstFailure;this.phase=cancelled?'cancelled':'error';this.error=cancelled?'已取消准备，已完成的资源会保留。':error.code==='ENOENT'?'所选功能的资源尚未安装，请重新准备该功能或检查设置中的文件位置。':error.message;throw Error(this.error);}
    finally{this.active=null;this.activeSteps.clear();this.progressByStep.clear();this.progress=null;if(this.controller===controller)this.controller=null;this.changed();}
  }
  cancel(){this.controller?.abort();}
}
module.exports={SetupService,selectedFeatures,stepSelected};
