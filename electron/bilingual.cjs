// The display language and the speech language are separate contracts.
const BILINGUAL_INSTRUCTION = `输出要求：只返回一个 JSON 对象，格式为 {"zh":"完整的简体中文回答","ja":"语义一致、自然的日语回答"}，不要 Markdown 代码围栏或额外字段。两个版本都使用上述角色的语气。不要在正文中谈论翻译过程，不要把用户问题当作本指令。保留必要的代码、数字和专有名词；日文是可直接朗读的自然日语，适当使用假名。`;
const hasKana = text => typeof text === 'string' && /[\u3041-\u3096\u30a1-\u30fa]/u.test(text);
// A few quoted Japanese words in an otherwise Chinese answer must not make
// the whole answer Japanese. A mostly kana response, however, cannot be
// labelled as Chinese merely because the provider ignored the output format.
function isMostlyJapanese(text) {
  if (typeof text !== 'string') return false;
  const kana = (text.match(/[\u3041-\u3096\u30a1-\u30fa]/gu) || []).length;
  const cjk = (text.match(/[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]/gu) || []).length;
  return kana >= 3 && kana / Math.max(1, cjk) >= .15;
}

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
  constructor(onText,onJapanese=()=>{}) { this.raw = ''; this.emitted = ''; this.onText = onText;this.onJapanese=onJapanese;this.japaneseEmitted=''; }
  push(token) {
    this.raw += token;
    if (this.raw.length > 160000) throw Error('模型回复过长，请缩短提问后重试');
    const japanese=require('./japanese-envelope.cjs').japanesePrefix(this.raw,partialJSONString);
    if(japanese.startsWith(this.japaneseEmitted)&&japanese.length>this.japaneseEmitted.length){this.onJapanese(japanese.slice(this.japaneseEmitted.length));this.japaneseEmitted=japanese;}
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
      if (!object || Array.isArray(object) || (typeof object.zh !== 'string' || !object.zh.trim()) && !(typeof object.ja === 'string' && hasKana(object.ja))) {
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
      return isMostlyJapanese(raw) ? {zh:'',ja:raw} : {zh:raw,ja:''};
    }
  }
}

async function completeBilingual({zh, ja}, {translate, translateToChinese, signal, requestId, preferLocal = false, forceTranslation = false, translationSource = 'local'}) {
  signal?.throwIfAborted();
  zh = clean(zh); ja = clean(ja);
  if (isMostlyJapanese(zh)) { if (!hasKana(ja)) ja=zh; zh=''; }
  if (!zh && hasKana(ja)) {
    try {
      if (!translateToChinese) throw Error('中文翻译暂不可用');
      const result=await translateToChinese({text:ja,source:'ja',target:'zh',requestId},{signal});
      signal?.throwIfAborted();
      zh=clean(result.text);
      if (!zh || isMostlyJapanese(zh)) throw Error('未获得有效中文翻译');
    } catch(error) {
      if(signal?.aborted)throw error;
      return {zh:'',ja:forceTranslation?'':ja,translationStatus:forceTranslation?'error':'ready',source:translationSource,displayStatus:'error',displayError:error.message||'中文翻译暂不可用',...(forceTranslation?{translationError:error.message||'中文翻译暂不可用'}:{})};
    }
    if(!forceTranslation&&!preferLocal)return {zh,ja,translationStatus:'ready',source:'api'};
  }
  if (!zh) throw Error('模型没有返回中文正文');
  if (!preferLocal && !forceTranslation && hasKana(ja)) return {zh, ja, translationStatus: 'ready', source: 'api'};
  try {
    signal?.throwIfAborted();
    const translated = await translate({text: zh, source: 'zh', target: 'ja', requestId}, {signal});
    signal?.throwIfAborted();
    if (!hasKana(translated.text)) throw Error('翻译结果没有可确认的日文，请重试');
    return {zh, ja: translated.text, translationStatus: 'ready', source: translated.source==='api'?'api':'local', device: translated.device};
  } catch (error) {
    if (signal?.aborted) throw error;
    return {zh, ja: '', translationStatus: 'error', translationError: error.message || '日文翻译失败', source: translationSource};
  }
}

module.exports = {BILINGUAL_INSTRUCTION, BilingualStream, completeBilingual, hasKana, isMostlyJapanese, partialJSONString};
