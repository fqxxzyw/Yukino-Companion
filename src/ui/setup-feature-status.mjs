// Only show a result for features included in the inspection that produced it.
// A resource being present does not mean inference or device playback passed.
const ids={chat:['chat'],translation:['translation'],voice:['voiceCore','voicePreset'],pet:['pet']};
export function featureStatus(feature,status={}) {
  if (!Array.isArray(status.features) || !status.features.includes(feature)) return {kind:'unknown',label:'尚未检查'};
  const required=ids[feature]||[];
  const steps=required.map(id=>(status.steps||[]).find(step=>step.id===id));
  if (!required.length || steps.some(step=>!step)) return {kind:'unknown',label:'尚未检查'};
  const states=steps.map(step=>step.state||step.phase||'pending');
  if (states.some(state=>state==='error')) return {kind:'error',label:'需要处理'};
  if (states.some(state=>['checking','installing','downloading','extracting','assembling','merging','running'].includes(state))) return {kind:'busy',label:'正在准备'};
  if (states.every(state=>['ready','complete'].includes(state))) return {kind:'ready',label:'文件已找到'};
  if (states.includes('waiting-runtime')) return {kind:'waiting',label:'等待运行环境'};
  if (states.includes('missing')) return {kind:'missing',label:'需要准备'};
  if (states.includes('cancelled')) return {kind:'waiting',label:'已取消'};
  return {kind:'unknown',label:'尚未检查'};
}
