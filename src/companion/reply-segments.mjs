// This is a presentation-only transformation: keep the original reply for
// persistence, copying, translation, and speech.
const CLOSERS = new Set([...'”’」』）》】〕)]}']);
const OPENERS = {'“':'”','‘':'’','「':'」','『':'』','（':'）','(' : ')'};
const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$/i;

function hasStructuredMarkup(text) {
  // Cutting Markdown through syntax changes its meaning. Leave such messages
  // intact rather than guessing where a rich block or inline span ends.
  return /```|~~~|`|\*\*|__|~~|\[[^\]]*\]\([^\n)]*\)|!\[[^\]]*\]|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/m.test(text);
}

function protectedPositions(text) {
  const protectedSet = new Set();
  // Keep punctuation in network addresses and email addresses intact.
  const token = /(?:https?:\/\/|www\.)[^\s<>。！？]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gi;
  for (const match of text.matchAll(token)) {
    let end = match.index + match[0].length;
    // Sentence punctuation after an address is not part of the address.
    while (end > match.index && /[。！？!?，,；;：:]/u.test(text[end - 1])) end--;
    if (text[end - 1] === '.' && (end === text.length || /\s/.test(text[end]))) end--;
    for (let i = match.index; i < end; i++) protectedSet.add(i);
  }
  return protectedSet;
}

// If an unusually long clause has no punctuation, prefer word boundaries.
// Do not cut a URL, an English word, a number, emoji, or an open quotation.
function splitOversized(text) {
  if ([...text].length <= 54 || typeof Intl.Segmenter !== 'function') return [text];
  const protectedSet = protectedPositions(text);
  const wordBoundaries = new Set([...new Intl.Segmenter('zh', {granularity:'word'}).segment(text)].map(item => item.index));
  const graphemes = [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text)];
  const quoteStack = [];
  const chunks = [];
  let start = 0, startGrapheme = 0, count = 0, candidate = -1, candidateGrapheme = 0;
  for (let i = 0; i < graphemes.length; i++) {
    const {segment, index} = graphemes[i];
    if (OPENERS[segment]) quoteStack.push(OPENERS[segment]);
    else if (quoteStack.at(-1) === segment) quoteStack.pop();
    count++;
    const next = graphemes[i + 1]?.index ?? text.length;
    if (count >= 22 && !quoteStack.length && !protectedSet.has(index) && !protectedSet.has(next) && wordBoundaries.has(next)) { candidate = next; candidateGrapheme = i + 1; }
    if (count >= 48 && candidate > start && next < text.length) {
      chunks.push(text.slice(start, candidate).trim());
      start = candidate;
      startGrapheme = candidateGrapheme;
      count = i + 1 - startGrapheme;
      candidate = -1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) chunks.push(tail);
  return chunks.filter(Boolean);
}

/** Split an assistant reply for display without changing the original. */
export function splitLocalReply(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  if (hasStructuredMarkup(text)) return [text];
  const protectedSet = protectedPositions(text);
  const result = [];
  const quoteStack = [];
  let segment = '';
  const flush = () => { const s = segment.trim(); if (s) result.push(s); segment = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (OPENERS[ch]) quoteStack.push(OPENERS[ch]);
    else if (quoteStack.at(-1) === ch) quoteStack.pop();
    if (ch === '\n') { flush(); continue; }
    if (protectedSet.has(i)) { segment += ch; continue; }
    const period = ch === '。' || ch === '.';
    const ending = period || /[！？!?]/u.test(ch);
    if (ending) {
      // Repeated periods and ellipses express a pause, not ordinary stops.
      if (ch === '.' && (text[i - 1] === '.' || text[i + 1] === '.')) { segment += ch; continue; }
      if (ch === '.' && ((/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) || ABBREVIATIONS.test(segment + ch) || (text[i + 1] && !/\s/.test(text[i + 1]) && !CLOSERS.has(text[i + 1])))) { segment += ch; continue; }
      // A sentence break inside a still-open quote would leave mismatched
      // quote marks in separate bubbles; wait until its closing mark.
      let endPunctuation = i + 1;
      while (/[！？!?]/u.test(text[endPunctuation] ?? '')) endPunctuation++;
      if (quoteStack.length && text[endPunctuation] !== quoteStack.at(-1)) { segment += ch; continue; }
      // Keep expressive punctuation, but suppress an ordinary sentence stop.
      if (!period || quoteStack.length) segment += ch;
      while (i + 1 < text.length && /[！？!?]/u.test(text[i + 1])) segment += text[++i];
      while (i + 1 < text.length && CLOSERS.has(text[i + 1])) { const closer=text[++i]; segment += closer; if (quoteStack.at(-1) === closer) quoteStack.pop(); }
      flush();
      continue;
    }
    segment += ch;
    // Long unbroken messages may be split at natural pauses; short clauses
    // stay together, avoiding a stream of single-word bubbles.
    if (segment.trim().length >= 22 && !quoteStack.length && /[，,；;]/u.test(ch) && !(ch===',' && /\d/.test(text[i-1] ?? '') && /\d/.test(text[i+1] ?? ''))) flush();
  }
  flush();
  return result.flatMap(splitOversized);
}
