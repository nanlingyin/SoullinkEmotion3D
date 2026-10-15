import { clamp, type FACSActionUnitKey, type FACSActionUnitState } from './engine';
import { canonicalMorphName } from './model-utils';
import { directShapeChannel } from './arkit';

export type BindingKind = 'proxy' | 'direct' | 'unsupported';
export interface Binding { au: FACSActionUnitKey; targets: { names: string[]; weight: number }[]; kind: BindingKind; label: string }
export interface ModelProfile { schema: 1; name: string; bindings: Binding[] }
const vr = (suffix: string) => [`Fcl_${suffix}`, `Face.M_F00_000_Fcl_${suffix}`];
const b = (au: FACSActionUnitKey, label: string, targets: {names: string[];weight: number}[], kind: BindingKind = 'proxy'): Binding => ({au, label, targets, kind});

/** AU names follow Soullink. VRoid targets are stylized proxies, not anatomical FACS. */
export const vroidProfile: ModelProfile = { schema: 1, name: 'VRoid · Anime AU Profile', bindings: [
  b('au01InnerBrowRaiser', '内眉上提', [{names: ['browInnerUp', ...vr('BRW_Sorrow')], weight: 1}]),
  b('au02OuterBrowRaiser', '外眉上提', [{names: ['browOuterUpLeft', ...vr('BRW_Surprised')], weight: 1}]),
  b('au04BrowLowerer', '眉毛下压', [{names: ['browDownLeft', ...vr('BRW_Angry')], weight: 1}]),
  b('au05UpperLidRaiser', '睁大眼睛', [{names: ['eyeWideLeft', ...vr('EYE_Surprised')], weight: 1}]),
  b('au06CheekRaiser', '笑眼 / 脸颊上提', [{names: ['cheekSquintLeft', ...vr('EYE_Joy')], weight: 1}]),
  b('au07LidTightener', '眼睑收紧', [{names: ['eyeSquintLeft', ...vr('EYE_Angry')], weight: 1}]),
  b('au09NoseWrinkler', '鼻部皱缩', [{names: ['noseSneerLeft'], weight: 1}], 'direct'),
  b('au10UpperLipRaiser', '上唇上提', [{names: ['mouthShrugUpper'], weight: 1}], 'direct'),
  b('au12LipCornerPuller', '嘴角上扬', [{names: ['mouthSmileLeft', ...vr('MTH_Fun')], weight: 1}]),
  b('au14Dimpler', '酒窝 / 嘴角收紧', [{names: ['mouthDimpleLeft', ...vr('MTH_Joy')], weight: 0.28}]),
  b('au15LipCornerDepressor', '嘴角下垂', [{names: ['mouthFrownLeft', ...vr('MTH_Sorrow')], weight: 1}]),
  b('au17ChinRaiser', '下巴上提', [{names: ['mouthShrugLower'], weight: 1}], 'direct'),
  b('au18LipPucker', '嘟嘴', [{names: ['mouthPucker', ...vr('MTH_U')], weight: 0.8}]),
  b('au20LipStretcher', '嘴唇横向拉伸', [{names: ['mouthStretchLeft', ...vr('MTH_I')], weight: 0.65}]),
  b('au23LipTightener', '嘴唇绷紧', [{names: ['mouthPressLeft', ...vr('MTH_Angry')], weight: 1}]),
  b('au24LipPressor', '嘴唇压紧', [{names: ['mouthPressLeft', ...vr('MTH_Close')], weight: 0.8}]),
  b('au25LipsPart', '嘴唇分开', [{names: ['mouthOpen', ...vr('MTH_A')], weight: 0.45}]),
  b('au26JawDrop', '下颌张开', [{names: ['jawOpen', ...vr('MTH_A')], weight: 0.9}]),
  b('au27MouthStretch', '嘴巴大张', [{names: ['mouthOpen', ...vr('MTH_Surprised')], weight: 0.8}]),
  b('au45Blink', '双眼眨眼', [{names: ['eyeBlinkLeft', ...vr('EYE_Close')], weight: 1}], 'direct'),
] };

