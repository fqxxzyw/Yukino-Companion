"""Small real archives exercise the trained-model release boundary without weights."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/build-release-local-model.py'
spec = importlib.util.spec_from_file_location('local_model_release_builder', SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class LocalModelBuilderTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='yukino-model-builder-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.weights = b'synthetic adapter fixture; never shipped'
        self.adapter_sha = hashlib.sha256(self.weights).hexdigest()

    def archive(self, *, steps=47, adapter_sha=None, extra=None):
        report = {'completed': True, 'task': 'complete_persona', 'run_purpose': 'training',
                  'steps': steps, 'base_revision': builder.REVISION,
                  'adapter_sha256': adapter_sha or self.adapter_sha}
        files = {'adapter/adapter_model.safetensors': self.weights,
                 'adapter/adapter_config.json': b'{}',
                 'training_report.json': json.dumps(report).encode(),
                 'BASE_LICENSE.txt': b'synthetic license fixture'}
        files.update(extra or {})
        manifest = {'baseModel': builder.BASE, 'baseRevision': builder.REVISION,
                    'files': {name: hashlib.sha256(value).hexdigest() for name, value in files.items()}}
        archive = self.root / builder.ARCHIVE_NAME
        with zipfile.ZipFile(archive, 'w') as out:
            for name, value in files.items():
                out.writestr(name, value)
            out.writestr('MANIFEST.json', json.dumps(manifest))
        for key, value in [('ARCHIVE_BYTES', archive.stat().st_size),
                           ('ARCHIVE_SHA256', builder.sha(archive)), ('ADAPTER_SHA256', self.adapter_sha)]:
            context = patch.object(builder, key, value)
            context.start()
            self.addCleanup(context.stop)
        return archive

    def transfer(self, archive):
        directory = self.root / 'transfer'
        directory.mkdir()
        data = archive.read_bytes()
        parts = []
        for index, offset in enumerate(range(0, len(data), 127)):
            chunk = data[offset:offset + 127]
            name = f'model.part{index:03d}'
            (directory / name).write_bytes(chunk)
            parts.append({'path': name, 'bytes': len(chunk), 'sha256': hashlib.sha256(chunk).hexdigest()})
        manifest = {'archive': {'name': archive.name, 'bytes': len(data), 'sha256': builder.sha(archive)}, 'parts': parts}
        (directory / 'model-parts.json').write_text(json.dumps(manifest))
        return directory, manifest

    def test_real_transfer_roundtrip_retains_the_original_adapter_archive(self):
        archive = self.archive()
        transfer, _ = self.transfer(archive)
        output = builder.join_transfer(transfer, self.root / 'distribution')
        self.assertEqual(output.read_bytes(), archive.read_bytes())
        builder.extract_verified(output, self.root / 'extracted')
        self.assertEqual((self.root / 'extracted/adapter/adapter_model.safetensors').read_bytes(), self.weights)
        self.assertTrue(output.is_file())

    def test_transfer_cannot_choose_another_self_consistent_archive(self):
        archive = self.archive()
        transfer, manifest = self.transfer(archive)
        manifest['archive']['sha256'] = 'a' * 64
        (transfer / 'model-parts.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'approved release'):
            builder.join_transfer(transfer, self.root / 'distribution')

    def test_transfer_rejects_modified_part_before_extracting(self):
        archive = self.archive()
        transfer, manifest = self.transfer(archive)
        first = transfer / manifest['parts'][0]['path']
        first.write_bytes(b'x' * first.stat().st_size)
        with self.assertRaisesRegex(ValueError, 'part integrity'):
            builder.join_transfer(transfer, self.root / 'distribution')

    def test_only_the_recorded_47_step_adapter_can_be_built(self):
        archive = self.archive(steps=1)
        with self.assertRaisesRegex(ValueError, 'completed personality'):
            builder.extract_verified(archive, self.root / 'extracted')

    def test_report_cannot_relabel_another_adapter_as_the_trained_weights(self):
        archive = self.archive(adapter_sha='f' * 64)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            builder.extract_verified(archive, self.root / 'extracted')

    def test_archive_and_transfer_paths_cannot_escape_their_roots(self):
        archive = self.archive(extra={'../outside.txt': b'not allowed'})
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            builder.extract_verified(archive, self.root / 'extracted')
        self.assertFalse((self.root / 'outside.txt').exists())
        for name in ['', '../escape', str(self.root / 'absolute'), 'nested\\escape']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                builder.inside(self.root, name)

    def test_shipping_output_cannot_overlap_disposable_build_files(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--transfer', str(self.root / 'transfer'),
            '--work-dir', str(self.root / 'work'), '--output', str(self.root / 'work/merged'), '--skip-install'],
            text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('must not overlap', result.stderr)


if __name__ == '__main__':
    unittest.main()
