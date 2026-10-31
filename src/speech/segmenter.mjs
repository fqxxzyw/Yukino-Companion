// Incremental plain-text segmentation only: markup/language extraction belongs to
// the caller. With preservePunctuation=true, outputs concatenate to the exact input.
// Rules: no trimming/whitespace normalization; preservePunctuation=false removes
// only punctuation actually selected as a boundary (not quoted/URL/numeric marks).
// Strong terminals commit immediately; ambiguous '.' needs right context/final.
// Available punctuation runs stay together, but later deltas cannot amend output.
// Short merging uses only already available sentences, never a reserved first one.
// Adaptive commas need min and 0.75*target (ja/zh), or target (en); auto uses the
// segment's kana/Han evidence. Parentheses/quotes suppress punctuation cuts until
// closing, but mandatory length/buffer safety cuts can cross an overlong wrapper.
// Budgets use grapheme weights below. Ordinary English words are kept whole;
// pathological tokens/URLs may cross the budget until a raw buffer safety cut.
// Total accepted input <=100000 UTF-16 units; buffer <=max(256, 8*max), nesting<=64.
// A fatal structural error stops the stream; argument/total-limit checks are atomic.
const DEFAULTS = Object.freeze({
  minSegmentChars: 8, targetSegmentChars: 35, maxSegmentChars: 80,
  splitOnComma: 'adaptive', mergeShortSegments: true,
  preservePunctuation: true, language: 'auto',
});
const TOTAL_LIMIT = 100000; // UTF-16 code units, including already emitted text.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letter = c => !!c && /\p{L}/u.test(c);
const digit = c => !!c && /\p{N}/u.test(c);
const cjk = c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c);
const weak = c => /^[，,、：:]$/u.test(c);
const strong = c => /^[。！？!?；;\n\r…]$/u.test(c);
const runPunctuation = c => strong(c) || c === '.';
const pairs = new Map([
  ['(', ')'], ['（', '）'], ['[', ']'], ['［', '］'], ['{', '}'],
  ['【', '】'], ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'],
]);
const quoteOpeners = new Set(['「', '『', '“', '‘', '"', "'"]);
const urlStop = /[\s<>"“”‘’「」『』（）【】。！？；，、：…]/u;

/** Validate without coercion; unknown keys are deliberately not copied. */
export function normalizeSegmentation(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Segmentation config must be an object');
  }
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = config[key] === undefined ? DEFAULTS[key] : config[key];
  for (const key of ['minSegmentChars', 'targetSegmentChars', 'maxSegmentChars']) {
    if (!Number.isInteger(out[key]) || out[key] < 1 || out[key] > 4096) {
      throw new RangeError(`${key} must be an integer in 1–4096`);
    }
  }
  if (out.minSegmentChars > out.targetSegmentChars || out.targetSegmentChars > out.maxSegmentChars) {
    throw new RangeError('Expected minSegmentChars <= targetSegmentChars <= maxSegmentChars');
  }
  if (!['adaptive', 'never', 'always'].includes(out.splitOnComma)) throw new RangeError('Invalid splitOnComma');
  if (!['auto', 'ja', 'zh', 'en'].includes(out.language)) throw new RangeError('Invalid segmentation language');
  for (const key of ['mergeShortSegments', 'preservePunctuation']) {
    if (typeof out[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  }
  return Object.freeze(out);
}

// Latin letters cost 1/4 of a CJK grapheme, numbers 1/2, whitespace 1/4.
// Thus maxSegmentChars is a spoken-length budget, not an 80-byte English axe.
function weight(text) {
  if (/^\s+$/u.test(text)) return 0.25;
  if (/^\p{Script=Latin}[\p{M}]*$/u.test(text)) return 0.25;
  if (/^\p{N}$/u.test(text)) return 0.5;
  return 1;
}

function urlRanges(text, continuation, final) {
  const ranges = [];
  let from = 0;
  if (continuation) {
    let end = 0;
    while (end < text.length && !urlStop.test(text[end])) end++;
    if (end) ranges.push({ start: 0, end, open: end === text.length });
    from = end;
  }
  const re = /\b(?:https?:\/\/|www\.)/giu;
  re.lastIndex = from;
  let match;
  while ((match = re.exec(text))) {
    let end = re.lastIndex;
    while (end < text.length && !urlStop.test(text[end])) end++;
    ranges.push({ start: match.index, end, open: end === text.length });
    re.lastIndex = end;
  }
  // A scheme may itself arrive in several deltas; ':' must not become a comma cut.
  const partial = /\bhttps?:\/{0,2}$/iu.exec(text);
  if (partial && !ranges.some(r => partial.index >= r.start && partial.index < r.end)) {
    ranges.push({ start: partial.index, end: text.length, open: true });
  }
  for (const range of ranges) {
    // A prose wrapper is not part of a URL, but balanced URL path parentheses
    // remain protected (https://host/a(b)). This also closes an outer quote stack.
    while (/[)\]}]/u.test(text[range.end - 1] || '')) {
      const close = text[range.end - 1], open = close === ')' ? '(' : close === ']' ? '[' : '{';
      const body = text.slice(range.start, range.end);
      if (body.split(close).length <= body.split(open).length) break;
      range.end--; range.open = false;
    }
    if (!range.open || final) {
      // Conventional prose trailing punctuation is not part of the URL. Query
      // punctuation in the middle remains protected, including '?', ';', ','.
      while (range.end > range.start && /[.!?;,]/u.test(text[range.end - 1])) range.end--;
      range.open = false;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function abbreviation(text, offset) {
  const prefix = text.slice(Math.max(0, offset - 40), offset + 1);
  return /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|Fig|No|Inc|Ltd)\.$/iu.test(prefix)
    || /\b(?:[A-Za-z]\.)+$/u.test(prefix)
    || /\b(?:Ph\.D|a\.m|p\.m)\.$/iu.test(prefix);
}

/**
 * push(delta, final=false) -> string[]. Empty final pushes are idempotent;
 * subsequent nonempty pushes fail. No full-response history is retained.
 * bufferedChars / totalChars are read-only UTF-16 counts for diagnostics.
 */
export class SmartSentenceStream {
  constructor(config = {}) {
    this.config = normalizeSegmentation(config);
    this.buffer = '';
    this.context = { stack: [], url: false };
    this.total = 0;
    this.emitted = 0;
    this.finished = false;
    this.failure = null;
    // A pathological word/URL or grapheme may exceed the spoken budget, but
    // never this raw buffer cap. A single unbounded grapheme fails explicitly.
    this.maxBufferedChars = Math.max(256, this.config.maxSegmentChars * 8);
  }
  get bufferedChars() { return this.buffer.length; }
  get totalChars() { return this.total; }

  push(delta, final = false) {
    if (typeof delta !== 'string') throw new TypeError('delta must be a string');
    if (typeof final !== 'boolean') throw new TypeError('final must be boolean');
    if (this.failure) throw this.failure;
    if (this.finished) {
      if (delta) throw new Error('Sentence stream is already finalized');
      return [];
    }
    if (this.total + delta.length > TOTAL_LIMIT) throw new RangeError(`Sentence stream exceeds ${TOTAL_LIMIT} UTF-16 code units`);
    const result = [];
    this.total += delta.length;
    try {
      let offset = 0;
      while (offset < delta.length) {
        const room = this.maxBufferedChars - this.buffer.length;
        if (!room) throw new RangeError('A single grapheme exceeds the segmentation buffer limit');
        const size = Math.min(room, delta.length - offset);
        this.buffer += delta.slice(offset, offset + size);
        offset += size;
        this.drain(final && offset === delta.length, result);
      }
      if (!delta.length) this.drain(final, result);
      if (final) this.finished = true;
      return result;
    } catch (error) {
      // A fatal structural error can occur after local cuts. Never allow a retry
      // to silently skip or replay those cuts; callers must create a new stream.
      this.failure = error;
      this.buffer = '';
      this.context = { stack: [], url: false };
      throw error;
    }
  }

  drain(final, result) {
    while (this.buffer) {
      const cut = this.findCut(final);
      if (!cut) break;
      let text = this.buffer.slice(0, cut.end);
      if (!this.config.preservePunctuation) {
        for (let i = cut.remove.length - 1; i >= 0; i--) {
          const [start, end] = cut.remove[i];
          // Newlines/CRLF remain exact whitespace even when punctuation is off.
          text = text.slice(0, start) + text.slice(start, end).replace(/[^\s]/gu, '') + text.slice(end);
        }
      }
      this.buffer = this.buffer.slice(cut.end);
      this.context = cut.state;
      if (text) { result.push(text); this.emitted++; }
    }
  }

  findCut(final) {
    const text = this.buffer, config = this.config;
    if (final && /[\uD800-\uDBFF]$/.test(text)) throw new RangeError('Input ends in an incomplete surrogate');
    const units = Array.from(graphemes.segment(text), item => ({ text: item.segment, start: item.index, end: item.index + item.segment.length }));
    // An unfinished final grapheme can absorb a combining mark, VS16, emoji
    // modifier, ZWJ suffix, or a low surrogate in the next delta. Terminal ASCII/
    // CJK punctuation is allowed through immediately for low first-audio latency.
    let count = units.length;
    if (!final && count && !/^[。！？!?；;，,、：:.…\n\r)）\]］}】」』”’"']+$/u.test(units[count - 1].text)) count--;
    if (!final && count && units[count - 1].text === '\r') count--;
    // A dangling high surrogate can become an emoji modifier / astral combining
    // mark, so the grapheme BEFORE that surrogate is not stable either.
    if (!final && /[\uD800-\uDBFF]$/.test(text)) count = Math.max(0, Math.min(count, units.length - 2));
    if (count && /[\uD800-\uDBFF]$/.test(units[count - 1].text)) count--;
    if (!count) {
      if (final && units.length) throw new RangeError('Input ends in an incomplete surrogate');
      return null;
    }
    const ranges = urlRanges(text, this.context.url, final);
    const stack = this.context.stack.map(frame => ({ ...frame }));
    const state = end => ({
      stack: stack.map(frame => ({ ...frame })),
      url: ranges.some(range => range.start < end && (end < range.end || (end === range.end && range.open))),
    });
    let cost = 0, first = null, safe = null, within = null;
    const removals = [];
    let seenKana = false, seenHan = false;
    const candidate = (end, removeStart = end, removeEnd = end) => {
      if (removeEnd > removeStart) removals.push([removeStart, removeEnd]);
      const cut = { end, state: state(end), remove: removals.slice(), cost };
      // Never retain a complete first sentence just to find a longer neighbour.
      if (!config.mergeShortSegments || !this.emitted || cost >= config.minSegmentChars) return cut;
      if (!first) first = cut;
      return null;
    };
    for (let i = 0; i < count; i++) {
      const unit = units[i], c = unit.text;
      const previous = i ? units[i - 1].text : '';
      const next = units[i + 1]?.text || '';
      const protectedURL = ranges.some(range => unit.start >= range.start && unit.start < range.end);
      cost += weight(c);
      seenKana ||= /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c);
      seenHan ||= /\p{Script=Han}/u.test(c);
      let quoteBoundary = false;
      if (!protectedURL) {
        const apostrophe = (c === "'" || c === '’') && letter(previous) && (!next || letter(next));
        if (!apostrophe && stack.length && stack[stack.length - 1].close === c) {
          const closed = stack.pop();
          quoteBoundary = !stack.length && closed.quote && closed.terminal;
        } else if (!apostrophe && (pairs.has(c) || c === '"' || c === "'")) {
          if (stack.length >= 64) throw new RangeError('Quote/bracket nesting exceeds 64 levels');
          stack.push({ close: pairs.get(c) || c, quote: quoteOpeners.has(c), terminal: false });
        }
      }
      let terminal = !protectedURL && strong(c);
      if (c === '\r\n') terminal = !protectedURL;
      if (!protectedURL && c === '.') {
        const decimal = digit(previous) && digit(next);
        const internal = (letter(previous) || digit(previous)) && (letter(next) || digit(next));
        const dots = text.slice(unit.start).match(/^\.{3,}/u);
        terminal = !!dots || (!decimal && !internal && !abbreviation(text, unit.start)
          && (!!next || final) && (!next || /\s|["'”’」』)）\]}】]/u.test(next) || cjk(next)));
      }
      if (terminal && stack.length) {
        // A terminal inside brackets must not split their contents. Only a
        // completed outer quotation can promote it to a sentence boundary.
        for (const frame of stack) frame.terminal = true;
      }
      if ((terminal && !stack.length) || quoteBoundary) {
        let end = unit.end;
        const removeStart = quoteBoundary ? end : unit.start;
        // Keep punctuation runs together when they are already available. Runs
        // split across pushes cannot retroactively amend an emitted segment.
        while (i + 1 < count && runPunctuation(units[i + 1].text)
          && !ranges.some(range => units[i + 1].start >= range.start && units[i + 1].start < range.end)) {
          const following = units[i + 1];
          if (following.text === '.' && digit(units[i + 2]?.text)) break;
          if (cost + weight(following.text) > config.maxSegmentChars) break;
          cost += weight(following.text); end = following.end; i++;
        }
        if (cost > config.maxSegmentChars && first) return first;
        const cut = candidate(end, removeStart, end);
        if (cut) return cut;
      } else if (!protectedURL && !stack.length && weak(c)) {
        const numeric = digit(previous) && (digit(next) || (!next && !final));
        const language = config.language === 'auto' ? (seenKana ? 'ja' : seenHan ? 'zh' : 'en') : config.language;
        const threshold = Math.max(config.minSegmentChars, config.targetSegmentChars * (language === 'en' ? 1 : 0.75));
        if (!numeric && config.splitOnComma !== 'never'
          && (config.splitOnComma === 'always' || cost >= threshold)) {
          if (cost > config.maxSegmentChars && first) return first;
          const cut = candidate(unit.end, unit.start, unit.end);
          if (cut) return cut;
        }
      }
      // Word-safe cuts also work within an overlong quote, retaining its stack.
      // They are never allowed in a protected URL or between Latin word letters.
      const wordPart = letter(c) || digit(c) || /^['’.,_:/#?=&%+\-]$/u.test(c);
      const wordBoundary = !protectedURL && (/^\s+$/u.test(c) || cjk(c) || !wordPart);
      const point = { end: unit.end, state: state(unit.end), remove: removals.slice(), cost };
      if (cost <= config.maxSegmentChars) within = point;
      if (wordBoundary && cost <= config.maxSegmentChars) safe = point;
      if (cost >= config.maxSegmentChars) {
        if (first) return first;
        if (safe) return safe;
        // A normal word crossing the budget is kept whole. Pathologically long
        // tokens/URLs use the bounded emergency path below instead.
        if (wordBoundary) return point;
      }
      if (!stack.length && !protectedURL && /^\s+$/u.test(c) && cost >= config.targetSegmentChars) {
        if (first) return first;
        return point;
      }
      if (text.length >= this.maxBufferedChars && i + 1 === count) return first || within || point;
    }
    if (final) {
      return { end: text.length, state: { stack: [], url: false }, remove: removals, cost };
    }
    return first;
  }
}
