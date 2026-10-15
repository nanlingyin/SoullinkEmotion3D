import { EmotionStateController } from '../vendor/soullink/emotion/EmotionStateController';
import { emotionVADPresets } from '../vendor/soullink/emotion/EmotionPresetRegistry';
import { createDefaultActionUnitState } from '../vendor/soullink/facs/defaultActionUnitState';
import { actionUnitDefinitions, type FACSActionUnitKey, type FACSActionUnitState, type PartialFACSActionUnitState } from '../vendor/soullink/facs/FACSActionUnitState';
import type { VADVector, VADRuntimeState } from '../vendor/soullink/emotion/VADState';
import { DetailedVADMapper, type DetailState } from './detailed-vad';
import { emotionByName } from './emotions';
import { ausToARKit, arkitToAUs, normalizeARKit, auChannels, type ARKitState } from './arkit';
import { damp, emotionMotionFactors, MotionTimeline, resolveAction, type ActionName, type ActionOptions, type ActionState, type GazeOptions } from './motion';
import { directionAngles, eyeLimits, headLimits, legacyHeadScale, poseToDegrees, gazeToDegrees, type Direction, type HeadAngles, type EyeAngles } from './directions';

export { actionUnitDefinitions, emotionVADPresets };
export type { VADVector, FACSActionUnitState, FACSActionUnitKey };
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));

export interface LabSettings {
  halfLife: number;
  hold: number;
  approach: number;
  gain: number;
  detailMix: number;
  browGain: number;
  eyeGain: number;
  mouthGain: number;
  autoDecay: boolean;
  autoBlink: boolean;
  idle: boolean;
  ambient: boolean;
  speed: number;
  emotionMotion: boolean;
  motionAmplitude: number;
  motionDuration: number;
  motionSpeed: number;
  motionRepetitions: number;
  faceSmoothing: number;
  gazeResponse: number;
  gazeHold: number;
}
export const defaultSettings: LabSettings = { halfLife: 8, hold: 8, approach: 2.4, gain: 1.4, detailMix: .65, browGain: 1, eyeGain: 1, mouthGain: 1, autoDecay: true, autoBlink: true, idle: true, ambient: false, speed: 1, emotionMotion: true, motionAmplitude: .65, motionDuration: 1.1, motionSpeed: 1, motionRepetitions: 1, faceSmoothing: .28, gazeResponse: .22, gazeHold: 3 };
export interface FrameState {
  time: number;
  vad: VADRuntimeState;
  aus: FACSActionUnitState;
  blink: number;
  gaze: { x: number; y: number };
  pose: { x: number; y: number; z: number };
  details: DetailState;
  blendshapes:ARKitState;
  source:'emotion'|'arkit52';
  settings: LabSettings;
  pinnedAUs: FACSActionUnitKey[];
  motion: { actions: ActionState[]; gazeTarget: { x: number; y: number }; emotionLinked: boolean };
  angles: { head: HeadAngles; eyes: EyeAngles; headTarget: HeadAngles; eyeTarget: EyeAngles; headManual: boolean; eyesManual: boolean };
}

/** Headless: seconds in, normalized AU weights out. No rendering or network dependencies. */
export class FaceEngine {
  settings: LabSettings = { ...defaultSettings };
  private controller = new EmotionStateController();
  private mapper = new DetailedVADMapper();
  private details: DetailState = { blend: [], dominant: 'neutral', eyelidRelaxation: 0, regions: {brow:0,eyes:0,mouth:0},sourceStrength:0 };
  private intent: {name:string;strength:number} | undefined;
  private au = createDefaultActionUnitState();
  private auVelocity = createDefaultActionUnitState();
  private eyelidVelocity = 0;
  private accumulator = 0;
  private clock = 0;
  private manual: PartialFACSActionUnitState = {};
  private incoming:ARKitState|null=null;
  private incomingAUs:PartialFACSActionUnitState={};
  private lockedTarget: VADVector | null = null;
  private nextBlink = 3.2;
  private motions = new MotionTimeline();
  private gaze = { x: 0, y: 0 };
  private gazePrecision = false;
  private gazeCurrent = { x: 0, y: 0 };
  private gazeVelocity = { x: 0, y: 0 };
  private gazePulse: { x: number; y: number; until: number; response: number } | null = null;
  private pose = { x: 0, y: 0, z: 0 };
  private poseCurrent = { x: 0, y: 0, z: 0 };
  private poseVelocity = { x: 0, y: 0, z: 0 };
  private headPrecision = false;
  private headFollow = 1;
  private headFollowVelocity = 0;
  private latest: VADRuntimeState;

