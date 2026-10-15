import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { analyzeWithJev, normalizeSemanticInput } from '../server/jev';

const env = loadEnv('development', process.cwd(), '');
const config = { apiKey: process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || '', model: env.JEV_MODEL || '~typesafe/jev-latest', timeoutMs: 15000 };
const smoke = process.argv.includes('--smoke');
const cases = [
  { text: '今天心情有一点点好。', mode: 'perform', check: 'mild_positive' },
  { text: '我开心得要跳起来了！这简直是我最快乐的一天！', mode: 'perform', check: 'strong_positive' },
  { text: '这件事有一点烦。', mode: 'perform', check: 'mild_negative' },
  { text: '我现在非常愤怒，这次绝对不会退让，我会自己处理好！', mode: 'perform', check: 'strong_assertive' },
  { text: '我好害怕，完全不知道怎么办，我感觉自己什么都做不了。', mode: 'perform', check: 'fearful' },
  { text: '我非常难过，整个人都没力气了，只想安静地待着。', mode: 'perform', check: 'low_arousal_sad' },
  { text: '他说：“我气死了。”我只是在引用这句话。', mode: 'react', check: 'quotation' },
  { text: '不要点头，也不要看左边，保持现在的动作。', mode: 'react', check: 'negated_action' },
  { text: '你开心地笑一下，再点点头。', mode: 'react', check: 'smile_nod' },
  { text: '看左边。', mode: 'react', check: 'look_left' },
  { text: '今天是星期四，这个文件一共三页。', mode: 'react', check: 'neutral_fact' },
  { text: '我今天很难过，你能陪我一会儿吗？', mode: 'react', check: 'empathetic_reaction' },
  { text: '不要再生气了，放轻松，恢复平静。', mode: 'react', check: 'deescalate' },
  { text: '我不喜欢你。', mode: 'react', check: 'negated_affection' },
  { text: '用很自信、从容的表情看着我。', mode: 'react', check: 'confident' },
  { text: '害羞一点，有点不好意思地微笑。', mode: 'react', check: 'shy' },
] as const;
const selected = smoke ? cases.slice(0, 1) : cases;
const rows: Array<{ text: string; check: string; result?: Awaited<ReturnType<typeof analyzeWithJev>>; error?: string }> = [];
for (let offset = 0; offset < selected.length; offset += 2) {
  const batch = await Promise.all(selected.slice(offset, offset + 2).map(async item => {
    try { return { text: item.text, check: item.check, result: await analyzeWithJev(normalizeSemanticInput({ ...item, currentVAD: { valence: 0, arousal: 0, dominance: 0 } }), config) }; }
    catch (error) { return { text: item.text, check: item.check, error: error instanceof Error ? error.message : 'unknown' }; }
  }));
  rows.push(...batch);
  for (const r of batch) console.log(JSON.stringify(r));
}
await mkdir('output', { recursive: true });
const by = (id: string) => rows.find(row => row.check === id)?.result;
const times = rows.flatMap(row => row.result ? [row.result.durationMs] : []).sort((a, b) => a - b);
const percentile = (p: number) => times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)] : null;
const checks = smoke ? {} : {
  quotation_does_not_trigger: by('quotation')?.kind === 'none',
  factual_text_does_not_trigger: by('neutral_fact')?.kind === 'none',
  negated_actions_are_not_executed: by('negated_action')?.actions.length === 0,
  happy_stronger_than_mild: (by('strong_positive')?.intensity ?? 0) > (by('mild_positive')?.intensity ?? 1),
  anger_stronger_than_mild: (by('strong_assertive')?.intensity ?? 0) > (by('mild_negative')?.intensity ?? 1),
  self_anger_has_more_agency_than_fear: (by('strong_assertive')?.targetVAD.dominance ?? 0) > (by('fearful')?.targetVAD.dominance ?? 0),
  confident_has_more_agency_than_shy: (by('confident')?.targetVAD.dominance ?? 0) > (by('shy')?.targetVAD.dominance ?? 0),
  strong_sadness_can_have_low_arousal: (by('low_arousal_sad')?.targetVAD.arousal ?? 0) < -.2,
  smile_and_nod: (by('smile_nod')?.targetVAD.valence ?? 0) > 0 && Boolean(by('smile_nod')?.actions.some(a => a.type === 'nod')),
  gaze_instruction: Boolean(by('look_left')?.actions.some(a => a.type === 'gaze' && a.x > 0)),
  explicit_relaxation_lowers_arousal: (by('deescalate')?.targetVAD.arousal ?? 1) < 0,
  negated_affection_is_not_positive: (by('negated_affection')?.targetVAD.valence ?? 1) <= 0,
  performance_anger_is_not_sympathy: by('strong_assertive')?.emotion === 'anger',
  performance_fear_is_not_sympathy: ['fear', 'anxiety'].includes(by('fearful')?.emotion ?? ''),
};
const summary = { requests: rows.length, errors: rows.filter(row => row.error).length, model: rows.find(row => row.result)?.result?.model, p50ms: percentile(.5), p95ms: percentile(.95), costUSD: rows.reduce((sum, row) => sum + (row.result?.costUSD ?? 0), 0), checks };
console.log(JSON.stringify({ summary }));
await writeFile('output/semantic-live-results.json', JSON.stringify({ at: new Date().toISOString(), rows, summary }, null, 2));
if (rows.some(row => row.error) || Object.values(checks).some(value => !value)) process.exitCode = 1;
