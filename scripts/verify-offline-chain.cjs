#!/usr/bin/env node
// Connect real production services using the actual generated reply. This CLI
// neither downloads resources nor simulates model output or audio playback.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');
const { LocalChatService } = require('../electron/local-chat.cjs');
const { TranslationService } = require('../electron/translation.cjs');
const { SpeechService, WorkerClient } = require('../electron/speech.cjs');
const { preparePersonaChat } = require('../electron/persona.cjs');
const { completeBilingual } = require('../electron/bilingual.cjs');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM_REVISION = 'b4570b876f5c086819ba84e3215472733c6a7b70';
const PATH_OPTIONS = ['python', 'model', 'translation', 'engine', 'voice', 'core', 'ffmpeg', 'output'];
const SOURCE_FILES = [
  'scripts/verify-offline-chain.cjs', 'scripts/run-without-network.py', 'electron/local-chat.cjs', 'electron/translation.cjs', 'electron/speech.cjs',
  'model-service/desktop_worker.py', 'translation/worker.py', 'inference/worker.py',
  'electron/persona.cjs', 'electron/bilingual.cjs', 'src/speech/text.mjs', 'electron/voice-resources.cjs',
  'characters/yukino/manifest.json', 'characters/yukino/CHARACTER.md', 'characters/yukino/compact.md',
  'characters/yukino/runtime.md', 'characters/yukino/training.md', 'package.json', 'package-lock.json',
  'resources/resource-packs.json', 'resources/local-model/yukino-1.5b-persona-q4/manifest.json',
  'translation/model-manifest.json', 'resources/voice-models.json', 'resources/voice-presets/yukino-default.json',
];
const HELP = `Verify real local generation → translation → trained voice synthesis.
Required: ${PATH_OPTIONS.map(key => '--' + key + ' PATH').join(' ')}
Optional: --model-archive PATH, --prompt TEXT (repeatable), --threads 4,
          --timeout 600, --deadline 3600, --max-tokens 96, --device cpu|cuda,
          --prewarm-voice true|false
Supply --model-archive when using the pinned Release quantization instead of
the source example. Resources must already exist. The prepared engine must
contain yukino-runtime.json. --output must be a new directory.
Defaults: two short prompts; one resident TTS process. New WAV evidence does
not establish audio-device playback, mouth/body synchronization or Windows QA.
`;

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { threads: 4, timeout: 600, deadline: 3600, 'max-tokens': 96, device: 'cpu', 'prewarm-voice': 'false', prompts: [] };
  const known = new Set([...PATH_OPTIONS, 'model-archive', 'prompt', 'threads', 'timeout', 'deadline', 'max-tokens', 'device', 'prewarm-voice']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.slice(2), value = args[index + 1];
    if (!args[index]?.startsWith('--') || !known.has(name) || value === undefined || value.startsWith('--')) throw Error('Expected known --name value pairs; use --help');
    if (name !== 'prompt' && seen.has(name)) throw Error('Duplicate option: --' + name);
    seen.add(name);
    if (name === 'prompt') {
      if (!value.trim() || value.length > 2000 || options.prompts.length >= 8) throw Error('Use 1–8 prompts, each at most 2000 characters');
      options.prompts.push(value);
    } else options[name] = value;
  }
  for (const key of PATH_OPTIONS) {
    if (!options[key] || options[key].includes('\0')) throw Error('Missing or invalid --' + key);
    options[key] = path.resolve(options[key]);
  }
  if (options['model-archive']) options['model-archive'] = path.resolve(options['model-archive']);
  for (const [key, minimum, maximum] of [['threads', 1, 32], ['timeout', 30, 900], ['deadline', 30, 14400], ['max-tokens', 32, 1024]]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < minimum || options[key] > maximum) throw Error(`--${key} must be an integer in ${minimum}–${maximum}`);
  }
  if (!['cpu', 'cuda'].includes(options.device)) throw Error('--device must be cpu or cuda; automatic fallback is not used');
  if (!['true','false'].includes(options['prewarm-voice'])) throw Error('--prewarm-voice must be true or false');
  options['prewarm-voice'] = options['prewarm-voice'] === 'true';
  if (!options.prompts.length) options.prompts = ['今天我有一点累，请用两句很短的话回应我。', '我准备休息一会儿，请用两句很短的话回应我。'];
  return options;
}

