const test = require('node:test');
const assert = require('node:assert/strict');
const {classroomBoardActive,readBlackboardResponse,requestsBlackboardWriting,requestsBlackboardPoster,blackboardResponseStatus,BLACKBOARD_TEXT_LIMIT} = require('../electron/blackboard-response.cjs');
const {BilingualStream} = require('../electron/bilingual.cjs');
const {mainHarness} = require('./helpers/main-harness.cjs');

const presentation = {scene:'classroom',sceneEnabled:true,spread:true};

test('board capability follows the actually visible classroom', () => {
  assert.equal(classroomBoardActive({presentation}), true);
  for (const value of [{...presentation,scene:'forest'},{...presentation,spread:false},{...presentation,sceneEnabled:false},{...presentation,wallpaper:{enabled:true,items:[{id:'a'.repeat(64)}]}}]) {
    assert.equal(classroomBoardActive({presentation:value}), false);
  }
});

test('board payload accepts only bounded text from a complete response object', () => {
  const raw=JSON.stringify({zh:'看这里。',ja:'こちらを見て。',blackboard:{text:'第一行\n第二行'}});
  assert.deepEqual(readBlackboardResponse(raw),{text:'第一行\n第二行',elements:[]});
  assert.deepEqual(readBlackboardResponse('```json\n'+raw+'\n```'),{text:'第一行\n第二行',elements:[]});
  assert.deepEqual(readBlackboardResponse(JSON.stringify({zh:'写好了。',blackboard:'我喜欢你'})),{text:'我喜欢你',elements:[]});
  assert.equal(readBlackboardResponse(JSON.stringify({zh:'写好了。',blackboard:'x'.repeat(BLACKBOARD_TEXT_LIMIT+1)})),null);
  for (const bad of ['普通文字',raw.slice(0,-1),JSON.stringify({blackboard:{text:'x'.repeat(BLACKBOARD_TEXT_LIMIT+1)}}),JSON.stringify({blackboard:{text:'x\u0000y'}}),JSON.stringify({blackboard:{text:{code:'alert(1)'}}})]) {
    assert.equal(readBlackboardResponse(bad),null);
  }
});

test('poster elements preserve model order, normalize legacy text, and accept drawing-only replies', () => {
  const elements=[{type:'cake',x:.25,y:.5,size:.2,color:'pink'}, {type:'path',color:'white',points:[[.1,.2],[.2,.3],[.3,.2]]}, {type:'star',x:.4,y:.2,size:.08,color:'yellow'}];
  const result=readBlackboardResponse(JSON.stringify({zh:'好了',blackboard:{text:'生日快乐',elements}}));
  assert.deepEqual(result,{text:'生日快乐',elements});
  assert.deepEqual(readBlackboardResponse(JSON.stringify({zh:'看这里',blackboard:{elements}})),{text:'',elements});
  assert.equal(readBlackboardResponse(JSON.stringify({blackboard:{text:'',elements:[]}})),null);
});

test('poster payload rejects invalid coordinates, drawing commands and resource limits', () => {
  const shape={type:'star',x:.25,y:.2,size:.1,color:'yellow'},path={type:'path',color:'white',points:[[.1,.2],[.2,.3]]};
  const invalid=[{...shape,type:'eval'}, {...shape,x:-.01}, {...shape,y:1.01}, {...shape,size:.39}, {...shape,color:'url(evil)'}, {...path,points:[[0,0],[2,1]]}, {...path,points:[[0,0]]}, {...path,points:Array.from({length:65},()=>[0,0])}];
  for(const element of invalid)assert.equal(readBlackboardResponse(JSON.stringify({blackboard:{text:'',elements:[element]}})),null,JSON.stringify(element));
  assert.equal(readBlackboardResponse(JSON.stringify({blackboard:{text:'hello',elements:Array(33).fill(shape)}})),null);
  assert.equal(readBlackboardResponse(JSON.stringify({blackboard:{text:'',elements:Array(9).fill({...path,points:Array(64).fill([0,0])})}})),null);
});

