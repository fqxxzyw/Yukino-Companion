const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { SpeechService, WorkerClient, validateSettings, DEFAULTS } = require('../electron/speech.cjs');
const wait = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; };

test('sentence boundaries, final tail, decimals, chunked hidden content and Markdown', async () => {
  const { SentenceStream, spokenText } = await import('../src/speech/text.mjs');
  const raw = '<think>秘密。不要朗读！</think>你好。价格 3.14 元。\n```js\nthrow Error("secret。");\n```\n[帮助](https://example.test) 与 `code` 内容！最后一句';
  const complete = new SentenceStream(); const expected = complete.push(raw, true);
  assert.deepEqual(expected, ['你好。','价格 3.14 元。','帮助 与 内容！','最后一句']);
  for (let size=1; size<20; size++) {
    const stream = new SentenceStream(); const got=[];
    for(let i=0;i<raw.length;i+=size)got.push(...stream.push(raw.slice(i,i+size)));
    got.push(...stream.push('',true)); assert.deepEqual(got, expected, `chunk size ${size}`);
  }
  assert.equal(spokenText('你好。<think>秘密',true),'你好。');
  assert.equal(spokenText('正常。```unfinished',true),'正常。');
});

test('long plain text is bounded; empty formatting never generates audio', async()=>{
  const {SentenceStream}=await import('../src/speech/text.mjs');
  assert.equal(new SentenceStream().push('```code```\n***',true).length,0);
  const chunks=new SentenceStream().push('很'.repeat(1000),true);
  assert.equal(chunks.join('').length,1000); assert.ok(chunks.every(x=>x.length<=181));
});

test('URLs preserve adjacent Chinese prose and keep English query/fragment hidden', async()=>{
  const {SentenceStream,spokenText}=await import('../src/speech/text.mjs');
  const cases=[
    ['详情：https://example.com。后面还有一句。','详情：。后面还有一句。'],
    ['链接 https://example.com/search?q=hello+world&lang=en#part-2 后面继续。','链接 后面继续。'],
    ['请看 https://example.com/中文路径？看完继续。','请看 ？看完继续。'],
  ];
  for(const [raw,expectedText] of cases){
    assert.equal(spokenText(raw,true),expectedText);
    const expected=new SentenceStream().push(raw,true);
    for(let size=1;size<=raw.length;size++){
      const stream=new SentenceStream(),got=[];
      for(let i=0;i<raw.length;i+=size)got.push(...stream.push(raw.slice(i,i+size)));
      got.push(...stream.push('',true));assert.deepEqual(got,expected,`chunk size ${size}: ${raw}`);
    }
  }
});

test('split image markers and URL prefixes cannot consume later spoken characters', async()=>{
  const {SentenceStream}=await import('../src/speech/text.mjs');
  const cases=[
    ['你好![图片](https://example.com/a.png)继续。',['你好继续。']],
    ['你好! 继续。',['你好!','继续。']],
    ['第一句![图片](https://example.com/a.png)第二句！再见!',['第一句第二句！','再见!']],
    ['很'.repeat(180)+'https://example.com/path?q=x#part。继续。',['很'.repeat(180)+'。','继续。']],
  ];
  for(const [raw,expected] of cases){
    assert.deepEqual(new SentenceStream().push(raw,true),expected);
    for(let size=1;size<=20;size++){
      const stream=new SentenceStream(),got=[];
      for(let i=0;i<raw.length;i+=size)got.push(...stream.push(raw.slice(i,i+size)));
      got.push(...stream.push('',true));assert.deepEqual(got,expected,`chunk size ${size}: ${raw}`);
    }
  }
});

test('session serializes synthesis AND playback; flushes final text once',async()=>{
  const {SpeechSession}=await import('../src/speech/session.mjs');
  const log=[], gate=deferred();
  const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(id,text)=>{log.push('tts:'+text);return text}},
    player:{stop(){},play:async audio=>{log.push('play:'+audio);if(audio==='第一句。')await gate.promise}}});
  flow.start('a');flow.push('第一句。第二句。尾句');flow.finish();await wait();
  assert.deepEqual(log,['tts:第一句。','play:第一句。']);gate.resolve();await wait();
  assert.deepEqual(log,['tts:第一句。','play:第一句。','tts:第二句。','play:第二句。','tts:尾句','play:尾句']);
  flow.finish();await wait();assert.equal(log.length,6);
});

test('stop rejects late audio and new session cannot play old results',async()=>{
  const {SpeechSession}=await import('../src/speech/session.mjs');
  const old=deferred(),played=[],stopped=[];
  const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async id=>stopped.push(id),synthesize:async(id,text)=>id==='old'?old.promise:text},player:{stop(){},play:async x=>played.push(x)}});
  flow.start('old');flow.push('旧回复。');flow.finish();await wait();
  flow.start('new');flow.push('新回复。');flow.finish();await wait();old.resolve('old audio');await wait();
  assert.deepEqual(played,['新回复。']);assert.ok(stopped.includes('old'));
});