function contained(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe manifest resource path');
  return path.join(root, relative);
}

async function hashFile(filename, algorithm = 'sha256', signal) {
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw Error('Expected regular resource file: ' + filename);
  const hash = crypto.createHash(algorithm);
  if (algorithm === 'sha1') hash.update(`blob ${stat.size}\0`);
  for await (const chunk of createReadStream(filename)) { signal?.throwIfAborted(); hash.update(chunk); }
  return { bytes: stat.size, algorithm, digest: hash.digest('hex') };
}

async function verifyFile(filename, expected, signal) {
  const size = expected.bytes ?? expected.size, algorithm = expected.algorithm || 'sha256', digest = expected.digest || expected.sha256;
  // Prepared source manifests may legitimately pin empty package markers.
  // Their digest is still mandatory; model/audio sizes remain pinned by catalog.
  if (!Number.isSafeInteger(size) || size < 0 || !['sha256', 'sha1'].includes(algorithm) || !new RegExp(`^[a-f0-9]{${algorithm === 'sha256' ? 64 : 40}}$`).test(digest || '')) throw Error('Invalid pinned resource metadata: ' + filename);
  const actual = await hashFile(filename, algorithm, signal);
  if (actual.bytes !== size || actual.digest !== digest) throw Error('Resource checksum mismatch: ' + filename);
  return { path: filename, ...actual };
}

const readJson = async filename => JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));

function readArchiveManifest(filename) {
  return new Promise((resolve, reject) => {
    require('yauzl').open(filename, { lazyEntries: true, autoClose: true }, (error, archive) => {
      if (error) { reject(error); return; }
      let manifest, settled = false;
      const fail = error => { if (!settled) { settled = true; archive.close(); reject(error); } };
      archive.on('error', fail);
      archive.on('entry', entry => {
        if (!/(^|\/)manifest\.json$/.test(entry.fileName)) { archive.readEntry(); return; }
        if (manifest || entry.uncompressedSize > 1024 * 1024) { fail(Error('Invalid or duplicate archived model manifest')); return; }
        archive.openReadStream(entry, (error, stream) => {
          if (error) { fail(error); return; }
          const chunks = []; let length = 0;
          stream.on('error', fail);
          stream.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) { stream.destroy(); fail(Error('Archived model manifest is too large')); } else chunks.push(chunk); });
          stream.on('end', () => {
            try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); archive.readEntry(); } catch (error) { fail(error); }
          });
        });
      });
      archive.on('end', () => { if (!settled) { settled = true; manifest ? resolve(manifest) : reject(Error('Missing archived model manifest')); } });
      archive.readEntry();
    });
  });
}

async function verifyChatModel({ modelDir, modelArchive, sourceExample, archiveSpec, signal }) {
  const actual = await readJson(path.join(modelDir, 'manifest.json'));
  const differingFields = Object.keys({ ...sourceExample, ...actual }).filter(key => !isDeepStrictEqual(sourceExample[key], actual[key]));
  const records = []; let verifiedArchive = null;
  if (differingFields.length) {
    if (!modelArchive) throw Error('Downloaded model manifest differs from the source example; supply --model-archive for pinned Release verification');
    records.push(await verifyFile(modelArchive, archiveSpec, signal));
    if (!isDeepStrictEqual(await readArchiveManifest(modelArchive), actual)) throw Error('Installed model manifest differs from the verified Release archive');
    for (const key of ['baseModel', 'baseRevision']) if (actual[key] !== sourceExample[key]) throw Error('Release model training base differs: ' + key);
    if (actual.training?.completed !== true || actual.training?.adapterSha256 !== sourceExample.training?.adapterSha256) throw Error('Release model training adapter identity differs');
    verifiedArchive = { path: modelArchive, ...archiveSpec };
  }
  records.push(await verifyFile(contained(modelDir, actual.file), actual, signal));
  return { records, sourceExample, actual, differingFields, verifiedArchive,
    sourceExampleBinaryVerified: ['file', 'bytes', 'sha256'].every(key => actual[key] === sourceExample[key]) };
}

