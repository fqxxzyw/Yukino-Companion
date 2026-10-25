import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result


payload = module('app_payload', 'package-app-payload.py')
local = module('local_import', 'prepare-local-model.py')


class AppPayloadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.source = self.root / 'app'; self.source.mkdir()
        (self.source / 'Yukino Companion.exe').write_bytes(b'MZ' + bytes(range(256)))
        (self.source / 'model.gguf').write_bytes(b'GGUF' + bytes(range(256)) * 5)

    def test_complete_model_is_preserved_across_verified_split_zip64(self):
        output = self.root / 'parts'; catalog = payload.package(self.source, output, 'v0.4.0-test', 127)
        self.assertGreater(len(catalog['parts']), 1)
        combined = b''
        for part in catalog['parts']:
            content = (output / part['path']).read_bytes()
            self.assertEqual(len(content), part['bytes']); self.assertLessEqual(len(content), 127)
            self.assertEqual(hashlib.sha256(content).hexdigest(), part['digest']); combined += content
        self.assertEqual(hashlib.sha256(combined).hexdigest(), catalog['archiveSha256'])
        self.assertEqual(len(combined), catalog['bytes'])
        with zipfile.ZipFile(io.BytesIO(combined)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read('model.gguf'), (self.source / 'model.gguf').read_bytes())
            self.assertGreaterEqual(archive.getinfo('model.gguf').extract_version, 45)

    def test_missing_exe_nested_output_and_links_fail(self):
        with self.assertRaises(ValueError): payload.package(self.source, self.source / 'parts', 'v0.4.0')
        with self.assertRaises(ValueError): payload.package(self.source, self.root / 'parts', '../bad')
        (self.source / 'Yukino Companion.exe').unlink()
        with self.assertRaises(ValueError): payload.package(self.source, self.root / 'parts', 'v0.4.0')

    def test_import_requires_real_consistent_model_and_rejects_archive_traversal(self):
        weights = b'GGUF' + b'test-only-fixture'
        manifest = {'name':'Test fixture', 'file':'model.gguf', 'bytes':len(weights), 'sha256':hashlib.sha256(weights).hexdigest(), 'training':{'fixture':True,'completed':True}}
        archive = self.root / 'local.zip'; output = self.root / 'imported'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('manifest.json', json.dumps(manifest)); bundle.writestr('model.gguf', weights)
        local.prepare(archive, output)
        self.assertEqual((output / 'model.gguf').read_bytes(), weights)
        with zipfile.ZipFile(archive, 'a') as bundle: bundle.writestr('../unsafe.txt', 'bad')
        with self.assertRaises(ValueError): local.prepare(archive, output)


if __name__ == '__main__': unittest.main()