test('speech errors and overflow stop only the speech session',async()=>{
  const {SpeechSession}=await import('../src/speech/session.mjs');const states=[];
  const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async()=>{},synthesize:async()=>{throw Error('GPU OOM')}},player:{stop(){},play:async()=>{}},onState:s=>states.push(s)});
  flow.start('a');flow.push('你好。');flow.finish();await wait();assert.equal(states.at(-1).error,'GPU OOM');assert.equal(flow.current,null);
  flow.start('b');flow.push('你好。'.repeat(100));assert.match(states.at(-1).error,/积压/);
});

test('bad configuration rejected without starting subprocesses',()=>{
  assert.throws(()=>validateSettings({...DEFAULTS,python:'python --execute command'}),/绝对路径/);
  for(const settings of [{volume:2},{timeout:1},{device:'fake'},{cpuThreads:1.5},{speed:NaN}])assert.throws(()=>validateSettings({...DEFAULTS,...settings}));
});

function fakeProcess(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kills=0;child.kill=()=>{child.kills++};return child;}
test('worker protocol handles partial UTF-8, per-request IDs and no shell execution',async()=>{
  const child=fakeProcess();let options;const worker=new WorkerClient({python:'/python',script:'/worker.py',cwd:'/',spawnImpl:(exe,args,opts)=>{options=opts;return child}});
  let request;child.stdin.on('data',b=>{request=JSON.parse(b.toString())});
  const promise=worker.request('load');await wait();assert.equal(options.shell,false);
  const bytes=Buffer.from(JSON.stringify({id:request.id,ok:true,result:'中文成功'})+'\n');
  for(const byte of bytes)child.stdout.write(Buffer.from([byte]));assert.equal(await promise,'中文成功');worker.close();assert.equal(child.kills,1);
});

test('timeout kills only owned process and rejects waiter',async()=>{
  const child=fakeProcess();const worker=new WorkerClient({python:'/python',script:'/worker.py',cwd:'/',spawnImpl:()=>child});
  await assert.rejects(worker.request('load',{},10),/超时/);assert.equal(child.kills,1);assert.equal(worker.closed,true);
});

test('unexpected process exit exposes error and terminates pending operation',async()=>{
  const child=fakeProcess();const worker=new WorkerClient({python:'/python',script:'/worker.py',cwd:'/',spawnImpl:()=>child});
  const promise=worker.request('load');child.stderr.write('Missing BERT');child.emit('exit',1,null);
  await assert.rejects(promise,/Missing BERT/);
});

function fakeService(){
  const clients=[];const service=new SpeechService({script:__filename,stateDir:require('node:os').tmpdir()});
  service.makeWorker=async()=>{const client={closed:false,pending:null,loadGate:null,
    async request(method){if(method==='load')return {device:'cpu'};const d=deferred();this.pending=d;return d.promise},
    close(){this.closed=true;this.pending?.reject(Error('cancelled'));this.pending=null}};clients.push(client);return client};
  service.config={...DEFAULTS,python:process.execPath,root:__dirname};return {service,clients};
}
test('manager cancels active inference, ignores stale stop, and reloads for next request',async()=>{
  const {service,clients}=fakeService();await service.ensureLoaded();service.begin('old');
  const old=service.synthesize('old','古い返事です。');await wait();service.stop('old');await assert.rejects(old,/cancelled/);
  assert.equal(clients[0].closed,true);service.begin('new');service.stop('old');assert.equal(service.session,'new');
  const next=service.synthesize('new','新しい返事です。');await service.ensureLoaded();await wait();assert.equal(clients.length,2);
  const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);clients[1].pending.resolve({audio:wav.toString('base64'),metadata:{device:'cpu'}});
  assert.deepEqual(await next,wav);service.unload();assert.equal(clients[1].closed,true);assert.equal(service.config,null);
});

test('unload while a worker is being created prevents late model resurrection',async()=>{
  const {service}=fakeService(),gate=deferred();let closed=false;
  service.makeWorker=()=>gate.promise;const loading=service.ensureLoaded();await wait();service.unload();
  gate.resolve({close(){closed=true}});await assert.rejects(loading,/取消/);assert.equal(closed,true);assert.equal(service.status.phase,'unloaded');
});


test('Japanese-only synthesis boundary migrates old languages and rejects untranslated Chinese',async()=>{
  const {assertJapaneseSpeech}=require('../electron/speech.cjs');
  assert.equal(validateSettings({...DEFAULTS,textLang:'zh',promptLang:'zh'}).textLang,'all_ja');
  assert.equal(validateSettings({...DEFAULTS,textLang:'zh',promptLang:'zh'}).promptLang,'zh');
  assert.doesNotThrow(()=>assertJapaneseSpeech('今日は何を話しましょうか。'));
  const {service,clients}=fakeService();service.begin('ja');
  await assert.rejects(service.synthesize('ja','你好，今天想聊什么？'),/日语译文/);
  assert.equal(clients.length,0);service.dispose();
});

