const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {mainHarness} = require('./helpers/main-harness.cjs');
const profile = {id:'provider',base:'https://example.test/v1',model:'provider-model'};
const state = {profiles:[profile],activeProfile:profile.id,conversations:[],persona:'',translationMode:'api'};
test('clipboard copies reply text through the authorized native main window',async()=>{const app=await mainHarness({state});assert.equal(await app.invoke('copy-text','中文 / 日本語'),true);assert.deepEqual(app.copied,['中文 / 日本語']);await assert.rejects(app.invoke('copy-text',{text:'invalid'}),/复制内容无效/);await assert.rejects(app.handlers.get('copy-text')({sender:{},senderFrame:{}},'forged'),/不允许/);});
const request = {id:'message',profileId:profile.id,messages:[{role:'user',content:'今天也辛苦了。'}]};
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('real main entrypoint wires startup IPC and rejects non-main renderer callers', async () => {
  const app = await mainHarness({state});
  for(const name of ['chat','voice-synthesize','voice-install','translation-status','translation-save','translate','translation-cancel','companion-state','companion-set','close-choice','local-chat-settings','local-chat-status','local-chat-save','local-chat-load','local-chat-unload','local-chat-probe','setup-status','setup-install','setup-cancel','api-providers','api-models']) assert.ok(app.handlers.has(name),name);
  assert.equal(app.window.visible,true);
  assert.match(app.window.loadedFile,/dist[/\\]index\.html$/);
  await assert.rejects(app.handlers.get('translate')({sender:{},senderFrame:{}},{text:'你好',requestId:'untrusted'}),/不允许/);
  assert.equal(app.translated.length,0);
});

test('real main returns two versions, emits only Chinese chunks, and forwards both to desktop companions', async () => {
  const app = await mainHarness({state,reply:{zh:'坐下喝杯茶吧。',ja:'座ってお茶を飲みましょう。'}});
  const result = await app.invoke('chat',request);
  assert.equal(result.bilingual.zh,'坐下喝杯茶吧。');
  assert.equal(result.bilingual.ja,'座ってお茶を飲みましょう。');
  assert.equal(app.sent.filter(row=>row.channel==='chunk').map(row=>row.payload.text).join(''),'坐下喝杯茶吧。');
  assert.equal(app.companions.replies[0].ja,result.bilingual.ja);
  assert.equal(app.companions.replies[0].id,request.id);
});

test('local translation mode obtains Chinese from API and runs the local translator before returning Japanese', async () => {
  const app = await mainHarness({state:{...state,translationMode:'local'},reply:'不必急着回答。'});
  const result = await app.invoke('chat',request);
  assert.match(app.requests[0].messages[0].content,/请用简体中文自然回答/);
  assert.doesNotMatch(app.requests[0].messages[0].content,/只返回一个 JSON 对象/);
  assert.equal(app.translated.length,1);
  assert.equal(app.translated[0].request.text,'不必急着回答。');
  assert.equal(result.bilingual.ja,'ローカルで翻訳しました。');
  assert.equal(result.bilingual.source,'local');
});

test('local translation failure returns the original Chinese and an explicit unavailable Japanese result', async () => {
  const app = await mainHarness({state:{...state,translationMode:'local'},reply:'慢慢来就好。',translate:async()=>{throw Error('model missing');}});
  const result = await app.invoke('chat',request);
  assert.equal(result.ok,true);assert.equal(result.bilingual.zh,'慢慢来就好。');
  assert.equal(result.bilingual.ja,'');assert.equal(result.bilingual.translationStatus,'error');
  assert.match(result.bilingual.translationError,/model missing/);
});

test('main stop during API response prevents completed bilingual replies and companion updates', async () => {
  const reply = deferred(), entered = deferred();
  const app = await mainHarness({state,reply:async()=>{entered.resolve();return reply.promise;}});
  const active = app.invoke('chat',request);await entered.promise;
  await app.invoke('stop');reply.resolve(JSON.stringify({zh:'迟到',ja:'遅れた返事です。'}));
  assert.equal((await active).stopped,true);
  assert.equal(app.companions.replies.length,0);
});

