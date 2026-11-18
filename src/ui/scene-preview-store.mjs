// Per-scene view thumbnails are UI state, not scene resources. They live in
// localStorage so the next launch can paint the saved composition immediately,
// while the real 3D scene streams in behind the existing blur reveal.
const PREFIX = 'yukino:scene-preview:v1:';
const MAX_BYTES = 4 * 1024 * 1024;
const VALUES = new Map();
const IMAGES = new Map();
const LISTENERS = new Set();
let version = 0;

function storage() {
  try {
    return typeof localStorage === 'object' && localStorage ? localStorage : null;
  } catch {
    return null;
  }
}
function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 160;
}
function notify() {
  version++;
  for (const listener of LISTENERS) {
    try { listener(); } catch {}
  }
}

export function scenePreviewFor(id) {
  if (!validId(id)) return '';
  if (VALUES.has(id)) return VALUES.get(id);
  let value = '';
  try { value = storage()?.getItem(PREFIX + id) || ''; } catch {}
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(value) || value.length > MAX_BYTES) value = '';
  VALUES.set(id, value);
  return value;
}

export function saveScenePreview(id, dataUrl) {
  if (!validId(id) || typeof dataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl) || dataUrl.length > MAX_BYTES) return false;
  if (scenePreviewFor(id) === dataUrl) return true;
  VALUES.set(id, dataUrl);
  try { storage()?.setItem(PREFIX + id, dataUrl); } catch {
    // A full quota must not break the composition editor; the in-memory copy
    // still serves this session.
  }
  IMAGES.delete(id);
  if (typeof Image === 'function') {
    const image = new Image();
    image.decoding = 'async';
    image.src = dataUrl;
    IMAGES.set(id, image);
  }
  notify();
  return true;
}

export function clearScenePreview(id) {
  if (!validId(id)) return false;
  VALUES.delete(id);
  IMAGES.delete(id);
  try { storage()?.removeItem(PREFIX + id); } catch {}
  notify();
  return true;
}

export function scenePreviewVersion() {
  return version;
}

// Decoded image used by EnvironmentBackdrop.freezeFrame(). Returning a cached
// element keeps the switch path synchronous when the user just captured it.
export function scenePreviewImage(id) {
  const url = scenePreviewFor(id);
  if (!url || typeof Image !== 'function') return null;
  let image = IMAGES.get(id);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = url;
    IMAGES.set(id, image);
  }
  return image;
}

export function subscribeScenePreviews(listener) {
  if (typeof listener !== 'function') return () => {};
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}
