import type { FaceEngine, FrameState, LabSettings } from './engine';
import { resolveAction, type ActionName } from './motion';

export function mountMotionUI(root: HTMLElement, engine: FaceEngine, onManual: () => void) {
  root.innerHTML = `<section class="motion-card" aria-labelledby="motion-title">
    <div class="semantic-heading"><div><span class="eyebrow">CONTINUOUS MOTION</span><h3 id="motion-title">动作与连续表情</h3></div></div>
    <label class="motion-mode-label" for="motion-mode">动作控制</label><select id="motion-mode"><option value="emotion">随情绪调整幅度与节奏</option><option value="precise">精确手动控制</option></select>
    <p class="motion-note">编辑动作数值会切换为精确控制；语义中明确指定的参数也会优先生效。</p>
    <div class="motion-fields">
      <label for="motion-amplitude">动作幅度 · %<input id="motion-amplitude" type="number" min="0" max="100" step="1" value="65"></label>
      <label for="motion-duration">头部每次时长 · 秒<input id="motion-duration" type="number" min="0.25" max="8" step="0.05" value="1.1"></label>
      <label for="motion-speed">速度 · 倍<input id="motion-speed" type="number" min="0.25" max="3" step="0.05" value="1"></label>
      <label for="motion-repetitions">重复 · 次<input id="motion-repetitions" type="number" min="1" max="6" step="1" value="1"></label>
    </div>
    <label class="sr-only" for="motion-amplitude-range">动作幅度滑块</label><input id="motion-amplitude-range" type="range" min="0" max="100" step="1" value="65">
    <div class="action-row motion-buttons"><button type="button" class="button" data-motion-preview="nod">点头</button><button type="button" class="button" data-motion-preview="shake">摇头</button><button type="button" class="button" data-motion-preview="blink">眨眼</button><button type="button" class="text-button mini" id="motion-stop">收回动作</button></div>
    <p class="motion-summary" id="motion-summary" role="status"></p><div class="motion-progress" aria-hidden="true"><i id="motion-progress"></i></div>
    <details class="motion-continuity" open><summary>表情与视线过渡</summary><div class="motion-fields">
      <label for="face-smoothing">表情过渡 · 秒<input id="face-smoothing" type="number" min="0.08" max="1.5" step="0.02" value="0.28"></label>
      <label for="gaze-response">视线过渡 · 秒<input id="gaze-response" type="number" min="0.08" max="1.5" step="0.02" value="0.22"></label>
      <label for="gaze-hold">临时视线保持 · 秒<input id="gaze-hold" type="number" min="0.2" max="10" step="0.1" value="3"></label>
    </div><p class="motion-note">过渡时间越长越柔和。表情切换保留运动速度；动作收尾和视线回归也会缓动。眨眼默认每次 0.23 秒，速度与次数同样有效。</p></details>
  </section>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const mode = el<HTMLSelectElement>('motion-mode');
  const fields: Array<[string, keyof LabSettings, number, boolean]> = [
    ['motion-amplitude', 'motionAmplitude', 100, true], ['motion-duration', 'motionDuration', 1, true],
    ['motion-speed', 'motionSpeed', 1, true], ['motion-repetitions', 'motionRepetitions', 1, true],
    ['face-smoothing', 'faceSmoothing', 1, false], ['gaze-response', 'gazeResponse', 1, false], ['gaze-hold', 'gazeHold', 1, false],
  ];
  mode.onchange = () => { onManual(); engine.configure({ emotionMotion: mode.value === 'emotion' }); render(engine.snapshot()); };
  for (const [id, key, scale, precise] of fields) {
    const input = el<HTMLInputElement>(id);
    input.oninput = () => {
      if (!input.value || !input.validity.valid) return;
      onManual(); engine.configure({ [key]: Number(input.value) / scale, ...(precise ? { emotionMotion: false } : {}) });
      render(engine.snapshot());
    };
    input.onchange = () => { input.value = String(Number(engine.settings[key]) * scale); render(engine.snapshot()); };
  }
  const amplitudeRange = el<HTMLInputElement>('motion-amplitude-range');
  amplitudeRange.oninput = () => { onManual(); engine.configure({ motionAmplitude: Number(amplitudeRange.value) / 100, emotionMotion: false }); render(engine.snapshot()); };
  root.querySelectorAll<HTMLButtonElement>('[data-motion-preview]').forEach(button => { button.onclick = () => { onManual(); engine.playAction(button.dataset.motionPreview as ActionName, { ...(engine.settings.emotionMotion ? {} : { amplitude: engine.settings.motionAmplitude }) }); render(engine.snapshot()); }; });
  el('motion-stop').onclick = () => { onManual(); engine.stopActions(); };
  function render(frame: FrameState) {
    mode.value = engine.settings.emotionMotion ? 'emotion' : 'precise';
    for (const [id, key, scale] of fields) { const input = el<HTMLInputElement>(id); if (document.activeElement !== input) input.value = String(Math.round(Number(engine.settings[key]) * scale * 1000) / 1000); }
    if (document.activeElement !== amplitudeRange) amplitudeRange.value = String(engine.settings.motionAmplitude * 100);
    const next = resolveAction('nod', {}, engine.settings, frame.vad.target);
    const head = frame.motion.actions.find(a => a.name !== 'blink');
    el('motion-summary').textContent = head ? `${head.name === 'nod' ? '点头' : '摇头'}中 · 幅度 ${Math.round(head.amplitude * 100)}% · 每次 ${head.cycleDuration.toFixed(2)} 秒 · ${head.repetitions} 次` : `下次点头 · ${engine.settings.emotionMotion ? '情绪联动' : '精确控制'} · ${Math.round(next.amplitude * 100)}% · 每次 ${next.cycleDuration.toFixed(2)} 秒`;
    el('motion-progress').style.width = `${(head?.progress ?? 0) * 100}%`;
  }
  render(engine.snapshot());
  return { render };
}
