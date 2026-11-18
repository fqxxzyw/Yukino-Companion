import {cacheGet, cachePut} from './db.js';
import {json} from './util.js';

export const REPOSITORY = 'fqxxzyw/Yukino-Companion';
export const AUTHOR_URL = 'https://github.com/fqxxzyw';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;
const CACHE_KEY = 'downloads:latest';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_INSTALLER_BYTES = 2 * 1024 ** 3;

function trustedUrl(value, tag, name) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && url.pathname === `/${REPOSITORY}/releases/download/${tag}/${name}`;
  } catch { return false; }
}

function installerAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const candidates = assets.filter((asset) => {
    const name = String(asset?.name || '');
    return /^Yukino-Companion-.*-Setup\.exe$/i.test(name)
      && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size < MAX_INSTALLER_BYTES;
  });
  const chosen = candidates.find((asset) => /x64|win/i.test(String(asset.label || asset.name || ''))) || candidates[0];
  if (!chosen) return null;
  if (!trustedUrl(chosen.browser_download_url, release.tag_name, chosen.name)) return null;
  return {
    name: chosen.name,
    size: chosen.size,
    url: chosen.browser_download_url,
    contentType: chosen.content_type || 'application/vnd.microsoft.portable-executable',
    platform: 'windows-x64',
  };
}

function describe(release, channel) {
  const asset = installerAsset(release);
  if (!asset) return null;
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    tag: String(release.tag_name || ''),
    channel,
    name: String(release.name || release.tag_name || ''),
    publishedAt: release.published_at || release.created_at || '',
    body: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
    releaseUrl: release.html_url || RELEASES_URL,
    asset,
    systemRequirements: ['Windows 10/11 x64', '约 1 GB 可用磁盘空间（不含可选语音、本地模型与运行时）', '首次使用完整本地功能可能需要额外下载资源'],
  };
}

export function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  const sorted = releases
    .filter((release) => release && !release.draft && release.tag_name)
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  // A GitHub release can be published with prerelease=false while its tag still
  // says test/beta. Treat those as preview builds and never hide that fact.
  const previewTag = (release) => release.prerelease === true || /(?:^|[-._])(test|beta|preview|rc)/i.test(String(release.tag_name || ''));
  const stable = sorted.filter((release) => !previewTag(release));
  for (const release of stable) {
    const result = describe(release, 'stable');
    if (result) return result;
  }
  for (const release of sorted.filter(previewTag)) {
    const result = describe(release, 'prerelease');
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
