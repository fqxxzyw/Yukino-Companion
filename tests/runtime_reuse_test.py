"""Verify actual split archives and pinned Actions identities without network access."""
import copy
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

script = Path(__file__).resolve().parents[1] / 'scripts/reuse-runtime.py'
spec = importlib.util.spec_from_file_location('runtime_reuse', script)
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)
NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


class ApiFixture:
    def __init__(self, flavor='cpu'):
        self.calls = []
        self.run = {'id': reuse.SOURCE_RUN, 'head_sha': reuse.SOURCE_COMMIT, 'path': reuse.WORKFLOW,
                    'repository': {'full_name': reuse.REPOSITORY}, 'head_repository': {'full_name': reuse.REPOSITORY},
                    'run_attempt': 1, 'status': 'completed', 'conclusion': 'failure'}
        self.job = {'id': 123, 'name': f'runtime ({flavor})', 'status': 'completed', 'conclusion': 'success',
                    'run_id': reuse.SOURCE_RUN, 'head_sha': reuse.SOURCE_COMMIT}
        self.artifact = {'id': 456, 'name': f'inference-runtime-{flavor}', 'expired': False,
                         'expires_at': '2099-01-01T00:00:00Z', 'digest': 'sha256:' + 'a' * 64,
                         'workflow_run': {'id': reuse.SOURCE_RUN, 'head_sha': reuse.SOURCE_COMMIT}}

    def get(self, route):
        self.calls.append(route)
        if '/jobs?' in route:
            return {'total_count': 1, 'jobs': [copy.deepcopy(self.job)]}
        if '/artifacts?' in route:
            return {'total_count': 1, 'artifacts': [copy.deepcopy(self.artifact)]}
        return copy.deepcopy(self.run)

    def probe(self, flavor='cpu'):
        return reuse.probe(reuse.SOURCE_RUN, reuse.SOURCE_COMMIT, flavor, get=self.get, now=NOW)


class RuntimeReuseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='runtime-reuse-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / 'artifact'
        self.runtime, self.engine = self.root / 'python-runtime', self.root / 'inference-engine'
        self.runtime.mkdir()
        self.engine.mkdir()
        self.marker = {'flavor': 'cpu', 'revision': reuse.builder.REVISION,
                       'translationRuntime': reuse.TRANSLATION_RUNTIME,
                       'inputFingerprint': reuse.builder.inputs_fingerprint()}
        (self.runtime / 'python.exe').write_bytes(b'MZ-do-not-execute-this-test-fixture')
        (self.engine / 'yukino-runtime.json').write_text(json.dumps({'revision': reuse.builder.REVISION}))
        (self.engine / 'dangerous.py').write_text('raise RuntimeError("Archive code must never be executed")\n')
        self.probe_json = self.root / 'probe.json'
        reuse._write_json(self.probe_json, ApiFixture().probe())

    def package(self, marker=None):
        (self.runtime / 'yukino-runtime-build.json').write_text(json.dumps(marker or self.marker))
        return reuse.packager.package_runtime(self.runtime, self.engine, self.directory,
                                              flavor='cpu', tag='v0.4.0-source', part_bytes=127)

    def verify(self, **kwargs):
        return reuse.verify(self.directory, 'cpu', kwargs.pop('tag', 'v0.4.0-reuse'),
                            kwargs.pop('probe_json', self.probe_json), now=NOW, **kwargs)

    def catalogue(self):
        return json.loads((self.directory / 'runtime-catalog-cpu.json').read_text())

    def replace_archive(self, data):
        """Re-sign a synthetic archive so marker/path checks are independently exercised."""
        catalog = self.catalogue()
        variant = catalog['variants']['cpu']
        parts = []
        for index, offset in enumerate(range(0, len(data), 127), 1):
            chunk = data[offset:offset+127]
            name = f'Yukino-Runtime-0.4.0-windows-x64-cpu.zip.part{index:03d}'
            (self.directory / name).write_bytes(chunk)
            parts.append({'path': name, 'algorithm': 'sha256', 'digest': hashlib.sha256(chunk).hexdigest(),
                          'bytes': len(chunk), 'url': reuse.packager.RELEASE_BASE + 'v0.4.0-source/' + name})
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = sum(info.file_size for info in archive.infolist())
        variant.update(parts=parts, bytes=len(data), archiveSha256=hashlib.sha256(data).hexdigest(), unpackedBytes=total)
        reuse._write_json(self.directory / 'runtime-catalog-cpu.json', catalog)

    def original_bytes(self):
        variant = self.catalogue()['variants']['cpu']
        return b''.join((self.directory / part['path']).read_bytes() for part in variant['parts'])

    def test_probe_accepts_successful_flavor_even_when_unrelated_run_job_failed(self):
        api = ApiFixture()
        result = api.probe()
        self.assertTrue(result['reuse'])
        self.assertEqual(result['sourceArtifact']['id'], 456)
        self.assertEqual(result['sourceCommit'], reuse.SOURCE_COMMIT)
        self.assertEqual(len(api.calls), 3)
        self.assertIn('filter=latest', api.calls[1])
        self.assertTrue(all(route.startswith(f'/repos/{reuse.REPOSITORY}/actions/runs/') for route in api.calls))

    def test_probe_rejects_wrong_commit_repository_workflow_or_artifact_identity(self):
        mutations = [('run', 'head_sha', 'b' * 40), ('run', 'path', '.github/workflows/untrusted.yml'),
                     ('run', 'repository', {'full_name': 'other/repo'}), ('run', 'head_repository', {'full_name': 'fork/repo'}),
                     ('job', 'head_sha', 'b' * 40), ('job', 'run_id', 999),
                     ('artifact', 'workflow_run', {'id': reuse.SOURCE_RUN, 'head_sha': 'b' * 40})]
        for section, key, value in mutations:
            with self.subTest(section=section, key=key):
                api = ApiFixture()
                getattr(api, section)[key] = value
                with self.assertRaises(ValueError):
                    api.probe()

    def test_unfinished_failed_absent_and_expired_artifacts_fall_back_without_reuse(self):
        for mutation in ['running', 'failure', 'wrong-name', 'expired', 'expiry-time']:
            with self.subTest(case=mutation):
                api = ApiFixture()
                if mutation == 'running':
                    api.job.update(status='in_progress', conclusion=None)
                elif mutation == 'failure':
                    api.job['conclusion'] = 'failure'
                elif mutation == 'wrong-name':
                    api.artifact['name'] = 'inference-runtime-cu124'
                elif mutation == 'expired':
                    api.artifact['expired'] = True
                else:
                    api.artifact['expires_at'] = '2000-01-01T00:00:00Z'
                result = api.probe()
                self.assertFalse(result['reuse'])
                self.assertIn('reason', result)
        with patch.dict(os.environ, {'GH_TOKEN': ''}):
            self.assertFalse(reuse.probe(reuse.SOURCE_RUN, reuse.SOURCE_COMMIT, 'cpu')['reuse'])

    def test_probe_cli_emits_explicit_outputs_and_stores_only_provenance(self):
        output = self.root / 'github-output'
        record = ApiFixture().probe()
        with patch.object(reuse, 'probe', return_value=record), patch.dict(os.environ, {'GITHUB_OUTPUT': str(output), 'GH_TOKEN': 'never-log-this-secret'}), redirect_stdout(io.StringIO()) as captured:
            self.assertEqual(reuse.main(['--probe', '--flavor', 'cpu', '--probe-json', str(self.probe_json)]), 0)
        self.assertEqual(output.read_text(), 'reuse=true\nartifact_id=456\n')
        self.assertEqual(json.loads(self.probe_json.read_text()), record)
        self.assertNotIn('never-log-this-secret', captured.getvalue() + self.probe_json.read_text())
        output.write_text('')
        unavailable = {**record, 'reuse': False, 'reason': 'The source runtime job has not completed successfully'}
        unavailable.pop('sourceArtifact')
        with patch.object(reuse, 'probe', return_value=unavailable), patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), redirect_stdout(io.StringIO()):
            reuse.main(['--probe', '--flavor', 'cpu', '--probe-json', str(self.probe_json)])
        self.assertEqual(output.read_text(), 'reuse=false\nartifact_id=\n')

    def test_real_split_zip_is_verified_retagged_and_recorded_without_changing_payload(self):
        before = self.package()
        files = {part['path']: (self.directory / part['path']).read_bytes() for part in before['variants']['cpu']['parts']}
        report = self.verify()
        after = self.catalogue()
        for part in after['variants']['cpu']['parts']:
            self.assertEqual(files[part['path']], (self.directory / part['path']).read_bytes())
            self.assertEqual(part['url'], reuse.packager.RELEASE_BASE + 'v0.4.0-reuse/' + part['path'])
        self.assertEqual(before['variants']['cpu']['archiveSha256'], after['variants']['cpu']['archiveSha256'])
        self.assertEqual(report['inputFingerprint'], reuse.builder.inputs_fingerprint())
        self.assertEqual(report['sourceRun'], reuse.SOURCE_RUN)
        self.assertEqual(report['sourceArtifact']['id'], 456)
        self.assertEqual(json.loads((self.directory / 'runtime-reuse-cpu.json').read_text()), report)
        self.assertFalse((self.directory / 'python-runtime').exists(), 'verification must not extract or execute archive code')

    def test_corrupt_part_and_wrong_whole_archive_hash_cannot_retag(self):
        for kind in ['part', 'archive']:
            with self.subTest(kind=kind):
                catalog = self.package()
                catalog_path = self.directory / 'runtime-catalog-cpu.json'
                if kind == 'part':
                    target = self.directory / catalog['variants']['cpu']['parts'][0]['path']
                    data = bytearray(target.read_bytes())
                    data[0] ^= 1
                    target.write_bytes(data)
                else:
                    catalog['variants']['cpu']['archiveSha256'] = '0' * 64
                    reuse._write_json(catalog_path, catalog)
                original = catalog_path.read_bytes()
                with self.assertRaisesRegex(ValueError, 'SHA-256'):
                    self.verify()
                self.assertEqual(catalog_path.read_bytes(), original)
                self.assertFalse((self.directory / 'runtime-reuse-cpu.json').exists())

    def test_current_fingerprint_revision_and_translation_build_are_mandatory(self):
        for key, value in [('inputFingerprint', '0' * 64), ('revision', 'untrusted-revision'), ('translationRuntime', 'old-runtime')]:
            with self.subTest(key=key):
                self.package({**self.marker, key: value})
                original = (self.directory / 'runtime-catalog-cpu.json').read_bytes()
                with self.assertRaisesRegex(ValueError, key):
                    self.verify()
                self.assertEqual((self.directory / 'runtime-catalog-cpu.json').read_bytes(), original)
        self.package()
        with patch.object(reuse.builder, 'inputs_fingerprint', return_value='c' * 64):
            with self.assertRaisesRegex(ValueError, 'inputFingerprint'):
                self.verify()

    def test_authenticated_archive_still_rejects_wrong_marker_flavor_and_unsafe_paths(self):
        for case in ['flavor', 'traversal', 'duplicate']:
            with self.subTest(case=case):
                self.package()
                output = io.BytesIO()
                with zipfile.ZipFile(io.BytesIO(self.original_bytes())) as old, zipfile.ZipFile(output, 'w') as archive:
                    for name in old.namelist():
                        data = old.read(name)
                        if case == 'flavor' and name == 'python-runtime/yukino-runtime-build.json':
                            data = json.dumps({**self.marker, 'flavor': 'cu124'}).encode()
                        archive.writestr(name, data)
                    if case == 'traversal':
                        archive.writestr('python-runtime/../escape', b'no')
                    elif case == 'duplicate':
                        archive.writestr('PYTHON-RUNTIME/PYTHON.EXE', b'alias')
                self.replace_archive(output.getvalue())
                with self.assertRaisesRegex(ValueError, 'flavor|Unsafe'):
                    self.verify()

    def test_untrusted_provenance_and_unsafe_release_tags_are_rejected_without_retag(self):
        self.package()
        original = (self.directory / 'runtime-catalog-cpu.json').read_bytes()
        for tag in ['../v0.4.0', 'v0.4.0?token=x', 'https://other.example/tag', 'v0.4.0\nartifact_id=evil', '']:
            with self.subTest(tag=tag), self.assertRaisesRegex(ValueError, 'tag'):
                self.verify(tag=tag)
        record = ApiFixture().probe()
        record['sourceCommit'] = 'b' * 40
        reuse._write_json(self.probe_json, record)
        with self.assertRaisesRegex(ValueError, 'authorize'):
            self.verify()
        inside = self.directory / 'probe.json'
        reuse._write_json(inside, ApiFixture().probe())
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.verify(probe_json=inside)
        self.assertEqual((self.directory / 'runtime-catalog-cpu.json').read_bytes(), original)

    def test_part_symlinks_are_never_followed(self):
        catalog = self.package()
        target = self.directory / catalog['variants']['cpu']['parts'][0]['path']
        outside = self.root / 'outside.part'
        outside.write_bytes(target.read_bytes())
        target.unlink()
        try:
            target.symlink_to(outside)
        except OSError:
            self.skipTest('Creating links requires privileges on this platform')
        with self.assertRaisesRegex(ValueError, 'linked'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
