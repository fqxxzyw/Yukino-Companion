'use strict';

// Aqua is a small, verified overlay, NOT an independent dependency environment.
// Only the newly created venv is writable; inherited GPT-runtime dependencies
// are reused read-only. No torch package, model or upstream checkout is installed.
const fs = require('node:fs/promises');
const {renameSync} = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const AQUA_VERSION = '0.3.0';
const WHEEL_NAME = 'aqua_tts-0.3.0-py3-none-any.whl';
const WHEEL_URL = 'https://files.pythonhosted.org/packages/ee/ec/802e7cddaef8b22b085d29ae3e147d1537d273e4a1a545a1c931dff6cf31/aqua_tts-0.3.0-py3-none-any.whl';
const WHEEL_SHA256 = '9ca7e351b2bebfec59e4e75d276b842053adb88e8b4a6793393370da6102065a';
const MAX_WHEEL_BYTES = 1024 * 1024;
const OVERLAY_GUIDANCE = '这是 overlay 环境：只隔离 Aqua 包，复用所选基础 GPT 运行环境的依赖，不是完全独立环境。基础依赖缺失或冲突时，请选择依赖完整且兼容的 CPython，或自行准备完整独立的 Aqua Python 环境；本功能不会修改基础依赖、安装 PyTorch 或下载模型。';

// First prove pip will run in the new venv, not accidentally against the base.
const VENV_PROBE = String.raw`import json,os,platform,sys
expected=os.path.normcase(os.path.realpath(sys.argv[1]))
prefix=os.path.normcase(os.path.realpath(sys.prefix))
assert prefix==expected and sys.prefix!=sys.base_prefix, 'AQUA_NOT_VENV'
assert platform.python_implementation()=='CPython' and sys.version_info>=(3,10), 'AQUA_CPYTHON_REQUIRED'
settings={}
with open(os.path.join(sys.prefix,'pyvenv.cfg'),encoding='utf-8') as f:
 for line in f:
  if '=' in line:
   key,value=line.split('=',1)
   settings[key.strip()]=value.strip()
assert settings.get('include-system-site-packages','').lower()=='true', 'AQUA_NOT_OVERLAY'
print(json.dumps({'venv':True,'systemSitePackages':True,'pythonImplementation':'CPython','pythonVersion':platform.python_version()}))`;

// Do not import aquatts/TTSInferencer: no GPT upstream root has been selected.
// Successful imports are insufficient: CUDA must allocate, execute, synchronize
// and read back a real tensor. This still does NOT verify any model inference.
const ENVIRONMENT_PROBE = String.raw`import importlib.metadata as metadata,json,os,platform,sys
import torch,numpy,soundfile,librosa,peft
expected=os.path.normcase(os.path.realpath(sys.argv[1]))
assert os.path.normcase(os.path.realpath(sys.prefix))==expected and sys.prefix!=sys.base_prefix, 'AQUA_NOT_VENV'
version=metadata.version('aqua-tts')
assert version=='0.3.0', 'AQUA_VERSION_MISMATCH'
installed=os.path.normcase(os.path.realpath(str(metadata.distribution('aqua-tts').locate_file(''))))
assert os.path.commonpath([expected,installed])==expected, 'AQUA_NOT_LOCAL_OVERLAY'
assert torch.cuda.is_available(), 'AQUA_CUDA_UNAVAILABLE'
tensor=torch.ones(2,device='cuda:0')
value=(tensor+tensor).sum()
torch.cuda.synchronize('cuda:0')
assert bool(torch.isfinite(value).item()) and value.cpu().item()==4, 'AQUA_CUDA_KERNEL_FAILED'
del tensor,value
print(json.dumps({'aquaVersion':version,'aquaLocal':True,'pythonImplementation':platform.python_implementation(),'pythonVersion':platform.python_version(),'torch':str(torch.__version__),'cudaBuild':str(torch.version.cuda or ''),'cudaAvailable':True,'cudaKernel':True,'gpuName':torch.cuda.get_device_name(0),'dependencies':{name:metadata.version(name) for name in ('numpy','soundfile','librosa','peft')}}))`;

