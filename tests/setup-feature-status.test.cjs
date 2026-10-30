const test = require('node:test');
const assert = require('node:assert/strict');
let featureStatus;
test.before(async()=>{({featureStatus}=await import('../src/ui/setup-feature-status.mjs'));});

test('unchecked and incomplete inspections never imply resource readiness',()=>{
  assert.equal(featureStatus('voice',{features:[],steps:[{id:'voiceCore',state:'ready'},{id:'voicePreset',state:'ready'}]}).label,'尚未检查');
  assert.equal(featureStatus('voice',{features:['voice'],steps:[{id:'voiceCore',state:'ready'}]}).label,'尚未检查');
});
test('voice readiness requires both independently checked resource groups',()=>{
  const status={features:['voice'],steps:[{id:'voiceCore',state:'ready'},{id:'voicePreset',state:'missing'}]};
  assert.equal(featureStatus('voice',status).label,'需要准备');
  status.steps[1].state='ready';
  assert.equal(featureStatus('voice',status).label,'文件已找到');
});
test('active, waiting and error states are explicit',()=>{
  const status={features:['chat'],steps:[{id:'chat',state:'downloading'}]};
  assert.equal(featureStatus('chat',status).label,'正在准备');
  status.steps[0].state='waiting-runtime';
  assert.equal(featureStatus('chat',status).label,'等待运行环境');
  status.steps[0].state='error';
  assert.equal(featureStatus('chat',status).label,'需要处理');
});
