import React,{useEffect,useState} from 'react';
import {
  CalendarDays,Check,CheckCircle2,ChevronDown,Cloud,Eye,EyeOff,Heart,KeyRound,
  LoaderCircle,Lock,LogOut,Mail,Monitor,RefreshCw,ShieldCheck,Shirt,UserRound,
} from 'lucide-react';
import catalog from '../../resources/character-models.json';
import {OUTFIT_RULES,outfitCondition} from '../../shared/outfit-rules.mjs';
import {PASSWORD_MAX,passwordProblem} from './password-policy.mjs';
import {accountErrorMessage,accountResultError,accountStatus} from './account-status.mjs';

const MODEL_BY_ID=new Map((catalog.models||[]).filter(model=>!model.retired).map(model=>[model.id,model]));
const OUTFITS=OUTFIT_RULES.outfits;
const OUTFIT_GROUPS=[
  {kind:'base',title:'默认开放',hint:'夏日制服与冬季制服登录后即可使用，不消耗进度。'},
  {kind:'login-days',title:'累计登录解锁',hint:'每个上海自然日确认一次，同一天只计 1 天；第 2、3 天依次解锁。'},
  {kind:'affection',title:'好感度解锁',hint:'以服务器确认的好感度为准；离线时保留已确认的永久服装资格。'},
];

function safeThumbnail(model){
  const value=model?.thumbnail||model?.thumbnailUrl;
  return typeof value==='string'&&/^(?:\.\/|\/)[^\\]*\.(?:png|jpe?g|webp|avif)(?:\?[^#]*)?$/i.test(value)&&!value.startsWith('//')&&!value.includes('..')?value:'';
}

function OutfitThumb({outfit,locked}){
  const model=MODEL_BY_ID.get(outfit.id),source=safeThumbnail(model);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{setFailed(false)},[outfit.id]);
  return <div className={'account-outfit-thumb '+(locked?'is-locked':'')} aria-hidden="true">
    {source&&!failed?<img src={source} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<div className="account-outfit-placeholder"><Shirt size={25} strokeWidth={1.25}/><span>暂无预览</span></div>}
    {locked?<span className="account-outfit-lock"><Lock size={14}/></span>:<span className="account-outfit-check"><Check size={14}/></span>}
  </div>;
}

function PasswordInput({id,label,value,onChange,autoComplete,disabled,placeholder,hint,invalid}){
  const [visible,setVisible]=useState(false);
  return <label className={'field account-field account-password-field '+(invalid?'has-error':'')} htmlFor={id}>
    <span>{label}</span>
    <div className="account-input-wrap">
      <input id={id} type={visible?'text':'password'} value={value} autoComplete={autoComplete} disabled={disabled} placeholder={placeholder} maxLength={PASSWORD_MAX} aria-invalid={invalid||undefined} onChange={event=>onChange(event.target.value)}/>
      <button type="button" className="account-eye" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(current=>!current)}>{visible?<EyeOff size={15}/>:<Eye size={15}/>}</button>
    </div>
    {hint?<small className={invalid?'account-field-error':undefined}>{hint}</small>:null}
  </label>;
}

function OutfitCard({outfit,progress,cloudSkins,guest=false}){
  const serverSkin=progress?.skins?.find(item=>item.id===outfit.id),base=outfit.kind==='base';
  const fallbackCurrent=outfit.kind==='affection'?Number(progress?.affection)||0:outfit.kind==='login-days'?Number(progress?.loginDays)||0:0;
  const current=Number.isFinite(Number(serverSkin?.current))?Math.max(0,Number(serverSkin.current)):Math.max(0,fallbackCurrent);
  const target=Math.max(0,Number(outfit.target)||0);
  const unlocked=base||serverSkin?.unlocked===true||cloudSkins.has(outfit.id);
  const ratio=base?1:target>0?Math.min(1,Math.max(0,current/target)):0;
  const condition=outfitCondition(outfit,{current,account:true}),remaining=base?'无需进度':unlocked?'已获得':outfit.kind==='affection'?`还需 ${Math.max(0,target-current)} 好感度`:`还需 ${Math.max(0,target-current)} 天`;
  const status=guest&&!base?'登录后解锁':base?'默认开放':unlocked?'已解锁':'未解锁';
  return <article className={'account-outfit-card '+(unlocked?'is-unlocked':'is-locked')+(guest&&!base?' is-unconfirmed':'')}>
    <OutfitThumb outfit={outfit} locked={!unlocked}/>
    <div className="account-outfit-body">
      <div className="account-outfit-title"><strong>{outfit.label}</strong><span className={'account-outfit-badge '+(unlocked?'unlocked':'locked')}>{status}</span></div>
      <p>{base?'两套校服默认开放':condition}</p>
      {!base?<div className="account-outfit-progress">
        <div className="account-outfit-track" role="progressbar" aria-valuemin="0" aria-valuemax={target} aria-valuenow={Math.min(current,target)} aria-label={`${outfit.label}解锁进度`}><i style={{width:`${ratio*100}%`}}/></div>
        <small>{guest?'登录后读取账号进度':remaining}</small>
      </div>:<div className="account-outfit-default"><CheckCircle2 size={13}/><span>无需解锁条件</span></div>}
    </div>
  </article>;
}

