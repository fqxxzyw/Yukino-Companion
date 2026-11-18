import {
  AnimationMixer, AdditiveBlending, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  Quaternion, RingGeometry, ShaderMaterial, SpotLight, Vector3,
} from 'three';
import {
  TURNTABLE_ENTRANCE_MS, TURNTABLE_EXIT_MS, TURNTABLE_MIN_SCALE,
  turntableEase, turntableSlot,
} from './outfit-turntable.mjs';

const Y_AXIS = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function standingClip(gltf, entry) {
  const clips = gltf.animations || [];
  const preferred = entry?.defaultClip;
  return clips.find(clip => clip.name === preferred)
    || clips.find(clip => clip.name === 'Idle_Breathe')
    || clips.find(clip => /(?:^|[_\s-])(?:idle|stand|standing)(?:$|[_\s-])/i.test(clip.name))
    || null;
}

const WASH_COLOR = new Color('#ffffff');

// Alpha-blending five full characters at once forces a huge transparent pass
// and can stall the renderer for over a second. The ring fades by washing the
// base/shade colours toward the panel background instead; opacity and blending
// stay authored, so the exit remains opaque and cheap.
function washMaterials(record) {
  const seen = new Set(), materials = [];
  record.prepared.gltf.scene.traverse(mesh => {
    for (const material of [mesh.material].flat()) {
      if (!material?.color || seen.has(material)) continue;
      seen.add(material);
      materials.push({
        material,
        color: material.color.clone(),
        shade: material.shadeColorFactor?.clone?.() || null,
      });
    }
  });
  record.washMaterials = materials;
}

function setWash(record, amount) {
  const value = clamp01(amount);
  for (const {material, color, shade} of record.washMaterials || []) {
    material.color.copy(color).lerp(WASH_COLOR, value);
    if (shade && material.shadeColorFactor) material.shadeColorFactor.copy(shade).lerp(WASH_COLOR, value);
  }
}

function figureRecord(input, index, options) {
  const {count, radius, frontAngle, backOffset} = options;
  const {prepared} = input;
  const {gltf, sourceBounds, size} = prepared;
  const baseScale = 2 / size.y;
  const group = new Group();
  group.name = 'OutfitTurntableFigure';
  const offset = new Group();
  offset.name = 'OutfitTurntableOffset';
  const centered = new Group();
  const center = sourceBounds.getCenter(new Vector3());
  centered.position.set(-center.x, -sourceBounds.min.y, -center.z);
  centered.add(gltf.scene);
  offset.add(centered);
  group.add(offset);
  const slot = turntableSlot(index, count, radius, frontAngle);
  group.position.fromArray(slot.position);
  group.rotation.y = slot.rotation;
  const isCurrent = input.isCurrent === true;
  group.scale.setScalar(baseScale * (isCurrent ? 1 : .72));
  if (isCurrent) offset.position.z = backOffset;
  else offset.position.y = -.18;
  const ref = {
    ...input, index, group, offset, centered, baseScale,
    isCurrent, isTarget: input.isTarget === true,
    mixer: null,
  };
  const clip = prepared.ringStanding ? null : standingClip(gltf, prepared.entry);
  if (clip) {
    ref.mixer = new AnimationMixer(gltf.scene);
    ref.mixer.clipAction(clip).play();
    ref.mixer.update(0);
  }
  return ref;
}

