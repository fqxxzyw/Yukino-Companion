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
 assert.match(html,/GPT 权重（\.ckpt）/);assert.match(html,/SoVITS 权重（\.pth）/);assert.equal((html.match(/下载此文件/g)||[]).length,2);assert.equal((html.match(/选择本地文件/g)||[]).length,2);assert.match(html,/参考声音已自动准备/);
});
