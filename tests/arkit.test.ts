import test from 'node:test';
import assert from 'node:assert/strict';
import { arkitKeys, ausToARKit, directShapeChannel, normalizeARKit, parseSignal, facsToARKit } from '../src/arkit';
import { FaceEngine } from '../src/engine';
import { resolveProfile, vroidProfile } from '../src/profile';
test('52 Apple channels and ICT upper-lip correspondence are explicit, bounded and complete',()=>{
  assert.equal(arkitKeys.length,52);assert.equal(new Set(arkitKeys).size,52);const au=new FaceEngine().snapshot().aus;au.au10UpperLipRaiser=.7;au.au09NoseWrinkler=.4;au.au12LipCornerPuller=.6;
  const packet=ausToARKit(au);assert.equal(Object.keys(packet).length,52);assert.equal(packet.mouthShrugUpper,.7);assert.equal(packet.mouthUpperUpLeft,0);assert.equal(packet.noseSneerLeft,.4);assert.equal(packet.mouthSmileRight,.6);
});
test('ICT _L/_R channels resolve symmetrically while preserving literal model names',()=>{
  const resolved=resolveProfile(vroidProfile,['browInnerUp_L','browInnerUp_R','mouthSmile_L','mouthSmile_R']);
  assert(resolved.find(b=>b.au==='au01InnerBrowRaiser')!.resolved.length===2);assert(resolved.find(b=>b.au==='au12LipCornerPuller')!.resolved.length===2);
  assert(directShapeChannel('mouthSmile_L')==='mouthSmileLeft');assert(directShapeChannel('Fcl_MTH_Fun')===null);
});
test('MediaPipe neutral is ignored, asymmetric coefficients survive, and Apple tongueOut stays distinct',()=>{
  const packet=parseSignal({faceBlendshapes:[{categories:[{categoryName:'_neutral',score:.9},{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.1}]}]});assert(packet.eyeBlinkLeft===.8);assert(packet.eyeBlinkRight===.1);assert(packet.tongueOut===0);assert(!('_neutral' in packet));
  assert.throws(()=>normalizeARKit({unknown:.2}));assert.throws(()=>normalizeARKit({jawOpen:NaN}));
});
test('direct signal ownership releases and VAD inputs regain face control',()=>{
  const e=new FaceEngine({autoBlink:false});e.triggerEmotion('happy');for(let i=0;i<120;i++)e.update(1/120);e.setBlendshapes({eyeBlinkLeft:.9,eyeBlinkRight:.1,mouthSmileLeft:.2});
  let frame=e.update(.1);assert.equal(frame.source,'arkit52');assert.equal(frame.blendshapes.eyeBlinkLeft,.9);assert.equal(frame.blendshapes.eyeBlinkRight,.1);
  e.setAU('au45Blink',0);for(let i=0;i<120;i++)e.update(1/120);assert(e.snapshot().blendshapes.eyeBlinkLeft<.001);
  e.clearAU();e.setVAD({valence:.8,arousal:.3,dominance:.3});frame=e.update(.1);assert.equal(frame.source,'emotion');
  e.setBlendshapes({jawOpen:.8});e.triggerEmotion('calm');assert.equal(e.snapshot().source,'emotion');
});
test('standard FACS packets support ICT AU names and explicit side, without silently guessing OpenFace scale',()=>{
  const frame=parseSignal({protocol:'facs',aus:{AU01:.3,AU12L:.7,AU30R:.4,AU45R:.8}});assert(frame.browInnerUp===.3);assert(frame.mouthSmileLeft===.7);assert(frame.mouthSmileRight===0);assert(frame.jawRight===.4);assert(frame.eyeBlinkRight===.8);
  assert.throws(()=>facsToARKit({AU01:4}));assert.throws(()=>facsToARKit({AU99:.5}));assert.throws(()=>facsToARKit({AU01L:.3}));
});
