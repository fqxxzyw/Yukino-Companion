"""Reuse an independently successful, pinned Windows runtime Actions artifact.

The probe talks only to api.github.com with GH_TOKEN. Keep --probe-json outside
the downloaded artifact directory. Verification never executes archive content;
it validates every part and the complete archive, reads its build marker, and
retargets only the release URLs after the current input fingerprint matches.

REST contracts: https://docs.github.com/en/rest/actions/workflow-runs,
https://docs.github.com/en/rest/actions/workflow-jobs and
https://docs.github.com/en/rest/actions/artifacts.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.error
import urllib.request
import zipfile

REPOSITORY = 'fqxxzyw/Yukino-Companion'
WORKFLOW = '.github/workflows/windows.yml'
SOURCE_RUN = 40176955172
SOURCE_COMMIT = '924c35fae9b058f75a1a56d4a9abeb98d016c024'
TRANSLATION_RUNTIME = 'llama-cpp-python-0.3.36'
PROJECT = Path(__file__).resolve().parents[1]
FLAVORS = ('cpu', 'cu124')
CHUNK = 1024 * 1024


def _module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


packager = _module('reuse_runtime_packager', 'package-runtime.py')
builder = _module('reuse_runtime_builder', 'build_windows_runtime.py')


class ProbeUnavailable(Exception):
    """A missing/unfinished artifact may safely fall back to a clean build."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None  # Never forward GH_TOKEN to a redirected host.


