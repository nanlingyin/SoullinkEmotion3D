import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceEngine } from '../src/engine';
import { computeMorphWeights, resolveProfile, vroidProfile } from '../src/profile';

const bindings = resolveProfile(vroidProfile, ['Fcl_BRW_Sorrow', 'Fcl_BRW_Surprised', 'Fcl_BRW_Angry', 'Fcl_EYE_Surprised', 'Fcl_EYE_Joy', 'Fcl_EYE_Angry', 'Fcl_EYE_Close', 'Fcl_MTH_Fun', 'Fcl_MTH_Joy', 'Fcl_MTH_Sorrow', 'Fcl_MTH_Angry', 'Fcl_MTH_Close', 'Fcl_MTH_A', 'Fcl_MTH_U', 'Fcl_MTH_I', 'Fcl_MTH_Surprised']);
test('principal VRoid expression proxies can reach their full shape range', () => {
  for (const [key, shape] of [['au06CheekRaiser', 'Fcl_EYE_Joy'], ['au07LidTightener', 'Fcl_EYE_Angry'], ['au12LipCornerPuller', 'Fcl_MTH_Fun'], ['au23LipTightener', 'Fcl_MTH_Angry']] as const) {
    const e = new FaceEngine(), au = e.snapshot().aus; au[key] = 1;
    assert.equal(computeMorphWeights(au, bindings)[shape], 1);
  }
});
test('high-gain proxy contrast preserves a main expression while reducing its opposing shapes', () => {
  const au = new FaceEngine().snapshot().aus;
  Object.assign(au, { au06CheekRaiser: 1, au05UpperLidRaiser: .3, au07LidTightener: .2 });
  const plain = computeMorphWeights(au, bindings), clear = computeMorphWeights(au, bindings, {}, { contrast: 1.5 });
  assert.ok(clear.Fcl_EYE_Joy > plain.Fcl_EYE_Joy + .2);
  assert.ok(clear.Fcl_EYE_Surprised < plain.Fcl_EYE_Surprised * .25);
  for (const value of Object.values(clear)) assert.ok(value >= 0 && value <= 1);
});
test('automatic closed-mouth proxy cannot consume an angry mouth expression; manual mouth pins remain authoritative', () => {
  const au = new FaceEngine().snapshot().aus;
  Object.assign(au, { au23LipTightener: 1, au24LipPressor: 1, au15LipCornerDepressor: .3 });
  const plain = computeMorphWeights(au, bindings), clear = computeMorphWeights(au, bindings, {}, { contrast: 1.5 });
  assert.ok(clear.Fcl_MTH_Angry > plain.Fcl_MTH_Angry + .3);
  assert.equal(clear.Fcl_MTH_Close, 0);
  assert.ok(Object.entries(clear).filter(([key]) => key.includes('Fcl_MTH_')).reduce((sum, [, v]) => sum + v, 0) <= 1.100001);
  assert.deepEqual(computeMorphWeights(au, bindings, {}, { contrast: 1.5, pinned: new Set(['au24LipPressor']) }), plain);
});
test('eye pins and raw ARKit channels are not sharpened by cartoon proxy conflict handling', () => {
  const au = new FaceEngine().snapshot().aus; Object.assign(au, { au06CheekRaiser: .7, au05UpperLidRaiser: .4 });
  assert.deepEqual(computeMorphWeights(au, bindings, {}, { contrast: 1.5, pinned: new Set(['au06CheekRaiser']) }), computeMorphWeights(au, bindings));
  const direct = resolveProfile(vroidProfile, ['eyeWideLeft', 'eyeWideRight', 'cheekSquintLeft', 'cheekSquintRight']);
  assert.deepEqual(computeMorphWeights(au, direct, {}, { contrast: 1.5 }), computeMorphWeights(au, direct));
});
test('default continuous response catches up during a brief action and diagnostics show the real settings', () => {
  const e = new FaceEngine({ idle: false, autoBlink: false });
  e.setAU('au06CheekRaiser', 1); e.setAU('au12LipCornerPuller', 1);
  assert.equal(e.snapshot().aus.au06CheekRaiser, 0);
  for (let i = 0; i < 12; i++) e.update(1 / 120);
  assert.ok(e.snapshot().aus.au06CheekRaiser > .6); assert.ok(e.snapshot().aus.au12LipCornerPuller > .5);
  e.configure({ gain: 4 }); assert.equal(e.snapshot().settings.gain, 4);
  assert.ok(e.snapshot().pinnedAUs.includes('au06CheekRaiser'));
});
