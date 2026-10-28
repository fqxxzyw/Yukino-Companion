// Lightweight DOM contract tests. Browser rendering and native history remain in browser_smoke.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as lib from '../lib.mjs';

const source=(await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
const help=JSON.parse(await fs.readFile(new URL('../help-content.json',import.meta.url),'utf8'));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function harness({hash='#home',fetchHelp=async()=>({ok:true,json:async()=>help}),read=async()=>({data:[],next:null})}={}){
  const elements=new Map(),all=new Map(),windowEvents=new Map();
  let document;
  class Element {
    constructor(name){this.name=name;this.attrs={};this.dataset={};this.handlers=new Map();this.hidden=false;this.disabled=false;this.open=false;this.value='';this._html='';this.textContent='';this.children=[];this.classList={toggle:(name,on)=>{this.attrs[name]=on;}};}
    get innerHTML(){return this._html;}
    set innerHTML(value){this._html=value;this.children=[...value.matchAll(/<article\b/g)];
      for(const [selector,needle] of [['#retry-help','id="retry-help"'],['.empty-publish','class="button secondary empty-publish"']]){
        if(value.includes(needle))elements.set(selector,new Element(selector));else if((selector==='#retry-help'&&this.name==='#help-article')||(selector==='.empty-publish'&&this.name==='#posts'))elements.delete(selector);
      }
      if(this.name==='#publish-options')all.set('[data-publish]',[...value.matchAll(/data-publish="([^"]+)"/g)].map(match=>{const el=new Element(match[1]);el.dataset.publish=match[1];return el;}));
    }
    insertAdjacentHTML(position,html){this.innerHTML+=html;}
    addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn);}
    async fire(type,event={}){for(const fn of this.handlers.get(type)||[])await fn({target:this,preventDefault(){},...event});}
    click(){return this.fire('click');}
    setAttribute(key,value){this.attrs[key]=value;}
    removeAttribute(key){delete this.attrs[key];}
    showModal(){if(this.open)throw Error('dialog already open');this.open=true;}
    close(){this.open=false;}
    focus(){document.activeElement=this;}
    scrollIntoView(){this.scrolled=true;}
    getBoundingClientRect(){return {left:20,top:20,right:400,bottom:500};}
  }
  for(const selector of ['#hero','#feed-section','#detail-section','#help-section','#bottom-callout','#feed-title','#feed-description','#feed-meta','#load-more','#refresh','#posts','#feed-notice','#publish-options','#draft-title','#publish-continue','#publish-dialog','#help-article','#help-nav','#hero-publish','#publish-button','#search','.tabs','.skip-link','#content','#comments-list','#more-comments'])elements.set(selector,new Element(selector));
  const categories=['all',...Object.keys(lib.CATEGORIES)].map(category=>{const e=new Element(category);e.dataset.category=category;return e;});
  all.set('[data-category]',categories);all.set('.tabs button',categories);
  all.set('[data-nav]',['home','voice','help'].map(nav=>{const e=new Element(nav);e.dataset.nav=nav;return e;}));
  document={title:'',activeElement:null,querySelector:selector=>elements.get(selector)||null,querySelectorAll:selector=>all.get(selector)||[]};
  const location={hash};
  const window={addEventListener(type,fn){windowEvents.set(type,fn);},scrollTo(){}};
  const requests=[];
  const context=vm.createContext({...lib,URL,Intl,AbortController,document,location,window,fetch:fetchHelp,request:async(path,options)=>{requests.push({path,options});return read(path,options);}});
  vm.runInContext(source,context);
  return {elements,all,document,requests,async settled(){await turn();await turn();},async route(value){location.hash=value;windowEvents.get('hashchange')();await turn();await turn();},get hash(){return location.hash;}};
}

