import React,{useState} from 'react';
import {ChevronDown,ChevronRight,MessageCircle,Trash2,UserRound} from 'lucide-react';

export function contactGroups(characters,conversations,query=''){
 const needle=query.trim().toLocaleLowerCase();
 return characters.map(character=>{
  const own=conversations.filter(item=>item.characterId===character.id);
  const nameMatch=character.name.toLocaleLowerCase().includes(needle);
  const matching=needle&&!nameMatch?own.filter(item=>String(item.title||'').toLocaleLowerCase().includes(needle)):own;
  return {character,conversations:matching,total:own.length,nameMatch};
 }).filter(group=>!needle||group.nameMatch||group.conversations.length);
}

// Pinned built-in previews are local rendered views of each outfit. User
// imports without a local preview keep a neutral fallback; never fetch an
// external image while the contacts list is displayed.
export function ContactAvatar({character={},models=[]}){
 const thumbnail=models.find(model=>model.id===character.modelId)?.thumbnail;
 const source=typeof thumbnail==='string'&&/^\.\/characters\/thumbnails\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(thumbnail)?thumbnail:'';
 const [failed,setFailed]=useState('');
 return <span className="contact-avatar" aria-hidden="true">{source&&failed!==source?<img src={source} alt="" onError={()=>setFailed(source)}/>:<UserRound size={16}/>}</span>;
}

export default function ContactsSidebar({characters=[],conversations=[],models=[],activeCharacter,activeConversation,collapsed=false,query='',busy=false,onCharacter,onConversation,onDelete}){
 const [expanded,setExpanded]=useState({});const searching=!!query.trim();
 return <div className="history contacts-list" aria-label="联系人">
  {contactGroups(characters,conversations,query).map(({character,conversations:items,total})=>{
   const open=searching||Boolean(expanded[character.id]??character.id===activeCharacter),selected=character.id===activeCharacter;
   return <section className="contact-group" key={character.id}>
    <div className={'contact-row '+(selected?'selected':'')}>
     {!collapsed&&<button type="button" className="contact-expand" aria-label={`${open?'收起':'展开'}${character.name}的对话`} aria-expanded={open} onClick={()=>setExpanded(current=>({...current,[character.id]:!open}))}>{open?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>}
     <button type="button" className="contact-select" disabled={busy} title={character.name} aria-current={selected?'true':undefined} onClick={()=>onCharacter?.(character.id)}><ContactAvatar character={character} models={models}/>{!collapsed&&<><span className="contact-name">{character.name}</span><small>{total}</small></>}</button>
    </div>
    {!collapsed&&open&&<div className="contact-conversations">{items.map(item=><div key={item.id} className={'history-row '+(item.id===activeConversation?'selected':'')}><button type="button" title={item.title} disabled={busy} onClick={()=>onConversation?.(character.id,item.id)}><MessageCircle size={14}/><span>{item.title||'新对话'}</span></button><button type="button" className="icon" disabled={busy} title="删除这段对话" aria-label={`删除对话：${item.title||'新对话'}`} onClick={()=>onDelete?.(item)}><Trash2 size={13}/></button></div>)}{!items.length&&<p className="empty-history">{searching?'没有匹配的对话':'暂无对话'}</p>}</div>}
   </section>;
  })}
  {!collapsed&&searching&&!contactGroups(characters,conversations,query).length&&<p className="empty-history">没有找到角色或对话。</p>}
 </div>;
}
