import { clamp, identity, multiplyQuaternion, normalizeQuaternion, slerp, smooth } from './math.ts';
import type { MotionModule, Pose, Quat, RetargetReference, Vec3 } from './types.ts';

function normalized(vector: Vec3): Vec3 | undefined {
  const length = Math.hypot(...vector);
  return length > 1e-8 && Number.isFinite(length) ? vector.map((n) => n / length) as Vec3 : undefined;
}

/** Shortest rotation from the target rest direction to the source rest direction. */
function restCorrection(from: Vec3, to: Vec3): Quat {
  const a = normalized(from), b = normalized(to);
  if (!a || !b) return identity;
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  if (dot < -0.999999) {
    const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const unit = normalized(axis)!;
    return [unit[0], unit[1], unit[2], 0];
  }
  return normalizeQuaternion([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0], 1 + dot]);
}

/** Align semantic upper-arm and thigh tracks. Native/model-bound clips and legacy files remain unchanged. */
export function retargetModulePose(pose: Pose, module: MotionModule, time: number, target?: RetargetReference): Pose {
  if (!target) return pose;
  let source: RetargetReference | undefined;
  let strength = 1;
  if (module.kind === 'keyframes' && !module.modelId && module.restDirections) source = module.restDirections;
  if (module.kind === 'procedural' && (module.procedure === 'waveLeft' || module.procedure === 'waveRight')) {
    source = { leftUpperArm: [0.5, -0.8660254, 0], rightUpperArm: [-0.5, -0.8660254, 0] };
    const progress = clamp(time / module.duration);
    strength = smooth(clamp(progress / 0.25)) * smooth(clamp((1 - progress) / 0.25));
  }
  if (!source) return pose;
  const rotations = { ...pose.rotations };
  for (const key of ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'] as const) {
    if (!rotations[key] || !source[key] || !target[key]) continue;
    const correction = slerp(identity, restCorrection(target[key], source[key]), strength);
    rotations[key] = multiplyQuaternion(rotations[key], correction);
  }
  return { ...pose, rotations };
}