  constructor(settings: Partial<LabSettings> = {}) {
    this.configure(settings);
    this.latest = this.controller.update(0);
  }
  configure(patch: Partial<LabSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.settings.halfLife = clamp(this.settings.halfLife, 1.74, 300);
    this.settings.hold = clamp(this.settings.hold, 0, 90);
    this.settings.approach = clamp(this.settings.approach, 0.2, 4);
    this.settings.gain = clamp(this.settings.gain, 0, 4);
    this.settings.detailMix = clamp(this.settings.detailMix);
    for(const key of ['browGain','eyeGain','mouthGain'] as const)this.settings[key]=clamp(this.settings[key],0,2);
    this.settings.speed = clamp(this.settings.speed, 0.1, 8);
    this.settings.motionAmplitude = clamp(this.settings.motionAmplitude);
    this.settings.motionDuration = clamp(this.settings.motionDuration, .25, 8);
    this.settings.motionSpeed = clamp(this.settings.motionSpeed, .25, 3);
    this.settings.motionRepetitions = Math.round(clamp(this.settings.motionRepetitions, 1, 6));
    this.settings.faceSmoothing = clamp(this.settings.faceSmoothing, .08, 1.5);
    this.settings.gazeResponse = clamp(this.settings.gazeResponse, .08, 1.5);
    this.settings.gazeHold = clamp(this.settings.gazeHold, .2, 10);
    this.controller.configure({ decayRate: Math.LN2 / this.settings.halfLife, emotionHoldSeconds: this.settings.hold, targetApproachRate: this.settings.approach, ambientDriftStrength: this.settings.ambient ? 0.034 : 0 });
    if (patch.autoDecay === false && this.latest) this.lockedTarget = { ...this.latest.target };
  }
  triggerEmotion(emotion: string, intensity = 1) {
    const preset = emotionByName.get(emotion === 'angry' ? 'anger' : emotion);
    if (!preset) throw new Error(`Unknown emotion: ${emotion}`);
    const strength = clamp(intensity);
    if (strength === 0) return {...preset.vad};
    this.incoming=null;this.incomingAUs={};
    this.controller.nudge({ emotion: preset.name, naturalVAD: preset.vad, intensity: strength, contextTags: [] });
    this.intent = {name:preset.name,strength};
    this.latest = this.controller.update(0);
    this.lockedTarget = { ...this.latest.target };
    return {...preset.vad};
  }
  setVAD(vad: Partial<VADVector>) {
    this.incoming=null;this.incomingAUs={};
    const next = { ...this.latest.target };
    for (const key of ['valence', 'arousal', 'dominance'] as const) {
      if (vad[key] !== undefined) next[key] = clamp(vad[key]!, -1, 1);
    }
    this.controller.blendTo(next, 1);
    this.intent = undefined;
    this.lockedTarget = next;
    this.latest = this.controller.update(0);
  }
  /** Semantic impact controls movement toward the target; confidence never becomes facial gain. */
  applySemanticEmotion(vad: Partial<VADVector>, impact: number, emotion?: string) {
    if (!Number.isFinite(impact)) throw new Error('情绪影响强度必须是有限数值');
    const strength = clamp(impact);
    if (strength === 0) return false;
    const next = { ...this.latest.target };
    for (const key of ['valence', 'arousal', 'dominance'] as const) {
      const n = vad[key];
      if (n !== undefined) {
        if (!Number.isFinite(n)) throw new Error('语义 VAD 必须是有限数值');
        next[key] = clamp(n, -1, 1);
      }
    }
    this.incoming = null; this.incomingAUs = {};
    this.controller.blendTo(next, strength);
    const style = emotion && emotion !== 'neutral' ? emotionByName.get(emotion) : undefined;
    this.intent = style ? { name: style.name, strength } : undefined;
    this.latest = this.controller.update(0);
    this.lockedTarget = { ...this.latest.target };
    return true;
  }
  setAU(key: FACSActionUnitKey, value: number | null) {
    const definition = actionUnitDefinitions.find(d => d.key === key);
    if (!definition) throw new Error(`Unknown AU: ${key}`);
    if (key === 'au45Blink' && value !== null && !this.isPinned(key) && !this.incoming) {
      const blink = this.motions.sample(this.clock).find(a => a.name === 'blink');
      if (blink && blink.value > this.au.au45Blink) { this.au.au45Blink = blink.value; this.auVelocity.au45Blink = blink.velocity; }
      this.motions.clear('blink');
    }
    if (value === null) delete this.manual[key];
    else this.manual[key] = clamp(value, definition.min, definition.max);
  }
  isPinned(key: FACSActionUnitKey) { return this.manual[key] !== undefined; }
  clearAU() { this.manual = {};this.incoming=null;this.incomingAUs={}; }
  setBlendshapes(state:Record<string,unknown>|null){this.incoming=state?normalizeARKit(state):null;this.incomingAUs=this.incoming?arkitToAUs(this.incoming):{};}
  setGaze(x: number, y: number) { this.gazePulse = null; this.gazePrecision = true; this.gaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; }
  setGazeDegrees(angles: Partial<EyeAngles>) {
    this.setGaze(angles.yaw === undefined ? this.gaze.x : clamp(angles.yaw, -eyeLimits.yaw, eyeLimits.yaw) / eyeLimits.yaw, angles.pitch === undefined ? this.gaze.y : clamp(angles.pitch, -eyeLimits.pitch, eyeLimits.pitch) / eyeLimits.pitch);
    return gazeToDegrees(this.gaze);
  }
  gazeDirection(direction: Direction, degrees = 15) { return this.setGazeDegrees(directionAngles(direction, degrees)); }
  glanceDegrees(angles: EyeAngles, seconds = this.settings.gazeHold, response = this.settings.gazeResponse) { this.glance(clamp(angles.yaw, -eyeLimits.yaw, eyeLimits.yaw) / eyeLimits.yaw, clamp(angles.pitch, -eyeLimits.pitch, eyeLimits.pitch) / eyeLimits.pitch, seconds, { amplitude: 1, emotion: false, response }); }
  releaseGazeControl() { this.gazePulse = null; this.gaze = { x: 0, y: 0 }; this.gazePrecision = false; }
  glance(x: number, y: number, seconds = this.settings.gazeHold, options: GazeOptions = {}) {
    const linked = options.emotion ?? this.settings.emotionMotion;
    const factors = linked ? emotionMotionFactors(this.latest.target) : { amplitude: 1, speed: 1 };
    const amplitude = clamp(options.amplitude ?? this.settings.motionAmplitude * factors.amplitude);
    const response = clamp(options.response ?? this.settings.gazeResponse / factors.speed, .08, 1.5);
    this.gazePulse = { x: clamp(x, -1, 1) * amplitude, y: clamp(y, -1, 1) * amplitude, until: this.clock + clamp(seconds, .2, 10), response };
  }
  setPose(x: number, y: number, z: number) { this.setHeadAngles(poseToDegrees({ x: clamp(x, -1, 1), y: clamp(y, -1, 1), z: clamp(z, -1, 1) })); }
  setHeadAngles(angles: Partial<HeadAngles>) {
    const actions = this.motions.sample(this.clock);
    if (!this.headPrecision || actions.some(a => a.name === 'nod' || a.name === 'shake')) {
      this.poseCurrent = { ...this.snapshot().pose };
      this.poseVelocity.x -= actions.find(a => a.name === 'nod')?.velocity ?? 0;
      this.poseVelocity.y += actions.find(a => a.name === 'shake')?.velocity ?? 0;
      if (!this.headPrecision) {
        this.poseVelocity.x += this.auVelocity.headY * this.headFollow + (this.settings.idle ? Math.cos(this.clock * .79) * .045 * .79 * this.headFollow : 0);
        this.poseVelocity.y += this.auVelocity.headX * this.headFollow + (this.settings.idle ? Math.cos(this.clock * .49) * .06 * .49 * this.headFollow : 0);
        this.poseVelocity.z += this.auVelocity.headZ * this.headFollow + (this.settings.idle ? Math.cos(this.clock * .67) * .055 * .67 * this.headFollow : 0);
      }
    }
    this.motions.clear('nod'); this.motions.clear('shake');
    this.headPrecision = true; this.headFollow = 0; this.headFollowVelocity = 0;
    if (angles.pitch !== undefined) this.pose.x = clamp(angles.pitch, -headLimits.pitch, headLimits.pitch) / legacyHeadScale.pitch;
    if (angles.yaw !== undefined) this.pose.y = clamp(angles.yaw, -headLimits.yaw, headLimits.yaw) / legacyHeadScale.yaw;
    if (angles.roll !== undefined) this.pose.z = -clamp(angles.roll, -headLimits.roll, headLimits.roll) / legacyHeadScale.roll;
    return poseToDegrees(this.pose);
  }
  headDirection(direction: Direction, degrees = 20) { return this.setHeadAngles({ ...directionAngles(direction, degrees), roll: 0 }); }
  releaseHeadControl() { this.headPrecision = false; this.pose = { x: 0, y: 0, z: 0 }; }
  playAction(name: ActionName, options: ActionOptions = {}) { return this.motions.play(resolveAction(name, options, this.settings, this.latest.target), this.clock); }
  stopActions() { this.motions.stop(this.clock); this.gazePulse = null; }
  reset() {
    this.controller.reset(); this.latest = this.controller.update(0);
    this.clearAU();this.lockedTarget = null; this.au = createDefaultActionUnitState(); this.auVelocity = createDefaultActionUnitState();
    this.clock = 0; this.accumulator = 0; this.nextBlink = 3.2; this.motions.reset();
    this.gaze = { x: 0, y: 0 }; this.gazeCurrent = { x: 0, y: 0 }; this.gazeVelocity = { x: 0, y: 0 }; this.gazePulse = null;
    this.pose = { x: 0, y: 0, z: 0 }; this.poseCurrent = { x: 0, y: 0, z: 0 }; this.poseVelocity = { x: 0, y: 0, z: 0 };
    this.headPrecision = false; this.gazePrecision = false; this.headFollow = 1; this.headFollowVelocity = 0;
    this.intent=undefined;this.eyelidVelocity=0;this.details={blend:[],dominant:'neutral',eyelidRelaxation:0,regions:{brow:0,eyes:0,mouth:0},sourceStrength:0};
  }
  /** Fixed 120 Hz avoids hold-boundary and decay differences between render rates. */
  update(deltaSeconds: number): FrameState {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return this.snapshot();
    this.accumulator += Math.min(deltaSeconds, 1) * this.settings.speed;
    const step = 1 / 120;
    while (this.accumulator + 1e-10 >= step) {
      this.accumulator -= step; this.clock += step;
      if (!this.settings.autoDecay && this.lockedTarget) this.controller.blendTo(this.lockedTarget, 1);
      this.latest = this.controller.update(step);
      if(this.intent&&this.settings.autoDecay&&(this.latest.holdSeconds??0)<=0)this.intent.strength*=Math.exp(-step*Math.LN2/this.settings.halfLife);
      const mapped=this.mapper.map(this.latest.current,this.settings,this.intent);
      const target=mapped.aus;
      const eyelid = damp(this.details.eyelidRelaxation, this.eyelidVelocity, mapped.details.eyelidRelaxation, this.settings.faceSmoothing * .72, step);
      this.details = { ...mapped.details, eyelidRelaxation: clamp(eyelid.value, 0, .3) };
      this.eyelidVelocity = eyelid.value === this.details.eyelidRelaxation ? eyelid.velocity : 0;
      for (const d of actionUnitDefinitions) {
        const value = this.manual[d.key] ?? this.incomingAUs[d.key] ?? target[d.key] ?? 0;
        const response = this.settings.faceSmoothing * (d.group === 'brow' ? 1.15 : d.group === 'eye' ? .72 : .9);
        const next = damp(this.au[d.key], this.auVelocity[d.key], value, response, step);
        this.au[d.key] = clamp(next.value, d.min, d.max);
        this.auVelocity[d.key] = next.value === this.au[d.key] ? next.velocity : 0;
      }
      if (this.gazePulse && this.clock >= this.gazePulse.until) this.gazePulse = null;
      const gazeTarget = this.gazePulse ?? this.gaze;
      for (const axis of ['x', 'y'] as const) {
        const emotionOffset = this.gazePulse || this.gazePrecision ? 0 : this.au[axis === 'x' ? 'gazeX' : 'gazeY'];
        const next = damp(this.gazeCurrent[axis], this.gazeVelocity[axis], clamp(gazeTarget[axis] + emotionOffset, -1, 1), this.gazePulse?.response ?? this.settings.gazeResponse, step);
        this.gazeCurrent[axis] = clamp(next.value, -1, 1);
        this.gazeVelocity[axis] = this.gazeCurrent[axis] === next.value ? next.velocity : 0;
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        const next = damp(this.poseCurrent[axis], this.poseVelocity[axis], this.pose[axis], this.settings.faceSmoothing, step);
        const limit = axis === 'x' ? headLimits.pitch / legacyHeadScale.pitch : axis === 'y' ? headLimits.yaw / legacyHeadScale.yaw : headLimits.roll / legacyHeadScale.roll;
        this.poseCurrent[axis] = clamp(next.value, -limit, limit);
        this.poseVelocity[axis] = this.poseCurrent[axis] === next.value ? next.velocity : 0;
      }
      const follow = damp(this.headFollow, this.headFollowVelocity, this.headPrecision ? 0 : 1, this.settings.faceSmoothing, step);
      this.headFollow = clamp(follow.value); this.headFollowVelocity = follow.velocity;
      if (this.settings.autoBlink && this.clock >= this.nextBlink) {
        if (!this.isPinned('au45Blink') && !this.incoming && !this.motions.sample(this.clock).some(a => a.name === 'blink')) this.playAction('blink', { amplitude: 1, duration: .23, repetitions: 1, emotion: false });
        this.nextBlink = this.clock + 3.5 + Math.sin(this.clock * 1.79) * 0.95;
      }
    }
    return this.snapshot();
  }
  snapshot(): FrameState {
    const gaze = this.gazeCurrent;
    const actions = this.motions.sample(this.clock);
    const blink = actions.find(a => a.name === 'blink')?.value ?? 0;
    const au = { ...this.au };
    if (!this.isPinned('au45Blink')&&!this.incoming) au.au45Blink = Math.max(au.au45Blink, blink);
    const generated=ausToARKit(au);const blendshapes=this.incoming?{...this.incoming}:generated;
    if(this.incoming)for(const key of Object.keys(this.manual) as FACSActionUnitKey[])for(const channel of auChannels[key]??[])blendshapes[channel]=generated[channel];
    const pose = { ...this.poseCurrent };
    pose.x -= actions.find(a => a.name === 'nod')?.value ?? 0;
    pose.y += actions.find(a => a.name === 'shake')?.value ?? 0;
    if (this.settings.idle) {
      pose.x += Math.sin(this.clock * 0.79) * 0.045 * this.headFollow;
      pose.y += Math.sin(this.clock * 0.49) * 0.06 * this.headFollow;
      pose.z += Math.sin(this.clock * 0.67) * 0.055 * this.headFollow;
    }
    // VAD also contributes subtle gaze and posture. Explicit gaze is added independently.
    const finalPose = { x: clamp(pose.x + au.headY * this.headFollow, -headLimits.pitch / legacyHeadScale.pitch, headLimits.pitch / legacyHeadScale.pitch), y: clamp(pose.y + au.headX * this.headFollow, -headLimits.yaw / legacyHeadScale.yaw, headLimits.yaw / legacyHeadScale.yaw), z: clamp(pose.z + au.headZ * this.headFollow, -headLimits.roll / legacyHeadScale.roll, headLimits.roll / legacyHeadScale.roll) };
    const finalGaze = { x: clamp(gaze.x, -1, 1), y: clamp(gaze.y, -1, 1) };
    return { time: this.clock, vad: { ...this.latest, dominantEmotion:this.details.dominant, current: { ...this.latest.current }, target: { ...this.latest.target }, ambient: { ...this.latest.ambient! } }, aus: au, blink, gaze: finalGaze, pose: finalPose, details:structuredClone(this.details),blendshapes,source:this.incoming?'arkit52':'emotion', settings: { ...this.settings }, pinnedAUs: Object.keys(this.manual) as FACSActionUnitKey[], motion: { actions, gazeTarget: { x: (this.gazePulse ?? this.gaze).x, y: (this.gazePulse ?? this.gaze).y }, emotionLinked: this.settings.emotionMotion }, angles: { head: poseToDegrees(finalPose), eyes: gazeToDegrees(finalGaze), headTarget: poseToDegrees(this.pose), eyeTarget: gazeToDegrees(this.gazePulse ?? this.gaze), headManual: this.headPrecision, eyesManual: this.gazePrecision || Boolean(this.gazePulse) } };
  }
}
