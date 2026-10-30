const test=require('node:test'),assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/main-harness.cjs');
const state={profiles:[],conversations:[],apiManagement:{configs:[{id:'listen',providerId:'aliyun-asr'}],taskRoutes:{asr:'listen'}}};
for(const terminal of ['error','closed','finished'])test(`main revokes microphone permission when ASR reports ${terminal}`,async()=>{
 let service;
 class ProtocolFixture{
  constructor({notify}){this.notify=notify;service=this;}
  async start(){this.session={id:'synthetic-session'};return {sessionId:this.session.id};}
  stop(){this.session=null;}
 }
 const app=await mainHarness({state,asrClass:ProtocolFixture});
 await app.invoke('api-credential-save','listen',{apiKey:'SYNTHETIC_ONLY'});
 await app.invoke('asr-start',{consent:true});assert.equal(app.permissionAllowed(),true);
 service.notify({sessionId:'synthetic-session',type:terminal});assert.equal(app.permissionAllowed(),false);
 assert.equal(app.sent.at(-1).channel,'microphone-revoked');
});