async function verifyResources(options, signal) {
  const records = [], add = async (filename, item) => { signal.throwIfAborted(); records.push(await verifyFile(filename, item, signal)); };
  const sourceExample = await readJson(path.join(ROOT, 'resources/local-model/yukino-1.5b-persona-q4/manifest.json'));
  const archiveSpec = (await readJson(path.join(ROOT, 'resources/resource-packs.json'))).packs.chat;
  const modelProvenance = await verifyChatModel({ modelDir: options.model, modelArchive: options['model-archive'], sourceExample, archiveSpec, signal });
  records.push(...modelProvenance.records); delete modelProvenance.records;
  const translation = await readJson(path.join(ROOT, 'translation/model-manifest.json'));
  for (const file of translation.files) await add(contained(options.translation, file.path), file);
  const voiceCatalog = await readJson(path.join(ROOT, 'resources/voice-models.json'));
  const expectedPreset = await readJson(path.join(ROOT, 'resources/voice-presets/yukino-default.json'));
  const preset = await readJson(path.join(options.voice, 'preset.json'));
  for (const key of ['id', 'packId', 'version', 'promptLang', 'promptText']) if (preset[key] !== expectedPreset[key]) throw Error('Voice preset differs from the pinned default: ' + key);
  const expectedFiles = voiceCatalog.packs[expectedPreset.packId].files.map(file => file.extract ? { kind: 'sovits', ...file.extract } : { kind: 'gpt', ...file });
  expectedFiles.push({ kind: 'reference', ...expectedPreset.reference });
  if (!Array.isArray(preset.files) || preset.files.length !== expectedFiles.length) throw Error('Voice preset file list is incomplete');
  const voicePaths = {};
  for (const file of expectedFiles) {
    const matches = preset.files.filter(item => item.kind === file.kind);
    if (matches.length !== 1 || matches[0].path !== file.path || matches[0].bytes !== file.bytes || matches[0].sha256 !== (file.digest || file.sha256)) throw Error('Voice preset resource metadata differs: ' + file.kind);
    voicePaths[file.kind] = contained(options.voice, file.path); await add(voicePaths[file.kind], file);
  }
  for (const file of voiceCatalog.packs.core.files) await add(contained(options.core, file.path), file);
  const engine = await readJson(path.join(options.engine, 'yukino-runtime.json'));
  if (engine.revision !== UPSTREAM_REVISION || engine.kind !== 'inference-source-only' || !Array.isArray(engine.files) || !engine.files.length) throw Error('Expected the prepared fixed GPT-SoVITS inference source');
  for (const file of engine.files) await add(contained(options.engine, file.path), file);
  await fs.access(contained(options.engine, 'GPT_SoVITS/TTS_infer_pack/TTS.py'));
  for (const executable of [options.python, options.ffmpeg]) if (!(await fs.stat(executable)).isFile()) throw Error('Missing executable: ' + executable);
  signal.throwIfAborted();
  return { records, modelProvenance, translation, preset, voicePaths, engineRevision: engine.revision, coreRevision: voiceCatalog.revision };
}

function inspectWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw Error('Invalid WAV container length');
  let format, pcm, offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) throw Error('Truncated WAV chunk');
    if (name === 'fmt ') {
      if (format || length < 16) throw Error('Invalid WAV format chunk');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    }
    if (name === 'data') { if (pcm) throw Error('Duplicate PCM data'); pcm = bytes.subarray(start, start + length); }
    offset = start + length + (length % 2);
  }
  if (offset !== bytes.length || !format || !pcm || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16 || format.blockAlign !== 2 || format.byteRate !== format.sampleRate * 2 || format.sampleRate < 8000 || format.sampleRate > 192000 || pcm.length % 2) throw Error('Expected complete mono PCM16 WAV');
  const frames = pcm.length / 2, durationSeconds = frames / format.sampleRate;
  let sum = 0, peak = 0;
  for (let index = 0; index < pcm.length; index += 2) { const sample = pcm.readInt16LE(index) / 32768; sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  const rms = Math.sqrt(sum / Math.max(1, frames));
  if (durationSeconds < 0.15 || durationSeconds > 120 || rms < 0.0001) throw Error('Synthesized WAV is silent, empty or outside duration bounds');
  return { sampleRate: format.sampleRate, frames, durationSeconds, rms, peak, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function closeWorkers(workers) {
  const exited = child => child.exitCode !== null || child.signalCode !== null;
  return Promise.all([...workers].map(async worker => {
    worker.close();
    if (!exited(worker.child)) await new Promise((resolve, reject) => {
      let escalation, deadline;
      const done = error => { clearTimeout(escalation); clearTimeout(deadline); worker.child.removeListener('close', closed); error ? reject(error) : resolve(); };
      const closed = () => done(); worker.child.once('close', closed);
      escalation = setTimeout(() => { worker.child.kill('SIGKILL'); }, 5000);
      deadline = setTimeout(() => done(Error('Owned inference process did not exit after cleanup: ' + worker.child.pid)), 10000);
      if (exited(worker.child)) done();
    });
    return { pid: worker.child.pid, exited: exited(worker.child), exitCode: worker.child.exitCode, signal: worker.child.signalCode };
  }));
}

async function run(options) {
  // Keep failed attempts intact; never overwrite prior evidence.
  await fs.mkdir(path.dirname(options.output), { recursive: true }); await fs.mkdir(options.output);
  const reportPath = path.join(options.output, 'report.json');
  const started = performance.now(), seconds = () => Number(((performance.now() - started) / 1000).toFixed(3));
  const report = { schemaVersion: 1, test: 'production-local-generation-translation-trained-voice', startedAt: new Date().toISOString(), passed: false, completed: false,
    verification: { newlyGeneratedText: false, sameReplyTranslated: false, newTrainedVoiceWav: false, audioDevicePlayback: false, rendererMotionSync: false, windowsAcceptance: false, subjectiveListening: false, performanceAcceptance: false },
    deviceRequested: options.device, configuration: options, resources: [], events: [], turns: [],
    executionSource: { files: [], pid: process.pid, node: process.version, platform: process.platform, arch: process.arch, note: 'Hashes of the files used for this execution, not a later commit claim; source must remain unchanged during the run. PID can be matched to a separate exec-inherited network guard report; this runner does not itself install that guard.' },
    networkPolicy: { apiTransportUsed: false, explicitResourceDownloads: false, huggingFaceOfflineFlags: true, processNetworkSandbox: false, dictionariesPreflight: 'Dictionary installation/readiness is an external environment prerequisite; HF flags do not block all dependency networking.' },
    limitation: 'Real service inference and new PCM evidence only. No audio-device playback, WebAudio clock, visible mouth/body motion or perceptual acceptance. Synthesis timings are not measured first sound or inter-sentence playback gaps.' };
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const controller = new AbortController(), workers = new Set(), services = []; let failure = null;
  const cancel = reason => { if (!controller.signal.aborted) controller.abort(reason); for (const service of services) service.dispose(); };
  const interrupted = () => cancel(Error('Verification interrupted'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const deadline = setTimeout(() => cancel(Error('Overall verification deadline exceeded')), options.deadline * 1000);
  const factory = value => { controller.signal.throwIfAborted(); const worker = new WorkerClient(value); workers.add(worker); return worker; };
  const notify = service => state => { const event = { service, phase: state.phase, elapsedSeconds: seconds() }; report.events.push(event); console.log(JSON.stringify(event)); };
  const offlineKeys = ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_DATASETS_OFFLINE'];
  const priorEnvironment = Object.fromEntries(offlineKeys.map(key => [key, process.env[key]]));
  for (const key of offlineKeys) process.env[key] = '1';
  try {
    await save();
    for (const relative of SOURCE_FILES) {
      const source = await hashFile(path.join(ROOT, relative), 'sha256', controller.signal);
      report.executionSource.files.push({ path: relative, bytes: source.bytes, sha256: source.digest });
    }
    await save(); const resources = await verifyResources(options, controller.signal);
    Object.assign(report, { resources: resources.records, resourceVerificationSeconds: seconds(), engineRevision: resources.engineRevision, coreRevision: resources.coreRevision, modelProvenance: resources.modelProvenance }); await save();
    const local = new LocalChatService({ script: path.join(ROOT, 'model-service/desktop_worker.py'), stateDir: path.join(options.output, 'state/chat'), modelDir: options.model, python: options.python, workerFactory: factory, notify: notify('chat') });
    const translation = new TranslationService({ script: path.join(ROOT, 'translation/worker.py'), stateDir: path.join(options.output, 'state/translation'), modelDir: options.translation, python: options.python, workerFactory: factory, fetcher: () => { throw Error('Downloads are disabled during chain verification'); }, notify: notify('translation') });
    const speech = new SpeechService({ script: path.join(ROOT, 'inference/worker.py'), stateDir: path.join(options.output, 'state/voice'), workerFactory: factory, notify: notify('speech') });
    services.push(local, translation, speech);
    const shared = { device: options.device, cpuThreads: options.threads, cpuFallback: false, timeout: options.timeout };
    local.configure({ ...shared, maxNewTokens: options['max-tokens'], temperature: 0 }); translation.configure(shared);
    speech.configure({ ...shared, python: options.python, root: options.engine, ffmpeg: options.ffmpeg, ...resources.voicePaths,
      bert: path.join(options.core, 'chinese-roberta-wwm-ext-large'), hubert: path.join(options.core, 'chinese-hubert-base'),
      promptText: resources.preset.promptText, promptLang: resources.preset.promptLang, textLang: 'all_ja', version: resources.preset.version, half: false, speed: 1 });
    const { JapaneseSentenceStream } = await import('../src/speech/text.mjs');
    for (const [index, prompt] of options.prompts.entries()) {
      controller.signal.throwIfAborted(); const id = `chain-${index + 1}`, turnStarted = performance.now();
      const turn = { id, prompt, completed: false, segments: [] }; report.turns.push(turn);
      const previousWorker = speech.worker;
      // Compare the same real services with voice loading overlapping response
      // generation. The output still does not prove speaker playback.
      const warmStart=performance.now();
      const warming=options['prewarm-voice']?speech.ensureLoaded().then(value=>({value,seconds:Number(((performance.now()-warmStart)/1000).toFixed(3))}),error=>({error})):null;
      const prepared = preparePersonaChat({}, { model: 'oregairu-small', base: 'http://127.0.0.1' }, [{ role: 'user', content: prompt }]);
      prepared.messages[0].content += '\n\n请用简体中文自然回答。不要自行附加其他语言翻译。'; turn.effectiveMessages = prepared.messages;
      let chunk = '', stage = performance.now();
      const generated = await local.generate(prepared.messages, { requestId: id, signal: controller.signal, onChunk: text => { chunk += text; } });
      if (chunk !== generated.text) throw Error('Production generation chunk/final mismatch');
      turn.generation = { ...generated, seconds: Number(((performance.now() - stage) / 1000).toFixed(3)), metadata: local.metadata };
      report.verification.newlyGeneratedText = true; await save(); stage = performance.now();
      const bilingual = await completeBilingual({ zh: chunk, ja: '' }, { requestId: id, signal: controller.signal, preferLocal: true, translate: async (request, requestOptions) => {
        turn.translationInput = request.text; return translation.translate(request, requestOptions);
      } });
      turn.bilingual = bilingual; turn.translationSeconds = Number(((performance.now() - stage) / 1000).toFixed(3)); turn.translationMetadata = translation.metadata;
      if (bilingual.translationStatus !== 'ready' || !bilingual.ja || turn.translationInput !== bilingual.zh) throw Error(bilingual.translationError || 'Translation did not use this generated reply');
      report.verification.sameReplyTranslated = true; await save();
      const segments = new JapaneseSentenceStream().push(bilingual.ja, true); if (!segments.length) throw Error('Production sentence filtering produced no speech');
      stage = performance.now();const warmResult=warming?await warming:{value:await speech.ensureLoaded()};if(warmResult.error)throw warmResult.error;const loaded=warmResult.value;
      turn.voiceLoadSeconds = warming?warmResult.seconds:Number(((performance.now() - stage) / 1000).toFixed(3));turn.voicePrewarmed=Boolean(warming);turn.voiceLoadMetadata = loaded.metadata;
      turn.reusedVoiceWorker = Boolean(previousWorker && speech.worker === previousWorker); turn.voiceWorkerPid = speech.worker.child.pid; speech.begin(id);
      for (const [segmentIndex, text] of segments.entries()) {
        controller.signal.throwIfAborted(); stage = performance.now();
        const bytes = await speech.synthesize(id, text); controller.signal.throwIfAborted();
        const synthesisSeconds = Number(((performance.now() - stage) / 1000).toFixed(3)), audio = inspectWav(bytes);
        const filename = `turn${String(index + 1).padStart(2, '0')}-segment${String(segmentIndex + 1).padStart(2, '0')}.wav`;
        await fs.writeFile(path.join(options.output, filename), bytes, { flag: 'wx' });
        turn.segments.push({ text, synthesisSeconds, audio: { filename, ...audio }, metadata: speech.status.metadata });
        if (segmentIndex === 0) turn.firstWavReadySeconds = Number(((performance.now() - turnStarted) / 1000).toFixed(3));
        report.verification.newTrainedVoiceWav = true; await save();
        console.log(JSON.stringify({ turn: index + 1, segment: segmentIndex + 1, synthesisSeconds, audioSeconds: audio.durationSeconds, filename }));
      }
      controller.signal.throwIfAborted(); speech.stop(id); turn.completed = true; turn.totalSeconds = Number(((performance.now() - turnStarted) / 1000).toFixed(3)); await save();
    }
    controller.signal.throwIfAborted(); report.completed = true;
  } catch (error) { failure = controller.signal.reason || error; }
  finally {
    clearTimeout(deadline); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    for (const service of services) service.dispose();
    report.workerDiagnostics = [...workers].map(worker => ({ pid: worker.child.pid, stderrTail: worker.tail }));
    try { report.workerCleanup = await closeWorkers(workers); } catch (error) { failure ||= error; report.cleanupError = error.message; }
    for (const key of offlineKeys) { if (priorEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = priorEnvironment[key]; }
    if (failure) report.error = { message: failure.message, name: failure.name };
    report.passed = report.completed && !failure; report.elapsedSeconds = seconds(); await save();
  }
  if (failure) throw failure;
  return report;
}

if (require.main === module) {
  Promise.resolve().then(async () => {
    const options = parseArgs(process.argv.slice(2)); if (options.help) { console.log(HELP); return; }
    const report = await run(options); console.log(JSON.stringify({ passed: report.passed, turns: report.turns.length, report: path.join(options.output, 'report.json'), audioDevicePlayback: false, rendererMotionSync: false }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { parseArgs, contained, hashFile, verifyFile, readArchiveManifest, verifyChatModel, inspectWav, verifyResources, closeWorkers, run };
