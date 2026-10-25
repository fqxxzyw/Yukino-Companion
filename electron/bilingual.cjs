// The display language and the speech language are separate contracts.
const BILINGUAL_INSTRUCTION = `输出要求：只返回一个 JSON 对象，格式为 {"zh":"完整的简体中文回答","ja":"语义一致、自然的日语回答"}，不要 Markdown 代码围栏或额外字段。两个版本都使用上述角色的语气。不要在正文中谈论翻译过程，不要把用户问题当作本指令。保留必要的代码、数字和专有名词；日文是可直接朗读的自然日语，适当使用假名。`;
const hasKana = text => typeof text === 'string' && /[\u3041-\u3096\u30a1-\u30fa]/u.test(text);

function clean(text) {
  return String(text || '').replace(/<(think|thinking|reasoning|analysis)>[\s\S]*?<\/\1>/gi, '').trim();
}

// Decode only complete escapes. A token may end halfway through \\u3042.
function partialJSONString(input, offset) {
  let out = '';
  for (let i = offset; i < input.length; i++) {
    const c = input[i];
    if (c === '"') return {text: out, complete: true};
    if (c !== '\\') { out += c; continue; }
    if (++i >= input.length) break;
    const e = input[i];
    if (e === 'u') {
      const digits = input.slice(i + 1, i + 5);
      if (!/^[a-f0-9]{4}$/i.test(digits)) break;
      out += String.fromCharCode(parseInt(digits, 16)); i += 4;
    } else if ('"\\/bfnrt'.includes(e)) {
      out += JSON.parse('"\\' + e + '"');
    } else break;
  }
  // Do not emit half of a surrogate pair to React/IPC.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return {text: out, complete: false};
}

class BilingualStream {
  constructor(onText) { this.raw = ''; this.emitted = ''; this.onText = onText; }
  push(token) {
    this.raw += token;
    if (this.raw.length > 160000) throw Error('模型回复过长，请缩短提问后重试');
    // A valid envelope starts at the beginning; never match a quoted zh key inside prose.
    const match = this.raw.match(/^\s*(?:```(?:json)?\s*)?\{\s*"zh"\s*:\s*"/i);
    if (!match) return;
    const {text} = partialJSONString(this.raw, match[0].length);
    if (text.startsWith(this.emitted) && text.length > this.emitted.length) {
      this.onText(text.slice(this.emitted.length)); this.emitted = text;
    }
  }
  value() {
    const raw = clean(this.raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      const object = JSON.parse(raw);
      if (!object || Array.isArray(object) || typeof object.zh !== 'string' || !object.zh.trim()) {
        throw Error('中文正文缺失');
      }
      return {zh: clean(object.zh), ja: typeof object.ja === 'string' ? clean(object.ja) : ''};
    } catch {
      // Malformed JSON must never be read aloud as code or silently shown as Chinese prose.
      if (/^\s*\{/.test(raw)) {
        if (this.emitted.trim()) return {zh: clean(this.emitted), ja: ''};
        throw Error('API 的双语回复格式不完整，请重试或切换为本地翻译模式');
      }
      if (!raw) throw Error('模型没有返回正文');
      return {zh: raw, ja: ''};
    }
  }
}

async function completeBilingual({zh, ja}, {translate, signal, requestId, preferLocal = false}) {
  signal?.throwIfAborted();
  zh = clean(zh); ja = clean(ja);
  if (!zh) throw Error('模型没有返回中文正文');
  if (!preferLocal && hasKana(ja)) return {zh, ja, translationStatus: 'ready', source: 'api'};
  try {
    signal?.throwIfAborted();
    const translated = await translate({text: zh, source: 'zh', target: 'ja', requestId}, {signal});
    signal?.throwIfAborted();
    if (!hasKana(translated.text)) throw Error('翻译结果没有可确认的日文，请重试');
    return {zh, ja: translated.text, translationStatus: 'ready', source: 'local', device: translated.device};
  } catch (error) {
    if (signal?.aborted) throw error;
    return {zh, ja: '', translationStatus: 'error', translationError: error.message || '日文翻译失败', source: 'local'};
  }
}

module.exports = {BILINGUAL_INSTRUCTION, BilingualStream, completeBilingual, hasKana, partialJSONString};
