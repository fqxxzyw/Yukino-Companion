const catalogPath = '/__yukino-preview/models';

export async function loadPreviewModels() {
  const response = await fetch(catalogPath, {cache:'no-store'});
  if (response.status === 404 || (response.ok && !response.headers.get('content-type')?.includes('application/json'))) return null;
  if (!response.ok) throw Error('无法读取本地预览模型。');
  const catalog = await response.json();
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw Error('本地预览模型清单无效。');
  return catalog.models.map(entry => {
    if (!entry.runtimeCandidate) return entry;
    const path = `${catalogPath}/${encodeURIComponent(entry.id)}`;
    return {...entry, url:`${path}/model`, previewActionUrl:`${path}/actions`};
  });
}
