import type { FaceEngine, FrameState } from './engine';
import { directionGrid, headLimits, eyeLimits, type HeadAngles, type EyeAngles, type Direction } from './directions';
import type { RigCapabilities } from './face-rig';

export function mountDirectionUI(root: HTMLElement, engine: FaceEngine, onManual: () => void) {
  const grid = (kind: string) => directionGrid.map(d => `<button type="button" data-${kind}-direction="${d.name}" aria-label="${kind === 'head' ? '头部' : '眼睛'}${d.label}" title="角色${d.label}"><span>${d.arrow}</span><small>${d.label}</small></button>`).join('');
  const fields = (kind: string, limits: HeadAngles | EyeAngles) => Object.entries(limits).map(([key, limit]) => `<div class="angle-control"><label for="${kind}-${key}-degrees">${key === 'yaw' ? '左右 · 左为正' : key === 'pitch' ? '上下 · 上为正' : '侧倾 · 左为正'}</label><div class="degree-number"><input id="${kind}-${key}-degrees" type="number" min="${-limit}" max="${limit}" step="0.1" value="0"><span>°</span></div><input id="${kind}-${key}-slider" type="range" min="${-limit}" max="${limit}" step="0.1" value="0" aria-label="${kind === 'head' ? '头部' : '眼睛'}${key}角度滑块"></div>`).join('');
  root.innerHTML = `<p class="direction-intro">方向按角色自身左右；正面观看时，与你的左右相反。角度连续过渡，数值精确到 0.1°。</p>
    <section class="direction-card" aria-labelledby="head-direction-title"><div class="semantic-heading"><div><span class="eyebrow">HEAD · 9 DIRECTIONS</span><h3 id="head-direction-title">九宫格转头</h3></div><button id="head-release" type="button" class="text-button mini">交回情绪</button></div>
      <div class="direction-picker"><div class="direction-grid" id="head-direction-grid">${grid('head')}</div><label class="direction-step" for="head-direction-degrees">方向幅度<input id="head-direction-degrees" type="number" min="0" max="40" step="0.1" value="20"><span>度 / 每轴</span><small>斜向同时转动水平与垂直轴。</small></label></div>
      <div class="angle-fields">${fields('head', headLimits)}</div><p class="angle-live" id="head-angle-live" role="status"></p><p class="direction-note">精确控制时抑制情绪与闲置姿态偏移；点头、摇头仍可单独触发。</p>
    </section>
    <section class="direction-card" aria-labelledby="eye-direction-title"><div class="semantic-heading"><div><span class="eyebrow">EYES · 8 DIRECTIONS</span><h3 id="eye-direction-title">八向注视</h3></div><button id="eyes-release" type="button" class="text-button mini">交回情绪</button></div>
      <p class="rig-status" id="eye-rig-status" role="status">等待模型绑定…</p><div class="direction-picker"><div class="direction-grid" id="eye-direction-grid">${grid('eyes')}</div><label class="direction-step" for="eyes-direction-degrees">方向幅度<input id="eyes-direction-degrees" type="number" min="0" max="25" step="0.1" value="15"><span>度 / 每轴</span><small>眼球独立转动，头部保持原姿态。</small></label></div>
      <div class="angle-fields">${fields('eyes', eyeLimits)}</div><p class="angle-live" id="eye-angle-live" role="status"></p><p class="direction-note">点击方向后保持目标，回正或交回情绪可解除。大角度效果取决于模型眼球与眼睑造型。</p>
    </section>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  function target(kind: 'head' | 'eyes') { const a = engine.snapshot().angles; return kind === 'head' ? a.headTarget : a.eyeTarget; }
  for (const kind of ['head', 'eyes'] as const) {
    root.querySelectorAll<HTMLButtonElement>(`[data-${kind}-direction]`).forEach(button => {
      button.onclick = () => {
        const input = el<HTMLInputElement>(`${kind}-direction-degrees`);
        if (!input.value || !input.validity.valid) { input.reportValidity(); return; }
        onManual(); const direction = button.getAttribute(`data-${kind}-direction`) as Direction;
        if (kind === 'head') engine.headDirection(direction, Number(input.value)); else engine.gazeDirection(direction, Number(input.value));
        render(engine.snapshot());
      };
    });
    const limits = kind === 'head' ? headLimits : eyeLimits;
    for (const key of Object.keys(limits)) for (const suffix of ['degrees', 'slider']) {
      const input = el<HTMLInputElement>(`${kind}-${key}-${suffix}`);
      input.oninput = () => {
        if (!input.value || !input.validity.valid) return;
        onManual(); if (kind === 'head') engine.setHeadAngles({ [key]: Number(input.value) }); else engine.setGazeDegrees({ [key]: Number(input.value) });
        render(engine.snapshot());
      };
      input.onchange = () => { input.value = String(target(kind)[key as keyof EyeAngles]); render(engine.snapshot()); };
    }
  }
  el('head-release').onclick = () => { onManual(); engine.releaseHeadControl(); };
  el('eyes-release').onclick = () => { onManual(); engine.releaseGazeControl(); };
  function setCapabilities(capability: RigCapabilities) {
    for (const kind of ['head', 'eyes'] as const) {
      const enabled = kind === 'head' ? capability.head : capability.eyeControl !== 'unavailable';
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(`[id^="${kind}-"] input, input[id^="${kind}-"], [data-${kind}-direction], #${kind}-release`).forEach(control => control.disabled = !enabled);
    }
    el('eye-rig-status').textContent = capability.eyeControl === 'bone-degrees' ? '双眼骨骼已连接 · 角度直接驱动眼球' : capability.eyeControl === 'expression-approximation' ? '当前模型使用视线表情代理，度数为近似目标' : '当前模型缺少可用眼球绑定，无法驱动视线';
  }
  function render(frame: FrameState) {
    for (const kind of ['head', 'eyes'] as const) {
      const values = kind === 'head' ? frame.angles.headTarget : frame.angles.eyeTarget;
      for (const [key, value] of Object.entries(values)) for (const suffix of ['degrees', 'slider']) { const input = el<HTMLInputElement>(`${kind}-${key}-${suffix}`); if (document.activeElement !== input) input.value = String(Math.round(value * 10) / 10); }
      const current = kind === 'head' ? frame.angles.head : frame.angles.eyes;
      el(kind === 'head' ? 'head-angle-live' : 'eye-angle-live').textContent = `当前角度 · 水平 ${current.yaw.toFixed(1)}° · 垂直 ${current.pitch.toFixed(1)}°${kind === 'head' ? ` · 侧倾 ${(current as HeadAngles).roll.toFixed(1)}°` : ''}`;
    }
  }
  render(engine.snapshot());
  return { render, setCapabilities };
}
