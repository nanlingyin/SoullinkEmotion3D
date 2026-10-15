import * as THREE from 'three';
import { VRMLookAtBoneApplier, type VRM } from '@pixiv/three-vrm';
import { headLimits, eyeLimits, type HeadAngles, type EyeAngles } from './directions';

export interface RigCapabilities {
  head: boolean;
  leftEye: boolean;
  rightEye: boolean;
  eyeControl: 'bone-degrees' | 'expression-approximation' | 'unavailable';
  headLimits: HeadAngles;
  eyeLimits: EyeAngles;
}
/** Angle commands in character coordinates: +yaw left, +pitch up, +roll tilt left. */
export class FaceRig {
  readonly capabilities: RigCapabilities;
  private faceBasis: THREE.Quaternion;
  private faceBasisInverse: THREE.Quaternion;
  private rotation = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  constructor(private vrm: VRM) {
    const leftEye = Boolean(vrm.humanoid.getRawBoneNode('leftEye'));
    const rightEye = Boolean(vrm.humanoid.getRawBoneNode('rightEye'));
    const bone = vrm.lookAt?.applier instanceof VRMLookAtBoneApplier;
    const front = vrm.lookAt?.faceFront ?? new THREE.Vector3(0, 0, vrm.meta.metaVersion === '0' ? -1 : 1);
    this.faceBasis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), front.clone().normalize());
    this.faceBasisInverse = this.faceBasis.clone().invert();
    this.capabilities = { head: Boolean(vrm.humanoid.getNormalizedBoneNode('head')), leftEye, rightEye, eyeControl: bone && leftEye && rightEye ? 'bone-degrees' : vrm.lookAt && !bone ? 'expression-approximation' : 'unavailable', headLimits: { ...headLimits }, eyeLimits: { ...eyeLimits } };
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
    if (bone) {
      const applier = vrm.lookAt!.applier as VRMLookAtBoneApplier;
      // Identity range maps make a requested 15° become a real 15° bone rotation.
      for (const map of [applier.rangeMapHorizontalInner, applier.rangeMapHorizontalOuter]) { map.inputMaxValue = eyeLimits.yaw; map.outputScale = eyeLimits.yaw; }
      for (const map of [applier.rangeMapVerticalUp, applier.rangeMapVerticalDown]) { map.inputMaxValue = eyeLimits.pitch; map.outputScale = eyeLimits.pitch; }
    }
  }
  apply(head: HeadAngles, eyes: EyeAngles) {
    const node = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (node) {
      this.euler.set(-THREE.MathUtils.degToRad(head.pitch), THREE.MathUtils.degToRad(head.yaw), -THREE.MathUtils.degToRad(head.roll), 'YXZ');
      this.rotation.setFromEuler(this.euler);
      node.quaternion.copy(this.faceBasis).multiply(this.rotation).multiply(this.faceBasisInverse);
    }
    if (this.vrm.lookAt) { this.vrm.lookAt.yaw = eyes.yaw; this.vrm.lookAt.pitch = -eyes.pitch; }
  }
  private readBone(name: 'head' | 'leftEye' | 'rightEye') {
    const node = this.vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) return null;
    this.rotation.copy(this.faceBasisInverse).multiply(node.quaternion).multiply(this.faceBasis);
    this.euler.setFromQuaternion(this.rotation, 'YXZ');
    return { yaw: THREE.MathUtils.radToDeg(this.euler.y), pitch: -THREE.MathUtils.radToDeg(this.euler.x), roll: -THREE.MathUtils.radToDeg(this.euler.z) };
  }
  state() { return { capabilities: structuredClone(this.capabilities), head: this.readBone('head'), leftEye: this.readBone('leftEye'), rightEye: this.readBone('rightEye') }; }
}