test('art title can stand alone with model-designed appearance for each character', () => {
  const title = {
    text:'生日快乐', x:.5, y:.38, size:.4, style:'ribbon', color:'pink',
    accent:'yellow', rotation:-4, spacing:.12,
    letters:[{dy:.08,color:'blue'},{scale:1.1},{rotation:9},{}],
  };
  const raw = JSON.stringify({blackboard:{title:{...title, css:'ignored'}}});
  assert.deepEqual(readBlackboardResponse(raw),{text:'',elements:[],title});
  for (const invalid of [
    {...title, text:'生日\n快乐'},
    {...title, x:-.01},
    {...title, size:.43},
    {...title, style:'url(evil)'},
    {...title, color:'#abc'},
    {...title, rotation:-17},
    {...title, spacing:.36},
    {...title, accent:'orange'},
    {...title, letters:[{}]},
    {...title, letters:[{scale:1.3},{},{},{}]},
    {...title, letters:[{dy:-.21},{},{},{}]},
  ]) {
    assert.equal(readBlackboardResponse(JSON.stringify({blackboard:{title:invalid}})),null);
  }
});

test('explicit board writing requests are distinguished from reading existing marks', () => {
  for (const text of [
    '你可以再黑板上写点一句我喜欢你吗','把这道公式写在黑板上','在黑板上画一个圆','请列出板书','做个黑板报',
    '把标题写到教室的黑板上给我看','别在聊天里写，写到黑板上','在黑板上写「生日快乐」','修改黑板上的标题','请用黑板来解释这题','我想让你在黑板上写个标题',
    '请你用黑板报技能画一下','黑板报做一张','Please write the title on the chalkboard','黒板にタイトルを書いてください',
  ]) assert.equal(requestsBlackboardWriting(text),true,text);
  for (const text of [
    '黑板上写了什么？','黑板上写的是什么','画一个圆','写一个生日海报','写一段关于黑板的故事',
    '看看黑板上写了什么','把黑板上的内容写成一段说明','不要在黑板上写，直接聊天回复','别写到黑板上',
    '这是我刚才在教室黑板上写画的内容，请结合我们的对话看看。','把「在黑板上写标题」翻译成英文',
    '我能在黑板上写字吗','为什么在黑板上写字会有声音',
    'Do not write this on the blackboard','Can you explain how to write on the chalkboard?',
    'Can I write on the blackboard?','I want to write it on the blackboard',
    '黒板に何が書いてある？','黒板に書いてはいけない','黒板に書いていいですか',
  ]) assert.equal(requestsBlackboardWriting(text),false,text);
});

test('an explicit poster requires visible artwork without misclassifying ordinary board text', () => {
  const textOnly={text:'生日快乐',elements:[]},art={text:'生日快乐',elements:[{type:'cake',x:.2,y:.5,size:.2,color:'pink'}]};
  for(const text of ['在黑板上画一个生日海报','做个黑板报','画点海报一样的','给这幅装饰画加插图']) assert.equal(requestsBlackboardPoster(text),true,text);
  for(const text of ['这张海报是什么','在黑板上写生日快乐','你好']) assert.equal(requestsBlackboardPoster(text),false,text);
  assert.equal(blackboardResponseStatus('画个生日海报',null),undefined);
  assert.equal(blackboardResponseStatus('在黑板上画个生日海报',textOnly),'missing_art');
  assert.equal(blackboardResponseStatus('在黑板上画个生日海报',null),'missing');
  assert.equal(blackboardResponseStatus('在黑板上画个生日海报',art),undefined);
  assert.equal(blackboardResponseStatus('在黑板写生日快乐',textOnly),undefined);
  assert.equal(blackboardResponseStatus('把生日快乐设计成艺术字',textOnly),undefined);
  assert.equal(blackboardResponseStatus('在黑板上把生日快乐写成艺术字',textOnly),'missing_art');
  const title={text:'生日快乐',x:.5,y:.5,size:.4,style:'outline',color:'pink'};
  assert.equal(blackboardResponseStatus('在黑板上把生日快乐写成艺术字',{text:'',elements:[],title}),undefined);
});

