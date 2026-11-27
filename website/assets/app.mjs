import './home-effects.mjs';
function closeNav() {
  const nav = document.querySelector('#header-nav');
  const toggle = document.querySelector('#nav-toggle');
  nav?.classList.remove('open');
  toggle?.setAttribute('aria-expanded', 'false');
}
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
  pendingEmail: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 512;

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
  }).finally(()=>{
    state.refreshPromise = null;
    updateHeaderAccount();
  });
  updateHeaderAccount();
  return state.refreshPromise;
}

function nicknameInitial(nickname) {
  const value = (nickname || '').trim();
  if (!value) return '·';
  return new Intl.Segmenter('zh', {granularity: 'grapheme'}).segment(value)[Symbol.iterator]().next().value.segment;
}

function updateHeaderAccount() {
  const link = $('#header-account');
  if (!link) return;
  if (state.user) {
    const avatar = document.createElement('span');
    avatar.className = 'header-user-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = nicknameInitial(state.user.nickname);
    link.replaceChildren(avatar, document.createTextNode('账号中心'));
  } else link.textContent = state.refreshPromise || state.refreshProblem ? '账号' : '登录';
  const register = document.querySelector('.v3-auth-actions a[href="/register"]');
  if (register) register.hidden = !!state.user;
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
  const prompt = $('.form-register-prompt', form);
  if (prompt) prompt.hidden = true;
  const box = $('.form-error', form);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}
function clearFormError(form) {
  const box = $('.form-error', form);
  if (box) { box.hidden = true; box.textContent = ''; }
  const prompt = $('.form-register-prompt', form);
  if (prompt) { prompt.hidden = true; prompt.replaceChildren(); }
}
function showRegisterPrompt(form, email) {
  const box = $('.form-error', form);
  if (box) { box.hidden = true; box.textContent = ''; }
  const notice = $('.form-notice', form);
  if (notice) notice.hidden = true;
  const prompt = $('.form-register-prompt', form);
  if (!prompt) {
    formError(form, '该邮箱尚未注册账号，请先前往注册。');
    return;
  }
  const copy = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = '该邮箱尚未注册账号。';
  copy.append(strong, document.createTextNode('验证邮箱即可创建新账号。'));
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'prompt-go-register';
  action.textContent = '前往注册 →';
  action.addEventListener('click', () => {
    state.pendingEmail = (email || '').trim();
    navigate('/register');
  });
  prompt.replaceChildren(copy, action);
  prompt.hidden = false;
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
  if (!/\p{Lu}/u.test(password)) return '密码至少需要一个大写字母。';
  if (!/\p{Ll}/u.test(password)) return '密码至少需要一个小写字母。';
  if (!/\p{Nd}/u.test(password)) return '密码至少需要一个数字。';
  if (!/[\p{P}\p{S}]/u.test(password)) return '密码至少需要一个符号。';
  return '';
}

function nicknameProblem(value) {
  return value.trim() ? '' : '请输入昵称。';
}

