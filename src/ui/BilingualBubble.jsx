import React from 'react';
export function LanguageSwitch({value,onChange,label='气泡显示语言',compact=false}) {
  return <div className={'segmented language-switch'+(compact?' compact':'')} role="group" aria-label={label}>{[['zh','中文'],['ja','日本語'],['both','双语']].map(([v,t])=><button key={v} type="button" aria-pressed={value===v} className={value===v?'active':''} onClick={()=>onChange(v)}>{t}</button>)}</div>;
}
export function messageCopy(message,language) {const zh=message.zh||message.content||'',ja=message.ja||'';return language==='both'&&zh&&ja?`${zh}\n\n${ja}`:language==='ja'&&ja?ja:zh||ja;}
export default function BilingualBubble({message,language}) {
 const zh=message.zh||message.content||'',ja=message.ja||'',waiting=message.status==='streaming';
 if(message.role!=='assistant')return <div className="bubble">{message.content}</div>;
 if(!zh&&!ja)return <div className="bubble thinking">{waiting?'正在思考…':message.status==='stopped'?'已停止':'没有收到回复'}</div>;
 return <div className={'bubble bilingual '+(language==='both'?'two-languages':'')}>
  {(language!=='ja'||!ja)&&<div className="language-block" lang="zh-CN">{language==='both'&&<span className="language-label">中文</span>}{zh}</div>}
  {(language!=='zh'||!zh)&&ja&&<div className="language-block japanese" lang="ja">{language==='both'&&<span className="language-label">日本語</span>}{!zh&&language==='zh'&&<span className="language-label">中文暂不可用 · 日文原文</span>}{ja}</div>}
  {language==='ja'&&!ja&&<span className="translation-note">{waiting?'中文已返回，日文准备中':'尚无日文版本 · 以上显示中文原文'}</span>}
 </div>;
}
