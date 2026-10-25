'use strict';

const {endpoint} = require('./chat.cjs');

// Models are discovered from the user's account, not frozen into a versioned list.
// Documentation and the one explicit fallback catalogue are recorded in docs/API_PROVIDERS.md.
const PROVIDERS = [
  {id:'deepseek', name:'DeepSeek', base:'https://api.deepseek.com', note:'使用 DeepSeek 开放平台的 API 密钥。'},
  {id:'openai', name:'OpenAI', base:'https://api.openai.com/v1', note:'使用 API 平台密钥；ChatGPT 订阅不包含 API 额度。'},
  {id:'dashscope-cn', name:'通义千问 · 北京', base:'https://dashscope.aliyuncs.com/compatible-mode/v1', note:'使用北京地域百炼密钥；专属工作空间域名可在高级设置中替换。'},
  {id:'dashscope-intl', name:'通义千问 · 新加坡', base:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', note:'使用新加坡地域百炼密钥，不能与北京地域混用。'},
  {id:'siliconflow', name:'硅基流动', base:'https://api.siliconflow.cn/v1', note:'从账户获取可用的对话模型。'},
  {id:'moonshot-cn', name:'Kimi · 国内', base:'https://api.moonshot.cn/v1', note:'使用 Moonshot 国内平台的 API 密钥。'},
  {id:'moonshot-intl', name:'Kimi · 国际', base:'https://api.moonshot.ai/v1', note:'使用 Moonshot 国际平台的 API 密钥。'},
  {id:'zhipu', name:'智谱 GLM', base:'https://open.bigmodel.cn/api/paas/v4', note:'普通按量 API；Coding Plan 的地址与密钥不同。', suggestions:[{id:'glm-5.3', name:'GLM-5.3'},{id:'glm-5.3-flash', name:'GLM-5.3-Flash'}]},
  {id:'local', name:'本机兼容服务', base:'http://127.0.0.1:1234/v1', note:'适用于已启动的 LM Studio 等兼容服务；内置本地雪乃请在「本地模型」中启动。', keyOptional:true},
  {id:'custom', name:'自定义兼容服务', base:'', note:'支持 OpenAI Chat Completions 协议；不直接支持 Anthropic 原生 Messages 接口。', keyOptional:true},
];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 1000;
const MAX_PAGES = 10;

function providerCatalog() {
  return structuredClone(PROVIDERS);
}

function modelEndpoint(profile) {
  if (!profile || typeof profile.base !== 'string' || profile.base.length > 2048) throw new Error('请先填写有效的 API 地址。');
  let result;
  try { result = new URL(endpoint(profile.base.trim()).replace(/\/chat\/completions$/, '/models')); }
  catch { throw new Error('API 地址无效：请使用 HTTPS，或 localhost / 127.0.0.1 的本机 HTTP 地址；不要包含密钥或查询参数。'); }
  // Native DashScope model listing has a different path, but never a different origin.
  if (String(profile.providerId || '').startsWith('dashscope-') && /(^|\.)aliyuncs\.com$/.test(result.hostname)) {
    result.pathname = '/api/v1/models';
    result.searchParams.set('page_no', '1');
    result.searchParams.set('page_size', '100');
    result.searchParams.set('capabilities', 'TG');
  }
  if (profile.providerId === 'siliconflow' && result.hostname === 'api.siliconflow.cn') {
    result.searchParams.set('sub_type', 'chat');
  }
  return result.href;
}

function isTextCandidate(model) {
  if (!model || typeof model !== 'object') return false;
  const kind = String(model.sub_type || model.type || '').toLowerCase();
  if (['embedding','embeddings','reranker','rerank','image','audio','video','speech-to-text','text-to-image','image-to-image','text-to-video'].includes(kind)) return false;
  const modalities = model.output_modalities || model.inference_metadata?.response_modality;
  if (Array.isArray(modalities) && modalities.length && !modalities.some(m => String(m).toLowerCase() === 'text')) return false;
  const id = String(model.id || model.model || '');
  return !/(?:^|[\/_-])(?:embedding[s]?|rerank(?:er)?|whisper|tts|dall-e|moderation|transcribe|realtime|image)(?:[\/_-]|$)/i.test(id);
}

function normaliseModels(items) {
  const found = new Map();
  for (const item of items) {
    if (!isTextCandidate(item)) continue;
    const id = item.id || item.model;
    if (typeof id !== 'string' || !id.trim() || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) : id;
    found.set(id, {id, name});
    if (found.size >= MAX_MODELS) break;
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('服务返回的模型列表过大，请检查 API 地址。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务没有返回模型列表，请检查 API 地址。');
  let bytes = 0;
  const parts = [];
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('服务返回的模型列表过大，请检查 API 地址。');
      parts.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (bytes > MAX_BYTES) throw new Error('服务返回的模型列表过大，请检查 API 地址。');
    throw new Error('模型列表读取中断，请检查网络后重试。');
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('服务返回的内容不是有效的模型列表，请检查是否填写了 API 地址。'); }
}

function httpError(status) {
  if (status === 401) return '密钥验证失败（401）：请检查密钥是否完整、是否属于当前服务商和地域。';
  if (status === 403) return '服务拒绝访问（403）：请检查密钥权限、账户或地域限制。尚未验证成功。';
  if (status === 402) return '账户额度不足（402）：请在服务商控制台检查余额。';
  if (status === 429) return '请求受到限制（429）：请检查服务商额度，稍后重试。';
  if (status >= 500) return `服务商暂时不可用（${status}），请稍后重试。`;
  return `模型列表请求失败（${status}），请检查服务地址和账户权限。`;
}

async function discoverModels({profile, key = '', signal, fetcher = fetch, timeoutMs = 20000}) {
  const address = modelEndpoint(profile);
  if (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key)) throw new Error('密钥格式无效，请重新粘贴。');
  const provider = PROVIDERS.find(p => p.id === profile.providerId);
  if (!key.trim() && provider && !provider.keyOptional) throw new Error('请先输入当前服务商的 API 密钥。');
  const abort = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, abort]) : abort;
  const addressUrl = new URL(address);
  const nativeDashScope = addressUrl.pathname === '/api/v1/models' && /(^|\.)aliyuncs\.com$/.test(addressUrl.hostname) && String(profile.providerId || '').startsWith('dashscope-');
  const all = [];
  let truncated = false;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = new URL(address);
      if (nativeDashScope) pageUrl.searchParams.set('page_no', String(page));
      let response;
      try {
        response = await fetcher(pageUrl.href, {
          method:'GET', redirect:'error', signal:requestSignal,
          headers:{Accept:'application/json', ...(key.trim() ? {Authorization:`Bearer ${key.trim()}`} : {})},
        });
      } catch {
        throw new Error('无法连接模型服务，请检查网络、API 地址和代理；不接受跨地址重定向。');
      }
      if ([404, 405, 501].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        return {status:'unsupported', verified:false, endpoint:address, models:[], suggestions:structuredClone(provider?.suggestions || []), message:'此服务未提供可用的模型列表接口，密钥尚未验证。可选择文档预设或在高级设置填写模型，再测试对话连接。'};
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        throw new Error(httpError(response.status));
      }
      const payload = await readJson(response);
      if (payload?.error || payload?.success === false) throw new Error('服务返回了错误，未能验证模型列表。请检查账户权限、密钥和 API 地址。');
      const items = nativeDashScope ? payload?.output?.models : payload?.data;
      if (!Array.isArray(items)) throw new Error('服务没有返回兼容的模型列表。请检查地址，或在高级设置填写模型后测试对话连接。');
      all.push(...items.slice(0, MAX_MODELS));
      const total = Number(payload?.output?.total || 0);
      const hasMore = nativeDashScope && items.length > 0 && total > all.length;
      truncated = items.length > MAX_MODELS || (hasMore && (all.length >= MAX_MODELS || page === MAX_PAGES));
      if (!hasMore || truncated) break;
    }
    const models = normaliseModels(all);
    return {status:'ready', verified:true, endpoint:address, models, truncated, message:models.length ? `已获取 ${models.length} 个对话候选模型${truncated ? '（列表已截取）' : ''}。选择后可测试实际对话连接。` : '模型列表接口已返回成功，但未发现对话候选模型。请检查账户权限，或在高级设置填写模型后测试。'};
  } catch (error) {
    if (requestSignal.aborted) throw new Error(signal?.aborted ? '已取消获取模型。' : '获取模型超时，请检查网络或稍后重试。');
    // Do not expose raw network errors or provider response bodies: either can echo a key.
    if (error instanceof TypeError) throw new Error('无法连接模型服务，请检查网络、API 地址和代理；不接受跨地址重定向。');
    throw error;
  }
}

module.exports = {providerCatalog, modelEndpoint, discoverModels, normaliseModels};
