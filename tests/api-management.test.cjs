const test=require('node:test');
const assert=require('node:assert/strict');
const {apiServiceCatalog,normalizeConfig,normalizeApiManagement,recordValidation,validationSnapshot,encryptCredentialRecord,decryptCredentialRecord,duplicateConfiguration,deleteConfiguration,unusedCredentialIds}=require('../electron/api-management.cjs');
const {resolveTaskRoute}=require('../electron/task-routing.cjs');
const profile={id:'legacy-chat',name:'旧配置',providerId:'deepseek',base:'https://api.deepseek.com',model:'user-selected-model'};
const state=()=>({profiles:[{...profile}],activeProfile:profile.id});
const asr={id:'voice-input',name:'阿里输入',providerId:'aliyun-asr',model:'qwen3-asr-flash-realtime',fields:{region:'cn-beijing',language:'zh'}};
const storage={encryptString:value=>Buffer.from('encrypted:'+value),decryptString:value=>{const text=value.toString();assert.ok(text.startsWith('encrypted:'));return text.slice(10);}};

test('catalog has the six requested ASR providers and two extensions with truthful integration status',()=>{
 const providers=apiServiceCatalog().providers.filter(provider=>provider.kind==='asr');
 assert.deepEqual(providers.filter(provider=>!provider.extension).map(provider=>provider.id),['openai-asr','aliyun-asr','volcengine-asr','tencent-asr','deepgram-asr','elevenlabs-asr']);
 assert.deepEqual(providers.filter(provider=>provider.extension).map(provider=>provider.id),['google-asr','azure-asr']);
 for(const provider of providers){assert.equal(provider.verification,'untested');assert.notEqual(provider.status,'ready');assert.match(provider.docsUrl,/^https:\/\//);}
 assert.equal(providers.find(provider=>provider.id==='aliyun-asr').realAdaptationStatus,'implemented-unverified');
 assert.equal(providers.find(provider=>provider.id==='openai-asr').realAdaptationStatus,'catalog-only');
 const second=apiServiceCatalog();second.providers[0].name='changed';assert.notEqual(apiServiceCatalog().providers[0].name,'changed');
});

test('legacy profiles retain identities and encrypted-key references without acquiring unproven vision capability',()=>{
 const saved=state(),management=normalizeApiManagement({},saved);
 assert.equal(management.configs[0].id,profile.id);assert.equal(management.configs[0].credentialId,profile.id);
 assert.deepEqual(management.configs[0].capabilities,['chat','proactive','translation']);
 assert.equal(management.taskRoutes.asr,'unassigned');assert.equal(management.taskRoutes.vision,'unassigned');
 assert.equal(resolveTaskRoute(saved,'proactive').configId,profile.id);
 assert.throws(()=>resolveTaskRoute(saved,'vision'),/单独选择/);
 saved.profiles[0].visionEnabled=true;saved.apiManagement={taskRoutes:{vision:profile.id}};
 assert.equal(resolveTaskRoute(saved,'vision').configId,profile.id);
 assert.equal(JSON.stringify(saved.profiles[0]).includes('credentialId'),false,'migration does not mutate legacy state');
});

test('task routing rejects incompatible capabilities and catalog-only adapters and supports local default',()=>{
 const saved=state();saved.apiManagement={configs:[asr],taskRoutes:{asr:asr.id,vision:profile.id}};
 assert.equal(resolveTaskRoute(saved,'asr').config.providerId,'aliyun-asr');
 assert.throws(()=>resolveTaskRoute(saved,'vision'),/不支持/);
 saved.apiManagement.configs=[{id:'openai-voice',providerId:'openai-asr'}];saved.apiManagement.taskRoutes.asr='openai-voice';
 assert.throws(()=>resolveTaskRoute(saved,'asr'),/尚未接入/);
 assert.equal(resolveTaskRoute(saved,'asr',{requireImplemented:false}).implementation,'catalog-only');
 assert.equal(resolveTaskRoute({apiManagement:{defaultConfigId:'builtin-local'}},'chat').kind,'local');
 assert.throws(()=>resolveTaskRoute({apiManagement:{taskRoutes:{asr:'builtin-local'}}},'asr'),/尚无内置/);
});

test('credentials and unknown secret fields cannot enter ordinary configs',()=>{
 assert.throws(()=>normalizeConfig({...asr,apiKey:'sensitive'}),/密钥不能/);
 assert.throws(()=>normalizeConfig({...asr,fields:{apiKey:'sensitive'}}),/安全存储/);
 assert.throws(()=>normalizeConfig({...asr,fields:{unknownSecret:'sensitive'}}),/未知/);
 assert.throws(()=>normalizeConfig({...asr,base:'wss://user:password@dashscope.aliyuncs.com/api-ws/v1/realtime'}),/凭据/);
 assert.throws(()=>normalizeConfig({...asr,fields:{wsEndpoint:'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?api_key=secret'}}),/凭据/);
});

test('all secret fields are encrypted with an endpoint binding and no secret is returned as config state',()=>{
 const config=normalizeConfig({id:'tencent',providerId:'tencent-asr',fields:{appId:'example-app'}});
 const credentials={secretId:'example-id',secretKey:'example-key'},record=encryptCredentialRecord(storage,config,credentials);
 assert.equal(record.format,'api-fields-v1');assert.deepEqual(decryptCredentialRecord(storage,config,record),credentials);
 assert.equal(Object.hasOwn(config.fields,'secretKey'),false);assert.equal(Object.hasOwn(record,'secretKey'),false);
 assert.throws(()=>decryptCredentialRecord(storage,{...config,base:'wss://another.example/asr'},record),/地址已改变/);
 const ali=normalizeConfig(asr),legacyRecord=encryptCredentialRecord(storage,ali,{apiKey:'example-key'});
 assert.equal(legacyRecord.format,'api-key');assert.deepEqual(decryptCredentialRecord(storage,ali,legacyRecord),{apiKey:'example-key'});
});

test('model discovery, connection, vision and real audio transcription have independent stale-safe validation',()=>{
 const config=normalizeConfig(profile),now=new Date('2026-10-30T01:00:00Z');
 const models=recordValidation(config,null,'models',{status:'passed',message:'模型列表已返回'},now);
 assert.equal(validationSnapshot(config,models).models.status,'passed');assert.equal(validationSnapshot(config,models).connection.status,'untested');assert.equal(validationSnapshot(config,models).vision.status,'untested');assert.equal(validationSnapshot(config,models).stream.status,'untested');
 const connection=recordValidation(config,models,'connection',{status:'failed',message:'连接失败'},now);assert.equal(validationSnapshot(config,connection).models.status,'passed');
 assert.equal(validationSnapshot({...config,model:'changed'},connection).models.status,'untested');
 const rendered=normalizeConfig({...config,validation:{stream:{status:'passed'}}});assert.equal(Object.hasOwn(rendered,'validation'),false);
});

test('duplicate gets its own credential identity; deleting migrates routes and reports only unused credential references',()=>{
 let saved=state();saved.apiManagement={defaultConfigId:profile.id,configs:[asr],taskRoutes:{chat:profile.id,asr:asr.id}};
 const copied=duplicateConfiguration(saved,profile.id,{id:'chat-copy'}),copy=copied.apiManagement.configs.find(config=>config.id==='chat-copy');
 assert.equal(copy.credentialId,'chat-copy');assert.equal(copy.model,profile.model);
 const removed=deleteConfiguration(copied,profile.id);assert.equal(removed.activeProfile,'chat-copy');assert.equal(removed.apiManagement.taskRoutes.chat,'inherit');assert.equal(removed.apiManagement.defaultConfigId,'chat-copy');
 assert.deepEqual(unusedCredentialIds(copied,removed),[profile.id]);
 const noAsr=deleteConfiguration(removed,asr.id);assert.equal(noAsr.apiManagement.taskRoutes.asr,'unassigned');
 assert.equal(saved.profiles.length,1,'operations do not mutate caller state');
});
