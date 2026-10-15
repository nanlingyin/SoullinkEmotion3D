import type { FaceEngine } from './engine';
import { emotionByName } from './emotions';
import { SemanticController } from './semantic-client';
import type { SemanticMode, SemanticResult, SemanticStatus } from './semantic-types';

export function mountSemanticUI(root: HTMLElement, engine: FaceEngine, onApplied: (result: SemanticResult) => void) {
  root.innerHTML = `<section class="semantic-card" aria-labelledby="semantic-title">
    <div class="semantic-heading"><div><span class="eyebrow">TEXT TO EMOTION · JEV</span><h3 id="semantic-title">让一句话，改变情绪。</h3></div><span class="semantic-status" id="semantic-status">连接中</span></div>
    <label class="sr-only" for="semantic-text">输入对话或表演指令</label>
    <textarea id="semantic-text" maxlength="1200" rows="3" placeholder="试试：你开心地笑一下，再点点头。"></textarea>
    <div class="semantic-toolbar"><label for="semantic-mode" class="sr-only">语义模式</label><select id="semantic-mode"><option value="react">角色回应</option><option value="perform">按文本表演</option></select><button class="button primary" id="semantic-send" type="button">分析并触发 ↗</button><button class="text-button mini" id="semantic-cancel" type="button" hidden>取消</button></div>
    <p class="semantic-hint" id="semantic-mode-note">根据你说的话作出回应；显式表演指令优先。Ctrl / ⌘ + Enter 发送。</p>
    <div class="semantic-examples" aria-label="语义示例"><button type="button" data-text="你开心地笑一下，再点点头。">微笑＋点头</button><button type="button" data-text="用很自信、从容的表情看着我。">自信从容</button><button type="button" data-text="害羞一点，有点不好意思地微笑。">害羞微笑</button><button type="button" data-text="看左边。">看左边</button><button type="button" data-text="轻轻点头两次，幅度30%，每次0.8秒。">精确点头</button><button type="button" data-text="头部向左转25度，眼睛向右看10度。">头眼分离</button></div>
    <details class="semantic-persona"><summary>角色设定与上下文</summary><label for="semantic-persona">角色回应时的性格</label><textarea id="semantic-persona" rows="2" maxlength="600">温和、有自主性、表达克制自然；会关切对方，也会因直接赞美而略微害羞。</textarea><p>保留最近 4 次输入；左右以角色自身为准。</p><button id="semantic-clear" type="button" class="text-button mini">清空语义上下文</button></details>
    <div class="semantic-feedback" id="semantic-feedback" role="status" aria-live="polite">输入文本后，JEV 会分别判断情绪、V/A/D 和动作。</div>
    <div class="semantic-result" id="semantic-result" hidden><div class="semantic-result-title"><strong id="semantic-emotion"></strong><span id="semantic-time"></span></div><div class="semantic-numbers"><span>V <b id="semantic-v">—</b></span><span>A <b id="semantic-a">—</b></span><span>D <b id="semantic-d">—</b></span></div><div class="semantic-metrics"><span id="semantic-impact"></span><span id="semantic-confidence"></span></div><p id="semantic-axis-note"></p><details><summary>查看分析结果</summary><pre id="semantic-json"></pre></details></div>
  </section>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const input = el<HTMLTextAreaElement>('semantic-text'), mode = el<HTMLSelectElement>('semantic-mode'), persona = el<HTMLTextAreaElement>('semantic-persona');
  const send = el<HTMLButtonElement>('semantic-send');
  const feedback = el('semantic-feedback');
  let available = false;
  let shown: SemanticResult | null = null;
  const kinds = { none: '保持当前表现', emotion: '情绪变化', action: '动作指令', emotion_action: '情绪＋动作' };
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
  const controller = new SemanticController(engine, state => {
    send.disabled = !available;
    send.textContent = state.busy ? '重新分析 ↗' : '分析并触发 ↗';
    el('semantic-cancel').hidden = !state.busy;
    root.setAttribute('aria-busy', String(state.busy));
    feedback.classList.toggle('error', Boolean(state.error));
    feedback.textContent = state.error || (state.busy ? '正在分析语义…角色继续自然动作。' : state.result ? state.applied ? `${kinds[state.result.kind]}已接入；沿用保持与自然衰减。` : state.result.kind === 'none' ? '这句话不触发新的情绪或动作；当前状态继续自然衰减。' : '分析完成，未推动模型。' : '输入文本后，JEV 会分别判断情绪、V/A/D 和动作。');
    el('semantic-result').hidden = !state.result;
    if (state.result && shown !== state.result) {
      shown = state.result;
      const result = state.result;
      el('semantic-emotion').textContent = `${emotionByName.get(result.emotion)?.label ?? result.emotion} · ${kinds[result.kind]}`;
      el('semantic-time').textContent = `${result.durationMs} ms`;
      for (const [id, key] of [['v', 'valence'], ['a', 'arousal'], ['d', 'dominance']] as const) el(`semantic-${id}`).textContent = signed(result.targetVAD[key]);
      el('semantic-impact').textContent = `影响强度 ${Math.round(result.intensity * 100)}%`;
      el('semantic-confidence').textContent = `操作判断置信度 ${Math.round(result.confidence.kind * 100)}%`;
      el('semantic-axis-note').textContent = result.dominanceKnown ? 'D 有语义依据；以上为语义目标，实际 VAD 按影响强度平滑接近。' : 'D 缺少明确依据，本次保留当前支配度。';
      el('semantic-json').textContent = JSON.stringify(result, null, 2);
      if (state.applied) onApplied(result);
    }
  });
  async function submit() {
    if (!input.value.trim()) { feedback.textContent = '先输入一句话。'; input.focus(); return; }
    if (!available) { feedback.textContent = 'JEV 本机服务尚未就绪，请检查启动终端。'; return; }
    try { await controller.analyze(input.value, { mode: mode.value as SemanticMode, persona: persona.value }); } catch { /* Controller displays the error without disturbing the avatar. */ }
  }
  send.onclick = () => { void submit(); };
  input.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void submit(); } };
  input.oninput = () => controller.cancelPending();
  el('semantic-cancel').onclick = () => { controller.cancelPending(); feedback.textContent = '已取消分析，当前表现继续运行。'; };
  el('semantic-clear').onclick = () => { controller.clearHistory(); shown = null; feedback.textContent = '语义上下文已清空，当前表情保持。'; };
  mode.onchange = () => { controller.clearHistory(); shown = null; el('semantic-mode-note').textContent = mode.value === 'react' ? '根据你说的话作出回应；显式表演指令优先。Ctrl / ⌘ + Enter 发送。' : '将文本当作角色台词或表演描述；仍会处理否定与引用。'; };
  persona.onchange = () => { controller.clearHistory(); shown = null; };
  root.querySelectorAll<HTMLButtonElement>('[data-text]').forEach(button => { button.onclick = () => { input.value = button.dataset.text!; void submit(); }; });
  fetch('/api/semantic/status').then(async response => {
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('本机语义服务未启动');
    return await response.json() as SemanticStatus;
  }).then(status => {
    available = status.configured;
    el('semantic-status').textContent = available ? '已连接' : '待配置';
    el('semantic-status').classList.toggle('connected', available);
    el('semantic-status').title = `${status.provider} · ${status.model}`;
    send.disabled = !available;
    if (!available) feedback.textContent = '在 .env.local 配置 OPENROUTER_API_KEY 后重启本机服务。';
  }).catch(() => { send.disabled = true; el('semantic-status').textContent = '未连接'; feedback.textContent = '请通过 npm run dev 或 npm run preview 启动本机语义服务。'; });
  send.disabled = true;
  return controller;
}
