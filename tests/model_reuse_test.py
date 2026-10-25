"""Pinned API identity and tiny real model ZIP verification; no inference or downloads."""
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('model_reuse', Path(__file__).resolve().parents[1] / 'scripts/reuse-model.py')
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)
NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


class ModelReuseTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='model-reuse-test-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.run = {'id': reuse.SOURCE_RUN, 'head_sha': reuse.SOURCE_COMMIT, 'path': reuse.WORKFLOW,
                    'repository': {'full_name': reuse.REPOSITORY}, 'head_repository': {'full_name': reuse.REPOSITORY},
                    'run_attempt': 1, 'status': 'in_progress', 'conclusion': None}
        self.job = {'id': reuse.SOURCE_JOB, 'name': 'model', 'run_id': reuse.SOURCE_RUN,
                    'head_sha': reuse.SOURCE_COMMIT, 'status': 'completed', 'conclusion': 'success'}
        self.artifact = {'id': reuse.SOURCE_ARTIFACT, 'name': reuse.ARTIFACT_NAME, 'expired': False,
                         'expires_at': '2099-01-01T00:00:00Z', 'digest': reuse.SOURCE_ARTIFACT_DIGEST,
                         'size_in_bytes': reuse.SOURCE_ARTIFACT_BYTES,
                         'workflow_run': {'id': reuse.SOURCE_RUN, 'head_sha': reuse.SOURCE_COMMIT}}
        self.artifacts = [self.artifact]

    def get(self, route):
        if '/jobs?' in route:
            return {'total_count': 1, 'jobs': [copy.deepcopy(self.job)]}
        if '/artifacts?' in route:
            return {'total_count': len(self.artifacts), 'artifacts': copy.deepcopy(self.artifacts)}
        return copy.deepcopy(self.run)

    def probe(self):
        return reuse.probe(get=self.get, now=NOW)

    def fixture(self, steps=47, unsafe=False):
        directory = self.root / 'artifact'
        directory.mkdir()
        adapter = directory / reuse.builder.ARCHIVE_NAME
        with zipfile.ZipFile(adapter, 'w') as package:
            package.writestr('adapter/adapter_model.safetensors', b'synthetic test weights')
        for name, value in [('ARCHIVE_BYTES', adapter.stat().st_size), ('ARCHIVE_SHA256', reuse.builder.sha(adapter))]:
            context = patch.object(reuse.builder, name, value)
            context.start(); self.addCleanup(context.stop)
        weights = b'GGUF synthetic test fixture, not a model'
        manifest = {'name': 'Synthetic fixture', 'file': 'fixture.gguf', 'bytes': len(weights),
                    'sha256': hashlib.sha256(weights).hexdigest(), 'baseModel': reuse.builder.BASE,
                    'baseRevision': reuse.builder.REVISION, 'training': {'completed': True, 'steps': steps,
                        'adapterSha256': reuse.builder.ADAPTER_SHA256, 'task': 'complete_persona', 'runPurpose': 'training'}}
        report = {'completed': True, 'steps': steps, 'adapter_sha256': reuse.builder.ADAPTER_SHA256,
                  'base_revision': reuse.builder.REVISION, 'task': 'complete_persona', 'run_purpose': 'training'}
        with zipfile.ZipFile(directory / reuse.MODEL_ARCHIVE, 'w') as package:
            package.writestr('manifest.json', json.dumps(manifest))
            package.writestr('training_report.json', json.dumps(report))
            package.writestr('fixture.gguf', weights)
            if unsafe: package.writestr('../outside.py', 'raise RuntimeError("must never execute")')
        probe_json = self.root / 'probe.json'
        reuse.api._write_json(probe_json, self.probe())
        return directory, probe_json

    def test_successful_model_can_be_reused_while_other_jobs_are_unfinished(self):
        result = self.probe()
        self.assertTrue(result['reuse'])
        self.assertEqual(result['sourceArtifact']['id'], reuse.SOURCE_ARTIFACT)

    def test_identity_mismatch_hard_fails(self):
        self.run['head_sha'] = 'a' * 40
        with self.assertRaises(ValueError): self.probe()

    def test_incomplete_job_and_missing_or_ambiguous_artifact_cannot_be_reused(self):
        self.job['status'] = 'in_progress'
        self.assertFalse(self.probe()['reuse'])
        self.job['status'] = 'completed'
        self.artifacts = []
        self.assertFalse(self.probe()['reuse'])
        self.artifacts = [self.artifact, copy.deepcopy(self.artifact)]
        self.assertFalse(self.probe()['reuse'])

    def test_wrong_artifact_digest_hard_fails(self):
        self.artifact['digest'] = 'sha256:' + '0' * 64
        with self.assertRaises(ValueError): self.probe()

    def test_valid_archives_remain_byte_identical_and_record_provenance(self):
        directory, probe_json = self.fixture()
        before = {p.name: p.read_bytes() for p in directory.glob('*.zip')}
        result = reuse.verify(directory, probe_json, now=NOW)
        self.assertEqual(result['model']['trainingSteps'], 47)
        self.assertTrue((directory / 'model-reuse.json').is_file())
        self.assertEqual(before, {p.name: p.read_bytes() for p in directory.glob('*.zip')})

    def test_wrong_training_steps_or_unsafe_archive_fail_closed(self):
        directory, probe_json = self.fixture(steps=1)
        with self.assertRaisesRegex(ValueError, '47-step'):
            reuse.verify(directory, probe_json, now=NOW)

    def test_archive_cannot_write_outside_extraction_or_supply_probe_record(self):
        directory, probe_json = self.fixture(unsafe=True)
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            reuse.verify(directory, probe_json, now=NOW)
        with self.assertRaisesRegex(ValueError, 'outside'):
            reuse.verify(directory, directory / 'fake-probe.json', now=NOW)

    def test_modified_lora_is_rejected(self):
        directory, probe_json = self.fixture()
        with (directory / reuse.builder.ARCHIVE_NAME).open('ab') as stream: stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'approved'):
            reuse.verify(directory, probe_json, now=NOW)


if __name__ == '__main__':
    unittest.main()
