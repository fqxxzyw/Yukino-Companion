import React,{useEffect,useState} from 'react';
import {Check,Cloud,LogOut,RefreshCw,ShieldCheck,UserRound,X} from 'lucide-react';
import {accountResultError,accountStatus,skinName} from './account-status.mjs';

function statusTone(account) {
  return accountStatus(account).tone;
}

export default function AccountCenter({api,account,onAccount,onOpenGate}) {
  const [sessions,setSessions]=useState([]);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const isAccount=account?.mode==='account';
  const status=accountStatus(account);
  const progress=account?.progress;
  const cloudSkins=new Set(account?.cloudSkins||[]);

  function accept(result) {
    if (result?.ok) { setError(''); onAccount?.(result.state); return true; }
    setError(accountResultError(result)); return false;
  }
  async function run(label,action,success) {
    setBusy(label);setError('');setNotice('');
    try{
      const result=await action();
      if(accept(result)&&success)setNotice(success);
      return result;
    }catch(caught){setError(String(caught?.message||caught));return null}
    finally{setBusy('')}
  }
  async function loadSessions() {
    if(!isAccount)return;
    try{
      const result=await api.accountSessions();
      if(result?.ok)setSessions(result.data?.sessions||[]);
      else setSessions([]);
    }catch{setSessions([])}
  }
  useEffect(()=>{void loadSessions();},[account?.profileId,account?.status]);
  useEffect(()=>{setSessions([]);setCurrentPassword('');setNewPassword('');setConfirmPassword('');},[account?.profileId]);

  async function checkin(){await run('checkin',()=>api.accountCheckin(),'今日确认完成。');await loadSessions()}
  async function sync(){await run('sync',()=>api.accountSync(),'待同步进度已提交。');await loadSessions()}
  async function refresh(){await run('refresh',()=>api.accountRefresh(),'账号进度已刷新。');await loadSessions()}
  async function switchGuest(){
    if(!window.confirm('切换到游客档案？账号进度会保留，之后可切回；当前本地聊天和设置不会被删除。'))return;
    await run('switch',()=>api.accountSwitchGuest(),'已切换到游客档案。');
  }
  async function logout(){
    if(!window.confirm('退出当前账号？会清除本机保存的登录凭据并回到游客档案；聊天、模型和本地皮肤不会删除。'))return;
    const result=await run('logout',()=>api.accountLogout(),'');
    if(result?.ok)setNotice(result.state?.remoteRevoked===false?'已退出本机；远端会话撤销尚未完成，恢复联网后请重新登录并检查设备。':'已退出账号，已回到游客档案。');
  }
  async function logoutAll(){
    if(!window.confirm('退出所有设备？该账号的所有会话都会失效，需要重新登录。'))return;
    const result=await run('logout-all',()=>api.accountLogoutAll(),'');
    if(result?.ok)setNotice(result.state?.remoteRevoked===false?'已清除本机凭据；远端全部会话撤销尚未完成，恢复联网后请重新登录检查设备。':'已退出所有设备。');
  }
  async function revoke(id){
    if(!window.confirm('撤销这个设备的登录状态？'))return;
    setBusy(`revoke-${id}`);setError('');
    try{
      const result=await api.accountRevokeSession(id);
      if(!result?.ok){setError(accountResultError(result));return}
      setNotice('会话已撤销。');await loadSessions();
    }catch(caught){setError(String(caught?.message||caught))}
    finally{setBusy('')}
  }
  async function changePassword(event){
    event.preventDefault();
    setError('');setNotice('');
    if(!currentPassword){setError('请输入当前密码。');return}
    if(Array.from(newPassword).length<15){setError('新密码至少需要 15 个字符。');return}
    if(newPassword!==confirmPassword){setError('两次输入的新密码不一致。');return}
    const result=await run('password',()=>api.accountChangePassword({currentPassword,newPassword}),'密码已修改，其他设备需要重新登录。');
    if(result?.ok){setCurrentPassword('');setNewPassword('');setConfirmPassword('')}
  }

  const skinRows=progress?.skins?.length?progress.skins.map(skin=>({
    id:skin.id,label:skinName(skin.id),unlocked:skin.unlocked||cloudSkins.has(skin.id),detail:skin.kind==='base'?'默认可用':skin.unlocked?'账号已确认':`${skin.kind==='affection'?'好感':'登录天数'} ${skin.current} / ${skin.target}`,
  })):[...cloudSkins].map(id=>({id,label:skinName(id),unlocked:true,detail:'账号已确认'}));

  if(!isAccount) return <div className="account-center">
    <div className="account-hero">
      <div><span className={`account-status-dot ${status.tone}`}></span><span>游客模式</span><h3>当前进度保存在本机</h3><p>不登录也可以正常使用。登录后使用账号进度；游客好感度、使用日期和本地皮肤资格会保留，切回游客可继续。</p></div>
      <button type="button" className="primary" onClick={onOpenGate}><UserRound size={15}/>登录或注册</button>
    </div>
    {error&&<p className="account-error" role="alert">{error}</p>}
    {notice&&<p className="account-notice" role="status">{notice}</p>}
    <div className="account-guest-note"><ShieldCheck size={16}/><div><strong>游客进度不会自动上传</strong><span>账号与游客使用不同档案，登录不会把游客数值合并到云端，也不会删除游客进度。</span></div></div>
  </div>;

  return <div className="account-center">
    <div className="account-hero">
      <div>
        <span className={`account-status-dot ${statusTone(account)}`}></span>
        <span>{account.profile?.email||'已登录账号'}</span>
        <h3>{status.label}</h3>
        <p>{account.status==='reauth-required'?'需要重新输入密码后才能访问云操作；本地档案、聊天和已下载资源仍可用。':account.status==='authenticated-offline'?'账号服务不可达时会继续本地使用。恢复连接后会自动刷新并同步待提交的互动。':'登录天数、好感度和永久皮肤以服务器确认值为准。'}</p>
      </div>
      <div className="account-hero-actions">
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={refresh}>{busy==='refresh'?<RefreshCw size={14} className="spin"/>:<RefreshCw size={14}/>}刷新</button>
        {account.status==='reauth-required'?<button type="button" className="primary" onClick={onOpenGate}>重新登录</button>:null}
      </div>
    </div>
    {error&&<p className="account-error" role="alert">{error}</p>}
    {notice&&<p className="account-notice" role="status">{notice}</p>}
    {account.credentialsUnavailable?<p className="account-warning">系统安全存储当前不可用，无法恢复云端会话。本地档案不会被删除；本次登录只能在当前运行期间保持。</p>:null}
    <div className="account-stats">
      <div><strong>{Number(progress?.affection)||0}</strong><span>已确认好感度</span></div>
      <div><strong>{Number(progress?.loginDays)||0}</strong><span>累计登录天数</span></div>
      <div><strong>{account.pendingCount||0}</strong><span>待同步互动</span></div>
      <div><strong>{[...cloudSkins].filter(id=>id!=='yukino-07-v1').length}</strong><span>已确认皮肤</span></div>
    </div>
    <div className="account-columns">
      <section className="account-card">
        <header><h4>进度与皮肤</h4><p>服务器确认的进度与本地档案分开保存。</p></header>
        <div className="account-progress-actions">
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={checkin}>{busy==='checkin'?'确认中…':progress?.checkedInToday?'今日已确认':'今日确认'}</button>
          <button type="button" className="secondary" disabled={Boolean(busy)||!account.pendingCount} onClick={sync}>{busy==='sync'?'同步中…':'同步待提交互动'}</button>
        </div>
        <ul className="account-skin-list">{skinRows.length?skinRows.map(skin=><li key={skin.id} className={skin.unlocked?'unlocked':''}><span className="account-skin-name">{skin.label}</span><span>{skin.detail}</span>{skin.unlocked&&<Check size={13}/>}</li>):<li><span className="account-skin-name">登录后会显示账号皮肤进度</span></li>}</ul>
        <p className="account-footnote">每日确认按上海自然日计一次。离线待同步的互动不会提前解锁云端皮肤；已确认的永久皮肤不会因断网收回。</p>
      </section>
      <section className="account-card">
        <header><h4>设备与会话</h4><p>只显示当前账号的登录设备。</p></header>
        <ul className="account-session-list">{sessions.length?sessions.map(session=><li key={session.id}><div><strong>{session.deviceLabel||session.client}{session.current?' · 当前设备':''}</strong><small>最近使用 {formatTime(session.lastUsedAt)} · 到期 {formatTime(session.expiresAt)}</small></div>{session.current?<span className="account-current">当前</span>:<button type="button" className="text-link" disabled={Boolean(busy)} onClick={()=>revoke(session.id)}>{busy===`revoke-${session.id}`?'撤销中…':'撤销'}</button>}</li>):<li><span className="account-skin-name">暂时无法读取会话</span></li>}</ul>
        <div className="account-session-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={logout}><LogOut size={14}/>退出当前账号</button><button type="button" className="secondary" disabled={Boolean(busy)} onClick={logoutAll}>退出所有设备</button></div>
        <button type="button" className="text-link account-switch" disabled={Boolean(busy)} onClick={switchGuest}>切换到游客档案（保留账号登录）</button>
        <p className="account-footnote">退出账号会清除本机保存的登录凭据并回到游客档案；聊天、模型、下载资源和本地皮肤不会被删除。</p>
      </section>
    </div>
    <section className="account-card account-password">
      <header><h4>修改密码</h4><p>需要当前密码。成功后其他设备会退出登录，并发送安全通知邮件。</p></header>
      <form className="account-password-form" onSubmit={changePassword} noValidate>
        <label className="field account-field"><span>当前密码</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} disabled={Boolean(busy)}/></label>
        <label className="field account-field"><span>新密码</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} disabled={Boolean(busy)}/><small>至少 15 个字符，最多 128 个字符。</small></label>
        <label className="field account-field"><span>确认新密码</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} disabled={Boolean(busy)}/></label>
        <button className="primary" type="submit" disabled={Boolean(busy)}>{busy==='password'?'修改中…':'修改密码'}</button>
      </form>
    </section>
    <div className="account-links-row"><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/account')}><Cloud size={14}/>打开网页账号中心</button><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/forgot')}>网页找回密码</button></div>
  </div>;
}

function formatTime(value){
  const date=new Date(Number(value)||0);
  return Number.isFinite(date.getTime())&&date.getTime()>0?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未知';
}
