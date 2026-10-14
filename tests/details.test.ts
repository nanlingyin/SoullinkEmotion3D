import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DetailedVADMapper } from '../src/detailed-vad';
import { defaultSettings, FaceEngine } from '../src/engine';
import { emotionCatalog } from '../src/emotions';
import { planePosition, editPlane, projectVAD } from '../src/space';
import { normalizeLegacyMorphNames } from '../src/model-utils';
import { resolveProfile, vroidProfile } from '../src/profile';
import { createHash } from 'node:crypto';
const mapper=new DetailedVADMapper();const map=(v:{valence:number;arousal:number;dominance:number})=>mapper.map(v,defaultSettings);
test('all 24 authored emotion anchors produce bounded, non-neutral states through the SDK controller',()=>{
  assert.equal(emotionCatalog.length,24);assert.equal(new Set(emotionCatalog.map(e=>e.name)).size,24);
  for(const preset of emotionCatalog.filter(p=>p.name!=='neutral')){const e=new FaceEngine({idle:false,autoBlink:false});e.triggerEmotion(preset.name);for(let i=0;i<240;i++)e.update(1/120);const state=e.snapshot();assert(Math.hypot(...Object.values(state.vad.current))>.08,preset.name);assert(Object.values(state.aus).every(Number.isFinite));assert(state.details.dominant===preset.name);}
});
test('D independently separates high-arousal negative anger from fear',()=>{
  const strong=map({valence:-.65,arousal:.7,dominance:.7}).aus;const yielding=map({valence:-.65,arousal:.7,dominance:-.7}).aus;
  assert(strong.au04BrowLowerer>yielding.au04BrowLowerer+.15);assert(strong.au07LidTightener>yielding.au07LidTightener+.1);
  assert(yielding.au01InnerBrowRaiser>strong.au01InnerBrowRaiser+.15);assert(yielding.au05UpperLidRaiser>strong.au05UpperLidRaiser+.1);
  assert(strong.headY>yielding.headY);assert(strong.gazeY>yielding.gazeY);
});
test('D also distinguishes a confident positive expression from a shy positive expression',()=>{
  const strong=map({valence:.45,arousal:.4,dominance:.75}).aus;const shy=map({valence:.45,arousal:.4,dominance:-.65}).aus;
  assert(strong.au14Dimpler>shy.au14Dimpler);assert(strong.headY>shy.headY);assert(shy.gazeY<strong.gazeY);
});
test('VAD to AU remains continuous over the whole cube and smoothly returns to neutral',()=>{
  for(let v=-1;v<=1;v+=.2)for(let a=-1;a<=1;a+=.2)for(let d=-1;d<=1;d+=.2){const x=map({valence:v,arousal:a,dominance:d}).aus;const y=map({valence:v,arousal:a,dominance:d+1e-5}).aus;for(const key of Object.keys(x) as (keyof typeof x)[])assert(Math.abs(x[key]-y[key])<.0002,`${v},${a},${d}: ${key}`);}
  const near=map({valence:1e-7,arousal:-1e-7,dominance:1e-7}).aus;assert(near.au12LipCornerPuller<.00001);assert(map({valence:0,arousal:0,dominance:0}).details.blend.length===0);
});
test('regional gains control only their intended facial region',()=>{
  const vad={valence:.75,arousal:.45,dominance:.35};const normal=mapper.map(vad,defaultSettings).aus;const changed=mapper.map(vad,{...defaultSettings,mouthGain:0}).aus;
  assert(changed.au12LipCornerPuller===0);assert(changed.au06CheekRaiser===normal.au06CheekRaiser);assert(changed.au02OuterBrowRaiser===normal.au02OuterBrowRaiser);
});
test('emotion style residue decays and cannot leave a stuck smile or gaze',()=>{
  const e=new FaceEngine({hold:0,halfLife:2,idle:false,autoBlink:false});e.triggerEmotion('embarrassed');for(let i=0;i<120*40;i++)e.update(1/120);const s=e.snapshot();assert(s.aus.au12LipCornerPuller<.001);assert(Math.abs(s.gaze.y)<.001);assert(s.details.sourceStrength<.001);
});
test('all three editable projections preserve the hidden axis and display dominance',()=>{
  const v={valence:.2,arousal:.3,dominance:.8};assert.deepEqual(planePosition(v,'vd'),{x:.6,y:.09999999999999998});assert(editPlane(v,'va',.2,.7).dominance===.8);assert(editPlane(v,'vd',.8,.2).arousal===.3);assert(editPlane(v,'ad',.8,.2).valence===.2);
  const a=projectVAD({...v,dominance:-.8}),b=projectVAD(v);assert(Math.hypot(a.x-b.x,a.y-b.y)>.5);assert(a.depth!==b.depth);
});
test('legacy targetNames are recovered without modifying the original model binary',()=>{
  const manifest=JSON.parse(fs.readFileSync('public/models/catalog.json','utf8'));assert.equal(manifest.length,4);
  for(const model of manifest){const binary=fs.readFileSync(`public/models/${model.id}.vrm`);assert.equal(createHash('sha256').update(binary).digest('hex'),model.sha256);const j=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString());normalizeLegacyMorphNames(j);const names=j.meshes.flatMap((m:{extras?:{targetNames?:string[]}})=>m.extras?.targetNames??[]);assert(new Set(names).size===model.morphs);const resolved=resolveProfile(vroidProfile,names);assert(resolved.filter(b=>b.supported).length>=15,model.id);assert(!resolved.find(b=>b.au==='au09NoseWrinkler')!.supported);}
});
