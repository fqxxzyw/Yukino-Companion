import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,Eye,EyeOff,LoaderCircle,Mail} from 'lucide-react';
import {accountErrorMessage,accountResultError} from './account-status.mjs';
import {normalizeNickname,nicknameProblem,passwordProblem} from './password-policy.mjs';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasswordField({id,label,value,onChange,autoComplete,disabled,placeholder}) {
  const [visible,setVisible]=useState(false);
  return <label className="field account-field" htmlFor={id}>
    <span>{label}</span>
    <div className="account-input-wrap">
      <input id={id} type={visible?'text':'password'} value={value} autoComplete={autoComplete} disabled={disabled} placeholder={placeholder} onChange={event=>onChange(event.target.value)}/>
      <button type="button" className="account-eye" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(current=>!current)}>{visible?<EyeOff size={15}/>:<Eye size={15}/>}</button>
    </div>
  </label>;
}

export default function AccountGate({api,onDone,initialStatus=''}) {
  const [mode,setMode]=useState('login');
  const [email,setEmail]=useState('');
  const [nickname,setNickname]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [code,setCode]=useState('');
  const [challengeId,setChallengeId]=useState('');
  const [resetToken,setResetToken]=useState('');
  const [remember,setRemember]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [countdown,setCountdown]=useState(0);
  const emailRef=useRef(null),codeRef=useRef(null);
  useEffect(()=>{const timer=requestAnimationFrame(()=>emailRef.current?.focus());return()=>cancelAnimationFrame(timer);},[]);
  useEffect(()=>{if(mode!=='forgot'){setChallengeId('');setResetToken('');setCode('');setCountdown(0);}},[mode]);
  useEffect(()=>{if(countdown<=0)return;const timer=setTimeout(()=>setCountdown(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[countdown]);
  function switchMode(next){setError('');setNotice('');setMode(next);setPassword('');setConfirm('');setNickname('');}
  function validateIdentity(){if(!EMAIL.test(email.trim())){setError('请输入有效邮箱地址。');return false}return true}
  function validatePassword(){const problem=passwordProblem(password);if(problem){setError(problem);return false}return true}
  async function call(action,label){
    setBusy(label);setError('');setNotice('');
    try{return await action()}
    catch(caught){setError(accountErrorMessage(caught));return null}
    finally{setBusy('')}
  }
  async function login(event){
    event.preventDefault();
    if(!validateIdentity())return;
    if(!password){setError('请输入密码。');return}
    const result=await call(()=>api.accountLogin({email:email.trim().toLowerCase(),password,remember}),'login');
    if(!result?.ok){setError(accountResultError(result));return}
    onDone(result.state);
  }
  async function sendCode(purpose='register'){
    if(!validateIdentity())return;
    const result=await call(()=>purpose==='register'?api.accountRegisterRequest({email:email.trim().toLowerCase()}):api.accountForgotRequest({email:email.trim().toLowerCase()}),'code');
    if(!result?.ok){setError(accountResultError(result));if(result?.error?.retryAfter)setCountdown(Number(result.error.retryAfter));return}
    setChallengeId(result.data.challengeId);
    setCountdown(Number(result.data.retryAfter)||60);
    setNotice('验证码请求已交给邮件服务。请查看邮箱；如几分钟内未收到，请检查垃圾邮件。');
    requestAnimationFrame(()=>codeRef.current?.focus());
  }
  async function register(event){
    event.preventDefault();
    if(!validateIdentity())return;
    const displayName=normalizeNickname(nickname);
    const nameProblem=nicknameProblem(displayName);
    if(nameProblem){setError(nameProblem);return}
    if(!challengeId){setError('请先发送验证码。');return}
    if(!/^\d{6}$/.test(code.trim())){setError('请输入 6 位验证码。');return}
    if(!validatePassword())return;
    if(password!==confirm){setError('两次输入的密码不一致。');return}
    const result=await call(()=>api.accountRegister({email:email.trim().toLowerCase(),nickname:displayName,code:code.trim(),challengeId,password}),'register');
    if(!result?.ok){setError(accountResultError(result));return}
    onDone(result.state);
  }
  async function verifyReset(event){
    event.preventDefault();
    if(!validateIdentity())return;
    if(!challengeId){setError('请先发送验证码。');return}
    if(!/^\d{6}$/.test(code.trim())){setError('请输入 6 位验证码。');return}
    if(!validatePassword())return;
    if(password!==confirm){setError('两次输入的密码不一致。');return}
    if(!resetToken){
      const verified=await call(()=>api.accountForgotVerify({email:email.trim().toLowerCase(),code:code.trim(),challengeId}),'verify');
      if(!verified?.ok){setError(accountResultError(verified));return}
      setResetToken(verified.data.resetToken);
      const reset=await call(()=>api.accountResetPassword({resetToken:verified.data.resetToken,newPassword:password}),'reset');
      if(!reset?.ok){setError(accountResultError(reset));setResetToken('');return}
    }else{
      const reset=await call(()=>api.accountResetPassword({resetToken,newPassword:password}),'reset');
      if(!reset?.ok){setError(accountResultError(reset));return}
    }
    setPassword('');setConfirm('');setCode('');setChallengeId('');setResetToken('');setCountdown(0);setMode('login');setNotice('密码已重置，请使用新密码登录。旧会话已失效。');
  }
  async function skip(){
    const result=await call(()=>api.accountSkip(),'skip');
    if(!result?.ok){setError(accountResultError(result));return}
    onDone(result.state);
  }
  const disabled=Boolean(busy);
  return <div className="modal-backdrop account-gate-backdrop">
    <section className="account-gate" role="dialog" aria-modal="true" aria-labelledby="account-gate-title">
      <aside className="account-gate-aside" aria-hidden="true">
        <img src="./wallpapers/yukino-sky-01.png" alt=""/>
      </aside>
      <div className="account-gate-panel">
        <header>
          <span className="account-gate-eyebrow">ACCOUNT · OPTIONAL</span>
          <h1 id="account-gate-title">{mode==='login'?'登录账号':mode==='register'?'创建账号':'找回密码'}</h1>
          <p>{mode==='login'?'登录后可在云端确认进度，也可以在网页账号中心查看设备。':mode==='register'?'验证邮箱后自动登录，不需要再输入一次密码。':'通过邮箱验证码设置新密码；重置后需要重新登录。'}</p>
        </header>
        {mode!=='forgot'?<nav className="account-tabs" aria-label="账号入口">
          <button type="button" aria-current={mode==='login'?'page':undefined} onClick={()=>switchMode('login')}>登录</button>
          <button type="button" aria-current={mode==='register'?'page':undefined} onClick={()=>switchMode('register')}>注册</button>
        </nav>:null}
        {initialStatus==='reauth-required'&&mode==='login'?<p className="account-banner">账号会话已失效。输入密码重新登录；本地档案和已下载资源不会被删除。</p>:null}
        {notice?<p className="account-notice" role="status">{notice}</p>:null}
        {error?<p className="account-error" role="alert">{error}</p>:null}
        {mode==='login'?<form className="account-form" onSubmit={login} noValidate>
          <label className="field account-field" htmlFor="account-email"><span>邮箱</span><input ref={emailRef} id="account-email" type="email" inputMode="email" autoComplete="username" value={email} disabled={disabled} placeholder="you@example.com" onChange={event=>setEmail(event.target.value)}/></label>
          <PasswordField id="account-password" label="密码" value={password} onChange={setPassword} autoComplete="current-password" disabled={disabled} placeholder="输入密码"/>
          <label className="account-check"><input type="checkbox" checked={remember} disabled={disabled} onChange={event=>setRemember(event.target.checked)}/><span>保持登录。关闭后，重启应用需要重新输入密码。</span></label>
          <button className="primary account-submit" type="submit" disabled={disabled}>{busy==='login'?<><LoaderCircle size={15} className="spin"/>正在登录…</>:<>登录<ArrowRight size={15}/></>}</button>
          <div className="account-links"><button type="button" className="text-link" onClick={()=>switchMode('forgot')}>忘记密码</button><button type="button" className="text-link" onClick={()=>switchMode('register')}>创建账号</button></div>
        </form>:null}
        {mode==='register'?<form className="account-form" onSubmit={register} noValidate>
          <label className="field account-field" htmlFor="account-register-email"><span>邮箱</span><input ref={emailRef} id="account-register-email" type="email" inputMode="email" autoComplete="email" value={email} disabled={disabled} placeholder="you@example.com" onChange={event=>setEmail(event.target.value)}/></label>
          <label className="field account-field" htmlFor="account-register-nickname"><span>昵称</span><input id="account-register-nickname" value={nickname} disabled={disabled} placeholder="例如：雪乃" maxLength={32} onChange={event=>setNickname(event.target.value)}/><small>支持中文、英文、数字和常见符号；昵称不可重复。</small></label>
          <label className="field account-field" htmlFor="account-code"><span>邮箱验证码</span><div className="account-code-row"><input ref={codeRef} id="account-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={disabled} placeholder="6 位数字" onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))}/><button type="button" className="secondary" disabled={disabled||countdown>0} onClick={()=>sendCode('register')}>{busy==='code'?'发送中…':countdown>0?`${countdown} 秒后重发`:'发送验证码'}</button></div><small>验证码 10 分钟有效。重发会使旧验证码失效。</small></label>
          <PasswordField id="account-register-password" label="密码" value={password} onChange={setPassword} autoComplete="new-password" disabled={disabled} placeholder="例如 Abc123!"/>
          <PasswordField id="account-register-confirm" label="确认密码" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={disabled} placeholder="再输入一次"/>
          <p className="account-hint">至少 6 位，包含大写、小写、数字和符号。云端不保存聊天、记忆、语音或模型文件。</p>
          <button className="primary account-submit" type="submit" disabled={disabled}>{busy==='register'?<><LoaderCircle size={15} className="spin"/>正在创建…</>:<>注册并登录<ArrowRight size={15}/></>}</button>
          <div className="account-links"><button type="button" className="text-link" onClick={()=>switchMode('login')}>已有账号，去登录</button></div>
        </form>:null}
        {mode==='forgot'?<form className="account-form" onSubmit={verifyReset} noValidate>
          <label className="field account-field" htmlFor="account-forgot-email"><span>邮箱</span><input ref={emailRef} id="account-forgot-email" type="email" inputMode="email" autoComplete="email" value={email} disabled={disabled} placeholder="you@example.com" onChange={event=>setEmail(event.target.value)}/></label>
          <div className="account-code-row"><button type="button" className="secondary" disabled={disabled||countdown>0} onClick={()=>sendCode('forgot')}>{busy==='code'?'发送中…':countdown>0?`${countdown} 秒后重发`:'发送验证码'}</button><Mail size={15}/></div>
          <label className="field account-field" htmlFor="account-forgot-code"><span>验证码</span><input id="account-forgot-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={disabled} placeholder="6 位数字" onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))}/></label>
          <PasswordField id="account-forgot-password" label="新密码" value={password} onChange={setPassword} autoComplete="new-password" disabled={disabled} placeholder="例如 Abc123!"/>
          <PasswordField id="account-forgot-confirm" label="确认新密码" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={disabled} placeholder="再输入一次"/>
          <button className="primary account-submit" type="submit" disabled={disabled}>{busy==='reset'||busy==='verify'?<><LoaderCircle size={15} className="spin"/>正在重置…</>:<>重置密码<ArrowRight size={15}/></>}</button>
          <div className="account-links"><button type="button" className="text-link" onClick={()=>switchMode('login')}>返回登录</button></div>
        </form>:null}
        <footer className="account-gate-footer">
          <button type="button" className="secondary account-skip" disabled={disabled} onClick={skip}>{busy==='skip'?'正在进入…':'暂不登录，本地使用'}</button>
        </footer>
      </div>
    </section>
  </div>;
}

export {accountErrorMessage};
