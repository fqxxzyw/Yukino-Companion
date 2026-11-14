import {Float32BufferAttribute, MathUtils, Mesh, Vector3} from 'three';

const HAT_INDEX_COUNT = 8786 * 3;
const ACCESSORY_INDEX_COUNT = 11564 * 3;
const MAX_LIFT = .156;
const FPS = 30;
const END_FRAME = 72;
const NEUTRAL = [0, 0, 0, 0, 0, 0, 0];

// Samples from the supplied 82-frame Blender review, in metres and degrees.
// Frame, hat lift, head tilt, iris, angry mouth, angry brow, surprise, blink.
const LIFT = [
  [1, ...NEUTRAL],
  [9, .0012, 0, .0301, .0017, .002, 0, 0],
  [12, .015, 0, .32, .0156, .0184, 0, 0],
  [16, .0442, 1.9824, .6561, .0586, .0691, 0, 0],
  [20, .0821, 6.9206, .8776, .28, .3302, 0, 0],
  [24, .1206, 13.1851, .9718, .5601, .6606, 0, 0],
  [28, .1485, 18.4669, .9978, .7368, .8691, 0, 0],
  [32, MAX_LIFT, 20, 1, .78, .92, 0, 0],
];
const DROP = [
  [40, ...LIFT.at(-1).slice(1)],
  [44, .1552, 19.8632, .9948, .7048, .8313, .0395, 0],
  [48, .141, 17.5, .9, .3042, .3588, .4212, 0],
  [50, .1282, 15.6046, .8365, .1593, .1878, .5264, 0],
  [52, .1104, 13.5795, .7282, .0431, .0509, .5266, 0],
  [56, .0649, 6.3487, .5291, 0, 0, .325, 0],
  [58, .0269, 1.968, .2603, 0, 0, .1909, .2437],
  [59, .0081, .5396, .0904, 0, 0, .1244, .6963],
  [60, 0, 0, .0132, 0, 0, .0648, .94],
  [62, .006, 0, .0456, 0, 0, 0, .62],
  [65, 0, 0, .045, 0, 0, 0, .1],
  [68, 0, 0, .0156, 0, 0, 0, .0064],
  [70, ...NEUTRAL],
  [END_FRAME, ...NEUTRAL],
];
const EXPRESSIONS = ['EA_angry_mouth', 'EA_brow_angry', 'EA_surprised_mouth', 'EA_blink'];
const IRIS_NAME = 'Review_IrisLookUp_Independent';

function bindIris(node, iris) {
  const geometry = node?.geometry;
  const primitive = iris?.primitives?.[0];
  if (iris?.vrmSha256 !== '03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8' ||
      iris.sourceBlendSha256 !== '1a718e2589b09bb2ca0e4654b4c47641e180ec194635c9a7232b54fa539cef89' ||
      iris.name !== IRIS_NAME || iris.node !== 'Head.001' || primitive?.index !== 0 ||
      primitive.vertexCount !== 5311 || geometry?.attributes.position.count !== primitive.vertexCount ||
      !Array.isArray(primitive.rows) || primitive.rows.length !== 222 ||
      !geometry.morphTargetsRelative || !geometry.morphAttributes.position?.length ||
      !node.morphTargetDictionary || !Array.isArray(node.morphTargetInfluences) ||
      Object.hasOwn(node.morphTargetDictionary, IRIS_NAME)) return null;

  const positions = new Float32BufferAttribute(primitive.vertexCount * 3, 3);
  let previous = -1;
  for (const row of primitive.rows) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const [vertex, x, y, z] = row;
    if (!Number.isInteger(vertex) || vertex <= previous || vertex >= primitive.vertexCount ||
        ![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) > .0045) return null;
    positions.setXYZ(vertex, x, y, z);
    previous = vertex;
  }
  const index = node.morphTargetInfluences.length;
  const attributes = Object.entries(geometry.morphAttributes);
  if (attributes.some(([, targets]) => targets.length !== index || targets[0]?.count !== primitive.vertexCount)) return null;
  for (const [kind, targets] of attributes) {
    const itemSize = targets[0].itemSize;
    const attribute = kind === 'position' ? positions : new Float32BufferAttribute(primitive.vertexCount * itemSize, itemSize);
    attribute.name = IRIS_NAME;
    targets.push(attribute);
  }
  node.morphTargetDictionary[IRIS_NAME] = index;
  node.morphTargetInfluences.push(0);
  return {node, index, channel: -1, original: null};
}

