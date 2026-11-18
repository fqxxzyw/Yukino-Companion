import './home-effects.mjs';
const API_BASE = String(window.YUKINO_SITE_CONFIG?.apiBase || '').replace(/\/+$/, '');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  accessToken: '',
  user: null,
  refreshPromise: null,
  downloadsLoaded: false,
  resetToken: '',
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

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function toast(message, {error = false, timeout = 3800} = {}) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('error', error);
  clearTimeout(element._timer);
  element._timer = setTimeout(() => { element.hidden = true; }, timeout);
}

async function apiFetch(path, {method = 'GET', body, auth = false, retry = true} = {}) {
  const headers = new Headers({'x-client': 'web'});
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (auth && state.accessToken) headers.set('authorization', `Bearer ${state.accessToken}`);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new RequestError('无法连接账号服务。请检查网络后重试；本地软件仍可离线使用。', {code: 'network_error'});
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch(path, {method, body, auth, retry: false});
  }
  if (!response.ok) {
    const error = data?.error || {};
    throw new RequestError(error.message || '请求未完成，请稍后重试。', {
      code: error.code || `http_${response.status}`,
      status: response.status,
      retryAfter: Number(error.retryAfter || 0),
    });
  }
  return data || {};
}

async function refreshSession() {
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {'content-type': 'application/json', 'x-client': 'web'},
        credentials: 'include',
        body: JSON.stringify({client: 'web'}),
        cache: 'no-store',
      });
      if (!response.ok) {
        state.accessToken = '';
        state.user = null;
        return false;
      }
      const data = await response.json();
      state.accessToken = data.accessToken || '';
      state.user = data.user || null;
      updateHeaderAccount();
      return Boolean(state.accessToken);
    } catch {
      state.accessToken = '';
      state.user = null;
      return false;
    } finally {
      state.refreshPromise = null;
    }
  })();
  return state.refreshPromise;
}

function updateHeaderAccount() {
  const link = $('#header-account');
  if (!link) return;
  link.textContent = state.user ? '账号中心' : '登录';
  link.href = state.user ? '/account' : '/login';
}

function setActiveNav(path) {
  for (const link of $$('.header-nav nav a')) {
    const target = new URL(link.href, location.origin);
    const active = target.pathname === path && (target.hash === location.hash || !target.hash);
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
  <div class="auth-aside auth-aside-figure">
    <img src="/assets/app/winter-cutout.png" width="860" height="1536" alt="冬季制服 3D 形象">
  </div>`;

function authPage({title, lead, body, aside = AUTH_ART, tabs = true}) {
  return `<section class="auth-shell">
    <div class="auth-panel">
      ${tabs ? `<nav class="auth-tabs" aria-label="账号入口">
        <a href="/login" data-link ${location.pathname === '/login' ? 'aria-current="page"' : ''}>登录</a>
        <a href="/register" data-link ${location.pathname === '/register' ? 'aria-current="page"' : ''}>注册</a>
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
    lead: '使用邮箱与密码登录。没有账号也可以继续使用桌面版。',
    body: `<form class="auth-form" id="login-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      <p class="form-notice" role="status" hidden></p>
      ${fieldMarkup({id: 'login-email', label: '邮箱', type: 'email', autocomplete: 'username', placeholder: 'you@example.com', inputMode: 'email'})}
      ${fieldMarkup({id: 'login-password', label: '密码', type: 'password', autocomplete: 'current-password', placeholder: '输入密码'})}
      <label class="check-row"><input type="checkbox" id="login-remember" checked> <span>保持登录。关闭后，关闭浏览器即需要重新登录。</span></label>
      <div class="form-actions"><button class="button button-primary" type="submit" id="login-submit">登录</button></div>
      <div class="helper-links"><button type="button" id="forgot-link">忘记密码</button><a href="/register" data-link>创建账号</a></div>
      <a class="skip-account" href="/">先不登录，回到首页</a>
    </form>`,
  });
}

function registerView() {
  return authPage({
    title: '创建一个账号。',
    lead: '验证邮箱后自动登录并进入账号中心。注册只需要普通邮箱。',
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
        <small>验证码 10 分钟内有效。重发会使旧验证码失效，请使用最新一封邮件。</small>
      </div>
      ${fieldMarkup({id: 'register-password', label: '密码', type: 'password', autocomplete: 'new-password', placeholder: '至少 15 个字符', hint: '支持空格与 Unicode，最长 128 个字符。请使用密码管理器。'})}
      ${fieldMarkup({id: 'register-confirm', label: '确认密码', type: 'password', autocomplete: 'new-password', placeholder: '再输入一次'})}
      <div class="form-actions"><button class="button button-primary" type="submit" id="register-submit">注册并登录</button></div>
      <p class="form-hint">继续即表示你了解：注册需要联网；云端只保存账号与必要的进度，不保存聊天、记忆、语音或模型文件。</p>
      <div class="helper-links"><a href="/login" data-link>已有账号，去登录</a><a href="/" data-link>暂不注册</a></div>
    </form>`,
  });
}

