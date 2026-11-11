import { GRAVITY } from './constants';
import { JOINTS, STICKS, type Joints } from './pose';
import type { Rng } from './rng';

export type TripKind = 'trip' | 'slip' | 'hit';
interface Pt { x: number; y: number; px: number; py: number }

const H = 1 / 120;

/** Verlet stick-figure ragdoll used for falls. The ground is y = 0. */
export class Ragdoll {
  readonly pts: Pt[];
  private readonly lens: number[];
  private acc = 0;

  constructor(start: Joints, kind: TripKind, speed: number, rng: Rng) {
    this.pts = JOINTS.map((k, i) => {
      const { x, y } = start[k];
      let vx: number, vy: number;
      if (kind === 'slip') {
        vx = speed * 0.55; vy = -220;
        if (i === 8 || i === 10) { vx += 330; vy -= 260; }
        if (i === 7 || i === 9) { vx += 200; vy -= 160; }
        if (i <= 1) vx -= 140;
      } else if (kind === 'hit') {
        vx = -150; vy = -320;
        if (i <= 1) { vx -= 140; vy -= 40; }
        if (i >= 7) vx += 60;
      } else {
        vx = speed * 0.85 + 50; vy = -170;
        if (i <= 1) { vx += 230; vy -= 60; }
        if (i >= 3 && i <= 6) vx += 120;
        if (i === 8 || i === 10) vx -= 140;
      }
      vx += (rng() - 0.5) * 40;
      vy += (rng() - 0.5) * 40;
      return { x, y, px: x - vx * H, py: y - vy * H };
    });
    this.lens = STICKS.map(([a, b]) => Math.hypot(this.pts[a].x - this.pts[b].x, this.pts[a].y - this.pts[b].y));
  }

  step(dt: number): void {
    this.acc += dt;
    while (this.acc >= H) { this.substep(); this.acc -= H; }
  }

  private substep(): void {
    const pts = this.pts;
    for (const p of pts) {
      const vx = (p.x - p.px) * 0.996, vy = (p.y - p.py) * 0.996;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + GRAVITY * H * H;
    }
    for (let it = 0; it < 6; it++) {
      for (let k = 0; k < STICKS.length; k++) {
        const A = pts[STICKS[k][0]], B = pts[STICKS[k][1]];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const diff = ((d - this.lens[k]) / d) * 0.5;
        A.x += dx * diff; A.y += dy * diff; B.x -= dx * diff; B.y -= dy * diff;
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], r = i === 0 ? 10 : 3.5;
        if (p.y > -r) {
          const vy = p.y - p.py; p.y = -r; p.py = p.y + vy * 0.3;
          const vx = p.x - p.px; p.px = p.x - vx * 0.82;
        }
      }
    }
  }

  get hipX(): number { return this.pts[2].x; }

  joints(): Joints {
    const j = {} as Joints;
    JOINTS.forEach((k, i) => { j[k] = { x: this.pts[i].x, y: this.pts[i].y }; });
    return j;
  }
}
