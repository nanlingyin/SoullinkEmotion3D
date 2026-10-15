/** Authored animation controls. Normalized amplitude is relative to the avatar rig. */
export type ActionName = 'nod' | 'shake' | 'blink';
export interface ActionOptions {
  amplitude?: number;
  /** Seconds per complete gesture, before an explicitly supplied speed multiplier. */
  duration?: number;
  speed?: number;
  repetitions?: number;
  emotion?: boolean;
}
export interface GazeOptions { amplitude?: number; response?: number; emotion?: boolean }
export interface MotionDefaults {
  emotionMotion: boolean;
  motionAmplitude: number;
  motionDuration: number;
  motionSpeed: number;
  motionRepetitions: number;
}
export interface ResolvedAction {
  name: ActionName;
  amplitude: number;
  cycleDuration: number;
  repetitions: number;
  totalDuration: number;
  emotionLinked: boolean;
}
export interface ActionState extends ResolvedAction { progress: number; value: number; velocity: number }
const bound = (n: number, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback));

/** Animation heuristics, not a claim of a universal psychological VAD-to-motion mapping. */
export function emotionMotionFactors(vad: { valence: number; arousal: number; dominance: number }) {
  const a = bound(vad.arousal, -1, 1, 0), d = bound(vad.dominance, -1, 1, 0);
  const strength = Math.min(1, Math.hypot(vad.valence, a, d) / Math.sqrt(3));
  return { amplitude: bound(1 + .3 * a + .15 * d + .1 * strength, .45, 1.55, 1), speed: bound(1 + .25 * a + .1 * d, .5, 1.5, 1) };
}

export function resolveAction(name: ActionName, options: ActionOptions, settings: MotionDefaults, vad: { valence: number; arousal: number; dominance: number }): ResolvedAction {
  if (!['nod', 'shake', 'blink'].includes(name)) throw new Error(`Unknown action: ${name}`);
  const linked = options.emotion ?? settings.emotionMotion;
  const factors = linked ? emotionMotionFactors(vad) : { amplitude: 1, speed: 1 };
  // Explicit values bypass emotional gain. An explicit duration also bypasses implicit tempo.
  const amplitude = bound(options.amplitude ?? (name === 'blink' && linked ? 1 : settings.motionAmplitude) * factors.amplitude, 0, 1, 0);
  const speed = bound(options.speed ?? (options.duration !== undefined ? 1 : settings.motionSpeed * factors.speed), .25, 3, 1);
  const duration = bound(options.duration ?? (name === 'blink' ? .23 : settings.motionDuration), name === 'blink' ? .08 : .25, 8, 1.1);
  const cycleDuration = bound(duration / speed, name === 'blink' ? .06 : .15, 12, 1.1);
  const repetitions = Math.round(bound(options.repetitions ?? settings.motionRepetitions, 1, 6, 1));
  return { name, amplitude, cycleDuration, repetitions, totalDuration: cycleDuration * repetitions, emotionLinked: linked && (options.amplitude === undefined || (options.duration === undefined && options.speed === undefined)) };
}

/** Analytic critically damped response; velocity survives changes to the target. */
export function damp(value: number, velocity: number, target: number, seconds: number, dt: number) {
  const omega = 4.75 / Math.max(.04, seconds), offset = value - target;
  const c = velocity + omega * offset, e = Math.exp(-omega * dt);
  return { value: target + (offset + c * dt) * e, velocity: (velocity - omega * c * dt) * e };
}

function ease(t: number) { return t * t * t * (10 + t * (-15 + t * 6)); }
function easeDerivative(t: number) { return 30 * t * t * (1 - t) * (1 - t); }
function wave(name: ActionName, phase: number) {
  const points = name === 'shake' ? [[0, 0], [.25, -1], [.75, 1], [1, 0]] : [[0, 0], [name === 'blink' ? .4 : .5, 1], [1, 0]];
  for (let i = 1; i < points.length; i++) {
    const [left, from] = points[i - 1], [right, to] = points[i];
    if (phase <= right) {
      const t = bound((phase - left) / (right - left), 0, 1, 0);
      return { value: from + (to - from) * ease(t), velocity: (to - from) * easeDerivative(t) / (right - left) };
    }
  }
  return { value: 0, velocity: 0 };
}
interface Clip { resolved: ResolvedAction; start: number; from: number; velocity: number; blend: number; stop?: boolean }
export class MotionTimeline {
  private clips = new Map<ActionName, Clip>();
  private sampleClip(clip: Clip, now: number) {
    const elapsed = Math.max(0, now - clip.start), { resolved } = clip;
    let value = 0, velocity = 0;
    if (!clip.stop && elapsed < resolved.totalDuration) {
      const phase = (elapsed / resolved.cycleDuration) % 1, w = wave(resolved.name, phase);
      value = w.value * resolved.amplitude;
      velocity = w.velocity * resolved.amplitude / resolved.cycleDuration;
    }
    if (elapsed < clip.blend) {
      // Hermite correction preserves both position and velocity when a clip is interrupted.
      const t = elapsed / clip.blend;
      value += (2 * t ** 3 - 3 * t ** 2 + 1) * clip.from + (t ** 3 - 2 * t ** 2 + t) * clip.blend * clip.velocity;
      velocity += (6 * t ** 2 - 6 * t) * clip.from / clip.blend + (3 * t ** 2 - 4 * t + 1) * clip.velocity;
    }
    const limited = bound(value, resolved.name === 'blink' ? 0 : -1, 1, 0);
    return { value: limited, velocity: limited === value ? velocity : 0 };
  }
  play(resolved: ResolvedAction, now: number) {
    const previous = this.clips.get(resolved.name);
    const from = previous ? this.sampleClip(previous, now) : { value: 0, velocity: 0 };
    this.clips.set(resolved.name, { resolved, start: now, from: from.value, velocity: from.velocity, blend: Math.min(.25, resolved.cycleDuration * .35) });
    return { ...resolved };
  }
  stop(now: number) {
    for (const [name, clip] of this.clips) {
      const from = this.sampleClip(clip, now);
      this.clips.set(name, { resolved: { ...clip.resolved, amplitude: 0, totalDuration: .25 }, start: now, from: from.value, velocity: from.velocity, blend: .25, stop: true });
    }
  }
  reset() { this.clips.clear(); }
  clear(name: ActionName) { this.clips.delete(name); }
  sample(now: number): ActionState[] {
    const state: ActionState[] = [];
    for (const [name, clip] of this.clips) {
      const duration = Math.max(clip.resolved.totalDuration, clip.blend);
      if (now - clip.start >= duration - 1e-9) { this.clips.delete(name); continue; }
      state.push({ ...clip.resolved, progress: bound((now - clip.start) / duration, 0, 1, 0), ...this.sampleClip(clip, now) });
    }
    return state;
  }
}
