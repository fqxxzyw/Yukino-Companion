export const VOICE_CHAT_WIZARD_VERSION=1;
export const VOICE_CHAT_STEPS=Object.freeze([
 {id:'welcome',title:'让雪乃听见你的声音'},
 {id:'asr',title:'连接语音识别服务'},
 {id:'microphone',title:'试着说一句话'},
 {id:'chat',title:'选择雪乃的聊天模型'},
 {id:'voice',title:'准备雪乃的声音'},
 {id:'audition',title:'听听雪乃的声音吧'},
 {id:'chain',title:'现在，和雪乃说句话吧'},
 {id:'summary',title:'配置结果'}
]);
const EVIDENCE=['asr','audition','chain'];
const STATUSES=['not-configured','in-progress','skipped','completed'];
const bounded=value=>typeof value==='string'?value.slice(0,8192):'';
export function normalizeVoiceChatWizard(input={}){
 const evidence={};for(const name of EVIDENCE){const value=input?.evidence?.[name];if(value?.verified===true&&typeof value.signature==='string'&&value.signature.length&&value.signature.length<=8192&&Number.isFinite(value.verifiedAt))evidence[name]={verified:true,signature:value.signature,verifiedAt:value.verifiedAt,...(/^(?:cpu|cuda(?::\d+)?)$/.test(value.device||'')?{device:value.device}:{})};}
 return {version:VOICE_CHAT_WIZARD_VERSION,status:STATUSES.includes(input?.status)?input.status:'not-configured',step:Number.isInteger(input?.step)?Math.max(0,Math.min(VOICE_CHAT_STEPS.length-1,input.step)):0,evidence,asrConfigId:bounded(input?.asrConfigId).slice(0,200),chatConfigId:bounded(input?.chatConfigId).slice(0,200),inputMode:['click','hold','continuous'].includes(input?.inputMode)?input.inputMode:'click'};
}
export function validWizardEvidence(value,signature){return Boolean(signature&&value?.verified===true&&value.signature===signature);}
export function wizardEvidenceSummary(input,signature){const value=normalizeVoiceChatWizard(input),result=Object.fromEntries(EVIDENCE.map(name=>[name,validWizardEvidence(value.evidence[name],signature)]));return {...result,complete:result.asr&&result.audition&&result.chain};}
export function reconcileVoiceChatWizard(input,signature){const value=normalizeVoiceChatWizard(input),summary=wizardEvidenceSummary(value,signature);if(value.status==='completed'&&!summary.complete)value.status='in-progress';return value;}
export function recordWizardEvidence(input,name,signature,now=Date.now(),details={}){
 if(!EVIDENCE.includes(name)||typeof signature!=='string'||!signature||signature.length>8192||!Number.isFinite(now))throw Error('尚未取得当前配置的验证标识。');
 const value=normalizeVoiceChatWizard(input);return normalizeVoiceChatWizard({...value,status:'in-progress',evidence:{...value.evidence,[name]:{verified:true,signature,verifiedAt:now,device:details.device}}});
}
const passed=value=>value===true||['pass','passed','success','completed'].includes(value)||value?.passed===true||['pass','passed','success','completed'].includes(value?.status);
export function actualChainStages(result,{asrFinal=false}={}){const stages={microphone:asrFinal===true,asr:asrFinal===true};for(const name of ['chat','translation','synthesis','playback'])stages[name]=passed(result?.stages?.[name]);return {...stages,complete:asrFinal===true&&result?.completed===true&&['chat','translation','synthesis','playback'].every(name=>stages[name])};}
export function finishVoiceChatWizard(input,signature){const value=reconcileVoiceChatWizard(input,signature);return {...value,step:VOICE_CHAT_STEPS.length-1,status:wizardEvidenceSummary(value,signature).complete?'completed':'in-progress'};}
