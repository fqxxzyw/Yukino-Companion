const test=require('node:test');
const assert=require('node:assert/strict');
const layout=import('../src/ui/panel-layout.mjs');
test('expanded sidebar at minimum window width preserves both readable columns',async()=>{
  const {clampCharacterWidth,MIN_CHAT_WIDTH}=await layout;
  const mainWidth=760-190-20,gap=10;
  const width=clampCharacterWidth(460,mainWidth,gap);
  assert.ok(width>=168);assert.ok(mainWidth-gap-width>=MIN_CHAT_WIDTH);
});
test('resizing beyond either edge never consumes all chat space or hides the character',async()=>{
  const {clampCharacterWidth}=await layout;
  assert.equal(clampCharacterWidth(-1000,800,24),168);
  assert.equal(clampCharacterWidth(9999,800,24),460);
  assert.equal(clampCharacterWidth(9999,600,24),266);
});
test('corrupt persisted sizes fall back to a usable width',async()=>{
  const {clampCharacterWidth}=await layout;
  for(const value of [undefined,NaN,Infinity,'bad'])assert.equal(clampCharacterWidth(value,800,24),290);
});
test('dock choice accounts for the sidebar offset rather than whole-window midpoint',async()=>{
  const {sideFromPointer}=await layout;
  assert.equal(sideFromPointer(510,220,700),'left');
  assert.equal(sideFromPointer(700,220,700),'right');
});
test('renderer removes raw Electron wrappers and retains useful Chinese remediation',async()=>{
  const {friendlyError,voiceSetupNeeded}=await import('../src/ui/errors.mjs');
  assert.equal(friendlyError("Error invoking remote method 'voice:begin': Error: 请先配置并加载语音模型"),'请先配置并加载语音模型');
  assert.equal(friendlyError('TypeError: fetch failed'),'暂时无法连接，请检查网络或服务地址。');
  assert.equal(voiceSetupNeeded('语音资源尚未准备好，请完成声音配置。'),true);
});
