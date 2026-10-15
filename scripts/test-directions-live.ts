import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { analyzeWithJev, normalizeSemanticInput } from '../server/jev';
import type { SemanticAction, SemanticResult } from '../src/semantic-types';
const env = loadEnv('development', process.cwd(), '');
const config = { apiKey: process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || '', model: env.JEV_MODEL || '~typesafe/jev-latest', timeoutMs: 15000 };
const cases = [
  { id: 'head_left', text: '向左转头20度。' },
  { id: 'head_diagonal', text: '向右下方转头，每轴15度。' },
  { id: 'eyes_up_right', text: '只让眼睛看向右上方，每轴12度，头部保持不动。' },
  { id: 'eyes_down_left', text: '眼睛看向左下方，各10度。' },
  { id: 'independent', text: '头部向左转25度，眼睛向右看10度。' },
  { id: 'head_three_angles', text: '头部向左转20度，同时向上抬头10度，向右侧倾5度。' },
  { id: 'eye_two_angles', text: '眼睛向左上方看，水平15度，垂直8度。' },
  { id: 'negated', text: '不要向左转头30度，也不要眼睛看右上方15度。' },
  { id: 'quoted', text: '他说：“向左转头30度，眼睛看右上方15度。”只作引用，不执行。' },
  { id: 'chinese_number', text: '抬头十五度。' },
  { id: 'correction', text: '眼睛向右看20度，不对，改为向左看12度。' },
];
const rows: Array<{ id: string; text: string; result?: SemanticResult; error?: string }> = [];
for (let i = 0; i < cases.length; i += 2) {
  const batch = await Promise.all(cases.slice(i, i + 2).map(async c => {
    try { return { ...c, result: await analyzeWithJev(normalizeSemanticInput({ text: c.text, mode: 'react' }), config) }; }
    catch (e) { return { ...c, error: e instanceof Error ? e.message : 'unknown' }; }
  })); rows.push(...batch); for (const row of batch) console.log(JSON.stringify(row));
}
const by = (id: string) => rows.find(r => r.id === id)?.result;
const head = (id: string) => by(id)?.actions.find((a): a is Extract<SemanticAction, { type: 'head' }> => a.type === 'head');
const eyes = (id: string) => by(id)?.actions.find((a): a is Extract<SemanticAction, { type: 'gaze' }> => a.type === 'gaze');
const checks = {
  head_left_degrees: head('head_left')?.yaw === 20 && !eyes('head_left') && !by('head_left')?.actions.some(a => a.type === 'nod'),
  head_diagonal: head('head_diagonal')?.yaw === -15 && head('head_diagonal')?.pitch === -15,
  eyes_up_right_without_head: eyes('eyes_up_right')?.degrees?.yaw === -12 && eyes('eyes_up_right')?.degrees?.pitch === 12 && !head('eyes_up_right'),
  eyes_down_left: eyes('eyes_down_left')?.degrees?.yaw === 10 && eyes('eyes_down_left')?.degrees?.pitch === -10,
  independent_head_and_eyes: head('independent')?.yaw === 25 && eyes('independent')?.degrees?.yaw === -10,
  head_three_angles: head('head_three_angles')?.yaw === 20 && head('head_three_angles')?.pitch === 10 && head('head_three_angles')?.roll === -5,
  eye_two_angles: eyes('eye_two_angles')?.degrees?.yaw === 15 && eyes('eye_two_angles')?.degrees?.pitch === 8,
  negated_does_not_execute: by('negated')?.actions.length === 0,
  quoted_does_not_execute: by('quoted')?.actions.length === 0,
  chinese_number: head('chinese_number')?.pitch === 15,
  latest_correction: eyes('correction')?.degrees?.yaw === 12,
};
const summary = { requests: rows.length, errors: rows.filter(r => r.error).length, model: rows.find(r => r.result)?.result?.model, checks };
await mkdir('output', { recursive: true }); await writeFile('output/directions-live-results.json', JSON.stringify({ at: new Date().toISOString(), rows, summary }, null, 2));
console.log(JSON.stringify({ summary })); if (summary.errors || Object.values(checks).some(ok => !ok)) process.exitCode = 1;
