const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { speechCacheKey } = require('./speech-cache-key.cjs');
const {enginePlan}=require('./tts-engine.cjs');

const DEFAULTS = Object.freeze({ enabled: false, python: '', root: '', gpt: '', sovits: '', reference: '',
  bert: '', hubert: '', ffmpeg: '', promptText: '', promptLang: 'ja', textLang: 'all_ja', version: 'v1',
  device: 'auto', half: false, cpuFallback: true, cpuThreads: 4, speed: 1, volume: 0.8, timeout: 300,
  engine:'auto',aquaPython:'',aquaGraph:'lazy',aquaSovitsBase:'',aquaBigvgan:'',aquaSpeaker:'',aquaLangdetect:'',
  minSegmentChars:8,targetSegmentChars:35,maxSegmentChars:80,splitOnComma:'adaptive',mergeShortSegments:true,preservePunctuation:true,
  synthesisMode:'auto',maxConcurrentTasks:2,maxPendingSegments:12,maxPreparedSegments:4,maxBufferedAudioSeconds:20,failurePolicy:'abort' });

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('无效语音配置');
  const config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== typeof DEFAULTS[key]) throw Error(`无效语音设置：${key}`);
    config[key] = input[key];
  }
  for (const key of ['python', 'root', 'gpt', 'sovits', 'reference', 'bert', 'hubert', 'ffmpeg','aquaPython','aquaSovitsBase','aquaBigvgan','aquaSpeaker','aquaLangdetect']) {
    if (config[key] && (!path.isAbsolute(config[key]) || config[key].includes('\0') || config[key].length > 4096)) throw Error(`请使用本机绝对路径：${key}`);
  }
  if (!['auto', 'cpu', 'cuda'].includes(config.device)) throw Error('无效设备');
  for(const [key,values] of Object.entries({engine:['auto','aqua','standard'],aquaGraph:['lazy','off','minimal','full'],splitOnComma:['adaptive','never','always'],synthesisMode:['auto','serial','concurrent','batch'],failurePolicy:['abort','retry','skip']}))if(!values.includes(config[key]))throw Error('无效语音设置：'+key);
  for(const [key,min,max] of [['minSegmentChars',1,40],['targetSegmentChars',4,120],['maxSegmentChars',8,160],['maxConcurrentTasks',1,4],['maxPendingSegments',1,32],['maxPreparedSegments',1,8],['maxBufferedAudioSeconds',1,60]])if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw Error('无效语音队列或分句上限：'+key);
  if(config.minSegmentChars>config.targetSegmentChars||config.targetSegmentChars>config.maxSegmentChars)throw Error('分句长度需满足最小 ≤ 目标 ≤ 最大');
  if (!['v1', 'v2', 'v2Pro', 'v2ProPlus', 'v3', 'v4', 'v5dev', 'v5turbo'].includes(config.version)) throw Error('无效模型版本');
  const langs = ['zh', 'en', 'ja', 'auto', 'auto_yue', 'yue', 'ko', 'all_zh', 'all_ja', 'all_yue', 'all_ko'];
  if (!langs.includes(config.promptLang) || !langs.includes(config.textLang)) throw Error('无效语音语言');
  // Migrate earlier saved Chinese/auto settings. Display language never controls TTS.
  config.textLang = 'all_ja';
  for (const [key, min, max] of [['speed', 0.5, 2], ['volume', 0, 1], ['timeout', 30, 900], ['cpuThreads', 1, 32]]) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw Error(`语音设置 ${key} 超出范围`);
  }
  if (!Number.isInteger(config.cpuThreads) || config.promptText.length > 3000) throw Error('线程数或参考文本无效');
  return config;
}