test('empty translation paths resolve to bundled defaults and persist valid config', async () => {
  for(const packaged of [false,true]) {
    const app = await mainHarness({state,packaged});
    const result = await app.invoke('translation-save',{python:'',modelDir:'',device:'auto'});
    assert.equal(result.config.python,path.resolve('/embedded/python'));
    assert.equal(result.config.modelDir,app.defaultModelRoot);
    const saved=JSON.parse(app.storage.get('translation.json'));
    assert.equal(saved.python,result.config.python);assert.equal(saved.modelDir,result.config.modelDir);
    await app.invoke('translation-cancel','preview-id');assert.equal(app.cancelled.at(-1),'preview-id');
  }
});


test('built-in local chat works without an API profile or key and completes Japanese translation',async()=>{
  const app=await mainHarness({state:{...state,profiles:[],activeProfile:'',chatMode:'local'},localReply:'先坐下，喝杯茶再说。'});
  const result=await app.invoke('chat',{...request,profileId:undefined,mode:'local'});
  assert.equal(app.requests.length,0);assert.equal(app.network.length,0);assert.equal(app.localRequests.length,1);
  assert.equal(app.localRequests[0].messages[0].role,'system');
  assert.match(app.localRequests[0].messages[0].content,/雪之下雪乃/);
  assert.match(app.localRequests[0].messages[0].content,/请用简体中文自然回答/);
  assert.equal(result.bilingual.zh,'先坐下，喝杯茶再说。');assert.equal(result.bilingual.ja,'ローカルで翻訳しました。');
  assert.equal(app.translated[0].request.text,result.bilingual.zh);assert.equal(app.companions.replies[0].ja,result.bilingual.ja);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),result.bilingual.zh);
});

test('local reply remains visible if the Japanese translation model fails',async()=>{
  const app=await mainHarness({state:{...state,profiles:[],chatMode:'local'},localReply:'你的努力并非没有意义。',translate:async()=>{throw Error('翻译模型尚未准备好');}});
  const result=await app.invoke('chat',{...request,mode:'local'});
  assert.equal(result.ok,true);assert.equal(result.bilingual.zh,'你的努力并非没有意义。');assert.equal(result.bilingual.ja,'');
  assert.equal(result.bilingual.translationStatus,'error');assert.match(result.bilingual.translationError,/翻译模型尚未准备好/);
  assert.equal(app.requests.length,0);assert.equal(app.companions.replies[0].zh,result.bilingual.zh);
});

test('stop cancels built-in local generation and prevents translation or companion updates',async()=>{
  const output=deferred(),entered=deferred();
  const app=await mainHarness({state:{...state,chatMode:'local'},localReply:async()=>{entered.resolve();return output.promise;}});
  const active=app.invoke('chat',{...request,mode:'local'});await entered.promise;await app.invoke('stop');
  output.resolve({text:'迟到的回复',device:'cpu'});assert.equal((await active).stopped,true);
  assert.ok(app.localCancelled.length);assert.equal(app.translated.length,0);assert.equal(app.companions.replies.length,0);
});

test('explicit API mode overrides a saved local mode',async()=>{
  const app=await mainHarness({state:{...state,chatMode:'local'}});
  const result=await app.invoke('chat',{...request,mode:'api'});
  assert.equal(result.ok,true);assert.equal(app.requests.length,1);assert.equal(app.localRequests.length,0);
});

test('API model discovery uses draft keys without saving or returning the secret',async()=>{
  const app=await mainHarness({state});
  const providers=await app.invoke('api-providers');assert.ok(providers.some(item=>item.id==='openai'));
  const result=await app.invoke('api-models',{profileId:'draft',base:'https://api.example.test/v1',providerId:'custom',key:'draft-secret'});
  assert.equal(result.verified,true);assert.equal(result.models[0].id,'test-chat-model');
  assert.equal(app.network[0].options.headers.Authorization,'Bearer draft-secret');
  assert.equal(app.network[0].options.redirect,'error');assert.equal(app.storage.has('keys.json'),false);
  assert.doesNotMatch(JSON.stringify(result),/draft-secret/);
});

