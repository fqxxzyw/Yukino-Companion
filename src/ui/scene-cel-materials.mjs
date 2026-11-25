import { ShaderChunk } from 'three';
import {applyGouache,retainBrushAtlas,releaseBrushAtlas} from '../scenes/gouache-material.mjs';

const paintedScenes = new Set(['inage','kasai','kyoto','school','sakura','forest','city','bookshop','classroom','wedding']);

// Thresholds are cosines of the angle between the lit surface and each incoming
// light. The table describes pigments on the object, independent of the camera.
const ramps = {
  leaf:    { cuts: [.18, .50, .79], levels: [.12, .36, .72, 1], softness: .019, wrap: .10 },
  petal:   { cuts: [.12, .43, .75], levels: [.26, .53, .83, 1], softness: .068, wrap: .18 },
  grass:   { cuts: [.13, .45, .76], levels: [.19, .45, .79, .99], softness: .065, wrap: .14 },
  wood:    { cuts: [.22, .53, .80], levels: [.13, .38, .65, .94], softness: .027, wrap: 0 },
  stone:   { cuts: [.17, .43, .73], levels: [.09, .30, .58, .90], softness: .012, wrap: 0 },
  surface: { cuts: [.23, .52, .81], levels: [.13, .39, .68, .97], softness: .021, wrap: 0 },
};

const scenePatches = new WeakMap();
const materialPatches = new WeakMap();

function lightingChunk(material) {
  if (material.isMeshStandardMaterial) return 'lights_physical_pars_fragment';
  if (material.isMeshPhongMaterial) return 'lights_phong_pars_fragment';
  if (material.isMeshLambertMaterial) return 'lights_lambert_pars_fragment';
  if (material.isMeshToonMaterial) return 'lights_toon_pars_fragment';
  return null;
}

function surfaceType(name) {
  if (/leaf|leaves|foliage|canopy|hedge|shrub|grass|lawn|petal|flower|bamboo|frond|moss/.test(name)) return 'leaf';
  if (/wood|timber|bark|trunk|plank|lumber|wainscot|veneer|parquet|tatami/.test(name)) return 'wood';
  if (/stone|rock|concrete|masonry|paving|paver|gravel|brick|asphalt|slate|plaster/.test(name)) return 'stone';
  return 'surface';
}

function lightResponse(type, painted) {
  const { cuts, levels, softness, wrap } = ramps[type];
  const step = (cut, weight) => `+${weight.toFixed(3)} * smoothstep(${cut}-edge,${cut}+edge,angle)`;
  return `float sceneCelCosine(float incidence) {
    float angle=clamp((incidence+${wrap.toFixed(3)})/${(1+wrap).toFixed(3)},0.0,1.0);
    float edge=max(${(painted ? Math.max(softness, type === 'stone' ? .042 : .058) : softness).toFixed(3)},min(fwidth(angle),.09));
    return ${levels[0]} * smoothstep(0.0, .11, angle)
      ${cuts.map((cut,i)=>step(cut,levels[i+1]-levels[i])).join('\n')};
  }\n`;
}

const celChunks = new Map();

function celChunk(chunk, type, painted) {
  const key = chunk + ':' + type + ':' + painted;
  if (!celChunks.has(key)) {
    // Direct light already includes distance, spotlight and shadow attenuation.
    // Only replace its Lambertian term. Gloss, clearcoat and indirect light keep
    // the original physical, Phong, Lambert or Toon model.
    const diffuse = '(directLight.color * sceneCelCosine(dot(geometryNormal, directLight.direction)))';
    celChunks.set(key, lightResponse(type, painted) + ShaderChunk[chunk].replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert',
      'reflectedLight.directDiffuse += ' + diffuse + ' * BRDF_Lambert'
    ));
  }
  return celChunks.get(key);
}

function patchMaterial(material, chunk, first) {
  const hooks = ['onBeforeRender', 'onBeforeCompile', 'customProgramCacheKey'];
  const descriptors = hooks.map(name => Object.getOwnPropertyDescriptor(material, name));
  const beforeRender = material.onBeforeRender;
  const compile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  const objects = new WeakMap();
  let variant = first;
  const patch = { objects, owners: 0, restore() {
    hooks.forEach((name, index) => {
      if (descriptors[index]) Object.defineProperty(material, name, descriptors[index]);
      else delete material[name];
    });
    material.needsUpdate = true;
    materialPatches.delete(material);
  }};

  // A factory can reuse one material on different meshes or across backdrops.
  // Select the program for the current draw without cloning its animated uniforms.
  material.onBeforeRender = function(renderer, scene, camera, geometry, object, group) {
    beforeRender.call(this, renderer, scene, camera, geometry, object, group);
    const next = objects.get(object)?.variant;
    if (next?.key !== variant?.key) {
      variant = next;
      material.needsUpdate = true;
    }
  };
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    if (variant) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <' + chunk + '>', celChunk(chunk, variant.type, Boolean(variant.id)));
      if (variant.id) applyGouache(shader,variant.type,variant.id,variant.crown,material.map);
    }
  };
  material.customProgramCacheKey = () => variant ? originalKey + variant.key : originalKey;
  material.needsUpdate = true;
  materialPatches.set(material, patch);
  return patch;
}

function classifyMesh(object, material) {
  if (!material || !lightingChunk(material) || material.transmission > 0 || material.metalness > .85) return null;
  if (material.transparent && !(material.alphaTest > 0)) return null;
  const name = [material.name, material.map?.name, material.userData.surfaceProfile, object.name, object.userData.role]
    .filter(Boolean).join(' ').toLowerCase();
  if (/glass|glazing|water|river.surface|pond.surface|lake.surface|ocean|puddle|sky.dome|skydome|cloud|lens.flare|sun.shaft/.test(name)) return null;
  return surfaceType(name);
}

export function setSceneCelShading(root, enabled, sceneId) {
  if (!root) return;
  const owned = scenePatches.get(root);
  if (!enabled) {
    if (!owned) return;
    for (const [patch, meshes] of owned.materials) {
      for (const mesh of meshes) {
        if (--patch.objects.get(mesh).owners === 0) patch.objects.delete(mesh);
      }
      if (--patch.owners === 0) patch.restore();
    }
    if (owned.painted) releaseBrushAtlas();
    scenePatches.delete(root);
    return;
  }
  if (owned) return;
  const registered = new Map();
  const painted = paintedScenes.has(sceneId);
  if (painted) retainBrushAtlas();
  root.traverse(object => {
    if (!object.isMesh || object.isReflector || object.isWater) return;
    for (const material of Array.isArray(object.material) ? new Set(object.material) : [object.material]) {
      let type = classifyMesh(object, material);
      if (!type) continue;
      const crown = painted && Boolean(object.geometry?.attributes.crownCenter);
      if (painted) {
        if (/blossom|petal|flower/.test(material.name)) type = 'petal';
        else if (material.userData.botanicalKind === 'grass') type = 'grass';
        else if (crown) type = 'leaf';
      }
      const variant = {type, crown, id:painted ? sceneId : null,
        key: painted ? `|gouache-v1:${sceneId}:${crown}:${type}` : '|scene-cel-diffuse-v1:' + type};
      const patch = materialPatches.get(material) ?? patchMaterial(material, lightingChunk(material), variant);
      if (!registered.has(patch)) {
        registered.set(patch, []);
        patch.owners++;
      }
      registered.get(patch).push(object);
      const prior = patch.objects.get(object);
      if (prior) prior.owners++;
      else patch.objects.set(object, { variant, owners: 1 });
    }
  });
  scenePatches.set(root, {materials:registered, painted});
}
