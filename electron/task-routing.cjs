'use strict';
const {TASKS,apiServiceCatalog,normalizeApiManagement,credentialOrigin}=require('./api-management.cjs');
const LOCAL_CAPABILITIES=['chat','proactive','translation','tts'];
function resolveTaskRoute(state,task,{requireImplemented=true}={}){
 const definition=TASKS.find(item=>item.id===task);if(!definition)throw Error('未知 API 任务');
 const management=normalizeApiManagement(state?.apiManagement,state||{}),assigned=management.taskRoutes[task],inherited=assigned==='inherit';
 if(assigned==='unassigned')throw Error(`请为${definition.name}单独选择兼容 API 配置`);
 const configId=inherited?management.defaultConfigId:assigned;
 if(configId==='builtin-local'){
  if(!LOCAL_CAPABILITIES.includes(task))throw Error(`${definition.name}尚无内置本地适配器`);
  return {kind:'local',task,configId:'builtin-local',inherited};
 }
 const config=management.configs.find(item=>item.id===configId);if(!config)throw Error(`请为${definition.name}选择 API 配置`);
 if(!config.capabilities.includes(task))throw Error(`所选配置不支持${definition.name}协议，请单独选择兼容配置`);
 const provider=apiServiceCatalog().providers.find(item=>item.id===config.providerId);
 if(requireImplemented&&provider.implementation==='catalog-only')throw Error(`${provider.name}尚未接入，不能开始${definition.name}`);
 return {kind:'api',task,configId:config.id,config:structuredClone(config),credentialId:config.credentialId,credentialOrigin:credentialOrigin(config),inherited,implementation:provider.implementation};
}
module.exports={LOCAL_CAPABILITIES,resolveTaskRoute};
