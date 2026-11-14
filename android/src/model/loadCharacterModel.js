import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { detectFormat, outfitEntry, resolveModelUrl } from "./characterModelConfig.js";
import { loadLocalCharacterActions } from "./localCharacterActions.js";
import { restoreOutfitMaterialMaps } from "./outfitMaterials.js";

export async function loadCharacterModel(manifest, url, { renderer, actionsUrl, entry } = {}) {
  if (!url) throw new Error("模型路径为空");
  const format = detectFormat(manifest);
  const loader = new GLTFLoader();
  const isVrm = format === "vrm" || String(url).toLowerCase().endsWith(".vrm");
  if (isVrm) loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData?.vrm || null;
  let scene = vrm?.scene || gltf.scene;
  const resolvedEntry = entry || outfitEntry(manifest) || { sha256: manifest.sha256, runtimeCandidate: manifest.id, actionPack: manifest.actionPack, clips: manifest.clips };

  if (vrm) {
    VRMUtils.rotateVRM0?.(vrm);
    restoreOutfitMaterialMaps(gltf, resolvedEntry);
  }

  let clips = [];
  if (actionsUrl && resolvedEntry?.actionPack) {
    try {
      clips = await loadLocalCharacterActions(gltf, resolvedEntry, actionsUrl);
    } catch (error) {
      console.warn("动作包绑定失败，将仅显示站姿", error);
    }
  }

  const scale = Number(manifest.scale) || 1;
  scene.scale.setScalar(scale);
  const pos = Array.isArray(manifest.position) ? manifest.position : [0, 0, 0];
  scene.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
  if (manifest.rotationY) scene.rotation.y = Number(manifest.rotationY);
  scene.traverse((obj) => {
    obj.frustumCulled = false;
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
  return { scene, gltf, vrm, format: vrm ? "vrm" : format, clips, renderer };
}

export function resolveOutfitUrls(outfit) {
  if (!outfit) return { modelUrl: "", actionsUrl: "" };
  const modelUrl = resolveModelUrl(outfit, outfit.base);
  const actionsUrl = outfit.actions ? resolveModelUrl({ file: outfit.actions }, outfit.base) : "";
  return { modelUrl, actionsUrl };
}

export function disposeModel(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const material of materials) {
      material.dispose?.();
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && value.isTexture) value.dispose();
      }
    }
  });
}

export function frameCharacterCamera(camera, root, vrm, fallback) {
  const head = vrm?.humanoid?.getNormalizedBoneNode?.("head") || vrm?.humanoid?.getRawBoneNode?.("head");
  const hips = vrm?.humanoid?.getNormalizedBoneNode?.("hips") || vrm?.humanoid?.getRawBoneNode?.("hips");
  const headPos = new THREE.Vector3();
  const hipsPos = new THREE.Vector3();
  if (head) head.getWorldPosition(headPos);
  if (hips) hips.getWorldPosition(hipsPos);
  if (!head || !hips) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!head) headPos.copy(center).add(new THREE.Vector3(0, size.y * 0.38, 0));
    if (!hips) hipsPos.copy(center).add(new THREE.Vector3(0, -size.y * 0.08, 0));
  }
  const mid = headPos.clone().lerp(hipsPos, 0.28);
  const span = Math.max(0.7, headPos.y - hipsPos.y);
  camera.position.set(mid.x + 0.16, mid.y + 0.04, mid.z + span * 2.15);
  camera.lookAt(mid.x - 0.04, mid.y + 0.1, mid.z);
  if (fallback?.fov) {
    camera.fov = fallback.fov;
    camera.updateProjectionMatrix();
  }
}
