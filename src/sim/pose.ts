import { RUN, WALK } from './constants';
import type { Vec } from './types';

export const JOINTS = ['head', 'neck', 'hip', 'elbowL', 'handL', 'elbowR', 'handR', 'kneeL', 'footL', 'kneeR', 'footR'] as const;
export type JointName = (typeof JOINTS)[number];
export type Joints = Record<JointName, Vec>;
/** Index pairs into JOINTS that keep their length in the ragdoll. */
export const STICKS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10], [0, 2]];

export interface PoseInput { x: number; y: number; speed: number; phase: number; onGround: boolean }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Procedural walk/run/jump pose with feet at (x, y), facing right. Up is negative y. */
export function standPose(p: PoseInput): Joints {
  const sp = clamp(p.speed / WALK, 0, 1);
  const run = clamp((p.speed - WALK) / (RUN - WALK), 0, 1);
  const ph = p.phase;
  const amp = (0.42 + run * 0.38) * sp;
  const air = !p.onGround;
  const bob = air ? 0 : Math.abs(Math.cos(ph)) * (1.2 + run * 2.5) * sp;
  const lean = run * 7 + (air ? 3 : 0);
  const hip = { x: p.x, y: p.y - 33 - bob };
  const neck = { x: hip.x + 2 + lean, y: hip.y - 24 };
  const head = { x: neck.x + 2 + lean * 0.25, y: neck.y - 11 };
  let aL: number, aR: number, bL: number, bR: number;
  if (air) { aL = 0.75; aR = -0.25; bL = 1.3; bR = 0.5; }
  else {
    aL = Math.sin(ph) * amp;
    aR = Math.sin(ph + Math.PI) * amp;
    bL = Math.max(0, Math.cos(ph)) * (0.5 + run * 0.7) * sp;
    bR = Math.max(0, Math.cos(ph + Math.PI)) * (0.5 + run * 0.7) * sp;
  }
  const leg = (a: number, bend: number): [Vec, Vec] => {
    const k = { x: hip.x + Math.sin(a) * 17, y: hip.y + Math.cos(a) * 17 };
    const b = a - bend;
    return [k, { x: k.x + Math.sin(b) * 17, y: k.y + Math.cos(b) * 17 }];
  };
  const [kneeL, footL] = leg(aL, bL);
  const [kneeR, footR] = leg(aR, bR);
  const sh = { x: neck.x, y: neck.y + 4 };
  return {
    head, neck, hip, kneeL, footL, kneeR, footR,
    elbowL: { x: sh.x + 7, y: sh.y + 11 }, handL: { x: sh.x + 20, y: sh.y + 9 },
    elbowR: { x: sh.x + 4, y: sh.y + 12 }, handR: { x: sh.x + 17, y: sh.y + 10 },
  };
}

/** Where the plate sits when the cake is held. */
export function handsCenter(j: Joints): Vec {
  return { x: (j.handL.x + j.handR.x) / 2 + 1, y: (j.handL.y + j.handR.y) / 2 - 3 };
}

export function lerpJoints(from: Joints, to: Joints, t: number): Joints {
  const out = {} as Joints;
  for (const k of JOINTS) out[k] = { x: from[k].x + (to[k].x - from[k].x) * t, y: from[k].y + (to[k].y - from[k].y) * t };
  return out;
}
