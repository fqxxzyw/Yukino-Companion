const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('setup leaves all feature switches selectable while checking or downloading',async t=>{
 const {createServer}=await import('vite'),server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});t.after(()=>server.close());
 const {default:SetupWizard}=await server.ssrLoadModule('/src/ui/SetupWizard.jsx');
 for(const phase of ['checking','installing']){
  const html=renderToStaticMarkup(React.createElement(SetupWizard,{initialFeatures:['voice'],status:{phase,steps:[]},onStatus(){},onClose(){}}));
  const switches=html.match(/<input[^>]+role="switch"[^>]*>/g)||[];assert.equal(switches.length,4);assert.ok(switches.every(input=>!input.includes('disabled')));assert.match(html,/未选择/);
 }
});
test('voice settings presents separate local and downloaded GPT and SoVITS files',async t=>{
 const {createServer}=await import('vite'),server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});t.after(()=>server.close());
 const {default:VoiceSettings,voiceDefaults}=await server.ssrLoadModule('/src/speech/VoiceSettings.jsx');
 const html=renderToStaticMarkup(React.createElement(VoiceSettings,{config:{...voiceDefaults,reference:'automatic.wav'},status:{phase:'unloaded'},onChange(){},onStop(){},onPreview(){},onOpenSetup(){}}));
 assert.match(html,/GPT 权重（\.ckpt）/);assert.match(html,/SoVITS 权重（\.pth）/);assert.equal((html.match(/下载此文件/g)||[]).length,2);assert.equal((html.match(/选择本地文件/g)||[]).length,2);assert.match(html,/参考声音已配置/);assert.match(html,/改用默认参考声音/);
});
test('voice speed follows the character output while the selected radio remains global',async t=>{
 const {createServer}=await import('vite'),server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});t.after(()=>server.close());
 const {default:VoiceSettings,voiceDefaults}=await server.ssrLoadModule('/src/speech/VoiceSettings.jsx');
 const cloud=[{id:'cloud',name:'百炼',providerId:'dashscope-tts',model:'qwen3-tts-flash'}];
 const render=output=>renderToStaticMarkup(React.createElement(VoiceSettings,{page:'playback',config:{...voiceDefaults},status:{phase:'unloaded'},onChange(){},onOutputChange(){},output:{cloud,...output}}));
 const inheritedCloud=render({value:'builtin-local',effectiveValue:'cloud',characterOverride:true});
 assert.match(inheritedCloud,/当前角色的音色设置覆盖全局输出：云端语音/);assert.match(inheritedCloud,/<label class="field">语速[^<]*<input[^>]*disabled=""/);assert.match(inheritedCloud,/<label class="voice-output-option selected"><input[^>]*checked=""[^>]*\/><span><strong>本地 GPT-SoVITS/);
 const inheritedLocal=render({value:'cloud',effectiveValue:'builtin-local',characterOverride:true});
 assert.match(inheritedLocal,/当前角色的音色设置覆盖全局输出：本地 GPT-SoVITS/);assert.doesNotMatch(inheritedLocal,/<label class="field">语速[^<]*<input[^>]*disabled=""/);assert.match(inheritedLocal,/<label class="voice-output-option selected"><input[^>]*checked=""[^>]*\/><span><strong>云端语音合成/);
 const silent=render({value:'cloud',effectiveValue:'unassigned',characterOverride:true});assert.match(silent,/覆盖全局输出：不使用语音/);assert.doesNotMatch(silent,/<label class="field">语速[^<]*<input[^>]*disabled=""/);
});
