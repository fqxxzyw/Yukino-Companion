import './home-effects.mjs?v=shell-31';
import {closeSiteNav as closeNav} from './site-shell.mjs?v=31';
const PREVIEW_ONLY = window.YUKINO_SITE_CONFIG?.previewOnly === true;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  accessToken: '',
  user: null,
  refreshPromise: null,
  refreshProblem: null,
  authEpoch: 0,
  routeEpoch: 0,
  timers: new Set(),
  account: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 15;
const PASSWORD_MAX = 128;

class RequestError extends Error {
  constructor(message, {code = 'request_failed', status = 0, retryAfter = 0} = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function text(value) {
  return String(value ?? '');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}

function toast(message, {error = false, timeout = 3800} = {}) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('error', error);
  clearTimeout(element._timer);
  element._timer = setTimeout(() => { element.hidden = true; }, timeout);
}

const authCookieLock = operation => navigator.locks?.request
  ? navigator.locks.request('yukino-web-credentials', operation)
  : operation();

function acceptSession(data) {
  if (typeof data?.accessToken !== 'string' || !data.accessToken || !data.user)
    throw new RequestError('账号服务没有返回完整的登录会话。', {code:'invalid_session'});
  state.authEpoch++;
  state.accessToken = data.accessToken;
  state.user = data.user;
  state.refreshProblem = null;
  updateHeaderAccount();
}

function forgetSession() {
  state.authEpoch++;
  state.accessToken = '';
  state.user = null;
  state.account = null;
  state.refreshProblem = null;
  updateHeaderAccount();
}

async function apiFetch(path, {method = 'GET', body, auth = false, retry = true, signal} = {}) {
  if (PREVIEW_ONLY) throw new RequestError('这是本地静态预览，未连接账号服务。', {code:'preview_only'});
  if (!path.startsWith('/api/v1/')) throw new RequestError('接口地址无效。');
  const payload = method === 'POST' ? (body ?? {}) : body;
  const headers = new Headers({'x-client':'web'});
  if (payload !== undefined) headers.set('content-type','application/json');
  const token = state.accessToken;
  if (auth && token) headers.set('authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(path, {
      method, headers, credentials:'same-origin', redirect:'error',
      body:payload === undefined ? undefined : JSON.stringify(payload),
      cache:'no-store', signal:signal || AbortSignal.timeout(28000),
    });
  } catch {
    throw new RequestError('无法连接账号服务，请稍后重试。', {code:'network_error'});
  }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (response.status === 401 && auth && retry) {
    const currentToken = state.accessToken;
    if ((currentToken && currentToken !== token) || await refreshSession())
      return apiFetch(path, {method, body, auth, retry:false, signal});
    if (state.refreshProblem) throw state.refreshProblem;
  }
  if (!response.ok) {
    const error = data?.error || {};
    throw new RequestError(error.message || '请求未完成，请稍后重试。', {
      code:error.code || `http_${response.status}`, status:response.status,
      retryAfter:Math.min(86400,Math.max(0,Number(error.retryAfter || response.headers.get('retry-after') || 0) || 0))
    });
  }
  if (!data || typeof data !== 'object') throw new RequestError('账号服务返回了无法识别的响应。',{code:'invalid_response'});
  return data;
}

async function refreshSession() {
  if (PREVIEW_ONLY) return false;
  if (state.refreshPromise) return state.refreshPromise;
  const epoch = state.authEpoch;
  state.refreshProblem = null;
  state.refreshPromise = authCookieLock(async () => {
    if (epoch !== state.authEpoch) return Boolean(state.accessToken);
    for (let attempt=0; attempt<3; attempt++) {
      try {
        const data=await apiFetch('/api/v1/auth/refresh',{method:'POST',body:{client:'web'},retry:false});
        if(epoch !== state.authEpoch) return Boolean(state.accessToken);
        acceptSession(data);
        return true;
      } catch (error) {
        if(epoch !== state.authEpoch) return Boolean(state.accessToken);
        if(error.status===409 && error.code==='refresh_in_progress' && attempt<2) {
          await new Promise(resolve=>setTimeout(resolve,1000));
          continue;
        }
        if(error.status===401) forgetSession();
        else state.refreshProblem=error;
        return false;
      }
    }
    return false;
  }).catch(error=>{
    if(epoch===state.authEpoch) state.refreshProblem=error;
    return false;
  }).finally(()=>{state.refreshPromise=null;});
  return state.refreshPromise;
}

