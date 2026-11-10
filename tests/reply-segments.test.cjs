const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/companion/reply-segments.mjs');

test('local reply separates sentences and newlines while retaining expression', async () => {
  const {splitLocalReply} = await load();
  assert.deepEqual(splitLocalReply('你好。今天怎么样？\n我很好！\r\n明天见。'), ['你好', '今天怎么样？', '我很好！', '明天见']);
  assert.deepEqual(splitLocalReply('“真的吗？！”她笑了。'), ['“真的吗？！”', '她笑了']);
  assert.deepEqual(splitLocalReply('她说：“第一句。第二句。”然后笑了。'), ['她说：“第一句。第二句。”', '然后笑了']);
  assert.deepEqual(splitLocalReply('等一下……我想想...好吧。'), ['等一下……我想想...好吧']);
  assert.deepEqual(splitLocalReply(''), []);
});

test('local reply preserves decimal points, URLs and English abbreviations', async () => {
  const {splitLocalReply} = await load();
  assert.deepEqual(splitLocalReply('价格是 3.14 元。访问 https://example.com/a.b?x=1。好了！'), ['价格是 3.14 元', '访问 https://example.com/a.b?x=1', '好了！']);
  assert.deepEqual(splitLocalReply('Dr. Smith arrived. Welcome!'), ['Dr. Smith arrived', 'Welcome!']);
});

test('structured content stays intact and long prose may split at a pause', async () => {
  const {splitLocalReply} = await load();
  for (const text of ['```js\na.b()\n```', '- 第一项。\n- 第二项。', '看 [链接](https://example.com/a.b)。']) assert.deepEqual(splitLocalReply(text), [text]);
  const long = `${'这是一段比较长的内容'.repeat(9)}，接下来我们聊其他事情。`;
  const parts=splitLocalReply(long);
  assert.equal(parts.join(''),long.slice(0,-1));
  assert.ok(parts.length >= 3);
});

test('API style introductions and long clauses break into readable bubbles', async () => {
  const {splitLocalReply} = await load();
  assert.deepEqual(splitLocalReply('我是雪之下雪乃。就读总武高中，担任奉仕部部长。平时喜欢读书，也喜欢猫。如果你有什么需要商量的事，可以告诉我。'), ['我是雪之下雪乃','就读总武高中，担任奉仕部部长','平时喜欢读书，也喜欢猫','如果你有什么需要商量的事，可以告诉我']);
  const long='这是一条没有任何标点但是内容很长的回复'.repeat(7);
  const parts=splitLocalReply(long);
  assert.ok(parts.length>1);
  assert.equal(parts.join(''),long);
  assert.ok(parts.every(part=>[...part].length<=54));
});

test('long tokens, quoted phrases and numbers stay intact when splitting', async () => {
  const {splitLocalReply}=await load();
  const url='https://example.com/'+ 'a'.repeat(100);
  assert.deepEqual(splitLocalReply(url),[url]);
  const quoted='“'+'很长的一句引用文字'.repeat(8)+'”';
  assert.deepEqual(splitLocalReply(quoted),[quoted]);
  assert.deepEqual(splitLocalReply('今天账户里的金额总共是人民币 1,000,000 元。'),['今天账户里的金额总共是人民币 1,000,000 元']);
});
