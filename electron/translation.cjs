const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkerClient } = require('./speech.cjs');
const { VoiceResources, verified } = require('./voice-resources.cjs');
const { ResourceJobs } = require('./resource-jobs.cjs');
const DEFAULTS = Object.freeze({ python: '', modelDir: '', device: 'auto', cpuThreads: 4, cpuFallback: true, timeout: 180 });

function validateConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('无效翻译设置');
  const config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== typeof DEFAULTS[key]) throw Error(`无效翻译设置：${key}`);
    config[key] = input[key];
  }
  for (const key of ['python', 'modelDir']) if (config[key] && (!path.isAbsolute(config[key]) || config[key].includes('\0') || config[key].length > 4096)) throw Error(`翻译 ${key} 需要本机绝对路径`);
  if (!['auto', 'cpu', 'cuda'].includes(config.device)) throw Error('无效翻译设备');
  if (!Number.isInteger(config.cpuThreads) || config.cpuThreads < 1 || config.cpuThreads > 32) throw Error('翻译线程数需为 1–32');
  if (!Number.isFinite(config.timeout) || config.timeout < 30 || config.timeout > 900) throw Error('翻译超时需为 30–900 秒');
  return config;
}
function abortError() { const error = Error('翻译已取消'); error.name = 'AbortError'; return error; }

