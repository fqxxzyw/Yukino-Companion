import {GITHUB,escapeHtml,validateHelpContent,helpArticleHtml} from './lib.mjs';
const nav=document.querySelector('#help-nav'),article=document.querySelector('#help-article');
let content,revision=0,controller;
function sectionId(){
  const raw=location.hash.slice(1).replace(/^help\//,'');
  if(raw==='content'||raw==='help')return '';
  try{return decodeURIComponent(raw);}catch{return '\uFFFD';}
}
async function show(){
  const id=sectionId(),turn=++revision;
  controller?.abort();
  controller=new AbortController();
  try{
    if(!content){
      const res=await fetch(new URL('./help-content.json',import.meta.url),{signal:controller.signal});
      if(!res.ok)throw Error('帮助文档暂未加载成功。');
      const data=validateHelpContent(await res.json());
      if(turn!==revision)return;
      content=data;
    }
    const sections=content.sections,active=id?sections.find(section=>section.id===id):sections[0];
    nav.innerHTML=sections.map(section=>`<a href="#${encodeURIComponent(section.id)}"${section===active?' class="active" aria-current="page"':''}>${escapeHtml(section.title)}</a>`).join('');
    if(!active){
      article.innerHTML='<h2>未找到帮助章节</h2><p>请从目录选择章节，或返回使用文档首页。</p><a class="button secondary" href="#start">打开安装与首次配置</a>';
      document.title='未找到帮助章节 · Yukino 帮助';
      return;
    }
    article.innerHTML=helpArticleHtml(active,content.updatedAt);
    document.title=`${active.title} · Yukino 帮助`;
  }catch{
    if(turn!==revision)return;
    article.innerHTML=`<h2>帮助文档暂时无法读取</h2><p><a href="${GITHUB}/tree/main/docs" target="_blank" rel="noopener noreferrer">直接查看仓库文档 ↗</a></p><button id="retry-help" class="button secondary" type="button">重试</button>`;
    article.querySelector('#retry-help').addEventListener('click',show);
  }
}
window.addEventListener('hashchange',()=>{if(location.hash!=='#content')show();});
document.querySelector('.skip-link')?.addEventListener('click',e=>{e.preventDefault();document.querySelector('#content').focus();});
show();
