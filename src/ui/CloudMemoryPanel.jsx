import React,{useEffect,useState} from 'react';
import {Cloud,RefreshCw,Trash2,Upload,Download,ShieldCheck} from 'lucide-react';
import './cloud-memory.css';

function resultError(result) {
  const error = result?.error || {};
  return {message: error.message || '账号操作没有完成。', code: error.code || '', remote: error.data?.remote || null};
}

export default function CloudMemoryPanel({api,account,character,memory,conversation,onRestore,onNotice}) {
  const [settings,setSettings]=useState({syncMemory:false,syncChat:false});
  const [cloud,setCloud]=useState(null);
  const [chat,setChat]=useState([]);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const loggedIn=account?.mode==='account';
  const characterId=character?.id||'';
  const currentMemory=String(memory||'');
  const saveNotice=message=>{setNotice(message);onNotice?.(message)};

  async function load(){
    if(!loggedIn||!api?.accountMemorySettings||!characterId)return;
    setError('');
    try{
      const [settingsResult,memoryResult]=await Promise.all([api.accountMemorySettings(),api.accountMemoryGet(characterId)]);
      if(settingsResult?.ok)setSettings(settingsResult.data.settings||{});
      else setError(resultError(settingsResult).message);
      if(memoryResult?.ok)setCloud(memoryResult.data.memory||null);
    }catch(caught){setError(String(caught?.message||caught))}
  }
  useEffect(()=>{void load()},[loggedIn,characterId,account?.profileId]);

  async function saveSettings(next){
    setBusy('settings');setError('');
    try{
      const result=await api.accountSetMemorySettings(next);
      if(!result?.ok){setError(resultError(result).message);return}
      setSettings(result.data.settings||next);
      saveNotice('云端记忆设置已保存。');
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function upload(baseVersion){
    if(!currentMemory.trim()){setError('当前本地记忆为空，没有可上传的文字。');return}
    setBusy('upload');setError('');
    try{
      const result=await api.accountMemorySave({id:characterId,text:currentMemory,baseVersion:baseVersion??(cloud?.version||0)});
      if(!result?.ok){
        const failure=resultError(result);
        if(failure.code==='memory_conflict'&&failure.remote){
          setCloud(failure.remote);
          setError('云端已有更新版本。请先查看或合并；选择“覆盖云端”会使用云端版本号重新上传当前本地记忆。');
          return;
        }
        setError(failure.message);return;
      }
      setCloud(result.data.memory||null);
      saveNotice('当前文字记忆已同步到云端。');
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function restore(){
    if(!cloud?.text){setError('云端没有可恢复的文字记忆。');return}
    if(currentMemory.trim()&&currentMemory!==cloud.text&&!window.confirm('云端记忆与本地不同。恢复云端内容会替换当前本地记忆，是否继续？'))return;
    onRestore?.(cloud.text);
    saveNotice('已恢复云端文字记忆。');
  }
  async function remove(){
    if(!window.confirm('删除这个账号在云端的当前角色记忆？本地记忆不会被删除。'))return;
    setBusy('remove');setError('');
    try{
      const result=await api.accountMemoryDelete(characterId);
      if(!result?.ok){setError(resultError(result).message);return}
      setCloud({text:'',version:(cloud?.version||0)+1,deleted:true,updatedAt:Date.now()});
      saveNotice('云端记忆已删除，本地记忆仍在。');
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function uploadChat(){
    const messages=(conversation?.messages||[]).filter(message=>message&&['user','assistant'].includes(message.role)&&(message.content||message.zh)).slice(-50).map(message=>({
      id:String(message.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,100),
      role:message.role,
      text:String(message.content||message.zh||'').slice(0,4000),
      createdAt:Number(message.createdAt)||Date.now(),
    })).filter(message=>message.id&&message.text.trim());
    if(!messages.length){setError('当前会话没有可上传的纯文字消息。');return}
    setBusy('chat');setError('');
    try{
      const result=await api.accountPushCloudChat({id:characterId,conversationId:String(conversation?.id||'current'),messages});
      if(!result?.ok){setError(resultError(result).message);return}
      saveNotice(`已同步 ${messages.length} 条纯文字消息；未上传语音、图片或附件。`);
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function loadChat(){
    setBusy('chat-load');setError('');
    try{
      const result=await api.accountCloudChat({id:characterId,conversationId:conversation?.id||''});
      if(!result?.ok){setError(resultError(result).message);return}
      setChat(result.data.messages||[]);
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function removeChat(){
    if(!window.confirm('删除当前角色在云端的纯文字对话？本地聊天不会被删除。'))return;
    setBusy('chat-delete');setError('');
    try{
      const result=await api.accountDeleteCloudChat({id:characterId,conversationId:conversation?.id||''});
      if(!result?.ok){setError(resultError(result).message);return}
      setChat([]);saveNotice('云端文字对话已删除，本地聊天仍在。');
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }

  if(!api?.accountMemorySettings)return null;
  if(!loggedIn)return <section className="cloud-memory-panel cloud-memory-guest"><Cloud size={16}/><div><strong>云端长期记忆</strong><span>登录账号后可用。游客记忆只保存在本机。</span></div></section>;
  return <section className="cloud-memory-panel">
    <header><div><span className="cloud-memory-kicker">CLOUD MEMORY</span><strong>云端长期记忆</strong><small>只同步文字；D1 中为明文，不是端到端加密。原始聊天仍在本机。恢复记忆后才会随对话发送给模型，云端聊天不会自动注入提示词。</small></div><Cloud size={18}/></header>
    <div className="cloud-memory-settings">
      <label><input type="checkbox" checked={settings.syncMemory===true} disabled={Boolean(busy)} onChange={event=>saveSettings({...settings,syncMemory:event.target.checked})}/><span>同步当前角色的文字记忆</span></label>
      <label><input type="checkbox" checked={settings.syncChat===true} disabled={Boolean(busy)} onChange={event=>saveSettings({...settings,syncChat:event.target.checked})}/><span>同步纯文字聊天记录</span></label>
    </div>
    <div className="cloud-memory-row">
      <span className={`cloud-memory-state ${settings.syncMemory?'on':''}`}><ShieldCheck size={13}/>{settings.syncMemory?'文字记忆同步已开启':'文字记忆同步未开启'}</span>
      <span className="cloud-memory-count">{currentMemory.length} 字符本地 · {cloud?.text?`${cloud.text.length} 字符云端`: '云端为空'}</span>
    </div>
    <div className="cloud-memory-actions">
      <button type="button" className="secondary" disabled={Boolean(busy)||!settings.syncMemory} onClick={()=>upload()}><Upload size={14}/>{busy==='upload'?'同步中…':'上传当前记忆'}</button>
      <button type="button" className="secondary" disabled={Boolean(busy)||!cloud?.text} onClick={restore}><Download size={14}/>从云端恢复</button>
      {cloud?.text&&<button type="button" className="text-link" disabled={Boolean(busy)} onClick={remove}><Trash2 size={13}/>删除云端记忆</button>}
    </div>
    {cloud?.text&&<details className="cloud-memory-preview"><summary>查看云端记忆 · v{cloud.version}</summary><pre>{cloud.text}</pre></details>}
    <div className="cloud-memory-chat">
      <div className="cloud-memory-row"><strong>纯文字对话</strong><span>{settings.syncChat?'云端同步已开启':'默认关闭'}</span></div>
      <div className="cloud-memory-actions">
        <button type="button" className="secondary" disabled={Boolean(busy)||!settings.syncChat||!conversation} onClick={uploadChat}><Upload size={14}/>上传最近文字对话</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={loadChat}><RefreshCw size={14}/>查看云端对话</button>
        <button type="button" className="text-link" disabled={Boolean(busy)} onClick={removeChat}><Trash2 size={13}/>删除云端对话</button>
      </div>
      {chat.length>0&&<details className="cloud-memory-preview" open><summary>最近 {chat.length} 条云端文字</summary><ul>{chat.map(message=><li key={message.id}><span>{message.role==='user'?'你':character?.name||'角色'}</span><p>{message.text}</p></li>)}</ul></details>}
    </div>
    {error&&<p className="cloud-memory-error" role="alert">{error}</p>}
    {notice&&<p className="cloud-memory-notice" role="status">{notice}</p>}
  </section>;
}