test('API keys remain bound to their saved origin across chat and model discovery',async()=>{
  const app=await mainHarness({state});await app.invoke('key',profile.id,'private-secret',profile.base);
  const stored=JSON.parse(app.storage.get('keys.json'));assert.equal(stored[profile.id].origin,'https://example.test');
  assert.doesNotMatch(app.storage.get('keys.json'),/private-secret/);
  await app.invoke('chat',request);assert.equal(app.transport[0].headers.Authorization,'Bearer private-secret');
  await app.invoke('api-models',{profileId:profile.id,base:'https://example.test/another-version',providerId:'custom'});
  assert.equal(app.network.at(-1).options.headers.Authorization,'Bearer private-secret');
  const changed={...state,profiles:[{...profile,base:'https://another.example.test/v1'}]};await app.invoke('save',changed);
  await assert.rejects(app.invoke('chat',request),/地址已变更/);
  await assert.rejects(app.invoke('api-models',{profileId:profile.id,base:changed.profiles[0].base,providerId:'custom'}),/地址已变更/);
  assert.equal(app.transport.length,1);assert.equal(app.network.length,1);
  assert.doesNotMatch(JSON.stringify(await app.invoke('load')),/private-secret|sealed:/);
});

test('legacy encrypted keys migrate using the persisted profile origin and orphan keys stay blocked',async()=>{
  const sealed=Buffer.from('sealed:legacy-secret').toString('base64');
  const app=await mainHarness({state,files:{'keys.json':JSON.stringify({[profile.id]:sealed,orphan:sealed})}});
  const migrated=JSON.parse(app.storage.get('keys.json'));
  assert.equal(migrated[profile.id].ciphertext,sealed);assert.equal(migrated[profile.id].origin,'https://example.test');assert.equal(migrated.orphan.origin,'');
  await app.invoke('chat',request);assert.equal(app.transport[0].headers.Authorization,'Bearer legacy-secret');
  await assert.rejects(app.invoke('api-models',{profileId:'orphan',base:profile.base,providerId:'custom'}),/重新验证/);
  assert.equal(app.network.length,0);
});

test('voice begin applies merged defaults after saving and unloading, with no manual load',async()=>{
  const app=await mainHarness({state});
  const defaults=await app.invoke('voice-settings');assert.ok(defaults.gpt.endsWith('default.ckpt'));assert.ok(defaults.reference.endsWith('ref.wav'));assert.equal(defaults.promptText,'');
  const status=await app.invoke('voice-status');assert.equal(status.configured,true);
  await app.invoke('voice-save',{...defaults,enabled:true});await app.invoke('voice-unload');
  const count=app.voiceActions.length;await app.invoke('voice-begin','first-voice');
  assert.deepEqual(app.voiceActions.slice(count).map(item=>item.method),['configure','begin']);
  assert.equal(app.voiceActions.at(-1).config.gpt,defaults.gpt);
  await app.invoke('voice-synthesize','first-voice','こんにちは。');
  assert.equal(app.voiceActions.filter(item=>item.method==='load').length,0);
});

test('voice defaults do not pair a user GPT checkpoint or reference with unrelated bundled files',async()=>{
  const custom={gpt:path.resolve('/custom/gpt.ckpt'),sovits:'',reference:path.resolve('/custom/ref.wav'),promptText:''};
  const app=await mainHarness({state,files:{'speech.json':JSON.stringify(custom)}});
  const config=await app.invoke('voice-settings');assert.equal(config.gpt,custom.gpt);assert.equal(config.sovits,'');assert.equal(config.reference,custom.reference);assert.equal(config.promptText,'');
});

