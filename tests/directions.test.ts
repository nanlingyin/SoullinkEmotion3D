import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceEngine } from '../src/engine';
import { directionGrid, directionAngles, headLimits, eyeLimits } from '../src/directions';

function run(e: FaceEngine, seconds: number, fps = 120) { for (let i = 0; i < Math.round(seconds * fps); i++) e.update(1 / fps); return e.snapshot(); }
const close = (a: number, b: number, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
test('nine head positions and eight gaze directions reach the specified angles, including diagonals', () => {
  for (const direction of directionGrid) {
    const e = new FaceEngine({ idle: false, autoBlink: false });
    const expected = directionAngles(direction.name, 20);
    e.headDirection(direction.name, 20); e.gazeDirection(direction.name, 15);
    const frame = run(e, 1.5);
    close(frame.angles.head.yaw, expected.yaw); close(frame.angles.head.pitch, expected.pitch); close(frame.angles.head.roll, 0);
    close(frame.angles.eyes.yaw, direction.x * 15); close(frame.angles.eyes.pitch, direction.y * 15);
  }
});
test('explicit angles bypass emotional offsets while preserving continuity, and partial edits preserve other axes', () => {
  const e = new FaceEngine({ autoDecay: false, autoBlink: false }); e.triggerEmotion('shy', 1); run(e, 1);
  e.playAction('nod'); run(e, .2);
  const before = e.snapshot(); e.setHeadAngles({ yaw: 23.4, pitch: -12.3, roll: 7.8 }); e.setGazeDegrees({ yaw: -13.2, pitch: 8.4 });
  close(e.snapshot().angles.head.pitch, before.angles.head.pitch); close(e.snapshot().angles.eyes.pitch, before.angles.eyes.pitch);
  const settled = run(e, 2);
  close(settled.angles.head.yaw, 23.4); close(settled.angles.head.pitch, -12.3); close(settled.angles.head.roll, 7.8);
  close(settled.angles.eyes.yaw, -13.2); close(settled.angles.eyes.pitch, 8.4);
  e.setHeadAngles({ yaw: -10 }); e.setGazeDegrees({ pitch: -5 }); const edited = run(e, 2);
  close(edited.angles.head.pitch, -12.3); close(edited.angles.head.roll, 7.8); close(edited.angles.head.yaw, -10);
  close(edited.angles.eyes.yaw, -13.2); close(edited.angles.eyes.pitch, -5);
  const held = e.snapshot(); e.releaseHeadControl(); e.releaseGazeControl();
  close(e.snapshot().angles.head.yaw, held.angles.head.yaw); close(e.snapshot().angles.eyes.yaw, held.angles.eyes.yaw);
  assert.equal(run(e, 2).angles.headManual, false);
});
test('degree bounds, reset, temporary gaze and normalized APIs remain coherent', () => {
  const e = new FaceEngine({ idle: false, autoBlink: false });
  assert.deepEqual(e.setHeadAngles({ yaw: 999, pitch: -999, roll: 999 }), { yaw: headLimits.yaw, pitch: -headLimits.pitch, roll: headLimits.roll });
  assert.deepEqual(e.setGazeDegrees({ yaw: -999, pitch: 999 }), { yaw: -eyeLimits.yaw, pitch: eyeLimits.pitch });
  run(e, 2); e.reset(); assert.deepEqual(e.snapshot().angles.head, { yaw: 0, pitch: 0, roll: 0 });
  e.setGazeDegrees({ yaw: 5, pitch: -3 }); run(e, .7); e.glanceDegrees({ yaw: 15, pitch: 10 }, .8);
  const peak = run(e, .5); close(peak.angles.eyes.yaw, 15, .01); close(peak.angles.eyes.pitch, 10, .01);
  const returned = run(e, 1); close(returned.angles.eyes.yaw, 5, .001); close(returned.angles.eyes.pitch, -3, .001);
  e.setGaze(1, -1); run(e, 1); close(e.snapshot().angles.eyes.yaw, 30); close(e.snapshot().angles.eyes.pitch, -25);
  assert.throws(() => e.headDirection('up', NaN), /非负/);
});
test('head and eye degrees remain frame-rate independent', () => {
  const states = [15, 30, 60, 144].map(fps => { const e = new FaceEngine({ idle: false, autoBlink: false }); e.setHeadAngles({ yaw: 30, pitch: 20, roll: -10 }); e.setGazeDegrees({ yaw: -15, pitch: -10 }); return run(e, 1, fps).angles; });
  for (const state of states) { close(state.head.yaw, states[0].head.yaw, 1e-9); close(state.head.pitch, states[0].head.pitch, 1e-9); close(state.eyes.yaw, states[0].eyes.yaw, 1e-9); }
});
