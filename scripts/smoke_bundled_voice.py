"""Synthesize real Japanese with the bundled pair through the shipped JSONL worker.

Run after preparing the shared runtime and bundled voice. Core model downloads
are explicit and checksum-pinned; the inference subprocess is offline. A passing
result verifies model loading and non-silent PCM output, not subjective quality.
"""
from __future__ import annotations
import argparse
from array import array
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import Request, urlopen
import wave

PROJECT = Path(__file__).resolve().parents[1]


def safe_path(root, name):
    if not isinstance(name, str) or '\\' in name or Path(name).is_absolute() or any(part in {'', '.', '..'} for part in name.split('/')):
        raise ValueError('Invalid voice resource path')
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Voice resource path escapes directory')
    return target


def digest(path, algorithm='sha256'):
    value = hashlib.new(algorithm)
    if algorithm == 'sha1':
        value.update(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def verify(path, item):
    return (path.is_file() and path.stat().st_size == item['bytes']
            and digest(path, item.get('algorithm', 'sha256')) == item.get('digest', item.get('sha256')))


def prepare_core(root, allow_download):
    catalog = json.loads((PROJECT / 'resources/voice-models.json').read_text(encoding='utf-8'))
    for item in catalog['packs']['core']['files']:
        destination = safe_path(root, item['path'])
        if verify(destination, item):
            continue
        if not allow_download:
            raise RuntimeError(f'Missing or invalid core resource: {item["path"]}; pass --download-core to prepare pinned files')
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + '.part')
        request = Request(item['url'], headers={'User-Agent': 'Yukino-Companion-Voice-Smoke/1.0'})
        received = 0
        with urlopen(request, timeout=120) as incoming, temporary.open('wb') as output:
            while chunk := incoming.read(1024 * 1024):
                received += len(chunk)
                if received > item['bytes']:
                    raise ValueError('Core download exceeds pinned size')
                output.write(chunk)
        if not verify(temporary, item):
            temporary.unlink(missing_ok=True)
            raise ValueError(f'Core checksum mismatch: {item["path"]}')
        temporary.replace(destination)
    return catalog['revision']


def run(args):
    voice_root = args.voice_root.resolve()
    preset = json.loads((voice_root / 'preset.json').read_text(encoding='utf-8'))
    files = {}
    for item in preset['files']:
        filename = safe_path(voice_root, item['path'])
        if not verify(filename, item):
            raise ValueError(f'Bundled voice checksum mismatch: {item["kind"]}')
        files[item['kind']] = str(filename)
    if set(files) != {'gpt', 'sovits', 'reference'} or not preset['promptText'].strip():
        raise ValueError('Incomplete voice preset')
    core_revision = prepare_core(args.model_root.resolve(), args.download_core)
    runtime = args.runtime_root.resolve()
    python = args.python.resolve() if args.python else runtime / 'python-runtime/python.exe'
    engine = args.engine.resolve() if args.engine else runtime / 'inference-engine'
    ffmpeg = args.ffmpeg.resolve() if args.ffmpeg else runtime / 'python-runtime/ffmpeg.exe'
    for item in [python, ffmpeg, engine / 'GPT_SoVITS/TTS_infer_pack/TTS.py']:
        if not item.is_file():
            raise FileNotFoundError(f'Missing runtime component: {item}')
    args.report = args.report.resolve()
    args.audio = args.audio.resolve()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.audio.parent.mkdir(parents=True, exist_ok=True)
    state = args.report.parent / 'voice-smoke-state'
    state.mkdir(parents=True, exist_ok=True)
    config = {**files, 'python': str(python), 'root': str(engine), 'ffmpeg': str(ffmpeg),
              'bert': str(args.model_root.resolve() / 'chinese-roberta-wwm-ext-large'),
              'hubert': str(args.model_root.resolve() / 'chinese-hubert-base'),
              'stateDir': str(state), 'promptText': preset['promptText'],
              'promptLang': preset['promptLang'], 'textLang': 'all_ja',
              'version': preset['version'], 'device': 'cpu', 'half': False,
              'cpuFallback': True, 'cpuThreads': 4}
    requests = [{'id': 'load', 'method': 'load', 'config': config},
                {'id': 'synthesize', 'method': 'synthesize', 'text': args.text, 'speed': 1}]
    payload = ''.join(json.dumps(request, ensure_ascii=False) + '\n' for request in requests)
    env = os.environ.copy()
    env.update(PYTHONUTF8='1', PYTHONIOENCODING='utf-8', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    started = time.monotonic()
    log = args.report.with_suffix('.stderr.log')
    with log.open('w', encoding='utf-8') as stderr:
        process = subprocess.run([str(python), '-X', 'utf8', '-u', str(PROJECT / 'inference/worker.py')],
                                 input=payload, stdout=subprocess.PIPE, stderr=stderr, text=True,
                                 encoding='utf-8', cwd=engine, env=env, timeout=args.timeout)
    if process.returncode:
        raise RuntimeError(f'Voice worker exited {process.returncode}; see {log}')
    responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    if [response.get('id') for response in responses] != ['load', 'synthesize']:
        raise RuntimeError(f'Unexpected voice worker protocol; see {log}')
    for response in responses:
        if not response.get('ok'):
            raise RuntimeError(f'{response["id"]}: {response.get("error")}; see {log}')
    raw = base64.b64decode(responses[1]['result']['audio'], validate=True)
    with wave.open(io.BytesIO(raw), 'rb') as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise ValueError('Expected mono PCM16 output')
        rate, frames = wav.getframerate(), wav.getnframes()
        samples = array('h', wav.readframes(frames))
    if sys.byteorder != 'little':
        samples.byteswap()
    duration = frames / rate
    rms = math.sqrt(sum(sample * sample for sample in samples) / max(1, len(samples))) / 32768
    if not 0.15 <= duration <= 120 or rms < 0.0001:
        raise ValueError(f'Output is empty, silent or outside duration bounds: {duration:.3f}s, RMS={rms}')
    args.audio.write_bytes(raw)
    report = {'schemaVersion': 1, 'passed': True, 'test': 'real-bundled-japanese-synthesis',
              'subjectiveListeningVerified': False, 'presetId': preset['id'],
              'referenceTranscriptVerification': preset.get('transcriptVerification'),
              'text': args.text, 'speechLanguage': 'all_ja', 'coreRevision': core_revision,
              'loadMetadata': responses[0]['result'], 'audio': {'filename': args.audio.name,
              'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
              'sampleRate': rate, 'durationSeconds': round(duration, 4), 'rms': round(rms, 6)},
              'elapsedSeconds': round(time.monotonic() - started, 3),
              'limitation': 'Checks real loading, Japanese synthesis and non-silent PCM; does not certify voice quality or pronunciation.'}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'presetId': preset['id'], 'audio': report['audio'],
                      'report': str(args.report)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root', type=Path, default=PROJECT / 'build')
    parser.add_argument('--voice-root', type=Path, default=PROJECT / 'build/bundled-voice')
    parser.add_argument('--model-root', type=Path, default=PROJECT / 'build/voice-smoke-models')
    parser.add_argument('--python', type=Path)
    parser.add_argument('--engine', type=Path)
    parser.add_argument('--ffmpeg', type=Path)
    parser.add_argument('--download-core', action='store_true')
    parser.add_argument('--text', default='こんにちは。今日は何を話しましょうか。')
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--report', type=Path, default=PROJECT / 'artifacts/voice-smoke/report.json')
    parser.add_argument('--audio', type=Path, default=PROJECT / 'artifacts/voice-smoke/japanese.wav')
    run(parser.parse_args())
