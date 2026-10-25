// Recompute a stable spoken prefix: incomplete markup never leaks into speech.
export function spokenText(raw, final = false) {
  let out = '', i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);
    // A trailing ! may become the opening of ![image] in the next chunk.
    // Do not commit punctuation that could later disappear from spoken text.
    if (!final && raw[i] === '!' && i + 1 === raw.length) break;
    // Likewise, keep an unfinished URL scheme out of a length-based segment.
    if (!final && /^(?:h|ht|htt|http|https|http:|https:|http:\/|https:\/)$/.test(rest)) break;
    if (rest.startsWith('```') || rest.startsWith('~~~')) {
      const fence = rest.slice(0, 3), end = raw.indexOf(fence, i + 3);
      if (end < 0) break;
      i = end + 3; out += '\n'; continue;
    }
    if (raw[i] === '<') {
      const end = raw.indexOf('>', i);
      if (end < 0) break;
      const tag = raw.slice(i, end + 1);
      const hidden = /^<(think|analysis|reasoning|action)(?:\s[^>]*)?>$/i.exec(tag);
      if (hidden) {
        const closing = new RegExp(`</${hidden[1]}\\s*>`, 'ig'); closing.lastIndex = end + 1;
        const match = closing.exec(raw);
        if (!match) break;
        i = match.index + match[0].length; continue;
      }
      i = end + 1; continue;
    }
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end < 0) break;
      i = end + 1; continue;
    }
    if (raw[i] === '[' || rest.startsWith('![')) {
      const image = rest.startsWith('!['), start = i + (image ? 2 : 1);
      const end = raw.indexOf(']', start);
      if (end < 0) { if (final) out += raw.slice(start); break; }
      if (end + 1 === raw.length && !final) break;
      if (raw[end + 1] === '(') {
        const close = raw.indexOf(')', end + 2);
        if (close < 0) break;
        if (!image) out += raw.slice(start, end);
        i = close + 1; continue;
      }
      out += raw.slice(start, end); i = end + 1; continue;
    }
    if (/^https?:\/\//.test(rest)) {
      // Chinese prose commonly follows a URL without a space. Keep its
      // punctuation/suffix, while allowing ASCII query and fragment syntax.
      const end = rest.search(/[\s<>，。！？；：、…“”‘’]/u);
      if (end < 0) break;
      i += end; continue;
    }
    out += raw[i++];
  }
  return out.replace(/^[ \t]*(?:#{1,6}|>|[-+*]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_~]/g, '').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n');
}

export class SentenceStream {
  constructor(max = 180) { this.raw = ''; this.cursor = 0; this.max = max; }
  push(chunk, final = false) {
    this.raw += chunk;
    if (this.raw.length > 100000) throw Error('回复过长，已停止自动朗读；文字仍可继续显示。');
    const text = spokenText(this.raw, final), result = [];
    let start = this.cursor;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      const terminal = /[。！？!?；;\n]/.test(c) || (c === '.' && (i + 1 < text.length || final) && !/\d/.test(text[i + 1] || '') && /\s|$/.test(text[i + 1] || ''));
      const limit = i - start >= this.max && !/[\uD800-\uDBFF]/.test(c);
      if (terminal || limit) { const s = text.slice(start, i + 1).trim(); if (/[\p{L}\p{N}]/u.test(s)) result.push(s); start = i + 1; }
    }
    if (final) { const s = text.slice(start).trim(); if (/[\p{L}\p{N}]/u.test(s)) result.push(s); start = text.length; }
    this.cursor = start;
    return result;
  }
}

const hasKana = text => /[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/u.test(text);

// Keep one sentence in reserve: 「了解。」 belongs with a nearby complete
// Japanese sentence rather than failing the worker's conservative language gate.
// No text is dropped or replayed when joining; impossible >500-character runs
// fail explicitly and the conversation remains available as written text.
export class JapaneseSentenceStream {
  constructor(max = 500) {
    if (!Number.isInteger(max) || max < 2 || max > 500) throw Error('日语语音片段上限必须为 2–500 字符');
    this.max = max; this.stream = new SentenceStream(Math.min(180, max - 1)); this.pending = '';
  }
  push(chunk, final = false) {
    const result = [];
    for (const segment of this.stream.push(chunk, final)) {
      if (this.pending && hasKana(this.pending) && hasKana(segment)) {
        result.push(this.pending); this.pending = segment;
      } else if (this.pending.length + segment.length <= this.max) {
        this.pending += segment;
      } else if (hasKana(this.pending)) {
        result.push(this.pending); this.pending = segment;
      } else {
        throw Error('连续无假名文字过长，无法组成完整日语语音片段；已停止朗读，文字仍完整保留。');
      }
    }
    if (final && this.pending) {
      if (!hasKana(this.pending)) throw Error('译文包含无法独立朗读的无假名片段；已停止朗读，文字仍完整保留。');
      result.push(this.pending); this.pending = '';
    }
    return result;
  }
}
