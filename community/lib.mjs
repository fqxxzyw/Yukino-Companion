export const REPOSITORY = 'fqxxzyw/Yukino-Companion';
export const GITHUB = `https://github.com/${REPOSITORY}`;
export const API = `https://api.github.com/repos/${REPOSITORY}`;
export const CATEGORIES = Object.freeze({
  fiction: {label:'二创文章',prefix:'[二创]',template:'community-fiction.yml',icon:'book',description:'把想象写成故事，让喜欢有迹可循。'},
  voice: {label:'音色分享',prefix:'[音色]',template:'community-voice.yml',icon:'wave',description:'分享训练成果、参考声音和使用心得。'},
  idea: {label:'功能建议',prefix:'[建议]',template:'community-idea.yml',icon:'spark',description:'一起决定，她的下一步会是什么样子。'},
  bug: {label:'问题反馈',prefix:'[Bug]',template:'community-bug.yml',icon:'bug',description:'记录遇到的问题，让每一次更新更可靠。'}
});
export function escapeHtml(value='') {return String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function safeUrl(value) {
  try {const u=new URL(String(value).trim());return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function categoryOf(issue) {
  if (!issue||issue.pull_request) return null;
  const title=String(issue.title||'');
  for(const [id,category] of Object.entries(CATEGORIES)) if(title.toLowerCase().startsWith(category.prefix.toLowerCase())) return id;
  const labels=(issue.labels||[]).map(label=>typeof label==='string'?label:label.name);
  return Object.keys(CATEGORIES).find(id=>labels.includes(`community:${id}`))||null;
}
export function titleOf(issue) {const category=categoryOf(issue);return (category?String(issue.title).replace(/^\[[^\]]+\]\s*/, ''):String(issue?.title||'')).trim()||'未命名内容';}
export function fieldsOf(body='') {
  const fields={};let key=null;
  for(const line of String(body).replaceAll('\r','').split('\n')) {const match=/^###\s+(.+?)\s*$/.exec(line);if(match){key=match[1];fields[key]='';}else if(key)fields[key]+=(fields[key]?'\n':'')+line;}
  return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.trim()==='_No response_'?'':value.trim()]));
}
export function excerptOf(issue,maximum=150) {
  const fields=fieldsOf(issue.body);const body=fields['作品简介']||fields['音色介绍']||fields['建议内容']||fields['问题描述']||issue.body||'';
  const plain=body.replace(/<!--[\s\S]*?-->/g,'').replace(/```[\s\S]*?```/g,' [代码] ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#>*_`~]/g,'').replace(/\s+/g,' ').trim();
  return plain.length>maximum?plain.slice(0,maximum)+'…':plain;
}
export function voiceMetadata(issue) {
  const fields=fieldsOf(issue.body),raw=(fields['下载链接']||'').trim();
  const url=safeUrl(raw),sha=(fields['SHA-256']||'').trim().toLowerCase();
  return {url,sha256:/^[a-f0-9]{64}$/.test(sha)?sha:null,model:fields['模型与版本']||'',reference:fields['参考音频与日文文本']||'',license:fields['授权与使用范围']||'',hasUnverifiedDigest:Boolean(sha&&!/^[a-f0-9]{64}$/.test(sha))};
}
// Raw HTML and images never execute. Links are opt-in HTTPS, with no credentials.
function inline(value,depth=0) {
  if(depth>3)return escapeHtml(value);
  const regex=/(`[^`\n]+`|\[[^\]\n]{1,300}\]\([^\s)]{1,2048}\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let result='',last=0;
  for(const match of value.matchAll(regex)){
    result+=escapeHtml(value.slice(last,match.index));const token=match[0];
    if(token[0]==='`') result+=`<code>${escapeHtml(token.slice(1,-1))}</code>`;
    else if(token.startsWith('**'))result+=`<strong>${inline(token.slice(2,-2),depth+1)}</strong>`;
    else if(token[0]==='*')result+=`<em>${inline(token.slice(1,-1),depth+1)}</em>`;
    else{const link=/^\[([^\]]+)\]\((.+)\)$/.exec(token),url=safeUrl(link[2]);result+=url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link[1])}</a>`:escapeHtml(link[1]);}
    last=match.index+token.length;
  }
  return result+escapeHtml(value.slice(last));
}
export function markdown(value='') {
  const lines=String(value).slice(0,100000).replaceAll('\r','').split('\n');let html='',paragraph=[],list=null,code=null;
  const flush=()=>{if(paragraph.length){html+='<p>'+paragraph.map(x=>inline(x)).join('<br>')+'</p>';paragraph=[];}if(list){html+=`</${list}>`;list=null;}};
  for(const line of lines){
    if(line.startsWith('```')){flush();if(code!==null){html+=`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;code=null;}else code=[];continue;}
    if(code!==null){code.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*(?:([-*])|\d+\.)\s+(.+)$/.exec(line);
    if(heading){flush();const n=Math.min(6,heading[1].length+1);html+=`<h${n}>${inline(heading[2])}</h${n}>`;}
    else if(bullet){if(paragraph.length)flush();const type=bullet[1]?'ul':'ol';if(list!==type){flush();list=type;html+=`<${type}>`;}html+=`<li>${inline(bullet[2])}</li>`;}
    else if(line.startsWith('> ')){flush();html+=`<blockquote>${inline(line.slice(2))}</blockquote>`;}
    else{if(list)flush();paragraph.push(line);}
  }
  flush();if(code!==null)html+=`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
  return html;
}
export function submissionUrl(category,title='') {
  const entry=CATEGORIES[category];if(!entry)throw Error('请选择投稿分类');
  const url=new URL(`${GITHUB}/issues/new`);url.searchParams.set('template',entry.template);
  if(title.trim())url.searchParams.set('title',`${entry.prefix} ${title.trim().slice(0,160)}`);
  return url.href;
}
export function issueUrl(number) {if(!Number.isSafeInteger(number)||number<1)throw Error('无效内容编号');return `${GITHUB}/issues/${number}`;}
export function apiPath(path) {
  const url=new URL(path,API+'/');if(url.origin!=='https://api.github.com'||!url.pathname.startsWith(`/repos/${REPOSITORY}/`))throw Error('无效 GitHub 请求地址');return url.href;
}
export function nextPage(link='') {const item=link.split(',').find(x=>/rel="next"/.test(x));if(!item)return null;const url=/<([^>]+)>/.exec(item)?.[1];return url?apiPath(url):null;}
export async function request(path,{signal,fetcher=fetch}={}) {
  const timeout=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetcher(apiPath(path),{headers:{Accept:'application/vnd.github+json'},signal:combined,credentials:'omit'});
  if(!response.ok){const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;const err=Error(response.status===403||response.status===429?'GitHub 暂时限制访问频率，请稍后刷新，或直接前往 GitHub 查看。':response.status===404?'这条内容不存在、已删除或暂不可公开访问。':`GitHub 暂时无法读取（${response.status}），可以稍后重试。`);err.status=response.status;if(Number.isFinite(reset)&&reset>Date.now())err.reset=reset;throw err;}
  const text=await response.text();if(text.length>6000000)throw Error('内容超过单次读取限制，请前往 GitHub 查看。');
  return {data:JSON.parse(text),next:nextPage(response.headers.get('link')||'')};
}
