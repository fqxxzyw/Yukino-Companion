import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryOf,titleOf,fieldsOf,voiceMetadata,markdown,safeUrl,submissionUrl,apiPath,nextPage,request,GITHUB,API} from '../lib.mjs';
test('classifies form titles and moderator labels but excludes pull requests',()=>{
  assert.equal(categoryOf({title:'[二创] 放学后'}),'fiction');assert.equal(titleOf({title:'[二创] 放学后'}),'放学后');
  assert.equal(categoryOf({title:'[BUG] 下载失败'}),'bug');assert.equal(categoryOf({title:'[音色] e2',pull_request:{}}),null);
  assert.equal(categoryOf({title:'普通问题'}),null);assert.equal(categoryOf({title:'作品',labels:[{name:'community:voice'}]}),'voice');
});
test('reads exact issue form sections, not another field or arbitrary download text',()=>{
  const body='### 音色介绍\n\n新的声音\n\n### 下载链接\n\nhttps://example.com/model.zip\n\n### SHA-256\n\n'+'a'.repeat(64)+'\n\n### 模型与版本\n\nGPT-SoVITS v1\n\n### 授权与使用范围\n\n_No response_';
  assert.equal(fieldsOf(body)['音色介绍'],'新的声音');const result=voiceMetadata({body});assert.equal(result.url,'https://example.com/model.zip');assert.equal(result.sha256,'a'.repeat(64));assert.equal(result.license,'');
});
test('rejects credentials, script schemes, relative URLs and misleading digest values',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,x','file:///tmp/a','http://example.com','https://name:password@example.com/a','/relative'])assert.equal(safeUrl(value),null);
  assert.equal(voiceMetadata({body:'### SHA-256\nabc\n### 下载链接\njavascript:alert(1)'}).url,null);
  assert.equal(voiceMetadata({body:'### SHA-256\nabc'}).sha256,null);
});
test('renders supported Markdown without executable HTML or unsafe links',()=>{
  const result=markdown('# 标题\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n[good](https://example.com/a?b=1&c=2)\n\n- **项目**\n\n```html\n<img src=x onerror=alert(1)>\n```');
  assert.match(result,/<h2>标题<\/h2>/);assert.ok(!result.includes('<script>'));assert.ok(!result.includes('href="javascript:'));assert.match(result,/&lt;script&gt;/);assert.match(result,/rel="noopener noreferrer"/);assert.match(result,/<li><strong>项目<\/strong><\/li>/);assert.ok(!result.includes('<img'));
});
test('submission goes to correct official template with bounded encoded title',()=>{
  const url=new URL(submissionUrl('voice','声音 & <你好>'));assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,new URL(GITHUB).pathname+'/issues/new');assert.equal(url.searchParams.get('template'),'community-voice.yml');assert.equal(url.searchParams.get('title'),'[音色] 声音 & <你好>');assert.throws(()=>submissionUrl('unknown'));
});
test('pagination remains confined to the selected repository API',()=>{
  assert.equal(nextPage(`<${API}/issues?page=2>; rel="next", <${API}/issues?page=3>; rel="last"`),`${API}/issues?page=2`);assert.equal(nextPage(''),null);
  assert.throws(()=>apiPath('https://evil.example/repos/fqxxzyw/Yukino-Companion/issues'));assert.throws(()=>apiPath('https://api.github.com/repos/other/private/issues'));
});
test('GitHub response is parsed without authentication and respects pagination',async()=>{
  let options;const result=await request(`${API}/issues`,{fetcher:async(url,input)=>{options=input;return new Response(JSON.stringify([{number:1}]),{headers:{link:`<${API}/issues?page=2>; rel="next"`}});}});
  assert.equal(result.data[0].number,1);assert.equal(result.next,`${API}/issues?page=2`);assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);
});
test('rate limiting produces a recoverable message instead of fictional posts',async()=>{
  await assert.rejects(request(`${API}/issues`,{fetcher:async()=>new Response('{}',{status:403})}),/限制访问频率/);
});