test('first-use setup installs one shared runtime and keeps model/runtime states separate',async()=>{
  const app=await mainHarness({state,runtimeReady:false,voiceMissing:['bert','hubert']});
  const before=await app.invoke('setup-status');
  assert.equal(before.steps.find(item=>item.id==='runtime').state,'missing');
  assert.equal(before.steps.find(item=>item.id==='chat').state,'waiting-runtime');assert.equal(before.steps.find(item=>item.id==='translation').state,'waiting-runtime');
  assert.equal(before.steps.find(item=>item.id==='chat').downloadBytes,0);assert.equal(before.steps.find(item=>item.id==='translation').downloadBytes,0);
  const after=await app.invoke('setup-install',{runtimeFlavor:'cpu',features:['chat','translation','voice']});
  assert.equal(after.ready,true);assert.deepEqual(app.runtime.installs,['cpu']);assert.deepEqual(new Set(app.voiceInstallCalls),new Set(['core','yukino-e2']));
  const local=await app.invoke('local-chat-settings'),translation=await app.invoke('translation-status'),voice=await app.invoke('voice-settings');
  assert.equal(local.python,path.resolve('/embedded/python'));assert.equal(translation.config.python,local.python);assert.equal(voice.python,local.python);
  assert.equal(JSON.parse(app.storage.get('speech.json')).bert,path.resolve('/embedded/models/chinese-roberta-wwm-ext-large'));
  await app.invoke('setup-cancel');assert.equal(app.runtime.cancelled,true);
});

test('replaced app-managed Python paths follow the selected runtime across chat, translation and voice',async()=>{
 const old=path.resolve('/virtual-user/runtime/old-runtime/python-runtime/python.exe'),files={'speech.json':JSON.stringify({python:old}),'translation.json':JSON.stringify({python:old}),'local-chat.json':JSON.stringify({python:old})};
 const app=await mainHarness({state,runtimeReady:true,files});const expected=path.resolve('/embedded/python');
 assert.equal((await app.invoke('voice-settings')).python,expected);assert.equal((await app.invoke('translation-status')).config.python,expected);assert.equal((await app.invoke('local-chat-settings')).python,expected);
});

test('missing app-managed Python is cleared until shared runtime installation completes',async()=>{
 const old=path.resolve('/virtual-user/runtime/old-runtime/python-runtime/python.exe'),files={'speech.json':JSON.stringify({python:old}),'translation.json':JSON.stringify({python:old}),'local-chat.json':JSON.stringify({python:old})};
 const app=await mainHarness({state,runtimeReady:false,files});
 assert.equal((await app.invoke('voice-settings')).python,'');assert.equal((await app.invoke('translation-status')).config.python,'');assert.equal((await app.invoke('local-chat-settings')).python,'');
 await app.invoke('setup-install',{features:['chat','translation','voice']});const expected=path.resolve('/embedded/python');
 assert.equal((await app.invoke('voice-settings')).python,expected);assert.equal((await app.invoke('translation-status')).config.python,expected);assert.equal((await app.invoke('local-chat-settings')).python,expected);
});

test('setup exposes actual downloadable CPU-only or CPU/CUDA variants to the renderer',async()=>{
  const app=await mainHarness({state});
  const original=app.runtime.status.bind(app.runtime);
  app.runtime.status=async()=>({...await original(),variants:['cpu']});
  assert.deepEqual(Array.from((await app.invoke('setup-status')).runtimeVariants),['cpu']);
  app.runtime.status=original;
  assert.deepEqual(Array.from((await app.invoke('setup-status')).runtimeVariants),['cpu','cu124']);
});


test('setup preserves custom Python and valid core paths without duplicate voice downloads',async()=>{
  const custom={python:path.resolve('/my-voice/python'),root:path.resolve('/my-voice/engine'),bert:path.resolve('/my-voice/bert'),hubert:path.resolve('/my-voice/hubert')};
  const customTranslation=path.resolve('/my-translation/python'),customLocal=path.resolve('/my-local/python');
  const app=await mainHarness({state,runtimeReady:false,files:{'speech.json':JSON.stringify(custom),'translation.json':JSON.stringify({python:customTranslation}),'local-chat.json':JSON.stringify({python:customLocal})}});
  const result=await app.invoke('setup-install',{runtimeFlavor:'cpu',features:['chat','translation','voice']});
  assert.equal(result.ready,true);assert.deepEqual(app.voiceInstallCalls,['yukino-e2']);
  const voice=await app.invoke('voice-settings'),local=await app.invoke('local-chat-settings'),translation=await app.invoke('translation-status');
  for(const key of Object.keys(custom))assert.equal(voice[key],custom[key],key);
  assert.equal(local.python,customLocal);assert.equal(translation.config.python,customTranslation);
  assert.equal(JSON.parse(app.storage.get('local-chat.json')).python,customLocal);
  assert.equal(JSON.parse(app.storage.get('translation.json')).python,customTranslation);
});

