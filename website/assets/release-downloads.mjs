const releases = 'https://github.com/fqxxzyw/Yukino-Companion/releases';
const byId = id => document.getElementById(id);

function officialAsset(release, kind) {
  const asset = kind === 'Portable' ? release.portable : release.asset;
  const name = `Yukino-Companion-${release.version}-${kind}.exe`;
  if (asset?.name !== name || !Number.isSafeInteger(asset.size) || asset.size <= 0) return null;
  return asset.url === `${releases}/download/${release.tag}/${name}` ? asset : null;
}

async function refreshDownloads() {
  const status = byId('download-status');
  try {
    const endpoint = new URL('/api/v1/public/downloads', window.YUKINO_SITE_CONFIG?.apiBase || location.origin);
    const response = await fetch(endpoint, {credentials: 'omit', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error();
    const {latest, source, reason} = await response.json();
    if (latest?.channel !== 'stable' || !/^\d+\.\d+\.\d+$/.test(latest.version) ||
        ![latest.version, 'v' + latest.version].includes(latest.tag)) throw Error();
    const setup = officialAsset(latest, 'Base-Setup');
    if (!setup) throw Error();
    const version = 'v' + latest.version;
    for (const id of ['hero-download', 'download-button']) byId(id).href = setup.url;
    byId('download-button').textContent = '下载 Windows 安装版';
    byId('hero-version').textContent = version;
    byId('download-version').textContent = version;
    byId('download-channel').textContent = '正式版';
    byId('download-date').textContent = latest.publishedAt ? new Date(latest.publishedAt).toLocaleDateString('zh-CN') : '—';
    byId('download-file').textContent = `${setup.name} · ${(setup.size / 1048576).toFixed(1)} MiB`;
    byId('release-notes').href = `${releases}/tag/${latest.tag}`;
    const portable = officialAsset(latest, 'Portable');
    if (portable) {
      const link = byId('portable-download');
      link.href = portable.url;
      link.hidden = false;
      link.style.removeProperty('display');
    }
    status.textContent = source === 'cache' && reason ? 'GitHub 暂不可用，显示上次读取的正式版。' : '安装包来自项目的 GitHub Release。';
  } catch {
    byId('hero-version').textContent = '';
    status.textContent = '暂时无法读取正式版安装包，请前往 GitHub 查看最新发布。';
  }
}

void refreshDownloads();