function forgotView() {
  return authPage({
    title: '找回密码。',
    lead: '通过邮箱验证码重置密码。请求响应不会透露邮箱是否已注册。',
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
          <small>验证码 10 分钟内有效；重发会使旧验证码失效。</small>
        </div>
        ${fieldMarkup({id: 'forgot-password', label: '新密码', type: 'password', autocomplete: 'new-password', placeholder: '至少 15 个字符', hint: '重置成功后旧会话会失效，并需要重新登录。'})}
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
  if (!state.downloadsLoaded) loadDownloads();
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

function closeNav() {
  const nav = $('#header-nav');
  const toggle = $('#nav-toggle');
  nav?.classList.remove('open');
  toggle?.setAttribute('aria-expanded', 'false');
}

function bindLogin() {
  const form = $('#login-form');
  if (!form) return;
  const resetNotice = sessionStorage.getItem('yukino-login-notice');
  if (resetNotice) {
    const box = $('.form-notice', form);
    box.textContent = resetNotice;
    box.hidden = false;
    sessionStorage.removeItem('yukino-login-notice');
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
    setSubmit(button, true, '正在登录…');
    try {
      const data = await apiFetch('/api/v1/auth/login', {method: 'POST', body: {email, password, remember, client: 'web'}});
      state.accessToken = data.accessToken;
      state.user = data.user;
      updateHeaderAccount();
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
  let challengeId = '';
  $('#register-send-code').addEventListener('click', async () => {
    clearFormError(form);
    const email = $('#register-email').value.trim();
    if (!EMAIL_RE.test(email)) { formError(form, '请先填写有效邮箱地址。'); $('#register-email').focus(); return; }
    const button = $('#register-send-code');
    setSubmit(button, true, '正在发送…');
    try {
      const data = await apiFetch('/api/v1/auth/register/request-code', {method: 'POST', body: {email, client: 'web'}});
      challengeId = data.challengeId;
      showNotice(form, '验证码请求已交给邮件服务。请查看邮箱；如果几分钟内没有收到，请检查垃圾邮件或稍后重发。');
      startCountdown(button, data.retryAfter || 60, '发送验证码');
      $('#register-code').focus();
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
    if (!challengeId) { formError(form, '请先发送验证码。'); return; }
    if (!/^\d{6}$/.test(code)) { formError(form, '请输入 6 位验证码。'); $('#register-code').focus(); return; }
    const problem = passwordProblem(password);
    if (problem) { formError(form, problem); $('#register-password').focus(); return; }
    if (password !== confirm) { formError(form, '两次输入的密码不一致。'); $('#register-confirm').focus(); return; }
    const button = $('#register-submit');
    setSubmit(button, true, '正在创建…');
    try {
      const data = await apiFetch('/api/v1/auth/register', {method: 'POST', body: {email, code, password, challengeId, client: 'web'}});
      state.accessToken = data.accessToken;
      state.user = data.user;
      updateHeaderAccount();
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
  if (!form) return;
  let challengeId = '';
  let email = '';
  let resetToken = '';
  const stepOne = $('[data-step="1"]', form);
  const stepTwo = $('[data-step="2"]', form);
  async function sendResetCode(button) {
    clearFormError(form);
    email = $('#forgot-email').value.trim();
    if (!EMAIL_RE.test(email)) { formError(form, '请输入有效邮箱地址。'); return; }
    setSubmit(button, true, '正在发送…');
    try {
      const data = await apiFetch('/api/v1/auth/password/forgot', {method: 'POST', body: {email, client: 'web'}});
      challengeId = data.challengeId;
      stepOne.hidden = true;
      stepTwo.hidden = false;
      showNotice(form, '如果该邮箱有账号，验证码会发送到对应邮箱。请使用最新一封邮件中的验证码。');
      startCountdown($('#forgot-resend'), data.retryAfter || 60, '重新发送');
      setSubmit(button, false, '发送验证码');
      $('#forgot-code').focus();
    } catch (error) {
      formError(form, error.message);
      if (error.retryAfter) startCountdown(button, error.retryAfter, '发送验证码');
      else setSubmit(button, false, '发送验证码');
    }
  }
  $('#forgot-send').addEventListener('click', (event) => { event.preventDefault(); sendResetCode($('#forgot-send')); });
  $('#forgot-resend').addEventListener('click', async () => {
    clearFormError(form);
    const button = $('#forgot-resend');
    setSubmit(button, true, '正在发送…');
    try {
      const data = await apiFetch('/api/v1/auth/password/forgot', {method: 'POST', body: {email, client: 'web'}});
      challengeId = data.challengeId;
      showNotice(form, '已重新发送。旧验证码已失效，请使用最新一封邮件。');
      startCountdown(button, data.retryAfter || 60, '发送验证码');
    } catch (error) {
      setSubmit(button, false, '重新发送');
      formError(form, error.message);
      if (error.retryAfter) startCountdown(button, error.retryAfter, '发送验证码');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!stepOne.hidden) { await sendResetCode($('#forgot-send')); return; }
    clearFormError(form);
    const code = $('#forgot-code').value.trim();
    const password = $('#forgot-password').value;
    const confirm = $('#forgot-confirm').value;
    if (!challengeId) { formError(form, '请先发送验证码。'); return; }
    if (!/^\d{6}$/.test(code)) { formError(form, '请输入 6 位验证码。'); return; }
    const problem = passwordProblem(password);
    if (problem) { formError(form, problem); return; }
    if (password !== confirm) { formError(form, '两次输入的密码不一致。'); return; }
    const button = $('#forgot-reset');
    setSubmit(button, true, '正在重置…');
    try {
      if (!resetToken) {
        const verified = await apiFetch('/api/v1/auth/password/verify-reset', {method: 'POST', body: {email, code, challengeId, client: 'web'}});
        resetToken = verified.resetToken;
      }
      await apiFetch('/api/v1/auth/password/reset', {method: 'POST', body: {resetToken, newPassword: password, client: 'web'}});
      state.accessToken = '';
      state.user = null;
      sessionStorage.setItem('yukino-login-notice', '密码已重置，请使用新密码登录。旧会话已失效。');
      navigate('/login', {replace: true});
    } catch (error) {
      formError(form, error.message);
      setSubmit(button, false, '重置密码');
    }
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
  if (!state.accessToken) {
    const refreshed = await refreshSession();
    if (!refreshed) { navigate('/login', {replace: true}); return; }
  }
  try {
    const [me, progress, sessions] = await Promise.all([
      apiFetch('/api/v1/me', {auth: true}),
      apiFetch('/api/v1/progress', {auth: true}),
      apiFetch('/api/v1/sessions', {auth: true}),
    ]);
    state.user = me.user;
    state.account = progress;
    updateHeaderAccount();
    renderAccount(progress, sessions.sessions || []);
  } catch (error) {
    if (error.status === 401) { navigate('/login', {replace: true}); return; }
    renderAccountError(error);
  }
}

function statusBadge() {
  return `<span class="account-badge online" id="account-status"><span class="dot"></span>云端可用 · 已确认进度</span>`;
}

function renderAccount(progress, sessions) {
  const unlocked = progress.skins.filter((skin) => skin.unlocked && skin.kind !== 'base').length;
  const pending = 0; // The web client does not hold desktop pending events.
  const email = state.user?.email || '';
  const view = $('#app-view');
  view.innerHTML = `<section>
    <header class="account-head">
      <div>
        <p class="eyebrow">ACCOUNT CENTER</p>
        <h1>${escapeText(email || '账号中心')}</h1>
        <p>登录状态、云端确认进度与设备会话。修改密码或其他安全操作会立即生效。</p>
      </div>
      <div>${statusBadge()}</div>
    </header>
    <div class="account-grid">
      <div>
        <section class="account-card" aria-labelledby="progress-title">
          <h2 id="progress-title">已确认进度</h2>
          <p>只显示服务端确认的数值。浏览器端不会提交自定义好感度或登录天数。</p>
          <div class="progress-cards">
            <article><strong>${Number(progress.affection) || 0}</strong><span>好感度 · 服务器确认</span></article>
            <article><strong>${Number(progress.loginDays) || 0}</strong><span>累计登录天数</span></article>
            <article><strong>${unlocked}</strong><span>永久皮肤权益</span></article>
          </div>
          <div class="sub-section">
            <h3>皮肤进度</h3>
            <ul class="skin-list">${progress.skins.map((skin) => `<li class="skin-row ${skin.unlocked ? 'unlocked' : ''}">
              <span class="skin-name">${escapeText(SKIN_NAMES[skin.id] || skin.id.replace(/-v1$/, ''))}</span>
              <span class="skin-state">${skin.unlocked ? '已解锁' : `${skinLabel(skin.kind)} ${skin.current} / ${skin.target}`}</span>
            </li>`).join('')}</ul>
          </div>
          <div class="account-actions">
            <button class="button button-quiet" type="button" id="checkin-button">${progress.checkedInToday ? '今日已确认' : '今日确认'}</button>
            <button class="button button-quiet" type="button" id="refresh-progress">刷新进度</button>
          </div>
          <p class="pending-note">浏览器端不会离线补签。桌面端离线产生的待同步互动会保存在本机，恢复连接后按服务端额度审核；这里显示的是已确认值。</p>
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
          <p>只显示当前账号的会话。撤销后该设备需要重新登录。</p>
          <ul class="session-list">${sessions.length ? sessions.map((session) => `<li class="session-row">
            <div><strong>${escapeText(session.deviceLabel || (session.client === 'desktop' ? '桌面端' : '网页端'))}${session.current ? ' · 当前设备' : ''}</strong><small>最近使用 ${formatDate(new Date(session.lastUsedAt).toISOString())} · 到期 ${formatDate(new Date(session.expiresAt).toISOString())}</small></div>
            ${session.current ? '' : `<button type="button" data-revoke="${escapeText(session.id)}">撤销</button>`}
          </li>`).join('') : '<li class="empty-state">没有可显示的会话。</li>'}</ul>
          <div class="account-actions">
            <button class="button button-quiet" type="button" id="logout-button">退出当前设备</button>
            <button class="button button-quiet" type="button" id="logout-all-button">退出所有设备</button>
          </div>
        </section>
        <section class="account-card sub-section">
          <h2>账号说明</h2>
          <p>桌面端与网页端共用账号，分别保存会话。注册后自动登录；重置密码会撤销旧会话，但不会自动登录。</p>
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
      const next = await apiFetch('/api/v1/progress/check-in', {method: 'POST', auth: true});
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
      const data = await apiFetch('/api/v1/auth/password/change', {method: 'POST', auth: true, body: {currentPassword, newPassword, client: 'web'}});
      state.accessToken = data.accessToken;
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
  $('#logout-button')?.addEventListener('click', async () => {
    try { await apiFetch('/api/v1/auth/logout', {method: 'POST', auth: true}); } catch { /* local sign-out still proceeds */ }
    state.accessToken = '';
    state.user = null;
    updateHeaderAccount();
    toast('已退出当前设备。');
    navigate('/');
  });
  $('#logout-all-button')?.addEventListener('click', async () => {
    if (!confirm('退出所有设备？所有会话都会失效，需要重新登录。')) return;
    try {
      await apiFetch('/api/v1/auth/logout-all', {method: 'POST', auth: true});
      state.accessToken = '';
      state.user = null;
      updateHeaderAccount();
      toast('已退出所有设备。');
      navigate('/');
    } catch (error) {
      toast(error.message, {error: true});
    }
  });
}

function renderAccountError(error) {
  const view = $('#app-view');
  view.innerHTML = `<section class="auth-shell"><div class="auth-panel">
    <h1>暂时无法读取账号。</h1>
    <p class="auth-lead">${escapeText(error.message)}</p>
    <div class="helper-links"><button type="button" id="retry-account">重试</button><a href="/" data-link>返回首页</a><a href="/login" data-link>重新登录</a></div>
    <p class="form-hint">账号服务不可达不代表账号失效。桌面版仍可使用本地功能。</p>
  </div>${AUTH_ART}</section>`;
  $('#retry-account')?.addEventListener('click', openAccount);
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

async function loadDownloads() {
  state.downloadsLoaded = true;
  const status = $('#download-status');
  try {
    const data = await apiFetch('/api/v1/public/downloads');
    const latest = data.latest;
    if (!latest?.asset) {
      $('#download-lead').textContent = '暂时无法从 GitHub API 读取安装包信息。你仍可以打开 Releases 页面查看官方发布。';
      $('#download-status').textContent = data.source === 'fallback' ? 'GitHub API 暂不可用，未构造不存在的下载地址。' : '未找到符合条件的 Windows 安装器。';
      return;
    }
    const channel = latest.channel === 'prerelease' ? '测试版' : '稳定版';
    $('#download-lead').textContent = `${latest.name || `Yukino Companion ${latest.version}`} 来自 GitHub Releases。下载后请运行 Setup 安装器；可选模型与语音资源可在软件内按需下载。`;
    $('#download-version').textContent = `v${latest.version}`;
    $('#download-channel').textContent = channel;
    $('#download-channel').className = latest.channel === 'prerelease' ? 'channel-prerelease' : 'channel-stable';
    $('#download-date').textContent = formatDate(latest.publishedAt);
    $('#download-file').textContent = `${latest.asset.name} · ${formatBytes(latest.asset.size)}`;
    const button = $('#download-button');
    button.textContent = `下载 ${latest.asset.name}`;
    button.href = latest.asset.url;
    $('#release-notes').href = latest.releaseUrl || 'https://github.com/fqxxzyw/Yukino-Companion/releases';
    $('#hero-version').textContent = `v${latest.version}`;
    const requirements = latest.systemRequirements || [];
    if (requirements.length) {
      $('#download-requirements').innerHTML = requirements.map((item) => `<li>${escapeText(item)}</li>`).join('');
    }
    status.textContent = data.source === 'cache'
      ? `GitHub API 暂时不可用，显示最近一次有效缓存${data.updatedAt ? `（${formatDate(new Date(data.updatedAt).toISOString())}）` : ''}。`
      : latest.channel === 'prerelease'
        ? '最新可用安装包标记为测试版，不代表稳定版。'
        : '版本信息来自 GitHub Releases API，下载链接直达安装包。';
  } catch (error) {
    $('#download-lead').textContent = '暂时无法读取下载信息。请打开 GitHub Releases 页面确认最新版本。';
    status.textContent = error.message;
  }
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
      document.querySelector(url.hash)?.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    navigate(url.pathname + url.hash);
    if (url.hash) requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  });
  $('#nav-toggle')?.addEventListener('click', (event) => {
    const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
    event.currentTarget.setAttribute('aria-expanded', String(!expanded));
    $('#header-nav').classList.toggle('open', !expanded);
  });
  window.addEventListener('popstate', renderRoute);
  const notice = sessionStorage.getItem('yukino-login-notice');
  if (notice) {
    sessionStorage.removeItem('yukino-login-notice');
    setTimeout(() => toast(notice, {timeout: 6000}), 300);
  }
}

bindGlobal();
refreshSession().finally(() => {
  renderRoute();
  if (location.pathname === '/account' && !state.accessToken) navigate('/login', {replace: true});
});