test('blackboard data never enters streamed dialogue or speech at arbitrary token boundaries', () => {
  const answer={zh:'我写在黑板上了。',ja:'黒板に書いたわ。',blackboard:{text:'机密板书：x + y = 2'}};
  const raw=JSON.stringify(answer);
  for (let size=1;size<=raw.length;size++) {
    let zh='',ja='';const parser=new BilingualStream(value=>zh+=value,value=>ja+=value);
    for(let i=0;i<raw.length;i+=size)parser.push(raw.slice(i,i+size));
    assert.equal(zh,answer.zh);assert.equal(ja,answer.ja);
    assert.deepEqual(parser.value(),{zh:answer.zh,ja:answer.ja});
    assert.deepEqual(readBlackboardResponse(raw),{...answer.blackboard,elements:[]});
  }
});

test('real classroom IPC exposes a separate board field in remote bilingual mode', async () => {
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const reply={zh:'我写下来了。',ja:'書いておいたわ。',blackboard:{text:'x + y = 2'}};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',conversations:[],translationMode:'api',presentation,autoMemory:false},reply});
  const result=await app.invoke('chat',{id:'board-remote',profileId:'remote',streamSpeech:true,messages:[{role:'user',content:'写到黑板上'}]});
  assert.deepEqual(result.blackboard,{...reply.blackboard,elements:[]});
  assert.equal(result.bilingual.zh,reply.zh);
  assert.match(app.requests[0].messages[0].content,/教室黑板技能/);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),reply.zh);
  assert.equal(app.sent.filter(item=>item.channel==='speech-text').map(item=>item.payload.text).join(''),reply.ja);
});

test('poster survives the real chat route without leaking drawing data into text or speech', async () => {
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const elements=[{type:'cake',x:.25,y:.5,size:.2,color:'pink'},{type:'star',x:.4,y:.2,size:.08,color:'yellow'},{type:'path',color:'blue',points:[[.1,.2],[.3,.3]]}];
  const title={text:'生日快乐',x:.57,y:.44,size:.4,style:'outline',color:'pink',accent:'yellow',letters:[{}, {dy:-.1}, {rotation:6}, {}]};
  const reply={zh:'祝你生日快乐。',ja:'お誕生日おめでとう。',blackboard:{text:'',title,elements}};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',conversations:[],translationMode:'api',presentation,autoMemory:false},reply});
  const result=await app.invoke('chat',{id:'board-poster',profileId:'remote',streamSpeech:true,messages:[{role:'user',content:'请在黑板上画生日海报'}]});
  assert.deepEqual(result.blackboard,reply.blackboard);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),reply.zh);
  assert.equal(app.sent.filter(item=>item.channel==='speech-text').map(item=>item.payload.text).join(''),reply.ja);
  const prompt = app.requests[0].messages[0].content;
  assert.match(prompt,/title\.letters/);
  assert.match(prompt,/"zh":"中文对话","ja":"自然日语对话","blackboard":null/);
  assert.doesNotMatch(prompt,/\{\{[A-Z_]+\}\}|^name: classroom-blackboard/m);
});

test('classroom IPC supports local and translation-disabled responses without exposing board data', async () => {
  const reply={zh:'我写好了。',blackboard:{text:'本地模型的板书'}};
  const app=await mainHarness({state:{chatMode:'local',translationMode:'none',conversations:[],presentation},localReply:JSON.stringify(reply)});
  const result=await app.invoke('chat',{id:'board-local',mode:'local',messages:[{role:'user',content:'写在黑板'}]});
  assert.deepEqual(result.blackboard,{...reply.blackboard,elements:[]});
  assert.equal(result.bilingual.zh,reply.zh);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),reply.zh);
  assert.match(app.localRequests[0].messages[0].content,/教室黑板技能/);
  assert.equal(app.translated.length,0);
});

test('separate translation receives dialogue without the blackboard field', async () => {
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const reply={zh:'请看黑板。',blackboard:{text:'不要送到翻译器'}};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',conversations:[],translationMode:'local',presentation,autoMemory:false},reply});
  const result=await app.invoke('chat',{id:'board-translated',profileId:'remote',messages:[{role:'user',content:'写在黑板'}]});
  assert.deepEqual(result.blackboard,{...reply.blackboard,elements:[]});
  assert.equal(result.bilingual.zh,reply.zh);
  assert.equal(app.translated.length,1);
  assert.equal(app.translated[0].request.text,reply.zh);
});