test('setup fills only a missing core component and keeps the existing custom counterpart',async()=>{
  const custom={bert:path.resolve('/custom/missing-bert'),hubert:path.resolve('/custom/working-hubert')};
  const app=await mainHarness({state,voiceMissing:['bert'],files:{'speech.json':JSON.stringify(custom)}});
  const result=await app.invoke('setup-install',{features:['voice']});assert.equal(result.ready,true);assert.deepEqual(new Set(app.voiceInstallCalls),new Set(['core','yukino-e2']));
  const voice=await app.invoke('voice-settings');assert.equal(voice.bert,path.resolve('/embedded/models/chinese-roberta-wwm-ext-large'));assert.equal(voice.hubert,custom.hubert);
});

test('setup cancellation during startup preparation blocks all subsequent installs',async()=>{
  const gate=deferred();
  const app=await mainHarness({state,runtimeReady:false,voiceMissing:['bert','hubert'],bundleGate:gate.promise});
  const installing=app.invoke('setup-install',{features:['chat','translation','voice']});
  await assert.rejects(app.invoke('setup-install',{features:['voice']}),/正在进行/);
  await app.invoke('setup-cancel');assert.equal(app.runtime.cancelled,true);gate.resolve();
  await assert.rejects(installing,/已取消准备/);
  assert.deepEqual(app.runtime.installs,[]);assert.deepEqual(app.voiceInstallCalls,[]);assert.equal(app.network.length,0);
  const status=await app.invoke('setup-status');assert.equal(status.phase,'cancelled');
  assert.equal(status.steps.find(item=>item.id==='runtime').state,'missing');
});


test('cancelling while voice readiness is pending cannot start a core download',{timeout:3000},async()=>{
  const gate=deferred(),entered=deferred();let pending=0;
  const app=await mainHarness({state,voiceMissing:['bert','hubert']});
  const readiness=app.voice.readiness.bind(app.voice);
  app.voice.readiness=async(...args)=>{
    if(app.setup.activeSteps.has('voiceCore')){
      // Both the progress inspection and the actual installation preflight can
      // inspect resources. Hold both so cancellation happens inside preflight.
      pending++;if(pending>=2)entered.resolve();await gate.promise;
    }
    return readiness(...args);
  };
  const installing=app.invoke('setup-install',{features:['voice']});await entered.promise;
  const savedBeforeCancel=app.storage.get('speech.json');
  await app.invoke('setup-cancel');gate.resolve();
  await assert.rejects(installing,/已取消准备/);
  assert.equal(app.voiceInstallCalls.includes('core'),false);assert.equal(app.network.length,0);
  assert.equal(app.storage.get('speech.json'),savedBeforeCancel);
  assert.equal((await app.invoke('setup-status')).phase,'cancelled');
});

