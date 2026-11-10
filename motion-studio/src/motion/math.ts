import type { Pose, Quat, Vec3 } from './types.ts';

export const identity: Quat = [0, 0, 0, 1];
export const zero: Vec3 = [0, 0, 0];
export const timeEpsilon = 1e-9;

export const clamp = (n: number, min = 0, max = 1): number => Math.min(max, Math.max(min, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const emptyPose = (): Pose => ({ rotations: {}, translations: {}, expressions: {} });
export const newId = (): string => globalThis.crypto.randomUUID();

export function normalizeQuaternion(q: Quat): Quat {
  const length = Math.hypot(...q);
  if (!length) return [...identity];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], -1, 1);
  const end: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  if (Math.abs(dot) > 0.9995) return normalizeQuaternion([
    lerp(a[0], end[0], t), lerp(a[1], end[1], t), lerp(a[2], end[2], t), lerp(a[3], end[3], t),
  ]);
  const theta = Math.acos(Math.abs(dot));
  const fromWeight = Math.sin((1 - t) * theta) / Math.sin(theta);
  const toWeight = Math.sin(t * theta) / Math.sin(theta);
  return [
    a[0] * fromWeight + end[0] * toWeight,
    a[1] * fromWeight + end[1] * toWeight,
    a[2] * fromWeight + end[2] * toWeight,
    a[3] * fromWeight + end[3] * toWeight,
  ];
}

export function multiplyQuaternion(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuaternion([
    w * bx + x * bw + y * bz - z * by,
    w * by - x * bz + y * bw + z * bx,
    w * bz + x * by - y * bx + z * bw,
    w * bw - x * bx - y * by - z * bz,
  ]);
}

export function eulerDegreesToQuat(degrees: Vec3): Quat {
  const [x, y, z] = degrees.map((angle) => angle * Math.PI / 360);
  const [cx, cy, cz] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  const [sx, sy, sz] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function quatToEulerDegrees([x, y, z, w]: Quat): Vec3 {
  const m13 = 2 * (x * z + y * w);
  const scale = 180 / Math.PI;
  const ey = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) >= 0.9999999) {
    return [Math.atan2(2 * (x * y + z * w), 1 - 2 * (x * x + z * z)) * scale, ey * scale, 0];
  }
  return [
    Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)) * scale,
    ey * scale,
    Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)) * scale,
  ];
}
