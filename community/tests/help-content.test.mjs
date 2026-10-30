import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CATEGORIES,validateHelpContent,helpArticleHtml,markdown,safeUrl,submissionUrl} from '../lib.mjs';

const read=path=>fs.readFile(new URL(path,import.meta.url),'utf8');
const help=JSON.parse(await read('../help-content.json'));
const html=await read('../index.html');

test('every help section has a unique route, reference fields and readable headings',()=>{
  assert.equal(validateHelpContent(help),help);
  for(const section of help.sections){
    assert.match(section.body,/^## /);
    assert.ok(section.body.includes('\n\n'));
    const rendered=helpArticleHtml(section,help.updatedAt);
    assert.match(rendered,/<dl class="help-reference"/);
    assert.match(rendered,/<h3>/);
    assert.ok(rendered.includes(`#help/${section.id}`));
    assert.equal((section.body.match(/^```/gm)||[]).length%2,0,'code fences must be balanced');
  }
});
test('help validation rejects malformed, duplicate and broken deep-link documents',()=>{
  for(const edit of [x=>x.sections=[],x=>x.sections.push(x.sections[0]),x=>x.sections[0].id='bad/id',x=>x.sections[0].reference=[],x=>x.sections=x.sections.filter(s=>s.id!=='download')]){
    const candidate=structuredClone(help);edit(candidate);assert.throws(()=>validateHelpContent(candidate));
  }
});
test('reference metadata is escaped and body retains safe Markdown rendering',()=>{
  const result=helpArticleHtml({id:'safe',title:'<script>',summary:'<img onerror=x>',group:'<svg>',reference:[{name:'<b>',value:'<iframe>'}],body:'## 测试\n\n<script>x</script>'},'<script>');
  assert.ok(!/<(?:script|img|svg|iframe|b)>/.test(result));
  assert.match(result,/&lt;iframe&gt;/);
  assert.match(result,/<h3>测试<\/h3>/);
});
test('static help links and publication templates resolve to real local targets',async()=>{
  const ids=new Set(help.sections.map(x=>x.id));
  for(const match of html.matchAll(/href="#help(?:\/([^"#]+))?"/g))if(match[1])assert.ok(ids.has(match[1]),match[0]);
  for(const [category,entry] of Object.entries(CATEGORIES)){
    await fs.access(new URL(`../../.github/ISSUE_TEMPLATE/${entry.template}`,import.meta.url));
    assert.equal(new URL(submissionUrl(category)).searchParams.get('template'),entry.template);
  }
  for(const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g))await fs.access(new URL('../'+match[1],import.meta.url));
  for(const section of help.sections){
    for(const match of section.body.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)){
      assert.ok(safeUrl(match[1]),`${section.id}: ${match[1]}`);
      const sourcePath=match[1].split('https://github.com/fqxxzyw/Yukino-Companion/blob/main/')[1];
      if(sourcePath)await fs.access(new URL('../../'+sourcePath,import.meta.url));
    }
  }
});
test('community copy names actual content and keeps authentication on GitHub',async()=>{
  const app=await read('../app.mjs');
  for(const slogan of ['让喜欢','拥有更多可能','从这里，开始','发现同好','第一个故事','把你的创作，留在这里','A LITTLE HELP'])assert.ok(!(html+app).includes(slogan),slogan);
  assert.match(html,/二创文章与<br>音色资源分享/);
  assert.match(html,/打开 GitHub 投稿表单/);
  assert.ok(!/type=["']password/.test(html));
  assert.match(help.sections.find(x=>x.id==='community').body,/邮箱密码注册与站内登录暂未接入/);
});
test('reference documents real read endpoints and matches translation routing',()=>{
  const api=help.sections.find(x=>x.id==='community-api');
  assert.match(api.body,/GET \/repos\/fqxxzyw\/Yukino-Companion\/issues\?state=all&sort=created&direction=desc&per_page=60/);
  assert.match(api.body,/\/comments\?per_page=30/);
  assert.match(markdown(api.body),/<pre><code>curl/);
  const voice=help.sections.find(x=>x.id==='voice');
  assert.match(voice.body,/API 返回双语 · API 补译/);
  assert.match(voice.body,/当前选中的对话 API/);
  assert.ok(!voice.body.includes('由本地翻译补齐'));
});
