const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({ enabled: false, python: '', root: '', gpt: '', sovits: '', reference: '',
  bert: '', hubert: '', ffmpeg: '', promptText: '', promptLang: 'zh', textLang: 'zh', version: 'v2',
  device: 'auto', half: false, cpuFallback: true, cpuThreads: 4, speed: 1, volume: 0.8, timeout: 300 });

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('无效语音配置');
  const config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== typeof DEFAULTS[key]) throw Error(`无效语音设置：${key}`);
    config[key] = input[key];
  }
  for (const key of ['python', 'root', 'gpt', 'sovits', 'reference', 'bert', 'hubert', 'ffmpeg']) {
    if (config[key] && (!path.isAbsolute(config[key]) || config[key].includes('\0') || config[key].length > 4096)) throw Error(`请使用本机绝对路径：${key}`);
  }
  if (!['auto', 'cpu', 'cuda'].includes(config.device)) throw Error('无效设备');
  if (!['v1', 'v2', 'v2Pro', 'v2ProPlus', 'v3', 'v4', 'v5dev', 'v5turbo'].includes(config.version)) throw Error('无效模型版本');
  const langs = ['zh', 'en', 'ja', 'auto', 'auto_yue', 'yue', 'ko', 'all_zh', 'all_ja', 'all_yue', 'all_ko'];
  if (!langs.includes(config.promptLang) || !langs.includes(config.textLang)) throw Error('无效语音语言');
  for (const [key, min, max] of [['speed', 0.5, 2], ['volume', 0, 1], ['timeout', 30, 900], ['cpuThreads', 1, 32]]) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw Error(`语音设置 ${key} 超出范围`);
  }
  if (!Number.isInteger(config.cpuThreads) || config.promptText.length > 3000) throw Error('线程数或参考文本无效');
  return config;
}

class WorkerClient {
  constructor({ python, script, cwd, spawnImpl = spawn }) {
    this.pending = null; this.closed = false; this.tail = '';
    this.child = spawnImpl(python, ['-u', script], { cwd, windowsHide: true, shell: false,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 18 * 1024 * 1024) return this.close(Error('推理输出超过限制'));
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        try {
          const response = JSON.parse(line);
          if (this.pending && response.id === this.pending.id) {
            const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
            response.ok ? pending.resolve(response.result) : pending.reject(Error(response.error || '语音推理失败'));
          }
        } catch { this.close(Error('推理进程返回无效协议数据')); }
      }
    });
    // Bounded in-memory diagnostics; do not persist conversation or audio.
    this.child.stderr.on('data', chunk => { this.tail = (this.tail + chunk.toString()).slice(-2000); });
    this.child.stdin.on('error', e => this.close(Error(`推理输入管道关闭：${e.message}`)));
    this.child.on('error', e => this.close(Error(`无法启动 Python：${e.message}`)));
    this.child.on('exit', (code, signal) => this.close(Error(`推理进程退出 (${code ?? signal})。${this.tail}`)));
  }
  request(method, data = {}, timeout = 300000) {
    if (this.closed) return Promise.reject(Error('推理进程已结束，请重新加载'));
    if (this.pending) return Promise.reject(Error('语音推理忙，请等待当前任务完成'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.close(Error('语音操作超时；CPU 推理可在设置中延长超时后重试')), timeout);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ id, method, ...data }) + '\n');
    });
  }
  close(reason = Error('语音已停止')) {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(reason); this.pending = null; }
    this.child.stdin.destroy();
    // Only the exact process spawned here is terminated, never all Python tasks.
    this.child.kill();
  }
}