function updateHeaderAccount() {
  const link = $('#header-account');
  if (!link) return;
  link.textContent = state.user ? '账号中心' : '登录';
  link.href = state.user ? '/account' : '/login';
}

function setActiveNav(path) {
  for (const link of $$('.header-nav nav a, .v3-auth-actions a')) {
    const target = new URL(link.href, location.origin);
    const active = (target.pathname.replace(/\/+$/, '') || '/') === path && (target.hash === location.hash || !target.hash);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
}

function clearTimers() {
  for (const timer of state.timers) clearInterval(timer);
  state.timers.clear();
}

function startCountdown(button, seconds, label) {
  let remaining = Math.max(1, Math.ceil(Number(seconds) || 60));
  button.disabled = true;
  const restore = label || button.dataset.label || button.textContent;
  button.dataset.label = restore;
  const tick = () => {
    button.textContent = `${remaining} 秒后重发`;
    if (remaining <= 0) {
      clearInterval(timer);
      state.timers.delete(timer);
      button.disabled = false;
      button.textContent = restore;
      return;
    }
    remaining -= 1;
  };
  tick();
  const timer = setInterval(tick, 1000);
  state.timers.add(timer);
}

function formError(form, message) {
  const box = $('.form-error', form);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}
function clearFormError(form) {
  const box = $('.form-error', form);
  if (box) { box.hidden = true; box.textContent = ''; }
}
function showNotice(form, message) {
  const box = $('.form-notice', form);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function setSubmit(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || '请稍候…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || label || '继续';
    button.disabled = false;
  }
}

function passwordProblem(password) {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return `密码至少需要 ${PASSWORD_MIN} 个字符。`;
  if (length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 个字符。`;
  if (!password.trim()) return '密码不能只包含空格。';
  return '';
}

function bindPasswordToggles(root = document) {
  for (const button of $$('.input-toggle', root)) {
    button.addEventListener('click', () => {
      const input = button.parentElement?.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.setAttribute('aria-pressed', String(!showing));
      button.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
      button.textContent = showing ? '显示' : '隐藏';
      input.focus();
    });
  }
}

function fieldMarkup({id, label, type = 'text', autocomplete = '', placeholder = '', hint = '', inputMode = ''}) {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-wrap">
      <input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" ${inputMode ? `inputmode="${inputMode}"` : ''} required>
      ${type === 'password' ? `<button class="input-toggle" type="button" aria-pressed="false" aria-label="显示密码" aria-controls="${id}">显示</button>` : ''}
    </div>
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;
}

const AUTH_ART = `
  <div class="auth-aside auth-aside-figure v5-auth-wall" aria-hidden="true"></div>`;

function authPage({title, lead, body, aside = AUTH_ART, tabs = true}) {
  return `<section class="auth-shell">
    <div class="auth-panel">
      ${tabs ? `<nav class="auth-tabs" aria-label="账号入口">
        <a href="/login" data-link ${location.pathname.replace(/\/+$/, '') === '/login' ? 'aria-current="page"' : ''}>登录</a>
        <a href="/register" data-link ${location.pathname.replace(/\/+$/, '') === '/register' ? 'aria-current="page"' : ''}>注册</a>
      </nav>` : ''}
      <h1>${title}</h1>
      <p class="auth-lead">${lead}</p>
      ${body}
    </div>
    ${aside}
  </section>`;
}

function loginView() {
  return authPage({
    title: '欢迎回来。',
    lead: '登录后，可以接着上次同步的进度。',
    body: `<form class="auth-form" id="login-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      <p class="form-notice" role="status" hidden></p>
      ${fieldMarkup({id: 'login-email', label: '邮箱', type: 'email', autocomplete: 'username', placeholder: 'you@example.com', inputMode: 'email'})}
      ${fieldMarkup({id: 'login-password', label: '密码', type: 'password', autocomplete: 'current-password', placeholder: '输入密码'})}
      <label class="check-row"><input type="checkbox" id="login-remember" checked> <span>保持登录</span></label>
      <div class="form-actions"><button class="button button-primary" type="submit" id="login-submit">登录</button></div>
      <div class="helper-links"><button type="button" id="forgot-link">忘记密码</button><a href="/register" data-link>创建账号</a></div>
      <a class="skip-account" href="/">先不登录，回到首页</a>
    </form>`,
  });
}

function registerView() {
  return authPage({
    title: '初次见面。',
    lead: '填个邮箱，收一次验证码就能注册。',
    body: `<form class="auth-form" id="register-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      <p class="form-notice" role="status" hidden></p>
      ${fieldMarkup({id: 'register-email', label: '邮箱', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', inputMode: 'email'})}
      <div class="field">
        <label for="register-code">邮箱验证码</label>
        <div class="code-row">
          <input id="register-code" name="register-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位数字" required>
          <button class="button button-quiet" type="button" id="register-send-code">发送验证码</button>
        </div>
        <small>请使用最新验证码，10 分钟内有效。</small>
      </div>
      ${fieldMarkup({id: 'register-password', label: '密码', type: 'password', autocomplete: 'new-password', placeholder: '至少 15 个字符', hint: '可以用中文，密码最多 128 个字符。'})}
      ${fieldMarkup({id: 'register-confirm', label: '确认密码', type: 'password', autocomplete: 'new-password', placeholder: '再输入一次'})}
      <div class="form-actions"><button class="button button-primary" type="submit" id="register-submit">注册并登录</button></div>
      <p class="form-hint">注册不会上传你的聊天、记忆、声音或模型文件。</p>
      <div class="helper-links"><a href="/login" data-link>已有账号，去登录</a><a href="/" data-link>暂不注册</a></div>
    </form>`,
  });
}

function forgotView() {
  return authPage({
    title: '找回密码。',
    lead: '用邮箱收到的验证码，设一个新密码。',
    tabs: false,
    body: `<form class="auth-form" id="forgot-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      <p class="form-notice" role="status" hidden></p>
      <div data-step="1">
        ${fieldMarkup({id: 'forgot-email', label: '邮箱', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', inputMode: 'email'})}
        <div class="form-actions"><button class="button button-primary" type="submit" id="forgot-send">发送验证码</button></div>
      </div>
      <div data-step="2" hidden>
        <div class="field">
          <label for="forgot-code">邮箱验证码</label>
          <div class="code-row">
            <input id="forgot-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位数字" required>
            <button class="button button-quiet" type="button" id="forgot-resend">重新发送</button>
          </div>
          <small>请用最新的一封邮件里的验证码，10 分钟内有效。</small>
        </div>
        ${fieldMarkup({id: 'forgot-password', label: '新密码', type: 'password', autocomplete: 'new-password', placeholder: '至少 15 个字符', hint: '改完后，已登录的设备需要重新登录。'})}
        ${fieldMarkup({id: 'forgot-confirm', label: '确认新密码', type: 'password', autocomplete: 'new-password', placeholder: '再输入一次'})}
        <div class="form-actions"><button class="button button-primary" type="submit" id="forgot-reset">重置密码</button></div>
      </div>
      <div class="helper-links"><a href="/login" data-link>返回登录</a><a href="/" data-link>回到首页</a></div>
    </form>`,
  });
}

function renderHome() {
  $('#home').hidden = false;
  $('#app-view').hidden = true;
  document.title = 'Yukino Companion · Windows 桌面数字角色';
  setActiveNav('/');
}

function renderApp(html, title) {
  $('#home').hidden = true;
  const view = $('#app-view');
  view.hidden = false;
  view.innerHTML = html;
  document.title = `${title} · Yukino Companion`;
  window.scrollTo({top: 0, behavior: 'instant'});
  bindPasswordToggles(view);
}

function renderRoute() {
  state.routeEpoch++;
  clearTimers();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  updateHeaderAccount();
  if (path === '/') { renderHome(); return; }
  if (path === '/login') { renderApp(loginView(), '登录'); bindLogin(); setActiveNav('/login'); return; }
  if (path === '/register') { renderApp(registerView(), '注册'); bindRegister(); setActiveNav('/register'); return; }
  if (path === '/forgot' || path === '/reset') { renderApp(forgotView(), '找回密码'); bindForgot(); setActiveNav('/forgot'); return; }
  if (path === '/account') { renderApp('<div class="account-loading">正在读取账号…</div>', '账号中心'); setActiveNav('/account'); openAccount(); return; }
  renderApp(`<section class="auth-shell"><div class="auth-panel"><h1>页面不存在。</h1><p class="auth-lead">这个地址没有对应页面。你可以回到首页，或直接登录账号中心。</p><div class="helper-links"><a href="/" data-link>返回首页</a><a href="/login" data-link>登录</a></div></div>${AUTH_ART}</section>`, '页面不存在');
  setActiveNav('');
}

function navigate(path, {replace = false} = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  closeNav();
  renderRoute();
}

function bindLogin() {
  const form = $('#login-form');
  if (!form) return;
  let resetNotice=''; try { resetNotice=sessionStorage.getItem('yukino-login-notice')||''; } catch {}
  if (resetNotice) {
    const box = $('.form-notice', form);
    box.textContent = resetNotice;
    box.hidden = false;
    try { sessionStorage.removeItem('yukino-login-notice'); } catch {}
  }
  $('#forgot-link')?.addEventListener('click', () => navigate('/forgot'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const remember = $('#login-remember').checked;
    if (!EMAIL_RE.test(email)) { formError(form, '请输入有效邮箱地址。'); $('#login-email').focus(); return; }
    if (!password) { formError(form, '请输入密码。'); $('#login-password').focus(); return; }
    const button = $('#login-submit');
    if(button.disabled)return;
    const route=state.routeEpoch;
    setSubmit(button, true, '正在登录…');
    try {
      await authCookieLock(async()=>acceptSession(await apiFetch('/api/v1/auth/login', {method:'POST',body:{email,password,remember,client:'web'}})));
      if (route!==state.routeEpoch) return;
      navigate('/account', {replace: true});
      toast('已登录。');
    } catch (error) {
      formError(form, error.message);
    } finally {
      setSubmit(button, false, '登录');
    }
  });
}

function bindRegister() {
  const form = $('#register-form');
  if (!form) return;
  let challengeId = '', challengeEmail = '', challengeDeadline = 0;
  const emailField=$('#register-email',form);
  emailField.addEventListener('input',()=>{
    if(emailField.value.trim().toLowerCase()===challengeEmail) return;
    challengeId='';challengeDeadline=0;
    $('#register-code',form).value='';
    $('.form-notice',form).hidden=true;
  });
  $('#register-send-code').addEventListener('click', async () => {
    clearFormError(form);
    const email = $('#register-email').value.trim();
    if (!EMAIL_RE.test(email)) { formError(form, '请先填写有效邮箱地址。'); $('#register-email').focus(); return; }
    const button = $('#register-send-code');
    if(button.disabled)return;
    $('.form-notice',form).hidden=true;
    setSubmit(button, true, '正在发送…');
    try {
      const data = await apiFetch('/api/v1/auth/register/request-code', {method: 'POST', body: {email, client: 'web'}});
      if (!data.challengeId || data.delivery !== 'accepted-by-provider')
        throw new RequestError('邮件服务未确认接收验证码请求，请稍后重试。');
      if(!form.isConnected)return;
      startCountdown(button, data.retryAfter || 60, '发送验证码');
      if(emailField.value.trim().toLowerCase()!==email.toLowerCase())return;
      challengeId=data.challengeId;
      challengeEmail=email.toLowerCase();
      challengeDeadline=Date.now()+1000*(Number(data.expiresIn)||600);
      showNotice(form,'去邮箱找一下验证码。收件箱没有的话，可以看看垃圾邮件。');
      $('#register-code',form).focus();
    } catch (error) {
      setSubmit(button, false, '发送验证码');
      formError(form, error.message);
      if (error.retryAfter) startCountdown(button, error.retryAfter, '发送验证码');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const email = $('#register-email').value.trim();
    const code = $('#register-code').value.trim();
    const password = $('#register-password').value;
    const confirm = $('#register-confirm').value;
    if (!EMAIL_RE.test(email)) { formError(form, '请输入有效邮箱地址。'); return; }
    if (!challengeId || challengeEmail!==email.toLowerCase()) { formError(form,'请先向当前邮箱发送验证码。'); return; }
    if(Date.now()>=challengeDeadline) { formError(form,'验证码已过期，请重新发送。'); return; }
    if (!/^\d{6}$/.test(code)) { formError(form, '请输入 6 位验证码。'); $('#register-code').focus(); return; }
    const problem = passwordProblem(password);
    if (problem) { formError(form, problem); $('#register-password').focus(); return; }
    if (password !== confirm) { formError(form, '两次输入的密码不一致。'); $('#register-confirm').focus(); return; }
    const button = $('#register-submit');
    if(button.disabled)return;
    const route=state.routeEpoch;
    setSubmit(button, true, '正在创建…');
    try {
      await authCookieLock(async()=>acceptSession(await apiFetch('/api/v1/auth/register',{method:'POST',body:{email,code,password,challengeId,client:'web'}})));
      if (route!==state.routeEpoch) return;
      navigate('/account', {replace: true});
      toast('注册成功，已自动登录。');
    } catch (error) {
      formError(form, error.message);
      setSubmit(button, false, '注册并登录');
    }
  });
}

function bindForgot() {
  const form = $('#forgot-form');
  if(!form)return;
  let challengeId='', email='', challengeDeadline=0, resetGrant=null, sending=false, resetting=false;
  const stepOne=$('[data-step="1"]',form),stepTwo=$('[data-step="2"]',form);
  const resend=$('#forgot-resend',form);
  async function sendResetCode(button) {
    if(sending||resetting||button.disabled)return;
    clearFormError(form);
    $('.form-notice',form).hidden=true;
    const targetEmail=stepOne.hidden?email:$('#forgot-email',form).value.trim();
    if(!EMAIL_RE.test(targetEmail)){formError(form,'请输入有效邮箱地址。');return;}
    const label=stepOne.hidden?'重新发送':'发送验证码';
    sending=true;
    resetGrant=null;
    setSubmit(button,true,'正在发送…');
    try {
      const data=await apiFetch('/api/v1/auth/password/forgot',{method:'POST',body:{email:targetEmail}});
      if(!data.challengeId) throw new RequestError('邮件请求未能开始，请稍后重试。');
      if(!form.isConnected)return;
      challengeId=data.challengeId;
      challengeDeadline=Date.now()+1000*(Number(data.expiresIn)||600);
      email=targetEmail;
      $('#forgot-code',form).value='';
      stepOne.hidden=true;stepTwo.hidden=false;
      showNotice(form,'如果该邮箱有账号，请查收最新验证码。');
      if(button!==resend)setSubmit(button,false,label);
      startCountdown(resend,data.retryAfter||60,'重新发送');
      $('#forgot-code',form).focus();
    } catch(error) {
      setSubmit(button,false,label);
      formError(form,error.message);
      if(error.retryAfter&&form.isConnected) startCountdown(button,error.retryAfter,label);
    } finally { sending=false; }
  }
  $('#forgot-send',form).addEventListener('click',event=>{event.preventDefault();void sendResetCode(event.currentTarget);});
  resend.addEventListener('click',event=>void sendResetCode(event.currentTarget));
  $('#forgot-code',form).addEventListener('input',()=>{resetGrant=null;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!stepOne.hidden){await sendResetCode($('#forgot-send',form));return;}
    if(sending||resetting)return;
    clearFormError(form);
    const code=$('#forgot-code',form).value.trim();
    const password=$('#forgot-password',form).value;
    if(!challengeId){formError(form,'请先发送验证码。');return;}
    if(!/^\d{6}$/.test(code)){formError(form,'请输入 6 位验证码。');return;}
    if(!resetGrant&&Date.now()>=challengeDeadline){formError(form,'验证码已过期，请重新发送。');return;}
    const problem=passwordProblem(password);
    if(problem){formError(form,problem);return;}
    if(password!==$('#forgot-confirm',form).value){formError(form,'两次输入的密码不一致。');return;}
    const button=$('#forgot-reset',form),route=state.routeEpoch;
    resetting=true;
    setSubmit(button,true,'正在重置…');
    try {
      if(!resetGrant || Date.now()>=resetGrant.expires) {
        resetGrant=null;
        const result=await apiFetch('/api/v1/auth/password/verify-reset',{method:'POST',body:{email,code,challengeId}});
        if(!result.resetToken) throw new RequestError('没有收到重置授权，请重新获取验证码。');
        resetGrant={token:result.resetToken,expires:Date.now()+600000};
      }
      if(route!==state.routeEpoch)return;
      await authCookieLock(async()=>{
        const result=await apiFetch('/api/v1/auth/password/reset',{method:'POST',body:{resetToken:resetGrant.token,newPassword:password}});
        if(result.ok!==true || result.loginRequired!==true) throw new RequestError('未能确认密码重置。');
        forgetSession();
      });
      resetGrant=null;
      if(route!==state.routeEpoch)return;
      try { sessionStorage.setItem('yukino-login-notice','密码已重置，请使用新密码登录。'); } catch {}
      navigate('/login',{replace:true});
    } catch(error) {
      if(error.status===401||error.status===403||/reset.*(invalid|expired)|invalid.*reset/.test(error.code||'')) resetGrant=null;
      formError(form,error.message);
      setSubmit(button,false,'重置密码');
    } finally { resetting=false; }
  });
}

const SKIN_NAMES = {
  'yukino-01-v1': '白色两件泳装',
  'yukino-02-v1': '蓝色开衫贝雷帽',
  'yukino-03-v1': '白色连体泳装 · 蓝蝴蝶结',
  'yukino-04-v1': '蓝色花纹和服',
  'yukino-05-v1': '黑色蕾丝裙',
  'yukino-06-v1': '黑白女仆 · 红蝴蝶结',
  'yukino-07-v1': '原校服黄背心',
};

function skinLabel(kind) {
  if (kind === 'affection') return '好感度';
  if (kind === 'login-days') return '累计登录';
  if (kind === 'base') return '默认可用';
  return '未配置';
}

async function openAccount() {
  const route = state.routeEpoch;
  if (!state.accessToken) {
    const refreshed = await refreshSession();
    if(route!==state.routeEpoch)return;
    if(!refreshed) {
      if(state.refreshProblem) renderAccountError(state.refreshProblem);
      else navigate('/login',{replace:true});
      return;
    }
  }
  try {
    const [me, progress, sessions] = await Promise.all([
      apiFetch('/api/v1/me', {auth: true}),
      apiFetch('/api/v1/progress', {auth: true}),
      apiFetch('/api/v1/sessions', {auth: true}),
    ]);
    if(route!==state.routeEpoch)return;
    state.user = me.user;
    state.account = progress;
    updateHeaderAccount();
    renderAccount(progress, sessions.sessions || []);
  } catch (error) {
    if(route!==state.routeEpoch)return;
    if (error.status === 401) { forgetSession(); navigate('/login', {replace:true}); return; }
    renderAccountError(error);
  }
}

function statusBadge() {
  return `<span class="account-badge online" id="account-status"><span class="dot"></span>已连接 · 进度已同步</span>`;
}

function renderAccount(progress, sessions) {
  const skins=Array.isArray(progress?.skins)?progress.skins.filter(x=>typeof x?.id==='string'):[];
  const unlocked = skins.filter((skin) => skin.unlocked && skin.kind !== 'base').length;
  const pending = 0; // The web client does not hold desktop pending events.
  const email = state.user?.email || '';
  const view = $('#app-view');
  view.innerHTML = `<section>
    <header class="account-head">
      <div>
        <p class="eyebrow">ACCOUNT CENTER</p>
        <h1>${escapeText(email || '账号中心')}</h1>
        <p>在这里看进度、改密码，或让不用的设备退出登录。</p>
      </div>
      <div>${statusBadge()}</div>
    </header>
    <div class="account-grid">
      <div>
        <section class="account-card" aria-labelledby="progress-title">
          <h2 id="progress-title">已确认进度</h2>
          <p>这里显示已经同步的进度。</p>
          <div class="progress-cards">
            <article><strong>${Number(progress.affection) || 0}</strong><span>已同步好感度</span></article>
            <article><strong>${Number(progress.loginDays) || 0}</strong><span>累计登录天数</span></article>
            <article><strong>${unlocked}</strong><span>已解锁衣服</span></article>
          </div>
          <div class="sub-section">
            <h3>皮肤进度</h3>
            <ul class="skin-list">${skins.map((skin) => `<li class="skin-row ${skin.unlocked ? 'unlocked' : ''}">
              <span class="skin-name">${escapeText(SKIN_NAMES[skin.id] || skin.id.replace(/-v1$/, ''))}</span>
              <span class="skin-state">${skin.unlocked ? '已解锁' : `${skinLabel(skin.kind)} ${Number(skin.current)||0} / ${Number(skin.target)||0}`}</span>
            </li>`).join('')}</ul>
          </div>
          <div class="account-actions">
            <button class="button button-quiet" type="button" id="checkin-button">${progress.checkedInToday ? '今日已确认' : '今日确认'}</button>
            <button class="button button-quiet" type="button" id="refresh-progress">刷新进度</button>
          </div>
          <p class="pending-note">网页版不能补签。断网时的互动先存在电脑里，联网后再同步。</p>
        </section>
        <section class="account-card sub-section" aria-labelledby="security-title">
          <h2 id="security-title">安全</h2>
          <p>修改密码需要当前密码。成功后其他设备会退出登录，并发送安全通知邮件。</p>
          <form class="account-forms" id="change-password-form" novalidate>
            <p class="form-error" role="alert" hidden></p>
            ${fieldMarkup({id: 'current-password', label: '当前密码', type: 'password', autocomplete: 'current-password'})}
            ${fieldMarkup({id: 'new-password', label: '新密码', type: 'password', autocomplete: 'new-password', hint: '至少 15 个字符，最多 128 个字符。'})}
            ${fieldMarkup({id: 'confirm-password', label: '确认新密码', type: 'password', autocomplete: 'new-password'})}
            <div class="form-actions"><button class="button button-primary" type="submit">修改密码</button></div>
          </form>
        </section>
      </div>
      <div>
        <section class="account-card" aria-labelledby="sessions-title">
          <h2 id="sessions-title">登录设备</h2>
          <p>只列出这个账号登录过的设备。让某台设备退出后，它需要重新登录。</p>
          <ul class="session-list">${sessions.length ? sessions.map((session) => `<li class="session-row">
            <div><strong>${escapeText(session.deviceLabel || (session.client === 'desktop' ? '桌面端' : '网页端'))}${session.current ? ' · 当前设备' : ''}</strong><small>最近使用 ${formatDate(session.lastUsedAt)} · 到期 ${formatDate(session.expiresAt)}</small></div>
            ${session.current ? '' : `<button type="button" data-revoke="${escapeText(session.id)}">撤销</button>`}
          </li>`).join('') : '<li class="empty-state">没有其他登录设备。</li>'}</ul>
          <div class="account-actions">
            <button class="button button-quiet" type="button" id="logout-button">退出当前设备</button>
            <button class="button button-quiet" type="button" id="logout-all-button">退出所有设备</button>
          </div>
        </section>
        <section class="account-card sub-section">
          <h2>账号说明</h2>
          <p>官网和桌面版可以用同一个账号，登录状态各自保留。注册后会直接登录；找回密码后，请用新密码重新登录。</p>
          <p class="form-hint">退出登录不删除聊天、模型或本地档案。</p>
          <a class="account-link" href="/#progress" data-link>查看账号与进度说明 →</a>
        </section>
      </div>
    </div>
  </section>`;
  bindPasswordToggles(view);
  $('#checkin-button')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setSubmit(button, true, '正在确认…');
    try {
      const route=state.routeEpoch;
      const next = await apiFetch('/api/v1/progress/check-in', {method:'POST',auth:true,body:{}});
      if(route!==state.routeEpoch)return;
      renderAccount(next, sessions);
      toast(next.counted ? '今日已确认。' : '今天已经确认过了，不会重复计天。');
    } catch (error) {
      toast(error.message, {error: true});
      setSubmit(button, false);
    }
  });
  $('#refresh-progress')?.addEventListener('click', openAccount);
  $('#change-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormError(form);
    const currentPassword = $('#current-password').value;
    const newPassword = $('#new-password').value;
    const confirmPassword = $('#confirm-password').value;
    if (!currentPassword) { formError(form, '请输入当前密码。'); return; }
    const problem = passwordProblem(newPassword);
    if (problem) { formError(form, problem); return; }
    if (newPassword !== confirmPassword) { formError(form, '两次输入的新密码不一致。'); return; }
    const button = $('button[type="submit"]', form);
    setSubmit(button, true, '正在修改…');
    try {
      const doChange=()=>authCookieLock(async()=>{
        const data=await apiFetch('/api/v1/auth/password/change',{method:'POST',auth:true,retry:false,body:{currentPassword,newPassword,client:'web'}});
        acceptSession({...data,user:data.user||state.user});
      });
      try { await doChange(); } catch (error) { if(error.status!==401 || !await refreshSession())throw error; await doChange(); }
      toast('密码已修改。其他设备需要重新登录。');
      openAccount();
    } catch (error) {
      formError(form, error.message);
      setSubmit(button, false, '修改密码');
    }
  });
  for (const button of $$('[data-revoke]', view)) {
    button.addEventListener('click', async () => {
      if (!confirm('撤销这个设备的登录状态？该设备需要重新登录。')) return;
      setSubmit(button, true, '撤销中…');
      try {
        await apiFetch(`/api/v1/sessions/${encodeURIComponent(button.dataset.revoke)}`, {method: 'DELETE', auth: true});
        toast('会话已撤销。');
        openAccount();
      } catch (error) {
        toast(error.message, {error: true});
        setSubmit(button, false, '撤销');
      }
    });
  }
  async function signOut(button,all) {
    if(button.disabled)return;
    const route=state.routeEpoch;
    const path=all?'/api/v1/auth/logout-all':'/api/v1/auth/logout';
    const revoke=()=>authCookieLock(async()=>{
      await apiFetch(path,{method:'POST',auth:true,retry:false,body:{}});
      forgetSession();
    });
    const buttons=[$('#logout-button'),$('#logout-all-button')].filter(Boolean);
    for(const item of buttons)item.disabled=true;
    try {
      try { await revoke(); } catch(error) { if(error.status!==401||!await refreshSession())throw error;await revoke(); }
      if(route===state.routeEpoch) { navigate('/'); toast(all?'已退出所有设备。':'已退出当前设备。'); }
    } catch(error) {
      toast('未能确认退出。'+error.message,{error:true});
    } finally {
      for(const item of buttons)item.disabled=false;
    }
  }
  $('#logout-button')?.addEventListener('click',event=>void signOut(event.currentTarget,false));
  $('#logout-all-button')?.addEventListener('click',event=>{
    if(confirm('退出所有设备？其他设备也需要重新登录。'))void signOut(event.currentTarget,true);
  });

}

function renderAccountError(error) {
  const view = $('#app-view');
  view.innerHTML = `<section class="auth-shell"><div class="auth-panel">
    <h1>暂时无法读取账号。</h1>
    <p class="auth-lead">${escapeText(error.message)}</p>
    <div class="helper-links"><button type="button" id="retry-account">重试</button><a href="/" data-link>返回首页</a><a href="/login" data-link>重新登录</a></div>
    <p class="form-hint">暂时连不上，不代表账号出了问题。桌面版的本地功能还能用。</p>
  </div>${AUTH_ART}</section>`;
  $('#retry-account')?.addEventListener('click', openAccount);
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function bindGlobal() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    if (url.pathname === location.pathname && url.hash) {
      closeNav();
      document.querySelector(url.hash)?.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    navigate(url.pathname + url.hash);
    if (url.hash) requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  });
  window.addEventListener('popstate', renderRoute);
  const notice = sessionStorage.getItem('yukino-login-notice');
  if (notice) {
    try { sessionStorage.removeItem('yukino-login-notice'); } catch {}
    setTimeout(() => toast(notice, {timeout: 6000}), 300);
  }
}

bindGlobal();
renderRoute();
if(!/^\/account\/?$/.test(location.pathname))void refreshSession();
