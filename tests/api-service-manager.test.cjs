const test=require('node:test'),assert=require('node:assert/strict');
const {ApiServiceManager}=require('../electron/api-service-manager.cjs');
function fixture(validate){const store={'state.json':{profiles:[],apiManagement:{configs:[{id:'asr',providerId:'aliyun-asr',name:'听写',capabilities:['asr']}],taskRoutes:{asr:'asr'}}}},safeStorage={encryptString:value=>Buffer.from('sealed:'+value),decryptString:value=>value.toString().slice(7)};const service=new ApiServiceManager({read:async(name,fallback)=>structuredClone(store[name]??fallback),update:async(name,updater)=>{store[name]=await updater(structuredClone(store[name]||{}));return store[name];},safeStorage,assertSecure:()=>{},validate});return {service,store};}
test('structured secrets are encrypted, not put in ordinary state, and saving invalidates prior test evidence',async()=>{const f=fixture(async()=>({status:'passed',message:'protocol fixture'}));await f.service.saveCredentials('asr',{apiKey:'SYNTHETIC_ONLY'});assert.doesNotMatch(JSON.stringify(f.store['state.json']),/SYNTHETIC_ONLY/);assert.doesNotMatch(JSON.stringify(f.store['keys.json']),/SYNTHETIC_ONLY/);await f.service.check({configId:'asr'});assert.equal((await f.service.evidence()).asr.connection.status,'passed');assert.equal((await f.service.evidence()).asr.stream.status,'untested');await f.service.saveCredentials('asr',{apiKey:'OTHER_SYNTHETIC'});assert.equal((await f.service.evidence()).asr.connection.status,'untested');});
test('connection handshake cannot be relabelled as real audio transcription',async()=>{let calls=0;const f=fixture(async()=>{calls++;return {status:'passed'};});const result=await f.service.check({configId:'asr',kind:'stream'});assert.equal(result.status,'untested');assert.equal(calls,0);assert.equal((await f.service.evidence()).asr.stream.status,'untested');});
test('credential change during a check discards stale verification',async()=>{let release;const gate=new Promise(resolve=>release=resolve),f=fixture(async()=>{await gate;return {status:'passed'};});await f.service.saveCredentials('asr',{apiKey:'FIRST_SYNTHETIC'});const pending=f.service.check({configId:'asr'});await new Promise(setImmediate);await f.service.saveCredentials('asr',{apiKey:'SECOND_SYNTHETIC'});release();await assert.rejects(pending,/已改变/);assert.equal((await f.service.evidence()).asr.connection.status,'untested');});
test('copied credentials have an independent identifier and deleting one configuration retains the other',async()=>{const f=fixture();await f.service.saveCredentials('asr',{apiKey:'SYNTHETIC_ONLY'});const copied=await f.service.duplicate('asr'),copy=copied.apiManagement.configs.find(item=>item.id!=='asr');assert.notEqual(copy.credentialId,'asr');await f.service.saveCredentials(copy.id,{apiKey:'COPY_SYNTHETIC'});assert.equal((await f.service.credentials((await f.service.find('asr')).config)).apiKey,'SYNTHETIC_ONLY');await f.service.remove(copy.id);assert.ok(f.store['keys.json'].asr);assert.equal(f.store['keys.json'][copy.id],undefined);});
test('a copied text configuration stays editable through the existing profile editor without changing task routes',async()=>{
 const f=fixture();
 f.store['state.json']={profiles:[{id:'text',name:'文字',providerId:'custom',base:'https://chat.example/v1',model:'chat-model',visionEnabled:true}],activeProfile:'text',apiManagement:{defaultConfigId:'text',taskRoutes:{chat:'text',asr:'unassigned'}}};
 const result=await f.service.duplicate('text'),copy=result.apiManagement.configs.find(item=>item.id!=='text');
 const editable=result.state.profiles.find(profile=>profile.id===copy.id);
 assert.equal(editable.base,'https://chat.example/v1');assert.equal(editable.model,'chat-model');assert.equal(editable.visionEnabled,true);
 assert.equal(result.state.activeProfile,'text');assert.equal(result.apiManagement.taskRoutes.chat,'text');
 assert.equal(f.store['state.json'].profiles.length,2);
});
test('an ASR handshake cannot be recorded as verified vision capability',async()=>{
 let called=false;const f=fixture(async()=>{called=true;return {status:'passed'};});
 const result=await f.service.check({configId:'asr',kind:'vision'});
 assert.equal(result.status,'unsupported');assert.equal(called,false);assert.notEqual((await f.service.evidence()).asr.vision.status,'passed');
});
test('a model changed in the final recording window cannot acquire an earlier model verification',async()=>{
 const f=fixture(async()=>({status:'passed',message:'old model response'}));
 let reads=0;const originalRead=f.service.read;
 f.service.read=async(name,fallback)=>{const value=await originalRead(name,fallback);if(name==='state.json'&&++reads>=3)value.apiManagement.configs[0].model='new-model';return value;};
 await assert.rejects(f.service.check({configId:'asr'}),/已改变/);
 assert.equal((await f.service.evidence()).asr.connection.status,'untested');
});
