import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Group, Vector3 } from 'three';
import { solveTwoBone } from '../src/ik.ts';

function chain() {
  const scene = new Group(), root = new Bone(), mid = new Bone(), end = new Bone();
  scene.add(root); root.add(mid); mid.add(end);
  mid.position.set(1, 0, 0); end.position.set(1, 0, 0);
  scene.updateWorldMatrix(true, true);
  return { scene, root, mid, end };
}

test('two-bone solver reaches a target and preserves segment lengths', () => {
  const { root, mid, end } = chain();
  const goal = new Vector3(1.1, 0.9, 0);
  assert.equal(solveTwoBone(root, mid, end, goal), true);
  assert.ok(end.getWorldPosition(new Vector3()).distanceTo(goal) < 1e-5);
  assert.ok(Math.abs(root.getWorldPosition(new Vector3()).distanceTo(mid.getWorldPosition(new Vector3())) - 1) < 1e-6);
  assert.ok(Math.abs(mid.getWorldPosition(new Vector3()).distanceTo(end.getWorldPosition(new Vector3())) - 1) < 1e-6);
});

test('two-bone solver clamps unreachable target and handles rotated parents', () => {
  const { scene, root, mid, end } = chain();
  scene.rotation.y = 1.1; scene.updateWorldMatrix(true, true);
  const goal = new Vector3(4, 3, 2);
  assert.equal(solveTwoBone(root, mid, end, goal), true);
  const actual = end.getWorldPosition(new Vector3());
  assert.ok(Math.abs(actual.length() - 2) < 2e-5);
  assert.ok(actual.clone().normalize().distanceTo(goal.clone().normalize()) < 1e-5);
  assert.ok([...root.quaternion.toArray(), ...mid.quaternion.toArray()].every(Number.isFinite));
});