class SpeechService {
  constructor({ script, stateDir, notify = () => {}, workerFactory = options => new WorkerClient(options) }) {
    Object.assign(this, { script, stateDir, notify, workerFactory });
    this.worker = null; this.config = null; this.session = null; this.loading = null; this.epoch = 0;
    this.status = { phase: 'unloaded' }; this.probes = new Set();
  }
  update(phase, extra = {}) { this.status = { phase, ...extra }; this.notify(this.status); }
  async makeWorker(config) {
    await fs.access(config.python); await fs.access(this.script);
    return this.workerFactory({ python: config.python, script: this.script, cwd: config.root || this.stateDir });
  }
  async probe(input) {
    const epoch = this.epoch;
    const config = validateSettings(input);
    if (!config.python) throw Error('请先选择用于推理的 Python 可执行文件');
    await fs.mkdir(this.stateDir, { recursive: true });
    const client = await this.makeWorker({ ...config, root: '' });
    if (epoch !== this.epoch) { client.close(); throw Error('设备检测已取消'); }
    this.probes.add(client);
    try { return await client.request('probe', {}, 60000); }
    finally { client.close(); this.probes.delete(client); }
  }
  async load(input) {
    const config = validateSettings(input);
    for (const key of ['python', 'root', 'gpt', 'sovits', 'reference', 'bert', 'hubert']) {
      if (!config[key]) throw Error(`请先选择 ${key}`);
    }
    this.unload(); this.config = config;
    return this.ensureLoaded();
  }
  async ensureLoaded() {
    if (this.loading) return this.loading;
    if (this.worker && !this.worker.closed) return this.status;
    if (!this.config) throw Error('请先配置并加载语音模型');
    const epoch = this.epoch, config = this.config;
    this.update('loading');
    const promise = (async () => {
      await fs.mkdir(this.stateDir, { recursive: true });
      const client = await this.makeWorker(config);
      if (epoch !== this.epoch) { client.close(); throw Error('加载已取消'); }
      this.worker = client;
      const metadata = await client.request('load', { config: { ...config, stateDir: this.stateDir } }, config.timeout * 1000);
      if (epoch !== this.epoch) throw Error('加载已取消');
      this.update('ready', { metadata }); return this.status;
    })();
    this.loading = promise;
    try { return await promise; }
    catch (e) { if (epoch === this.epoch) { this.worker?.close(); this.worker = null; this.update('error', { error: e.message }); } throw e; }
    finally { if (this.loading === promise) this.loading = null; }
  }
  begin(id) {
    if (typeof id !== 'string' || !id || id.length > 128) throw Error('无效语音会话');
    if (this.session && this.session !== id) this.stop(this.session);
    this.session = id;
  }
  async synthesize(id, text) {
    if (!id || this.session !== id) throw Error('语音会话已过期');
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw Error('无效语音片段');
    await this.ensureLoaded();
    if (this.session !== id) throw Error('语音会话已过期');
    this.update('synthesizing', { metadata: this.status.metadata });
    try {
      const result = await this.worker.request('synthesize', { text, speed: this.config.speed }, this.config.timeout * 1000);
      if (this.session !== id) throw Error('语音会话已过期');
      if (typeof result.audio !== 'string' || result.audio.length > 17 * 1024 * 1024) throw Error('音频数据超过限制');
      const audio = Buffer.from(result.audio, 'base64');
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw Error('推理未返回有效 WAV');
      this.update('ready', { metadata: result.metadata }); return audio;
    } catch (e) { if (this.session === id) { this.worker?.close(); this.worker = null; this.update('error', { error: e.message }); } throw e; }
  }
  stop(id) {
    if (id && this.session !== id) return;
    this.session = null;
    // Termination guarantees cancellation of kernels; next utterance reloads.
    if (this.loading || this.worker?.pending) {
      this.epoch++; this.worker?.close(); this.worker = null; this.loading = null;
      this.update('paused', { message: '推理已中止，下次朗读会重新加载模型' });
    }
  }
  unload() {
    this.epoch++; this.session = null; this.config = null; this.loading = null;
    this.worker?.close(); this.worker = null; this.update('unloaded');
  }
  dispose() { this.unload(); for (const probe of this.probes) probe.close(); this.probes.clear(); }
}

module.exports = { DEFAULTS, validateSettings, WorkerClient, SpeechService };
