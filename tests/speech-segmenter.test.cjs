const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/speech/segmenter.mjs');
const tiny = { minSegmentChars: 1, targetSegmentChars: 10, maxSegmentChars: 20, mergeShortSegments: false };

async function streamed(text, size = 1, config = {}) {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream(config), result = [];
  for (let i = 0; i < text.length; i += size) result.push(...stream.push(text.slice(i, i + size)));
  result.push(...stream.push('', true));
  return { result, stream };
}
function assertGraphemeBoundaries(text, segments) {
  const boundaries = new Set([0]);
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) boundaries.add(part.index + part.segment.length);
  let end = 0;
  for (const segment of segments) { end += segment.length; assert.ok(boundaries.has(end), `invalid grapheme boundary at ${end}`); }
}

test('normalization supplies immutable defaults and drops unrelated settings', async () => {
  const { normalizeSegmentation } = await modulePromise;
  const config = normalizeSegmentation({ unused: true });
  assert.deepEqual(config, { minSegmentChars: 8, targetSegmentChars: 35, maxSegmentChars: 80, splitOnComma: 'adaptive', mergeShortSegments: true, preservePunctuation: true, language: 'auto' });
  assert.ok(Object.isFrozen(config));
  assert.equal(normalizeSegmentation({ minSegmentChars: undefined }).minSegmentChars, 8);
});

test('bad budgets, enum values and coercible settings are rejected', async () => {
  const { normalizeSegmentation } = await modulePromise;
  for (const config of [null, [], 'auto', 8]) assert.throws(() => normalizeSegmentation(config), TypeError);
  for (const config of [
    { minSegmentChars: 0 }, { minSegmentChars: -1 }, { targetSegmentChars: 2.5 },
    { maxSegmentChars: NaN }, { maxSegmentChars: Infinity }, { maxSegmentChars: 4097 },
    { minSegmentChars: 36 }, { maxSegmentChars: 34 }, { minSegmentChars: '8' },
    { splitOnComma: 'sometimes' }, { language: 'fr' },
    { mergeShortSegments: 1 }, { preservePunctuation: 'false' },
  ]) assert.throws(() => normalizeSegmentation(config), undefined, JSON.stringify(config));
  assert.equal(normalizeSegmentation({ minSegmentChars: 1, targetSegmentChars: 1, maxSegmentChars: 1 }).maxSegmentChars, 1);
});

test('strong Chinese/Japanese punctuation submits short first audio immediately', async () => {
  const { SmartSentenceStream } = await modulePromise;
  for (const phrase of ['嗯。', 'はい！', '好！', 'え？', 'OK!', '了解；', '好了\n']) {
    const stream = new SmartSentenceStream();
    assert.deepEqual(stream.push(phrase), [phrase]);
    assert.deepEqual(stream.push('', true), []);
  }
});

test('strong punctuation runs stay together when available, with no duplication across deltas', async () => {
  const { SmartSentenceStream } = await modulePromise;
  assert.deepEqual(new SmartSentenceStream(tiny).push('你好？！……再见!!!后续...', true), ['你好？！……', '再见!!!', '后续...']);
  const text = '你好？！……再见!!!后续...\r\n下一行；끝';
  for (let size = 1; size <= 12; size++) {
    const { result } = await streamed(text, size, tiny);
    assert.equal(result.join(''), text, `chunk size ${size}`);
  }
});

test('ASCII sentence periods need right context while ellipses are strong boundaries', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream(tiny);
  assert.deepEqual(stream.push('Hello.'), []);
  assert.deepEqual(stream.push(' Next'), ['Hello.']);
  assert.deepEqual(stream.push('', true), [' Next']);
  assert.deepEqual(new SmartSentenceStream(tiny).push('Wait...'), ['Wait...']);
  assert.deepEqual(new SmartSentenceStream(tiny).push('待って……'), ['待って……']);
});

test('small complete sentences merge only when already available; no reserved first sentence', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream();
  assert.deepEqual(stream.push('好。'), ['好。']);
  assert.deepEqual(stream.push('嗯。'), ['嗯。']);
  const together = new SmartSentenceStream().push('好。嗯。对。知道了。', true);
  assert.deepEqual(together, ['好。', '嗯。对。知道了。']);
  assert.deepEqual(new SmartSentenceStream({ mergeShortSegments: false }).push('好。嗯。对。', true), ['好。', '嗯。', '对。']);
});