test('a plain local answer still streams in the classroom without a board request', async () => {
  const app=await mainHarness({state:{chatMode:'local',translationMode:'none',conversations:[],presentation},localReply:'让我想一想。'});
  const result=await app.invoke('chat',{id:'board-plain',mode:'local',messages:[{role:'user',content:'你好'}]});
  assert.equal(result.bilingual.zh,'让我想一想。');
  assert.equal(result.blackboard,undefined);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),result.bilingual.zh);
});

test('missing structured board action is reported separately without fabricating a drawing', async () => {
  const app=await mainHarness({state:{chatMode:'local',translationMode:'none',conversations:[],presentation},localReply:JSON.stringify({zh:'写好了。'})});
  const result=await app.invoke('chat',{id:'board-missing',mode:'local',messages:[{role:'user',content:'你可以再黑板上写点一句我喜欢你吗'}]});
  assert.equal(result.bilingual.zh,'写好了。');assert.equal(result.blackboard,null);assert.equal(result.blackboardStatus,'missing');
  const noRequest=await app.invoke('chat',{id:'board-no-request',mode:'local',messages:[{role:'user',content:'你好'}]});
  assert.equal(noRequest.blackboard,undefined);assert.equal(noRequest.blackboardStatus,undefined);
});

test('ordinary classroom chat ignores unsolicited board art and prior requests', async () => {
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const reply={zh:'生日快乐，愿你今天顺心。',ja:'お誕生日おめでとう。',blackboard:{text:'生日快乐'}};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',conversations:[],translationMode:'api',presentation,autoMemory:false},reply});
  const result=await app.invoke('chat',{id:'ordinary-classroom-chat',profileId:'remote',messages:[
    {role:'user',content:'在黑板上写生日快乐'},{role:'assistant',content:'已经写好了。'},
    {role:'user',content:'再写一段生日祝福。'},
  ]});
  assert.equal(result.bilingual.zh,reply.zh);
  assert.equal(result.blackboard,undefined);
  assert.equal(result.blackboardStatus,undefined);
  assert.doesNotMatch(app.requests[0].messages[0].content,/教室黑板技能/);
  assert.equal(app.sent.filter(item=>item.channel==='chunk').map(item=>item.payload.text).join(''),reply.zh);
});

test('a flat structured blackboard field counts as a successful action', async () => {
  const app=await mainHarness({state:{chatMode:'local',translationMode:'none',conversations:[],presentation},localReply:JSON.stringify({zh:'写好了。',blackboard:'我喜欢你'})});
  const result=await app.invoke('chat',{id:'board-flat',mode:'local',messages:[{role:'user',content:'在黑板上写我喜欢你'}]});
  assert.deepEqual(result.blackboard,{text:'我喜欢你',elements:[]});assert.equal(result.blackboardStatus,undefined);
});

test('a text-only response to a poster request returns a separate missing-art status', async () => {
  const app=await mainHarness({state:{chatMode:'local',translationMode:'none',conversations:[],presentation},localReply:JSON.stringify({zh:'画好了。',blackboard:{text:'生日快乐'}})});
  const result=await app.invoke('chat',{id:'board-poster-missing-art',mode:'local',messages:[{role:'user',content:'请在黑板画一个生日海报'}]});
  assert.deepEqual(result.blackboard,{text:'生日快乐',elements:[]});
  assert.equal(result.blackboardStatus,'missing_art');
});

test('non-classroom replies have no skill injection or board operation', async () => {
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const reply={zh:'你好。',ja:'こんにちは。',blackboard:{text:'不应该显示'}};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',conversations:[],translationMode:'api',presentation:{...presentation,scene:'forest'},autoMemory:false},reply});
  const result=await app.invoke('chat',{id:'no-board',profileId:'remote',messages:[{role:'user',content:'你好'}]});
  assert.equal(result.blackboard,undefined);
  assert.doesNotMatch(app.requests[0].messages[0].content,/教室黑板技能/);
});
