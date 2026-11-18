import * as THREE from 'three';

// One small, deterministic equirectangular sky per active scene. The sky is
// painted, never geometry: clouds cannot intersect architecture and stay a
// distant, soft backdrop while the camera orbits the miniature.
//
// Rows map to elevation (row 0 = nadir, last row = zenith) and columns map to
// azimuth, matching three's equirectUv(). The palette is written in sRGB because
// the texture is marked SRGBColorSpace.
const W = 640, H = 320;
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

// Domain-warped fields are built once. Weather only recombines them, so a
// cloudy afternoon remains exactly the same sky when the user returns to it.
const cloudBase = new Float32Array(W * H);
const cloudDetail = new Float32Array(W * H);
const cirrusField = new Float32Array(W * H);
const warpXField = new Float32Array(W * H);
const warpYField = new Float32Array(W * H);
const horizonField = new Float32Array(W * H);
{
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W, index = y * W + x;
      const warpX = fbm(u * 2.4, v * 3.7, 2, 3);
      const warpY = fbm(u * 3.1 + 7.7, v * 4.9 + 2.3, 3, 3);
      const px = u + (warpX - .5) * .44;
      const py = v + (warpY - .5) * .22;
      warpXField[index] = warpX;
      warpYField[index] = warpY;
      // Broad smoke mass with a second, finer turbulence layer. Both are
      // sampled with a wide smoothstep later, which avoids cut-out "block"
      // clouds and keeps the silhouette feathered like a real cumulus edge.
      cloudBase[index] = fbm(px * 5, py * 11, 5, 5);
      cloudDetail[index] = fbm((px + .11) * 13, (py - .07) * 27, 13, 4);
      // Cirrus is stretched along the horizon: few cycles in azimuth, many in
      // altitude, producing long fibrous wisps instead of puffs.
      cirrusField[index] = fbm((u + (warpX - .5) * .16) * 2, v * 31, 2, 4);
      // Distant cumulus hugging the horizon. Wide in azimuth and shallow in
      // altitude so the strip of sky visible from the miniature's ground-level
      // camera reads as layered cloud instead of an empty gradient.
      horizonField[index] = fbm((u + (warpX - .5) * .22) * 4, v * 15, 4, 4);
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
  const makeTexture = data => {
    const next = new THREE.DataTexture(data, W, H);
    next.name = 'weather:day-sky-clouds';
    next.mapping = THREE.EquirectangularReflectionMapping;
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
  let texture = makeTexture(pixels), key = '';

  // Paint a full sky for the current sun and weather. Returns true when the
  // texture changed. The work is deterministic: same inputs, same bytes.
  function update(daylight, weather, sunDirection = null) {
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
    ].join(':');
    if (next === key) return false;
    key = next;

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

    // A clear blue dome with a thin pale horizon. The deeper zenith is painted
    // into the background texture only; the scene's light probe stays neutral.
    const zenith = [lerp(58, 52, twilight), lerp(142, 98, twilight), lerp(227, 158, twilight)];
    const horizon = [lerp(186, 250, twilight), lerp(222, 176, twilight), lerp(246, 126, twilight)];
    const overcast = [168, 176, 184];
    const fogColor = [168, 178, 186];
    const warmSun = [
      lerp(255, 255, twilight), lerp(246, 194, twilight), lerp(218, 142, twilight),
    ];
    const lightCloud = [255, 255, 255];
    const shadowCloud = [122, 137, 154];

    // A clear sky keeps large blue gaps. Cloud cover lowers the threshold so
    // the same smoke field fills in smoothly for rain and overcast.
    const limit = .55 - cloud * .45;
    for (let y = 0; y < H; y++) {
      const v = y / H;
      const latitude = (v - .5) * Math.PI;
      const cosLatitude = Math.cos(latitude), sinLatitude = Math.sin(latitude);
      const altitude = smooth(clamp01((v - .48) / .05)) * (1 - smooth(clamp01((v - .955) / .045)));
      const gradient = Math.pow(clamp01(v), .7);
      // Row 0 is the nadir; the visible sky begins around the 45% line.
      const skyR = lerp(horizon[0], zenith[0], gradient);
      const skyG = lerp(horizon[1], zenith[1], gradient);
      const skyB = lerp(horizon[2], zenith[2], gradient);
      // Keep the haze in a thin horizon band instead of greying the sky the
      // companion camera actually sees above the rooftops.
      const haze = (1 - smooth(clamp01((v - .48) / .16))) * .09;
      for (let x = 0; x < W; x++) {
        const u = x / W, index = y * W + x;
        const azimuth = (u - .5) * Math.PI * 2;
        const dir = [cosLatitude * Math.cos(azimuth), sinLatitude, cosLatitude * Math.sin(azimuth)];
        const sunDot = Math.max(0, dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]);

        const base = cloudBase[index], detail = cloudDetail[index];
        const turbulence = base * .74 + detail * .26;
        const warped = turbulence + (warpXField[index] - .5) * .10 + (warpYField[index] - .5) * .05;
        let density = smooth(clamp01((warped - limit) / .22));
        density = clamp01(density * (1.18 + cloud * .45));
        // Fibrous high cirrus rides above the smoke, but a clear afternoon
        // should still read as blue rather than a white veil.
        const cirrus = smooth(clamp01((cirrusField[index] - (.54 - cloud * .10)) / .20)) * .55;
        density = clamp01(density + cirrus * (.26 + cloud * .30));
        density *= altitude;
        // Horizon cumulus is visible from the companion camera and from the
        // full gallery even when the upper sky is outside the frame.
        const horizonBand = smooth(clamp01((v - .485) / .025)) * (1 - smooth(clamp01((v - .625) / .10)));
        const horizonCloud = smooth(clamp01((horizonField[index] - (.56 - cloud * .18)) / .20));
        density = clamp01(density + horizonCloud * horizonBand * (.46 + cloud * .30));

        // Soft top-lit volume: the sun side is brighter, thick bases darker.
        // Rain flattens the top lighting so the deck reads as low cloud.
        const cloudLight = clamp01(.38 + .62 * Math.max(0, sun[1]) + Math.pow(sunDot, 5) * .38 - density * .14 + snow * .10 - rain * .12);
        let cloudR = lerp(shadowCloud[0], lightCloud[0], cloudLight);
        let cloudG = lerp(shadowCloud[1], lightCloud[1], cloudLight);
        let cloudB = lerp(shadowCloud[2], lightCloud[2], cloudLight);
        // Rain and fog flatten the cloud contrast; snow keeps it brighter.
        cloudR = lerp(cloudR, 154, rain * .22) * (1 - rain * .12) + snow * 11;
        cloudG = lerp(cloudG, 164, rain * .24) * (1 - rain * .14) + snow * 5;
        cloudB = lerp(cloudB, 174, rain * .26) * (1 - rain * .10) + snow * 4;
        cloudR = lerp(cloudR, fogColor[0], fog * .48);
        cloudG = lerp(cloudG, fogColor[1], fog * .48);
        cloudB = lerp(cloudB, fogColor[2], fog * .48);

        let r = lerp(skyR, cloudR, density);
        let g = lerp(skyG, cloudG, density);
        let b = lerp(skyB, cloudB, density);
        // Broad overcast veil: the blue stays in the gaps, the rest greys out.
        // Snow keeps the cloud deck pale instead of turning it into rain dusk.
        const veil = cloud * .80 * (1 - snow * .36) + rain * .25 + fog * .30;
        r = lerp(r, overcast[0], veil * .78);
        g = lerp(g, overcast[1], veil * .78);
        b = lerp(b, overcast[2], veil * .78);
        r = lerp(r, fogColor[0], haze * (fog * .7 + .3));
        g = lerp(g, fogColor[1], haze * (fog * .7 + .3));
        b = lerp(b, fogColor[2], haze * (fog * .7 + .3));

        // The sun disc and its halo only exist where the cloud lets light
        // through. A tiny disc keeps the sky readable without a lens flare.
        const disc = smooth(clamp01((sunDot - .99990) / .00008)) * (1 - density * .94) * (1 - cloud * .55);
        const halo = Math.pow(sunDot, 34) * .30 + Math.pow(sunDot, 7) * .055;
        const litHalo = halo * (1 - density * .8) * (1 - rain * .55) * (1 - fog * .55);

        // Crepuscular spokes. They live in the gap between cloud edges, so the
        // shafts fade where the smoke is dense and stretch outward across the
        // sky exactly like scattered daylight (Tyndall effect).
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
        const rays = spokes * sunStrength * .16 * (twilight ? 1.35 : 1);
        const glow = (disc * 1.35 + litHalo) * (.35 + .65 * brightness);

        r = r * (.26 + .74 * brightness) + warmSun[0] * rays + warmSun[0] * glow;
        g = g * (.26 + .74 * brightness) + warmSun[1] * rays + warmSun[1] * glow;
        b = b * (.26 + .74 * brightness) + warmSun[2] * rays + warmSun[2] * glow;
        // Snow bounces nearly all wavelengths; lift the whole dome toward a
        // white, high-key overcast without removing the cloud shapes.
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
    const previous = texture;
    texture = makeTexture(pixels.slice());
    previous.dispose();
    return true;
  }

  return {get texture() { return texture; }, owns: value => ownedTextures.has(value), update, dispose: () => texture.dispose()};
}
