import React,{useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,Search,X} from 'lucide-react';
import {SETTINGS_PAGES,filterSettingsPages,settingsFamily} from './settings-pages.mjs';

// A workspace page, not a dialog: navigation and window controls remain usable.
export default function SettingsShell({page,onNavigate,onBack,icons={},resourceNotice,children}) {
  const [query,setQuery]=useState('');
  const heading=useRef(null),body=useRef(null),search=useRef(null);
  const current=SETTINGS_PAGES.find(item=>item.id===page)||SETTINGS_PAGES[0];
  const filtered=filterSettingsPages(query).filter(item=>query.trim()||!item.hiddenInNavigation);
  const family=settingsFamily(current.id),root=current.parent||current.id;
  function navigate(id){setQuery('');onNavigate(id);}
  useLayoutEffect(()=>{body.current?.scrollTo?.(0,0);heading.current?.focus({preventScroll:true});},[page]);
  return <section className="settings settings-page" aria-label="设置">
    <aside className="settings-nav" aria-label="设置导航">
      <h2>设置</h2>
      <div className="settings-search"><Search size={15}/><input ref={search} aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清除设置搜索" onClick={()=>{setQuery('');search.current?.focus();}}><X size={14}/></button>}</div>
      <nav aria-label="设置页面">{filtered.map(item=>{const Icon=icons[item.icon],selected=page===item.id||root===item.id;return <button type="button" key={item.id} aria-current={page===item.id?'page':root===item.id?'location':undefined} className={selected?'selected':''} onClick={()=>navigate(item.id)}>{Icon&&<Icon size={17}/>}<span>{item.label}</span></button>;})}{!filtered.length&&<p className="settings-search-empty" role="status">没有找到相关页面。试试「语音」「人物」或「API」。</p>}</nav>
    </aside>
    <section className="settings-main" aria-labelledby="settings-page-title">
      <header><div className="settings-heading"><div><h1 id="settings-page-title" ref={heading} tabIndex={-1}>{current.label}</h1><p>{current.description}</p></div><button className="secondary settings-return" type="button" aria-label="返回对话" title="返回对话" onClick={onBack}><ArrowLeft size={15}/><span>返回对话</span></button></div></header>
      <div className="settings-body" ref={body}><div className="settings-content">
        {resourceNotice}
        <div className="settings-page-content" key={page}>
        {root==='advanced'&&current.parent&&<button type="button" className="text-link settings-parent" onClick={()=>navigate(root)}><ArrowLeft size={14}/>返回高级与资源</button>}
        {root!=='advanced'&&family.length>1&&<nav className="settings-subnav" aria-label="当前分组的设置">{family.map(item=><button type="button" key={item.id} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.tabLabel||item.label}</button>)}</nav>}
        {children}
        </div>
      </div></div>
    </section>
  </section>;
}
