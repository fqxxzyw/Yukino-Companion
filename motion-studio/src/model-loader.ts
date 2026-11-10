import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import type { ModelSource } from './local-model.ts';

export async function loadModel({ data, format }: Pick<ModelSource, 'data' | 'format'>) {
  const loader = new GLTFLoader();
  if (format !== 'vrm') return { gltf: await loader.parseAsync(data, ''), vrm: undefined };

  const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
  // The editor writes raw bones directly. Do not overwrite them with normalized pose data.
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
  const gltf = await loader.parseAsync(data, '');
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    VRMUtils.deepDispose(gltf.scene);
    throw new Error('VRM 角色绑定无法读取，请检查 VRM 版本和必需的人体骨骼。');
  }
  VRMUtils.rotateVRM0(vrm);
  return { gltf, vrm };
}
