import assert from 'node:assert/strict';
import test from 'node:test';
import { previewTime } from '../src/preview-time.ts';
import { createClip, createProject, createTrack, emptyPose, evaluateProject, setKeyframe } from '../src/motion/index.ts';
import type { KeyframeModule } from '../src/motion/index.ts';

test('preview holds the last project pose while earlier clips and raw evaluation still release', () => {
  const project = createProject('example');
  const seed: KeyframeModule = { id: 'last', name: 'last', kind: 'keyframes', duration: 2, region: 'all', channels: [] };
  const last = setKeyframe(seed, 'expression', 'smile', 0, 0.7);
  const short = setKeyframe({ ...seed, id: 'short', duration: 1 }, 'expression', 'blink', 0, 1);
  project.modules.push(last, short);
  const track = createTrack('test');
  track.clips.push(createClip(last), createClip(short));
  project.tracks.push(track);
  assert.equal(evaluateProject(project, 1).expressions.blink, undefined);
  assert.deepEqual(evaluateProject(project, 2), emptyPose());
  assert.deepEqual(evaluateProject(project, previewTime(2, 2)).expressions, { smile: 0.7 });
  assert.equal(previewTime(0, 0), 0);
});
