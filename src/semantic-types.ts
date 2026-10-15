import type { VADVector } from './engine';
import type { ActionOptions, GazeOptions } from './motion';
import type { HeadAngles, EyeAngles } from './directions';

export type SemanticMode = 'react' | 'perform';
export type SemanticKind = 'none' | 'emotion' | 'action' | 'emotion_action';
export type SemanticAction = ({ type: 'nod' | 'shake' | 'blink' } & ActionOptions) | ({ type: 'head' } & Partial<HeadAngles>) | ({ type: 'gaze'; x: number; y: number; seconds?: number; degrees?: EyeAngles } & GazeOptions);
export interface SemanticHistory { text: string; mode: SemanticMode; emotion: string }
export interface SemanticInput {
  text: string;
  mode: SemanticMode;
  currentVAD: VADVector;
  persona?: string;
  history?: SemanticHistory[];
}
export interface SemanticResult {
  schema: 1;
  source: 'jev';
  kind: SemanticKind;
  mode: SemanticMode;
  emotion: string;
  targetVAD: VADVector;
  intensity: number;
  confidence: { overall: number; kind: number; valence: number; arousal: number; dominance: number };
  dominanceKnown: boolean;
  actions: SemanticAction[];
  model: string;
  durationMs: number;
  costUSD?: number;
}
export interface SemanticStatus { configured: boolean; provider: string; model: string }
