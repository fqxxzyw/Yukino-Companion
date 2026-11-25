import test from 'node:test';
import assert from 'node:assert/strict';
import {getDownloads, selectLatestRelease, RELEASES_URL} from '../src/downloads.js';
import {NodeD1, migrate} from '../dev/node-d1.mjs';
import {readFile} from 'node:fs/promises';

const asset = (version, overrides = {}) => ({
  name: `Yukino-Companion-${version}-Base-Setup.exe`,
  size: 123456789,
  browser_download_url: `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v${version}/Yukino-Companion-${version}-Base-Setup.exe`,
  content_type: 'application/octet-stream',
  ...overrides,
});

test('installer selection prefers stable Windows installers and ignores model packs', () => {
  const releases = [
    {
      tag_name: 'v0.5.0', draft: false, prerelease: false, published_at: '2026-11-10T00:00:00Z', html_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.5.0',
      assets: [{name: 'voice-pack.zip', size: 900, browser_download_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.5.0/voice-pack.zip'}, asset('0.5.0')],
    },
    {
      tag_name: 'v0.6.0-beta', draft: false, prerelease: true, published_at: '2026-11-12T00:00:00Z', html_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.6.0-beta',
      assets: [asset('0.6.0-beta')],
    },
    {tag_name: 'v0.4.9', draft: true, prerelease: false, published_at: '2026-11-01T00:00:00Z', assets: [asset('0.4.9')]},
  ];
  const latest = selectLatestRelease(releases);
  assert.equal(latest.version, '0.5.0');
  assert.equal(latest.channel, 'stable');
  assert.equal(latest.asset.name, 'Yukino-Companion-0.5.0-Base-Setup.exe');
  assert.match(latest.asset.url, /^https:\/\/github\.com\/fqxxzyw\/Yukino-Companion\/releases\/download\//);
});

test('website ignores prereleases even when no stable asset exists', () => {
  const latest = selectLatestRelease([{
    tag_name: 'v0.6.0-beta', draft: false, prerelease: true, published_at: '2026-11-12T00:00:00Z',
    html_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.6.0-beta', assets: [asset('0.6.0-beta')],
  }]);
  assert.equal(latest, null);
});

test('untrusted download URLs are rejected', () => {
  assert.equal(selectLatestRelease([{
    tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2026-11-12T00:00:00Z',
    assets: [asset('1.0.0', {browser_download_url: 'https://evil.example/Yukino-Companion-1.0.0-Base-Setup.exe'})],
  }]), null);
  assert.equal(selectLatestRelease([{tag_name: 'v1.0.0', assets: [{name: 'Yukino-Companion-1.0.0-Base-Setup.exe', size: 10, browser_download_url: 'https://github.com/other/repo/releases/download/v1.0.0/x.exe'}]}]), null);
});

test('GitHub failure uses a recent verified cache, then a releases fallback', async () => {
  const db = new NodeD1(':memory:');
  migrate(db, await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const releases = [{
    tag_name: 'v0.5.0', draft: false, prerelease: false, published_at: '2026-11-10T00:00:00Z',
    html_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.5.0', assets: [asset('0.5.0')],
  }];
  let calls = 0;
  const online = await getDownloads({db, fetchImpl: async () => { calls += 1; return new Response(JSON.stringify(releases), {status: 200}); }});
  assert.equal(online.source, 'github-api');
  assert.equal(online.latest.version, '0.5.0');

  const cached = await getDownloads({db, fetchImpl: async () => { throw new Error('offline'); }, now: Date.now() + 60 * 1000});
  assert.equal(cached.source, 'cache');
  assert.equal(cached.latest.version, '0.5.0');

  const stale = await getDownloads({db, fetchImpl: async () => { throw new Error('offline'); }, now: Date.now() + 60 * 60 * 1000});
  assert.equal(stale.source, 'cache');
  assert.equal(stale.latest.version, '0.5.0');

  const emptyDb = new NodeD1(':memory:');
  migrate(emptyDb, await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const fallback = await getDownloads({db: emptyDb, fetchImpl: async () => { throw new Error('offline'); }});
  assert.equal(fallback.source, 'fallback');
  assert.equal(fallback.releaseUrl, RELEASES_URL);
  assert.equal(fallback.latest, null);
  assert.equal(calls, 1);
});

test('website rejects a preview tag even when published as stable', () => {
  const latest = selectLatestRelease([{
    tag_name: 'v0.4.0-test.20261110.2', draft: false, prerelease: false, published_at: '2026-11-10T00:00:00Z',
    html_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-test.20261110.2',
    assets: [{...asset('0.4.0-Base'), browser_download_url: 'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-test.20261110.2/Yukino-Companion-0.4.0-Base-Base-Setup.exe'}],
  }]);
  assert.equal(latest, null);
});

test('website links use the highest official release and its exact setup and portable assets', () => {
  const base = asset('0.4.10');
  const portable = {...base, name: base.name.replace('Base-Setup','Portable'), browser_download_url: base.browser_download_url.replace('Base-Setup','Portable')};
  const latest = selectLatestRelease([
    {tag_name:'v0.4.9', published_at:'2026-11-20', assets:[asset('0.4.9')]},
    {tag_name:'v0.4.10', published_at:'2026-11-19', assets:[base, portable]},
    {tag_name:'v0.4.11', assets:[base, portable]},
  ]);
  assert.equal(latest.asset.url, base.browser_download_url);
  assert.equal(latest.portable.url, portable.browser_download_url);
});
