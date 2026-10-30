'use strict';
const {apiServiceCatalog,normalizeApiManagement,configFingerprint,validationSnapshot,recordValidation,encryptCredentialRecord,decryptCredentialRecord,duplicateConfiguration,deleteConfiguration,unusedCredentialIds}=require('./api-management.cjs');
const {createHash}=require('node:crypto');

// Credentials and validation evidence are owned by the main process. Ordinary
// React state contains configuration references only, never secrets or proofs.
class ApiServiceManager{
 constructor({read,update,safeStorage,assertSecure,validate=async()=>({status:'unsupported',message:'此协议尚未实现验证。'})}){Object.assign(this,{read,update,safeStorage,assertSecure,validate});}
 async state(){return this.read('state.json',{});}
 async find(id){const state=await this.state(),management=normalizeApiManagement(state.apiManagement,state),config=management.configs.find(item=>item.id===id);if(!config)throw Error('请先保存此 API 配置。');return {state,management,config};}
 async credentials(config){const keys=await this.read('keys.json',{});return decryptCredentialRecord(this.safeStorage,config,keys[config.credentialId]);}
 async saveCredentials(id,values){
  const {config,management}=await this.find(id);this.assertSecure();
  if(!values||!Object.values(values).some(value=>typeof value==='string'&&value.trim()))throw Error('请填写需要保存的凭据。');
  let previous={};try{previous=await this.credentials(config);}catch{}
  const merged={...previous,...Object.fromEntries(Object.entries(values).filter(([,value])=>typeof value==='string'&&value.trim()))};
  const record=encryptCredentialRecord(this.safeStorage,config,merged);
  await this.update('keys.json',keys=>({...keys,[config.credentialId]:record}));
  await this.update('api-validation.json',records=>{for(const item of management.configs)if(item.credentialId===config.credentialId)delete records[item.id];return records;});
  return {saved:true,keyIds:Object.keys(await this.read('keys.json',{}))};
 }
 async evidence(){const {apiManagement,...state}=await this.state(),management=normalizeApiManagement(apiManagement,state),records=await this.read('api-validation.json',{});return Object.fromEntries(management.configs.map(config=>[config.id,validationSnapshot(config,records[config.id])]));}
 async record(id,kind,result,expectedIdentity){
  await this.update('api-validation.json',async records=>{const {config}=await this.find(id);if(!expectedIdentity||expectedIdentity!==await this.identity(config))throw Error('配置或凭据已改变，请重新测试。');return {...records,[id]:recordValidation(config,records[id],kind,result)};});
  return this.evidence();
 }
 async identity(config){const keys=await this.read('keys.json',{});return configFingerprint(config)+':'+createHash('sha256').update(JSON.stringify(keys[config.credentialId]||null)).digest('hex');}
 async check({configId,kind='connection'}={}){
  const {config}=await this.find(configId),provider=apiServiceCatalog().providers.find(item=>item.id===config.providerId);
  const identity=await this.identity(config);
  if(!['credentials','models','connection','vision','stream'].includes(kind))throw Error('未知 API 检查类型');
  if((kind==='vision'&&!config.capabilities.includes('vision'))||(kind==='stream'&&!config.capabilities.includes('asr'))){const result={status:'unsupported',code:'unsupported_model',message:'当前配置不支持这项任务，请分配兼容模型与协议。'};return {configId,kind,...result,validation:await this.record(configId,kind,result,identity)};}
  if(kind==='stream'&&provider.implementation!=='catalog-only')return {configId,kind,status:'untested',message:'需要点击麦克风测试并收到真实转写文字，才能验证实时语音。',validation:await this.evidence()};
  let result;
  if(provider.implementation==='catalog-only')result={status:'unsupported',message:'协议尚未接入；保存配置不代表服务已经可用。'};
  else if(kind==='stream')result={status:'unsupported',message:'需要点击麦克风测试并收到真实转写文字，才能验证实时语音。'};
  else{
   try{result=await this.validate({config,provider,kind,credentials:await this.credentials(config)});}
   catch(error){result={status:'failed',code:validationErrorCode(error),message:safeValidationError(error)};}
  }
  const latest=await this.find(configId);if(identity!==await this.identity(latest.config))throw Error('配置或凭据已改变，请重新测试。');
  if(result?.status==='untested')return {configId,kind,...result,validation:await this.evidence()};
  if(!result||!['passed','failed','unsupported'].includes(result.status))throw Error('验证器未返回真实检查结果');
  return {configId,kind,...result,validation:await this.record(configId,kind,result,identity)};
 }
 async duplicate(id){const {state,config}=await this.find(id),next=duplicateConfiguration(state,id),copy=next.apiManagement.configs.at(-1),keys=await this.read('keys.json',{});
  if(keys[config.credentialId]){this.assertSecure();const values=await this.credentials(config),record=encryptCredentialRecord(this.safeStorage,copy,values);await this.update('keys.json',current=>({...current,[copy.credentialId]:record}));}
  await this.update('state.json',current=>({...current,apiManagement:next.apiManagement,...(next.profiles?{profiles:next.profiles}:{})}));
  return {state:await this.state(),apiManagement:next.apiManagement,keyIds:Object.keys(await this.read('keys.json',{}))};
 }
 async remove(id){const {state}=await this.find(id),next=deleteConfiguration(state,id),unused=unusedCredentialIds(state,next);
  await this.update('state.json',current=>({...current,apiManagement:next.apiManagement,profiles:next.profiles,activeProfile:next.activeProfile}));
  await this.update('keys.json',keys=>{for(const key of unused)delete keys[key];return keys;});
  await this.update('api-validation.json',records=>{delete records[id];return records;});
  return {state:await this.state(),apiManagement:next.apiManagement,keyIds:Object.keys(await this.read('keys.json',{}))};
 }
}
function safeValidationError(error){const value=String(error?.message||'');if(/401|invalid.*key|凭据|密钥/i.test(value))return '凭据无效或与当前服务地域不匹配。';if(/403|permission|权限/i.test(value))return '账户或模型权限不足，请检查服务开通状态。';if(/429|quota|额度/i.test(value))return '额度或请求频率受限，请检查账户。';if(/model|模型/i.test(value))return '当前模型或协议不支持此任务，请检查配置。';return '连接或协议检查失败，请检查网络和服务配置。';}
function validationErrorCode(error){const message=String(error?.message||'');if(/401|invalid.*key|凭据|密钥|api.?key.*无效/i.test(message))return 'invalid_credentials';if(/403|permission|权限/i.test(message))return 'permission_denied';if(/429|quota|额度/i.test(message))return 'quota_exceeded';if(/model|模型/i.test(message))return 'unsupported_model';return 'network_error';}
module.exports={ApiServiceManager,safeValidationError,validationErrorCode};
