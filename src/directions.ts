export interface HeadAngles { yaw: number; pitch: number; roll: number }
export interface EyeAngles { yaw: number; pitch: number }
export const headLimits: HeadAngles = { yaw: 60, pitch: 40, roll: 45 };
export const eyeLimits: EyeAngles = { yaw: 30, pitch: 25 };
export const legacyHeadScale = { pitch: .25 * 180 / Math.PI, yaw: .32 * 180 / Math.PI, roll: .21 * 180 / Math.PI };
export const directionGrid = [
  { name: 'up-left', label: '左上', arrow: '↖', x: 1, y: 1 }, { name: 'up', label: '上', arrow: '↑', x: 0, y: 1 }, { name: 'up-right', label: '右上', arrow: '↗', x: -1, y: 1 },
  { name: 'left', label: '左', arrow: '←', x: 1, y: 0 }, { name: 'center', label: '回正', arrow: '•', x: 0, y: 0 }, { name: 'right', label: '右', arrow: '→', x: -1, y: 0 },
  { name: 'down-left', label: '左下', arrow: '↙', x: 1, y: -1 }, { name: 'down', label: '下', arrow: '↓', x: 0, y: -1 }, { name: 'down-right', label: '右下', arrow: '↘', x: -1, y: -1 },
] as const;
export type Direction = typeof directionGrid[number]['name'];
export function directionAngles(direction: Direction, degrees: number): EyeAngles {
  const entry = directionGrid.find(d => d.name === direction);
  if (!entry) throw new Error(`Unknown direction: ${direction}`);
  if (!Number.isFinite(degrees) || degrees < 0) throw new Error('方向角度必须是非负有限数值');
  return { yaw: entry.x * degrees, pitch: entry.y * degrees };
}
export function poseToDegrees(pose: { x: number; y: number; z: number }): HeadAngles {
  return { yaw: pose.y * legacyHeadScale.yaw || 0, pitch: pose.x * legacyHeadScale.pitch || 0, roll: -pose.z * legacyHeadScale.roll || 0 };
}
export function gazeToDegrees(gaze: { x: number; y: number }): EyeAngles { return { yaw: gaze.x * eyeLimits.yaw, pitch: gaze.y * eyeLimits.pitch }; }
