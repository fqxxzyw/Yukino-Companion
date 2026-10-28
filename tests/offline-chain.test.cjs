const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { parseArgs, contained, verifyFile, inspectWav, readArchiveManifest, verifyChatModel, closeWorkers, run } = require('../scripts/verify-offline-chain.cjs');

const required = ['python', 'model', 'translation', 'engine', 'voice', 'core', 'ffmpeg', 'output'];
const args = extra => [...required.flatMap(key => ['--' + key, path.resolve('synthetic-fixture', key)]), ...extra];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-chain-input-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
function archive(filename, rows) {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for name,value in json.loads(sys.argv[2]):z.writestr(name,json.dumps(value))', filename, JSON.stringify(rows)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

// Synthetic PCM only tests validation. It is not a generated voice, device
// playback or evidence that the production inference chain completed.
function wav(sample = 8000) {
  const rate = 16000, frames = 4000, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(frame % 2 ? sample : -sample, 44 + frame * 2);
  return bytes;
}

test('offline-chain CLI rejects missing paths, unknown and duplicate options and ambiguous devices', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  for (const invalid of [[], args(['--download', 'true']), args(['--device', 'auto']), args(['--threads', '0']), args(['--timeout', '901']), args(['--deadline', 'NaN']), args(['--max-tokens', '31']), args(['--python', '/duplicate'])]) assert.throws(() => parseArgs(invalid));
  const options = parseArgs(args(['--prompt', '第一轮。', '--prompt', '第二轮。', '--device', 'cpu', '--model-archive', './verified.zip']));
  assert.deepEqual(options.prompts, ['第一轮。', '第二轮。']); assert.equal(options.threads, 4);
  assert.ok(path.isAbsolute(options['model-archive'])); assert.equal(parseArgs(args([])).prompts.length, 2);
});

test('resource manifest paths cannot escape the explicit root', () => {
  const root = path.resolve('fixtures');
  for (const invalid of ['', '../weight', 'nested/../weight', '/weight', 'C:\\weight', 'a//b', 'a/./b', 'C:weight']) assert.throws(() => contained(root, invalid));
  assert.equal(contained(root, 'voice/reference.wav'), path.join(root, 'voice/reference.wav'));
});

test('resource verification rejects same-length tampering and distinguishes Git blob SHA-1', async t => {
  const dir = await temporary(t), file = path.join(dir, 'resource.bin'), data = Buffer.from('fixture model bytes'); await fs.writeFile(file, data);
  assert.equal((await verifyFile(file, { bytes: data.length, sha256: sha(data) })).digest, sha(data));
  const gitBlob = crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  await verifyFile(file, { bytes: data.length, algorithm: 'sha1', digest: gitBlob });
  await assert.rejects(verifyFile(file, { bytes: data.length, algorithm: 'sha1', digest: crypto.createHash('sha1').update(data).digest('hex') }), /checksum/);
  await fs.writeFile(file, Buffer.alloc(data.length, 65)); await assert.rejects(verifyFile(file, { bytes: data.length, sha256: sha(data) }), /checksum/);
  await assert.rejects(verifyFile(file, { bytes: -1, sha256: sha(data) }), /metadata/);
});

test('WAV inspection measures actual PCM and rejects silence, truncation and incompatible format', () => {
  const bytes = wav(), info = inspectWav(bytes);
  assert.equal(info.sampleRate, 16000); assert.equal(info.frames, 4000); assert.equal(info.durationSeconds, 0.25);
  assert.equal(info.rms, 8000 / 32768); assert.equal(info.sha256, sha(bytes));
  assert.throws(() => inspectWav(wav(0)), /silent/); assert.throws(() => inspectWav(bytes.subarray(0, -2)), /length/);
  const stereo = Buffer.from(bytes); stereo.writeUInt16LE(2, 22); assert.throws(() => inspectWav(stereo), /mono/);
  const invalidRate = Buffer.from(bytes); invalidRate.writeUInt32LE(44100, 24); assert.throws(() => inspectWav(invalidRate), /mono/);
  const overflow = Buffer.from(bytes); overflow.writeUInt32LE(bytes.length * 2, 40); assert.throws(() => inspectWav(overflow), /Truncated/);
  const junk = Buffer.concat([bytes, Buffer.from([1])]); junk.writeUInt32LE(junk.length - 8, 4); assert.throws(() => inspectWav(junk), /complete/);
});

test('empty source package markers require their exact pinned digest and remain ordinary files', async t => {
  const dir = await temporary(t), file = path.join(dir, '__init__.py'), empty = Buffer.alloc(0);
  await fs.writeFile(file, empty);
  const result = await verifyFile(file, { bytes: 0, sha256: sha(empty) });
  assert.equal(result.bytes, 0); assert.equal(result.digest, sha(empty));
  await assert.rejects(verifyFile(file, { bytes: 0, sha256: '0'.repeat(64) }), /checksum/);
  await assert.rejects(verifyFile(file, { bytes: 0 }), error => error.message.includes(file) && /metadata/.test(error.message));
  await assert.rejects(verifyFile(dir, { bytes: 0, sha256: sha(empty) }), /regular resource file/);
});

