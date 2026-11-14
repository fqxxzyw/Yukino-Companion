import {
  CanvasTexture, Group, MathUtils, Matrix3, Matrix4, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';

const iconUrls = {
  anger: new URL('./assets/anger.svg', import.meta.url).href,
  'broken-heart': new URL('./assets/broken-heart.svg', import.meta.url).href,
  'broken-heart-left': new URL('./assets/broken-heart-left.svg', import.meta.url).href,
  'broken-heart-right': new URL('./assets/broken-heart-right.svg', import.meta.url).href,
  ellipsis: new URL('./assets/ellipsis.svg', import.meta.url).href,
  exclamation: new URL('./assets/exclamation.svg', import.meta.url).href,
  heart: new URL('./assets/heart.svg', import.meta.url).href,
  question: new URL('./assets/question.svg', import.meta.url).href,
  sparkle: new URL('./assets/sparkle.svg', import.meta.url).href,
  sweat: new URL('./assets/sweat.svg', import.meta.url).href,
};

function loadIcon(url) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      // The SVG viewBox is shared by every layer, including the two half-hearts.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) { resolve(null); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      resolve(texture);
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function createAnimeReactionIcons(anchor, {
  headWidth, side = 1, vertical = .20, depth = 0, horizontal = .62, iconWidth = .22,
}) {
  const width = headWidth * iconWidth;
  const origin = new Group();
  origin.name = 'anime-reactions:icons';
  origin.position.set(side * horizontal * headWidth, vertical * headWidth, depth * headWidth);
  anchor.add(origin);

  const sprites = new Map();
  const displayed = new Set();
  let disposed = false;
  const loading = Object.entries(iconUrls).map(async ([name, url]) => {
    const material = new SpriteMaterial({
      transparent: true, depthTest: true, depthWrite: false, toneMapped: false, opacity: 0,
    });
    const sprite = new Sprite(material);
    sprite.name = 'anime-reactions:' + name;
    sprite.visible = false;
    sprite.raycast = () => {};
    origin.add(sprite);
    sprites.set(name, sprite);
    const texture = await loadIcon(url);
    if (!texture || disposed) {
      texture?.dispose();
      return false;
    }
    material.map = texture;
    material.needsUpdate = true;
    sprite.visible = displayed.has(sprite);
    return true;
  });
  const ready = Promise.all(loading).then(results => results.every(Boolean));
  const worldToOrigin = new Matrix4();
  const inverseBasis = new Matrix3();
  const right = new Vector3();
  const up = new Vector3();

  function hide() {
    for (const sprite of displayed) sprite.visible = false;
    displayed.clear();
  }

  return {
    ready,
    update(layers, camera) {
      hide();
      if (disposed || !layers.length) return;
      if (camera) {
        origin.updateWorldMatrix(true, false);
        camera.updateWorldMatrix(true, false);
        const worldHeadWidth = right.setFromMatrixColumn(origin.matrixWorld, 0).length() * headWidth;
        worldToOrigin.copy(origin.matrixWorld).invert();
        inverseBasis.setFromMatrix4(worldToOrigin);
        // The anchor follows the head. Separation and fall stay in screen axes.
        right.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(worldHeadWidth).applyMatrix3(inverseBasis);
        up.setFromMatrixColumn(camera.matrixWorld, 1).normalize().multiplyScalar(worldHeadWidth).applyMatrix3(inverseBasis);
      } else {
        right.set(headWidth, 0, 0);
        up.set(0, headWidth, 0);
      }
      for (const {name, opacity, x, y, scale, rotation} of layers) {
        const sprite = sprites.get(name);
        if (!sprite || opacity <= 0) continue;
        sprite.position.copy(right).multiplyScalar(x).addScaledVector(up, y);
        sprite.scale.setScalar(width * scale);
        sprite.material.rotation = MathUtils.degToRad(rotation);
        sprite.material.opacity = opacity;
        sprite.visible = Boolean(sprite.material.map);
        displayed.add(sprite);
      }
    },
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      hide();
      origin.removeFromParent();
      for (const {material} of sprites.values()) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}
