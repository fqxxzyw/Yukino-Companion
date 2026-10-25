"""Tiny real archives verify the runtime distribution contract without gigabytes of fixtures."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

script = Path(__file__).resolve().parents[1] / 'scripts/package-runtime.py'
spec = importlib.util.spec_from_file_location('runtime_packager', script)
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class RuntimePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='yukino-runtime-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime, self.engine = self.root / 'python-runtime', self.root / 'inference-engine'
        self.runtime.mkdir()
        self.engine.mkdir()
        (self.runtime / 'python.exe').write_bytes(b'MZ' + bytes(range(256)) * 4)
        (self.runtime / 'yukino-runtime-build.json').write_text('{"flavor":"cpu"}')
        (self.runtime / 'distutils-precedence.pth').write_text('import site\n')
        (self.engine / 'yukino-runtime.json').write_text('{"revision":"fixture"}')
        (self.engine / 'GPT_SoVITS').mkdir()
        (self.engine / 'GPT_SoVITS/TTS.py').write_text('print("test runtime")\n')

    def package(self, flavor='cpu', output=None, **kwargs):
        return packager.package_runtime(self.runtime, self.engine, output or self.root / flavor,
                                        flavor=flavor, tag='v0.4.0-test', part_bytes=127, **kwargs)

    def test_split_roundtrip_sha_and_zip64_headers(self):
        catalog = self.package()
        variant = catalog['variants']['cpu']
        parts = variant['parts']
        self.assertGreater(len(parts), 1)
        chunks = []
        for index, part in enumerate(parts, 1):
            data = (self.root / 'cpu' / part['path']).read_bytes()
            self.assertTrue(part['path'].endswith(f'part{index:03d}'))
            self.assertLessEqual(len(data), 127)
            self.assertEqual(len(data), part['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), part['digest'])
            self.assertEqual(part['algorithm'], 'sha256')
            self.assertIn('/v0.4.0-test/', part['url'])
            chunks.append(data)
        combined = b''.join(chunks)
        self.assertEqual(len(combined), variant['bytes'])
        self.assertEqual(hashlib.sha256(combined).hexdigest(), variant['archiveSha256'])
        with zipfile.ZipFile(io.BytesIO(combined)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read('python-runtime/python.exe'), (self.runtime / 'python.exe').read_bytes())
            self.assertEqual(archive.read('inference-engine/GPT_SoVITS/TTS.py'), (self.engine / 'GPT_SoVITS/TTS.py').read_bytes())
            self.assertTrue(all(name.startswith(('python-runtime/', 'inference-engine/')) for name in archive.namelist()))
            self.assertEqual(sum(info.file_size for info in archive.infolist()), variant['unpackedBytes'])
            first = archive.infolist()[0]
        self.assertEqual(combined[first.header_offset:first.header_offset + 4], b'PK\x03\x04')
        filename_size, extra_size = struct.unpack_from('<HH', combined, first.header_offset + 26)
        extra_start = first.header_offset + 30 + filename_size
        extra = combined[extra_start:extra_start + extra_size]
        self.assertEqual(struct.unpack_from('<H', extra)[0], 1, 'local ZIP64 extra field must be present even in small fixture')
        recorded = json.loads((self.root / 'cpu/runtime-catalog-cpu.json').read_text())
        self.assertEqual(recorded, catalog)

    def test_merge_cpu_and_cuda_and_reject_conflict(self):
        cpu = self.package()
        (self.runtime / 'yukino-runtime-build.json').write_text('{"flavor":"cu124"}')
        cuda = self.package(flavor='cu124')
        files = [self.root / 'cpu/runtime-catalog-cpu.json', self.root / 'cu124/runtime-catalog-cu124.json']
        merged = packager.merge_catalogs(files, self.root / 'merged')
        self.assertEqual(set(merged['variants']), {'cpu', 'cu124'})
        self.assertEqual(merged['variants']['cpu'], cpu['variants']['cpu'])
        self.assertEqual(merged['variants']['cu124'], cuda['variants']['cu124'])
        cpu['variants']['cpu']['unpackedBytes'] += 1
        altered = self.root / 'changed.json'
        altered.write_text(json.dumps(cpu))
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            packager.merge_catalogs([files[0], altered], self.root / 'bad-merge')

    def test_wrong_flavor_models_unsafe_output_and_parts_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'flavor'):
            self.package(flavor='cu124')
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.package(output=self.runtime / 'bad-output')
        weight = self.engine / 'voice.pth'
        weight.write_bytes(b'not shipped in shared runtime')
        with self.assertRaisesRegex(ValueError, 'Model weights'):
            self.package()
        weight.unlink()
        for invalid in [0, packager.MAX_PART_BYTES + 1]:
            with self.assertRaisesRegex(ValueError, 'Part size'):
                packager.package_runtime(self.runtime, self.engine, self.root / 'bad', flavor='cpu', tag='v0.4.0-test', part_bytes=invalid)
        catalog = self.package()
        catalog['variants']['cpu']['parts'][0]['path'] = '../escape'
        with self.assertRaisesRegex(ValueError, 'safe and sequential'):
            packager.validate_catalog(catalog)

    def test_third_party_library_resources_are_preserved(self):
        resources = {
            'Lib/site-packages/onnxruntime/datasets/example.onnx': b'library fixture',
            'Lib/site-packages/torch/_inductor/templates/example.pt': b'library template',
            'Lib/site-packages/example_library/tests/fixture.safetensors': b'tiny library test fixture',
        }
        for name, data in resources.items():
            target = self.runtime / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        catalog = self.package()
        data = b''.join((self.root / 'cpu' / part['path']).read_bytes()
                        for part in catalog['variants']['cpu']['parts'])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name, expected in resources.items():
                self.assertEqual(archive.read('python-runtime/' + name), expected)

    def test_links_are_rejected_without_including_external_bytes(self):
        outside = self.root / 'private.txt'
        outside.write_text('must never be packaged')
        link = self.runtime / 'escape.txt'
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest('Creating links requires privileges on this platform')
        with self.assertRaisesRegex(ValueError, 'link'):
            self.package()
        self.assertFalse((self.root / 'cpu/runtime-catalog-cpu.json').exists())


if __name__ == '__main__':
    unittest.main()
