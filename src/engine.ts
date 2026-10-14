import { EmotionStateController } from '../vendor/soullink/emotion/EmotionStateController';
import { emotionVADPresets } from '../vendor/soullink/emotion/EmotionPresetRegistry';
import { createDefaultActionUnitState } from '../vendor/soullink/facs/defaultActionUnitState';
import { actionUnitDefinitions, type FACSActionUnitKey, type FACSActionUnitState, type PartialFACSActionUnitState } from '../vendor/soullink/facs/FACSActionUnitState';
import type { VADVector, VADRuntimeState } from '../vendor/soullink/emotion/VADState';
import { smoothingFactor } from '../vendor/soullink/utils/smoothing';
import { DetailedVADMapper, type DetailState } from './detailed-vad';
import { emotionByName } from './emotions';
import { ausToARKit, arkitToAUs, normalizeARKit, auChannels, type ARKitState } from './arkit';

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
}
export const defaultSettings: LabSettings = { halfLife: 8, hold: 8, approach: 2.4, gain: 1.4, detailMix: .65, browGain: 1, eyeGain: 1, mouthGain: 1, autoDecay: true, autoBlink: true, idle: true, ambient: false, speed: 1 };
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
}

/** Headless: seconds in, normalized AU weights out. No rendering or network dependencies. */
export class FaceEngine {
  settings: LabSettings = { ...defaultSettings };
  private controller = new EmotionStateController();
  private mapper = new DetailedVADMapper();
  private details: DetailState = { blend: [], dominant: 'neutral', eyelidRelaxation: 0, regions: {brow:0,eyes:0,mouth:0},sourceStrength:0 };
  private intent: {name:string;strength:number} | undefined;
  private au = createDefaultActionUnitState();
  private accumulator = 0;
  private clock = 0;
  private manual: PartialFACSActionUnitState = {};
  private incoming:ARKitState|null=null;
  private incomingAUs:PartialFACSActionUnitState={};
  private lockedTarget: VADVector | null = null;
  private nextBlink = 3.2;
  private blinkStarted = -Infinity;
  private gaze = { x: 0, y: 0 };
  private pose = { x: 0, y: 0, z: 0 };
  private action: { name: string; start: number } | null = null;
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
  setAU(key: FACSActionUnitKey, value: number | null) {
    const definition = actionUnitDefinitions.find(d => d.key === key);
    if (!definition) throw new Error(`Unknown AU: ${key}`);
    if (value === null) delete this.manual[key];
    else this.manual[key] = clamp(value, definition.min, definition.max);
  }
  isPinned(key: FACSActionUnitKey) { return this.manual[key] !== undefined; }
  clearAU() { this.manual = {};this.incoming=null;this.incomingAUs={}; }
  setBlendshapes(state:Record<string,unknown>|null){this.incoming=state?normalizeARKit(state):null;this.incomingAUs=this.incoming?arkitToAUs(this.incoming):{};}
  setGaze(x: number, y: number) { this.gaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; }
  setPose(x: number, y: number, z: number) { this.pose = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), z: clamp(z, -1, 1) }; }
  playAction(name: 'nod' | 'shake' | 'blink') {
    if (name === 'blink') this.blinkStarted = this.clock;
    else this.action = { name, start: this.clock };
  }
  reset() {
    this.controller.reset(); this.latest = this.controller.update(0);
    this.clearAU();this.lockedTarget = null; this.au = createDefaultActionUnitState();
    this.clock = 0; this.accumulator = 0; this.nextBlink = 3.2; this.blinkStarted = -Infinity;
    this.gaze = { x: 0, y: 0 }; this.pose = { x: 0, y: 0, z: 0 }; this.action = null;
    this.intent=undefined;this.details={blend:[],dominant:'neutral',eyelidRelaxation:0,regions:{brow:0,eyes:0,mouth:0},sourceStrength:0};
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
      const target=mapped.aus;this.details=mapped.details;
      for (const d of actionUnitDefinitions) {
        const factor=smoothingFactor(d.group==='brow'?6.5:d.group==='eye'?11:8,step);
        const value = this.manual[d.key] ?? this.incomingAUs[d.key] ?? target[d.key] ?? 0;
        this.au[d.key] += (value - this.au[d.key]) * factor;
      }
      if (this.settings.autoBlink && this.clock >= this.nextBlink) {
        this.blinkStarted = this.clock;
        this.nextBlink = this.clock + 3.5 + Math.sin(this.clock * 1.79) * 0.95;
      }
    }
    return this.snapshot();
  }
  snapshot(): FrameState {
    const t = this.clock - this.blinkStarted;
    const blink = t >= 0 && t < 0.23 ? Math.sin(Math.PI * t / 0.23) ** 2 : 0;
    const au = { ...this.au };
    if (!this.isPinned('au45Blink')&&!this.incoming) au.au45Blink = Math.max(au.au45Blink, blink);
    const generated=ausToARKit(au);const blendshapes=this.incoming?{...this.incoming}:generated;
    if(this.incoming)for(const key of Object.keys(this.manual) as FACSActionUnitKey[])for(const channel of auChannels[key]??[])blendshapes[channel]=generated[channel];
    const pose = { ...this.pose };
    if (this.action) {
      const elapsed = this.clock - this.action.start;
      if (elapsed < 1.1) {
        const wave = Math.sin(elapsed * Math.PI * 4 / 1.1) * Math.sin(Math.PI * elapsed / 1.1);
        if (this.action.name === 'nod') pose.x -= wave * 0.65;
        else pose.y += wave * 0.7;
      }
    }
    if (this.settings.idle) {
      pose.x += Math.sin(this.clock * 0.79) * 0.045;
      pose.y += Math.sin(this.clock * 0.49) * 0.06;
      pose.z += Math.sin(this.clock * 0.67) * 0.055;
    }
    // VAD also contributes subtle gaze and posture. Explicit gaze is added independently.
    return { time: this.clock, vad: { ...this.latest, dominantEmotion:this.details.dominant, current: { ...this.latest.current }, target: { ...this.latest.target }, ambient: { ...this.latest.ambient! } }, aus: au, blink, gaze: { x: clamp(this.gaze.x + au.gazeX, -1, 1), y: clamp(this.gaze.y + au.gazeY, -1, 1) }, pose: { x: clamp(pose.x + au.headY, -1, 1), y: clamp(pose.y + au.headX, -1, 1), z: clamp(pose.z + au.headZ, -1, 1) }, details:structuredClone(this.details),blendshapes,source:this.incoming?'arkit52':'emotion' };
  }
}
