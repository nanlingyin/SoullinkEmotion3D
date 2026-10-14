import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { normalizeLegacyMorphNames } from '../src/model-utils';
import { resolveProfile, vroidProfile } from '../src/profile';

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
  assert(vrm.humanoid.getNormalizedBoneNode('head'));vrm.update(.016);assert(vrm.scene.children.length>0);VRMUtils.deepDispose(vrm.scene);
});