test('default weight download preserves custom reference settings without blocking resource preparation',async()=>{
 const reference=path.resolve('/custom/my-reference.wav'),app=await mainHarness({state,voiceMissing:['gpt'],files:{'speech.json':JSON.stringify({reference})}});
 await app.invoke('setup-install',{features:['voice']});assert.equal(JSON.parse(app.storage.get('speech.json')).reference,reference);assert.ok(app.voiceInstallCalls.includes('yukino-e2'));
 const promptText='私が選んだ文章です。',textOnly=await mainHarness({state,voiceMissing:['gpt'],files:{'speech.json':JSON.stringify({promptText})}});
 await textOnly.invoke('setup-install',{features:['voice']});const saved=JSON.parse(textOnly.storage.get('speech.json'));assert.equal(saved.promptText,promptText);assert.equal(saved.reference,'');assert.equal(textOnly.voiceInstallCalls.includes('yukino-e2'),true);
});
test('an app-managed default voice pair can be repaired without being mistaken for custom weights',async()=>{
 const saved={gpt:path.resolve('/embedded/models/yukino-v1/gpt-e2.ckpt'),sovits:path.resolve('/embedded/models/yukino-v1/sovits-e1-s3561.pth')};
 const app=await mainHarness({state,voiceMissing:['gpt'],referenceFixture:true,files:{'speech.json':JSON.stringify(saved)}});
 const result=await app.invoke('setup-install',{features:['voice']});assert.equal(result.phase,'ready');assert.ok(app.voiceInstallCalls.includes('yukino-e2'));assert.equal(JSON.parse(app.storage.get('speech.json')).reference,path.resolve('/embedded/voice-models/ref.wav'));
});
test('background voice installation commits selected paths without relying on the settings panel',async()=>{
 const app=await mainHarness({state}),result=await app.invoke('voice-install','yukino-e2',{apply:true}),saved=JSON.parse(app.storage.get('speech.json'));
 assert.equal(result.applied,true);assert.equal(saved.gpt,result.gpt);assert.equal(saved.sovits,result.sovits);assert.equal(saved.promptText,'');assert.ok(app.sent.some(x=>x.channel==='voice-config-updated'));
});
test('a pending volume change cannot overwrite newly installed voice weights',async()=>{
 const app=await mainHarness({state}),before=await app.invoke('voice-settings');
 const owner=app.voiceDownloads.at(-1);let release;owner.install=()=>new Promise(resolve=>release=resolve);
 const pending=app.invoke('voice-install','yukino-e2',{apply:true});await new Promise(setImmediate);
 release({gpt:path.resolve('/downloaded/voice.ckpt'),sovits:path.resolve('/downloaded/voice.pth'),version:'v1',textLang:'all_ja'});
 assert.equal((await pending).applied,true);
 const saved=await app.invoke('voice-patch',{volume:0.35});
 assert.notEqual(saved.gpt,before.gpt);assert.equal(saved.gpt,path.resolve('/downloaded/voice.ckpt'));assert.equal(saved.sovits,path.resolve('/downloaded/voice.pth'));assert.equal(saved.volume,0.35);
 assert.equal(JSON.parse(app.storage.get('speech.json')).gpt,saved.gpt);
 await assert.rejects(app.invoke('voice-patch',{unexpected:true}),/无效语音设置/);
 await assert.rejects(app.invoke('voice-patch',{volume:2}),/超出范围/);
});
test('concurrent voice core and selected weights both persist without overwriting one another',async()=>{
 const gate=deferred(),entered=deferred(),started=new Set();const app=await mainHarness({state,voiceMissing:['bert','gpt'],voiceInstallBarrier:async id=>{started.add(id);if(started.size===2)entered.resolve();await gate.promise;}});
 const job=app.invoke('setup-install',{features:['voice']});await entered.promise;gate.resolve();const result=await job;assert.equal(result.ready,true);
 const saved=JSON.parse(app.storage.get('speech.json'));assert.equal(saved.gpt,path.resolve('/embedded/voice-models/default.ckpt'));assert.equal(saved.sovits,path.resolve('/embedded/voice-models/default.pth'));assert.equal(saved.bert,path.resolve('/embedded/models/chinese-roberta-wwm-ext-large'));
});
test('a background voice download cannot overwrite a newer local voice selection',async()=>{
 const app=await mainHarness({state}),owner=app.voiceDownloads.at(-1);let release;owner.install=()=>new Promise(resolve=>release=resolve);
 const pending=app.invoke('voice-install','yukino-e2',{apply:true});await new Promise(setImmediate);
 const custom={...await app.invoke('voice-settings'),gpt:path.resolve('/custom/voice.ckpt'),sovits:path.resolve('/custom/voice.pth')};await app.invoke('voice-save',custom);
 release({gpt:path.resolve('/downloaded/voice.ckpt'),sovits:path.resolve('/downloaded/voice.pth'),version:'v1',textLang:'all_ja'});
 const result=await pending;assert.equal(result.applied,false);const saved=JSON.parse(app.storage.get('speech.json'));assert.equal(saved.gpt,custom.gpt);assert.equal(saved.sovits,custom.sovits);
});
test('downloading one voice file preserves a separately selected local file',async()=>{
 const app=await mainHarness({state}),owner=app.voiceDownloads.at(-1);let release;owner.install=(_id,options)=>new Promise(resolve=>{assert.equal(options.component,'sovits');release=resolve;});
 const pending=app.invoke('voice-install','yukino-e2',{apply:true,component:'sovits'});await new Promise(setImmediate);
 const custom={...await app.invoke('voice-settings'),gpt:path.resolve('/custom/voice.ckpt')};await app.invoke('voice-save',custom);
 release({sovits:path.resolve('/downloaded/voice.pth'),version:'v1',textLang:'all_ja'});const result=await pending,saved=JSON.parse(app.storage.get('speech.json'));assert.equal(result.applied,true);assert.equal(saved.gpt,custom.gpt);assert.equal(saved.sovits,result.sovits);
});
test('default voice download progress is routed to its active setup step',async()=>{
 const app=await mainHarness({state});app.setup.controller=new AbortController();app.setup.phase='installing';app.setup.active='voicePreset';
 app.voiceDownloads.at(-1).options.notify({phase:'downloading',received:20,total:100});assert.equal(app.setup.progress.received,20);app.setup.controller=null;
});

