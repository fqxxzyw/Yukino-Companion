import { Object3D, Quaternion, Vector3 } from 'three';

/** Solve a two-segment chain in world space; its existing bend direction is preserved. */
export function solveTwoBone(root: Object3D, mid: Object3D, end: Object3D, target: Vector3) {
  if (!root.parent || !mid.parent || !root.getObjectById(mid.id) || !mid.getObjectById(end.id)) return false;
  root.updateWorldMatrix(true, true);
  const origin = root.getWorldPosition(new Vector3());
  const elbow = mid.getWorldPosition(new Vector3());
  const tip = end.getWorldPosition(new Vector3());
  const a = origin.distanceTo(elbow), b = elbow.distanceTo(tip);
  if (a < 1e-6 || b < 1e-6) return false;
  const desired = target.clone().sub(origin);
  if (desired.lengthSq() < 1e-12) desired.copy(tip).sub(origin);
  if (desired.lengthSq() < 1e-12) return false;
  const distance = Math.max(Math.abs(a - b) + 1e-5, Math.min(a + b - 1e-5, desired.length()));
  const axis = desired.normalize();
  let bend = elbow.clone().sub(origin).addScaledVector(axis, -elbow.clone().sub(origin).dot(axis));
  if (bend.lengthSq() < 1e-10) {
    // A perfectly straight limb has no defined bend plane. Choose a stable plane.
    bend = new Vector3(0, 0, 1).addScaledVector(axis, -axis.z);
    if (bend.lengthSq() < 1e-10) bend.set(0, 1, 0).addScaledVector(axis, -axis.y);
  }
  bend.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const lift = Math.sqrt(Math.max(0, a * a - along * along));
  const desiredElbow = origin.clone().addScaledVector(axis, along).addScaledVector(bend, lift);
  const desiredTip = origin.clone().addScaledVector(axis, distance);

  function rotateToward(joint: Object3D, current: Vector3, goal: Vector3) {
    const p = joint.getWorldPosition(new Vector3());
    const from = current.clone().sub(p).normalize(), to = goal.clone().sub(p).normalize();
    const world = new Quaternion().setFromUnitVectors(from, to);
    const parent = joint.parent!.getWorldQuaternion(new Quaternion());
    const local = parent.clone().invert().multiply(world).multiply(parent);
    joint.quaternion.premultiply(local).normalize();
    joint.updateWorldMatrix(true, true);
  }
  rotateToward(root, elbow, desiredElbow);
  rotateToward(mid, end.getWorldPosition(new Vector3()), desiredTip);
  return true;
}
