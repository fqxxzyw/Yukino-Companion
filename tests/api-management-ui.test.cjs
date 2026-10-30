const test=require('node:test'),assert=require('node:assert/strict');
const load=import('../src/ui/api-management-ui.mjs');
test('API management preserves existing profile identities and separates unassigned capture tasks',async()=>{
 const {managementFrom}=await load;const state={activeProfile:'old',profiles:[{id:'old',name:'原服务',base:'https://example.com/v1',model:'chat'}],apiManagement:{version:1,configs:[{id:'asr',providerId:'aliyun-asr',credentialId:'asr',capabilities:['asr']}],taskRoutes:{asr:'asr'}}};
 const result=managementFrom(state);assert.equal(result.defaultConfigId,'old');assert.equal(result.configs.find(item=>item.id==='old').credentialId,'old');assert.equal(result.taskRoutes.asr,'asr');assert.equal(result.taskRoutes.vision,'unassigned');assert.equal(result.taskRoutes.tts,'builtin-local');assert.equal(result.configs.find(item=>item.id==='asr').credentialId,'asr');assert.equal(state.profiles.length,1);const local=managementFrom({...state,apiManagement:undefined,chatMode:'local',translationMode:'local'});assert.equal(local.taskRoutes.chat,'builtin-local');assert.equal(local.taskRoutes.proactive,'builtin-local');assert.equal(local.taskRoutes.translation,'builtin-local');
});
test('vision task choices require explicit profile capability and saved is never verified',async()=>{
 const {managementFrom,configSupports,validationLabel}=await load;const state={profiles:[{id:'a',base:'https://example.com',model:'m'}]};assert.equal(configSupports(managementFrom(state).configs[0],'vision'),false);state.profiles[0].visionEnabled=true;assert.equal(configSupports(managementFrom(state).configs[0],'vision'),true);assert.equal(validationLabel('saved'),'已保存');assert.equal(validationLabel({status:'untested'}),'未验证');assert.equal(validationLabel({status:'passed'}),'已验证');
});
test('provider branding uses only fixed cached local logos and no remote request',async()=>{
 const {safeProviderLogo,providerBrand}=await load;assert.equal(safeProviderLogo('https://remote.test/logo.png'),'');assert.equal(safeProviderLogo('./provider-logos/../secret.png'),'');assert.equal(safeProviderLogo({path:'./provider-logos/openai.ico',status:'pending'}),'');assert.equal(safeProviderLogo({path:'./provider-logos/openai.ico',status:'cached'}),'./provider-logos/openai.ico');assert.equal(providerBrand({id:'dashscope-cn'}),'aliyun');
});
test('brand cards keep text adaptation separate from unimplemented realtime ASR',async()=>{
 const {providerTaskBadges}=await load;assert.deepEqual(providerTaskBadges([{capabilities:['chat'],implementation:'compatible-chat',realAdaptationStatus:'implemented-unverified'},{capabilities:['asr'],implementation:'catalog-only',realAdaptationStatus:'catalog-only'}]),['文字协议已接入 · 账户待验证','实时 ASR 待接入']);
});
test('needs change display order by preference or implemented protocol and leave original order intact',async()=>{
 const {orderProviderBrands}=await load,brands=['openai','aliyun','tencent'],providers=[{id:'openai-asr',brand:'openai',capabilities:['asr'],implementation:'catalog-only'},{id:'aliyun-asr',brand:'aliyun',capabilities:['asr'],implementation:'protocol-implemented',realAdaptationStatus:'implemented-unverified'}];assert.deepEqual(orderProviderBrands(brands,providers,'chinese'),['aliyun','openai','tencent']);assert.deepEqual(orderProviderBrands(['aliyun','tencent','openai'],providers,'openai'),['openai','aliyun','tencent']);assert.deepEqual(brands,['openai','aliyun','tencent']);
});
