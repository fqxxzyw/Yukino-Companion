import * as THREE from 'three';
import {paintCumulus} from './cumulus-sky.mjs';

// One small, deterministic equirectangular sky per active scene. The sky is
// painted, never geometry: clouds cannot intersect architecture and stay a
// distant, soft backdrop while the camera orbits the miniature.
//
// Rows map to elevation (row 0 = nadir, last row = zenith) and columns map to
// azimuth, matching three's equirectUv(). The palette is written in sRGB because
// the texture is marked SRGBColorSpace.
const W = 1024, H = 512;
const PAINT_WIDTH = 1536, PAINT_HEIGHT = 768;
const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value;
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (x, y) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
function noise(x, y, period) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const wrap = n => (n % period + period) % period;
  const a = hash(wrap(ix), iy), b = hash(wrap(ix + 1), iy);
  const c = hash(wrap(ix), iy + 1), d = hash(wrap(ix + 1), iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm(x, y, period, octaves = 4, lacunarity = 2, gain = .5) {
  let sum = 0, amplitude = 1, normal = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x, y, period);
    normal += amplitude;
    amplitude *= gain;
    x *= lacunarity;
    y *= lacunarity;
    period *= lacunarity;
  }
  return sum / normal;
}

// Domain-warped fields and volumetric cumulus heights are built once at module
// load. Weather only recombines them, so a cloudy afternoon remains identical
// when the user returns to it.
const cloudBase = new Float32Array(W * H);
const cloudDetail = new Float32Array(W * H);
const cloudHeight = new Float32Array(W * H);
const cloudRidgeX = new Float32Array(W * H);
const cloudRidgeY = new Float32Array(W * H);
const cirrusField = new Float32Array(W * H);
const horizonField = new Float32Array(W * H);
{
  // Multi-lobe fair-weather cumulus clusters with staggered towers, broad clear
  // blue gaps, and ragged cauliflower edges (no isolated smooth ovals).
  const clusters = [
    [.07, .545, 1.05], [.21, .535, .72], [.39, .548, 1.15],
    [.56, .532, .68], [.70, .550, 1.08], [.88, .538, .85],
  ];
  const banks = [];
  for (let c = 0; c < clusters.length; c++) {
    const [cx, cy, s] = clusters[c];
    const lobes = [
      [-.052, -.004, .048, .022, .72], [-.022, .012, .044, .034, .92],
      [.008, .022, .042, .042, 1.0], [.038, .010, .046, .030, .86],
      [.068, -.005, .044, .020, .66],
    ];
    for (const [dx, dy, rx, ry, w] of lobes) {
      banks.push([cx + dx * s, cy + dy * s, rx * s, ry * s, w]);
    }
  }
  const rawHeight = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W, index = y * W + x;
      const warpX = fbm(u * 3.0, v * 5.0, 3, 3);
      const warpY = fbm(u * 4.0 + 7.7, v * 6.0 + 2.3, 4, 3);
      const px = u + (warpX - .5) * .12;
      const py = v + (warpY - .5) * .06;
      const base = fbm(px * 6, py * 12, 6, 5);
      const detail = fbm((px + .11) * 18, (py - .07) * 36, 18, 4);
      const puff = fbm((px - .07) * 12, (py + .05) * 24, 12, 4);
      const micro = fbm((px + .23) * 32, (py + .19) * 64, 32, 3);
      cloudBase[index] = base;
      cloudDetail[index] = detail * .7 + micro * .3;
      cirrusField[index] = fbm((u + (warpX - .5) * .14) * 3, v * 36, 3, 4);
      horizonField[index] = fbm((u + (warpX - .5) * .18) * 6, v * 18, 6, 4);
      let env = 0;
      if (v > .49 && v < .84) {
        const floorCut = smooth(clamp01((v - (.516 + (base - .5) * .018)) / .015));
        for (let b = 0; b < banks.length; b++) {
          const [cx, cy, rx, ry, weight] = banks[b];
          let du = u - cx;
          if (du > .5) du -= 1;
          else if (du < -.5) du += 1;
          const dv = v - cy;
          const dist2 = (du / rx) ** 2 + (dv / ry) ** 2;
          if (dist2 > 2.1) continue;
          const billow = 1.0 - dist2 + (puff - .44) * 1.05 + (detail - .5) * .52 + (micro - .5) * .22;
          const h = clamp01(billow * weight) * floorCut;
          if (h > env) env = h;
        }
      }
      rawHeight[index] = env;
      cloudHeight[index] = env;
    }
  }
  // Finite-difference slope of the cumulus heightfield gives natural top-lit
  // crests, shadowed troughs and soft cool undersides without blocky edges.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const xm = y * W + ((x - 2 + W) % W), xp = y * W + ((x + 2) % W);
      const ym = Math.max(0, y - 2) * W + x, yp = Math.min(H - 1, y + 2) * W + x;
      cloudRidgeX[idx] = (rawHeight[xp] - rawHeight[xm]) * 2.4;
      cloudRidgeY[idx] = (rawHeight[yp] - rawHeight[ym]) * 2.4;
    }
  }
}