test('manual Japanese translation follows selected API without invoking local Python',async()=>{const app=await mainHarness({state,reply:'こんにちは。'});const result=await app.invoke('translate',{text:'你好。',requestId:'api-manual',mode:'api',profileId:profile.id});assert.equal(result.text,'こんにちは。');assert.equal(result.source,'api');assert.equal(app.translated.length,0);assert.equal(app.requests.length,1);assert.match(app.requests[0].messages[0].content,/Japanese/);});
test('translation renderer cannot override saved API profile or key',async()=>{const app=await mainHarness({state,reply:'こんにちは。'});await app.invoke('translate',{text:'你好。',requestId:'api-injection',mode:'api',profileId:profile.id,profile:{base:'https://evil.test',model:'bad'},key:'injected'});assert.equal(app.transport[0].headers.Authorization,undefined);assert.equal(app.requests[0].model,profile.model);});
test('manual local translation stays local and does not contact the API',async()=>{const app=await mainHarness({state});const result=await app.invoke('translate',{text:'你好。',requestId:'local-manual',mode:'local',profileId:profile.id});assert.equal(app.requests.length,0);assert.equal(app.translated.length,1);assert.match(result.text,/翻訳/);});

test('main-frame document reload resets the speech generation but subframes and hash changes do not',async()=>{
 const app=await mainHarness({state});let resets=0,received=[];app.companions.resetSpeechClock=()=>resets++;app.companions.setSpeechSnapshot=value=>{received.push(value);return true};
 const wc=app.window.webContents;wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});assert.equal(resets,0);assert.equal(await app.invoke('companion-speech',{sequence:9}),true);
 wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});assert.equal(resets,1);assert.equal(await app.invoke('companion-speech',{sequence:10}),false,'old unloading renderer cannot reclaim sequence watermark');assert.equal(received.length,1);
 wc.emit('dom-ready');assert.equal(resets,2);assert.equal(await app.invoke('companion-speech',{sequence:1}),true);assert.equal(received.at(-1).sequence,1);
});

