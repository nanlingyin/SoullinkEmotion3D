import type { FaceEngine, VADVector } from './engine';
import type { SemanticHistory, SemanticMode, SemanticResult } from './semantic-types';

export interface SemanticClientState { busy: boolean; result: SemanticResult | null; applied: boolean; error: string | null }
export class SemanticController {
  private sequence = 0;
  private cancel: AbortController | null = null;
  private history: SemanticHistory[] = [];
  state: SemanticClientState = { busy: false, result: null, applied: false, error: null };
  constructor(private engine: FaceEngine, private onChange: (state: SemanticClientState) => void = () => {}, private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}
  private emit(patch: Partial<SemanticClientState>) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }
  cancelPending() {
    ++this.sequence; this.cancel?.abort(); this.cancel = null;
    if (this.state.busy) this.emit({ busy: false, error: null });
  }
  clearHistory() { this.cancelPending(); this.history = []; this.emit({ result: null, error: null, applied: false }); }
  async analyze(text: string, options: { mode?: SemanticMode; persona?: string; apply?: boolean } = {}): Promise<SemanticResult | null> {
    this.cancelPending();
    const id = this.sequence;
    const cancel = new AbortController(); this.cancel = cancel;
    const mode = options.mode ?? 'react';
    this.emit({ busy: true, error: null });
    try {
      const response = await this.fetcher('/api/semantic/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: cancel.signal,
        body: JSON.stringify({ text, mode, persona: options.persona, currentVAD: this.engine.snapshot().vad.target, history: this.history.slice(-4) }),
      });
      const body = await response.json();
      if (id !== this.sequence) return null;
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `分析失败（${response.status}）`);
      const result = body as SemanticResult;
      if (result.schema !== 1 || result.source !== 'jev') throw new Error('语义服务返回格式错误');
      const applied = options.apply === false ? false : this.apply(result);
      if (options.apply !== false) this.history = [...this.history, { text: text.trim(), mode, emotion: result.emotion }].slice(-4);
      this.emit({ result, applied, busy: false });
      return result;
    } catch (error) {
      if (id !== this.sequence || cancel.signal.aborted) return null;
      const message = error instanceof Error ? error.message : '语义分析失败';
      this.emit({ busy: false, error: message });
      throw error;
    } finally { if (id === this.sequence) this.cancel = null; }
  }
  private apply(result: SemanticResult) {
    let applied = false;
    if (result.kind === 'emotion' || result.kind === 'emotion_action') {
      const target: Partial<VADVector> = { valence: result.targetVAD.valence, arousal: result.targetVAD.arousal };
      if (result.dominanceKnown) target.dominance = result.targetVAD.dominance;
      applied = this.engine.applySemanticEmotion(target, result.intensity, result.emotion);
    }
    for (const action of result.actions) {
      if (action.type === 'head') this.engine.setHeadAngles(action);
      else if (action.type === 'gaze') {
        if (action.x === 0 && action.y === 0) this.engine.setGaze(0, 0);
        else if (action.degrees) this.engine.glanceDegrees(action.degrees, action.seconds, action.response);
        else this.engine.glance(action.x, action.y, action.seconds, action);
      } else this.engine.playAction(action.type, action);
      applied = true;
    }
    return applied;
  }
}