function OutfitGallery({progress,cloudSkins,guest=false}){
  return <div className="account-outfit-groups">
    {OUTFIT_GROUPS.map((group,index)=>{
      const outfits=OUTFITS.filter(outfit=>outfit.kind===group.kind);
      if(!outfits.length)return null;
      return <details className="account-outfit-group" open={index<2||!guest} key={group.kind}>
        <summary>
          <span className="account-outfit-summary-icon"><ChevronDown size={15}/></span>
          <div><strong>{group.title}</strong><small>{group.hint}</small></div>
          <span className="account-outfit-count">{outfits.filter(outfit=>outfit.kind==='base'||progress?.skins?.find(item=>item.id===outfit.id)?.unlocked||cloudSkins.has(outfit.id)).length}/{outfits.length}</span>
        </summary>
        <div className="account-outfit-grid">{outfits.map(outfit=><OutfitCard key={outfit.id} outfit={outfit} progress={progress} cloudSkins={cloudSkins} guest={guest}/>)}</div>
      </details>;
    })}
  </div>;
}

function ProgressStat({icon,value,label,note}){
  return <div className="account-growth-stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small>{note?<em>{note}</em>:null}</div></div>;
}

export default function AccountCenter({api,account,onAccount,onOpenGate}){
  const [sessions,setSessions]=useState([]);
  const [sessionsLoading,setSessionsLoading]=useState(false);
  const [sessionsError,setSessionsError]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [passwordError,setPasswordError]=useState('');
  const [passwordNotice,setPasswordNotice]=useState('');
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const isAccount=account?.mode==='account';
  const status=accountStatus(account);
  const progress=account?.progress||null;
  const cloudSkins=new Set(account?.cloudSkins||[]);
  const unlockedCount=OUTFITS.filter(outfit=>outfit.kind==='base'||progress?.skins?.find(item=>item.id===outfit.id)?.unlocked||cloudSkins.has(outfit.id)).length;
  const newPasswordProblem=newPassword?passwordProblem(newPassword):'';
  const confirmProblem=confirmPassword&&newPassword!==confirmPassword?'两次输入的新密码不一致。':'';

  function accept(result){
    if(result?.ok){setError('');onAccount?.(result.state);return true}
    setError(accountResultError(result));return false;
  }
  async function run(label,action,success){
    setBusy(label);setError('');setNotice('');
    try{
      const result=await action();
      if(accept(result)&&success)setNotice(success);
      return result;
    }catch(caught){setError(accountErrorMessage(caught));return null}
    finally{setBusy('')}
  }
  async function loadSessions(){
    if(!isAccount){setSessions([]);setSessionsLoading(false);setSessionsError('');return}
    setSessionsLoading(true);setSessionsError('');
    try{
      const result=await api.accountSessions();
      if(result?.ok)setSessions(Array.isArray(result.data?.sessions)?result.data.sessions:[]);
      else{setSessions([]);setSessionsError(accountResultError(result))}
    }catch(caught){setSessions([]);setSessionsError(accountErrorMessage(caught))}
    finally{setSessionsLoading(false)}
  }
  useEffect(()=>{void loadSessions();},[account?.profileId,account?.status]);
  useEffect(()=>{setSessions([]);setSessionsError('');setCurrentPassword('');setNewPassword('');setConfirmPassword('');setPasswordError('');setPasswordNotice('');},[account?.profileId]);

  async function checkin(){await run('checkin',()=>api.accountCheckin(),'今日确认完成，累计登录天数已按服务器结果更新。');await loadSessions()}
  async function sync(){await run('sync',()=>api.accountSync(),'待同步互动已提交，云端进度已刷新。');await loadSessions()}
  async function refresh(){await run('refresh',()=>api.accountRefresh(),'账号进度已从服务器刷新。');await loadSessions()}
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
    }catch(caught){setError(accountErrorMessage(caught))}
    finally{setBusy('')}
  }
  async function changePassword(event){
    event.preventDefault();
    setPasswordError('');setPasswordNotice('');
    if(!currentPassword){setPasswordError('请输入当前密码。');return}
    if(!newPassword){setPasswordError('请输入新密码。');return}
    const problem=passwordProblem(newPassword);
    if(problem){setPasswordError(problem);return}
    if(newPassword===currentPassword){setPasswordError('新密码不能与当前密码相同。');return}
    if(newPassword!==confirmPassword){setPasswordError('两次输入的新密码不一致。');return}
    setBusy('password');
    try{
      const result=await api.accountChangePassword({currentPassword,newPassword});
      if(!result?.ok){setPasswordError(accountResultError(result));return}
      onAccount?.(result.state);
      setCurrentPassword('');setNewPassword('');setConfirmPassword('');
      setPasswordNotice('密码已修改。其他设备需要重新登录；当前设备已自动续期。');
    }catch(caught){setPasswordError(accountErrorMessage(caught))}
    finally{setBusy('')}
  }

  if(!account) return <div className="account-center">
    <section className="account-card account-loading" aria-live="polite"><LoaderCircle size={18} className="spin"/><div><strong>正在读取账号状态</strong><span>本地功能不受影响；读取完成后会显示账号、成长、服装和设备信息。</span></div></section>
  </div>;

  if(!isAccount) return <div className="account-center">
    <div className="account-hero account-guest-hero">
      <div>
        <span className={`account-status-dot ${status.tone}`}></span>
        <span>游客模式</span>
        <h3>当前进度保存在本机</h3>
        <p>不登录也可以正常使用。登录后以服务器确认的好感度、累计登录天数和服装资格为准；本地聊天、模型和设置不会被删除。</p>
      </div>
      <div className="account-hero-actions"><button type="button" className="primary" onClick={onOpenGate}><UserRound size={15}/>登录或注册</button></div>
    </div>
    {error&&<p className="account-error" role="alert">{error}</p>}
    {notice&&<p className="account-notice" role="status">{notice}</p>}
    <div className="account-guest-note"><ShieldCheck size={16}/><div><strong>游客进度不会自动上传</strong><span>账号与游客使用不同档案，登录不会把游客数值合并到云端，也不会删除游客进度。</span></div></div>
    <section className="account-card account-outfits-card">
      <header className="account-section-heading"><div><h4>服装解锁一览</h4><p>默认开放两套校服；其他服装按累计登录天数或好感度解锁，登录后显示真实账号进度。</p></div></header>
      <OutfitGallery progress={null} cloudSkins={new Set()} guest/>
    </section>
    <div className="account-links-row"><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/account')}><Cloud size={14}/>打开网页账号中心</button><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/forgot')}>网页找回密码</button></div>
  </div>;

  const pending=Number(account.pendingCount)||0,affection=Number(progress?.affection)||0,loginDays=Number(progress?.loginDays)||0;
  const nextUnlocks=OUTFITS.filter(outfit=>outfit.kind!=='base').map(outfit=>{
    const serverSkin=progress?.skins?.find(item=>item.id===outfit.id);
    const current=Number.isFinite(Number(serverSkin?.current))?Math.max(0,Number(serverSkin.current)):outfit.kind==='affection'?affection:loginDays;
    return {outfit,current,unlocked:serverSkin?.unlocked===true||cloudSkins.has(outfit.id)};
  }).filter(item=>!item.unlocked).sort((a,b)=>(b.current/Math.max(1,b.outfit.target))-(a.current/Math.max(1,a.outfit.target))).slice(0,2);

  return <div className="account-center">
    <div className="account-hero">
      <div>
        <span className={`account-status-dot ${status.tone}`}></span>
        <span>{account.profile?.nickname||account.profile?.email||'已登录账号'}</span>
        <h3>{status.label}</h3>
        <p>{account.status==='reauth-required'?'需要重新输入密码后才能访问云操作；本地档案、聊天和已下载资源仍可用。':account.status==='authenticated-offline'?'账号服务不可达时会继续本地使用；恢复连接后会自动刷新并同步待提交的互动。':'登录天数、好感度和永久服装资格以服务器确认值为准。'}</p>
      </div>
      <div className="account-hero-actions">
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={refresh}>{busy==='refresh'?<RefreshCw size={14} className="spin"/>:<RefreshCw size={14}/>}刷新进度</button>
        {account.status==='reauth-required'?<button type="button" className="primary" onClick={onOpenGate}>重新登录</button>:null}
      </div>
    </div>
    {error&&<p className="account-error" role="alert">{error}</p>}
    {notice&&<p className="account-notice" role="status">{notice}</p>}
    {account.credentialsUnavailable?<p className="account-warning">系统安全存储当前不可用，无法恢复云端会话。本地档案不会被删除；本次登录只能在当前运行期间保持。</p>:null}

    <div className="account-overview">
      <section className="account-card account-identity-card">
        <header className="account-section-heading"><div><span className="account-eyebrow">ACCOUNT</span><h4>账号信息</h4><p>登录身份与本机档案分开保存。</p></div><UserRound size={18}/></header>
        <div className="account-identity-main">
          <div className="account-avatar">{(account.profile?.nickname||account.profile?.email||'Y').slice(0,1).toUpperCase()}</div>
          <div><strong>{account.profile?.nickname||'未设置昵称'}</strong><span>{account.profile?.email||'账号邮箱不可用'}</span></div>
        </div>
        <dl className="account-info-list">
          <div><dt><Mail size={13}/>邮箱</dt><dd>{account.profile?.emailHint||account.profile?.email||'未知'}</dd></div>
          <div><dt><CalendarDays size={13}/>注册时间</dt><dd>{formatDate(account.profile?.createdAt)}</dd></div>
          <div><dt><RefreshCw size={13}/>最近确认</dt><dd>{formatTime(account.lastSyncAt)}</dd></div>
          <div><dt><Cloud size={13}/>待同步互动</dt><dd>{pending?`${pending} 条`:'已全部同步'}</dd></div>
        </dl>
        <p className="account-footnote">账号云端只保存进度和设备会话；聊天、记忆、语音、模型文件仍保存在本机。</p>
      </section>

      <section className="account-card account-growth-card">
        <header className="account-section-heading"><div><span className="account-eyebrow">GROWTH</span><h4>成长进度</h4><p>每日确认按上海自然日计一次，离线互动会在恢复联网后提交。</p></div><Heart size={18}/></header>
        <div className="account-growth-stats">
          <ProgressStat icon={<Heart size={14}/>} value={affection} label="已确认好感度" note="上限 100"/>
          <ProgressStat icon={<CalendarDays size={14}/>} value={loginDays} label="累计登录天数" note="同一天计一次"/>
          <ProgressStat icon={<Cloud size={14}/>} value={pending} label="待同步互动" note={pending?'联网后提交':'无待提交'}/>
          <ProgressStat icon={<Shirt size={14}/>} value={`${unlockedCount}/${OUTFITS.length}`} label="已解锁服装" note="含两套校服"/>
        </div>
        <div className="account-progress-actions">
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={checkin}>{busy==='checkin'?'确认中…':progress?.checkedInToday?'今日已确认':'今日确认'}</button>
          <button type="button" className="secondary" disabled={Boolean(busy)||!pending} onClick={sync}>{busy==='sync'?'同步中…':'同步待提交互动'}</button>
        </div>
        {!progress?<p className="account-footnote">尚未读取到服务器进度。联网后点击“刷新进度”；默认服装仍可正常查看。</p>:null}
        <div className="account-next-unlocks">
          <strong>下一套服装</strong>
          {nextUnlocks.length?nextUnlocks.map(item=><div key={item.outfit.id}><span>{item.outfit.label}</span><small>{outfitCondition(item.outfit,{current:item.current,account:true})}</small><i><b style={{width:`${Math.min(100,Math.max(0,item.current/Math.max(1,item.outfit.target)*100))}%`}}/></i></div>):<p>所有成长服装均已解锁。</p>}
        </div>
        <p className="account-footnote">服务器确认的永久服装资格不会因断网收回；待同步互动不会提前解锁云端服装。</p>
      </section>
    </div>

    <section className="account-card account-outfits-card">
      <header className="account-section-heading"><div><span className="account-eyebrow">WARDROBE</span><h4>服装解锁</h4><p>卡面名称、条件和进度来自同一份解锁配置；账号状态以服务器确认结果为准。</p></div><Shirt size={18}/></header>
      <OutfitGallery progress={progress} cloudSkins={cloudSkins}/>
    </section>

    <div className="account-bottom-grid">
      <section className="account-card account-sessions-card">
        <header className="account-section-heading"><div><span className="account-eyebrow">DEVICES</span><h4>登录设备</h4><p>只显示当前账号的登录设备；撤销后该设备需要重新登录。</p></div><Monitor size={18}/></header>
        {sessionsLoading?<div className="account-session-loading" aria-live="polite"><LoaderCircle size={16} className="spin"/><span>正在读取登录设备…</span></div>:sessionsError?<div className="account-session-empty is-error" role="alert"><span>{sessionsError}</span><button type="button" className="text-link" onClick={loadSessions}>重试</button></div>:sessions.length?<ul className="account-session-list">{sessions.map(session=><li key={session.id}><div><strong>{session.deviceLabel||session.client}{session.current?' · 当前设备':''}</strong><small>最近使用 {formatTime(session.lastUsedAt)} · 到期 {formatTime(session.expiresAt)}</small></div>{session.current?<span className="account-current">当前</span>:<button type="button" className="text-link account-danger-link" disabled={Boolean(busy)} onClick={()=>revoke(session.id)}>{busy===`revoke-${session.id}`?'撤销中…':'撤销'}</button>}</li>)}</ul>:<div className="account-session-empty"><ShieldCheck size={16}/><span>暂无其他登录设备。当前设备会话仍保持登录。</span></div>}
        <div className="account-session-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={logout}><LogOut size={14}/>退出当前账号</button><button type="button" className="secondary" disabled={Boolean(busy)} onClick={logoutAll}>退出所有设备</button></div>
        <button type="button" className="text-link account-switch" disabled={Boolean(busy)} onClick={switchGuest}>切换到游客档案（保留账号登录）</button>
        <p className="account-footnote">退出账号会清除本机保存的登录凭据并回到游客档案；聊天、模型、下载资源和本地皮肤不会被删除。</p>
      </section>

      <section className="account-card account-security-card">
        <header className="account-section-heading"><div><span className="account-eyebrow">SECURITY</span><h4>账号安全</h4><p>修改密码需要当前密码；成功后其他设备会退出登录，并发送安全通知邮件。</p></div><KeyRound size={18}/></header>
        {passwordError?<p className="account-error account-inline-error" role="alert">{passwordError}</p>:null}
        {passwordNotice?<p className="account-notice account-inline-notice" role="status">{passwordNotice}</p>:null}
        <form className="account-password-form" onSubmit={changePassword} noValidate>
          <PasswordInput id="account-current-password" label="当前密码" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" disabled={Boolean(busy)} placeholder="输入当前密码"/>
          <div className="account-password-pair">
            <PasswordInput id="account-new-password" label="新密码" value={newPassword} onChange={setNewPassword} autoComplete="new-password" disabled={Boolean(busy)} placeholder="输入新密码" invalid={Boolean(newPasswordProblem)} hint={newPasswordProblem||'至少 6 个字符，需包含大写、小写、数字和符号；最多 512 个字符。'}/>
            <PasswordInput id="account-confirm-password" label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" disabled={Boolean(busy)} placeholder="再次输入新密码" invalid={Boolean(confirmProblem)} hint={confirmProblem||'两次输入需完全一致。'}/>
          </div>
          <div className="account-password-actions"><span>修改成功后当前设备会自动续期。</span><button className="primary" type="submit" disabled={Boolean(busy)}>{busy==='password'?'修改中…':'修改密码'}</button></div>
        </form>
        <div className="account-security-links"><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/forgot')}>忘记当前密码？网页找回</button><button type="button" className="text-link" onClick={()=>api.accountOpenWeb('/account')}><Cloud size={13}/>打开网页账号中心</button></div>
      </section>
    </div>
  </div>;
}

function formatDate(value){
  const date=new Date(Number(value)||0);
  return Number.isFinite(date.getTime())&&date.getTime()>0?date.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}):'未知';
}
function formatTime(value){
  const date=new Date(Number(value)||0);
  return Number.isFinite(date.getTime())&&date.getTime()>0?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未知';
}
