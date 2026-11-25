import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, ShaderChunk } from 'three';

// Linear colour multipliers for sunlit pigment and skylit pigment. The actual
// day/night intensity, shadow maps and coloured practicals still come from Three.
const palettes = {
  inage:     [[1.12, 1.045, .89], [.79, .98, 1.27]],
  kasai:     [[1.09, 1.075, .90], [.76, 1.04, 1.28]],
  kyoto:     [[1.17, 1.035, .85], [.88, .94, 1.26]],
  school:    [[1.10, 1.035, .93], [.81, .97, 1.23]],
  sakura:    [[1.14, 1.025, .96], [.88, .92, 1.24]],
  forest:    [[1.16, 1.085, .83], [.73, 1.05, 1.22]],
  city:      [[1.12, 1.035, .93], [.79, .95, 1.28]],
  bookshop:  [[1.17, 1.05, .87], [.85, .94, 1.22]],
  classroom: [[1.08, 1.035, .94], [.91, .96, 1.09]],
  wedding:   [[1.09, 1.035, .93], [.82, 1.01, 1.23]],
};
const horizonTint = {
  inage:     [.72, .88, 1.05],
  kasai:     [.68, .92, 1.06],
  kyoto:     [.76, .89, 1.02],
  school:    [.74, .89, 1.04],
  sakura:    [.78, .92, 1.04],
  forest:    [.66, .88, .94],
  city:      [.74, .88, 1.06],
  bookshop:  [.78, .88, 1.02],
  classroom: [.82, .90, 1.02],
  wedding:   [.74, .91, 1.05],
};

