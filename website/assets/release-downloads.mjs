const releases = 'https://github.com/fqxxzyw/Yukino-Companion/releases';
const r2Releases = 'https://dl.yukino.fqxxzyw.cn/releases';
const byId = id => document.getElementById(id);

function officialAsset(release, kind) {
  const asset = kind === 'Portable' ? release.portable : release.asset;
  const name = `Yukino-Companion-${release.version}-${kind}.exe`;
  if (asset?.name !== name || !Number.isSafeInteger(asset.size) || asset.size <= 0) return null;
  const expectedGithub = `${releases}/download/${release.tag}/${name}`;
  const expectedCn = `${r2Releases}/${release.tag}/${name}`;
  const primary = asset.url === expectedCn || asset.url === expectedGithub ? asset.url : null;
  if (!primary) return null;
  const cnUrl = asset.cnUrl === expectedCn ? asset.cnUrl : expectedCn;
  const githubUrl = asset.githubUrl === expectedGithub ? asset.githubUrl : expectedGithub;
  return {
    ...asset,
    url: cnUrl,
    cnUrl,
    githubUrl,
  };
}

function setBackupLink(id, href, text) {
  const node = byId(id);
  if (!node) return;
  if (href) {
    node.href = href;
    if (text) node.textContent = text;
    node.hidden = false;
    node.style.removeProperty('display');
  } else {
    node.hidden = true;
  }
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
    const primarySetupUrl = setup.cnUrl || setup.url;
    for (const id of ['hero-download', 'download-button']) {
      const node = byId(id);
      if (node) node.href = primarySetupUrl;
    }
    if (byId('download-button')) byId('download-button').textContent = '下载 Windows 安装版（国内高速）';
    if (byId('hero-version')) byId('hero-version').textContent = version;
    if (byId('download-version')) byId('download-version').textContent = version;
    if (byId('download-channel')) byId('download-channel').textContent = '正式版';
    if (byId('download-date')) byId('download-date').textContent = latest.publishedAt ? new Date(latest.publishedAt).toLocaleDateString('zh-CN') : '—';
    if (byId('download-file')) byId('download-file').textContent = `${setup.name} · ${(setup.size / 1048576).toFixed(1)} MiB`;
    if (byId('release-notes')) byId('release-notes').href = `${releases}/tag/${latest.tag}`;
    setBackupLink('download-button-github', setup.githubUrl, 'GitHub 安装版 ↗');
    const portable = officialAsset(latest, 'Portable');
    if (portable) {
      const link = byId('portable-download');
      if (link) {
        link.href = portable.cnUrl || portable.url;
        link.textContent = '下载便携版（国内高速）';
        link.hidden = false;
        link.style.removeProperty('display');
      }
      setBackupLink('portable-download-github', portable.githubUrl, 'GitHub 便携版 ↗');
    }
    const backups = byId('download-backups');
    if (backups) backups.hidden = false;
    if (status) {
      status.textContent = source === 'cache' && reason
        ? '优先通过国内高速节点（dl.yukino.fqxxzyw.cn）下载；当前显示缓存版本，亦可使用 GitHub 备用链接。'
        : '优先通过国内高速节点（dl.yukino.fqxxzyw.cn）下载；如遇异常可直接使用下方 GitHub 备用链接。';
    }
  } catch {
    if (byId('hero-version')) byId('hero-version').textContent = '';
    if (status) status.textContent = '暂时无法读取最新版本号，请使用主按钮或前往 GitHub Releases 查看最新发布。';
  }
}

void refreshDownloads();