test('packaged resource directory follows the executable and selection is saved without moving active downloads',async()=>{
 const chosen=path.resolve('/another-volume/Yukino-assets');
 const app=await mainHarness({state,packaged:true,directoryChoice:chosen});
 const status=await app.invoke('setup-status',{features:['pet']});
 assert.equal(status.resourceDirectory,path.resolve('/virtual-install/Yukino-Data'));
 assert.equal(app.runtime.options.dataRoot,status.resourceDirectory);
 const choosing=app.invoke('resource-directory-pick');
 while(!app.sent.some(item=>item.channel==='flush-state'))await new Promise(setImmediate);
 const flush=app.sent.find(item=>item.channel==='flush-state');await app.invoke('save',state);await app.invoke('flush-complete',flush.payload.id,true);
 const choice=await choosing;assert.equal(choice.directory,chosen);assert.equal(choice.restartRequired,true);
 assert.equal(JSON.parse(app.storage.get('resource-directory.json')).directory,chosen);assert.deepEqual(JSON.parse(app.storage.get('resource-directory.json')).previousDirectories,[status.resourceDirectory]);
 await assert.rejects(app.invoke('setup-install',{features:['pet']}),/重启应用/);
});

test('failed or timed out renderer state save prevents changing resource directory',async()=>{
 for(const ack of [false,null]){
  const app=await mainHarness({state,packaged:true,directoryChoice:path.resolve('/another-volume/Yukino-assets')});
  const choosing=app.invoke('resource-directory-pick');
  while(!app.sent.some(item=>item.channel==='flush-state'))await new Promise(setImmediate);
  const flush=app.sent.find(item=>item.channel==='flush-state');
  if(ack===false)await app.invoke('flush-complete',flush.payload.id,false);
  await assert.rejects(choosing,/当前设置未能保存/);
  assert.equal(app.storage.has('resource-directory.json'),false);
  assert.equal((await app.invoke('setup-status',{features:['pet']})).pendingResourceDirectory,null);
 }
});

test('resource directory selection and installation exclude each other across awaited dialogs',async()=>{
 const dialog=deferred(),download=deferred(),entered=deferred();
 const app=await mainHarness({state,directoryChoice:()=>dialog.promise,voiceInstallBarrier:async()=>{entered.resolve();await download.promise;}});
 const choosing=app.invoke('resource-directory-pick');
 await new Promise(setImmediate);
 await assert.rejects(app.invoke('voice-install','core'),/正在选择资源目录/);
 await assert.rejects(app.invoke('resource-directory-pick'),/正在选择目录/);
 dialog.resolve(null);assert.equal(await choosing,null);
 const installing=app.invoke('voice-install','core');await entered.promise;
 await assert.rejects(app.invoke('resource-directory-pick'),/正在选择目录或安装资源/);
 download.resolve();await installing;
 assert.equal(app.storage.has('resource-directory.json'),false);
});

test('restart after repeated resource moves maps only previously managed configuration paths',async()=>{
 const first=path.resolve('/volume-d/Yukino'),selected=path.resolve('/volume-e/Yukino');
 const files={'resource-directory.json':JSON.stringify({directory:selected,previousDirectories:[first]}),'speech.json':JSON.stringify({python:path.join(first,'runtime','old','python-runtime','python.exe'),bert:path.join(first,'speech-models','bert'),hubert:path.join(first,'speech-models','hubert'),gpt:path.join(first,'speech-models','voice.ckpt'),sovits:path.join(first,'speech-models','voice.pth'),reference:path.join(first,'voice-presets','yukino-reference.wav')}),'translation.json':JSON.stringify({modelDir:path.join(first,'translation-runtime','models','japanese')}),'local-chat.json':JSON.stringify({modelDir:path.join(first,'resources','chat','payload')})};
 const app=await mainHarness({state,packaged:true,runtimeReady:false,files});
 const voice=await app.invoke('voice-settings');assert.equal(voice.python,'');assert.equal(voice.bert,path.join(selected,'speech-models','bert'));assert.equal(voice.reference,path.join(selected,'voice-presets','yukino-reference.wav'));
 assert.equal((await app.invoke('local-chat-settings')).modelDir,path.join(selected,'resources','chat','payload'));
 assert.equal((await app.invoke('translation-status')).modelDir,path.join(selected,'translation-runtime','models','japanese'));
 const custom=path.join(first,'personal-models','custom');
 const preserved=await mainHarness({state,packaged:true,files:{...files,'local-chat.json':JSON.stringify({modelDir:custom})}});
 assert.equal((await preserved.invoke('local-chat-settings')).modelDir,custom);
});