let atlas;
let atlasOwners = 0;
function makeBrushAtlas() {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  pixels.fill(128);
  let seed = 314159;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Each band stores a different brush scale. Wrapping the written pixels
  // produces a seamless tile even when a stroke straddles two edges.
  for (let band = 0; band < 3; band++) {
    const count = [670, 1900, 5400][band];
    for (let i = 0; i < count; i++) {
      const cx = random() * size, cy = random() * size;
      const major = [25, 11, 4][band] * (.6 + random() * .85);
      const minor = major * (.19 + random() * .24);
      const angle = .36 + .64 * Math.sin(cx / size * Math.PI * 2) + (random() - .5) * .7;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const extentX = Math.ceil(Math.hypot(major * cos, minor * sin));
      const extentY = Math.ceil(Math.hypot(major * sin, minor * cos));
      const pigment = 40 + random() * 176;
      for (let y = -extentY; y <= extentY; y++) {
        for (let x = -extentX; x <= extentX; x++) {
          const u = (x * cos + y * sin) / major, v = (y * cos - x * sin) / minor;
          const radius = u * u + v * v;
          if (radius >= 1) continue;
          const coverage = Math.min(1, (1 - radius) * 3.5) * .78;
          const index = ((((Math.floor(cy) + y) & 511) * size + ((Math.floor(cx) + x) & 511)) * 4 + band);
          pixels[index] += (pigment - pixels[index]) * coverage;
        }
      }
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.name = 'gouache:seamless-elliptical-brushes';
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}
export function retainBrushAtlas() {
  atlas ??= makeBrushAtlas();
  if (atlasOwners++ === 0) atlas.needsUpdate = true;
  return atlas;
}
export function releaseBrushAtlas() {
  if (--atlasOwners === 0) atlas.dispose();
}

export function applyGouache(shader, type, sceneId, crown, map) {
  if (!shader.vertexShader) return;
  const organic = type === 'leaf' || type === 'petal' || type === 'grass';
  const indoorSmooth = sceneId === 'classroom' && !organic && type !== 'wood';
  const brushScale = indoorSmooth ? .22 : (sceneId === 'classroom' ? .46 : organic ? 1.08 : .86);
  const palette = palettes[sceneId] ?? palettes.school;
  const aerial = horizonTint[sceneId] ?? horizonTint.school;
  const outdoorAerial = sceneId !== 'classroom';
  shader.uniforms.uGouacheAtlas = { value: atlas };
  // Sample the coarser pigment in opaque photographic maps. Sign writing,
  // blossom cutouts, panel divisions and other structural maps stay sharp.
  if (/grass|stucco|gravel|asphalt|aggregate|bark.albedo|turf/i.test(map?.name ?? '')) {
    const broadMap = ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, 2.2 )');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', broadMap);
  }
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    varying vec3 vGouacheWorld;
    ${crown ? 'attribute vec3 crownCenter; varying vec3 vCrownNormal;' : ''}
  `).replace('#include <project_vertex>', `#include <project_vertex>
    vec4 paintLocal = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      paintLocal = batchingMatrix * paintLocal;
    #endif
    #ifdef USE_INSTANCING
      paintLocal = instanceMatrix * paintLocal;
    #endif
    vGouacheWorld = (modelMatrix * paintLocal).xyz;
    ${crown ? 'vCrownNormal = normalMatrix * (paintLocal.xyz - crownCenter + vec3(0.0,.025,0.0));' : ''}
  `);
  shader.fragmentShader = '#define YUKINO_GOUACHE\n' + shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGouacheWorld;
      uniform sampler2D uGouacheAtlas;
      ${crown ? 'varying vec3 vCrownNormal;' : ''}
    `)
    .replace('#include <color_fragment>', `#include <color_fragment>
      // An oblique world projection covers vertical walls as well as ground.
      // Ground and its planted blades consequently pick up the same dabs.
      vec2 brushUV = vec2(vGouacheWorld.x + vGouacheWorld.z * .49, vGouacheWorld.z * .85 + vGouacheWorld.y * .76);
      vec3 coarseBrush = texture2D(uGouacheAtlas, brushUV * .075).rgb - .5;
      vec3 fineBrush = texture2D(uGouacheAtlas, brushUV * .31 + vec2(.31,.17)).rgb - .5;
      float paintValue = (coarseBrush.r * .32 + coarseBrush.g * .15 + fineBrush.g * .058) * ${brushScale.toFixed(3)};
      float paper = fineBrush.b * .014;
      diffuseColor.rgb *= 1.0 + paintValue + paper;
      diffuseColor.rgb += diffuseColor.rgb * vec3(.13, .04, -.095) * (coarseBrush.g + .38 * fineBrush.r) * ${brushScale.toFixed(3)};
    `)
    .replace('#include <lights_fragment_begin>', `${crown ? `
      vec3 roundedCrown = normalize(vCrownNormal);
      normal = normalize(mix(normal * (dot(normal, roundedCrown) < 0.0 ? -1.0 : 1.0), roundedCrown, .89));
    ` : ''}
    #include <lights_fragment_begin>`)
    .replace('#include <opaque_fragment>', `
      vec3 paperLuma = vec3(.2126,.7152,.0722);
      float directPigment = dot(reflectedLight.directDiffuse, paperLuma) / max(.02, dot(diffuseColor.rgb, paperLuma));
      float shade = 1.0 - smoothstep(.09, .65, directPigment);
      vec3 reflectedPigment = max(vec3(0.0), outgoingLight - totalEmissiveRadiance);
      float pigmentValue = dot(reflectedPigment, paperLuma);
      vec3 tinted = reflectedPigment * mix(vec3(${palette[0].map(n=>n.toFixed(3)).join(',')}), vec3(${palette[1].map(n=>n.toFixed(3)).join(',')}), shade);
      // Cool sky bounce in shaded regions remains proportional to received light.
      tinted = mix(tinted, pigmentValue * vec3(.78,.95,1.20), shade * ${indoorSmooth ? '.045' : organic ? '.21' : '.14'});
      ${organic ? `
        // Warm sunlit translucency on foliage/blossom tips without washing shadows.
        tinted *= mix(vec3(1.0), vec3(${type === 'petal' ? '1.05,1.01,1.03' : '1.06,1.04,.92'}), (1.0 - shade) * .35);
      ` : `
        float facing = abs(dot(normal, normalize(vViewPosition)));
        float depthSlope = fwidth(vViewPosition.z) / max(.1, abs(vViewPosition.z));
        float silhouette = (1.0 - smoothstep(.018,.15,facing)) * smoothstep(.0009,.016,depthSlope);
        float shadowBreak = smoothstep(.11,.42,fwidth(shade)) * shade;
        float rimTurn = smoothstep(.16,.72,length(fwidth(normal))) * (1.0-smoothstep(.18,.62,facing));
        float ink = min(${indoorSmooth ? '.14' : '.25'}, .14 * silhouette + .075 * shadowBreak + .095 * rimTurn);
        tinted = mix(tinted, tinted * vec3(.52,.40,.37), ink);
      `}
      ${outdoorAerial ? `
        // Gentle Ghibli atmospheric perspective: foreground stays crisp while
        // distant hills and far facades soften into the luminous sky hue.
        float viewDist = length(vViewPosition);
        float aerialMix = smoothstep(26.0, 145.0, viewDist) * .26;
        vec3 aerialColor = vec3(${aerial.map(n=>n.toFixed(3)).join(',')}) * max(.06, pigmentValue * 1.15);
        tinted = mix(tinted, aerialColor, aerialMix);
      ` : ''}
      tinted *= 1.038 / (1.0 + .024 * pigmentValue);
      outgoingLight = tinted + totalEmissiveRadiance;
      #include <opaque_fragment>
    `);
}