export interface ResolvedBinding extends Binding { resolved: {name: string;weight: number}[]; supported: boolean }
export function resolveProfile(profile: ModelProfile, available: Iterable<string>): ResolvedBinding[] {
  const names = new Set(available);
  const canonical = new Map([...names].map(name=>[canonicalMorphName(name),name]));
  return profile.bindings.map(binding => {
    const resolved: {name: string;weight: number}[] = [];
    for (const t of binding.targets) {
      const found = t.names.map(n=>names.has(n)?n:canonical.get(canonicalMorphName(n))??[...names].find(a=>directShapeChannel(n)!==null&&directShapeChannel(a)===directShapeChannel(n))).find((n):n is string=>!!n);
      if (found) {
        resolved.push({name: found, weight: t.weight});
        // ARKit asymmetric channels should be driven bilaterally for a symmetric AU.
        const right = found.endsWith('Left') ? found.replace(/Left$/, 'Right') : found.endsWith('_L')?found.replace(/_L$/,'_R'):null;
        if (right && names.has(right)) resolved.push({name: right, weight: t.weight});
      }
    }
    return { ...binding, resolved, supported: resolved.length > 0 };
  });
}
export interface ProxyOptions { contrast?: number; pinned?: ReadonlySet<FACSActionUnitKey> }
export function computeMorphWeights(aus: FACSActionUnitState, bindings: ResolvedBinding[], gains: Partial<Record<FACSActionUnitKey, number>> = {}, options: ProxyOptions = {}): Record<string, number> {
  const result: Record<string, number> = {};
  for (const binding of bindings) for (const target of binding.resolved) {
    result[target.name] = (result[target.name] ?? 0) + clamp(aus[binding.au]) * target.weight * clamp(gains[binding.au] ?? 1, 0, 3);
  }
  // VRoid proxies are whole expression shapes, so small competing shapes can cancel the main one.
  // Preserve the leading shape's amplitude, attenuate only its competitors, and leave direct channels alone.
  const contrast = clamp(options.contrast ?? 0, 0, 2);
  const pinned = options.pinned ?? new Set<FACSActionUnitKey>();
  const sharpen = (predicate: (name: string) => boolean, protectedAUs: FACSActionUnitKey[]) => {
    if (!contrast || protectedAUs.some(key => pinned.has(key))) return;
    const group = Object.keys(result).filter(predicate), peak = Math.max(0, ...group.map(key => result[key]));
    if (peak > 0) for (const key of group) result[key] *= (result[key] / peak) ** contrast;
  };
  sharpen(n => /Fcl_BRW_/.test(n), ['au01InnerBrowRaiser', 'au02OuterBrowRaiser', 'au04BrowLowerer']);
  sharpen(n => /Fcl_EYE_/.test(n) && !/Close/.test(n), ['au05UpperLidRaiser', 'au06CheekRaiser', 'au07LidTightener']);
  const mouthAUs = bindings.filter(b => /au(09|10|12|14|15|17|18|20|23|24|25|26|27)/.test(b.au)).map(b => b.au);
  if (contrast && !mouthAUs.some(key => pinned.has(key))) {
    const expression = Math.max(aus.au12LipCornerPuller, aus.au15LipCornerDepressor, aus.au18LipPucker, aus.au20LipStretcher, aus.au23LipTightener, aus.au26JawDrop, aus.au27MouthStretch);
    for (const key of Object.keys(result)) if (/Fcl_MTH_Close(?:$|[_.])/.test(key)) result[key] *= 1 - clamp(expression) * clamp(contrast / 1.5);
    sharpen(n => /Fcl_MTH_/.test(n) && !/Close/.test(n), mouthAUs);
  }
  // Competing facial channels cannot reach full intensity together.
  const normalize = (predicate: (name: string) => boolean, budget: number) => {
    const group = Object.keys(result).filter(predicate); const sum = group.reduce((s, key) => s + result[key], 0);
    if (sum > budget) for (const key of group) result[key] *= budget / sum;
  };
  normalize(n => /Fcl_BRW_/.test(n), 1);
  normalize(n => /Fcl_EYE_/.test(n) && !/Close/.test(n), 1);
  normalize(n => /Fcl_MTH_/.test(n), 1.1);
  const blink = Math.max(aus.au45Blink, 0);
  for (const key of Object.keys(result)) {
    if (/Fcl_EYE_/.test(key) && !/Close/.test(key)) result[key] *= 1 - clamp(blink);
    result[key] = clamp(result[key]);
  }
  return result;
}
export function parseProfile(data: unknown): ModelProfile {
  if (typeof data !== 'object' || data === null) throw new Error('Profile 必须是 JSON 对象。');
  const p = data as ModelProfile;
  if (p.schema !== 1 || typeof p.name !== 'string' || !Array.isArray(p.bindings) || p.bindings.length > 100) throw new Error('Profile schema 或 bindings 无效。');
  const keys = new Set(vroidProfile.bindings.map(b => b.au));
  const seen = new Set<string>();
  for (const binding of p.bindings) {
    if (!keys.has(binding.au) || seen.has(binding.au) || typeof binding.label !== 'string' || !['direct', 'proxy', 'unsupported'].includes(binding.kind) || !Array.isArray(binding.targets) || binding.targets.length > 20) throw new Error('存在无效或重复 AU 绑定。');
    seen.add(binding.au);
    for (const t of binding.targets) if (!Array.isArray(t.names) || t.names.length === 0 || t.names.length > 30 || t.names.some(n => typeof n !== 'string' || n.length > 160) || !Number.isFinite(t.weight) || t.weight < 0 || t.weight > 3) throw new Error('Morph 名称或权重无效。');
  }
  return structuredClone(p);
}