const sunFallback = [1, .42, .65];
function normalizedDirection(value) {
  // Accept both the sunlight config array and a THREE.Vector3 from the key
  // light. Zero is a valid component (the noon sun sits straight overhead).
  const component = (index, axis, fallback) => {
    const raw = value?.[index] ?? value?.[axis];
    const number = Number(raw);
    return Number.isFinite(number) ? number : fallback;
  };
  const x = component(0, 'x', sunFallback[0]);
  const y = component(1, 'y', sunFallback[1]);
  const z = component(2, 'z', sunFallback[2]);
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function createDaySky() {
  const ownedTextures = new WeakSet();
  const makeTexture = (data, style) => {
    const next = new THREE.DataTexture(data, style==='toon'?PAINT_WIDTH:W, style==='toon'?PAINT_HEIGHT:H);
    next.name = style === 'toon' ? 'weather:gouache-cumulus' : 'weather:day-sky-clouds';
    next.mapping = THREE.EquirectangularReflectionMapping;
    next.wrapS = THREE.RepeatWrapping;
    next.colorSpace = THREE.SRGBColorSpace;
    next.minFilter = next.magFilter = THREE.LinearFilter;
    next.generateMipmaps = false;
    next.needsUpdate = true;
    ownedTextures.add(next);
    return next;
  };
  const pixels = new Uint8Array(W * H * 4);
  // Three caches an equirectangular background's cube conversion by texture
  // identity. Mutating one DataTexture repaints the CPU bytes but not the
  // already-converted sky, so each weather change swaps in a fresh texture.
  const variants = new Map();
  let texture = null;
  function publish(style, key, data=pixels.slice()) {
    variants.get(style)?.texture.dispose();
    texture = makeTexture(data, style);
    variants.set(style, {key, texture});
    return true;
  }

  // Paint a full sky for the current sun and weather. Returns true when the
  // texture changed. The work is deterministic: same inputs, same bytes.
  function update(daylight, weather, sunDirection = null, style = 'lit') {
    const cloud = clamp01(weather?.cloud || 0);
    const rain = clamp01(weather?.rain || 0);
    const fog = clamp01(weather?.fog || 0);
    const snow = clamp01(weather?.snow || 0);
    const brightness = clamp01(daylight?.brightness ?? 1);
    // A low warm sun reads as evening even when the hour curve still calls it
    // "day"; the sky warms with the actual key intensity, not with exposure.
    const sunIntensity = Number(daylight?.sun?.intensity);
    const warmth = Number.isFinite(sunIntensity) ? clamp01((2.7 - sunIntensity) / 1.2) : 0;
    const twilight = Math.max(daylight?.twilight === true && brightness > .02 ? 1 - brightness : 0, Math.pow(warmth, .65) * (daylight?.night ? 0 : 1));
    const sun = normalizedDirection(sunDirection || daylight?.sun?.position);
    const next = [
      Math.round(cloud * 20), Math.round(rain * 20), Math.round(fog * 20), Math.round(snow * 20),
      Math.round(brightness * 12), Math.round(twilight * 10),
      Math.round(sun[0] * 24), Math.round(sun[1] * 24), Math.round(sun[2] * 24),
      Math.round((daylight?.hour ?? 12) * 4),
    ].join(':');
    const cached = variants.get(style);
    if (cached?.key === next) { texture = cached.texture; return false; }
    if (style === 'toon') {
      const pigment=new Uint8Array(PAINT_WIDTH*PAINT_HEIGHT*4);
      paintCumulus(pigment,PAINT_WIDTH,PAINT_HEIGHT,daylight,weather,sun);
      return publish(style,next,pigment);
    }

    // Orthonormal basis around the sun for the soft crepuscular spokes. A sun
    // near the poles needs a different reference axis to keep the basis stable.
    const up = Math.abs(sun[1]) > .94 ? [0, 0, 1] : [0, 1, 0];
    let right = [
      sun[1] * up[2] - sun[2] * up[1],
      sun[2] * up[0] - sun[0] * up[2],
      sun[0] * up[1] - sun[1] * up[0],
    ];
    const rightLength = Math.hypot(...right) || 1;
    right = right.map(value => value / rightLength);
    const up2 = [
      right[1] * sun[2] - right[2] * sun[1],
      right[2] * sun[0] - right[0] * sun[2],
      right[0] * sun[1] - right[1] * sun[0],
    ];

    // A crisp, clear atmospheric Rayleigh gradient: transparent cerulean zenith
    // easing naturally into a luminous pale horizon. Twilight shifts smoothly
    // into golden-apricot and dusty indigo without losing sky clarity.
    const zenith = [lerp(42, 44, twilight), lerp(128, 86, twilight), lerp(224, 152, twilight)];
    const horizon = [lerp(184, 252, twilight), lerp(222, 174, twilight), lerp(246, 128, twilight)];
    const overcast = [166, 175, 184];
    const fogColor = [172, 182, 190];
    const warmSun = [
      lerp(255, 255, twilight), lerp(246, 196, twilight), lerp(220, 146, twilight),
    ];
    const lightCloud = [lerp(255, 255, twilight), lerp(254, 226, twilight), lerp(250, 190, twilight)];
    const midCloud = [lerp(226, 224, twilight), lerp(234, 188, twilight), lerp(244, 174, twilight)];
    const shadowCloud = [lerp(154, 134, twilight), lerp(176, 132, twilight), lerp(204, 162, twilight)];

    // Overcast cloud layer smoothly fills in the clear gaps as cloud cover rises.
    const overcastLimit = .58 - cloud * .46;
    for (let y = 0; y < H; y++) {
      const v = y / H;
      const latitude = (v - .5) * Math.PI;
      const cosLatitude = Math.cos(latitude), sinLatitude = Math.sin(latitude);
      const altitude = smooth(clamp01((v - .485) / .04)) * (1 - smooth(clamp01((v - .955) / .045)));
      const gradient = Math.pow(clamp01((v - .49) * 2.75), .56);
      const skyR = lerp(horizon[0], zenith[0], gradient);
      const skyG = lerp(horizon[1], zenith[1], gradient);
      const skyB = lerp(horizon[2], zenith[2], gradient);
      const haze = (1 - smooth(clamp01((v - .485) / .13))) * .11;
      for (let x = 0; x < W; x++) {
        const u = x / W, index = y * W + x;
        const azimuth = (u - .5) * Math.PI * 2;
        const dir = [cosLatitude * Math.cos(azimuth), sinLatitude, cosLatitude * Math.sin(azimuth)];
        const sunDot = Math.max(0, dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]);

        const base = cloudBase[index], detail = cloudDetail[index];
        const cumulusEnv = cloudHeight[index];
        // Realistic feathered fair-weather cumulus: volumetric domes with crisp
        // billowing tops, internal shadows and clear open blue sky between banks.
        const cumulus = smooth(clamp01((cumulusEnv - (.24 - cloud * .16)) / .26));
        const deck = smooth(clamp01((base * .72 + detail * .28 - overcastLimit) / .22)) * (cloud * .92);
        // Delicate high-altitude cirrus wisps stay subtle on clear afternoons.
        const cirrusBand = smooth(clamp01((v - .62) / .08)) * (1 - smooth(clamp01((v - .86) / .10)));
        const cirrus = smooth(clamp01((cirrusField[index] - (.61 - cloud * .08)) / .19)) * cirrusBand * (.22 + cloud * .22);
        // Distant low horizon cloudlets give far atmospheric scale.
        const horizonBand = smooth(clamp01((v - .50) / .018)) * (1 - smooth(clamp01((v - .565) / .055)));
        const farClouds = smooth(clamp01((horizonField[index] - (.57 - cloud * .14)) / .18)) * horizonBand * (.42 + cloud * .25);

        let density = clamp01(Math.max(cumulus * .94, deck) + farClouds * (1 - cumulus * .6) + cirrus * (1 - cumulus * .8));
        density *= altitude;

        // Volumetric cloud shading from baked heightfield slopes + vertical rise + sun forward scatter.
        const lateralSun = -Math.sin(azimuth) * sun[0] + Math.cos(azimuth) * sun[2];
        const slopeLight = cloudRidgeX[index] * lateralSun * .32 + cloudRidgeY[index] * Math.max(.25, sun[1]) * .42;
        const verticalLit = smooth(clamp01((v - .515) / .095));
        const silverLining = Math.pow(sunDot, 7) * .36 * (1 - cumulus * .45);
        const cloudLight = clamp01(.24 + .46 * verticalLit + slopeLight + silverLining + (detail - .5) * .18 - rain * .22 + snow * .10);
        const midMix = smooth(clamp01(cloudLight * 1.45));
        const topMix = smooth(clamp01((cloudLight - .42) / .48));
        let cloudR = lerp(lerp(shadowCloud[0], midCloud[0], midMix), lightCloud[0], topMix);
        let cloudG = lerp(lerp(shadowCloud[1], midCloud[1], midMix), lightCloud[1], topMix);
        let cloudB = lerp(lerp(shadowCloud[2], midCloud[2], midMix), lightCloud[2], topMix);
        // Far horizon cloudlets softly lose contrast into atmospheric haze.
        const farFade = farClouds * (1 - cumulus) * .32;
        cloudR = lerp(cloudR, horizon[0], farFade);
        cloudG = lerp(cloudG, horizon[1], farFade);
        cloudB = lerp(cloudB, horizon[2], farFade);
        // Rain and fog flatten the cloud contrast; snow keeps it brighter.
        cloudR = lerp(cloudR, 152, rain * .24) * (1 - rain * .12) + snow * 11;
        cloudG = lerp(cloudG, 162, rain * .26) * (1 - rain * .14) + snow * 5;
        cloudB = lerp(cloudB, 174, rain * .28) * (1 - rain * .10) + snow * 4;
        cloudR = lerp(cloudR, fogColor[0], fog * .48);
        cloudG = lerp(cloudG, fogColor[1], fog * .48);
        cloudB = lerp(cloudB, fogColor[2], fog * .48);

        let r = lerp(skyR, cloudR, density);
        let g = lerp(skyG, cloudG, density);
        let b = lerp(skyB, cloudB, density);
        const veil = cloud * .78 * (1 - snow * .36) + rain * .26 + fog * .32;
        r = lerp(r, overcast[0], veil * .76);
        g = lerp(g, overcast[1], veil * .76);
        b = lerp(b, overcast[2], veil * .76);
        r = lerp(r, fogColor[0], haze * (fog * .7 + .3));
        g = lerp(g, fogColor[1], haze * (fog * .7 + .3));
        b = lerp(b, fogColor[2], haze * (fog * .7 + .3));

        // The sun disc and its halo only exist where the cloud lets light
        // through. A tiny disc keeps the sky readable without a lens flare.
        const disc = smooth(clamp01((sunDot - .99990) / .00008)) * (1 - density * .94) * (1 - cloud * .55);
        const halo = Math.pow(sunDot, 34) * .28 + Math.pow(sunDot, 7) * .05;
        const litHalo = halo * (1 - density * .82) * (1 - rain * .55) * (1 - fog * .55);

        const dx = dir[0] - sun[0] * sunDot, dy = dir[1] - sun[1] * sunDot, dz = dir[2] - sun[2] * sunDot;
        const radial = Math.hypot(dx, dy, dz);
        let spokes = 0;
        if (radial > .00001 && sunDot > -.1) {
          const angle = Math.atan2(dx * up2[0] + dy * up2[1] + dz * up2[2], dx * right[0] + dy * right[1] + dz * right[2]);
          const fine = .5 + .5 * Math.sin(angle * 71 + Math.sin(angle * 29) * 2.2);
          const coarse = .5 + .5 * Math.sin(angle * 137 + 1.3);
          const pattern = fine * .68 + coarse * .32;
          const falloff = Math.pow(Math.max(0, 1 - radial / .92), 1.55);
          spokes = falloff * (.28 + .72 * pattern) * (1 - density * .72) * (1 - cloud * .20);
        }
        const sunStrength = brightness * (1 - rain * .75) * (1 - fog * .7) * (1 - snow * .35);
        const rays = spokes * sunStrength * .14 * (twilight ? 1.35 : 1);
        const glow = (disc * 1.35 + litHalo) * (.35 + .65 * brightness);

        r = r * (.26 + .74 * brightness) + warmSun[0] * rays + warmSun[0] * glow;
        g = g * (.26 + .74 * brightness) + warmSun[1] * rays + warmSun[1] * glow;
        b = b * (.26 + .74 * brightness) + warmSun[2] * rays + warmSun[2] * glow;
        r = lerp(r, 238, snow * .16);
        g = lerp(g, 242, snow * .16);
        b = lerp(b, 246, snow * .16);

        const k = index * 4;
        pixels[k] = Math.round(THREE.MathUtils.clamp(r, 0, 255));
        pixels[k + 1] = Math.round(THREE.MathUtils.clamp(g, 0, 255));
        pixels[k + 2] = Math.round(THREE.MathUtils.clamp(b, 0, 255));
        pixels[k + 3] = 255;
      }
    }
    return publish(style,next);
  }

  return {get texture() { return texture; }, owns: value => ownedTextures.has(value), update, dispose() {
    for (const variant of variants.values()) variant.texture.dispose();
    variants.clear(); texture=null;
  }};
}