test('publishing is repeatable, encoded, and dismissed on navigation or backdrop',async()=>{
  const app=harness();await app.settled();
  const el=selector=>app.elements.get(selector);
  await el('#hero-publish').click();await el('#hero-publish').click();
  assert.equal(el('#publish-dialog').open,true);
  await app.all.get('[data-publish]').find(x=>x.dataset.publish==='voice').click();
  el('#draft-title').value='资源 & 标题';await el('#draft-title').fire('input');
  const url=new URL(el('#publish-continue').href);
  assert.equal(url.searchParams.get('template'),'community-voice.yml');assert.equal(url.searchParams.get('title'),'[音色] 资源 & 标题');
  await el('#publish-dialog').fire('click',{clientX:0,clientY:0});assert.equal(el('#publish-dialog').open,false);
  await el('#hero-publish').click();await app.route('#help/api');
  assert.equal(el('#publish-dialog').open,false);assert.equal(el('#help-section').hidden,false);
  assert.match(el('#help-article').innerHTML,/对话 API 配置/);
});

test('help deep links, unknown sections and skip focus retain their route contract',async()=>{
  const app=harness({hash:'#help/download'});await app.settled();const el=s=>app.elements.get(s);
  assert.match(el('#help-article').innerHTML,/资源下载与故障处理/);
  assert.match(el('#help-nav').innerHTML,/<a href="#help\/download" class="active" aria-current="page"/);
  await el('.skip-link').click();assert.equal(app.hash,'#help/download');assert.equal(app.document.activeElement,el('#content'));
  await app.route('#help/unknown');assert.match(el('#help-article').innerHTML,/未找到帮助章节/);
  await app.route('#help/community-api');assert.match(el('#help-article').innerHTML,/GET \/repos\/fqxxzyw/);
  await app.route('#help/download');assert.match(el('#help-article').innerHTML,/资源下载与故障处理/);
});

test('failed or invalid help is not cached and the retry loads the requested chapter',async()=>{
  for(const first of [{ok:false},{ok:true,json:async()=>({sections:[]})}]){
    let calls=0;
    const app=harness({hash:'#help/voice',fetchHelp:async()=>++calls===1?first:{ok:true,json:async()=>help}});
    await app.settled();assert.match(app.elements.get('#help-article').innerHTML,/帮助文档暂时无法读取/);
    await app.elements.get('#retry-help').click();await app.settled();
    assert.match(app.elements.get('#help-article').innerHTML,/日语翻译与语音合成/);assert.equal(calls,2);
  }
});

test('stale help completion cannot overwrite a newer route',async()=>{
  let resolve;
  const app=harness({hash:'#help/api',fetchHelp:()=>new Promise(done=>{resolve=done;})});
  await app.route('#home');
  resolve({ok:true,json:async()=>help});await app.settled();
  assert.equal(app.elements.get('#help-section').hidden,true);
  assert.equal(app.elements.get('#hero').hidden,false);
  assert.equal(app.document.title,'Yukino · 资源与使用文档');
  assert.ok(!app.elements.get('#help-article').innerHTML.includes('对话 API 配置'));
});

test('categories and search filter only community items and hide unlisted content',async()=>{
  const app=harness({read:async()=>({data:[{number:1,title:'[二创] 文章',body:'内容',labels:[]},{number:2,title:'[音色] 音色',body:'版本',labels:[]},{number:3,title:'普通记录',labels:[]},{number:4,title:'[Bug] PR',pull_request:{}},{number:5,title:'[二创] 隐藏',labels:[{name:'community:hidden'}]}],next:null})});
  await app.settled();const el=s=>app.elements.get(s);
  assert.equal((el('#posts').innerHTML.match(/class="post-card"/g)||[]).length,2);
  await app.route('#voice');assert.equal((el('#posts').innerHTML.match(/class="post-card"/g)||[]).length,1);assert.equal(el('#hero').hidden,true);
  el('#search').value='missing';await el('#search').fire('input');assert.match(el('#posts').innerHTML,/还没有找到匹配内容/);
  el('#search').value='';await el('#search').fire('input');assert.match(el('#posts').innerHTML,/音色/);
  await app.route('#home');assert.equal(el('#feed-title').textContent,'社区内容');
});