test('weak punctuation supports always, never and language-adaptive thresholds', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const text = '前半，后半：再来、尾部';
  assert.deepEqual(new SmartSentenceStream({ ...tiny, splitOnComma: 'always' }).push(text, true), ['前半，', '后半：', '再来、', '尾部']);
  assert.deepEqual(new SmartSentenceStream({ ...tiny, splitOnComma: 'never' }).push(text, true), [text]);
  const adaptive = { minSegmentChars: 2, targetSegmentChars: 12, maxSegmentChars: 40, mergeShortSegments: false };
  assert.deepEqual(new SmartSentenceStream({ ...adaptive, language: 'zh' }).push('中'.repeat(9) + '，尾部', true), ['中'.repeat(9) + '，', '尾部']);
  assert.deepEqual(new SmartSentenceStream({ ...adaptive, language: 'ja' }).push('あ'.repeat(9) + '、続き', true), ['あ'.repeat(9) + '、', '続き']);
  assert.deepEqual(new SmartSentenceStream({ ...adaptive, language: 'en' }).push('hello, world', true), ['hello, world']);
});

test('nested quotation and brackets suppress internal sentence/comma splits', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const config = { ...tiny, targetSegmentChars: 80, maxSegmentChars: 80, splitOnComma: 'always' };
  const cases = [
    ['他说（先等！再想，最后走）。尾', ['他说（先等！再想，最后走）。', '尾']],
    ['「本当？！『はい。』いいよ！」次。', ['「本当？！『はい。』いいよ！」', '次。']],
    ['She said “Really?! Yes!” Then left.', ['She said “Really?! Yes!”', ' Then left.']],
    ['A [nested (why? yes!), item] done.', ['A [nested (why? yes!), item] done.']],
  ];
  for (const [text, expected] of cases) assert.deepEqual(new SmartSentenceStream(config).push(text, true), expected);
  const quote = new SmartSentenceStream(config);
  assert.deepEqual(quote.push('「はい！'), []);
  assert.deepEqual(quote.push('」'), ['「はい！」']);
});

test('apostrophes are not quote openers, including curly apostrophes and possessives', async () => {
  const text = "Don't stop! It’s fine. James' book is here. 'Yes!'";
  const { result } = await streamed(text, 1, { ...tiny, maxSegmentChars: 80 });
  assert.equal(result.join(''), text);
  assert.ok(result.includes("Don't stop!"));
  assert.ok(result.some(part => part.includes('It’s fine.')));
});

test('URLs, split schemes, query punctuation and balanced URL paths are protected', async () => {
  const cases = [
    '链接 https://example.test/a.b?q=x,y:z;w=1.2#frag。继续。',
    'See https://example.test/path?q=hello,world&n=3.14! Then continue.',
    '详情：www.example.test/a?x=1，下一句。',
    '请看（https://example.test/a(b)）。后续。',
    'Here (https://example.test/a). Next.',
  ];
  for (const text of cases) {
    for (const size of [1, 2, 3, 7, 19]) {
      const { result } = await streamed(text, size, { ...tiny, targetSegmentChars: 30, maxSegmentChars: 80, splitOnComma: 'always' });
      assert.equal(result.join(''), text, `${size}: ${text}`);
      const url = /(?:https?:\/\/|www\.)[^\s。），]+/u.exec(text)?.[0];
      if (url) assert.ok(result.some(part => part.includes(url)), `URL split at chunk size ${size}: ${JSON.stringify(result)}`);
    }
  }
});

test('decimal, date, version, time, thousands and abbreviation tokens do not create false boundaries', async () => {
  const text = 'Dr. Smith paid 1,234.56 at 12:30 on 2026.10.31, e.g. in the U.S. office; Then Prof. Jones left. 尾句。';
  for (const size of [1, 2, 5, 11, text.length]) {
    const { result } = await streamed(text, size, { minSegmentChars: 1, targetSegmentChars: 300, maxSegmentChars: 400, mergeShortSegments: false, splitOnComma: 'never' });
    assert.deepEqual(result, ['Dr. Smith paid 1,234.56 at 12:30 on 2026.10.31, e.g. in the U.S. office;', ' Then Prof. Jones left.', ' 尾句。']);
  }
  const { result } = await streamed('价格3.14，日期2026.10.31：还有1,234和12:30。', 1, { ...tiny, targetSegmentChars: 40, maxSegmentChars: 80, splitOnComma: 'always' });
  assert.equal(result.join(''), '价格3.14，日期2026.10.31：还有1,234和12:30。');
  for (const token of ['3.14', '2026.10.31', '1,234', '12:30']) assert.ok(result.some(part => part.includes(token)), token);
});

