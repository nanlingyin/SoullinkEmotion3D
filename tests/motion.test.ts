import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceEngine } from '../src/engine';
import { damp, MotionTimeline, resolveAction } from '../src/motion';
import { buildJevRequest, normalizeSemanticInput, parseJevResult } from '../server/jev';

const engine = () => new FaceEngine({ idle: false, autoBlink: false, autoDecay: false });
function run(e: FaceEngine, seconds: number, fps = 120) { for (let i = 0; i < Math.round(seconds * fps); i++) e.update(1 / fps); return e.snapshot(); }
const close = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('arousal and dominance affect unspecified motion; explicit values are emotion-independent', () => {
  const low = engine(), high = engine();
  low.setVAD({ valence: -.4, arousal: -.8, dominance: -.8 }); high.setVAD({ valence: .4, arousal: .8, dominance: .8 });
  const quiet = low.playAction('nod'), energetic = high.playAction('nod');
  assert.ok(energetic.amplitude > quiet.amplitude); assert.ok(energetic.cycleDuration < quiet.cycleDuration);
  const options = { amplitude: .3, duration: .8, repetitions: 2 };
  const a = low.playAction('nod', options), b = high.playAction('nod', options);
  close(a.amplitude, .3); close(a.cycleDuration, .8); close(a.totalDuration, 1.6);
  assert.deepEqual(a, b); assert.equal(a.emotionLinked, false);
  low.configure({ emotionMotion: false }); high.configure({ emotionMotion: false });
  assert.deepEqual(low.playAction('shake'), high.playAction('shake'));
});

test('precise motion reaches its declared amplitude, repeats and ends at zero', () => {
  const e = engine(); e.playAction('nod', { amplitude: .3, duration: .8, repetitions: 2 });
  close(run(e, .4).pose.x, -.3); close(run(e, .4).pose.x, 0); close(run(e, .4).pose.x, -.3);
  close(run(e, .4).pose.x, 0); assert.equal(e.snapshot().motion.actions.length, 0);
  e.playAction('nod', { amplitude: 0, duration: .8 }); close(run(e, .4).pose.x, 0);
  e.playAction('blink', { amplitude: .4, duration: .5, repetitions: 2 });
  close(run(e, .2).blink, .4); run(e, .8); close(e.snapshot().blink, 0);
});

test('head gestures and blink can overlap; interruption and stop preserve position and velocity', () => {
  const e = engine(); e.playAction('nod', { amplitude: .7, duration: 1 }); run(e, .2);
  const before = e.snapshot().motion.actions[0];
  e.playAction('nod', { amplitude: .2, duration: .8 });
  const after = e.snapshot().motion.actions[0]; close(after.value, before.value); close(after.velocity, before.velocity);
  e.playAction('blink'); assert.equal(e.snapshot().motion.actions.length, 2);
  run(e, .1); const current = e.snapshot().motion.actions.find(a => a.name === 'nod')!;
  e.stopActions(); const stopped = e.snapshot().motion.actions.find(a => a.name === 'nod')!;
  close(stopped.value, current.value); close(stopped.velocity, current.velocity);
  run(e, .3); close(e.snapshot().pose.x, 0); close(e.snapshot().blink, 0);
});

test('gaze entry, expiry and manual takeover are continuous and respect precise targets', () => {
  const e = engine(); e.setGaze(.2, -.1); run(e, .5);
  const previous = e.snapshot().gaze.x;
  e.glance(1, 0, 1, { amplitude: .3, response: .3 }); close(e.snapshot().gaze.x, previous);
  close(run(e, .6).gaze.x, .3, .001);
  run(e, .39); const beforeExpiry = e.snapshot().gaze.x;
  const afterExpiry = run(e, 1 / 120).gaze.x;
  assert.ok(Math.abs(afterExpiry - beforeExpiry) < .005);
  close(run(e, .6).gaze.x, .2, .001);
  e.glance(1, 0, 3); run(e, .1); const moving = e.snapshot().gaze.x;
  e.setGaze(-.4, .2); close(e.snapshot().gaze.x, moving);
  close(run(e, .6).gaze.x, -.4, .001);
});

