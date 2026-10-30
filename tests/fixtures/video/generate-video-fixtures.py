"""Synthetic QA shapes, not character animation. Requires existing Pillow + ffmpeg.
No network requests, downloads or third-party character assets. CC0-1.0.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw
import math
import subprocess

OUT = Path(__file__).resolve().parent
with TemporaryDirectory(prefix='yukino-video-fixtures-') as temporary:
    frames = Path(temporary)
    for name, color in [('blue', '#6baddb'), ('pink', '#db6b9d')]:
        for index in range(48):
            phase = index / 48 * math.tau
            image = Image.new('RGBA', (128, 128))
            draw = ImageDraw.Draw(image)
            x = round(math.sin(phase) * 5)
            height = round(78 + math.sin(phase * 2) * 4)
            draw.rounded_rectangle((36 + x, 112 - height, 92 + x, 110), radius=22, fill=color)
            draw.ellipse((48 + x, 56, 54 + x, 63), fill='white')
            draw.ellipse((74 + x, 56, 80 + x, 63), fill='white')
            draw.ellipse((39, 103, 61, 112), fill=color)
            draw.ellipse((67, 103, 89, 112), fill=color)
            image.save(frames / f'{index:03}.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '24', '-i', str(frames / '%03d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '35', '-b:v', '0', '-an', '-auto-alt-ref', '0', str(OUT / f'{name}.webm')], check=True)
