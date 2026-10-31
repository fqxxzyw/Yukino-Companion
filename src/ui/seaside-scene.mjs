import * as THREE from 'three';
import {
  SEASIDE_ANCHOR,
  SEASIDE_CAMERAS,
  SEASIDE_DEFAULT_LIGHTING,
  SEASIDE_FOOTPRINT,
  SEASIDE_LIGHTING_PRESETS,
  seasideLightingPreset,
} from './seaside-presets.mjs';

/* ========================================================================== */
/* A bounded Japanese seaside miniature, authored directly in Three.js.        */
/* One square collectible, one dry character floor, a real water basin and a  */
/* low timber walk that stops at the sand instead of framing the whole beach.  */
/* ========================================================================== */

export const SEASIDE_SIZE = SEASIDE_FOOTPRINT.size;
export const SEASIDE_HALF = SEASIDE_FOOTPRINT.half;
const WATER_Y = 0.012;
const EDGE = SEASIDE_HALF - 0.16;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => smooth((value - a) / (b - a));

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function fbm2(x, y, octaves = 4) {
  let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/** Smooth diagonal shoreline. x runs left to right; negative z is seaward. */
export function seasideShoreZ(x) {
  const u = clamp((x + SEASIDE_HALF) / SEASIDE_SIZE, 0, 1);
  return -0.15 - 4.15 * u + 0.65 * Math.sin(Math.PI * u) + 0.08 * Math.sin(2.7 * Math.PI * u + 0.6);
}

function standFlatten(x, z) {
  const dx = Math.max(SEASIDE_ANCHOR.standMinX - x, 0, x - SEASIDE_ANCHOR.standMaxX);
  const dz = Math.max(SEASIDE_ANCHOR.standMinZ - z, 0, z - SEASIDE_ANCHOR.standMaxZ);
  return 1 - smoothstep(0, 1.35, Math.hypot(dx, dz));
}

function duneHeight(x, z, d) {
  if (d <= 0.8) return 0;
  const n1 = fbm2(x * 0.13 + 4.2, z * 0.13 - 2.7, 3);
  const n2 = fbm2(x * 0.47 - 1.3, z * 0.47 + 3.1, 2);
  const landMask = smoothstep(1.4, 4.2, d);
  const right = smoothstep(6.3, 9.65, x) * (0.08 + 0.23 * n1) * landMask;
  const front = smoothstep(7.7, 9.86, z) * (0.035 + 0.11 * n2) * smoothstep(1.8, 4.0, d);
  const pocket = Math.exp(-(((x - 8.55) / 1.75) ** 2 + ((z - 5.35) / 3.6) ** 2)) * 0.075;
  const farLeft = smoothstep(7.8, 9.8, -x) * (0.025 + 0.06 * n1) * smoothstep(2.8, 6.0, d);
  return right + front + pocket * landMask + farLeft;
}

/** The actual authored terrain surface. Inside the anchor it is exactly y=0. */
export function seasideTerrainHeight(x, z) {
  const d = z - seasideShoreZ(x);
  let height;
  if (d >= 0) {
    const ripple = Math.sin(x * 1.75 + z * 1.08) * 0.010 + Math.sin(x * 4.2 - z * 2.5 + 0.8) * 0.006;
    height = -0.055 + 0.145 * smoothstep(0, 0.9, d) + 0.035 * smoothstep(0.9, 3.2, d) + ripple * smoothstep(0.55, 2.3, d);
    height += duneHeight(x, z, d);
  } else {
    const depth = -d;
    height = -0.055 - 0.38 * smoothstep(0, 5.2, depth) - 0.14 * smoothstep(5.2, 9.6, depth);
    height += Math.sin(x * 0.77 + depth * 3.0) * 0.012 * smoothstep(0.25, 2.6, depth);
  }
  if (d >= 0) {
    // Keep the sand below the stone coping at the outer edge so the square
    // boundary stays legible and no dune spills over the side of the model.
    const border = Math.min(SEASIDE_HALF - Math.abs(x), SEASIDE_HALF - Math.abs(z));
    height *= smoothstep(0.02, 0.55, border);
  }
  return mix(height, 0, standFlatten(x, z));
}

function waterlineOffset(x) {
  let lo = 0.02, hi = 1.35;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    if (seasideTerrainHeight(x, seasideShoreZ(x) + mid) < WATER_Y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

function makeToonRamp(state) {
  const data = new Uint8Array([48, 96, 145, 198, 242]);
  const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  state.textures.add(texture);
  return texture;
}

function makeSandGrain(state) {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const rng = mulberry32(0x51a9d31);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = (rng() - 0.5) * 19 + (noise2(x * 0.23, y * 0.23) - 0.5) * 13;
      const warm = (rng() - 0.5) * 5;
      data[i] = clamp(242 + grain + warm, 206, 255);
      data[i + 1] = clamp(236 + grain, 204, 255);
      data[i + 2] = clamp(223 + grain - warm * 0.5, 190, 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(15, 15);
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  state.textures.add(texture);
  return texture;
}

function makeWoodGrain(state) {
  const width = 256, height = 512;
  const data = new Uint8Array(width * height * 4);
  const rng = mulberry32(0x77cafe);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const slow = fbm2(x * 0.07, y * 0.016, 3);
      const line = Math.sin(x * 0.59 + slow * 6.2 + Math.sin(y * 0.018) * 2.1);
      const knot = Math.max(0, Math.sin(x * 0.16 + y * 0.021) - 0.72) * 0.12;
      const grain = (line * 7 + (rng() - 0.5) * 12) - knot * 90;
      const base = clamp(238 + grain, 184, 255);
      data[i] = base;
      data[i + 1] = clamp(base - 7 + (rng() - 0.5) * 4, 176, 255);
      data[i + 2] = clamp(base - 15 + (rng() - 0.5) * 4, 170, 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 2.4);
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  state.textures.add(texture);
  return texture;
}

function makeShadowTexture(state) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(nx * 1.05, ny * 1.25));
      const alpha = Math.pow(1 - r, 1.9);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  state.textures.add(texture);
  return texture;
}

function toColor(hex) {
  return new THREE.Color(hex);
}

function smoothIndexedGeometry(geometry) {
  const positions = geometry.attributes.position;
  const lookup = new Map();
  const unique = [];
  const indices = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = unique.length / 3;
      lookup.set(key, index);
      unique.push(x, y, z);
    }
    indices.push(index);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(unique, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  geometry.dispose();
  return result;
}

function buildTerrainGeometry() {
  const segments = 120;
  const span = EDGE * 2;
  const vertices = (segments + 1) * (segments + 1);
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = [];
  const dryA = toColor('#e3d4b6');
  const dryB = toColor('#d8ccb8');
  const dryC = toColor('#d3c1ab');
  const damp = toColor('#a89e8b');
  const wet = toColor('#7e817b');
  const underShallow = toColor('#b4aa8e');
  const underMid = toColor('#83948f');
  const underDeep = toColor('#5c7477');
  const temp = new THREE.Color();
  let ptr = 0, uvPtr = 0;
  for (let iz = 0; iz <= segments; iz++) {
    const z = -EDGE + (iz / segments) * span;
    for (let ix = 0; ix <= segments; ix++) {
      const x = -EDGE + (ix / segments) * span;
      const y = seasideTerrainHeight(x, z);
      const d = z - seasideShoreZ(x);
      positions[ptr] = x; positions[ptr + 1] = y; positions[ptr + 2] = z;
      uvs[uvPtr] = (x + EDGE) / span; uvs[uvPtr + 1] = (z + EDGE) / span;
      const broad = fbm2(x * 0.18 + 1.2, z * 0.18 - 3.4, 3);
      const fine = fbm2(x * 0.82 - 2.5, z * 0.82 + 5.2, 2);
      const warp = (broad - 0.5) * 1.15 + (fine - 0.5) * 0.38;
      if (d < 0) {
        const depth = Math.min(1, -d / 7.5);
        temp.copy(underShallow).lerp(underMid, smooth(depth * 2.2));
        temp.lerp(underDeep, smooth((depth - 0.32) / 0.7));
        temp.offsetHSL(0, -0.015, (fine - 0.5) * 0.045);
      } else {
        temp.copy(dryA).lerp(dryB, smooth(broad * 0.9));
        temp.lerp(dryC, smooth((fine - 0.36) * 0.55));
        const dampMix = 1 - smoothstep(2.4, 5.0, d + warp);
        const wetMix = 1 - smoothstep(0.30, 2.1, d + warp);
        temp.lerp(damp, dampMix * 0.6);
        temp.lerp(wet, wetMix * 0.72);
        const brightness = 0.925 + broad * 0.12 + (fine - 0.5) * 0.05;
        temp.multiplyScalar(brightness);
      }
      colors[ptr] = temp.r; colors[ptr + 1] = temp.g; colors[ptr + 2] = temp.b;
      ptr += 3; uvPtr += 2;
    }
  }
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const c = a + segments + 1;
      const dd = c + 1;
      indices.push(a, c, b, b, c, dd);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBeachTerrain(state, parent, materials) {
  const geometry = buildTerrainGeometry();
  state.geometries.add(geometry);
  const mesh = new THREE.Mesh(geometry, materials.sand);
  mesh.name = 'seaside:ground';
  mesh.userData.role = 'ground';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  state.meshes.add(mesh);
  return mesh;
}

function makeWaterGeometry() {
  const cols = 112, rows = 78;
  const positions = [], seaward = [], indices = [];
  for (let ix = 0; ix <= cols; ix++) {
    const x = -EDGE + (ix / cols) * (EDGE * 2);
    const shore = seasideShoreZ(x);
    const front = shore + 0.30;
    const back = -EDGE + 0.06;
    for (let iz = 0; iz <= rows; iz++) {
      const t = iz / rows;
      const z = mix(front, back, t);
      positions.push(x, WATER_Y, z);
      seaward.push(-(z - shore));
    }
  }
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const a = ix * (rows + 1) + iz;
      const b = a + 1;
      const c = (ix + 1) * (rows + 1) + iz;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeaward', new THREE.Float32BufferAttribute(seaward, 1));
  geometry.setIndex(indices);
  return geometry;
}

function makeWaterMaterial(preset, state) {
  const level = (a, b, c) => new THREE.Color(preset.water[a]);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: {value: 0},
      uDeep: {value: level('deep')},
      uMiddle: {value: level('middle')},
      uShallow: {value: level('shallow')},
      uCrest: {value: level('crest')},
      uGlint: {value: level('glint')},
      uFoam: {value: level('foam')},
      uSky: {value: level('sky')},
      uGlintStrength: {value: preset.glintStrength},
      uFoamStrength: {value: preset.foamStrength},
      uReflectionCenter: {value: preset.reflectionCenter},
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeaward;
      varying vec3 vWorld;
      varying float vSeaward;
      void main() {
        vec3 p = position;
        float nearShore = smoothstep(-0.25, 1.1, aSeaward);
        float swell =
          sin(p.x * 0.31 + uTime * 0.22) * 0.0055 +
          sin(p.z * 0.42 - uTime * 0.17 + p.x * 0.09) * 0.0045 +
          sin((p.x + p.z) * 0.18 + uTime * 0.11) * 0.0035;
        p.y += swell * nearShore;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vSeaward = aSeaward;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uMiddle;
      uniform vec3 uShallow;
      uniform vec3 uCrest;
      uniform vec3 uGlint;
      uniform vec3 uFoam;
      uniform vec3 uSky;
      uniform float uGlintStrength;
      uniform float uFoamStrength;
      uniform float uReflectionCenter;
      varying vec3 vWorld;
      varying float vSeaward;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0, amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
          value += vnoise(p) * amplitude;
          p = p * 2.03 + vec2(7.1, -4.4);
          amplitude *= 0.5;
        }
        return value;
      }
      void main() {
        float seaward = max(vSeaward, 0.0);
        float depthT = clamp(seaward / 8.7, 0.0, 1.0);
        float t = clamp(uTime, 0.0, 2000.0);
        float n1 = fbm(vWorld.xz * 0.30 + vec2(t * 0.010, -t * 0.014));
        float n2 = fbm(vWorld.xz * 0.96 + vec2(-t * 0.022, t * 0.017));
        float n3 = fbm(vWorld.xz * 2.9 + vec2(t * 0.035, t * 0.023));
        vec3 color = mix(uShallow, uMiddle, smoothstep(0.0, 0.19, depthT));
        color = mix(color, uDeep, smoothstep(0.14, 0.86, depthT));
        color = mix(color, uSky, (0.035 + n1 * 0.065) * smoothstep(0.45, 1.0, depthT));
        color *= 0.953 + n2 * 0.09;

        // Long, uneven swells. Two offset line families keep this from reading
        // as a machine-cut sine grid while remaining gentle and stable.
        float phaseA = seaward * 1.62 + n1 * 2.1 + sin(vWorld.x * 0.17 + t * 0.05) * 0.8 + t * 0.07;
        float phaseB = seaward * 0.73 - vWorld.x * 0.08 + n2 * 2.8 - t * 0.035;
        float crestA = smoothstep(0.70, 0.91, sin(phaseA)) * smoothstep(0.32, 0.68, n2 + 0.16);
        float crestB = smoothstep(0.82, 0.96, sin(phaseB)) * smoothstep(0.44, 0.74, n1 + 0.06);
        float crest = (crestA * 0.26 + crestB * 0.15) * smoothstep(0.03, 0.45, depthT);
        color = mix(color, uCrest, crest * (0.11 + n3 * 0.05));
        float crestEdge = smoothstep(0.88, 0.94, sin(phaseB + 0.7)) * smoothstep(0.12, 0.55, depthT);
        color = mix(color, uShallow, crestEdge * 0.055);
        float trough = smoothstep(0.72, 0.93, sin(phaseA + 2.0)) * smoothstep(0.08, 0.5, depthT);
        color *= 1.0 - trough * 0.055;

        // Broken, long sunset reflection on one side of the composition, never
        // a solid mirror and never the brightest value in the miniature.
        float center = uReflectionCenter + 0.52 * sin(vWorld.z * 0.17 + t * 0.035) + 0.20 * (n1 - 0.5);
        float band = exp(-pow((vWorld.x - center) / (0.58 + 0.24 * n2), 2.0));
        float broken = smoothstep(0.44, 0.69, fbm(vec2(vWorld.x * 0.56 + 2.0, vWorld.z * 5.2 - t * 0.045)));
        float fineGlint = smoothstep(0.58, 0.82, sin(vWorld.z * 6.5 + vWorld.x * 1.1 + n1 * 9.0) * 0.5 + 0.5);
        float shimmer = 0.72 + 0.28 * sin(t * 0.31 + vWorld.z * 0.7);
        float glints = band * broken * (0.24 + fineGlint * 0.76) * shimmer * smoothstep(0.10, 0.6, depthT) * uGlintStrength;
        color = mix(color, uGlint, clamp(glints * 0.84, 0.0, 0.64));
        color = mix(color, uGlint, band * (0.045 + 0.035 * n3) * uGlintStrength);
        float nearRipples = smoothstep(0.88, 0.98, sin(seaward * 4.4 + vWorld.x * 0.13 + n1 * 4.0 - t * 0.16));
        nearRipples *= (1.0 - smoothstep(0.5, 1.7, seaward)) * smoothstep(0.4, 0.8, n1 + 0.2);
        color = mix(color, uCrest, nearRipples * 0.08);

        // A very pale, discontinuous shoreline wash. The separate foam ribbon
        // owns the crisp lace; this only prevents a hard water/sand cut.
        float shoreWash = (1.0 - smoothstep(0.06, 0.5, seaward)) * smoothstep(0.38, 0.74, n2 + n3 * 0.35);
        color = mix(color, uFoam, shoreWash * 0.055 * uFoamStrength);

        float alpha = mix(0.30, 0.92, smoothstep(0.02, 0.65, seaward));
        alpha *= smoothstep(-0.32, 0.32, vSeaward) * smoothstep(0.0, 0.13, depthT + 0.09);
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.91));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  state.materials.add(material);
  return material;
}

function makeFoamGeometry() {
  const cols = 180, rows = 6;
  const positions = [], rels = [], indices = [];
  const frontRel = -0.5, backRel = 0.95;
  for (let ix = 0; ix <= cols; ix++) {
    const x = -EDGE + (ix / cols) * (EDGE * 2);
    const shore = seasideShoreZ(x);
    const waterline = waterlineOffset(x);
    for (let iz = 0; iz <= rows; iz++) {
      const rel = mix(frontRel, backRel, iz / rows);
      const d = waterline + rel;
      const z = shore + d;
      const terrain = seasideTerrainHeight(x, z);
      const y = Math.max(WATER_Y + 0.006, terrain + 0.013);
      positions.push(x, y, z);
      rels.push(rel);
    }
  }
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const a = ix * (rows + 1) + iz;
      const b = a + 1;
      const c = (ix + 1) * (rows + 1) + iz;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRel', new THREE.Float32BufferAttribute(rels, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeFoamMaterial(preset, state) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: {value: 0},
      uFoam: {value: new THREE.Color(preset.water.foam)},
      uGlass: {value: new THREE.Color(preset.water.shallow)},
      uStrength: {value: preset.foamStrength},
    },
    vertexShader: /* glsl */ `
      attribute float aRel;
      varying float vRel;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vRel = aRel;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uFoam;
      uniform vec3 uGlass;
      uniform float uStrength;
      varying float vRel;
      varying vec3 vWorld;
      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 19.19);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0, amplitude = 0.5;
        for (int i = 0; i < 4; i++) { value += vnoise(p) * amplitude; p = p * 2.04 + 3.7; amplitude *= 0.5; }
        return value;
      }
      float band(float x, float center, float width) {
        float d = abs(x - center) / width;
        return 1.0 - smoothstep(0.55, 1.15, d);
      }
      void main() {
        float t = uTime;
        float n1 = fbm(vec2(vWorld.x * 0.55 + t * 0.025, vWorld.z * 1.2));
        float n2 = fbm(vec2(vWorld.x * 2.4 - t * 0.04, vWorld.z * 4.0 + 4.3));
        float n3 = fbm(vec2(vWorld.x * 0.19 + 9.1, vWorld.z * 0.32));
        float advance = sin(t * 0.19 + n3 * 5.0) * 0.045;
        float c1 = -0.23 + advance + n1 * 0.055;
        float c2 = 0.035 + advance * 0.56 + (n2 - 0.5) * 0.06;
        float c3 = 0.30 + advance * 0.28 + (n1 - 0.5) * 0.08;
        float bands = band(vRel, c1, 0.060) * 0.9;
        bands += band(vRel, c2, 0.038) * 1.0;
        bands += band(vRel, c3, 0.078) * (0.44 + n2 * 0.22);
        float longBreak = smoothstep(0.18, 0.42, fbm(vec2(vWorld.x * 0.18 + 4.2, vRel * 0.8 + t * 0.008)));
        float shortBreak = smoothstep(0.26, 0.55, fbm(vec2(vWorld.x * 1.55 - t * 0.028, vRel * 4.2 + 2.2)));
        float holes = smoothstep(0.48, 0.72, fbm(vec2(vWorld.x * 6.2 + 8.0, vRel * 15.0 - t * 0.08)));
        float gate = smoothstep(0.47, 0.62, fbm(vec2(vWorld.x * 0.075 + 7.3, 1.7 + vRel * 0.35 + t * 0.004)));
        float broken = gate * longBreak * (0.20 + 0.80 * shortBreak) * (0.52 + 0.48 * holes);
        broken *= 0.52 + 0.48 * smoothstep(0.25, 0.62, n2);
        float landMask = (1.0 - smoothstep(0.68, 0.96, vRel)) * smoothstep(-0.51, -0.34, vRel);
        float lace = smoothstep(0.52, 0.76, fbm(vec2(vWorld.x * 8.5 - t * 0.04, vRel * 13.0 + 2.1)));
        float innerGlow = band(vRel, c2, 0.072) * (0.35 + holes * 0.4);
        float alpha = (bands + innerGlow * 0.35) * broken * landMask * (0.55 + lace * 0.45) * uStrength;
        alpha *= smoothstep(0.0, 0.05, vRel + 0.5);
        vec3 color = mix(uGlass, uFoam, smoothstep(0.05, 0.58, bands + lace * 0.18));
        color = mix(color, uFoam, holes * 0.28);
        gl_FragColor = vec4(color, clamp(alpha * 1.65, 0.0, 0.92));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  state.materials.add(material);
  return material;
}

function makeWetGeometry() {
  const cols = 150, rows = 4;
  const positions = [], uvs = [], indices = [];
  for (let ix = 0; ix <= cols; ix++) {
    const x = -EDGE + (ix / cols) * (EDGE * 2);
    const shore = seasideShoreZ(x);
    const waterline = waterlineOffset(x);
    const width = 1.65 + 0.75 * fbm2(x * 0.31 + 7.4, 1.8, 2) + 0.28 * Math.sin(x * 0.54 + 1.1);
    for (let iz = 0; iz <= rows; iz++) {
      const v = iz / rows;
      const d = waterline + 0.08 + width * v;
      const z = shore + d;
      positions.push(x, seasideTerrainHeight(x, z) + 0.006, z);
      uvs.push(ix / cols, v);
    }
  }
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const a = ix * (rows + 1) + iz;
      const b = a + 1;
      const c = (ix + 1) * (rows + 1) + iz;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeWetMaterial(preset, state) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: {value: 0},
      uWarm: {value: new THREE.Color(preset.water.glint)},
      uCool: {value: new THREE.Color(preset.water.sky)},
      uSunDir: {value: new THREE.Vector3(...preset.sun.position).normalize()},
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      uniform vec3 uSunDir;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 19.19);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0, amplitude = 0.5;
        for (int i = 0; i < 3; i++) { value += vnoise(p) * amplitude; p = p * 2.02 + 2.4; amplitude *= 0.5; }
        return value;
      }
      void main() {
        float grain = fbm(vWorld.xz * 1.8);
        float wetPatch = smoothstep(0.35, 0.78, fbm(vWorld.xz * 0.58 + 2.6));
        float edge = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
        float gloss = pow(max(dot(normalize(vNormalW), halfDir), 0.0), 22.0);
        float fresnel = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.3);
        vec3 wetBase = mix(vec3(0.075, 0.082, 0.078), vec3(0.19, 0.195, 0.175), grain * 0.62 + wetPatch * 0.22);
        vec3 reflection = mix(uCool, uWarm, 0.35 + 0.3 * fresnel);
        vec3 color = wetBase + reflection * (gloss * 0.24 + fresnel * 0.05);
        float alpha = edge * (0.38 + wetPatch * 0.18 + gloss * 0.18);
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.66));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  state.materials.add(material);
  return material;
}

function addMesh(state, parent, name, role, geometry, material, {cast = true, receive = true, renderOrder = 0} = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `seaside:${name}`;
  mesh.userData.role = role;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.renderOrder = renderOrder;
  parent.add(mesh);
  state.meshes.add(mesh);
  state.geometries.add(geometry);
  state.materials.add(material);
  return mesh;
}

function addInstanced(state, parent, name, role, geometry, material, entries, {cast = true, receive = true, dynamic = false, colors = null} = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  entries.forEach((entry, index) => {
    const p = entry.position || [0, 0, 0];
    const s = entry.scale || [1, 1, 1];
    const q = entry.quaternion;
    position.set(...p);
    scale.set(...s);
    if (q) quaternion.copy(q);
    else {
      const r = entry.rotation || [0, 0, 0];
      euler.set(r[0], r[1], r[2]);
      quaternion.setFromEuler(euler);
    }
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    if (colors) mesh.setColorAt(index, colors[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = `seaside:${name}`;
  mesh.userData.role = role;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  state.meshes.add(mesh);
  state.geometries.add(geometry);
  state.materials.add(material);
  return mesh;
}

function makeBoxEntries() {
  return [];
}

function addBoxBatch(state, parent, name, role, entries, material, options = {}) {
  return addInstanced(state, parent, name, role, material.userData.boxGeometry, material, entries, options);
}

function buildBase(state, root, materials) {
  const group = new THREE.Group();
  group.name = 'Seaside_Base';
  root.add(group);
  const box = new THREE.BoxGeometry(1, 1, 1);
  state.geometries.add(box);
  const baseLayer = (role, colorMat, size, y) => {
    const mesh = addMesh(state, group, role, role, box, colorMat, {cast: false, receive: true});
    mesh.position.set(0, y, 0);
    mesh.scale.set(...size);
    return mesh;
  };
  // The hollow perimeter is deliberate: a solid cap above water would hide the
  // basin. Only the foot below the deepest seabed is solid; four stone walls and
  // a low coping carry the model's square silhouette.
  baseLayer('base-foot', materials.stoneDeep, [19.64, 0.18, 19.64], -0.72);
  const wallThickness = 0.19, wallHeight = 0.68, wallCenter = -0.30;
  const wall = [];
  wall.push({position: [0, wallCenter, -9.905], scale: [20, wallHeight, wallThickness]});
  wall.push({position: [0, wallCenter, 9.905], scale: [20, wallHeight, wallThickness]});
  wall.push({position: [-9.905, wallCenter, 0], scale: [wallThickness, wallHeight, 19.64]});
  wall.push({position: [9.905, wallCenter, 0], scale: [wallThickness, wallHeight, 19.64]});
  addInstanced(state, group, 'base-body', 'base-body', box, materials.stone, wall, {cast: false, receive: true});
  const bevel = [];
  bevel.push({position: [0, -0.055, -9.94], scale: [20.03, 0.11, 0.17]});
  bevel.push({position: [0, -0.055, 9.94], scale: [20.03, 0.11, 0.17]});
  bevel.push({position: [-9.94, -0.055, 0], scale: [0.17, 0.11, 19.64]});
  bevel.push({position: [9.94, -0.055, 0], scale: [0.17, 0.11, 19.64]});
  addInstanced(state, group, 'base-bevel', 'base-bevel', box, materials.stoneLight, bevel, {cast: false, receive: true});
  // A low coping frame makes the square model read as one object rather than a
  // water box dropped onto sand. It is deliberately flush, not a glass wall.
  const border = [];
  const borderWidth = 0.18, borderTop = 0.012;
  border.push({position: [0, borderTop, -9.91], scale: [19.82, 0.05, borderWidth]});
  border.push({position: [0, borderTop, 9.91], scale: [19.82, 0.05, borderWidth]});
  border.push({position: [-9.91, borderTop, 0], scale: [borderWidth, 0.05, 19.82]});
  border.push({position: [9.91, borderTop, 0], scale: [borderWidth, 0.05, 19.82]});
  addInstanced(state, group, 'coping', 'base-coping', box, materials.coping, border, {cast: false, receive: true});
  const bevelLine = [];
  bevelLine.push({position: [0, 0.041, -9.88], scale: [19.84, 0.012, 0.08]});
  bevelLine.push({position: [0, 0.041, 9.88], scale: [19.84, 0.012, 0.08]});
  bevelLine.push({position: [-9.88, 0.041, 0], scale: [0.08, 0.012, 19.84]});
  bevelLine.push({position: [9.88, 0.041, 0], scale: [0.08, 0.012, 19.84]});
  addInstanced(state, group, 'coping-highlight', 'base-coping', box, materials.copingLight, bevelLine, {cast: false, receive: true});
  // A visible rear sea lip and short side returns, no transparent wall.
  const seaEdges = [];
  seaEdges.push({position: [0, 0.052, -9.735], scale: [19.64, 0.09, 0.24]});
  seaEdges.push({position: [-9.735, 0.045, -8.85], scale: [0.24, 0.075, 1.7]});
  seaEdges.push({position: [9.735, 0.045, -8.85], scale: [0.24, 0.075, 1.7]});
  addInstanced(state, group, 'sea-edge', 'sea-edge', box, materials.seaEdge, seaEdges, {cast: false, receive: true});
  return group;
}

function addUnderline(parent, state, name, material, entries) {
  return addInstanced(state, parent, name, name, material.userData.boxGeometry, material, entries, {cast: false, receive: true});
}

function buildBoardwalk(state, root, materials) {
  const group = new THREE.Group();
  group.name = 'Seaside_Boardwalk';
  root.add(group);
  const box = materials.deck.userData.boxGeometry;
  const deckTop = 0.405;
  const walkX = -8.32;
  const walkWidth = 1.7;
  const platform = {minX: -9.12, maxX: -6.02, minZ: 0.15, maxZ: 1.95};
  const deckEntries = [];
  const plankWear = [];
  const cracks = [];
  const nails = [];
  const rng = mulberry32(0x0b0a7d1);
  let z = 9.35;
  let index = 0;
  while (z > 0.35) {
    const depth = 0.205 + rng() * 0.035;
    const xJitter = (rng() - 0.5) * 0.015;
    const yJitter = (rng() - 0.5) * 0.006;
    deckEntries.push({
      position: [walkX + xJitter, deckTop + yJitter, z - depth * 0.5],
      scale: [walkWidth + (rng() - 0.5) * 0.035, 0.062, depth - 0.011],
    });
    const tone = index % 5;
    for (const dx of [-walkWidth * 0.39, walkWidth * 0.39]) {
      nails.push({position: [walkX + dx, deckTop + 0.033, z - depth * 0.28], scale: [0.014, 0.005, 0.014]});
      nails.push({position: [walkX + dx, deckTop + 0.033, z - depth * 0.72], scale: [0.014, 0.005, 0.014]});
    }
    if (tone === 1 || tone === 4) {
      plankWear.push({position: [walkX - 0.54, deckTop + 0.034, z - depth * 0.35], scale: [0.30, 0.002, 0.022], rotation: [0, 0.015, 0]});
    }
    if (tone === 2 && index % 3 === 0) {
      cracks.push({position: [walkX + 0.22, deckTop + 0.034, z - depth * 0.51], scale: [0.20, 0.0015, 0.006], rotation: [0, -0.04, 0]});
    }
    z -= depth;
    index++;
  }
  // The rest deck opens to the right of the walk. Its boards stop at the walk
  // lane instead of coplanar double-decking the same square metre.
  const walkRight = walkX + walkWidth * 0.5;
  const wingLeft = walkRight + 0.045;
  const wingRight = platform.maxX - 0.06;
  let wz = platform.minZ + 0.09;
  while (wz < platform.maxZ - 0.04) {
    const depth = 0.19 + rng() * 0.042;
    deckEntries.push({
      position: [(wingLeft + wingRight) * 0.5, deckTop + (rng() - 0.5) * 0.003, wz + depth * 0.5],
      scale: [wingRight - wingLeft, 0.06, depth - 0.011],
    });
    for (const dx of [wingLeft + 0.18, wingRight - 0.18]) {
      nails.push({position: [dx, deckTop + 0.033, wz + depth * 0.28], scale: [0.014, 0.005, 0.014]});
      nails.push({position: [dx, deckTop + 0.033, wz + depth * 0.74], scale: [0.014, 0.005, 0.014]});
    }
    wz += depth;
  }
  // A narrow cap board closes the joint between the long walk and the side deck.
  deckEntries.push({position: [walkRight + 0.022, deckTop + 0.004, (platform.minZ + platform.maxZ) * 0.5], scale: [0.07, 0.026, platform.maxZ - platform.minZ]});
  const plankColors = [];
  const woodPalette = ['#8f867b', '#857c72', '#9b9084', '#7b736a', '#91877b'];
  deckEntries.forEach((entry, i) => plankColors.push(new THREE.Color(woodPalette[(i + 2) % woodPalette.length])));
  addInstanced(state, group, 'deck-planks', 'boardwalk-plank', box, materials.deck, deckEntries, {cast: true, receive: true, colors: plankColors});
  addInstanced(state, group, 'plank-wear', 'boardwalk-wear', box, materials.woodWear, plankWear, {cast: false, receive: true});
  addInstanced(state, group, 'plank-cracks', 'boardwalk-crack', box, materials.woodCrack, cracks, {cast: false, receive: false});
  addInstanced(state, group, 'plank-nails', 'boardwalk-nail', materials.nail.userData.cylinder, materials.nail, nails.map(entry => ({...entry, scale: [0.015, 0.006, 0.015]})), {cast: false, receive: false});

  // Stringers, posts, diagonal braces: all touch the beach, none hover.
  const structure = [];
  const posts = [];
  const braces = [];
  for (const side of [-1, 1]) {
    structure.push({position: [walkX + side * 0.52, deckTop - 0.10, 4.85], scale: [0.16, 0.15, 9.0]});
  }
  structure.push({position: [(walkRight + platform.maxX) * 0.5, deckTop - 0.10, (platform.minZ + platform.maxZ) * 0.5], scale: [platform.maxX - walkRight, 0.13, 0.14]});
  structure.push({position: [(walkRight + platform.maxX) * 0.5, deckTop - 0.10, platform.minZ + 0.16], scale: [platform.maxX - walkRight, 0.12, 0.14]});
  structure.push({position: [(walkRight + platform.maxX) * 0.5, deckTop - 0.10, platform.maxZ - 0.16], scale: [platform.maxX - walkRight, 0.12, 0.14]});
  for (const zPost of [8.7, 7.0, 5.3, 3.6, 2.25, 0.55]) {
    for (const side of [-1, 1]) {
      const x = walkX + side * 0.55;
      const ground = seasideTerrainHeight(x, zPost);
      const height = deckTop - 0.09 - ground;
      posts.push({position: [x, ground + height * 0.5, zPost], scale: [0.105, height, 0.105]});
      if (zPost < 4 && side === 1) {
        braces.push({position: [x + 0.36, ground + height * 0.48, zPost + 0.52], scale: [0.09, 0.075, Math.hypot(0.72, height * 0.65)], rotation: [0.38, 0, 0]});
      }
    }
  }
  for (const [x, zPost] of [[-9.02, 0.26], [-6.12, 0.26], [-9.02, 1.84], [-6.12, 1.84]]) {
    const ground = seasideTerrainHeight(x, zPost);
    const height = deckTop - 0.09 - ground;
    posts.push({position: [x, ground + height * 0.5, zPost], scale: [0.11, height, 0.11]});
  }
  addInstanced(state, group, 'substructure', 'boardwalk-support', box, materials.structure, structure.concat(posts), {cast: true, receive: true});
  addInstanced(state, group, 'braces', 'boardwalk-support', box, materials.structure, braces, {cast: true, receive: true});
  addInstanced(state, group, 'edge-trim', 'boardwalk-trim', box, materials.rail, [
    {position: [platform.minX, deckTop + 0.01, (platform.minZ + platform.maxZ) / 2], scale: [0.11, 0.11, platform.maxZ - platform.minZ]},
    {position: [platform.maxX, deckTop + 0.01, (platform.minZ + platform.maxZ) / 2], scale: [0.11, 0.11, platform.maxZ - platform.minZ]},
    {position: [(platform.minX + platform.maxX) / 2, deckTop + 0.01, platform.minZ], scale: [platform.maxX - platform.minX, 0.11, 0.11]},
    {position: [(platform.minX + platform.maxX) / 2, deckTop + 0.01, platform.maxZ], scale: [platform.maxX - platform.minX, 0.11, 0.11]},
  ], {cast: true, receive: true});

  const railing = [];
  const railStart = platform.minX + 0.20, railEnd = platform.maxX - 0.20;
  const railZ = platform.minZ + 0.20;
  const railDeck = deckTop;
  const postXs = [railStart, railStart + 0.9, railStart + 1.8, railStart + 2.7, railEnd];
  for (const x of postXs) railing.push({position: [x, railDeck + 0.51, railZ], scale: [0.075, 1.02, 0.075]});
  railing.push({position: [(railStart + railEnd) / 2, railDeck + 1.02, railZ], scale: [railEnd - railStart, 0.075, 0.095]});
  railing.push({position: [(railStart + railEnd) / 2, railDeck + 0.55, railZ], scale: [railEnd - railStart, 0.045, 0.055]});
  for (const x of [railStart, railEnd]) {
    railing.push({position: [x, railDeck + 0.75, railZ + 0.065], scale: [0.10, 0.16, 0.05]});
    railing.push({position: [x, railDeck + 0.20, railZ + 0.08], scale: [0.12, 0.12, 0.11]});
  }
  for (const x of postXs) railing.push({position: [x, railDeck + 0.035, railZ], scale: [0.13, 0.08, 0.13]});
  addInstanced(state, group, 'railing', 'railing', box, materials.rail, railing, {cast: true, receive: true});

  // A short return rail on the seaward left edge only; the rest stays open.
  const returnRail = [];
  const rz0 = railZ, rz1 = railZ + 0.95;
  returnRail.push({position: [platform.minX + 0.2, railDeck + 0.51, rz1], scale: [0.075, 1.02, 0.075]});
  returnRail.push({position: [platform.minX + 0.2, railDeck + 1.02, (rz0 + rz1) / 2], scale: [0.09, 0.075, rz1 - rz0]});
  returnRail.push({position: [platform.minX + 0.2, railDeck + 0.55, (rz0 + rz1) / 2], scale: [0.055, 0.045, rz1 - rz0]});
  addInstanced(state, group, 'rail-return', 'railing', box, materials.rail, returnRail, {cast: true, receive: true});

  return {group, platform, deckTop, railing};
}

function buildBench(state, root, materials, platformY) {
  const group = new THREE.Group();
  group.name = 'Seaside_Bench';
  group.position.set(-7.02, platformY, 1.14);
  group.rotation.y = -1.18;
  root.add(group);
  const box = materials.deck.userData.boxGeometry;
  const make = (name, role, size, position, material, rotation = [0, 0, 0]) => {
    const mesh = addMesh(state, group, name, role, box, material, {cast: true, receive: true});
    mesh.position.set(...position);
    mesh.scale.set(...size);
    mesh.rotation.set(...rotation);
    return mesh;
  };
  // Four weathered seat boards, two joined side frames and a low open back. The
  // modest turn keeps the seat and the back legible from the showcase angle while
  // the bench still addresses the sea beyond the railing.
  for (let i = 0; i < 4; i++) {
    make(`seat-${i}`, 'bench-seat', [1.78, 0.05, 0.115], [0, 0.402, -0.165 + i * 0.115], materials.benchSeat);
  }
  for (let i = 0; i < 2; i++) {
    make(`back-${i}`, 'bench-back', [1.78, 0.075, 0.045], [0, 0.585 + i * 0.155, 0.255], materials.benchBack, [-0.12, 0, 0]);
  }
  make('back-cap', 'bench-back', [1.82, 0.05, 0.065], [0, 0.813, 0.286], materials.benchBack, [-0.12, 0, 0]);
  for (const x of [-0.20, 0.20]) {
    make(`side-rail-${x}`, 'bench-leg', [0.06, 0.055, 0.48], [x, 0.335, 0.005], materials.benchLeg);
    make(`front-post-${x}`, 'bench-leg', [0.07, 0.39, 0.07], [x, 0.205, -0.205], materials.benchLeg);
    make(`back-post-${x}`, 'bench-leg', [0.07, 0.80, 0.07], [x, 0.41, 0.255], materials.benchLeg, [-0.08, 0, 0]);
    make(`foot-${x}`, 'bench-leg', [0.12, 0.05, 0.55], [x, 0.025, 0.015], materials.benchLeg);
    make(`brace-${x}`, 'bench-brace', [0.05, 0.05, 0.36], [x, 0.34, 0.13], materials.benchLeg, [0.45, 0, 0]);
  }

  const planter = new THREE.Group();
  planter.name = 'Seaside_Planter';
  planter.position.set(-6.38, platformY, 1.35);
  root.add(planter);
  const planterMeshes = [
    ['planter-front', [0.42, 0.24, 0.045], [0, 0.12, 0.20], materials.planter],
    ['planter-back', [0.42, 0.24, 0.045], [0, 0.12, -0.20], materials.planter],
    ['planter-left', [0.045, 0.24, 0.36], [-0.21, 0.12, 0], materials.planter],
    ['planter-right', [0.045, 0.24, 0.36], [0.21, 0.12, 0], materials.planter],
    ['planter-soil', [0.34, 0.025, 0.29], [0, 0.235, 0], materials.soil],
  ];
  for (const [name, size, position, material] of planterMeshes) {
    const mesh = addMesh(state, planter, name, 'planter', box, material, {cast: true, receive: true});
    mesh.position.set(...position); mesh.scale.set(...size);
  }
  planter.updateMatrixWorld(true);
  const planterGrassBase = planter.localToWorld(new THREE.Vector3(0, 0.247, 0));
  return {group, planter, planterGrassBase};
}

function makeRockGeometry(seed, detail = 2) {
  const base = new THREE.IcosahedronGeometry(1, detail);
  const geometry = smoothIndexedGeometry(base);
  const pos = geometry.attributes.position;
  const rng = mulberry32(seed);
  const vertices = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm2(x * 2.0 + seed * 0.01, z * 2.1 - y * 1.1, 3);
    const radial = 0.91 + n * 0.25 + (rng() - 0.5) * 0.018;
    let nx = x * radial;
    let ny = y * radial * 0.83;
    let nz = z * radial;
    if (ny < -0.55) ny = -0.55 + (ny + 0.55) * 0.38;
    vertices.push(nx, ny, nz);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = vertices[i * 3 + 1];
    const n = noise2(vertices[i * 3] * 4.2, vertices[i * 3 + 2] * 4.2);
    const m = fbm2(vertices[i * 3] * 2.1 + 3.1, vertices[i * 3 + 2] * 2.2 - 2.0, 2);
    c.setRGB(0.78 + n * 0.13 + m * 0.04, 0.79 + n * 0.12 + m * 0.035, 0.77 + n * 0.11 + m * 0.03);
    if (y < -0.08) c.multiplyScalar(0.66 + (y + 0.55) * 0.22);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function buildRocks(state, root, materials) {
  const group = new THREE.Group();
  group.name = 'Seaside_Rocks';
  root.add(group);
  const rng = mulberry32(0xbadc0de);
  const specs = [
    [6.35, -2.12, 1.26, 0.92, 1.02, '#8d908a', 0.4],
    [7.02, -2.34, 0.92, 0.62, 0.76, '#92958d', 1.7],
    [5.84, -1.53, 0.58, 0.39, 0.52, '#888a82', 2.5],
    [7.92, 3.0, 1.02, 0.70, 0.86, '#878b84', 0.8],
    [8.43, 3.48, 0.61, 0.44, 0.56, '#97998e', 2.2],
    [8.66, 7.10, 0.77, 0.49, 0.69, '#8f8f85', 1.2],
    [8.18, 7.52, 0.49, 0.33, 0.43, '#9a998d', 2.8],
  ];
  const geoA = makeRockGeometry(11, 2);
  const geoB = makeRockGeometry(29, 1);
  state.geometries.add(geoA);
  state.geometries.add(geoB);
  const groups = [[], []];
  const colors = [[], []];
  for (const [x, z, sx, sy, sz, color, rot] of specs) {
    const y = seasideTerrainHeight(x, z) + sy * 0.82;
    const actualVariant = rng() > 0.55 ? 1 : 0;
    const target = groups[actualVariant];
    target.push({position: [x, y, z], scale: [sx, sy, sz], rotation: [0.08 * Math.sin(rot), rot, 0.04 * Math.cos(rot * 1.7)]});
    colors[actualVariant].push(new THREE.Color(color));
  }
  addInstanced(state, group, 'rock-large', 'shore-rock', geoA, materials.rock, groups[0], {cast: true, receive: true, colors: colors[0]});
  addInstanced(state, group, 'rock-small', 'shore-rock', geoB, materials.rock, groups[1], {cast: true, receive: true, colors: colors[1]});
  return group;
}

function makeBladeGeometry() {
  const segments = 6;
  const positions = [], colors = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const width = 0.5 * Math.pow(1 - t, 0.78) + 0.012;
    const bend = t * t * 0.15 + Math.sin(t * Math.PI) * 0.025;
    positions.push(-width, t, bend, width, t, bend);
    const r = 0.60 + t * 0.54;
    const g = 0.68 + t * 0.40;
    const b = 0.53 + t * 0.33;
    colors.push(r, g, b, r, g, b);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildVegetation(state, root, materials, planterGrassBase) {
  const group = new THREE.Group();
  group.name = 'Seaside_Vegetation';
  root.add(group);
  const rng = mulberry32(0xc0a57a11);
  const bladeGeo = makeBladeGeometry();
  state.geometries.add(bladeGeo);
  const entries = [];
  const colors = [];
  const bases = [];
  const bladePalette = ['#7f8b70', '#8d9374', '#9c9b7a', '#aba582', '#75836b', '#919678'];
  const addClump = (x, z, count, radius, baseY = null) => {
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU;
      const r = Math.sqrt(rng()) * radius;
      const bx = x + Math.cos(angle) * r;
      const bz = z + Math.sin(angle) * r;
      if (baseY === null) {
        if (bx > SEASIDE_ANCHOR.standMinX - 0.22 && bx < SEASIDE_ANCHOR.standMaxX + 0.22 && bz > SEASIDE_ANCHOR.standMinZ - 0.22 && bz < SEASIDE_ANCHOR.standMaxZ + 0.22) continue;
        if (bz - seasideShoreZ(bx) < 0.75) continue;
      }
      const height = 0.28 + rng() * 0.44;
      const width = 0.013 + rng() * 0.014;
      const y = baseY === null ? seasideTerrainHeight(bx, bz) - 0.004 : baseY;
      entries.push({position: [bx, y, bz], scale: [width, height, 0.7], rotation: [0, rng() * TAU, (rng() - 0.5) * 0.12]});
      colors.push(new THREE.Color(bladePalette[Math.floor(rng() * bladePalette.length)]));
      bases.push({position: new THREE.Vector3(bx, y, bz), yaw: rng() * TAU, phase: rng() * TAU, scale: new THREE.Vector3(width, height, 0.7), amount: 0.7 + rng() * 0.5});
    }
  };
  const clumps = [
    [-6.58, 2.9, 18, 0.36], [-6.43, 4.3, 16, 0.34], [-6.62, 6.9, 18, 0.36], [-6.48, 8.5, 14, 0.32],
    [-6.35, 1.1, 14, 0.30], [-9.25, 2.4, 8, 0.22], [-6.36, 3.65, 14, 0.30], [-6.58, 5.65, 15, 0.32],
    [-6.32, 7.7, 13, 0.30],
    [6.4, 5.5, 16, 0.38], [7.4, 6.6, 16, 0.36], [8.5, 5.2, 14, 0.34], [8.9, 7.8, 14, 0.34],
    [5.4, 4.0, 13, 0.32], [6.15, -1.1, 12, 0.28], [7.45, 2.2, 12, 0.30],
    [4.7, 7.9, 12, 0.30], [-2.2, 8.2, 11, 0.28], [2.3, 8.5, 10, 0.28],
    [7.7, 4.35, 13, 0.32], [8.35, 6.2, 12, 0.30], [7.0, 7.9, 10, 0.30],
  ];
  for (const [x, z, n, r] of clumps) addClump(x, z, n, r);
  // The bench-side clump sits in the planter and is part of the same sway set.
  for (let i = 0; i < 13; i++) {
    const angle = rng() * TAU;
    const r = Math.sqrt(rng()) * 0.17;
    const p = planterGrassBase.clone().add(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    const h = 0.19 + rng() * 0.16;
    const s = new THREE.Vector3(0.012 + rng() * 0.009, h, 0.65);
    entries.push({position: [p.x, p.y, p.z], scale: [s.x, s.y, s.z], rotation: [0, rng() * TAU, 0]});
    colors.push(new THREE.Color(bladePalette[Math.floor(rng() * bladePalette.length)]));
    bases.push({position: p.clone(), yaw: rng() * TAU, phase: rng() * TAU, scale: s, amount: 0.65 + rng() * 0.3});
  }
  const fullGrass = addInstanced(state, group, 'coastal-grass', 'coastal-grass', bladeGeo, materials.grass, entries, {cast: false, receive: true, dynamic: true, colors});
  fullGrass.userData.baseCount = bases.length;

  // Low sea-wind shrubs at dune feet and rock bases; no tropical silhouettes.
  const shrubGeo = makeRockGeometry(91, 1);
  shrubGeo.scale(0.95, 0.78, 0.9);
  state.geometries.add(shrubGeo);
  const shrubEntries = [], shrubColors = [];
  const shrubPalette = ['#6a7b64', '#77876b', '#84916f', '#728168'];
  const shrubSpots = [
    [7.1, 5.2, 0.7], [7.9, 6.1, 0.54], [8.7, 4.5, 0.58], [8.9, 6.9, 0.5],
    [6.0, 3.1, 0.44], [7.6, 1.9, 0.4], [5.1, 7.8, 0.38], [-5.6, 8.1, 0.36], [-6.05, 5.0, 0.33],
  ];
  for (const [x, z, s] of shrubSpots) {
    const lobes = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < lobes; i++) {
      const bx = x + (rng() - 0.5) * s * 1.8;
      const bz = z + (rng() - 0.5) * s * 1.5;
      if (bx > SEASIDE_ANCHOR.standMinX - .35 && bx < SEASIDE_ANCHOR.standMaxX + .35 && bz > SEASIDE_ANCHOR.standMinZ - .35 && bz < SEASIDE_ANCHOR.standMaxZ + .35) continue;
      const scaleY = s * (0.55 + rng() * 0.32);
      const y = seasideTerrainHeight(bx, bz) + scaleY * 0.46;
      shrubEntries.push({position: [bx, y, bz], scale: [s * (0.62 + rng() * 0.32), scaleY, s * (0.55 + rng() * 0.28)], rotation: [0, rng() * TAU, (rng() - .5) * .12]});
      shrubColors.push(new THREE.Color(shrubPalette[Math.floor(rng() * shrubPalette.length)]));
    }
  }
  addInstanced(state, group, 'wind-shrubs', 'coastal-shrub', shrubGeo, materials.shrub, shrubEntries, {cast: true, receive: true, colors: shrubColors});

  return {group, grass: fullGrass, bases};
}

function makeShellGeometry() {
  const segments = 18, rings = 5;
  const positions = [], colors = [], indices = [];
  const c = new THREE.Color();
  const buildLayer = (side) => {
    const baseIndex = positions.length / 3;
    // Hinge at the origin, fan sweeping toward -Z.
    for (let ring = 0; ring <= rings; ring++) {
      const r = ring / rings;
      for (let i = 0; i <= segments; i++) {
        const a = -1.02 + (i / segments) * 2.04;
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r * 0.86;
        const ridge = Math.cos(a * 11.0) * 0.014 * r;
        const dome = Math.sin((1 - r) * Math.PI * 0.5) * 0.025 + ridge * 0.8;
        const y = side * (0.018 + dome);
        positions.push(x, y, z);
        const shade = 0.80 + 0.17 * Math.sin(a * 8.0) + r * 0.2;
        c.setRGB(0.97 * shade, 0.91 * shade, 0.84 * shade);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let i = 0; i < segments; i++) {
        const a = baseIndex + ring * (segments + 1) + i;
        const b = a + 1;
        const d = a + segments + 1;
        const e = d + 1;
        if (side > 0) indices.push(a, b, d, b, e, d);
        else indices.push(a, d, b, b, d, e);
      }
    }
  };
  buildLayer(1);
  buildLayer(-1);
  // Outer lip between the two curved faces.
  const lipBase = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const a = -1.02 + (i / segments) * 2.04;
    const x = Math.sin(a), z = -Math.cos(a) * 0.86;
    positions.push(x, 0.018, z, x, -0.018, z);
    c.setRGB(0.93, 0.86, 0.80); colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i < segments; i++) {
    const a = lipBase + i * 2, b = a + 1, d = a + 2, e = a + 3;
    indices.push(a, d, b, b, d, e);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addShellsAndPebbles(state, root, materials) {
  const group = new THREE.Group();
  group.name = 'Seaside_Details';
  root.add(group);
  const rng = mulberry32(0x5eaf00d);
  const shellGeo = makeShellGeometry();
  state.geometries.add(shellGeo);
  const shellEntries = [], shellColors = [];
  const shellSpots = [
    [-4.2, 1.05, 0.075], [-2.9, 1.55, 0.055], [-1.1, 1.15, 0.09],
    [1.1, 1.7, 0.058], [2.9, 1.25, 0.072], [4.25, 1.65, 0.051], [0.05, 0.72, 0.045],
  ];
  for (const [x, rel, size] of shellSpots) {
    const z = seasideShoreZ(x) + waterlineOffset(x) + rel;
    shellEntries.push({
      position: [x, seasideTerrainHeight(x, z) + 0.012, z],
      scale: [size, size, size * 1.1],
      rotation: [0.06 + rng() * 0.08, rng() * TAU, 0.03 + rng() * 0.06],
    });
    shellColors.push(new THREE.Color(['#e7d7c0', '#ead6c6', '#ddcfbf', '#f0dfca'][Math.floor(rng() * 4)]));
  }
  addInstanced(state, group, 'shells', 'shells', shellGeo, materials.shell, shellEntries, {cast: false, receive: true, colors: shellColors});

  const pebbleGeo = new THREE.IcosahedronGeometry(1, 1);
  state.geometries.add(pebbleGeo);
  const pebbleEntries = [], pebbleColors = [];
  const pebbleSpots = [[-4.8, 1.3], [-3.6, 0.8], [-1.6, 0.5], [0.7, 0.4], [2.1, 0.65], [3.8, 0.55], [5.6, 1.0], [7.2, 0.8], [-5.7, 2.2], [6.2, 4.1], [-5.1, 6.8], [4.5, 4.8]];
  for (const [x, rel] of pebbleSpots) {
    const z = seasideShoreZ(x) + waterlineOffset(x) + rel;
    const s = 0.035 + rng() * 0.055;
    pebbleEntries.push({position: [x, seasideTerrainHeight(x, z) + s * 0.22, z], scale: [s * 1.2, s * 0.55, s], rotation: [rng() * .4, rng() * TAU, rng() * .3]});
    pebbleColors.push(new THREE.Color(['#8f8c80', '#7f837d', '#a39a8b', '#777e7b'][Math.floor(rng() * 4)]));
  }
  addInstanced(state, group, 'pebbles', 'pebbles', pebbleGeo, materials.pebble, pebbleEntries, {cast: false, receive: true, colors: pebbleColors});

  // Two restrained wind-written arcs, placed outside the character floor.
  const ripPositions = [];
  const ripIndices = [];
  const addRibbon = (cx, cz, width, phase) => {
    const start = ripPositions.length / 3;
    for (let i = 0; i <= 36; i++) {
      const t = i / 36;
      const x = mix(cx - width * 0.5, cx + width * 0.5, t);
      const z = cz + Math.sin(t * Math.PI * 2 + phase) * 0.05;
      const y = seasideTerrainHeight(x, z) + 0.006;
      ripPositions.push(x, y, z - 0.006, x, y, z + 0.006);
    }
    for (let i = 0; i < 36; i++) {
      const a = start + i * 2, b = a + 1, c = a + 2, d = a + 3;
      ripIndices.push(a, c, b, b, c, d);
    }
  };
  for (let i = 0; i < 4; i++) addRibbon(-3.5, 2.5 + i * 0.28, 3.8, 0.3 + i * 0.2);
  for (let i = 0; i < 3; i++) addRibbon(5.2, 7.3 + i * 0.24, 3.2, 1.1 + i * 0.2);
  const rippleGeo = new THREE.BufferGeometry();
  rippleGeo.setAttribute('position', new THREE.Float32BufferAttribute(ripPositions, 3));
  rippleGeo.setIndex(ripIndices);
  rippleGeo.computeVertexNormals();
  state.geometries.add(rippleGeo);
  addMesh(state, group, 'wind-ripples', 'wind-ripples', rippleGeo, materials.ripple, {cast: false, receive: false, renderOrder: 1});
  return group;
}

function buildContactShadows(state, root, materials, objects) {
  const group = new THREE.Group();
  group.name = 'Seaside_ContactShadows';
  root.add(group);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  state.geometries.add(geo);
  const entries = [];
  for (const item of objects) {
    const y = item.y ?? seasideTerrainHeight(item.x, item.z) + 0.006;
    entries.push({position: [item.x, y, item.z], scale: [item.width, 1, item.depth], rotation: [0, item.rotation || 0, 0]});
  }
  addInstanced(state, group, 'contact-shadows', 'contact-shadow', geo, materials.shadow, entries, {cast: false, receive: false});
  return group;
}

export function buildSeaside(state, options = {}) {
  const preset = seasideLightingPreset(options.timeOfDay ?? options.lightingPreset ?? SEASIDE_DEFAULT_LIGHTING);
  const root = new THREE.Group();
  root.name = 'environment:seaside';
  if (!state.textures) state.textures = new Set();
  const ramp = makeToonRamp(state);
  const sandTexture = makeSandGrain(state);
  const woodTexture = makeWoodGrain(state);
  const shadowTexture = makeShadowTexture(state);
  const toon = (color, extra = {}) => {
    const material = new THREE.MeshToonMaterial({color, gradientMap: ramp, ...extra});
    state.materials.add(material);
    return material;
  };
  const standard = (params) => {
    const material = new THREE.MeshStandardMaterial(params);
    state.materials.add(material);
    return material;
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  state.geometries.add(box);
  const materials = {
    sand: toon(0xffffff, {vertexColors: true, map: sandTexture}),
    stoneDeep: toon('#56616a'),
    stone: toon('#6c7880'),
    stoneLight: toon('#879298'),
    coping: toon('#9ea49f'),
    copingLight: toon('#b6b4a9'),
    seaEdge: toon('#77848c'),
    deck: toon(0xffffff, {map: woodTexture}),
    structure: toon('#6c6055', {map: woodTexture}),
    rail: toon('#8a7c6f', {map: woodTexture}),
    benchSeat: toon('#a08f7f', {map: woodTexture}),
    benchBack: toon('#8e8072', {map: woodTexture}),
    benchLeg: toon('#6b6157', {map: woodTexture}),
    planter: toon('#665a4e', {map: woodTexture}),
    soil: toon('#4b4137'),
    woodWear: toon('#ad9880', {map: woodTexture}),
    woodCrack: toon('#463b31'),
    nail: standard({color: '#4c5355', roughness: 0.42, metalness: 0.45}),
    rock: toon(0xffffff, {vertexColors: true}),
    wetRock: standard({color: '#4d5654', roughness: 0.3, metalness: 0.03, transparent: true, opacity: 0.5}),
    grass: toon(0xffffff, {vertexColors: true, side: THREE.DoubleSide}),
    shrub: toon(0xffffff, {vertexColors: true}),
    shell: toon(0xffffff, {vertexColors: true, side: THREE.DoubleSide}),
    pebble: toon(0xffffff),
    ripple: new THREE.MeshBasicMaterial({color: '#f3e8d0', transparent: true, opacity: 0.15, depthWrite: false, toneMapped: false}),
    shadow: new THREE.MeshBasicMaterial({map: shadowTexture, transparent: true, opacity: 0.22, depthWrite: false, color: '#38434b', toneMapped: false}),
  };
  materials.deck.color.set(0xffffff);
  for (const material of [materials.deck, materials.structure, materials.rail, materials.benchSeat, materials.benchBack, materials.benchLeg, materials.planter]) {
    material.map = woodTexture;
  }
  materials.nail.userData.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  state.geometries.add(materials.nail.userData.cylinder);
  materials.deck.userData.boxGeometry = box;
  materials.structure.userData.boxGeometry = box;
  materials.rail.userData.boxGeometry = box;
  materials.benchSeat.userData.boxGeometry = box;
  materials.planter.userData.boxGeometry = box;

  const base = buildBase(state, root, materials);
  const sandGroup = new THREE.Group(); sandGroup.name = 'Seaside_Sand'; root.add(sandGroup);
  buildBeachTerrain(state, sandGroup, materials);
  const wetGeometry = makeWetGeometry();
  state.geometries.add(wetGeometry);
  const wetMaterial = makeWetMaterial(preset, state);
  addMesh(state, sandGroup, 'wet-sand', 'wet-sand', wetGeometry, wetMaterial, {cast: false, receive: false, renderOrder: 1});

  const seaGroup = new THREE.Group(); seaGroup.name = 'Seaside_Sea'; root.add(seaGroup);
  const waterGeometry = makeWaterGeometry();
  state.geometries.add(waterGeometry);
  const waterMaterial = makeWaterMaterial(preset, state);
  addMesh(state, seaGroup, 'bounded-sea', 'sea', waterGeometry, waterMaterial, {cast: false, receive: false, renderOrder: 2});
  const foamGeometry = makeFoamGeometry();
  state.geometries.add(foamGeometry);
  const foamMaterial = makeFoamMaterial(preset, state);
  addMesh(state, seaGroup, 'shore-foam', 'shore-foam', foamGeometry, foamMaterial, {cast: false, receive: false, renderOrder: 3});

  const boardwalk = buildBoardwalk(state, root, materials);
  const bench = buildBench(state, root, materials, boardwalk.deckTop);
  const rocks = buildRocks(state, root, materials);
  const vegetation = buildVegetation(state, root, materials, bench.planterGrassBase);
  addShellsAndPebbles(state, root, materials);

  // Grounding shadows are intentionally authored as soft contact ellipses. The
  // real shadow map is only enabled in the interactive gallery; these keep every
  // post, rock and bench leg planted in the passive backdrop too.
  const contacts = [
    {x: -7.02, z: 1.14, y: boardwalk.deckTop + 0.004, width: 2.15, depth: 1.15, rotation: -1.18},
    {x: -6.38, z: 1.35, y: boardwalk.deckTop + 0.004, width: 0.62, depth: 0.52, rotation: 0},
  ];
  for (const [x, z, sx] of [[6.35, -2.12, 2.1], [7.92, 3.0, 1.8], [8.66, 7.1, 1.3], [8.18, 7.52, 0.9]]) contacts.push({x, z, width: sx, depth: sx * 0.72});
  for (const zPost of [8.7, 7.0, 5.3, 3.6, 2.25, 0.55]) {
    for (const side of [-1, 1]) contacts.push({x: -8.32 + side * 0.55, z: zPost, width: 0.42, depth: 0.42});
  }
  buildContactShadows(state, root, materials, contacts);

  const anchor = new THREE.Group();
  anchor.name = SEASIDE_ANCHOR.name;
  anchor.position.set(SEASIDE_ANCHOR.x, SEASIDE_ANCHOR.y, SEASIDE_ANCHOR.z);
  anchor.visible = false;
  anchor.userData = {
    role: 'character-anchor',
    hidden: true,
    surface: SEASIDE_ANCHOR.surface,
    stand: {minX: SEASIDE_ANCHOR.standMinX, maxX: SEASIDE_ANCHOR.standMaxX, minZ: SEASIDE_ANCHOR.standMinZ, maxZ: SEASIDE_ANCHOR.standMaxZ},
    note: SEASIDE_ANCHOR.note,
  };
  root.add(anchor);

  const sim = {
    time: 0,
    waterTime: 0,
    foamTime: 0,
    windTime: 0,
    motion: {waves: true, foam: true, wind: true},
    preset: preset.id,
    waterMaterial,
    foamMaterial,
    wetMaterial,
    grass: vegetation.grass,
    grassBases: vegetation.bases,
    windDirection: new THREE.Vector2(0.84, 0.54).normalize(),
    currentLighting: preset,
  };
  const windAxis = new THREE.Vector3(sim.windDirection.y, 0, -sim.windDirection.x).normalize();
  const grassMatrix = new THREE.Matrix4();
  const grassQuat = new THREE.Quaternion();
  const grassLean = new THREE.Quaternion();
  const grassYaw = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  function setGrassPose(time) {
    if (!sim.grass) return;
    for (let i = 0; i < sim.grassBases.length; i++) {
      const base = sim.grassBases[i];
      const sway = Math.sin(time * 0.82 + base.phase) * 0.060 * base.amount + Math.sin(time * 1.63 + base.phase * 1.31) * 0.014 * base.amount;
      const gust = Math.sin(time * 0.17 + base.position.x * 0.14) * 0.014;
      grassLean.setFromAxisAngle(windAxis, sway + gust);
      grassYaw.setFromAxisAngle(up, base.yaw);
      grassQuat.copy(grassLean).multiply(grassYaw);
      grassMatrix.compose(base.position, grassQuat, base.scale);
      sim.grass.setMatrixAt(i, grassMatrix);
    }
    sim.grass.instanceMatrix.needsUpdate = true;
  }
  function update(elapsed, delta = 0.016) {
    if (!Number.isFinite(elapsed)) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 0.016, 0, 0.08);
    if (sim.motion.waves) sim.waterTime += dt;
    if (sim.motion.foam) sim.foamTime += dt;
    if (sim.motion.wind) sim.windTime += dt;
    else sim.windTime = 0;
    waterMaterial.uniforms.uTime.value = sim.waterTime;
    foamMaterial.uniforms.uTime.value = sim.foamTime;
    wetMaterial.uniforms.uTime.value = sim.waterTime * 0.3;
    if (sim.motion.wind) setGrassPose(sim.windTime);
  }
  function setMotion(config = {}) {
    for (const key of ['waves', 'foam', 'wind']) if (typeof config[key] === 'boolean') sim.motion[key] = config[key];
    if (typeof config.enabled === 'boolean') {
      sim.motion.waves = config.enabled;
      sim.motion.foam = config.enabled;
      sim.motion.wind = config.enabled;
    }
    if (!sim.motion.wind) setGrassPose(0);
    return {...sim.motion};
  }
  function setLightingPreset(value) {
    const next = seasideLightingPreset(value);
    sim.preset = next.id;
    sim.currentLighting = next;
    for (const [key, uniform] of [['deep', 'uDeep'], ['middle', 'uMiddle'], ['shallow', 'uShallow'], ['crest', 'uCrest'], ['glint', 'uGlint'], ['foam', 'uFoam'], ['sky', 'uSky']]) {
      waterMaterial.uniforms[uniform].value.set(next.water[key]);
    }
    waterMaterial.uniforms.uGlintStrength.value = next.glintStrength;
    waterMaterial.uniforms.uFoamStrength.value = next.foamStrength;
    waterMaterial.uniforms.uReflectionCenter.value = next.reflectionCenter;
    foamMaterial.uniforms.uFoam.value.set(next.water.foam);
    foamMaterial.uniforms.uGlass.value.set(next.water.shallow);
    foamMaterial.uniforms.uStrength.value = next.foamStrength;
    wetMaterial.uniforms.uWarm.value.set(next.water.glint);
    wetMaterial.uniforms.uCool.value.set(next.water.sky);
    wetMaterial.uniforms.uSunDir.value.set(...next.sun.position).normalize();
    return next.id;
  }
  // Initial grass pose gives a composed still even when reduced motion is on.
  setGrassPose(1.7);

  const api = {
    update,
    setMotion,
    setLightingPreset,
    motion: sim.motion,
    get preset() { return sim.preset; },
    camera: SEASIDE_CAMERAS,
    anchor,
    shoreZ: seasideShoreZ,
    terrainHeight: seasideTerrainHeight,
    waterlineOffset,
    stand: {minX: SEASIDE_ANCHOR.standMinX, maxX: SEASIDE_ANCHOR.standMaxX, minZ: SEASIDE_ANCHOR.standMinZ, maxZ: SEASIDE_ANCHOR.standMaxZ},
    presetData: SEASIDE_LIGHTING_PRESETS,
    groups: {base, sand: sandGroup, sea: seaGroup, boardwalk: boardwalk.group, bench: bench.group, rocks, vegetation: vegetation.group, anchor},
  };
  root.userData.seaside = api;
  return root;
}

export function updateSeaside(group, elapsed, delta) {
  group?.userData?.seaside?.update?.(elapsed, delta);
}

export function applySeasideLighting(group, preset) {
  return group?.userData?.seaside?.setLightingPreset?.(preset) ?? null;
}

export function setSeasideMotion(group, config) {
  return group?.userData?.seaside?.setMotion?.(config) ?? null;
}