function radialAlphaMaterial({color = '#ffffff', opacity = 0, dark = false} = {}) {
  return new ShaderMaterial({
    uniforms: {uOpacity: {value: opacity}, uColor: {value: new Color(color)}},
    transparent: true, depthWrite: false, side: DoubleSide,
    ...(dark ? {} : {blending: AdditiveBlending}),
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv;uniform float uOpacity;uniform vec3 uColor;
      void main(){float d=length((vUv-.5)*2.);float a=(1.-smoothstep(.18,1.,d))*uOpacity;
      if(a<.002)discard;gl_FragColor=vec4(uColor,a);}`,
  });
}

export class OutfitTurntableStage {
  constructor({
    scene, records, plan, targetIndex, currentIndex = 0, basePosition,
    frontAngle = 0, radius, backOffset = .3, lights = {},
  }) {
    this.scene = scene;
    this.plan = plan;
    this.targetIndex = targetIndex;
    this.currentIndex = currentIndex;
    this.basePosition = basePosition?.clone?.() || new Vector3();
    this.frontAngle = frontAngle;
    this.radius = radius;
    this.backOffset = backOffset;
    this.count = records.length;
    this.elapsed = 0;
    this.phase = 'entrance';
    this.done = false;
    this.finished = false;
    this.targetTaken = false;
    this.savedLights = {};
    this.resolve = null;
    this.ring = new Group();
    this.ring.name = 'OutfitTurntableRing';
    this.rotator = new Group();
    this.ring.add(this.rotator);
    scene.add(this.ring);
    this.layoutRing();
    this.records = records.map((input, index) => {
      if (!input) return null;
      const record = figureRecord(input, index, {
        count: this.count, radius: this.radius, frontAngle, backOffset,
      });
      this.rotator.add(record.group);
      if (!record.isTarget) {
        washMaterials(record);
        setWash(record, record.isCurrent ? 0 : 1);
      }
      return record;
    }).filter(Boolean);
    this.targetRecord = this.records.find(record => record.index === targetIndex);
    if (!this.targetRecord) throw Error('换装转台缺少目标人物。');
    this.scene.updateMatrixWorld(true);
    for (const record of this.records) {
      record.prepared.garmentBinding?.update?.(0);
      record.prepared.gltf.scene.updateMatrixWorld(true);
    }
    this.buildStage(lights);
    this.applyEntrance(0);
    this.applyStage(0);
  }

  layoutRing() {
    const front = new Vector3(Math.sin(this.frontAngle), 0, Math.cos(this.frontAngle));
    this.ring.position.copy(front).multiplyScalar(-(this.radius + this.backOffset));
    for (const record of this.records || []) {
      if (record.group.parent !== this.rotator) continue;
      const slot = turntableSlot(record.index, this.count, this.radius, this.frontAngle);
      record.group.position.fromArray(slot.position);
      record.group.rotation.y = slot.rotation;
    }
    if (!this.plate) return;
    const plateRadius = this.radius + .5;
    this.plateRadius = plateRadius;
    this.plate.position.set(this.ring.position.x, -.03, this.ring.position.z);
    this.rim.position.set(this.ring.position.x, .006, this.ring.position.z);
    this.plate.scale.set(plateRadius, 1, plateRadius);
    this.rim.scale.set(plateRadius, plateRadius, 1);
    this.pool.position.set(-front.x * this.backOffset, .012, -front.z * this.backOffset);
    this.backdrop.position.copy(this.ring.position)
      .addScaledVector(front, -this.radius * 1.15);
    this.backdrop.position.y = 1.42;
    this.backdrop.scale.set(this.radius * 3.5, 3.15, 1);
  }

  buildStage(lights) {
    this.lights = lights;
    for (const key of ['ambient', 'key', 'fill', 'rim']) {
      if (Number.isFinite(lights[key]?.intensity)) this.savedLights[key] = lights[key].intensity;
    }
    const front = new Vector3(Math.sin(this.frontAngle), 0, Math.cos(this.frontAngle));
    this.plate = new Mesh(
      new CylinderGeometry(1, 1, .06, 96),
      new MeshStandardMaterial({
        color: '#c9d8e8', roughness: .86, metalness: 0,
        transparent: true, opacity: 0, depthWrite: true,
      }),
    );
    this.plate.name = 'OutfitTurntablePlatform';
    this.rim = new Mesh(
      new RingGeometry(.94, 1, 96),
      new MeshBasicMaterial({color: '#f5fbff', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false}),
    );
    this.rim.rotation.x = -Math.PI / 2;
    this.pool = new Mesh(new CircleGeometry(.74, 48), radialAlphaMaterial({color: '#fff0d2'}));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.name = 'OutfitTurntableLightPool';
    this.backdrop = new Mesh(new PlaneGeometry(1, 1), radialAlphaMaterial({color: '#111827', dark: true}));
    this.backdrop.name = 'OutfitTurntableBackdrop';
    this.backdrop.rotation.y = this.frontAngle;
    const spotTarget = new Object3D();
    spotTarget.position.set(-front.x * this.backOffset, .9, -front.z * this.backOffset);
    this.spot = new SpotLight('#fff1d8', 0, 9, .58, .84, 1.15);
    this.spot.position.set(front.x * 2.5, 4.4, front.z * 2.5);
    this.spot.target = spotTarget;
    this.scene.add(this.plate, this.rim, this.pool, this.backdrop, this.spot, spotTarget);
    this.spotTarget = spotTarget;
    this.layoutRing();
  }

  applyLights(amount) {
    const factor = 1 - .38 * clamp01(amount);
    for (const [key, value] of Object.entries(this.savedLights)) {
      const light = this.lights[key];
      if (light) light.intensity = value * factor;
    }
  }

  applyStage(amount) {
    const value = clamp01(amount);
    this.plate.material.opacity = .64 * value;
    this.rim.material.opacity = .5 * value;
    this.pool.material.uniforms.uOpacity.value = .5 * value;
    this.backdrop.material.uniforms.uOpacity.value = .20 * value;
    this.spot.intensity = 3.5 * value;
    this.applyLights(value);
  }

  applyEntrance(progress) {
    const value = turntableEase(progress);
    for (const record of this.records) {
      if (record.isCurrent) {
        record.offset.position.z = this.backOffset * (1 - value);
        record.group.scale.setScalar(record.baseScale * (1 - (1 - TURNTABLE_MIN_SCALE) * value));
      } else {
        record.offset.position.y = -.18 * (1 - value);
        record.group.scale.setScalar(record.baseScale * (.72 + .08 * value));
      }
      if (!record.isTarget) setWash(record, record.isCurrent ? 0 : 1 - value);
    }
  }

  beginExit() {
    const record = this.targetRecord;
    // Object3D.attach() refreshes every descendant bone of the full rig. The
    // scene itself is untransformed, so moving only the target's ancestors and
    // copying its world transform avoids that handoff stall.
    const position = record.group.getWorldPosition(new Vector3());
    const quaternion = record.group.getWorldQuaternion(new Quaternion());
    const scale = record.group.getWorldScale(new Vector3());
    record.group.removeFromParent();
    this.scene.add(record.group);
    record.group.position.copy(position);
    record.group.quaternion.copy(quaternion);
    record.group.scale.copy(scale);
    this.exitFrom = position.clone();
    this.exitScaleFrom = scale.x;
    this.exitBaseScale = record.baseScale;
    this.phase = 'exit';
  }

  applyExit(progress) {
    const value = turntableEase(progress);
    const record = this.targetRecord;
    record.group.position.lerpVectors(this.exitFrom, this.basePosition, value);
    record.group.scale.setScalar(MathUtils.lerp(this.exitScaleFrom, this.exitBaseScale, value));
    for (const other of this.records) {
      if (other !== record) setWash(other, value);
    }
  }

  update(dt) {
    if (this.done) return {phase: this.phase, done: true};
    this.elapsed += Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    const entrance = TURNTABLE_ENTRANCE_MS / 1000;
    const rotation = this.plan.duration / 1000;
    const exit = TURNTABLE_EXIT_MS / 1000;
    if (this.phase === 'entrance') {
      const t = clamp01(this.elapsed / entrance);
      this.applyEntrance(t);
      this.applyStage(t);
      if (t >= 1) {
        this.applyEntrance(1);
        this.phase = 'rotate';
      }
    }
    if (this.phase === 'rotate') {
      const t = rotation > 0 ? clamp01((this.elapsed - entrance) / rotation) : 1;
      this.rotator.rotation.y = this.plan.rotation * turntableEase(t);
      this.applyStage(1);
      if (t >= 1) {
        this.rotator.rotation.y = this.plan.rotation;
        this.beginExit();
      }
    }
    if (this.phase === 'exit') {
      const t = exit > 0 ? clamp01((this.elapsed - entrance - rotation) / exit) : 1;
      this.applyExit(t);
      this.applyStage(1 - t);
      if (t >= 1) {
        this.applyExit(1);
        this.applyStage(0);
        for (const other of this.records) if (other !== this.targetRecord) other.group.visible = false;
        this.phase = 'done';
        this.done = true;
      }
    }
    return {phase: this.phase, done: this.done};
  }

  takeTarget() {
    const record = this.targetRecord;
    record.centered.remove(record.prepared.gltf.scene);
    if (record.group.parent) record.group.parent.remove(record.group);
    record.mixer?.stopAllAction();
    record.mixer?.uncacheRoot(record.prepared.gltf.scene);
    record.mixer = null;
    this.targetTaken = true;
    return record.prepared;
  }

  relayout(radius) {
    if (!Number.isFinite(radius) || radius <= 0) return;
    this.radius = radius;
    this.layoutRing();
  }

  // Upload textures and compile the spotlight/fade programs before the first
  // animated frame. The caller hides the canvas for this synchronous warm-up
  // so the fully-lit staging pose is never shown as a flash.
  prewarm(renderer, camera, timings = {}) {
    if (!renderer || !camera) return timings;
    let mark = performance.now();
    this.applyEntrance(1);
    this.applyStage(1);
    for (const record of this.records) {
      if (!record.isTarget) setWash(record, 0);
    }
    this.scene.updateMatrixWorld(true);
    // Textures upload on first draw, not during compile(). Figures that are
    // outside the narrow panel until the ring turns would otherwise upload
    // inside the animation and produce one long stall per newly visible outfit.
    const textures = new Set();
    for (const record of this.records) {
      record.prepared.gltf.scene.traverse(mesh => {
        for (const material of [mesh.material].flat()) {
          if (!material) continue;
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
    }
    for (const texture of textures) renderer.initTexture?.(texture);
    timings.initTexture = performance.now() - mark; mark = performance.now();
    // Skeleton bone textures are created by the first real draw. With frustum
    // culling on, each outfit that later rotates into the narrow panel pays that
    // upload inside the animation; force one hidden warm-up draw for all of them.
    const culled = [];
    for (const record of this.records) {
      record.prepared.gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        culled.push([mesh, mesh.frustumCulled]);
        mesh.frustumCulled = false;
      });
    }
    renderer.compile?.(this.scene, camera);
    timings.compile = performance.now() - mark; mark = performance.now();
    renderer.render(this.scene, camera);
    timings.render = performance.now() - mark; mark = performance.now();
    // installEightWeightMesh clears these caches. Recompute them while the
    // canvas is hidden; otherwise the first frustum test for each newly visible
    // outfit skins every vertex on the main thread during the rotation.
    for (const record of this.records) {
      record.prepared.gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.computeBoundingBox?.();
        mesh.computeBoundingSphere?.();
      });
    }
    timings.bounds = performance.now() - mark; mark = performance.now();
    // Move the driver's first-use upload/flush cost into the hidden preparation
    // frame instead of letting it surface as a stall during the rotation.
    try { renderer.getContext?.().finish?.(); } catch {}
    timings.finish = performance.now() - mark;
    for (const [mesh, value] of culled) mesh.frustumCulled = value;
    for (const record of this.records) {
      if (!record.isTarget) setWash(record, record.isCurrent ? 0 : 1);
    }
    this.applyEntrance(0);
    this.applyStage(0);
    this.scene.updateMatrixWorld(true);
    this.warmTimings = timings;
    return timings;
  }

  restore() {
    this.applyStage(0);
    this.applyLights(0);
  }

  dispose() {
    this.restore();
    for (const record of this.records) {
      record.mixer?.stopAllAction();
      record.mixer?.uncacheRoot(record.prepared.gltf.scene);
      record.mixer = null;
      if (!record.isTarget) setWash(record, 0);
      if (!this.targetTaken) record.centered.remove(record.prepared.gltf.scene);
      if (record.group.parent) record.group.parent.remove(record.group);
    }
    this.ring.removeFromParent();
    for (const item of [this.plate, this.rim, this.pool, this.backdrop, this.spot, this.spotTarget]) item?.removeFromParent();
    this.plate?.geometry.dispose();
    this.plate?.material.dispose();
    this.rim?.geometry.dispose();
    this.rim?.material.dispose();
    this.pool?.geometry.dispose();
    this.pool?.material.dispose();
    this.backdrop?.geometry.dispose();
    this.backdrop?.material.dispose();
    this.spot?.dispose?.();
    this.records = [];
  }
}
