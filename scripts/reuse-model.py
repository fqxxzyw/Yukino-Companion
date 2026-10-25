"""Reuse one successful pinned model job without rebuilding or executing its contents.

The probe uses authenticated, non-redirecting GitHub REST reads. Keep its JSON
outside the downloaded artifact directory. Verification retains both original
Release ZIPs and checks the exact approved LoRA plus the GGUF and training report.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


api = module('model_reuse_api_helpers', 'reuse-runtime.py')
builder = module('model_reuse_release_builder', 'build-release-local-model.py')
preparer = module('model_reuse_preparer', 'prepare-local-model.py')
REPOSITORY = api.REPOSITORY
WORKFLOW = api.WORKFLOW
SOURCE_RUN = 40180930434
SOURCE_COMMIT = '6d01876f27ca0c3258a8ff340d055d430cd6395c'
SOURCE_JOB = 121131654433
SOURCE_ARTIFACT = 12593559465
SOURCE_ARTIFACT_BYTES = 1003012151
SOURCE_ARTIFACT_DIGEST = 'sha256:87a8cc6143c035d201e3ea451193c5b5384e878d49639401a1ef20d4603ff7e0'
ARTIFACT_NAME = 'actual-trained-local-model'
MODEL_ARCHIVE = 'Yukino-Local-1.5B-Persona-0.4.0.zip'


def source_identity(source_run, source_commit):
    if not api.positive_int(source_run) or not isinstance(source_commit, str) or not re.fullmatch(r'[0-9a-f]{40}', source_commit):
        raise ValueError('Use a positive source run and exact lowercase source commit')
    if source_run != SOURCE_RUN or source_commit != SOURCE_COMMIT:
        raise ValueError('This release permits only its reviewed source run and commit')


def probe(source_run=SOURCE_RUN, source_commit=SOURCE_COMMIT, *, token=None, get=None, now=None):
    source_identity(source_run, source_commit)
    now = now or datetime.now(timezone.utc)
    result = {'schemaVersion': 1, 'repository': REPOSITORY, 'workflow': WORKFLOW,
              'sourceRun': source_run, 'sourceCommit': source_commit,
              'checkedAt': now.isoformat(), 'reuse': False}
    if get is None:
        token = token or os.environ.get('GH_TOKEN', '')
        if not token or '\n' in token or '\r' in token:
            return {**result, 'reason': 'GH_TOKEN is unavailable; model reuse was not authorized'}
        get = lambda route: api.github_json(route, token)
    route = f'/repos/{REPOSITORY}/actions/runs/{source_run}'
    try:
        run = get(route)
        if run.get('id') != source_run or run.get('head_sha') != source_commit or run.get('path') != WORKFLOW:
            raise ValueError('Model source run, commit or workflow differs from the pinned identity')
        for key in ['repository', 'head_repository']:
            if run.get(key, {}).get('full_name', '').casefold() != REPOSITORY.casefold():
                raise ValueError('Model source repository identity mismatch')
        jobs = api._all_pages(get, route + '/jobs?filter=latest', 'jobs')
        jobs = [row for row in jobs if row.get('name') == 'model']
        if len(jobs) != 1:
            raise api.ProbeUnavailable('No unique model job exists in this run attempt')
        job = jobs[0]
        if job.get('run_id') != source_run or job.get('head_sha') != source_commit or job.get('id') != SOURCE_JOB:
            raise ValueError('Model job identity does not match the pinned run')
        if job.get('status') != 'completed' or job.get('conclusion') != 'success':
            raise api.ProbeUnavailable('The pinned model job has not completed successfully')
        artifacts = api._all_pages(get, route + '/artifacts', 'artifacts')
        candidates = [row for row in artifacts if row.get('name') == ARTIFACT_NAME
                      and row.get('expired') is False and api._expiry(row.get('expires_at')) > now]
        if len(candidates) != 1:
            raise api.ProbeUnavailable('No unique unexpired trained-model artifact is available')
        artifact = candidates[0]
        identity = artifact.get('workflow_run', {})
        if (artifact.get('id') != SOURCE_ARTIFACT or artifact.get('size_in_bytes') != SOURCE_ARTIFACT_BYTES
                or artifact.get('digest') != SOURCE_ARTIFACT_DIGEST
                or identity.get('id') != source_run or identity.get('head_sha') != source_commit):
            raise ValueError('Model artifact identity differs from the pinned source')
        return {**result, 'reuse': True, 'sourceRunAttempt': run.get('run_attempt'),
                'sourceJob': {'id': job['id'], 'name': 'model', 'conclusion': 'success', 'headSha': source_commit},
                'sourceArtifact': {'id': artifact['id'], 'name': ARTIFACT_NAME, 'expired': False,
                                   'expiresAt': artifact['expires_at'], 'digest': artifact['digest'], 'bytes': artifact['size_in_bytes']}}
    except api.ProbeUnavailable as error:
        return {**result, 'reason': str(error)}


def validate_provenance(value, source_run, source_commit, now):
    source_identity(source_run, source_commit)
    if (not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('reuse') is not True
            or value.get('repository') != REPOSITORY or value.get('workflow') != WORKFLOW
            or value.get('sourceRun') != source_run or value.get('sourceCommit') != source_commit):
        raise ValueError('Probe record does not authorize this source model')
    job, artifact = value.get('sourceJob', {}), value.get('sourceArtifact', {})
    if (job.get('id') != SOURCE_JOB or job.get('name') != 'model'
            or job.get('conclusion') != 'success' or job.get('headSha') != source_commit):
        raise ValueError('Probe record has no successful matching model job')
    if (artifact.get('id') != SOURCE_ARTIFACT or artifact.get('name') != ARTIFACT_NAME
            or artifact.get('bytes') != SOURCE_ARTIFACT_BYTES or artifact.get('digest') != SOURCE_ARTIFACT_DIGEST
            or artifact.get('expired') is not False or api._expiry(artifact.get('expiresAt')) <= now):
        raise ValueError('Probe record has no unexpired matching model artifact')


def verify(directory, probe_json, *, source_run=SOURCE_RUN, source_commit=SOURCE_COMMIT, now=None):
    now = now or datetime.now(timezone.utc)
    directory, probe_json = Path(directory).resolve(), Path(probe_json).resolve()
    if probe_json.is_relative_to(directory):
        raise ValueError('Probe record must be outside the downloaded model artifact')
    provenance = api._read_json(probe_json)
    validate_provenance(provenance, source_run, source_commit, now)
    archives = []
    for name in [builder.ARCHIVE_NAME, MODEL_ARCHIVE]:
        file = directory / name
        if file.is_symlink() or (hasattr(file, 'is_junction') and file.is_junction()) or not file.is_file() or file.resolve().parent != directory:
            raise ValueError('Model artifact is missing a regular original ZIP: ' + name)
        archives.append(file)
    adapter, gguf = archives
    builder.verify_release_archive(adapter)
    with tempfile.TemporaryDirectory(prefix='yukino-verify-reused-model-') as temporary:
        output = Path(temporary) / 'verified'
        # Existing importer validates all ZIP paths, GGUF magic, byte count and SHA.
        # Only data is extracted; no code or model generation is executed.
        preparer.prepare(gguf, output)
        manifest = api._read_json(output / 'manifest.json')
        training = manifest.get('training', {})
        if (manifest.get('baseModel') != builder.BASE or manifest.get('baseRevision') != builder.REVISION
                or training.get('completed') is not True or training.get('steps') != builder.TRAINING_STEPS
                or training.get('adapterSha256') != builder.ADAPTER_SHA256
                or training.get('task') != 'complete_persona' or training.get('runPurpose') != 'training'):
            raise ValueError('Reused GGUF does not identify the approved 47-step trained adapter')
        report = api._read_json(output / 'training_report.json')
        if (report.get('completed') is not True or report.get('steps') != builder.TRAINING_STEPS
                or report.get('adapter_sha256') != builder.ADAPTER_SHA256
                or report.get('base_revision') != builder.REVISION
                or report.get('task') != 'complete_persona' or report.get('run_purpose') != 'training'):
            raise ValueError('Reused GGUF training report does not match the approved run')
        result = {**provenance, 'verifiedAt': now.isoformat(),
                  'adapterArchive': {'name': adapter.name, 'bytes': adapter.stat().st_size, 'sha256': builder.sha(adapter)},
                  'modelArchive': {'name': gguf.name, 'bytes': gguf.stat().st_size, 'sha256': builder.sha(gguf)},
                  'model': {'file': manifest['file'], 'bytes': manifest['bytes'], 'sha256': manifest['sha256'],
                            'trainingSteps': training['steps'], 'adapterSha256': training['adapterSha256']}}
    api._write_json(directory / 'model-reuse.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--probe', action='store_true')
    modes.add_argument('--verify', action='store_true')
    parser.add_argument('--source-run', type=int, default=SOURCE_RUN)
    parser.add_argument('--source-commit', default=SOURCE_COMMIT)
    parser.add_argument('--probe-json', type=Path, required=True)
    parser.add_argument('--directory', type=Path, default=Path('build/model-distribution'))
    args = parser.parse_args(argv)
    try:
        if args.probe:
            result = probe(args.source_run, args.source_commit)
            api._write_json(args.probe_json, result)
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                    output.write('reuse=' + str(result['reuse']).lower() + '\n')
                    output.write('artifact_id=' + (str(result['sourceArtifact']['id']) if result['reuse'] else '') + '\n')
        else:
            result = verify(args.directory, args.probe_json, source_run=args.source_run, source_commit=args.source_commit)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Model reuse failed: {error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    main()
