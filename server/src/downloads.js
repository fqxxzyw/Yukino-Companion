import {cacheGet, cachePut} from './db.js';
import {json} from './util.js';

export const REPOSITORY = 'fqxxzyw/Yukino-Companion';
export const AUTHOR_URL = 'https://github.com/fqxxzyw';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;
const CACHE_KEY = 'downloads:stable-installers-v2';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_INSTALLER_BYTES = 2 * 1024 ** 3;

function releaseAsset(release, name) {
  const expectedUrl = `${RELEASES_URL}/download/${release.tag_name}/${name}`;
  const item = release.assets?.find(asset => asset?.name === name && asset.browser_download_url === expectedUrl
    && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size < MAX_INSTALLER_BYTES);
  if (!item) return null;
  return {name, size: item.size, url: expectedUrl, contentType: item.content_type || 'application/octet-stream', platform: 'windows-x64'};
}

function describe(release) {
  const version = release.tag_name.replace(/^v/, '');
  const base = `Yukino-Companion-${version}`;
  const asset = releaseAsset(release, base + '-Base-Setup.exe');
  if (!asset) return null;
  return {
    version,
    tag: release.tag_name,
    channel: 'stable',
    name: release.name || release.tag_name,
    publishedAt: release.published_at || release.created_at || '',
    body: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
    releaseUrl: `${RELEASES_URL}/tag/${release.tag_name}`,
    asset,
    portable: releaseAsset(release, base + '-Portable.exe'),
    systemRequirements: ['Windows 10/11 x64', '约 1 GB 可用磁盘空间（不含可选语音、本地模型与运行时）', '首次使用完整本地功能可能需要额外下载资源'],
  };
}

export function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  const stable = releases.filter(release => release && !release.draft && !release.prerelease &&
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) && Array.isArray(release.assets));
  const collator = new Intl.Collator('en', {numeric: true});
  stable.sort((a, b) => collator.compare(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, '')));
  for (const release of stable) {
    const result = describe(release);
    if (result) return result;
  }
  return null;
}

function fallback(reason, cached = null) {
  return {
    ok: true,
    source: cached ? 'cache' : 'fallback',
    reason,
    updatedAt: cached?.updatedAt || null,
    releaseUrl: RELEASES_URL,
    repositoryUrl: REPOSITORY_URL,
    authorUrl: AUTHOR_URL,
    latest: cached?.value?.latest || null,
  };
}

export async function getDownloads({db, fetchImpl = globalThis.fetch, now = Date.now()}) {
  const cached = await cacheGet(db, CACHE_KEY, {allowStale: true, now});
  if (cached && !cached.stale) return {...cached.value, source: 'cache', updatedAt: cached.updatedAt};
  try {
    const response = await fetchImpl(API_URL, {
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'Yukino-Companion-Website',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`github_${response.status}`);
    const releases = await response.json();
    const latest = selectLatestRelease(releases);
    if (!latest) throw new Error('no-installer');
    const value = {
      ok: true,
      source: 'github-api',
      updatedAt: now,
      releaseUrl: RELEASES_URL,
      repositoryUrl: REPOSITORY_URL,
      authorUrl: AUTHOR_URL,
      latest,
    };
    await cachePut(db, CACHE_KEY, value, now);
    return value;
  } catch (error) {
    if (cached?.value) return fallback(String(error?.message || 'github-unavailable'), cached);
    return fallback(String(error?.message || 'github-unavailable'));
  }
}

export async function downloadRoute({db, fetchImpl, now}) {
  const value = await getDownloads({db, fetchImpl, now});
  return json(value, {
    headers: {
      'cache-control': value.source === 'github-api' ? 'public, max-age=300, stale-while-revalidate=1800' : 'public, max-age=60',
    },
  });
}