test('archive manifest reader rejects absent and duplicate identities and preserves actual quantizer', async t => {
  const dir = await temporary(t), filename = path.join(dir, 'model.zip'), manifest = { file: 'actual.gguf', quantizer: { binary: 'llama-quantize' } };
  archive(filename, [['model/manifest.json', manifest]]); assert.deepEqual(await readArchiveManifest(filename), manifest);
  archive(filename, [['manifest.json', manifest], ['other/manifest.json', manifest]]); await assert.rejects(readArchiveManifest(filename), /duplicate/);
  archive(filename, [['other.json', manifest]]); await assert.rejects(readArchiveManifest(filename), /Missing/);
});

test('Release quantizer mismatch needs the pinned archive and reports actual binary instead of source example', async t => {
  const dir = await temporary(t), bytes = Buffer.from('GGUF synthetic quantized fixture'), zip = path.join(dir, 'model.zip');
  const actual = { file: 'model.gguf', bytes: bytes.length, sha256: sha(bytes), baseModel: 'fixture-base', baseRevision: 'a'.repeat(40), training: { completed: true, adapterSha256: 'b'.repeat(64) }, quantizer: { binary: 'actual' } };
  const sourceExample = { ...actual, bytes: 999, sha256: 'c'.repeat(64), quantizer: { runtime: 'example' } };
  await fs.writeFile(path.join(dir, 'model.gguf'), bytes); await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(actual)); archive(zip, [['manifest.json', actual]]);
  const zipBytes = await fs.readFile(zip), archiveSpec = { bytes: zipBytes.length, sha256: sha(zipBytes) }, signal = new AbortController().signal;
  await assert.rejects(verifyChatModel({ modelDir: dir, sourceExample, archiveSpec, signal }), /model-archive/);
  const result = await verifyChatModel({ modelDir: dir, modelArchive: zip, sourceExample, archiveSpec, signal });
  assert.equal(result.actual.sha256, actual.sha256); assert.equal(result.sourceExample.sha256, sourceExample.sha256);
  assert.equal(result.sourceExampleBinaryVerified, false); assert.deepEqual(result.differingFields.sort(), ['bytes', 'quantizer', 'sha256']);
  const changed = { ...actual, quantizer: { binary: 'silently changed' } }; await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(changed));
  await assert.rejects(verifyChatModel({ modelDir: dir, modelArchive: zip, sourceExample, archiveSpec, signal }), /differs from the verified/);
});

test('changing the training adapter cannot be excused as a quantization-only difference', async t => {
  const dir = await temporary(t), bytes = Buffer.from('GGUF changed adapter fixture'), zip = path.join(dir, 'model.zip');
  const actual = { file: 'model.gguf', bytes: bytes.length, sha256: sha(bytes), baseModel: 'fixture-base', baseRevision: 'a'.repeat(40), training: { completed: true, adapterSha256: 'b'.repeat(64) } };
  const sourceExample = { ...actual, training: { completed: true, adapterSha256: 'c'.repeat(64) } };
  await fs.writeFile(path.join(dir, 'model.gguf'), bytes); await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(actual)); archive(zip, [['manifest.json', actual]]);
  const zipBytes = await fs.readFile(zip);
  await assert.rejects(verifyChatModel({ modelDir: dir, modelArchive: zip, sourceExample, archiveSpec: { bytes: zipBytes.length, sha256: sha(zipBytes) }, signal: new AbortController().signal }), /adapter identity/);
});

test('run refuses to overwrite evidence and records preflight failure without claiming inference', async t => {
  const dir = await temporary(t), sentinel = path.join(dir, 'report.json'); await fs.writeFile(sentinel, 'keep prior evidence');
  const options = parseArgs(args([])); options.output = dir;
  await assert.rejects(run(options), error => error.code === 'EEXIST'); assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep prior evidence');
  options.output = path.join(dir, 'fresh-attempt'); options.model = path.join(dir, 'missing-model');
  const prior = process.env.HF_HUB_OFFLINE;
  await assert.rejects(run(options), /ENOENT/);
  const report = JSON.parse(await fs.readFile(path.join(options.output, 'report.json'), 'utf8'));
  assert.equal(report.passed, false); assert.equal(report.completed, false); assert.equal(report.verification.newTrainedVoiceWav, false);
  assert.deepEqual(report.workerDiagnostics, []); assert.equal(process.env.HF_HUB_OFFLINE, prior);
});

test('cleanup awaits the exact owned process exit', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const cleanup = await closeWorkers(new Set([{ child, close() { child.kill(); } }]));
  assert.equal(cleanup.length, 1); assert.equal(cleanup[0].pid, child.pid); assert.equal(cleanup[0].exited, true);
});
