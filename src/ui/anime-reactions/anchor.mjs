import {
  Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4,
  Mesh, MeshBasicMaterial, Raycaster, Vector3,
} from 'three';

const skinMaterials = {
  beret: 'REVIEW_skin__Material_head_EYE_CLEANUP_LOCAL',
  'black-qipao': 'REVIEW_skin__Material_face',
  kimono: 'REVIEW_skin__AnimeV4_StrongerCheekBlush',
  'summer-uniform': 'REVIEW_skin__Material_head',
  swimsuit: 'REVIEW_skin__Material_head.001',
  'twin-tail': 'REVIEW_skin__Material_head.001',
  'winter-uniform': 'Winter face skin | soften mouth-corner normals only',
};

export function measureReactionAnchor(gltf, outfit, meshes) {
  const {scene, parser} = gltf;
  const faceMeshIndex = gltf.userData?.localActionFaceMeshIndex;
  const head = gltf.userData?.vrm?.humanoid?.getRawBoneNode('head') ||
    scene.getObjectsByProperty('isBone', true).find(bone => bone.name === 'head');
  const skin = meshes.find(mesh => {
    const association = parser?.associations.get(mesh);
    if (faceMeshIndex !== undefined && association?.meshes !== faceMeshIndex) return false;
    const primitive = parser?.json.meshes?.[association?.meshes]?.primitives?.[association?.primitives];
    const original = parser?.json.materials?.[primitive?.material]?.name;
    return !/outline/i.test(mesh.name) &&
      (original || mesh.material?.name?.replace(/ · cel preview$/, '')) === skinMaterials[outfit];
  });
  const positions = skin?.geometry?.getAttribute('position');
  if (!head || !positions) return null;

  scene.updateWorldMatrix(true, true);
  const worldToModel = scene.matrixWorld.clone().invert();
  const skinToModel = worldToModel.multiply(skin.matrixWorld);
  const bounds = new Box3();
  const vertex = new Vector3();
  const vertices = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    skin.getVertexPosition(i, vertex).applyMatrix4(skinToModel);
    bounds.expandByPoint(vertex);
    vertex.toArray(vertices, i * 3);
  }
  const size = bounds.getSize(new Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0) return null;

  const center = bounds.getCenter(new Vector3());
  const anchor = new Group();
  anchor.name = 'anime-reactions:head-anchor';
  // Keep the model's +X/right, +Y/up, +Z/front axes in the head's reference pose.
  const toHead = head.matrixWorld.clone().invert().multiply(scene.matrixWorld)
    .multiply(new Matrix4().makeTranslation(center.x, center.y, center.z));
  toHead.decompose(anchor.position, anchor.quaternion, anchor.scale);

  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
  if (skin.geometry.index) geometry.setIndex(skin.geometry.index);
  const material = new MeshBasicMaterial({side: DoubleSide});
  const surface = new Mesh(geometry, material);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));

  return {
    anchor, head, headWidth: size.x, headHeight: size.y,
    cheekHeight: outfit === 'twin-tail' ? -.265 : -.215,
    cheekWidth: outfit === 'kimono' ? .087 : .112,
    iconDepth: .54 * size.z / size.x + .08,
    projectToCheek(x, y) {
      ray.ray.origin.set(center.x + x, center.y + y, bounds.max.z + size.x);
      const hit = ray.intersectObject(surface, false)[0];
      if (!hit || hit.point.z < center.z) return null;
      return hit.point.z - center.z + .0035 * size.x;
    },
    disposeSurface() {
      geometry.dispose();
      material.dispose();
    },
  };
}
