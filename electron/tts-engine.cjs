const AQUA_VERSION='0.3.0';
const AQUA_REVISION='eb8e0d59a9ca317b40d8182b04c12ba01a489f8d';
const AQUA_MODELS=new Set(['v2','v2Pro','v2ProPlus','v3']);
function enginePlan(config){
  const requestedEngine=config.engine||'auto';let reason='';
  if(!AQUA_MODELS.has(config.version))reason=`Aqua 适配器未启用 ${config.version}；使用标准 GPT-SoVITS，不转换权重。`;
  else if(config.device==='cpu')reason='Aqua 需要 NVIDIA CUDA，不提供 CPU 推理。';
  else if(!config.aquaPython)reason='尚未选择隔离的 Aqua Python 环境。';
  const engine=requestedEngine==='standard'?'standard':reason?'standard':'aqua';
  return {requestedEngine,engine,eligible:!reason,reason:requestedEngine==='standard'?'':reason,blocked:requestedEngine==='aqua'&&Boolean(reason),verified:false,expectedAquaVersion:AQUA_VERSION,revision:AQUA_REVISION};
}
module.exports={enginePlan,AQUA_VERSION,AQUA_REVISION,AQUA_MODELS};
