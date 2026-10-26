// One shared installer, with separate and truthful model/runtime states.
class SetupService {
  constructor({prepare=async()=>{},inspect,installRuntime,refresh,installChat,installPet,installVoicePreset,installTranslation,installVoice,saveVoice,notify=()=>{},cancel=()=>{}}){Object.assign(this,{prepare,inspect,installRuntime,refresh,installChat,installPet,installVoicePreset,installTranslation,installVoice,saveVoice,notify,cancelWork:cancel});this.phase='idle';this.active=null;this.progress=null;this.error=null;this.controller=null;this.features=null;this.scheduled=false;}
  async status(){const status=await this.inspect();const selected=this.features;const ids={chat:'chat',translation:'translation',voiceCore:'voice',voicePreset:'voice',pet:'pet'};const steps=status.steps.map(step=>{if(selected&&((step.id==='runtime'&&!selected.some(id=>id!=='pet'))||(ids[step.id]&&!selected.includes(ids[step.id]))))return {...step,state:'skipped'};if(this.active===step.id&&this.controller&&this.phase==='installing')return {...step,state:this.progress?.phase||'installing',progress:this.progress,bytes:this.progress?.received||this.progress?.bytes||0,total:this.progress?.total||0};return step;});return {...status,steps,phase:this.phase,error:this.error,progress:this.progress,ready:steps.every(step=>['ready','skipped'].includes(step.state))};}
  changed(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(async()=>{this.scheduled=false;try{this.notify(await this.status());}catch{/* Startup diagnostics are reported by their owning service. */}});}
  report(id,progress){if(this.controller&&this.active===id){this.progress=progress;this.changed();}}
  async install({runtimeFlavor='auto',features=['chat','translation','voice']}={}){
    if(this.controller)throw Error('首次配置正在进行，请稍候或先取消。');
    if(!Array.isArray(features)||!features.length||features.some(x=>!['chat','translation','voice','pet'].includes(x)))throw Error('请选择要准备的本地功能。');
    const controller=new AbortController();this.controller=controller;this.features=[...new Set(features)];this.phase='installing';this.error=null;
    const step=async(id,fn)=>{controller.signal.throwIfAborted();this.active=id;this.progress=null;this.changed();const result=await fn(controller.signal);controller.signal.throwIfAborted();return result;};
    try{
      await this.prepare();controller.signal.throwIfAborted();
      if(features.some(id=>id!=='pet')){await step('runtime',()=>this.installRuntime(runtimeFlavor));await this.refresh();}controller.signal.throwIfAborted();
      if(features.includes('chat'))await step('chat',async signal=>{if(this.installChat)await this.installChat(signal);const state=await this.inspect();if(state.steps.find(x=>x.id==='chat')?.state!=='ready')throw Error('本地角色模型尚未准备好，请重试下载或打开帮助。');});
      if(features.includes('translation'))await step('translation',this.installTranslation);
      if(features.includes('voice')){await step('voiceCore',async signal=>{const paths=await this.installVoice(signal);signal.throwIfAborted();return this.saveVoice(paths);});await step('voicePreset',async signal=>{if(this.installVoicePreset)await this.installVoicePreset(signal);const state=await this.inspect();if(state.steps.find(x=>x.id==='voicePreset')?.state!=='ready')throw Error('默认音色或参考音频不完整，请在声音设置中检查选择。');});}
      if(features.includes('pet'))await step('pet',signal=>this.installPet(signal));
      this.phase='ready';return await this.status();
    }catch(error){this.phase=controller.signal.aborted?'cancelled':'error';this.error=controller.signal.aborted?'已取消准备，已完成的资源会保留。':error.message;throw Error(this.error);}
    finally{this.active=null;this.progress=null;if(this.controller===controller)this.controller=null;this.changed();}
  }
  cancel(){this.controller?.abort();this.cancelWork();}
}
module.exports={SetupService};