test('budget edges do not split decimal/date/abbreviation tokens', async () => {
  const text = '前缀很长 2026.10.31 3.1415926 U.S. office 12:30 1,234.56 done';
  const { result } = await streamed(text, 1, { minSegmentChars: 1, targetSegmentChars: 5, maxSegmentChars: 8, mergeShortSegments: false, splitOnComma: 'never' });
  assert.equal(result.join(''), text);
  for (const token of ['2026.10.31', '3.1415926', 'U.S.', '12:30', '1,234.56']) assert.ok(result.some(part => part.includes(token)), `${token}: ${JSON.stringify(result)}`);
});

test('English no-punctuation output uses weighted word boundaries rather than an 80-character axe', async () => {
  const text = ('Extraordinary English sentences should retain every complete word while the stream continues without punctuation ').repeat(25).trim();
  const { result, stream } = await streamed(text, 1);
  assert.equal(result.join(''), text);
  assert.ok(result.some(part => part.length > 80));
  let offset = 0;
  for (const part of result) {
    offset += part.length;
    assert.ok(!( /[A-Za-z]/u.test(text[offset - 1] || '') && /[A-Za-z]/u.test(text[offset] || '') ), `word split at ${offset}`);
  }
  assert.equal(stream.bufferedChars, 0);
});

test('unpunctuated CJK is emitted incrementally with bounded slices', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream();
  const first = stream.push('中'.repeat(81));
  assert.deepEqual(first, ['中'.repeat(80)]);
  const rest = stream.push('文'.repeat(1000), true);
  assert.equal([...first, ...rest].join(''), '中'.repeat(81) + '文'.repeat(1000));
  assert.ok([...first, ...rest].every(part => [...part].length <= 80));
});

test('overlong quoted and bracketed runs retain context after mandatory bounded cuts', async () => {
  const text = '「' + 'あ'.repeat(400) + '！まだ，続く。」後。';
  const { result } = await streamed(text, 1, { ...tiny, splitOnComma: 'always' });
  assert.equal(result.join(''), text);
  assert.ok(result.length > 10);
  assert.ok(result.some(part => part.includes('！まだ，続く。」')), JSON.stringify(result));
});

test('emoji, variation selectors, combining accents, ZWJ and split surrogates are never cut', async () => {
  const text = ('中文👩🏽‍💻🇯🇵é❤️👨‍👩‍👧‍👦が次').repeat(40) + '。終';
  for (const size of [1, 2, 3, 5, 13]) {
    const { result } = await streamed(text, size, { minSegmentChars: 1, targetSegmentChars: 4, maxSegmentChars: 8 });
    assert.equal(result.join(''), text);
    assertGraphemeBoundaries(text, result);
    assert.ok(result.every(part => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(part)));
  }
});

test('a high surrogate starting an emoji modifier also reserves the preceding emoji at a budget edge', async () => {
  for (let prefix = 0; prefix < 16; prefix++) {
    const text = '(' + '中'.repeat(prefix) + '👩🏽‍💻)尾。';
    for (const size of [1, 2, 3, 4]) {
      const { result } = await streamed(text, size, { minSegmentChars: 1, targetSegmentChars: 7, maxSegmentChars: 13 });
      assert.equal(result.join(''), text);
      assertGraphemeBoundaries(text, result);
    }
  }
});

test('long emoji/symbol and punctuation-only runs obey the spoken budget too', async () => {
  const { SmartSentenceStream } = await modulePromise;
  for (const text of ['😀'.repeat(1000), '！？'.repeat(500), '★'.repeat(1000)]) {
    const result = new SmartSentenceStream({ minSegmentChars: 1, targetSegmentChars: 8, maxSegmentChars: 12 }).push(text, true);
    assert.equal(result.join(''), text);
    assert.ok(result.every(part => [...graphemeSegments(part)].length <= 12));
  }
  function graphemeSegments(text) { return new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text); }
});

test('mixed Japanese/Chinese/English preserves every character and whitespace over arbitrary deltas', async () => {
  const text = '  はい！中文，English 3.14 in Tokyo.\r\n「本当？嗯！」 URL https://a.test/q?x=1,2。 👩🏽‍💻\t最后没有标点  ';
  for (let size = 1; size < 24; size++) {
    const { result } = await streamed(text, size);
    assert.equal(result.join(''), text, `chunk size ${size}`);
    assertGraphemeBoundaries(text, result);
  }
});

