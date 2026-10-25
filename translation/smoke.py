"""Run real offline translations against installed weights; never synthesize audio."""
import argparse
import json
from pathlib import Path
import time
import sys
# Embedded Windows Python uses an isolated ._pth and omits the script directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from worker import Engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    engine = Engine()
    start = time.monotonic()
    metadata = engine.load({'modelDir': str(args.model_dir.resolve()), 'device': args.device, 'cpuThreads': 4})
    result = {'metadata': metadata, 'load_seconds': round(time.monotonic() - start, 3), 'samples': []}
    for text in ['你好，今天也辛苦了。', '雪之下雪乃喜欢猫，但她现在并没有养猫。',
                 '下午三点半见面，一共需要两百五十元。', '明天不下雨的话，我们就去公园散步吧。']:
        start = time.monotonic()
        translated = engine.translate(text)
        row = {'zh': text, 'ja': translated['text'], 'seconds': round(time.monotonic() - start, 3)}
        result['samples'].append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
