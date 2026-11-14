import {Color} from 'three';

const WINTER_MODEL = '6e5103b41d415628daf1c61bf932f4a9cfbed3e17fe38bf9bdbc6822285a7e6b';
const FACE_MAPS = {
  beret: {
    sha256: '03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8',
    name: 'Material_head_EYE_CLEANUP_LOCAL',
  },
  kimono: {
    sha256: 'b8b26e8c49fff87f2797d3e12b9f7d8d5042de01ce204ce81c1a24492ea70b54',
    name: 'AnimeV4_StrongerCheekBlush',
  },
};

async function restoreWinterFaceMaterial(gltf) {
  const {MToonMaterial} = await import('@pixiv/three-vrm');
  const replacements = new Map();
  const restore = material => {
    if (material?.name !== 'Material_head.001' || !material.isMeshPhysicalMaterial ||
        material.metalness !== 1 || material.specularIntensity !== 0 || !material.map?.isTexture) return material;
    if (!replacements.has(material)) {
      // The VRM uses the Blender-compatible metallic fallback. Restore the
      // authored eye shader using its original atlas for both lit and shade.
      const toon = new MToonMaterial({
        name: material.name, map: material.map, shadeMultiplyTexture: material.map,
        color: material.color.clone(), shadeColorFactor: new Color(.64, .64, .64),
        shadingShiftFactor: 0, shadingToonyFactor: .9, giEqualizationFactor: .9,
        rimLightingMixFactor: 0, parametricRimFresnelPowerFactor: 1, parametricRimLiftFactor: 1,
        side: material.side, transparent: material.transparent, opacity: material.opacity,
        alphaTest: material.alphaTest, depthWrite: material.depthWrite,
      });
      toon.update(0);
      replacements.set(material, toon);
    }
    return replacements.get(material);
  };
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material) ? node.material.map(restore) : restore(node.material);
  });
  for (const previous of replacements.keys()) previous.dispose();
}

export async function restoreCandidateMaterialMaps(gltf, entry) {
  const baseSha256 = entry?.compatibilityBaseSha256 ?? entry?.sha256;
  if (entry?.runtimeCandidate === 'winter-uniform' && baseSha256 === WINTER_MODEL) {
    await restoreWinterFaceMaterial(gltf);
    return;
  }
  if (!Object.hasOwn(FACE_MAPS, entry?.runtimeCandidate)) return;
  const {sha256, name} = FACE_MAPS[entry.runtimeCandidate];
  if (baseSha256 !== sha256) return;

  const materials = new Set();
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    for (const material of [node.material].flat()) if (material) materials.add(material);
  });
  // These two VRM exports omit the iris base-color map. The skin primitive
  // still contains the byte-identical texture used by the authored GLB.
  const skin = [...materials].find(material => material.name === 'REVIEW_skin__' + name);
  if (!skin?.map?.isTexture) return;
  for (const material of materials) {
    if (material.name !== name || !material.isMToonMaterial || material.map) continue;
    material.map = skin.map;
    if (entry.runtimeCandidate === 'beret' && !material.shadeMultiplyTexture) {
      // The authored eye shader uses the same atlas in its lit and shade inputs.
      material.shadeMultiplyTexture = skin.map;
      material.update(0);
    }
    material.needsUpdate = true;
  }
}