test('Japanese sentence lookahead preserves kanji-only prefixes and tails for every chunk size',async()=>{
  const {JapaneseSentenceStream}=await import('../src/speech/text.mjs');
  const {assertJapaneseSpeech}=require('../electron/speech.cjs');
  const samples=[
    ['了解。少し待ってください。',['了解。少し待ってください。']],
    ['少し待ってください。了解。',['少し待ってください。了解。']],
    ['了解。承知。少し待ってください。先生。わかりました。以上。',['了解。承知。少し待ってください。先生。','わかりました。以上。']],
    ['こんにちは。次の文章です。',['こんにちは。','次の文章です。']],
  ];
  for(const [raw,expected] of samples){
    for(let size=1;size<=raw.length;size++){
      const stream=new JapaneseSentenceStream(),got=[];
      for(let i=0;i<raw.length;i+=size)got.push(...stream.push(raw.slice(i,i+size)));
      got.push(...stream.push('',true));
      assert.deepEqual(got,expected,`size ${size}: ${raw}`);
      assert.equal(got.join(''),raw);
      got.forEach(text=>assert.doesNotThrow(()=>assertJapaneseSpeech(text)));
    }
  }
});

test('Japanese joins stay within 500 characters without losing long valid prose',async()=>{
  const {JapaneseSentenceStream}=await import('../src/speech/text.mjs');
  const {assertJapaneseSpeech}=require('../electron/speech.cjs');
  const raw=('これは長い説明です。'+'重要事項。'.repeat(30)).repeat(8)+'わかりました。以上。';
  for(const size of [1,7,181,500,raw.length]){
    const stream=new JapaneseSentenceStream(),got=[];
    for(let i=0;i<raw.length;i+=size)got.push(...stream.push(raw.slice(i,i+size)));
    got.push(...stream.push('',true));assert.equal(got.join(''),raw);
    assert.ok(got.every(text=>text.length<=500));got.forEach(assertJapaneseSpeech);
  }
  assert.throws(()=>new JapaneseSentenceStream().push('漢'.repeat(600)+'です。',true),/無|无假名/);
});

test('Japanese session reaches real language gate, rejects untranslated text, and cancellation clears held sentences',async()=>{
  const {SpeechSession}=await import('../src/speech/session.mjs');
  const {assertJapaneseSpeech}=require('../electron/speech.cjs');
  const spoken=[],played=[],states=[];
  const flow=new SpeechSession({japaneseOnly:true,onState:state=>states.push(state),
    bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(id,text)=>{assertJapaneseSpeech(text);spoken.push({id,text});return text}},
    player:{stop(){},play:async text=>played.push(text)}});
  flow.start('a');flow.push('了解。');await wait();assert.equal(spoken.length,0);
  flow.push('少し待ってください。');flow.finish();flow.finish();await wait();
  assert.deepEqual(spoken,[{id:'a',text:'了解。少し待ってください。'}]);
  flow.start('cancelled');flow.push('旧文章。');flow.cancel();
  flow.start('new');flow.push('新しい文章です。以上。');flow.finish();await wait();
  assert.equal(spoken.at(-1).text,'新しい文章です。以上。');
  assert.ok(!played.some(text=>text.includes('旧文章')));
  const before=spoken.length;
  flow.start('chinese');flow.push('你好。今天好开心。');flow.finish();await wait();
  assert.equal(spoken.length,before);assert.equal(states.at(-1).phase,'error');
  assert.match(states.at(-1).error,/文字仍完整保留/);assert.equal(flow.current,null);
});

test('unjoinable Japanese trailing kanji is an explicit error, never silent truncation or replay',async()=>{
  const {SpeechSession}=await import('../src/speech/session.mjs');
  const {assertJapaneseSpeech}=require('../electron/speech.cjs');
  const spoken=[],states=[];
  const flow=new SpeechSession({japaneseOnly:true,onState:s=>states.push(s),
    bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(id,text)=>{assertJapaneseSpeech(text);spoken.push(text);return text}},
    player:{stop(){},play:async()=>{}}});
  flow.start('long');flow.push('こんにちは。');flow.push('確認。'.repeat(165));await wait();
  flow.push('完了。');flow.finish();await wait();
  assert.equal(states.at(-1).phase,'error');assert.match(states.at(-1).error,/文字仍完整保留/);
  assert.ok(spoken.every(text=>text.length<=500));
  assert.ok(spoken.join('').length<=('こんにちは。'+'確認。'.repeat(165)+'完了。').length);
});
