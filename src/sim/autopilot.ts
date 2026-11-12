import type { ObstacleType } from './types';
import type { Obstacle, World } from './world';

/** Obstacles you can walk through (flowers are collected, pigeons just scatter). */
const NO_JUMP: ObstacleType[] = ['flower', 'pigeons'];

export interface AutopilotOptions {
  /** Walk into these instead of jumping them. */
  ignore?: (o: Obstacle) => boolean;
  /** Also jump for flowers hanging too high to grab on foot. */
  flowers?: boolean;
}

/**
 * A competent player: jumps each obstacle at the last good moment. Used by the tests (every route
 * must be finishable on time) and by the clip recorder.
 */
export function shouldJump(w: World, opts: AutopilotOptions = {}): boolean {
  const p = w.p;
  if (p.mode !== 'normal' || !p.onGround) return false;
  for (const o of w.obstacles) {
    if (o.hit || opts.ignore?.(o)) continue;
    const closing = p.speed - o.vx;
    if (o.type === 'flower') {
      if (!opts.flowers || o.fy > -80) continue;
      const tc = (o.x - p.x) / Math.max(1, closing);
      if (tc > 0.12 && tc < 0.3) return true; // reach the top of the jump as the flower passes
      continue;
    }
    if (NO_JUMP.includes(o.type)) continue;
    const front = o.type === 'hole' ? o.x + 4 : o.x - 22;
    const gap = front - (p.x + 12);
    if (gap < -4) continue;
    const tc = gap / Math.max(1, closing);
    if (o.type === 'hole' ? tc < 0.06 : tc < 0.16) return true;
  }
  return false;
}
