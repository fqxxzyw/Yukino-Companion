const FACE_MAPS = {
  beret: {
    sha256: "03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8",
    name: "Material_head_EYE_CLEANUP_LOCAL"
  },
  kimono: {
    sha256: "b8b26e8c49fff87f2797d3e12b9f7d8d5042de01ce204ce81c1a24492ea70b54",
    name: "AnimeV4_StrongerCheekBlush"
  }
};

export function restoreOutfitMaterialMaps(gltf, entry) {
  if (!Object.hasOwn(FACE_MAPS, entry?.runtimeCandidate)) return;
  const { sha256, name } = FACE_MAPS[entry.runtimeCandidate];
  if (entry.sha256 !== sha256) return;

  const materials = new Set();
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const material of [node.material].flat()) if (material) materials.add(material);
  });
  const skin = [...materials].find((material) => material.name === `REVIEW_skin__${name}`);
  if (!skin?.map?.isTexture) return;
  for (const material of materials) {
    if (material.name !== name || !material.isMToonMaterial || material.map) continue;
    material.map = skin.map;
    if (entry.runtimeCandidate === "beret" && !material.shadeMultiplyTexture) {
      material.shadeMultiplyTexture = skin.map;
      material.update?.(0);
    }
    material.needsUpdate = true;
  }
}