function normalizeNickname(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
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

function fieldMarkup({id, label, type = 'text', autocomplete = '', placeholder = '', hint = '', inputMode = '', required = true}) {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-wrap">
      <input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" ${inputMode ? `inputmode="${inputMode}"` : ''} ${required ? 'required' : ''}>
      ${type === 'password' ? `<button class="input-toggle" type="button" aria-pressed="false" aria-label="显示密码" aria-controls="${id}">显示</button>` : ''}
    </div>
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;
}

const AUTH_ART = `
  <div class="auth-aside auth-aside-figure"><img src="/assets/app/winter-cutout.png" width="860" height="1536" alt="冬季制服 3D 形象"></div>`;

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
    lead: '可选择密码登录或邮箱验证码免密登录，同步你的陪伴进度。',
    body: `<form class="auth-form" id="login-form" novalidate>
      <div class="login-mode-switch" role="tablist" aria-label="登录方式">
        <button type="button" role="tab" aria-selected="true" data-login-mode="password">密码登录</button>
        <button type="button" role="tab" aria-selected="false" data-login-mode="code">验证码登录</button>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-register-prompt" role="alert" hidden></div>
      <p class="form-notice" role="status" hidden></p>
      ${fieldMarkup({id: 'login-email', label: '邮箱', type: 'email', autocomplete: 'username', inputMode: 'email', placeholder: 'name@example.com'})}
      <div id="login-password-group">
        ${fieldMarkup({id: 'login-password', label: '密码', type: 'password', autocomplete: 'current-password', placeholder: '输入登录密码'})}
      </div>
      <div class="field" id="login-code-group" hidden>
        <label for="login-code">邮箱验证码</label>
        <div class="code-row">
          <input id="login-code" name="login-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位数字验证码">
          <button class="button button-quiet" type="button" id="login-send-code">发送验证码</button>
        </div>
        <small>验证码 10 分钟内有效，请使用最新收到的一封邮件。</small>
      </div>
      <label class="check-row"><input type="checkbox" id="login-remember" checked> <span>保持登录</span></label>
      <div class="form-actions"><button class="button button-primary" type="submit" id="login-submit">登录</button></div>
      <div class="helper-links"><button type="button" id="forgot-link">忘记密码？</button><a href="/register" data-link>没有账号？前往注册</a></div>
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
      ${fieldMarkup({id: 'register-email', label: '邮箱', type: 'email', autocomplete: 'email', inputMode: 'email'})}
      ${fieldMarkup({id: 'register-nickname', label: '昵称（选填）', autocomplete: 'nickname', required: false, hint: '也可以在登录后设置。'})}
      <div class="field">
        <label for="register-code">邮箱验证码</label>
        <div class="code-row">
          <input id="register-code" name="register-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位数字" required>
          <button class="button button-quiet" type="button" id="register-send-code">发送验证码</button>
        </div>
        <small>请使用最新验证码，10 分钟内有效。</small>
      </div>
      ${fieldMarkup({id: 'register-password', label: '密码', type: 'password', autocomplete: 'new-password', hint: '至少 6 位，包含大写字母、小写字母、数字和符号。'})}
      ${fieldMarkup({id: 'register-confirm', label: '确认密码', type: 'password', autocomplete: 'new-password', placeholder: '再输入一次'})}
      <div class="form-actions"><button class="button button-primary" type="submit" id="register-submit">注册并登录</button></div>
      <p class="form-hint">注册不会上传你的聊天、记忆、声音或模型文件。</p>
      <div class="helper-links"><a href="/login" data-link>已有账号，去登录</a><a href="/" data-link>暂不注册</a></div>
    </form>`,
  });
}

