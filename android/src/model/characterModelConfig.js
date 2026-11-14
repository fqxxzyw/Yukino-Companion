export const MODEL_MANIFEST_URL = "./models/character-model.json";
export const MODEL_DIRECTORY = "./models/";
export const OUTFITS_DIRECTORY = "./models/local-yukino-outfits/";
export const DEFAULT_OUTFIT_ID = "summer-uniform";

export const OUTFIT_ORDER = [
  "kimono",
  "summer-uniform",
  "swimsuit",
  "black-qipao",
  "twin-tail",
  "beret"
];

export const OUTFIT_LABELS = {
  kimono: "蓝色花纹和服",
  "summer-uniform": "夏日制服",
  swimsuit: "白色连体泳装蓝蝴蝶结",
  "black-qipao": "黑色旗袍",
  "twin-tail": "双马尾",
  beret: "蓝色开衫贝雷帽"
};

export const defaultManifest = {
  id: "yukino-default",
  displayName: "雪之下雪乃",
  file: "yukino.glb",
  format: "auto",
  scale: 1,
  position: [0, 0, 0],
  rotationY: 0,
  camera: { fov: 28, position: [0, 1.15, 2.6], target: [0, 0.95, 0] },
  defaultOutfit: DEFAULT_OUTFIT_ID,
  outfits: []
};

export function resolveModelUrl(manifest, base) {
  const file = String(manifest?.file || "").trim();
  if (!file) return "";
  if (/^https?:\/\//i.test(file)) return file;
  const root = String(base || manifest?.base || MODEL_DIRECTORY);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return prefix + file.replace(/^\.\//, "");
}

export function resolveOutfitDirectory(manifest) {
  const dir = String(manifest?.directory || "").trim();
  if (!dir) return OUTFITS_DIRECTORY;
  if (/^https?:\/\//i.test(dir) || dir.startsWith("./")) {
    return dir.endsWith("/") ? dir : `${dir}/`;
  }
  return `${MODEL_DIRECTORY}${dir.endsWith("/") ? dir : `${dir}/`}`;
}

export function detectFormat(manifest) {
  const explicit = String(manifest?.format || "auto").toLowerCase();
  if (explicit === "vrm" || explicit === "glb" || explicit === "gltf") return explicit;
  const file = String(manifest?.file || "").toLowerCase();
  if (file.endsWith(".vrm")) return "vrm";
  if (file.endsWith(".gltf")) return "gltf";
  return "glb";
}

export function listOutfits(manifest) {
  const items = Array.isArray(manifest?.outfits) ? manifest.outfits : [];
  const byId = new Map();
  for (const item of items) {
    if (!item || !item.id || !item.file) continue;
    byId.set(String(item.id), {
      ...item,
      id: String(item.id),
      label: item.label || OUTFIT_LABELS[item.id] || item.id,
      format: item.format || "vrm",
      bundled: item.bundled !== false
    });
  }
  const ordered = [];
  for (const id of OUTFIT_ORDER) if (byId.has(id)) ordered.push(byId.get(id));
  for (const item of byId.values()) if (!ordered.some((entry) => entry.id === item.id)) ordered.push(item);
  return ordered;
}

export function resolveOutfit(manifest, outfitId) {
  const outfits = listOutfits(manifest);
  if (!outfits.length) return null;
  const wanted = String(outfitId || manifest?.defaultOutfit || DEFAULT_OUTFIT_ID);
  return outfits.find((item) => item.id === wanted) || outfits.find((item) => item.id === DEFAULT_OUTFIT_ID) || outfits[0];
}

export function outfitEntry(outfit) {
  if (!outfit) return null;
  return {
    id: outfit.id,
    sha256: outfit.sha256,
    runtimeCandidate: outfit.id,
    actionPack: outfit.actionPack,
    clips: outfit.clips || {}
  };
}

export async function loadManifest(url = MODEL_MANIFEST_URL, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res.ok) return { ...defaultManifest, missing: true };
  const data = await res.json();
  const merged = { ...defaultManifest, ...data, missing: false };
  const outfits = listOutfits(merged);
  const directory = resolveOutfitDirectory(merged);
  return {
    ...merged,
    outfits: outfits.map((item) => ({ ...item, base: directory })),
    defaultOutfit: outfits.some((item) => item.id === merged.defaultOutfit) ? merged.defaultOutfit : (outfits[0]?.id || DEFAULT_OUTFIT_ID)
  };
}

export async function modelExists(url, fetchImpl = fetch) {
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { method: "HEAD", cache: "no-store" });
    if (res.ok) return true;
    if (res.status === 405 || res.status === 501) {
      const get = await fetchImpl(url, { method: "GET", cache: "no-store" });
      return get.ok;
    }
    return false;
  } catch {
    return false;
  }
}