def github_json(route, token):
    if not route.startswith(f'/repos/{REPOSITORY}/actions/') or '\n' in route:
        raise ValueError('Unexpected GitHub API route')
    request = urllib.request.Request('https://api.github.com' + route, headers={
        'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Yukino-Runtime-Reuse',
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            if response.status != 200:
                raise ProbeUnavailable(f'GitHub API unavailable (HTTP {response.status})')
            data = response.read(8 * CHUNK + 1)
    except urllib.error.HTTPError as error:
        raise ProbeUnavailable(f'GitHub API unavailable (HTTP {error.code})') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ProbeUnavailable('GitHub API could not be reached') from None
    if len(data) > 8 * CHUNK:
        raise ValueError('GitHub API response is too large')
    try:
        result = json.loads(data)
    except (ValueError, UnicodeError):
        raise ValueError('GitHub API returned invalid JSON') from None
    if not isinstance(result, dict):
        raise ValueError('GitHub API returned an unexpected object')
    return result


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _source(source_run, source_commit, flavor):
    if not positive_int(source_run) or not re.fullmatch(r'[0-9a-f]{40}', source_commit):
        raise ValueError('Use a positive source run ID and an exact lowercase commit SHA')
    if flavor not in FLAVORS:
        raise ValueError('Unsupported runtime flavor')


def _expiry(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed
    except (AttributeError, TypeError, ValueError):
        raise ValueError('Artifact expiry is missing or invalid') from None


def _all_pages(get, route, key):
    rows = []
    for page in range(1, 11):
        response = get(route + ('&' if '?' in route else '?') + f'per_page=100&page={page}')
        current = response.get(key)
        total = response.get('total_count')
        if not isinstance(current, list) or any(not isinstance(row, dict) for row in current) or not isinstance(total, int) or total < 0:
            raise ValueError('GitHub API returned an invalid paginated list')
        rows.extend(current)
        if len(rows) >= total or len(current) < 100:
            return rows
    raise ProbeUnavailable('GitHub result list exceeds the supported limit')


def probe(source_run, source_commit, flavor, *, token=None, get=None, now=None):
    """Return a serializable provenance record, without downloading any artifact."""
    _source(source_run, source_commit, flavor)
    now = now or datetime.now(timezone.utc)
    base = {'schemaVersion': 1, 'repository': REPOSITORY, 'workflow': WORKFLOW,
            'sourceRun': source_run, 'sourceCommit': source_commit, 'flavor': flavor,
            'checkedAt': now.isoformat(), 'reuse': False}
    if get is None:
        token = token or os.environ.get('GH_TOKEN', '')
        if not token or '\n' in token or '\r' in token:
            return {**base, 'reason': 'GH_TOKEN is unavailable; build a new runtime'}
        get = lambda route: github_json(route, token)
    route = f'/repos/{REPOSITORY}/actions/runs/{source_run}'
    try:
        run = get(route)
        if run.get('head_sha') != source_commit:
            raise ValueError('Source workflow commit does not match the pinned commit')
        if run.get('id') != source_run or run.get('path') != WORKFLOW:
            raise ValueError('Source run or workflow path does not match the pinned workflow')
        if run.get('repository', {}).get('full_name', '').casefold() != REPOSITORY.casefold():
            raise ValueError('Source workflow belongs to another repository')
        if run.get('head_repository', {}).get('full_name', '').casefold() != REPOSITORY.casefold():
            raise ValueError('Source workflow head must belong to the same repository')
        jobs = _all_pages(get, route + '/jobs?filter=latest', 'jobs')
        candidates = [job for job in jobs if job.get('name') == f'runtime ({flavor})']
        if len(candidates) != 1:
            raise ProbeUnavailable('No unique runtime job was found for this flavor')
        job = candidates[0]
        if job.get('run_id') != source_run or job.get('head_sha') != source_commit or not positive_int(job.get('id')):
            raise ValueError('Runtime job identity differs from the pinned source run')
        if job.get('status') != 'completed' or job.get('conclusion') != 'success':
            raise ProbeUnavailable('The source runtime job has not completed successfully')
        artifacts = _all_pages(get, route + '/artifacts', 'artifacts')
        matches = [item for item in artifacts if item.get('name') == f'inference-runtime-{flavor}']
        usable = [item for item in matches if item.get('expired') is False and _expiry(item.get('expires_at')) > now]
        if len(usable) != 1:
            raise ProbeUnavailable('No unique unexpired runtime artifact was found')
        artifact = usable[0]
        if not positive_int(artifact.get('id')):
            raise ValueError('Runtime artifact ID is invalid')
        identity = artifact.get('workflow_run', {})
        if identity.get('id') != source_run or identity.get('head_sha') != source_commit:
            raise ValueError('Runtime artifact identity differs from the pinned source run')
        return {**base, 'reuse': True,
                'sourceJob': {'id': job['id'], 'name': job['name'], 'conclusion': 'success', 'headSha': job['head_sha']},
                'sourceArtifact': {'id': artifact['id'], 'name': artifact['name'], 'expired': False,
                                   'expiresAt': artifact['expires_at'], 'digest': artifact.get('digest')},
                'sourceRunAttempt': run.get('run_attempt')}
    except ProbeUnavailable as error:
        return {**base, 'reason': str(error)}


def _read_json(filename, limit=2 * CHUNK):
    with Path(filename).open('rb') as source:
        value = source.read(limit + 1)
    if len(value) > limit:
        raise ValueError('JSON metadata is too large')
    return json.loads(value.decode('utf-8-sig'))


def _write_json(filename, value):
    filename = Path(filename)
    filename.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=filename.parent,
                                     prefix='.' + filename.name + '-', suffix='.tmp', delete=False) as target:
        temporary = Path(target.name)
        json.dump(value, target, ensure_ascii=False, indent=2)
        target.write('\n')
    try:
        os.replace(temporary, filename)
    finally:
        temporary.unlink(missing_ok=True)


class JoinedParts(io.RawIOBase):
    """Seek over validated ZIP parts without creating a second multi-GB copy."""
    def __init__(self, paths):
        super().__init__()
        self.handles = []
        self.offsets = [0]
        self.position = 0
        try:
            for file in paths:
                self.handles.append(Path(file).open('rb'))
                self.offsets.append(self.offsets[-1] + Path(file).stat().st_size)
        except Exception:
            self.close()
            raise

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=os.SEEK_SET):
        if whence not in (os.SEEK_SET, os.SEEK_CUR, os.SEEK_END):
            raise ValueError('Unsupported seek mode')
        position = offset + (self.position if whence == os.SEEK_CUR else self.offsets[-1] if whence == os.SEEK_END else 0)
        if position < 0:
            raise ValueError('Seek before the archive start')
        self.position = position
        return position

    def read(self, size=-1):
        remaining = max(0, self.offsets[-1] - self.position)
        size = remaining if size is None or size < 0 else min(size, remaining)
        if size > 64 * CHUNK:
            raise ValueError('Runtime ZIP metadata exceeds the read limit')
        output = bytearray()
        while len(output) < size:
            index = bisect_right(self.offsets, self.position) - 1
            source = self.handles[index]
            source.seek(self.position - self.offsets[index])
            data = source.read(min(size - len(output), self.offsets[index + 1] - self.position))
            if not data:
                raise ValueError('Runtime part was truncated during verification')
            output.extend(data)
            self.position += len(data)
        return bytes(output)

    def close(self):
        for source in self.handles:
            source.close()
        super().close()


def _validate_provenance(value, source_run, source_commit, flavor, now):
    _source(source_run, source_commit, flavor)
    if (not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('reuse') is not True
            or value.get('repository') != REPOSITORY or value.get('workflow') != WORKFLOW
            or value.get('sourceRun') != source_run or value.get('sourceCommit') != source_commit
            or value.get('flavor') != flavor):
        raise ValueError('Probe record does not authorize this source runtime')
    job, artifact = value.get('sourceJob', {}), value.get('sourceArtifact', {})
    if (not positive_int(job.get('id')) or job.get('name') != f'runtime ({flavor})'
            or job.get('conclusion') != 'success' or job.get('headSha') != source_commit):
        raise ValueError('Probe record has no successful matching runtime job')
    if (not positive_int(artifact.get('id')) or artifact.get('name') != f'inference-runtime-{flavor}'
            or artifact.get('expired') is not False or _expiry(artifact.get('expiresAt')) <= now):
        raise ValueError('Probe record has no unexpired matching artifact')


def verify(directory, flavor, tag, probe_json, *, source_run=SOURCE_RUN, source_commit=SOURCE_COMMIT, now=None):
    now = now or datetime.now(timezone.utc)
    _source(source_run, source_commit, flavor)
    if not isinstance(tag, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', tag):
        raise ValueError('Release tag must be a safe single tag, without paths or query parameters')
    directory, probe_json = Path(directory).resolve(), Path(probe_json).resolve()
    if probe_json.is_relative_to(directory):
        raise ValueError('Probe record must be outside the downloaded artifact directory')
    provenance = _read_json(probe_json)
    _validate_provenance(provenance, source_run, source_commit, flavor, now)
    catalog_path = directory / f'runtime-catalog-{flavor}.json'
    if catalog_path.is_symlink() or catalog_path.resolve().parent != directory or not catalog_path.is_file():
        raise ValueError('Runtime catalogue must be a regular file inside the artifact directory')
    with catalog_path.open('rb') as source:
        catalog_bytes = source.read(2 * CHUNK + 1)
    if len(catalog_bytes) > 2 * CHUNK:
        raise ValueError('Runtime catalogue is too large')
    catalog = json.loads(catalog_bytes.decode('utf-8-sig'))
    if not isinstance(catalog, dict):
        raise ValueError('Runtime catalogue must be an object')
    catalog = packager.validate_catalog(catalog)
    if set(catalog['variants']) != {flavor}:
        raise ValueError('Downloaded artifact must contain only its requested runtime flavor')
    variant, paths = catalog['variants'][flavor], []
    archive_hash = hashlib.sha256()
    for part in variant['parts']:
        file = directory / part['path']
        if file.is_symlink() or (hasattr(file, 'is_junction') and file.is_junction()) or file.resolve().parent != directory or not file.is_file():
            raise ValueError('Runtime part is missing, linked or outside its directory')
        if file.stat().st_size != part['bytes']:
            raise ValueError('Runtime part length mismatch')
        digest = hashlib.sha256()
        with file.open('rb') as source:
            for block in iter(lambda: source.read(CHUNK), b''):
                digest.update(block)
                archive_hash.update(block)
        if digest.hexdigest() != part['digest']:
            raise ValueError('Runtime part SHA-256 mismatch')
        paths.append(file)
    if archive_hash.hexdigest() != variant['archiveSha256']:
        raise ValueError('Runtime archive SHA-256 mismatch')
    with JoinedParts(paths) as joined, zipfile.ZipFile(joined) as archive:
        entries = archive.infolist()
        if len(entries) > 200000:
            raise ValueError('Runtime ZIP contains too many entries')
        seen, total = set(), 0
        for item in entries:
            names = item.filename.split('/')
            if (names[0] not in {'python-runtime', 'inference-engine'}
                    or any(name in {'', '.', '..'} for name in names) or '\\' in item.filename
                    or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16)
                    or item.filename.casefold() in seen or item.flag_bits & 1):
                raise ValueError('Unsafe or duplicate runtime ZIP entry')
            seen.add(item.filename.casefold())
            total += item.file_size
        if total != variant['unpackedBytes']:
            raise ValueError('Runtime unpacked byte count does not match the catalogue')
        marker_info = archive.getinfo('python-runtime/yukino-runtime-build.json')
        if marker_info.file_size > CHUNK:
            raise ValueError('Runtime build marker is too large')
        marker = json.loads(archive.read(marker_info).decode('utf-8-sig'))
        if not isinstance(marker, dict):
            raise ValueError('Runtime build marker must be an object')
    expected = {'flavor': flavor, 'revision': builder.REVISION,
                'translationRuntime': TRANSLATION_RUNTIME, 'inputFingerprint': builder.inputs_fingerprint()}
    for name, value in expected.items():
        if marker.get(name) != value:
            raise ValueError(f'Runtime build marker {name} does not match the current source; rebuild instead')
    for part in variant['parts']:
        part['url'] = f'{packager.RELEASE_BASE}{tag}/{part["path"]}'
    packager.validate_catalog(catalog)
    report = {**provenance, 'verifiedAt': now.isoformat(), 'targetTag': tag,
              'archiveSha256': variant['archiveSha256'], 'archiveBytes': variant['bytes'],
              'inputFingerprint': expected['inputFingerprint'], 'revision': expected['revision'],
              'translationRuntime': expected['translationRuntime'],
              'sourceCatalogSha256': hashlib.sha256(catalog_bytes).hexdigest(),
              'catalog': catalog_path.name, 'partCount': len(paths)}
    _write_json(directory / f'runtime-reuse-{flavor}.json', report)
    _write_json(catalog_path, catalog)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--probe', action='store_true')
    modes.add_argument('--verify', action='store_true')
    parser.add_argument('--source-run', type=int, default=SOURCE_RUN)
    parser.add_argument('--source-commit', default=SOURCE_COMMIT)
    parser.add_argument('--flavor', choices=FLAVORS, required=True)
    parser.add_argument('--probe-json', type=Path, required=True)
    parser.add_argument('--directory', type=Path, default=PROJECT / 'build/runtime-distribution')
    parser.add_argument('--tag')
    args = parser.parse_args(argv)
    try:
        if args.probe:
            result = probe(args.source_run, args.source_commit, args.flavor)
            _write_json(args.probe_json, result)
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                    output.write('reuse=' + str(result['reuse']).lower() + '\n')
                    output.write('artifact_id=' + (str(result['sourceArtifact']['id']) if result['reuse'] else '') + '\n')
        else:
            result = verify(args.directory, args.flavor, args.tag, args.probe_json,
                            source_run=args.source_run, source_commit=args.source_commit)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Runtime reuse failed: {error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    main()