function forgotView() {
  return authPage({
    title: '重置密码并登录。',
    lead: '通过邮箱验证码设置新密码，完成后将直接登录账号中心。',
    tabs: false,
    body: `<form class="auth-form" id="forgot-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-register-prompt" role="alert" hidden></div>
      <p class="form-notice" role="status" hidden></p>
      <div data-step="1">
        ${fieldMarkup({id: 'forgot-email', label: '注册邮箱', type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: '输入你的账号邮箱'})}
        <div class="form-actions"><button class="button button-primary" type="submit" id="forgot-send">发送验证码</button></div>
      </div>
      <div data-step="2" hidden>
        <div class="field">
          <label for="forgot-code">邮箱验证码</label>
          <div class="code-row">
            <input id="forgot-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位数字" required>
            <button class="button button-quiet" type="button" id="forgot-resend">重新发送</button>
          </div>
          <small>请使用最新一封邮件里的验证码，10 分钟内有效。</small>
        </div>
        ${fieldMarkup({id: 'forgot-password', label: '新密码', type: 'password', autocomplete: 'new-password', hint: '至少 6 位，包含大写、小写、数字和符号。重置后旧设备会自动退出。'})}
        ${fieldMarkup({id: 'forgot-confirm', label: '确认新密码', type: 'password', autocomplete: 'new-password', placeholder: '再输入一次新密码'})}
        <label class="check-row"><input type="checkbox" id="forgot-remember" checked> <span>保持登录</span></label>
        <div class="form-actions"><button class="button button-primary" type="submit" id="forgot-reset">重置密码并登录</button></div>
      </div>
      <div class="helper-links"><a href="/login" data-link>返回登录</a><a href="/register" data-link>前往注册</a></div>
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
  if (path === '/login') { void showLogin(); return; }
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

async function showLogin() {
  const route = state.routeEpoch;
  if (!state.accessToken && state.refreshPromise) {
    renderApp('<div class="account-loading" role="status">正在检查登录状态…</div>', '登录');
    await state.refreshPromise;
    if (route !== state.routeEpoch) return;
  }
  if (state.accessToken) { navigate('/account', {replace: true}); return; }
  if (state.refreshProblem) {
    renderAccountError(state.refreshProblem, () => {
      void refreshSession();
      void showLogin();
    });
    return;
  }
  renderApp(loginView(), '登录');
  bindLogin();
  setActiveNav('/login');
}

function bindLogin() {
  const form = $('#login-form');
  if (!form) return;
  let mode = 'password';
  let challengeId = '', challengeEmail = '', challengeDeadline = 0;
  const emailField = $('#login-email', form);
  const passwordGroup = $('#login-password-group', form);
  const codeGroup = $('#login-code-group', form);
  const submitButton = $('#login-submit', form);

  if (state.pendingEmail) {
    emailField.value = state.pendingEmail;
    state.pendingEmail = '';
  }

  let resetNotice = ''; try { resetNotice = sessionStorage.getItem('yukino-login-notice') || ''; } catch {}
  if (resetNotice) {
    const box = $('.form-notice', form);
    box.textContent = resetNotice;
    box.hidden = false;
    try { sessionStorage.removeItem('yukino-login-notice'); } catch {}
  }

  function switchMode(nextMode) {
    mode = nextMode === 'code' ? 'code' : 'password';
    clearFormError(form);
    for (const tab of $$('[data-login-mode]', form)) {
      tab.setAttribute('aria-selected', String(tab.dataset.loginMode === mode));
    }
    passwordGroup.hidden = mode !== 'password';
    codeGroup.hidden = mode !== 'code';
    submitButton.textContent = mode === 'code' ? '验证码登录' : '登录';
    submitButton.dataset.label = submitButton.textContent;
  }

  for (const tab of $$('[data-login-mode]', form)) {
    tab.addEventListener('click', () => switchMode(tab.dataset.loginMode));
  }

  emailField.addEventListener('input', () => {
    clearFormError(form);
    if (emailField.value.trim().toLowerCase() === challengeEmail) return;
    challengeId = '';
    challengeDeadline = 0;
    $('#login-code', form).value = '';
    $('.form-notice', form).hidden = true;
  });

  $('#login-send-code', form)?.addEventListener('click', async () => {
    clearFormError(form);
    const email = emailField.value.trim();
    if (!EMAIL_RE.test(email)) { formError(form, '请先填写有效邮箱地址。'); emailField.focus(); return; }
    const button = $('#login-send-code', form);
    if (button.disabled) return;
    $('.form-notice', form).hidden = true;
    setSubmit(button, true, '正在发送…');
    try {
      const data = await apiFetch('/api/v1/auth/login/request-code', {method: 'POST', body: {email, client: 'web'}});
      if (!data.challengeId || data.delivery !== 'accepted-by-provider') {
        throw new RequestError('邮件服务未确认接收验证码请求，请稍后重试。');
      }
      if (!form.isConnected) return;
      startCountdown(button, data.retryAfter || 60, '发送验证码');
      if (emailField.value.trim().toLowerCase() !== email.toLowerCase()) return;
      challengeId = data.challengeId;
      challengeEmail = email.toLowerCase();
      challengeDeadline = Date.now() + 1000 * (Number(data.expiresIn) || 600);
      showNotice(form, '登录验证码已发送至邮箱，10 分钟内有效。');
      $('#login-code', form).focus();
    } catch (error) {
      setSubmit(button, false, '发送验证码');
      if (error.code === 'account_not_found') showRegisterPrompt(form, email);
      else formError(form, error.message);
      if (error.retryAfter) startCountdown(button, error.retryAfter, '发送验证码');
    }
  });

  $('#forgot-link', form)?.addEventListener('click', () => {
    const typed = emailField.value.trim();
    if (typed) state.pendingEmail = typed;
    navigate('/forgot');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const email = emailField.value.trim();
    const remember = $('#login-remember', form).checked;
    if (!EMAIL_RE.test(email)) { formError(form, '请输入有效邮箱地址。'); emailField.focus(); return; }

    if (mode === 'code') {
      const code = $('#login-code', form).value.trim();
      if (!challengeId || challengeEmail !== email.toLowerCase()) {
        formError(form, '请先点击“发送验证码”获取登录验证码。');
        return;
      }
      if (Date.now() >= challengeDeadline) {
        formError(form, '验证码已过期，请重新发送。');
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        formError(form, '请输入 6 位数字验证码。');
        $('#login-code', form).focus();
        return;
      }
      if (submitButton.disabled) return;
      const route = state.routeEpoch;
      setSubmit(submitButton, true, '正在登录…');
      try {
        await authCookieLock(async () => acceptSession(await apiFetch('/api/v1/auth/login/code', {
          method: 'POST', body: {email, code, challengeId, remember, client: 'web'},
        })));
        if (route !== state.routeEpoch) return;
        navigate('/account', {replace: true});
        toast('已通过验证码登录。');
      } catch (error) {
        if (error.code === 'account_not_found') showRegisterPrompt(form, email);
        else formError(form, error.message);
      } finally {
        setSubmit(submitButton, false, '验证码登录');
      }
      return;
    }

    const password = $('#login-password', form).value;
    if (!password) { formError(form, '请输入密码。'); $('#login-password', form).focus(); return; }
    if (submitButton.disabled) return;
    const route = state.routeEpoch;
    setSubmit(submitButton, true, '正在登录…');
    try {
      await authCookieLock(async () => acceptSession(await apiFetch('/api/v1/auth/login', {
        method: 'POST', body: {email, password, remember, checkAccount: true, client: 'web'},
      })));
      if (route !== state.routeEpoch) return;
      navigate('/account', {replace: true});
      toast('已登录。');
    } catch (error) {
      if (error.code === 'account_not_found') showRegisterPrompt(form, email);
      else formError(form, error.message);
    } finally {
      setSubmit(submitButton, false, '登录');
    }
  });
}

function bindRegister() {
  const form = $('#register-form');
  if (!form) return;
  let challengeId = '', challengeEmail = '', challengeDeadline = 0;
  const emailField=$('#register-email',form);
  if (state.pendingEmail) {
    emailField.value = state.pendingEmail;
    state.pendingEmail = '';
  }
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
    const nickname = normalizeNickname($('#register-nickname').value);
    const code = $('#register-code').value.trim();
    const password = $('#register-password').value;
    const confirm = $('#register-confirm').value;
    if (!EMAIL_RE.test(email)) { formError(form, '请输入有效邮箱地址。'); return; }
    const nicknameIssue = nickname && nicknameProblem(nickname);
    if (nicknameIssue) { formError(form, nicknameIssue); $('#register-nickname').focus(); return; }
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
      await authCookieLock(async()=>acceptSession(await apiFetch('/api/v1/auth/register',{method:'POST',body:{email,...(nickname ? {nickname} : {}),code,password,challengeId,client:'web'}})));
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
  const forgotEmailField=$('#forgot-email',form);
  if (state.pendingEmail && forgotEmailField) {
    forgotEmailField.value = state.pendingEmail;
    state.pendingEmail = '';
  }
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
      const data=await apiFetch('/api/v1/auth/password/forgot',{method:'POST',body:{email:targetEmail,checkAccount:true}});
      if(!data.challengeId) throw new RequestError('邮件请求未能开始，请稍后重试。');
      if(!form.isConnected)return;
      challengeId=data.challengeId;
      challengeDeadline=Date.now()+1000*(Number(data.expiresIn)||600);
      email=targetEmail;
      $('#forgot-code',form).value='';
      stepOne.hidden=true;stepTwo.hidden=false;
      showNotice(form,'重置验证码已发送至邮箱，请输入最新收到的 6 位验证码。');
      if(button!==resend)setSubmit(button,false,label);
      startCountdown(resend,data.retryAfter||60,'重新发送');
      $('#forgot-code',form).focus();
    } catch(error) {
      setSubmit(button,false,label);
      if(error.code==='account_not_found') showRegisterPrompt(form,targetEmail);
      else formError(form,error.message);
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
    const remember=$('#forgot-remember',form)?.checked !== false;
    if(!challengeId){formError(form,'请先发送验证码。');return;}
    if(!/^\d{6}$/.test(code)){formError(form,'请输入 6 位验证码。');return;}
    if(!resetGrant&&Date.now()>=challengeDeadline){formError(form,'验证码已过期，请重新发送。');return;}
    const problem=passwordProblem(password);
    if(problem){formError(form,problem);return;}
    if(password!==$('#forgot-confirm',form).value){formError(form,'两次输入的密码不一致。');return;}
    const button=$('#forgot-reset',form),route=state.routeEpoch;
    resetting=true;
    setSubmit(button,true,'正在重置并登录…');
    try {
      if(!resetGrant || Date.now()>=resetGrant.expires) {
        resetGrant=null;
        const result=await apiFetch('/api/v1/auth/password/verify-reset',{method:'POST',body:{email,code,challengeId}});
        if(!result.resetToken) throw new RequestError('没有收到重置授权，请重新获取验证码。');
        resetGrant={token:result.resetToken,expires:Date.now()+600000};
      }
      if(route!==state.routeEpoch)return;
      let autoLoggedIn = false;
      await authCookieLock(async()=>{
        const result=await apiFetch('/api/v1/auth/password/reset',{
          method:'POST',
          body:{resetToken:resetGrant.token,newPassword:password,autoLogin:true,remember,client:'web'},
        });
        if (result.autoLogin && result.accessToken && result.user) {
          acceptSession(result);
          autoLoggedIn = true;
          return;
        }
        if(result.ok!==true) throw new RequestError('未能确认密码重置。');
        forgetSession();
      });
      resetGrant=null;
      if(route!==state.routeEpoch)return;
      if (autoLoggedIn) {
        navigate('/account',{replace:true});
        toast('密码已重置，已自动登录。');
      } else {
        try { sessionStorage.setItem('yukino-login-notice','密码已重置，请使用新密码登录。'); } catch {}
        navigate('/login',{replace:true});
      }
    } catch(error) {
      if(error.status===401||error.status===403||/reset.*(invalid|expired)|invalid.*reset/.test(error.code||'')) resetGrant=null;
      formError(form,error.message);
      setSubmit(button,false,'重置密码并登录');
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
  'kimono-v2': '蓝色花纹和服',
  'summer-uniform-v2': '夏日制服',
  'swimsuit-v2': '泳装',
  'winter-uniform-v2': '冬季制服',
  'qipao-v2': '黑色旗袍',
  'twin-tail-v2': '双马尾',
  'beret-v2': '贝雷帽',
  'ivory-coat-v2': '象牙大衣',
  'ice-hooded-winter-v2': '冰蓝连帽冬装',
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
    if (error.status === 401 && !state.accessToken) { navigate('/login', {replace:true}); return; }
    renderAccountError(error);
  }
}

function statusBadge() {
  return `<span class="account-badge online" id="account-status"><span class="dot"></span>已连接 · 进度已同步</span>`;
}

function renderAccount(progress, sessions) {
  const skins=Array.isArray(progress?.skins)?progress.skins.filter(x=>typeof x?.id==='string'):[];
  const unlocked = skins.filter((skin) => skin.unlocked && skin.kind !== 'base').length;
  const email = state.user?.email || '';
  const nickname = state.user?.nickname || '';
  const displayName = nickname || '我的账号';
  const initial = nicknameInitial(nickname);
  const view = $('#app-view');
  view.innerHTML = `<section class="account-center">
    <header class="account-head ac-hero">
      <div class="ac-hero-content">
        <div class="ac-avatar" aria-hidden="true">${escapeText(initial)}</div>
        <div class="ac-identity">
          <div class="ac-eyebrow-row">
            <p class="ac-eyebrow">ACCOUNT · 个人中心</p>
            ${statusBadge()}
          </div>
          <h1>${escapeText(displayName)}</h1>
          <p class="ac-email">${escapeText(email || '账号信息读取中')}</p>
        </div>
      </div>
    </header>
    <div class="account-grid ac-layout">
      <div class="ac-main">
        <section class="account-card ac-card ac-progress-card" aria-labelledby="progress-title">
          <div class="ac-card-head">
            <div><h2 id="progress-title">陪伴进度</h2><p>记录与雪乃的每日确认、好感度及永久解锁衣装。</p></div>
          </div>
          <div class="progress-cards ac-stats">
            <article><strong>${Number(progress.affection) || 0}</strong><span>好感度</span></article>
            <article><strong>${Number(progress.loginDays) || 0}</strong><span>累计登录天数</span></article>
            <article><strong>${unlocked}</strong><span>已解锁服装</span></article>
          </div>
          <div class="ac-skin-block">
            <div class="ac-subhead"><h3>服装进度</h3><span>共 ${skins.length} 套</span></div>
            <ul class="skin-list">${skins.length ? skins.map((skin) => {
              const current=Math.max(0,Number(skin.current)||0),target=Math.max(1,Number(skin.target)||1);
              const width=skin.unlocked?100:Math.min(100,Math.round(current/target*100));
              return `<li class="skin-row ${skin.unlocked ? 'unlocked' : ''}">
                <span class="skin-name">${escapeText(skin.label || SKIN_NAMES[skin.id] || skin.id.replace(/-v1$/, ''))}</span>
                <progress class="skin-bar" max="100" value="${width}" aria-label="解锁进度"></progress>
                <span class="skin-state">${skin.unlocked ? '已解锁' : `${skinLabel(skin.kind)} ${current} / ${target}`}</span>
              </li>`;
            }).join('') : '<li class="empty-state">暂时没有可显示的皮肤条目。</li>'}</ul>
          </div>
          <div class="account-actions ac-actions">
            <button class="button button-primary" type="button" id="checkin-button">${progress.checkedInToday ? '今日已确认' : '今日确认'}</button>
            <button class="button button-quiet" type="button" id="refresh-progress">刷新进度</button>
          </div>
          <p class="pending-note">桌面端的离线互动会在联网后自动同步。</p>
        </section>
      </div>
      <aside class="ac-side">
        <section class="account-card ac-card ac-profile-card" aria-labelledby="profile-title">
          <div class="ac-card-head"><div><h2 id="profile-title">个人资料与安全</h2></div></div>
          <div class="ac-profile-row"><div class="ac-avatar ac-avatar-small" aria-hidden="true">${escapeText(initial)}</div><div><strong>${escapeText(nickname || '还没有昵称')}</strong><small>${escapeText(email)}</small></div></div>
          <div class="ac-profile-actions">
            <button class="button button-quiet ac-edit-nickname" type="button" id="edit-nickname" ${nickname ? '' : 'hidden'}>修改昵称</button>
            <button class="button button-quiet" type="button" id="open-password-change" aria-expanded="false" aria-controls="password-change-drawer">修改密码</button>
          </div>
          <form class="account-forms ac-nickname-form ac-drawer" id="nickname-form" novalidate ${nickname ? 'hidden' : ''}>
            <p class="form-error" role="alert" hidden></p>
            <label class="field account-field" for="nickname-input"><span>昵称</span><input id="nickname-input" name="nickname" autocomplete="nickname" value="${escapeText(nickname)}"><small>昵称不能与其他账号重复。</small></label>
            <div class="form-actions"><button class="button button-primary" type="submit" id="nickname-submit">保存昵称</button><button class="button button-quiet" type="button" id="cancel-nickname">取消</button></div>
          </form>
          <div class="ac-drawer" id="password-change-drawer" hidden>
            <div class="ac-drawer-head"><strong>修改登录密码</strong></div>
            <p class="ac-drawer-note">修改成功后其他已登录设备会自动退出，并向邮箱发送安全通知。</p>
            <form class="account-forms" id="change-password-form" novalidate>
              <p class="form-error" role="alert" hidden></p>
              ${fieldMarkup({id: 'current-password', label: '当前密码', type: 'password', autocomplete: 'current-password'})}
              ${fieldMarkup({id: 'new-password', label: '新密码', type: 'password', autocomplete: 'new-password', hint: '至少 6 位，包含大写、小写、数字和符号。'})}
              ${fieldMarkup({id: 'confirm-password', label: '确认新密码', type: 'password', autocomplete: 'new-password'})}
              <div class="form-actions">
                <button class="button button-primary" type="submit">保存新密码</button>
                <button class="button button-quiet" type="button" id="cancel-password-change">取消</button>
              </div>
            </form>
          </div>
        </section>
        <section class="account-card ac-card ac-sessions-card" aria-labelledby="sessions-title">
          <div class="ac-card-head"><div><h2 id="sessions-title">登录设备</h2></div></div>
          <ul class="session-list">${sessions.length ? sessions.map((session) => `<li class="session-row">
            <span class="session-dot ${session.current ? 'current' : ''}" aria-hidden="true"></span>
            <div><strong>${escapeText(session.deviceLabel || (session.client === 'desktop' ? '桌面端' : '网页端'))}${session.current ? ' · 当前设备' : ''}</strong><small>最近使用 ${formatDate(session.lastUsedAt)} · 到期 ${formatDate(session.expiresAt)}</small></div>
            ${session.current ? '' : `<button type="button" data-revoke="${escapeText(session.id)}">撤销</button>`}
          </li>`).join('') : '<li class="empty-state">没有其他登录设备。</li>'}</ul>
          <div class="account-actions ac-actions">
            <button class="button button-quiet" type="button" id="logout-button">退出当前设备</button>
            <button class="button button-quiet" type="button" id="logout-all-button">退出所有设备</button>
          </div>
        </section>
      </aside>
    </div>
  </section>`;
  bindPasswordToggles(view);
  const passwordDrawer = $('#password-change-drawer', view);
  const openPasswordBtn = $('#open-password-change', view);
  const cancelPasswordBtn = $('#cancel-password-change', view);
  const changePasswordForm = $('#change-password-form', view);
  openPasswordBtn?.addEventListener('click', () => {
    if (!passwordDrawer) return;
    const willOpen = passwordDrawer.hidden;
    passwordDrawer.hidden = !willOpen;
    openPasswordBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) $('#current-password', view)?.focus();
  });
  cancelPasswordBtn?.addEventListener('click', () => {
    if (!passwordDrawer) return;
    passwordDrawer.hidden = true;
    openPasswordBtn?.setAttribute('aria-expanded', 'false');
    if (changePasswordForm) {
      clearFormError(changePasswordForm);
      changePasswordForm.reset();
    }
  });
  const nicknameForm = $('#nickname-form', view);
  const nicknameInput = $('#nickname-input', view);
  const editNickname = $('#edit-nickname', view);
  const cancelNickname = $('#cancel-nickname', view);
  const openNickname = () => {
    if (!nicknameForm) return;
    nicknameForm.hidden = false;
    if (editNickname) editNickname.hidden = true;
    nicknameInput?.focus();
  };
  editNickname?.addEventListener('click', openNickname);
  cancelNickname?.addEventListener('click', () => {
    if (!nicknameForm) return;
    nicknameForm.hidden = true;
    if (editNickname) editNickname.hidden = false;
    clearFormError(nicknameForm);
    if (nicknameInput) nicknameInput.value = nickname;
  });
  nicknameForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(nicknameForm);
    const value = normalizeNickname(nicknameInput?.value || '');
    const issue = nicknameProblem(value);
    if (issue) { formError(nicknameForm, issue); nicknameInput?.focus(); return; }
    const button = $('#nickname-submit', nicknameForm);
    setSubmit(button, true, '正在保存…');
    try {
      const data = await apiFetch('/api/v1/me', {method: 'PATCH', auth: true, body: {nickname: value}});
      if (!data?.user) throw new RequestError('没有收到更新后的昵称。');
      if (!nicknameForm.isConnected) return;
      state.user = {...state.user, ...data.user};
      updateHeaderAccount();
      toast('昵称已更新。');
      renderAccount(progress, sessions);
    } catch (error) {
      formError(nicknameForm, error.message);
      setSubmit(button, false, '保存昵称');
    }
  });
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

function renderAccountError(error, retry = openAccount) {
  const view = $('#app-view');
  view.innerHTML = `<section class="auth-shell"><div class="auth-panel">
    <h1>暂时无法读取账号。</h1>
    <p class="auth-lead">${escapeText(error.message)}</p>
    <div class="helper-links"><button type="button" id="retry-account">重试</button><a href="/" data-link>返回首页</a></div>
    <p class="form-hint">暂时连不上，不代表账号出了问题。桌面版的本地功能还能用。</p>
  </div>${AUTH_ART}</section>`;
  $('#retry-account')?.addEventListener('click', retry);
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
if (!/^\/account\/*$/.test(location.pathname)) void refreshSession();
renderRoute();
