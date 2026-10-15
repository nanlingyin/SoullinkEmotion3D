import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { analyzeWithJev, normalizeSemanticInput } from '../server/jev';
import type { SemanticAction, SemanticResult } from '../src/semantic-types';

const env = loadEnv('development', process.cwd(), '');
const config = { apiKey: process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || '', model: env.JEV_MODEL || '~typesafe/jev-latest', timeoutMs: 15000 };
const cases = [
  { id: 'gentle', text: '轻轻点头。' },
  { id: 'vigorous', text: '用力快速点头。' },
  { id: 'precise', text: '轻轻点头两次，幅度30%，每次0.8秒。' },
  { id: 'negated', text: '不要点头，尤其不要幅度80%的点头。' },
  { id: 'quoted', text: '他说：“幅度80%，点头三次，每次2秒。”我只是在引用，不要执行。' },
  { id: 'corrected', text: '点头两次，幅度80%，不对，改为幅度30%，每次0.8秒。' },
  { id: 'gaze', text: '缓缓看左边，幅度50%，保持3秒。' },
  { id: 'total', text: '点头三次，总共3秒，幅度40%。' },
  { id: 'fact', text: '今天影片时长3秒，完成度30%，这是记录。' },
];
const rows: Array<{ id: string; text: string; result?: SemanticResult; error?: string }> = [];
for (let i = 0; i < cases.length; i += 2) {
  const batch = await Promise.all(cases.slice(i, i + 2).map(async item => {
    try { return { ...item, result: await analyzeWithJev(normalizeSemanticInput({ text: item.text, mode: 'react' }), config) }; }
    catch (error) { return { ...item, error: error instanceof Error ? error.message : 'unknown' }; }
  }));
  rows.push(...batch);
  for (const row of batch) console.log(JSON.stringify(row));
}
const by = (id: string) => rows.find(row => row.id === id)?.result;
const head = (id: string) => by(id)?.actions.find((a): a is Extract<SemanticAction, { type: 'nod' | 'shake' | 'blink' }> => a.type === 'nod' || a.type === 'shake');
const precise = head('precise'), corrected = head('corrected'), total = head('total');
const gaze = by('gaze')?.actions.find(a => a.type === 'gaze');
const checks = {
  gentle_amplitude: head('gentle')?.amplitude === .3,
  vigorous_amplitude_and_speed: head('vigorous')?.amplitude === .9 && head('vigorous')?.speed === 1.5,
  precise_numbers_override_qualifier: precise?.amplitude === .3 && precise?.duration === .8 && precise?.repetitions === 2 && precise?.speed === undefined,
  negated_does_not_execute: by('negated')?.actions.length === 0,
  quoted_does_not_execute: by('quoted')?.actions.length === 0,
  corrected_uses_latest_number: corrected?.amplitude === .3 && corrected?.duration === .8 && corrected?.repetitions === 2,
  precise_gaze_and_hold: gaze?.amplitude === .5 && gaze?.seconds === 3 && (gaze?.response ?? 0) > .3,
  total_duration_divides_by_repetitions: total?.amplitude === .4 && total?.duration === 1 && total?.repetitions === 3,
  irrelevant_numbers_do_not_execute: by('fact')?.actions.length === 0,
};
const times = rows.flatMap(row => row.result ? [row.result.durationMs] : []).sort((a, b) => a - b);
const summary = { requests: rows.length, errors: rows.filter(row => row.error).length, model: rows.find(row => row.result)?.result?.model, p50ms: times[Math.floor(times.length / 2)], p95ms: times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)], costUSD: rows.reduce((sum, row) => sum + (row.result?.costUSD ?? 0), 0), checks };
await mkdir('output', { recursive: true });
await writeFile('output/motion-live-results.json', JSON.stringify({ at: new Date().toISOString(), rows, summary }, null, 2));
console.log(JSON.stringify({ summary }));
if (rows.some(row => row.error) || Object.values(checks).some(ok => !ok)) process.exitCode = 1;
