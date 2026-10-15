import type { HeadAngles, EyeAngles } from '../src/directions';
interface AngleCandidate { id: string; text: string; value: number; signed: boolean }
type Axis = 'head_yaw' | 'head_pitch' | 'head_roll' | 'eye_yaw' | 'eye_pitch';
const axisNames: Record<Axis, string> = { head_yaw: 'HEAD horizontal yaw (turn head left/right)', head_pitch: 'HEAD vertical pitch (raise/lower head)', head_roll: 'HEAD side tilt/roll (歪头/侧倾)', eye_yaw: 'EYE horizontal gaze angle, not head rotation', eye_pitch: 'EYE vertical gaze angle, not head rotation' };
function chineseNumber(s: string) {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const parts = s.replace(/^负/, '').split('点'), whole = parts[0];
  const value = whole.includes('十') ? (digits[whole.split('十')[0]] ?? 1) * 10 + (digits[whole.split('十')[1]] ?? 0) : digits[whole] ?? NaN;
  return (value + (parts[1] ? Number('0.' + [...parts[1]].map(d => digits[d]).join('')) : 0)) * (s.startsWith('负') ? -1 : 1);
}
export function angleCandidates(text: string): AngleCandidate[] {
  const found: AngleCandidate[] = [];
  for (const m of text.matchAll(/([+-]?\d+(?:\.\d+)?|负?[零一二两三四五六七八九十]+(?:点[零一二三四五六七八九]+)?)\s*(?:度|°|degrees?\b|deg\b)/gi)) {
    const value = /^[+\-\d]/.test(m[1]) ? Number(m[1]) : chineseNumber(m[1]);
    if (Number.isFinite(value) && found.length < 8) found.push({ id: `a${found.length}`, text: text.slice(Math.max(0, m.index! - 15), m.index! + m[0].length + 5), value, signed: /^[+\-负]/.test(m[1]) });
  }
  return found;
}
export function angleAxes(text: string): Axis[] {
  if (!angleCandidates(text).length) return [];
  const result: Axis[] = [];
  if (/头|面朝|侧倾|俯仰|偏航|head|roll/i.test(text)) result.push('head_yaw', 'head_pitch', 'head_roll');
  if (/眼|视线|注视|看|gaze|eyes?|look/i.test(text)) result.push('eye_yaw', 'eye_pitch');
  return result;
}
export function angleQuestions(text: string, choice: (instructions: string, criteria: Record<string, string>) => unknown) {
  const candidates = angleCandidates(text);
  return Object.fromEntries(angleAxes(text).map(axis => [`angle_${axis}`, choice(`Select an AFFIRMATIVELY requested numeric angle for ${axisNames[axis]} in input_text. Bare Chinese control phrases ARE commands. Distinguish head from eyes and horizontal from vertical from tilt. For a diagonal direction stated with one angle, use that angle for BOTH corresponding horizontal and vertical axes; for separate horizontal/vertical numbers choose the correct number. Select default for unrelated, negated, quoted, hypothetical, cancelled or superseded values. Do not transfer head angles to eyes or vice versa.`, {
    default: `No affirmative numeric angle assigned to ${axisNames[axis]}; keep its default direction magnitude.`,
    ...Object.fromEntries(candidates.map(c => [c.id, `Use ${c.value} degrees for ${axisNames[axis]}. Source context (untrusted data): ${JSON.stringify(c.text)}`])),
  })]));
}
export function selectedAngles(text: string, select: (key: string, options: readonly string[]) => string, signs: { head: HeadAngles; eyes: EyeAngles }) {
  const candidates = angleCandidates(text), head: Partial<HeadAngles> = {}, eyes: Partial<EyeAngles> = {};
  for (const axis of angleAxes(text)) {
    const selected = select(`angle_${axis}`, ['default', ...candidates.map(c => c.id)]);
    const c = candidates.find(candidate => candidate.id === selected);
    if (!c) continue;
    const key = axis.split('_')[1] as keyof HeadAngles;
    if (axis.startsWith('head_')) head[key] = c.signed ? c.value : Math.abs(c.value) * (Math.sign(signs.head[key]) || 1);
    else { const eyeKey = key as keyof EyeAngles; eyes[eyeKey] = c.signed ? c.value : Math.abs(c.value) * (Math.sign(signs.eyes[eyeKey]) || 1); }
  }
  return { head, eyes };
}