function sample(curve, key, value) {
  const end = curve.findIndex(row => row[key] >= value);
  if (end <= 0) return (end === 0 ? curve[0] : curve.at(-1)).slice(1);
  const from = curve[end - 1], to = curve[end];
  const progress = (value - from[key]) / (to[key] - from[key]);
  return from.slice(1).map((amount, i) => MathUtils.lerp(amount, to[i + 1], progress));
}

export function bindCandidateBeret(gltf) {
  const {scene, parser} = gltf;
  const hair = parser?.json.nodes.find(node => node.name === 'Hair.001');
  const headMesh = parser?.json.nodes.find(node => node.name === 'Head.001');
  let accessory, eyeSurface;
  const faces = [];
  scene.traverse(node => {
    const association = parser?.associations.get(node);
    if (hair && node.isSkinnedMesh && association?.meshes === hair.mesh && association.primitives === 1) {
      accessory = node;
    }
    if (headMesh && node.isSkinnedMesh && association?.meshes === headMesh.mesh && association.primitives === 0) {
      eyeSurface = node;
    }
    if (!node.isMesh) return;
    for (const [channel, name] of EXPRESSIONS.entries()) {
      const index = node.morphTargetDictionary?.[name];
      if (Number.isInteger(index)) faces.push({node, index, channel, original: null});
    }
  });
  if (accessory?.geometry.index?.count !== ACCESSORY_INDEX_COUNT) return null;

  const headIndex = accessory.skeleton.bones.findIndex(bone => bone.name === 'head');
  if (headIndex < 0) return null;
  const iris = bindIris(eyeSurface, gltf.userData?.beretIris);
  if (iris) faces.push(iris);
  const head = accessory.skeleton.bones[headIndex];
  const accessoryGeometry = accessory.geometry;
  const previousRange = {...accessoryGeometry.drawRange};
  const hatGeometry = accessoryGeometry.clone();
  hatGeometry.setDrawRange(0, HAT_INDEX_COUNT);
  accessoryGeometry.setDrawRange(HAT_INDEX_COUNT, ACCESSORY_INDEX_COUNT - HAT_INDEX_COUNT);

  // Every vertex in this prefix is rigidly weighted to the head. Its bind
  // transform preserves the seated pose when moved off the skinned surface.
  const hat = new Mesh(hatGeometry, accessory.material);
  hat.name = 'Beret_Drag_Handle';
  hat.renderOrder = accessory.renderOrder;
  hat.castShadow = accessory.castShadow;
  hat.receiveShadow = accessory.receiveShadow;
  accessory.skeleton.boneInverses[headIndex].clone().multiply(accessory.bindMatrix)
    .decompose(hat.position, hat.quaternion, hat.scale);
  const neutralPosition = hat.position.clone();
  head.add(hat);

  const origin = new Vector3(), offset = new Vector3();
  let drag = null, drop = null, lift = 0, lateral = 0, wantedLift = 0, wantedLateral = 0;
  let pose = NEUTRAL, active = false;

  function positionHat() {
    if (!lift && !lateral) {
      hat.position.copy(neutralPosition);
      return;
    }
    head.worldToLocal(scene.localToWorld(origin.set(0, 0, 0)));
    head.worldToLocal(scene.localToWorld(offset.set(lateral, lift, 0)));
    hat.position.copy(neutralPosition).add(offset.sub(origin));
  }

  function restoreFace() {
    for (const face of faces) {
      if (face.original === null) continue;
      face.node.morphTargetInfluences[face.index] = face.original;
      face.original = null;
    }
  }

  function cancel() {
    drag = null;
    drop = null;
    lift = lateral = wantedLift = wantedLateral = 0;
    pose = NEUTRAL;
    active = false;
    restoreFace();
    positionHat();
  }

  return {
    get active() { return active; },
    get lift() { return lift; },
    hitTest(raycaster) {
      scene.updateWorldMatrix(true, true);
      const hit = raycaster.intersectObject(hat, false)[0];
      if (!hit) return false;
      // Respect the actual face and hair if they occlude the accessory.
      const front = raycaster.intersectObject(scene, true).find(({object, face}) => {
        for (let node = object; node; node = node.parent) if (!node.visible) return false;
        const material = Array.isArray(object.material) ? object.material[face?.materialIndex] : object.material;
        return material && material.visible && !material.isOutline &&
          (!material.transparent || material.opacity > .01);
      });
      return front?.object === hat || front?.distance >= hit.distance - 1e-5;
    },
    grab(pointerId) {
      if (drag) return false;
      drop = null;
      drag = {pointerId, lift, lateral};
      wantedLift = lift;
      wantedLateral = lateral;
      active = true;
      return true;
    },
    move(pointerId, deltaX, deltaY) {
      if (pointerId !== drag?.pointerId || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
      wantedLift = MathUtils.clamp(drag.lift + deltaY * .0016, 0, MAX_LIFT);
      wantedLateral = MathUtils.clamp(drag.lateral + deltaX * .0012, -.065, .065);
    },
    release(pointerId) {
      if (pointerId !== drag?.pointerId) return;
      drag = null;
      if (Math.max(lift, wantedLift, Math.abs(lateral), Math.abs(wantedLateral)) < .003) {
        cancel();
        return;
      }
      drop = {frame: 40, lift, lateral, pose};
    },
    update(dt) {
      const elapsed = MathUtils.clamp(dt, 0, .1);
      if (drag) {
        const previousTilt = pose[1];
        const follow = 1 - Math.exp(-elapsed / .035);
        lift = MathUtils.lerp(lift, wantedLift, follow);
        lateral = MathUtils.lerp(lateral, wantedLateral, follow);
        pose = sample(LIFT, 1, lift);
        pose[1] = MathUtils.lerp(previousTilt, pose[1], 1 - Math.exp(-elapsed / .09));
      } else if (drop) {
        drop.frame += elapsed * FPS;
        const source = sample(DROP, 0, drop.frame);
        const amount = MathUtils.clamp(drop.lift / MAX_LIFT, .24, 1);
        lift = source[0] * drop.lift / MAX_LIFT;
        lateral = drop.lateral * source[0] / MAX_LIFT;
        pose = [
          lift, source[1] * drop.pose[1] / 20, source[2] * drop.pose[2],
          source[3] * drop.pose[3] / .78, source[4] * drop.pose[4] / .92,
          source[5] * amount, source[6] * amount,
        ];
        if (drop.frame >= END_FRAME) cancel();
      }
      positionHat();
      return {
        active, headPitch: pose[1],
        eyeX: MathUtils.clamp(lateral * 3, -.22, .22), eyeY: iris ? 0 : -.25 * pose[2],
      };
    },
    positionHat,
    restoreFace,
    applyFace(pointerEyeY) {
      if (!active) {
        if (iris && Number.isFinite(pointerEyeY) && pointerEyeY < 0) {
          iris.original = iris.node.morphTargetInfluences[iris.index];
          iris.node.morphTargetInfluences[iris.index] = Math.max(iris.original, MathUtils.clamp(-pointerEyeY / .25, 0, 1) * .65);
        }
        return;
      }
      for (const face of faces) {
        const amount = pose[face.channel + 3];
        if (amount <= 0) continue;
        face.original = face.node.morphTargetInfluences[face.index];
        face.node.morphTargetInfluences[face.index] = Math.max(face.original, amount);
      }
    },
    cancel,
    dispose() {
      cancel();
      hat.removeFromParent();
      hatGeometry.dispose();
      accessoryGeometry.setDrawRange(previousRange.start, previousRange.count);
    },
  };
}
