const test = require('node:test');
const assert = require('node:assert/strict');
const {providerCatalog, modelEndpoint, discoverModels, normaliseModels} = require('../electron/providers.cjs');

const profile = {id:'p', providerId:'custom', base:'https://example.com/v1'};
const discover = (fetcher, overrides = {}) => discoverModels({profile, key:'test-secret', fetcher, ...overrides});

test('catalogue is isolated and only advertises implemented protocol providers', () => {
  const first = providerCatalog();
  assert.ok(first.some(p => p.id === 'deepseek'));
  assert.ok(first.some(p => p.id === 'dashscope-cn'));
  assert.ok(!first.some(p => p.id === 'anthropic'));
  first[0].name = 'modified';
  assert.notEqual(providerCatalog()[0].name, 'modified');
});

test('model URL accepts a base, full completion URL and loopback without duplicating path', () => {
  assert.equal(modelEndpoint(profile), 'https://example.com/v1/models');
  assert.equal(modelEndpoint({...profile, base:'https://example.com/proxy/v2/chat/completions/'}), 'https://example.com/proxy/v2/models');
  assert.equal(modelEndpoint({...profile, base:'http://127.0.0.1:1234/v1'}), 'http://127.0.0.1:1234/v1/models');
  assert.equal(modelEndpoint({...profile, base:'http://[::1]:1234/v1'}), 'http://[::1]:1234/v1/models');
  for (const base of ['http://example.com/v1','https://secret@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#secret','file:///etc/passwd','not a url']) {
    assert.throws(() => modelEndpoint({...profile, base}), /API 地址无效/);
  }
});

test('vendor-specific list paths preserve origin and do not apply to arbitrary proxies', () => {
  const cn = new URL(modelEndpoint({providerId:'dashscope-cn', base:'https://dashscope.aliyuncs.com/compatible-mode/v1'}));
  assert.equal(cn.origin, 'https://dashscope.aliyuncs.com');
  assert.equal(cn.pathname, '/api/v1/models');
  assert.equal(cn.searchParams.get('capabilities'), 'TG');
  assert.equal(modelEndpoint({providerId:'dashscope-cn', base:'https://my-proxy.example/v1'}), 'https://my-proxy.example/v1/models');
  assert.equal(modelEndpoint({providerId:'siliconflow', base:'https://api.siliconflow.cn/v1'}), 'https://api.siliconflow.cn/v1/models?sub_type=chat');
});

test('authenticated fetch disables redirects, returns discovered models, deduplicates and filters non-chat types', async () => {
  const result = await discover(async (url, options) => {
    assert.equal(url, 'https://example.com/v1/models');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({data:[{id:'z-model'}, {id:'a-model', name:'A'}, {id:'z-model'}, {id:'text-embedding-3-small'}, {id:'future-model', type:'embedding'}, {id:'image-only', output_modalities:['image']}, {id:'bad\nname'}, {id:'multimodal', output_modalities:['text','image']}]});
  });
  assert.equal(result.status, 'ready'); assert.equal(result.verified, true);
  assert.deepEqual(result.models.map(m => m.id), ['a-model','multimodal','z-model']);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('DashScope native pagination includes every page and normalises its model field', async () => {
  const pages = [];
  const result = await discover(async url => {
    const page = Number(new URL(url).searchParams.get('page_no')); pages.push(page);
    return Response.json({success:true, output:{total:3, models:page === 1 ? [{model:'qwen-plus', name:'Qwen Plus'},{model:'qwen-flash'}] : [{model:'qwen-max'}]}});
  }, {profile:{providerId:'dashscope-cn', base:'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'}});
  assert.deepEqual(pages, [1,2]);
  assert.deepEqual(result.models.map(m => m.id), ['qwen-flash','qwen-max','qwen-plus']);
});

test('unsupported model endpoints are not successful key verification', async () => {
  for (const status of [404,405,501]) {
    const result = await discover(async () => new Response('not supported', {status}), {profile:{providerId:'zhipu', base:'https://open.bigmodel.cn/api/paas/v4'}});
    assert.equal(result.verified, false); assert.equal(result.status, 'unsupported');
    assert.deepEqual(result.models, []); assert.ok(result.suggestions.length > 0);
    assert.match(result.message, /密钥尚未验证/);
  }
});

test('authentication, permissions and billing errors never silently become a preset list', async () => {
  for (const status of [401,402,403,429,500,503]) {
    await assert.rejects(discover(async () => new Response('test-secret', {status})), error => {
      assert.ok(error.message.includes(String(status)));
      assert.ok(!error.message.includes('test-secret')); return true;
    });
  }
});

test('non-200 success statuses and error-shaped or invalid 200 payloads are not verified', async () => {
  for (const response of [new Response(null,{status:204}), Response.json({error:{message:'test-secret'}}), Response.json({success:false}), Response.json({ok:true}), new Response('<html>login page</html>')]) {
    await assert.rejects(discover(async () => response), error => !error.message.includes('test-secret'));
  }
  const empty = await discover(async () => Response.json({data:[]}));
  assert.equal(empty.verified, true); assert.deepEqual(empty.models, []);
  assert.match(empty.message, /未发现对话候选模型/);
});

test('response body limit, malformed IDs and unbounded list pagination are contained', async () => {
  await assert.rejects(discover(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /列表过大/);
  assert.deepEqual(normaliseModels([{id:'x'.repeat(300)},{id:''},{id:'valid',name:'名\n称'}]), [{id:'valid',name:'名称'}]);
  let calls = 0;
  const result = await discover(async () => {calls++; return Response.json({output:{total:1000000, models:[{model:`model-${calls}`}]}});}, {profile:{providerId:'dashscope-cn',base:'https://dashscope.aliyuncs.com/compatible-mode/v1'}});
  assert.equal(calls, 10); assert.equal(result.truncated, true);
});

test('optional local key is omitted and remote required key is checked before a request', async () => {
  const result = await discover(async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({data:[{id:'local-model'}]});
  }, {profile:{providerId:'local',base:'http://localhost:1234/v1'}, key:''});
  assert.equal(result.models[0].id, 'local-model');
  await assert.rejects(discover(async () => {throw new Error('must not fetch');}, {profile:{providerId:'deepseek',base:'https://api.deepseek.com'},key:''}), /先输入/);
  await assert.rejects(discover(async () => {throw new Error('must not fetch');}, {key:'bad\nkey'}), /密钥格式无效/);
});

test('network and cancellation errors are readable and never echo raw transport errors', async () => {
  await assert.rejects(discover(async () => {throw new Error('redirect with test-secret');}), error => /无法连接/.test(error.message) && !error.message.includes('test-secret'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discover(async (url, options) => {options.signal.throwIfAborted();}, {signal:controller.signal}), /已取消获取模型/);
  await assert.rejects(discover(async () => new Response(new ReadableStream({start(controller) {controller.error(new Error('network failed test-secret'));}}))), error => /读取中断/.test(error.message) && !error.message.includes('test-secret'));
});
