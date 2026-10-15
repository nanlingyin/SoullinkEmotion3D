import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { normalizeLegacyMorphNames } from '../src/model-utils';
import { resolveProfile, vroidProfile } from '../src/profile';
import { FaceRig } from '../src/face-rig';
import { directionGrid } from '../src/directions';

for(const id of ['AvatarSample_B','AvatarSample_A','AvatarSample_C','Sendagaya_Shino'])test(`real Three.js/VRM parsing recovers usable AU geometry for ${id}`,async()=>{
  const loader=new GLTFLoader();
  // Node tests verify geometry/skeleton lifecycle. Texture decoding and pixels require browser QA.
  loader.register(()=>({name:'NODE_GEOMETRY_TEST_TEXTURES',loadTexture:async()=>new THREE.Texture({width:1,height:1} as unknown as HTMLImageElement)}));
  loader.register(parser=>({name:'SOULLINK_legacy_morph_names',beforeRoot:async()=>{normalizeLegacyMorphNames(parser.json);}}));
  loader.register(parser=>new VRMLoaderPlugin(parser));
  const binary=fs.readFileSync(`public/models/${id}.vrm`);const data=binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);
  const gltf=await loader.parseAsync(data,'');const vrm=gltf.userData.vrm as VRM;assert(vrm);VRMUtils.rotateVRM0(vrm);
  const meshes:THREE.Mesh[]=[];const names=new Set<string>();vrm.scene.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh&&m.morphTargetDictionary){meshes.push(m);Object.keys(m.morphTargetDictionary).forEach(n=>names.add(n));}});
  const resolved=resolveProfile(vroidProfile,names);assert(resolved.filter(b=>b.supported).length>=15);
  for(const binding of resolved.filter(b=>b.supported))for(const target of binding.resolved){let movement=0;for(const m of meshes){const index=m.morphTargetDictionary![target.name];if(index===undefined)continue;const attr=m.geometry.morphAttributes.position?.[index];if(attr)for(const value of attr.array)movement=Math.max(movement,Math.abs(value));}assert(movement>1e-6,`${binding.au}: ${target.name}`);}
  assert(vrm.humanoid.getNormalizedBoneNode('head'));vrm.update(.016);assert(vrm.scene.children.length>0);
  const rig = new FaceRig(vrm); assert.equal(rig.capabilities.eyeControl, 'bone-degrees');
  rig.apply({ yaw: 0, pitch: 0, roll: 0 }, { yaw: 0, pitch: 0 }); vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid.getRawBoneNode('head')!, leftEye = vrm.humanoid.getRawBoneNode('leftEye')!;
  const headRest = head.getWorldQuaternion(new THREE.Quaternion()), eyeRest = leftEye.getWorldQuaternion(new THREE.Quaternion());
  for (const d of directionGrid) {
    rig.apply({ yaw: d.x * 20, pitch: d.y * 20, roll: 0 }, { yaw: 0, pitch: 0 }); vrm.update(0); vrm.scene.updateMatrixWorld(true);
    const state = rig.state(); assert.ok(Math.abs(state.head!.yaw - d.x * 20) < 1e-5); assert.ok(Math.abs(state.head!.pitch - d.y * 20) < 1e-5);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).multiply(headRest.clone().invert()));
    if (d.x) assert.ok(forward.x * d.x > .2, `${id}: incorrect head yaw for ${d.name}`);
    if (d.y) assert.ok(forward.y * d.y > .2, `${id}: incorrect head pitch for ${d.name}`);
  }
  for (const d of directionGrid) {
    rig.apply({ yaw: 0, pitch: 0, roll: 0 }, { yaw: d.x * 15, pitch: d.y * 10 }); vrm.update(0); vrm.scene.updateMatrixWorld(true);
    const state = rig.state();
    for (const eye of [state.leftEye!, state.rightEye!]) { assert.ok(Math.abs(eye.yaw - d.x * 15) < 1e-5); assert.ok(Math.abs(eye.pitch - d.y * 10) < 1e-5); }
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(leftEye.getWorldQuaternion(new THREE.Quaternion()).multiply(eyeRest.clone().invert()));
    if (d.x) assert.ok(forward.x * d.x > .1, `${id}: incorrect eye yaw for ${d.name}`);
    if (d.y) assert.ok(forward.y * d.y > .1, `${id}: incorrect eye pitch for ${d.name}`);
  }
  VRMUtils.deepDispose(vrm.scene);
});
