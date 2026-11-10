import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { VRM } from '@pixiv/three-vrm';
import type { ModelMapping, Pose } from './motion/types.ts';
import { ModelRig } from './model-rig.ts';
import type { RigInfo } from './model-rig.ts';
import { readCatalogModel, validateGlb } from './local-model.ts';
import type { ModelSource } from './local-model.ts';
import { loadModel } from './model-loader.ts';
import { lightingPresets } from './lighting.ts';
import type { LightingPreset } from './lighting.ts';
import { solveTwoBone } from './ik.ts';

export { models } from './model-catalog.ts';
export type { RigControl, RigInfo } from './model-rig.ts';

type View = 'front' | 'side' | 'back' | 'full' | 'upper' | 'face' | 'fit';

export function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.removeFromParent();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of [node.material].flat()) materials.add(material);
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
  });
  for (const material of materials) {
    for (const item of Object.values(material)) if (item instanceof THREE.Texture) textures.add(item);
    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
    material.dispose();
  }
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) bitmaps.add(texture.source.data);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}

const emptyPose = (): Pose => ({ rotations: {}, translations: {}, expressions: {} });

export class Viewport {
  /** Capture the current camera and pose without viewport helpers or a background. */
  async captureTransparentPng(): Promise<Blob> {
    if (this.disposed || !this.rig || !this.wrapper) throw new Error('请先载入角色模型。');
    const canvas = this.renderer.domElement;
    if (!canvas.width || !canvas.height) throw new Error('预览区域尚未准备好。');
    const helpers: THREE.Object3D[] = [this.floor, this.marker, this.axes];
    if (this.skeleton) helpers.push(this.skeleton);
    const visibility = helpers.map(item => item.visible);
    const background = this.scene.background;
    const color = this.renderer.getClearColor(new THREE.Color()).clone();
    const alpha = this.renderer.getClearAlpha();
    try {
      helpers.forEach(item => { item.visible = false; });
      this.scene.background = null;
      this.renderer.setClearColor(0, 0);
      this.renderer.render(this.scene, this.camera);
      // Read while the frame is current; preserveDrawingBuffer is not needed.
      const data = canvas.toDataURL('image/png');
      if (!data.startsWith('data:image/png;base64,')) throw new Error('无法生成透明 PNG。');
      const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), character => character.charCodeAt(0));
      return new Blob([bytes], {type: 'image/png'});
    } finally {
      helpers.forEach((item, index) => { item.visible = visibility[index]; });
      this.scene.background = background;
      this.renderer.setClearColor(color, alpha);
      this.requestDraw();
    }
  }
  /** Load only the animation channels, leaving the current displayed model intact. */
  async importMotion(file: File) {
    const rig = this.rig;
    if (!rig) throw new Error('请先导入当前角色模型。');
    if (!/\.glb$/i.test(file.name)) throw new Error('请选择包含动画的 GLB 文件。');
    const data = await file.arrayBuffer();
    if (validateGlb(data) !== 'glb') throw new Error('请选择 GLB 动作文件。');
    const { gltf } = await loadModel({ data, format: 'glb' });
    try {
      if (rig !== this.rig) throw new Error('导入期间角色已切换，请重新导入动作。');
      return rig.convertExternalAnimations(gltf);
    } finally { disposeModel(gltf.scene); }
  }
  private ikGesture: { root: string; mid: string; end: string; pose: Pose; target: THREE.Vector3; camera: THREE.Quaternion } | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(29, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resize: ResizeObserver;
  private readonly floor: THREE.GridHelper;
  private readonly hemisphere = new THREE.HemisphereLight();
  private readonly keyLight = new THREE.DirectionalLight();
  private readonly rimLight = new THREE.DirectionalLight();
  private lighting: LightingPreset = 'studio';
  private readonly axes = new THREE.AxesHelper(0.19);
  private readonly marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.023, 12, 8), new THREE.MeshBasicMaterial({ color: 0x8ce1ff, depthTest: false }),
  );
  private readonly selectedPoint = new THREE.Vector3();
  private readonly renderSize = new THREE.Vector2();
  private wrapper: THREE.Group | null = null;
  private modelRoot: THREE.Object3D | null = null;
  private rig: ModelRig | null = null;
  private vrm: VRM | undefined;
  private vrmFrameTime: number | undefined;
  private simulationTime: number | undefined;
  private skeleton: THREE.SkeletonHelper | null = null;
  private skeletonVisible = false;
  private axesVisible = false;
  private selected: string | null = null;
  private reference = false;
  private pose = emptyPose();
  private view: View = 'full';
  private request: AbortController | null = null;
  private epoch = 0;
  private disposed = false;
  private frame = 0;
  private rendered = false;
  private pointer: { x: number; y: number; id: number } | null = null;

  constructor(private readonly container: HTMLElement, private readonly onSelect?: (boneId: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '角色三维视窗');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.append(canvas);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.addEventListener('change', this.requestDraw);

    this.floor = new THREE.GridHelper(12, 40, 0x576879, 0x506076);
    this.floor.material.transparent = true;
    this.floor.material.opacity = 0.35;
    this.floor.position.y = -0.012;
    this.marker.visible = false;
    this.marker.renderOrder = 20;
    this.axes.visible = false;
    for (const material of [this.axes.material].flat()) material.depthTest = false;
    this.axes.renderOrder = 21;
    this.scene.add(this.hemisphere, this.keyLight, this.rimLight, this.floor, this.marker, this.axes);
    this.setLighting('studio');

    this.resize = new ResizeObserver(this.updateSize);
    this.resize.observe(container);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.requestDraw);
    this.updateSize();
    this.setView('full');
  }

  load(id: string, mapping: ModelMapping = {}): Promise<RigInfo | null> {
    return this.prepare((signal) => readCatalogModel(id, signal), mapping);
  }

  loadSource(source: ModelSource, mapping: ModelMapping = {}): Promise<RigInfo | null> {
    return this.prepare(async () => source, mapping);
  }

  private async prepare(read: (signal: AbortSignal) => Promise<ModelSource>, mapping: ModelMapping) {
    const token = ++this.epoch;
    this.request?.abort();
    const request = this.request = new AbortController();
    let pending: THREE.Object3D | null = null;
    try {
      const { data, format, id, label, asset } = await read(request.signal);
      if (this.disposed || token !== this.epoch) return null;
      const { gltf, vrm } = await loadModel({ data, format });
      pending = gltf.scene;
      if (this.disposed || token !== this.epoch) return null;
      const rig = new ModelRig(gltf, { id, label, asset, format }, mapping, vrm);
      if (!rig.info.bones.length && !rig.info.expressions.length) {
        throw new Error('模型没有可操控的骨骼或形态键。请导出包含蒙皮骨架或表情形态的模型。');
      }
      const center = rig.bounds.getCenter(new THREE.Vector3());
      const centered = new THREE.Group();
      centered.position.set(-center.x, -rig.bounds.min.y, -center.z);
      centered.add(gltf.scene);
      const wrapper = new THREE.Group();
      wrapper.scale.setScalar(2 / rig.height);
      wrapper.add(centered);

      this.clearModel();
      this.rig = rig;
      this.vrm = vrm;
      this.modelRoot = gltf.scene;
      this.wrapper = wrapper;
      this.pose = emptyPose();
      this.rendered = false;
      this.scene.add(wrapper);
      wrapper.updateMatrixWorld(true);
      pending = null;

      const helper = this.skeleton = new THREE.SkeletonHelper(wrapper);
      helper.setColors(new THREE.Color(0x64a3c8), new THREE.Color(0x8ce1ff));
      for (const material of [helper.material].flat()) {
        material.depthTest = false;
        material.transparent = true;
        material.opacity = 0.85;
      }
      helper.renderOrder = 19;
      this.scene.add(helper);
      this.setSkeleton(this.skeletonVisible);
      this.setView(this.view);
      this.applyPose(this.pose);
      this.resetVrmMotion();
      return rig.info;
    } catch (error) {
      if (this.disposed || token !== this.epoch) return null;
      throw error;
    } finally {
      if (pending) disposeModel(pending);
      if (this.request === request) this.request = null;
    }
  }

  applyPose(pose: Pose, timing?: { time: number; playing: boolean }) {
    this.pose = pose;
    const result = this.rig?.apply(pose, this.reference) ?? { missing: [] };
    this.wrapper?.updateMatrixWorld(true);
    if (timing) {
      const delta = this.simulationTime === undefined ? 0 : timing.time - this.simulationTime;
      this.simulationTime = timing.time;
      if (delta < -0.00001 || delta > 0.2 || (!timing.playing && delta > 0.00001)) this.resetVrmMotion();
    }
    this.updateSelection();
    return result;
  }

  setReference(visible: boolean) {
    if (this.reference === visible) return;
    this.reference = visible;
    this.applyPose(this.pose);
    this.resetVrmMotion();
  }

  setView(view: View) {
    if (view !== 'fit') this.view = view;
    const rig = this.rig;
    const size = rig ? rig.bounds.getSize(new THREE.Vector3()).multiplyScalar(2 / rig.height) : new THREE.Vector3(1, 2, 0.4);
    const direction = new THREE.Vector3(0, 0.035, 1);
    let targetY = 1;
    let height = size.y;
    let width = size.x;
    let depth = size.z;
    if (view === 'fit' && this.reference && rig) {
      const box = rig.originalBounds.getSize(new THREE.Vector3()).multiplyScalar(2 / rig.height);
      height = box.y;
      width = box.x;
      depth = box.z;
    }
    if (view === 'face' || view === 'upper') {
      const head = rig?.boneBindings.get('head')?.node.getWorldPosition(new THREE.Vector3());
      targetY = view === 'face' ? Math.max(1.55, (head?.y ?? 1.68) + 0.13) : 1.47;
      height = view === 'face' ? 0.43 : 1.18;
      width = view === 'face' ? 0.36 : Math.min(1.05, size.x);
    }
    if (view === 'side') {
      direction.set(1, 0.035, 0);
      [width, depth] = [depth, width];
    } else if (view === 'back') {
      direction.z = -1;
    }
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distance = Math.max(height, width / this.camera.aspect) / (2 * tangent) * 1.15 + depth * 0.5;
    this.controls.target.set(0, targetY, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(direction.normalize(), distance);
    this.controls.update();
    this.requestDraw();
  }

  setSkeleton(visible: boolean) {
    this.skeletonVisible = visible;
    if (this.skeleton) this.skeleton.visible = visible;
    this.requestDraw();
  }

  setLighting(preset: LightingPreset) {
    const config = lightingPresets[preset];
    if (!config) return;
    this.lighting = preset;
    this.hemisphere.color.setHex(config.sky);
    this.hemisphere.groundColor.setHex(config.ground);
    this.hemisphere.intensity = config.ambient;
    this.keyLight.color.setHex(config.key);
    this.keyLight.intensity = config.keyIntensity;
    this.keyLight.position.set(config.keyPosition[0], config.keyPosition[1], config.keyPosition[2]);
    this.rimLight.color.setHex(config.rim);
    this.rimLight.intensity = config.rimIntensity;
    this.rimLight.position.set(config.rimPosition[0], config.rimPosition[1], config.rimPosition[2]);
    this.requestDraw();
  }

  setAxes(visible: boolean) {
    this.axesVisible = visible;
    this.updateSelection();
  }

  selectBone(id: string | null) {
    this.selected = id;
    this.updateSelection();
  }

  private updateSelection(redraw = true) {
    const node = this.selected ? this.rig?.boneBindings.get(this.selected)?.node : undefined;
    this.marker.visible = !!node;
    this.axes.visible = !!node && this.axesVisible;
    if (node) {
      node.getWorldPosition(this.marker.position);
      this.axes.position.copy(this.marker.position);
      node.getWorldQuaternion(this.axes.quaternion);
    }
    if (redraw) this.requestDraw();
  }

  /** World-space bone positions, viewed from the same direction as the preview camera. */
  guidePositions() {
    if (!this.rig) return null;
    this.wrapper?.updateMatrixWorld(true);
    const inverseCamera = this.camera.quaternion.clone().invert();
    const point = new THREE.Vector3();
    return Object.fromEntries([...this.rig.boneBindings].map(([id, { node }]) => {
      node.getWorldPosition(point).applyQuaternion(inverseCamera);
      return [id, [point.x, point.y] as [number, number]];
    }));
  }

  beginIK(end: string) {
    const parts = /^(left|right)(Hand|Foot)$/.exec(end);
    if (!parts || !this.rig || this.reference) return false;
    const [, side, extremity] = parts;
    const root = `${side}${extremity === 'Hand' ? 'UpperArm' : 'UpperLeg'}`;
    const mid = `${side}${extremity === 'Hand' ? 'LowerArm' : 'LowerLeg'}`;
    const a = this.rig.boneBindings.get(root)?.node, b = this.rig.boneBindings.get(mid)?.node, c = this.rig.boneBindings.get(end)?.node;
    if (!a || !b || !c || !a.getObjectById(b.id) || !b.getObjectById(c.id)) return false;
    this.wrapper?.updateMatrixWorld(true);
    this.ikGesture = { root, mid, end, pose: this.rig.capture(), target: c.getWorldPosition(new THREE.Vector3()), camera: this.camera.quaternion.clone() };
    return true;
  }

  moveIK(dx: number, dy: number) {
    const gesture = this.ikGesture, rig = this.rig;
    if (!gesture || !rig || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    rig.apply(gesture.pose, false);
    this.wrapper?.updateMatrixWorld(true);
    const target = new THREE.Vector3(dx, dy, 0).applyQuaternion(gesture.camera).add(gesture.target);
    const a = rig.boneBindings.get(gesture.root)!.node, b = rig.boneBindings.get(gesture.mid)!.node, c = rig.boneBindings.get(gesture.end)!.node;
    const solved = solveTwoBone(a, b, c, target);
    const current = solved ? rig.capture().rotations : null;
    rig.apply(this.pose, this.reference);
    this.wrapper?.updateMatrixWorld(true);
    return current ? { [gesture.root]: current[gesture.root], [gesture.mid]: current[gesture.mid] } : null;
  }

  endIK() { this.ikGesture = null; }

  orbitGuide(dx: number, dy: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx * 0.01;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.01, 0.04, Math.PI - 0.04);
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.requestDraw();
  }

  snapshot() {
    const modelId = this.rig?.info.id;
    const positions = this.rig && Object.fromEntries([...this.rig.boneBindings].map(([id, { node }]) => [
      id, node.getWorldPosition(this.selectedPoint).toArray(),
    ]));
    return {
      modelId, id: modelId, rendered: this.rendered, reference: this.reference, selected: this.selected,
      pose: this.rig?.capture(), positions, camera: this.camera.position.toArray(), missing: this.rig?.info.warnings,
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      vrm: this.vrm && {
        version: this.vrm.meta.metaVersion,
        colliders: this.vrm.springBoneManager?.colliders.length ?? 0,
        springJoints: [...(this.vrm.springBoneManager?.joints ?? [])].map(({ bone }) => ({
          name: bone.name, rotation: bone.quaternion.toArray(),
        })),
      },
    };
  }

  unload() {
    this.epoch++;
    this.request?.abort();
    this.clearModel();
    this.pose = emptyPose();
    this.rendered = false;
    this.updateSelection();
  }

  dispose() {
    this.disposed = true;
    this.epoch++;
    this.request?.abort();
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.floor.dispose();
    this.axes.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.requestDraw);
    this.renderer.dispose();
    canvas.remove();
  }

  private clearModel() {
    if (this.modelRoot) disposeModel(this.modelRoot);
    this.wrapper?.removeFromParent();
    this.skeleton?.removeFromParent();
    this.skeleton?.dispose();
    this.skeleton = null;
    this.modelRoot = null;
    this.wrapper = null;
    this.rig = null;
    this.vrm = undefined;
    this.vrmFrameTime = undefined;
    this.simulationTime = undefined;
  }

  private resetVrmMotion() {
    if (!this.vrm) return;
    this.vrmFrameTime = undefined;
    this.wrapper?.updateMatrixWorld(true);
    if (!this.reference) {
      this.vrm.nodeConstraintManager?.update();
      this.vrm.springBoneManager?.reset();
    }
  }

  private stepVrmMotion(now: number) {
    const vrm = this.vrm;
    if (!vrm || this.reference) return false;
    const delta = Math.min((now - (this.vrmFrameTime ?? now)) / 1000, 1 / 30);
    this.vrmFrameTime = now;
    vrm.nodeConstraintManager?.update();
    if (delta > 0) vrm.springBoneManager?.update(delta);
    let animatedMaterial = false;
    for (const material of (vrm.materials ?? []) as (THREE.Material & {
      update?: (delta: number) => void;
      uvAnimationScrollXSpeedFactor?: number;
      uvAnimationScrollYSpeedFactor?: number;
      uvAnimationRotationSpeedFactor?: number;
    })[]) {
      material.update?.(delta);
      animatedMaterial ||= !!(material.uvAnimationScrollXSpeedFactor
        || material.uvAnimationScrollYSpeedFactor || material.uvAnimationRotationSpeedFactor);
    }
    this.updateSelection(false);
    return animatedMaterial || !!vrm.springBoneManager?.joints.size;
  }

  private readonly updateSize = () => {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height || this.disposed) return;
    if (this.renderSize.x === width && this.renderSize.y === height) return;
    this.renderSize.set(width, height);
    this.rendered = false;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestDraw();
  };

  private readonly requestDraw = () => {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.controls.update();
      const animated = this.stepVrmMotion(now);
      this.renderer.render(this.scene, this.camera);
      if (this.rig && !this.renderer.getContext().isContextLost()) {
        this.rendered = true;
        if (animated && this.container.clientWidth && this.container.clientHeight) this.requestDraw();
      }
    });
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.rendered = false;
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.pointer = event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    const pointer = this.pointer;
    this.pointer = null;
    if (!pointer || pointer.id !== event.pointerId || Math.hypot(pointer.x - event.clientX, pointer.y - event.clientY) > 5) return;
    if (!this.skeletonVisible || !this.rig || !this.onSelect) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    let closest: string | null = null;
    let bestDistance = 13;
    let bestDepth = 1;
    for (const { id } of this.rig.info.bones) {
      const { node } = this.rig.boneBindings.get(id)!;
      const point = node.getWorldPosition(this.selectedPoint).project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = rect.left + (point.x + 1) * rect.width * 0.5;
      const y = rect.top + (1 - point.y) * rect.height * 0.5;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance < bestDistance - 1 || (distance <= bestDistance && point.z < bestDepth)) {
        closest = id;
        bestDistance = distance;
        bestDepth = point.z;
      }
    }
    if (closest) {
      this.selectBone(closest);
      this.onSelect(closest);
    }
  };
}