test('face response retains velocity at a retarget and manual AUs settle exactly', () => {
  const e = engine(); e.setAU('au12LipCornerPuller', 1);
  run(e, .1); const start = e.snapshot().aus.au12LipCornerPuller;
  e.setAU('au12LipCornerPuller', 0); close(e.snapshot().aus.au12LipCornerPuller, start);
  assert.ok(run(e, 1 / 120).aus.au12LipCornerPuller > start, 'the previous velocity is retained');
  close(run(e, 1.5).aus.au12LipCornerPuller, 0, 1e-6);
  for (let i = 0; i < 300; i++) { e.setAU('au12LipCornerPuller', i % 2); const n = e.update(1 / 120).aus.au12LipCornerPuller; assert.ok(n >= 0 && n <= 1); }
  const x = damp(.3, .7, 1, .4, .1), a = damp(.3, .7, 1, .4, .04), b = damp(a.value, a.velocity, 1, .4, .06);
  close(x.value, b.value); close(x.velocity, b.velocity);
});

test('motion and gaze are invariant across 15, 30, 60 and 144 FPS', () => {
  const states = [15, 30, 60, 144].map(fps => { const e = engine(); e.playAction('shake', { amplitude: .4, duration: .8, repetitions: 3 }); e.glance(1, -.3, .7); return run(e, 1, fps); });
  for (const state of states) { close(state.pose.y, states[0].pose.y); close(state.gaze.x, states[0].gaze.x); close(state.gaze.y, states[0].gaze.y); }
});

test('manual eyelid control takes over an active blink continuously and suppresses automatic blink clips', () => {
  const e = engine(); e.configure({ autoBlink: true }); e.playAction('blink', { duration: .5 }); run(e, .1);
  const before = e.snapshot().aus.au45Blink;
  e.setAU('au45Blink', .1); close(e.snapshot().aus.au45Blink, before);
  assert.equal(e.snapshot().motion.actions.length, 0);
  close(run(e, 4).aus.au45Blink, .1, 1e-6); assert.equal(e.snapshot().motion.actions.length, 0);
  e.setAU('au45Blink', null); close(e.snapshot().aus.au45Blink, .1, 1e-6);
  close(run(e, 1).aus.au45Blink, 0, 1e-5);
});

test('numeric candidates are semantically selected; negation/quotes cannot bypass the action gate', () => {
  const input = normalizeSemanticInput({ text: '不要幅度80%，请轻轻点头两次，幅度30%，每次0.8秒。' });
  const req = buildJevRequest(input, 'test');
  assert.ok('motion_amplitude' in req.questions && 'motion_duration' in req.questions && 'motion_repetitions' in req.questions);
  const c = (value: string) => ({ type: 'choice', choice: value, confidence: .01 });
  const s = { type: 'score', score: 2, confidence: .01 };
  const raw = { model: 'test', answers: { kind: c('action'), emotion: c('neutral'), valence: s, arousal: s, dominance: s, impact: s, dominance_known: { type: 'noul', noul: 0 }, gesture: c('nod'), gaze: c('keep'), head_direction: c('keep'), motion_strength: c('gentle'), motion_tempo: c('slow'), motion_amplitude: c('c1'), motion_duration: c('c0'), motion_repetitions: c('c0') } };
  const result = parseJevResult(raw, input, 1);
  assert.deepEqual(result.actions, [{ type: 'nod', amplitude: .3, duration: .8, repetitions: 2 }]);
  assert.equal(result.intensity, 0);
  const e = engine(); const gesture = result.actions[0]; assert.ok(gesture.type === 'nod');
  assert.equal(e.playAction(gesture.type, gesture).amplitude, .3, 'confidence is never multiplied into amplitude');
  raw.answers.kind = c('none'); assert.deepEqual(parseJevResult(raw, input, 1).actions, []);
  raw.answers.motion_amplitude = c('invented'); assert.throws(() => parseJevResult(raw, input, 1), /选项无效/);
  const gazeInput = normalizeSemanticInput({ text: '缓缓看左边，幅度50%，保持3秒。' });
  Object.assign(raw.answers, { kind: c('action'), gesture: c('none'), gaze: c('left'), motion_strength: c('auto'), motion_tempo: c('slow'), motion_amplitude: c('c0') });
  const gaze = parseJevResult(raw, gazeInput, 1).actions[0];
  assert.ok(gaze.type === 'gaze'); assert.equal(gaze.seconds, 3); assert.equal(gaze.amplitude, .5); close(gaze.response!, .22 / .6);
});