test('deterministic mixed-language fuzz conserves text and grapheme boundaries across random deltas', async () => {
  const { SmartSentenceStream } = await modulePromise;
  let seed = 319;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const atoms = ['中', 'あ', 'English', ' ', '\t', '\r\n', '。', '？！', '...', '，', '3.14', '2026.10.31', 'Dr.', 'https://a.test/q?x=1,2', '「', '」', '(', ')', '👩🏽‍💻', '🇯🇵', 'é', '❤️'];
  for (let trial = 0; trial < 250; trial++) {
    const text = Array.from({ length: 40 }, () => atoms[random(atoms.length)]).join('');
    const stream = new SmartSentenceStream({ minSegmentChars: 1, targetSegmentChars: 7, maxSegmentChars: 13 });
    const result = [];
    for (let offset = 0; offset < text.length;) {
      const size = 1 + random(17);
      result.push(...stream.push(text.slice(offset, offset + size))); offset += size;
    }
    result.push(...stream.push('', true));
    assert.equal(result.join(''), text, `trial ${trial}`);
    assertGraphemeBoundaries(text, result);
  }
});

test('punctuation off removes only chosen boundary punctuation, not protected punctuation or whitespace', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const text = 'Dr. Li has 3.14！\n「はい！」链接 https://a.test/q?x=1,2，尾。';
  const result = new SmartSentenceStream({ ...tiny, maxSegmentChars: 80, splitOnComma: 'always', preservePunctuation: false }).push(text, true);
  assert.equal(result.join(''), 'Dr. Li has 3.14\n「はい！」链接 https://a.test/q?x=1,2尾');
  assert.equal(new SmartSentenceStream({ preservePunctuation: false }).push('「はい！」。', true).join(''), '「はい！」');
});

test('final flushes a short or whitespace-only remainder exactly once', async () => {
  const { SmartSentenceStream } = await modulePromise;
  for (const text of ['', '尾', 'remaining text', ' \t\r\n ', 'unfinished（引号', 'https://a.test', '👩🏽‍💻']) {
    const stream = new SmartSentenceStream();
    const result = [...stream.push(text), ...stream.push('', true)];
    assert.equal(result.join(''), text);
    assert.equal(stream.bufferedChars, 0);
    assert.deepEqual(stream.push('', true), []);
    assert.deepEqual(stream.push(''), []);
    assert.throws(() => stream.push('new'), /finalized/);
  }
});

test('bad push arguments fail without modifying the stream', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream();
  for (const value of [null, undefined, 42, {}, []]) assert.throws(() => stream.push(value), TypeError);
  assert.throws(() => stream.push('hello', 'true'), TypeError);
  assert.equal(stream.totalChars, 0);
  assert.deepEqual(stream.push('好。'), ['好。']);
});

test('pathologically long single words and URLs are bounded without losing text', async () => {
  const { SmartSentenceStream } = await modulePromise;
  for (const text of ['x'.repeat(5000), 'https://example.test/' + 'x'.repeat(5000) + '?q=1.2,3;4! 后续。']) {
    const stream = new SmartSentenceStream(), result = [];
    for (const character of text) {
      result.push(...stream.push(character));
      assert.ok(stream.bufferedChars < stream.maxBufferedChars);
    }
    result.push(...stream.push('', true));
    assert.equal(result.join(''), text);
    assert.ok(result.every(part => part.length <= stream.maxBufferedChars));
  }
});

test('total accepted text is capped independently of already-drained buffers', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream();
  const text = '中'.repeat(100000);
  assert.equal(stream.push(text, true).join(''), text);
  assert.equal(stream.totalChars, 100000);
  const other = new SmartSentenceStream();
  assert.throws(() => other.push(text + 'x'), /100000/);
  assert.equal(other.totalChars, 0);
  assert.equal(other.bufferedChars, 0);
  other.push('好。'.repeat(50000));
  assert.throws(() => other.push('x'), /100000/);
});

test('unbounded grapheme growth and excessive nesting fail explicitly instead of accumulating forever', async () => {
  const { SmartSentenceStream } = await modulePromise;
  const stream = new SmartSentenceStream(tiny);
  assert.throws(() => stream.push('e' + '́'.repeat(stream.maxBufferedChars)), /grapheme/);
  assert.ok(stream.bufferedChars <= stream.maxBufferedChars);
  assert.throws(() => stream.push('new text', true), /grapheme/);
  assert.throws(() => new SmartSentenceStream(tiny).push('('.repeat(65) + 'x'), /nesting/);
  assert.throws(() => new SmartSentenceStream().push('a\uD83D', true), /surrogate/);
});