class WorkerClient {
  constructor({ python, script, cwd, spawnImpl = spawn }) {
    this.pending = null; this.closed = false; this.tail = '';
    // The embedded Python ._pth enables isolation and ignores PYTHON* variables.
    // Keep UTF-8 explicit so Japanese JSONL works on every Windows locale.
    this.child = spawnImpl(python, ['-X', 'utf8', '-u', script], { cwd, windowsHide: true, shell: false,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ORT_DISABLE_TELEMETRY: '1',
        ...(cwd?{HF_HOME:path.join(cwd,'.cache','huggingface'),TORCH_HOME:path.join(cwd,'.cache','torch'),XDG_CACHE_HOME:path.join(cwd,'.cache'),TMP:cwd,TEMP:cwd}:{}) }, stdio: ['pipe', 'pipe', 'pipe'] });
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

const CONFIG_LABELS = Object.freeze({python:'语音运行环境',root:'语音推理组件',gpt:'GPT 音色权重',sovits:'SoVITS 音色权重',reference:'参考音频',bert:'BERT 公共模型',hubert:'HuBERT 公共模型',promptText:'参考音频对应文本'});
async function voiceReadiness(input) {
  const config=validateSettings(input), missing=[],plan=enginePlan(config);
  if(plan.blocked)missing.push({key:'engine',label:plan.reason,reason:'incompatible'});
  for (const key of ['python','root','gpt','sovits','reference','bert','hubert']) {
    const filename=key==='python'&&config.engine==='aqua'?config.aquaPython:config[key];
    if(!filename){missing.push({key,label:CONFIG_LABELS[key],reason:'not-selected'});continue;}
    try {
      const stat=await fs.stat(filename), directory=['root','bert','hubert'].includes(key);
      if(directory?!stat.isDirectory():!stat.isFile())throw Error('wrong-kind');
      const children=key==='root'?['GPT_SoVITS/TTS_infer_pack/TTS.py']:key==='bert'?['config.json','pytorch_model.bin','tokenizer.json']:key==='hubert'?['config.json','pytorch_model.bin','preprocessor_config.json']:[];
      for(const child of children){const part=await fs.stat(path.join(filename,child));if(!part.isFile()||part.size===0)throw Error('incomplete');}
    }catch{missing.push({key,label:CONFIG_LABELS[key],reason:'missing-file'});}
  }
  // GPT-SoVITS v1/v2 can use reference-free text conditioning; v3/v4/v5
  // vocoder models require the transcript as well as the reference audio.
  if(['v3','v4','v5dev','v5turbo'].includes(config.version)&&!config.promptText.trim())missing.push({key:'promptText',label:CONFIG_LABELS.promptText,reason:'not-selected'});
  return {configured:missing.length===0,needsSetup:missing.length>0,missing,enginePlan:plan,
    message:missing.length?'语音尚未准备好：'+missing.map(item=>item.label).join('、')+'。请打开“声音与语音”完成一键配置。':'语音资源已准备好，首次朗读时会自动加载。'};
}

class SpeechService {
  constructor({ script, stateDir, notify = () => {}, workerFactory = options => new WorkerClient(options), readinessChecker = voiceReadiness, cache = null, cacheKey = speechCacheKey }) {
    Object.assign(this, { script, stateDir, notify, workerFactory, readinessChecker, cache, cacheKey });
    this.worker = null; this.config = null; this.session = null; this.loading = null; this.epoch = 0;
    this.sessionGeneration = 0; this.synthesisTask = null;
    this.readinessState = {configured:false,needsSetup:true,missing:[],message:'尚未检查语音资源。'};
    this.status = { phase: 'unloaded', ...this.readinessState }; this.probes = new Set();
  }
  update(phase, extra = {}) { this.status = { phase, ...this.readinessState, ...extra }; this.notify(this.status); }
  configure(input) {
    const config=validateSettings(input),ignored=new Set(['enabled','volume']);
    if(!this.config||Object.keys(config).some(key=>!ignored.has(key)&&config[key]!==this.config[key]))this.unload();
    this.config=config;
    return config;
  }
  async readiness(input=this.config||DEFAULTS) {
    const result=await this.readinessChecker(input);
    this.readinessState=result;this.status={...this.status,...result};
    return this.status;
  }
  async prepare(input) {
    this.configure(input);
    const status=await this.readiness();
    if(!status.configured)throw Error(status.message);
    return this.ensureLoaded();
  }
  async makeWorker(config) {
    await fs.access(config.python); await fs.access(this.script);
    return this.workerFactory({ python: config.python, script: this.script, cwd: this.stateDir });
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
      if (!(key==='python'&&config.engine==='aqua'?config.aquaPython:config[key])) throw Error(`语音尚未准备好：${CONFIG_LABELS[key]}。请打开“声音与语音”完成一键配置。`);
    }
    this.unload(); this.config = config;
    return this.ensureLoaded();
  }
  async ensureLoaded() {
    if (this.loading) return this.loading;
    if (this.worker && !this.worker.closed) return this.status;
    if (!this.config) throw Error('语音尚未准备好。请打开“声音与语音”完成一键配置。');
    const epoch = this.epoch, config = this.config;
    this.update('loading');
    const promise = (async () => {
      const ready=await this.readinessChecker(config);
      if(epoch!==this.epoch)throw Error('加载已取消');
      this.readinessState=ready;
      if(!ready.configured)throw Error(ready.message);
      await fs.mkdir(this.stateDir, { recursive: true });
      const plan=enginePlan(config);if(plan.blocked)throw Error(plan.reason);
      const loadingStarted=Date.now();let selected=plan.engine,fallbackReason=plan.reason,metadata;
      for(let attempt=0;attempt<2;attempt++){
        let client;
        try{client=await this.makeWorker({...config,python:selected==='aqua'?config.aquaPython:config.python});
          if(epoch!==this.epoch){client.close();throw Error('加载已取消');}this.worker=client;
          metadata=await client.request('load',{config:{...config,engine:selected,stateDir:this.stateDir}},config.timeout*1000);break;}
        catch(error){client?.close();if(this.worker===client)this.worker=null;if(epoch!==this.epoch)throw Error('加载已取消');
          if(selected!=='aqua'||config.engine!=='auto')throw error;
          fallbackReason='Aqua 初始化失败：'+String(error.message).slice(0,800);selected='standard';
          this.update('loading',{requestedEngine:config.engine,actualEngine:'standard',fallbackReason});
        }
      }
      if (epoch !== this.epoch) throw Error('加载已取消');
      metadata={...metadata,engine:selected,requestedEngine:config.engine,engineFallbackReason:fallbackReason||null,loadMs:Date.now()-loadingStarted,capabilities:{maxConcurrentTasks:1,nativeBatch:selected==='standard',audioStreaming:false,...metadata?.capabilities}};
      this.update('ready', { metadata,actualEngine:selected,requestedEngine:config.engine,fallbackReason:fallbackReason||null }); return this.status;
    })();
    this.loading = promise;
    try { return await promise; }
    catch (e) { if (epoch === this.epoch) { this.worker?.close(); this.worker = null; this.update('error', { error: e.message }); } throw e; }
    finally { if (this.loading === promise) this.loading = null; }
  }
  begin(id) {
    if (typeof id !== 'string' || !id || id.length > 128) throw Error('无效语音会话');
    if (this.session && this.session !== id) this.stop(this.session);
    this.session = id; this.sessionGeneration++;
  }
  synthesize(id, text) { return this.synthesizeGroup(id, [text]); }
  synthesizeBatch(id, texts) { return this.synthesizeGroup(id, texts); }
  async synthesizeGroup(id, texts) {
    if (!id || this.session !== id) throw Error('语音会话已过期');
    if (!Array.isArray(texts) || !texts.length || texts.length > 3 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 500) || texts.join('\n').length > 500) throw Error('无效语音片段；每组最多三句、合计 500 字符');
    texts.forEach(assertJapaneseSpeech);
    // One model owner, one bounded batch. Never run concurrent requests against
    // the upstream mutable pipeline or let a rejected extra call kill its owner.
    if (this.synthesisTask) throw Error('语音推理忙，请等待当前任务完成');
    const task = {}, epoch = this.epoch, generation = this.sessionGeneration;
    this.synthesisTask = task;
    const current = () => this.session === id && this.sessionGeneration === generation && this.epoch === epoch;
    const check = () => { if (!current()) throw Error('语音会话已过期'); };
    let key = null;
    const synthesisStarted = Date.now();
    try {
      const plan=enginePlan(this.config||DEFAULTS);
      if(plan.engine==='aqua'){await this.ensureLoaded();check();}
      if (this.cache?.enabled && this.config) {
        const actual=this.status.metadata?.engine||plan.engine;
        const cacheConfig={...this.config,engine:actual,engineVersion:this.status.metadata?.engineVersion||'',python:actual==='aqua'?this.config.aquaPython:this.config.python};
        try { key = await this.cacheKey(cacheConfig, texts, this.script); } catch {}
        check();
        if (key) {
          let cached; try { cached = await this.cache.read(key); } catch {}
          check();
          if (cached) {
            this.update('ready', { metadata: { ...this.status.metadata, sessionId:id, batchSentences:texts.length, cacheHit:true, synthesisMs:Date.now()-synthesisStarted } });
            return cached;
          }
        }
      }
      await this.ensureLoaded(); check();
      this.update('synthesizing', { metadata: this.status.metadata });
      const data = texts.length === 1 ? {text:texts[0],speed:this.config.speed} : {texts,speed:this.config.speed};
      const result = await this.worker.request(texts.length === 1 ? 'synthesize' : 'synthesize_batch', data, this.config.timeout * 1000);
      check();
      if (typeof result.audio !== 'string' || result.audio.length > 17 * 1024 * 1024) throw Error('音频数据超过限制');
      const audio = Buffer.from(result.audio, 'base64');
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw Error('推理未返回有效 WAV');
      if (key && this.cache?.enabled) { try { await this.cache.write(key, audio); } catch {} check(); }
      this.update('ready', { metadata: {...this.status.metadata,...result.metadata,sessionId:id,batchSentences:texts.length,cacheHit:false,synthesisMs:Date.now()-synthesisStarted} });
      return audio;
    } catch (e) {
      if (current()) { this.worker?.close(); this.worker = null; this.update('error', { error:e.message }); }
      throw e;
    } finally { if (this.synthesisTask === task) this.synthesisTask = null; }
  }
  stop(id) {
    if (id && this.session !== id) return;
    this.session = null; this.sessionGeneration++; this.synthesisTask = null;
    // Termination guarantees cancellation of kernels; next utterance reloads.
    if (this.loading || this.worker?.pending) {
      this.epoch++; this.worker?.close(); this.worker = null; this.loading = null;
      this.update('paused', { message: '推理已中止，下次朗读会重新加载模型' });
    }
  }
  unload() {
    this.epoch++; this.sessionGeneration++; this.synthesisTask = null; this.session = null; this.config = null; this.loading = null;
    this.worker?.close(); this.worker = null; this.update('unloaded');
  }
  dispose() { this.unload(); for (const probe of this.probes) probe.close(); this.probes.clear(); }
}

function assertJapaneseSpeech(text) {
  // Conservative last boundary: never read a Chinese fallback as Japanese.
  // Kanji-only fragments must be joined to their translated Japanese sentence.
  if (typeof text !== 'string' || !/[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/u.test(text)) {
    throw Error('语音仅接受日语译文；请等待翻译完成，或使用包含假名的完整日语句子。');
  }
}
module.exports = { DEFAULTS, CONFIG_LABELS, validateSettings, voiceReadiness, assertJapaneseSpeech, WorkerClient, SpeechService };
