"""Actual local VP9-alpha decode validation; no browser/window or network access.
Requires existing ffmpeg/ffprobe. Writes only build/video-preview-integration/.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'electron/companion-view/video-preview'
manifest = json.loads((PACK / 'manifest.json').read_text())
report = {'passed': False, 'synthetic': False, 'purpose': 'Actual bundled Yukino review media decoding, not Electron/Windows graphical or performance acceptance', 'clips': []}
for clip in manifest['clips']:
    file = PACK / clip['src']
    assert file.stat().st_size == clip['bytes']
    assert hashlib.sha256(file.read_bytes()).hexdigest() == clip['sha256']
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)]))
    assert len(probe['streams']) == 1 and probe['streams'][0]['codec_name'] == 'vp9', 'No audio or hidden extra streams'
    process = subprocess.Popen(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(file), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], stdout=subprocess.PIPE)
    count, hashes = 0, set()
    size = clip['width'] * clip['height'] * 4
    while True:
        frame = process.stdout.read(size)
        if not frame:
            break
        assert len(frame) == size
        count += 1
        hashes.add(hashlib.sha256(frame).digest())
        image = Image.frombytes('RGBA', (clip['width'], clip['height']), frame)
        for name, point in clip['alphaProbe'].items():
            alpha = image.getpixel((point['x'], point['y']))[3]
            assert alpha <= 8 if name == 'transparent' else alpha >= 247
        alpha = image.getchannel('A')
        assert all(alpha.crop(box).getextrema() == (0, 0) for box in [(0, 0, 640, 1), (0, 639, 640, 640), (0, 0, 1, 640), (639, 0, 640, 640)])
    assert process.wait() == 0
    assert count == round(clip['durationMs'] * clip['fps'] / 1000)
    report['clips'].append({'id': clip['id'], 'frames': count, 'uniqueRGBAFrames': len(hashes), 'bytes': clip['bytes'], 'sha256': clip['sha256'], 'fps': clip['fps'], 'alphaProbeAndPaddingAllFramesPassed': True, 'audioTracks': 0})
poster = manifest['staticPoster']
assert hashlib.sha256((PACK / poster['src']).read_bytes()).hexdigest() == poster['sha256']
assert Image.open(PACK / poster['src']).size == (640, 640)
report['passed'] = True
report['graphicalQA'] = 'NOT RUN: restricted container graphical launch previously denied; no retry/bypass'
out = ROOT / 'build/video-preview-integration';out.mkdir(parents=True, exist_ok=True)
(out / 'asset-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
