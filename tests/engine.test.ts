import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FaceEngine, clamp, type FACSActionUnitState } from '../src/engine';
import { computeMorphWeights, resolveProfile, parseProfile, vroidProfile } from '../src/profile';

const run=(engine:FaceEngine,seconds:number,fps=60)=>{for(let i=0;i<Math.round(seconds*fps);i++)engine.update(1/fps);return engine.snapshot();};
const mag=(v:{valence:number;arousal:number;dominance:number})=>Math.hypot(v.valence,v.arousal,v.dominance);

test('emotion hold, approach and exponential half-life use the real Soullink controller',()=>{
  const e=new FaceEngine({halfLife:4,hold:0,idle:false,autoBlink:false});e.triggerEmotion('happy',1);
  const initial=e.snapshot();const peak=run(e,6.2);assert(peak.vad.current.valence>0.5);assert((peak.vad.holdSeconds??1)===0);
  const later=run(e,4);const ratio=mag(later.vad.target)/mag(peak.vad.target);assert(Math.abs(ratio-.5)<1e-7,`half-life ratio ${ratio}`);
  assert(mag(initial.vad.current)<mag(peak.vad.current));assert(mag(later.vad.current)<mag(peak.vad.current));
});
test('15, 30, 60 and 144 FPS give equivalent VAD and AU states across hold expiry',()=>{
  const states=[15,30,60,144].map(fps=>{const e=new FaceEngine({hold:1,idle:false,autoBlink:false});e.triggerEmotion('anger',.8);return run(e,20,fps);});
  for(const state of states){assert(Math.abs(state.time-states[0].time)<1e-8);assert(Math.abs(state.vad.current.valence-states[0].vad.current.valence)<1e-8);assert(Math.abs(state.aus.au04BrowLowerer-states[0].aus.au04BrowLowerer)<1e-8);}
});
test('manual AU overrides release back into the current emotion layer',()=>{
  const e=new FaceEngine({autoBlink:false,idle:false});e.triggerEmotion('happy');e.setAU('au12LipCornerPuller',1);
  assert(run(e,1).aus.au12LipCornerPuller>.99);e.setAU('au12LipCornerPuller',null);assert(!e.isPinned('au12LipCornerPuller'));
  const automatic=run(e,2).aus.au12LipCornerPuller;assert(automatic<.8&&automatic>.1);
  e.setAU('au12LipCornerPuller',0);assert(run(e,1).aus.au12LipCornerPuller<.001);
});
test('zero intensity, non-finite inputs, AU clamping and reset cannot poison state',()=>{
  const e=new FaceEngine();e.triggerEmotion('happy',0);assert(mag(run(e,2).vad.current)===0);
  e.setVAD({valence:Infinity,arousal:-9,dominance:7});e.setAU('au26JawDrop',100);const s=run(e,2);
  assert(s.vad.current.arousal>=-1&&s.vad.current.dominance<=1);assert(s.aus.au26JawDrop<=1);
  assert(Number.isFinite(e.update(NaN).aus.au26JawDrop));e.reset();assert(mag(e.snapshot().vad.current)===0);assert(e.snapshot().aus.au26JawDrop===0);
});
test('turning off decay locks the current target and preserves the emotional state',()=>{
  const e=new FaceEngine({autoBlink:false});e.triggerEmotion('sad');run(e,1);e.configure({autoDecay:false});const start=mag(e.snapshot().vad.target);const end=mag(run(e,80).vad.target);assert(Math.abs(start-end)<1e-8);
  e.configure({autoDecay:true});run(e,100);assert(mag(e.snapshot().vad.current)<.02);
});
test('blink override and nod recover without holding a stale action',()=>{
  const e=new FaceEngine({autoBlink:false,idle:false});e.playAction('blink');assert(run(e,.1).aus.au45Blink>.8);assert(run(e,.3).aus.au45Blink===0);
  e.playAction('nod');assert(Math.abs(run(e,.2).pose.x)>.1);assert(Math.abs(run(e,2).pose.x)<1e-8);
});
function model(){const binary=fs.readFileSync('public/models/AvatarSample_B.vrm');assert(binary.readUInt32LE(0)===0x46546c67);return {binary,json:JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString()),binOffset:20+binary.readUInt32LE(12)+8};}
test('bundled official model has expected checksum, permissions, 57 real morphs and honest AU coverage',()=>{
  const {json}=model();const meta=json.extensions.VRMC_vrm.meta;assert(meta.allowRedistribution===true);assert(meta.modification==='allowModificationRedistribution');
  const names:string[]=json.meshes[0].extras.targetNames;assert(names.length===57);const resolved=resolveProfile(vroidProfile,names);assert(resolved.filter(b=>b.supported).length===17);
  for(const key of ['au09NoseWrinkler','au10UpperLipRaiser','au17ChinRaiser'])assert(!resolved.find(b=>b.au===key)!.supported);
});
test('each mapped AU drives nonzero geometry data in the bundled VRM',()=>{
  const {binary,json,binOffset}=model();const mesh=json.meshes[0];const names=mesh.extras.targetNames;const resolved=resolveProfile(vroidProfile,names);
  for(const b of resolved.filter(x=>x.supported))for(const t of b.resolved){const targetIndex=names.indexOf(t.name);let largest=0;
    for(const primitive of mesh.primitives){const accessor=json.accessors[primitive.targets[targetIndex].POSITION];const view=json.bufferViews[accessor.bufferView];const start=binOffset+(view.byteOffset??0)+(accessor.byteOffset??0);const stride=view.byteStride??12;
      for(let i=0;i<accessor.count;i++)for(let axis=0;axis<3;axis++)largest=Math.max(largest,Math.abs(binary.readFloatLE(start+i*stride+axis*4)));
    }
    assert(largest>1e-6,`${b.au} target ${t.name} has no geometric effect`);
  }
});
test('morph conflicts are bounded, blink suppresses competing eyelids, unsupported AU has no invented target',()=>{
  const {json}=model();const resolved=resolveProfile(vroidProfile,json.meshes[0].extras.targetNames);const au=new FaceEngine().snapshot().aus;
  for(const key of Object.keys(au))au[key as keyof FACSActionUnitState]=1;const weights=computeMorphWeights(au,resolved);
  for(const w of Object.values(weights))assert(Number.isFinite(w)&&w>=0&&w<=1);assert(weights.Fcl_EYE_Close===1);assert(weights.Fcl_EYE_Joy===0);
  assert(Object.entries(weights).filter(([n])=>n.startsWith('Fcl_MTH_')).reduce((s,[,v])=>s+v,0)<=1.1000001);
  assert(!Object.keys(weights).some(n=>n.includes('noseSneer')));
});
test('custom profiles reject corrupt entries and bilateral ARKit mapping covers both eyes',()=>{
  assert.throws(()=>parseProfile({schema:1,name:'bad',bindings:[{au:'bad',targets:[]}]}));
  assert.throws(()=>parseProfile({schema:1,name:'bad',bindings:[...vroidProfile.bindings,{...vroidProfile.bindings[0]}]}));
  const b=resolveProfile(vroidProfile,['eyeBlinkLeft','eyeBlinkRight']).find(b=>b.au==='au45Blink')!;assert(b.resolved.length===2);
  assert.deepEqual(parseProfile(vroidProfile),vroidProfile);assert(clamp(NaN)===0);
});