class AquaEnvironmentError extends Error {}
function failure(code, message) {
  const error = new AquaEnvironmentError(`[${code}] ${message}`);
  error.code = code;
  return error;
}
function cancelled() {
  const error = failure('AQUA_CANCELLED', 'Aqua 环境安装已取消；未完成目录保留，原有环境未替换。');
  error.name = 'AbortError';
  return error;
}
function validVersion(value) { return typeof value === 'string' && /^[0-9A-Za-z.+_-]{1,100}$/.test(value); }
function probeJson(result) {
  try { return JSON.parse(String(result?.stdout || '').trim().split(/\r?\n/).at(-1)); }
  catch { throw failure('AQUA_PROBE_FORMAT', '环境检查未返回有效结果。' + OVERLAY_GUIDANCE); }
}
function validatedMetadata(value) {
  if (!value || value.aquaVersion !== AQUA_VERSION || value.aquaLocal !== true ||
      value.pythonImplementation !== 'CPython' || !validVersion(value.pythonVersion) ||
      !validVersion(value.torch) || !validVersion(value.cudaBuild) ||
      value.cudaAvailable !== true || value.cudaKernel !== true ||
      !['numpy', 'soundfile', 'librosa', 'peft'].every(name => validVersion(value.dependencies?.[name]))) {
    throw failure('AQUA_ENVIRONMENT_INVALID', 'Aqua 版本、基础依赖或实际 CUDA 运算检查未通过。' + OVERLAY_GUIDANCE);
  }
  // Only allowlist probe fields. Never retain process output, URLs or errors.
  return {aquaVersion: AQUA_VERSION, aquaLocal: true, pythonImplementation: 'CPython', pythonVersion: value.pythonVersion,
    torch: value.torch, cudaBuild: value.cudaBuild, cudaAvailable: true, cudaKernel: true,
    gpuName: typeof value.gpuName === 'string' ? value.gpuName.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) : '',
    dependencies: Object.fromEntries(['numpy', 'soundfile', 'librosa', 'peft'].map(name => [name, value.dependencies[name]]))};
}
async function readJson(file) {
  if ((await fs.stat(file)).size > 64 * 1024) throw Error('oversized state');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

class AquaEnvironmentManager {
  constructor({dataRoot, run = promisify(execFile), fetcher = fetch, notify = () => {}}) {
    if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw Error('Aqua dataRoot 必须为当前安装的绝对路径');
    Object.assign(this, {run, fetcher, notify});
    this.root = path.join(dataRoot, 'aqua-runtime');
    this.phase = 'idle';
    this.error = null;
    this.progress = null;
    this.pending = null;
    this.controller = null;
    this.committed = false;
  }

  emit(phase, extra = {}) {
    this.phase = phase;
    this.error = extra.error || null;
    this.progress = extra.progress || null;
    try { this.notify({phase, error: this.error, progress: this.progress, isolation: 'overlay', modelInferenceVerified: false}); }
    catch { /* A closed renderer must not change installation ownership. */ }
  }

  async status() {
    const common = {phase: this.phase, error: this.error, progress: this.progress,
      isolation: 'overlay', guidance: OVERLAY_GUIDANCE, modelInferenceVerified: false};
    try {
      const pointer = await readJson(path.join(this.root, 'current.json'));
      if (pointer.schemaVersion !== 1 || !/^aqua-[0-9a-f-]{36}$/.test(pointer.directory)) throw Error('invalid state');
      const root = path.join(this.root, pointer.directory);
      const directory = await fs.lstat(root);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('invalid directory');
      const marker = await readJson(path.join(root, 'aqua-environment.json'));
      if (marker.schemaVersion !== 1 || marker.complete !== true || marker.isolation !== 'overlay' ||
          marker.wheelSha256 !== WHEEL_SHA256 || marker.engineVersion !== AQUA_VERSION ||
          typeof marker.basePython !== 'string' || !path.isAbsolute(marker.basePython)) throw Error('invalid marker');
      const python = path.join(root, 'environment', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!(await fs.stat(python)).isFile()) throw Error('missing interpreter');
      if (!(await fs.stat(marker.basePython)).isFile()) throw Error('missing base interpreter');
      const metadata = validatedMetadata(marker.metadata);
      return {...common, ready: true, verified: true, root, python, basePython: marker.basePython,
        engineVersion: AQUA_VERSION, verifiedAt: marker.verifiedAt, validation: 'environment-imports-and-cuda-kernel', metadata};
    } catch {
      return {...common, ready: false, verified: false, root: null, python: '', basePython: '', metadata: null,
        engineVersion: AQUA_VERSION, verifiedAt: null, validation: null};
    }
  }

  install(basePython, {proxy} = {}) {
    if (this.pending) return this.pending;
    this.controller = new AbortController();
    this.committed = false;
    const controller = this.controller;
    // Install is deliberately not async: all overlapping callers get the exact
    // same owned promise, and cancel cannot race an unassigned controller.
    this.pending = Promise.resolve().then(() => this.installTask(basePython, proxy, controller)).finally(() => {
      if (this.controller === controller) this.controller = null;
      this.pending = null;
    });
    return this.pending;
  }

  cancel() {
    if (!this.controller || this.committed) return false;
    this.controller.abort();
    return true;
  }

  async command(python, args, signal) {
    signal.throwIfAborted();
    // No child streams, pip output or raw errors are forwarded to the renderer.
    // Avoid bytecode writes into inherited, read-only base site-packages.
    const result = await this.run(python, ['-I', '-B', ...args], {signal, windowsHide: true, shell: false,
      cwd: this.root, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
      env: {...process.env, PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', ORT_DISABLE_TELEMETRY: '1'}});
    signal.throwIfAborted();
    return result;
  }

  async download(stage, signal) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    const response = await this.fetcher(WHEEL_URL, {signal: bounded, redirect: 'error', credentials: 'omit'});
    bounded.throwIfAborted();
    if (!response?.ok || !response.body) throw failure('AQUA_DOWNLOAD_FAILED', 'Aqua 官方 wheel 下载失败；请检查网络后重试。');
    const length = response.headers?.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_WHEEL_BYTES)) {
      await response.body.cancel?.().catch(() => {});
      throw failure('AQUA_WHEEL_TOO_LARGE', 'Aqua wheel 超过 1 MiB 限制，拒绝安装。');
    }
    const temporary = path.join(stage, WHEEL_NAME + '.part');
    const handle = await fs.open(temporary, 'wx');
    const hash = createHash('sha256');
    let received = 0;
    try {
      for await (const chunk of response.body) {
        bounded.throwIfAborted();
        const bytes = Buffer.from(chunk);
        received += bytes.length;
        if (received > MAX_WHEEL_BYTES) throw failure('AQUA_WHEEL_TOO_LARGE', 'Aqua wheel 超过 1 MiB 限制，拒绝安装。');
        hash.update(bytes);
        await handle.writeFile(bytes);
        this.emit('downloading', {progress: {received, total: length ? Number(length) : null, sourceLabel: 'PyPI Aqua-TTS 0.3.0'}});
      }
    } finally { await handle.close(); }
    bounded.throwIfAborted();
    if (!received || hash.digest('hex') !== WHEEL_SHA256) throw failure('AQUA_WHEEL_HASH', 'Aqua 官方 wheel SHA-256 校验失败，未执行 pip。');
    const wheel = path.join(stage, WHEEL_NAME);
    await fs.rename(temporary, wheel);
    signal.throwIfAborted();
    return wheel;
  }

  async installTask(basePython, proxy, controller) {
    const signal = controller.signal;
    let phase = 'preparing';
    this.emit(phase);
    try {
      signal.throwIfAborted();
      if (proxy !== undefined && proxy !== null && proxy !== '') {
        throw failure('AQUA_PROXY_UNSUPPORTED', '此安装器不支持单次代理参数；请通过应用网络配置使用系统代理，或手动准备独立 Aqua Python。代理地址不会记录。');
      }
      if (typeof basePython !== 'string' || !path.isAbsolute(basePython) || !(await fs.stat(basePython)).isFile()) {
        throw failure('AQUA_BASE_PYTHON', '请选择本机完整 CPython 的绝对路径；嵌入式 Python 可能不支持 venv。' + OVERLAY_GUIDANCE);
      }
      await fs.mkdir(this.root, {recursive: true});
      signal.throwIfAborted();
      const directory = 'aqua-' + randomUUID();
      const stage = path.join(this.root, directory);
      await fs.mkdir(stage); // Never reuse or delete a previous/user directory.
      const target = path.join(stage, 'environment');
      await fs.writeFile(path.join(stage, 'aqua-environment.json'), JSON.stringify({schemaVersion: 1, complete: false, isolation: 'overlay', modelInferenceVerified: false}));
      phase = 'creating'; this.emit(phase);
      await this.command(basePython, ['-m', 'venv', '--system-site-packages', target], signal);
      const python = path.join(target, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!(await fs.stat(python)).isFile()) throw failure('AQUA_VENV_MISSING', '未创建有效的 venv Python；请改用支持 venv/ensurepip 的完整 CPython。' + OVERLAY_GUIDANCE);
      phase = 'checking-overlay'; this.emit(phase);
      const venv = probeJson(await this.command(python, ['-c', VENV_PROBE, target], signal));
      if (venv.venv !== true || venv.systemSitePackages !== true || venv.pythonImplementation !== 'CPython' || !validVersion(venv.pythonVersion)) {
        throw failure('AQUA_VENV_INVALID', '目标不是经验证的 CPython overlay venv，拒绝执行 pip。' + OVERLAY_GUIDANCE);
      }
      phase = 'downloading'; this.emit(phase);
      const wheel = await this.download(stage, signal);
      phase = 'installing'; this.emit(phase);
      await this.command(python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-deps',
        '--no-index', '--no-cache-dir', '--no-input', '--only-binary=:all:', '--ignore-installed', wheel], signal);
      phase = 'checking-dependencies'; this.emit(phase);
      await this.command(python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'check'], signal);
      phase = 'probing'; this.emit(phase);
      const metadata = validatedMetadata(probeJson(await this.command(python, ['-c', ENVIRONMENT_PROBE, target], signal)));
      const verifiedAt = new Date().toISOString();
      phase = 'publishing'; this.emit(phase);
      await fs.writeFile(path.join(stage, 'aqua-environment.json'), JSON.stringify({schemaVersion: 1, complete: true,
        isolation: 'overlay', modelInferenceVerified: false, engineVersion: AQUA_VERSION,
        wheelSha256: WHEEL_SHA256, basePython, verifiedAt, metadata}));
      const temporaryPointer = path.join(this.root, 'current-' + randomUUID() + '.json.tmp');
      await fs.writeFile(temporaryPointer, JSON.stringify({schemaVersion: 1, directory}));
      signal.throwIfAborted();
      // This tiny atomic publication has no await gap where cancel could claim
      // success but a pending rename could subsequently replace current.json.
      renameSync(temporaryPointer, path.join(this.root, 'current.json'));
      this.committed = true;
      this.emit('ready');
      return await this.status();
    } catch (error) {
      let safe;
      if (signal.aborted) safe = cancelled();
      else if (error instanceof AquaEnvironmentError) safe = error;
      else {
        const messages = {
          preparing: ['AQUA_PREPARATION_FAILED', '无法读取基础 Python 或创建当前安装的 Aqua 目录。'],
          creating: ['AQUA_VENV_FAILED', '无法创建 overlay venv；嵌入式 Python 可能缺少 venv/ensurepip，请选择完整 CPython。'],
          'checking-overlay': ['AQUA_VENV_INVALID', '目标 venv 校验失败，未执行 pip。'],
          downloading: ['AQUA_DOWNLOAD_FAILED', '官方 Aqua wheel 下载未完成；请检查网络后重试。'],
          installing: ['AQUA_PIP_FAILED', '已校验 wheel 的本地安装失败。'],
          'checking-dependencies': ['AQUA_BASE_DEPENDENCIES', '基础环境存在缺失或冲突的依赖；没有修改基础依赖。'],
          probing: ['AQUA_PROBE_FAILED', '基础依赖导入、Aqua 元数据或实际 CUDA 运算检查失败。'],
          publishing: ['AQUA_PUBLISH_FAILED', '已验证环境的发布失败，原有选择未替换。'],
        };
        const [code, message] = messages[phase] || messages.preparing;
        safe = failure(code, message + OVERLAY_GUIDANCE);
      }
      this.emit(signal.aborted ? 'cancelled' : 'error', {error: safe.message});
      throw safe;
    }
    // Even incomplete stages are deliberately retained; no user directory is
    // recursively deleted, and every retry gets a fresh random directory.
  }
}

module.exports = {AquaEnvironmentManager, AQUA_VERSION, WHEEL_NAME, WHEEL_URL, WHEEL_SHA256,
  MAX_WHEEL_BYTES, OVERLAY_GUIDANCE, VENV_PROBE, ENVIRONMENT_PROBE};