class TranslationService {
  constructor({ script, stateDir, modelDir = '', python = '', notify = () => {}, fetcher = fetch, verifyFile = verified, workerFactory = options => new WorkerClient(options) }) {
    Object.assign(this, { script, stateDir, notify, fetcher, verifyFile, workerFactory });
    this.bundledModelDir = modelDir;
    this.config = validateConfig({ modelDir, python });
    this.worker = null; this.loadedConfig = ''; this.pending = new Map(); this.active = null;
    this.installJobs = new ResourceJobs();
    this.installer = null; this.installToken = null; this.progress = null; this.error = null;
    this.queue = Promise.resolve(); this.phase = 'unloaded'; this.metadata = null; this.disposed = false;
  }
  configure(input) {
    const config = validateConfig({ ...this.config, ...input });
    if (JSON.stringify(config) !== JSON.stringify(this.config)) { if(config.modelDir!==this.config.modelDir)this.cancel();else this.cancelRequests(); this.config = config; }
    return { ...this.config };
  }
  update(phase, extra = {}) { this.phase = phase; this.error = extra.error || null; this.notify({ type: 'translation', phase, ...extra }); }
  async status() {
    let modelInstalled = false, runtimeAvailable = false;
    try {
      await fs.access(this.config.python); await fs.access(this.script);
      runtimeAvailable = true;
    } catch { /* Runtime and weights are separate resources. */ }
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(this.script), 'model-manifest.json'), 'utf8'));
      for (const item of manifest.files) {
        const stat = await fs.stat(path.join(this.config.modelDir, item.path));
        if (!stat.isFile() || stat.size !== item.size) throw Error('翻译模型不完整');
      }
      modelInstalled = true;
    } catch { /* Missing resources are reported, never downloaded during conversation. */ }
    const available = modelInstalled && runtimeAvailable;
    const downloaded = path.join(this.stateDir, 'models');
    const modelSource = this.config.modelDir === this.bundledModelDir ? 'bundled' : this.config.modelDir.startsWith(downloaded + path.sep) ? 'downloaded' : 'custom';
    return { ready: available, phase: this.phase, available, modelInstalled, runtimeAvailable, modelSource, loaded:Boolean(this.worker&&!this.worker.closed&&this.loadedConfig), model: 'tencent/Hy-MT2-1.8B-GGUF', device: this.metadata?.device || this.config.device, error: this.error, config: { ...this.config }, progress: this.progress, metadata: this.metadata, modelDir: this.config.modelDir, python: this.config.python, source: 'zh', target: 'ja' };
  }
  async install({ signal } = {}) {
    if (this.disposed) throw Error('翻译服务已关闭');
    return this.installJobs.run('translation', controller => this.installTask(controller), { signal });
  }
  async installTask(controller) {
    this.cancelRequests();
    const token = { cancelled: false, installer: null };
    this.installToken = token;
    const onAbort = () => { token.cancelled = true; token.installer?.cancel(); this.update('paused'); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const check = () => {
      if (controller.signal.aborted || token.cancelled || this.disposed || this.installToken !== token) throw abortError();
    };
    try {
      this.progress = null;
      this.update('checking');
      const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(this.script), 'model-manifest.json'), 'utf8'));
      check();
      // A valid bundled/custom model is reused even if Python is not installed.
      // Runtime installation is separate; never download a second 1.13 GB copy.
      for (const candidate of [...new Set([this.config.modelDir, this.bundledModelDir].filter(Boolean))]) {
        let complete = true;
        for (const item of manifest.files) {
          check();
          const valid = await this.verifyFile(path.join(candidate, item.path), { bytes: item.size, algorithm: 'sha256', digest: item.sha256 });
          check();
          if (!valid) { complete = false; break; }
        }
        if (complete) {
          check();
          this.config = validateConfig({ ...this.config, modelDir: candidate });
          this.update('installed');
          const status = await this.status();
          check();
          return status;
        }
      }
      check();
      const root = path.join(this.stateDir, 'models', manifest.directory || manifest.id);
      const catalog = { packs: { core: { label: '中日翻译模型', files: manifest.files.map(item => ({
        path: item.path, bytes: item.size, algorithm: 'sha256', digest: item.sha256, url: `${manifest.baseUrl}/${item.path}`
      })) } } };
      const installer = new VoiceResources({ root, catalog,
        // Guard the final network boundary too: cancellation can happen while
        // the downloader checks an existing file or available disk space.
        fetcher: (...args) => { check(); return this.fetcher(...args); },
        notify: status => {
          if (token.cancelled || this.disposed || this.installToken !== token) return;
          this.progress = { ...status, bytes: status.received || 0 };
          this.update(status.phase, { progress: this.progress, bytes: status.received || 0, total: status.total, error: status.error });
        }
      });
      token.installer = this.installer = installer;
      check();
      await installer.install('core');
      check();
      this.config = validateConfig({ ...this.config, modelDir: root });
      this.update('installed');
      const status = await this.status();
      check();
      return status;
    } catch (error) {
      if (token.cancelled || this.disposed) throw abortError();
      this.update('error', { error: error.message });
      throw error;
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      if (this.installer === token.installer) this.installer = null;
      if (this.installToken === token) this.installToken = null;
    }
  }
  async ensureLoaded(config, token) {
    if (token.cancelled) throw abortError();
    const key = JSON.stringify(config);
    if (this.worker && !this.worker.closed && this.loadedConfig === key) return;
    this.worker?.close(); this.worker = null; this.loadedConfig = '';
    if (!config.python) throw Error('请先安装翻译运行环境，或选择推理 Python');
    if (!config.modelDir) throw Error('请先安装中日翻译模型');
    await fs.access(config.python); await fs.access(this.script); await fs.mkdir(this.stateDir, { recursive: true });
    if (token.cancelled) throw abortError();
    this.update('loading');
    const worker = this.workerFactory({ python: config.python, script: this.script, cwd: this.stateDir });
    this.worker = worker;
    try {
      const metadata = await worker.request('load', { config }, config.timeout * 1000);
      if (token.cancelled) throw abortError();
      this.metadata = metadata; this.loadedConfig = key; this.update('ready', { metadata });
    } catch (error) { worker.close(); if (this.worker === worker) this.worker = null; throw error; }
  }
  translate(request, { signal, config: overrides } = {}) {
    if (this.disposed) return Promise.reject(Error('翻译服务已关闭'));
    const { text, source = 'zh', target = 'ja', requestId } = request || {};
    if (source !== 'zh' || target !== 'ja') return Promise.reject(Error('内置模型仅支持中文 → 日语'));
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) return Promise.reject(Error('待翻译内容需为 1–20000 字符'));
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) return Promise.reject(Error('无效翻译请求编号'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.pending.has(requestId)) return Promise.reject(Error('翻译请求编号重复'));
    if (this.pending.size >= 16) return Promise.reject(Error('待翻译内容过多，请稍后重试'));
    let config;
    try { config = validateConfig({ ...this.config, ...overrides }); } catch (error) { return Promise.reject(error); }
    const token = { requestId, cancelled: false };
    this.pending.set(requestId, token);
    const onAbort = () => this.cancel(requestId);
    signal?.addEventListener('abort', onAbort, { once: true });
    const run = async () => {
      if (token.cancelled) throw abortError();
      this.active = token;
      try {
        await this.ensureLoaded(config, token);
        if (token.cancelled) throw abortError();
        this.update('translating');
        const result = await this.worker.request('translate', { text, source, target }, config.timeout * 1000);
        if (token.cancelled) throw abortError();
        if (!result || result.source !== 'zh' || result.target !== 'ja' || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 40000) throw Error('翻译服务未返回有效日文；不会朗读中文原文');
        this.metadata = { model: result.model, revision: result.revision, device: result.device };
        this.update('ready', { metadata: this.metadata });
        return { ...result, requestId };
      } catch (error) {
        if (token.cancelled) throw abortError();
        this.worker?.close(); this.worker = null; this.loadedConfig = '';
        this.update('error', { error: error.message }); throw error;
      } finally { if (this.active === token) this.active = null; }
    };
    const task = this.queue.then(run);
    this.queue = task.catch(() => {});
    return task.finally(() => { this.pending.delete(requestId); signal?.removeEventListener('abort', onAbort); });
  }
  cancel(requestId) {
    if (!requestId) {
      this.cancelInstall();
    }
    this.cancelRequests(requestId);
  }
  cancelInstall(){this.installJobs.cancel();}
  cancelRequests(requestId){
    for (const [id, token] of this.pending) if (!requestId || id === requestId) token.cancelled = true;
    if (!requestId || this.active?.requestId === requestId) {
      this.worker?.close(abortError()); this.worker = null; this.loadedConfig = '';
      this.update('paused');
    }
  }
  dispose() { this.disposed = true; this.cancel(); }
}
module.exports = { DEFAULTS, validateConfig, TranslationService };
