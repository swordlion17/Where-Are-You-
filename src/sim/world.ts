import { COYOTE, DOOR_OFFSET, GRAVITY, HOLE_WIDTH, HOUSE_OFFSET, JUMP_BUFFER, JUMP_V, RUN, WALK } from './constants';
import { itemById, type ItemDef } from './items';
import { handsCenter, lerpJoints, standPose, type Joints } from './pose';
import { Ragdoll, type TripKind } from './ragdoll';
import type { Rng } from './rng';
import type { ObstacleType, RouteDef } from './types';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Obstacle {
  type: ObstacleType;
  x: number;
  hit: boolean;
  /** Moving obstacles start moving once the player is close. */
  active: boolean;
  t: number;
  x1: number;
  vx: number;
  fy: number;
  rot: number;
  spray: number;
  barkT: number;
  birds: number[];
}

export type PlayerMode = 'normal' | 'ragdoll' | 'getup' | 'hole' | 'done';

export interface Player {
  x: number; y: number; vy: number;
  onGround: boolean; coyote: number;
  speed: number; phase: number;
  mode: PlayerMode; t: number;
  tilt: number; tiltV: number;
  rag: Ragdoll | null;
  getupFrom: Joints | null;
  blockX: number;
  hole: Obstacle | null;
}

export interface FlyingCake { x: number; y: number; vx: number; vy: number; rot: number; vr: number; hp: number }

export type WorldEvent =
  | { type: 'jump' }
  | { type: 'land'; x: number; hard: boolean }
  | { type: 'fall'; cause: ObstacleType; kind: TripKind | 'hole'; x: number }
  | { type: 'cakeDamage'; amount: number; x: number; left: number }
  /** About 1% of the item sloshed out (soup). */
  | { type: 'spill'; x: number; left: number }
  | { type: 'splat'; x: number }
  | { type: 'flower'; x: number; y: number }
  | { type: 'pigeons'; xs: number[] }
  | { type: 'bark'; x: number }
  | { type: 'getup'; x: number; firstScoop: boolean }
  | { type: 'popOut'; x: number }
  | { type: 'hint'; text: string; x: number; y: number }
  | { type: 'runningLong' }
  | { type: 'arrive' };

export interface WorldInput { run: boolean; jump: boolean }

interface Box { l: number; r: number; t: number; b: number }

export class World {
  readonly finishX: number;
  readonly doorX: number;
  readonly houseX: number;
  readonly flowerTotal: number;
  readonly obstacles: Obstacle[];
  readonly holes: Obstacle[];
  readonly p: Player;
  /** What's being carried; decides falls damage and spilling. */
  readonly item: ItemDef;
  flyCake: FlyingCake | null = null;
  /** X positions of cake splats left on the sidewalk. */
  readonly decals: number[] = [];
  /** Condition of the carried item, 0-100 (named for the first item, the cake). */
  cake = 100;
  /** Total lost to spilling. */
  spilled = 0;
  private spillAcc = 0;
  falls = 0;
  flowers = 0;
  doorOpen = false;
  runTime = 0;
  private jumpBuf = 0;
  private hinted = new Set<string>();
  private scoopShown = false;
  private runReported = false;
  private ev: WorldEvent[] = [];

  constructor(readonly route: RouteDef, private readonly rng: Rng) {
    this.item = itemById(route.item);
    this.finishX = route.length;
    this.doorX = route.length + DOOR_OFFSET;
    this.houseX = route.length + HOUSE_OFFSET;
    this.obstacles = route.obstacles.map(d => ({
      type: d.type, x: d.x, hit: false, active: false, t: 0,
      x1: d.type === 'hole' ? d.x + HOLE_WIDTH : d.x,
      vx: d.type === 'dog' ? -115 : d.type === 'skater' ? -185 : 0,
      fy: d.type === 'flower' ? (d.height === 'high' ? -118 : -36) : 0,
      rot: 0, spray: 0, barkT: 0,
      birds: d.type === 'pigeons' ? [-30, -14, 2, 16, 32] : [],
    }));
    this.holes = this.obstacles.filter(o => o.type === 'hole');
    this.flowerTotal = this.obstacles.filter(o => o.type === 'flower').length;
    this.p = {
      x: 0, y: 0, vy: 0, onGround: true, coyote: 0, speed: 0, phase: 0, mode: 'normal', t: 0,
      tilt: 0, tiltV: 0, rag: null, getupFrom: null, blockX: 0, hole: null,
    };
  }

  /** Advance the simulation. `active` is false during the title and ending (no collisions or jumps). */
  step(dt: number, input: WorldInput, active: boolean): WorldEvent[] {
    this.ev = [];
    if (input.jump && active) this.jumpBuf = JUMP_BUFFER;
    if (this.jumpBuf > 0) this.jumpBuf -= dt;
    this.stepPlayer(dt, input, active);
    this.stepObstacles(dt, active);
    this.stepCake(dt);
    this.stepTilt(dt);
    if (active) {
      if (input.run && this.p.mode === 'normal') this.runTime += dt;
      if (!this.runReported && this.runTime > 4.5) { this.runReported = true; this.ev.push({ type: 'runningLong' }); }
      this.hints();
    }
    return this.ev;
  }

  /** Player's current pose for rendering. */
  pose(): Joints {
    const p = this.p;
    if (p.mode === 'ragdoll' && p.rag) return p.rag.joints();
    if (p.mode === 'getup' && p.getupFrom) return lerpJoints(p.getupFrom, standPose(p), 1 - Math.pow(1 - clamp(p.t / 0.45, 0, 1), 3));
    return standPose(p);
  }

  /** True while the cake is in the player's hands. */
  get holdingCake(): boolean {
    const p = this.p;
    return p.mode === 'normal' || p.mode === 'done' || p.mode === 'hole' || (p.mode === 'getup' && p.t > 0.38);
  }

  get dazed(): boolean {
    return this.p.mode === 'ragdoll' || this.p.mode === 'hole' || (this.p.mode === 'getup' && this.p.t < 0.22);
  }

  /** X the camera should follow. */
  get focusX(): number { return this.p.mode === 'ragdoll' && this.p.rag ? this.p.rag.hipX : this.p.x; }

  get distanceLeft(): number { return Math.max(0, this.finishX - this.p.x); }

  holeAt(x: number, pad = 8): Obstacle | null {
    for (const h of this.holes) if (x > h.x + pad && x < h.x1 - pad) return h;
    return null;
  }

  // ---------------------------------------------------------------- player

  private stepPlayer(dt: number, input: WorldInput, active: boolean): void {
    const p = this.p;
    switch (p.mode) {
      case 'normal': {
        const target = active && input.run ? RUN : WALK;
        p.speed += clamp(target - p.speed, -800 * dt, 650 * dt);
        p.x += p.speed * dt;
        p.phase += p.speed * dt * 0.062;
        if (p.onGround) p.coyote = COYOTE; else p.coyote -= dt;
        if (this.jumpBuf > 0 && p.coyote > 0 && active) {
          p.vy = -JUMP_V; p.onGround = false; p.coyote = 0; this.jumpBuf = 0;
          this.ev.push({ type: 'jump' });
        }
        if (p.onGround && this.holeAt(p.x)) { p.onGround = false; p.vy = 0; }
        if (!p.onGround) {
          p.vy += GRAVITY * dt; p.y += p.vy * dt;
          if (p.y >= 0) {
            const h = this.holeAt(p.x);
            if (h) { if (p.y > 10) this.enterHole(h); }
            else { const impact = p.vy; p.y = 0; p.vy = 0; p.onGround = true; this.land(impact); }
          }
        }
        if (active && p.mode === 'normal') this.collide();
        if (active && p.mode === 'normal' && p.x >= this.finishX) { p.mode = 'done'; this.ev.push({ type: 'arrive' }); }
        break;
      }
      case 'ragdoll': {
        const rag = p.rag!;
        rag.step(dt);
        p.t += dt;
        if (p.t > 1.3) {
          p.getupFrom = rag.joints();
          let nx = Math.max(rag.hipX, p.blockX + 16);
          const hh = this.holeAt(nx, -14);
          if (hh) nx = hh.x1 + 14;
          p.x = nx; p.y = 0; p.phase = 0; p.mode = 'getup'; p.t = 0; p.rag = null;
        }
        break;
      }
      case 'getup': {
        p.t += dt;
        if (p.t >= 0.45) {
          p.mode = 'normal'; p.t = 0; p.getupFrom = null;
          const first = !this.scoopShown && this.cake > 0;
          if (first) this.scoopShown = true;
          this.ev.push({ type: 'getup', x: p.x, firstScoop: first });
        }
        break;
      }
      case 'hole': {
        const h = p.hole!;
        p.t += dt; p.vy += GRAVITY * dt; p.y = Math.min(p.y + p.vy * dt, 160);
        p.x = clamp(p.x + 40 * dt, h.x + 14, h.x1 - 14);
        if (p.t > 1.5) {
          p.mode = 'normal'; p.x = h.x1 + 14; p.y = -2; p.vy = -520; p.onGround = false; p.hole = null;
          this.ev.push({ type: 'popOut', x: p.x });
        }
        break;
      }
      case 'done': {
        const tx = this.doorX - 30;
        if (p.x < tx) {
          p.speed = lerp(p.speed, WALK * 0.8, Math.min(1, dt * 4));
          p.x = Math.min(tx, p.x + p.speed * dt);
          p.phase += p.speed * dt * 0.062;
        } else p.speed = Math.max(0, p.speed - 600 * dt);
        if (!p.onGround) {
          p.vy += GRAVITY * dt; p.y += p.vy * dt;
          if (p.y >= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
        }
        break;
      }
    }
  }

  private stepTilt(dt: number): void {
    const p = this.p;
    if (p.mode !== 'normal' && p.mode !== 'done') { p.tilt = lerp(p.tilt, 0, Math.min(1, dt * 8)); p.tiltV = 0; return; }
    const running = p.speed > WALK + 20;
    p.tiltV += (-60 * p.tilt - 7 * p.tiltV) * dt;
    if (p.onGround && p.speed > 1) p.tiltV += (this.rng() - 0.5) * (running ? 90 : 25) * dt;
    p.tilt = clamp(p.tilt + p.tiltV * dt, -0.5, 0.5);
    if (p.mode === 'normal') this.spill(dt);
  }

  /** Soup and the like: wobble past the item's limit pours some out. */
  private spill(dt: number): void {
    const { spill, spillTilt } = this.item;
    const over = Math.abs(this.p.tilt) - spillTilt;
    if (spill <= 0 || over <= 0 || this.cake <= 0) return;
    const lost = Math.min(this.cake, over * spill * dt);
    this.cake -= lost; this.spilled += lost; this.spillAcc += lost;
    while (this.spillAcc >= 1) { this.spillAcc -= 1; this.ev.push({ type: 'spill', x: this.p.x, left: this.cake }); }
  }

  private land(impact: number): void {
    const p = this.p;
    const hard = impact > 500 && p.speed > WALK + 40;
    if (hard) this.cake = Math.max(0, this.cake - this.item.damage.hardLanding);
    p.tiltV += (this.rng() < 0.5 ? -1 : 1) * impact / 260;
    this.ev.push({ type: 'land', x: p.x, hard });
  }

  private enterHole(h: Obstacle): void {
    const p = this.p;
    p.mode = 'hole'; p.t = 0; p.hole = h; p.speed = 0;
    this.falls++;
    this.ev.push({ type: 'fall', cause: 'hole', kind: 'hole', x: p.x });
    this.damageCake(this.item.damage.hole);
  }

  // ---------------------------------------------------------------- collisions

  private box(o: Obstacle): Box | null {
    switch (o.type) {
      case 'cone': return { l: o.x - 9, r: o.x + 9, t: -27, b: 0 };
      case 'hydrant': return { l: o.x - 10, r: o.x + 10, t: -35, b: 0 };
      // Narrower than the drawn puddle (72 wide, tapered ends): a well-timed jump clears it even at walking speed.
      case 'puddle': return { l: o.x - 26, r: o.x + 26, t: -3, b: 2 };
      case 'banana': return { l: o.x - 8, r: o.x + 8, t: -4, b: 2 };
      case 'dog': return { l: o.x - 20, r: o.x + 18, t: -26, b: 0 };
      case 'skater': return { l: o.x - 12, r: o.x + 12, t: -62, b: 0 };
      case 'pigeons': return { l: o.x - 42, r: o.x + 42, t: -20, b: 0 };
      case 'flower': return { l: o.x - 13, r: o.x + 13, t: o.fy - 14, b: o.fy + 14 };
      default: return null;
    }
  }

  private collide(): void {
    const p = this.p;
    const pl = p.x - 10, pr = p.x + 12, pt = p.y - 66, pb = p.y;
    for (const o of this.obstacles) {
      if (o.hit || o.x < p.x - 200 || o.x > p.x + 200) continue;
      const b = this.box(o);
      if (!b) continue;
      if (pr > b.l && pl < b.r && pb > b.t && pt < b.b) {
        this.hit(o, b);
        if (p.mode !== 'normal') return;
      }
    }
  }

  private hit(o: Obstacle, b: Box): void {
    o.hit = true;
    switch (o.type) {
      case 'flower':
        this.flowers++;
        this.ev.push({ type: 'flower', x: o.x, y: o.fy });
        break;
      case 'pigeons':
        this.ev.push({ type: 'pigeons', xs: o.birds.map(dx => o.x + dx) });
        this.damageCake(this.item.damage.pigeons);
        this.p.tiltV += 3;
        break;
      case 'puddle': case 'banana': this.trip('slip', o, b); break;
      case 'cone': case 'hydrant':
        if (o.type === 'hydrant') o.spray = 1.4;
        this.trip('trip', o, b);
        break;
      case 'dog': case 'skater': this.trip('hit', o, b); break;
      case 'hole': break;
    }
  }

  private trip(kind: TripKind, o: Obstacle, b: Box): void {
    const p = this.p;
    this.falls++;
    const j = standPose(p);
    const hands = handsCenter(j);
    this.flyCake = {
      x: hands.x, y: hands.y,
      vx: kind === 'slip' ? p.speed * 0.35 + 30 : kind === 'hit' ? -40 : p.speed + 100,
      vy: kind === 'slip' ? -560 : kind === 'hit' ? -380 : -260,
      rot: p.tilt, vr: kind === 'hit' ? -10 : 11, hp: this.cake,
    };
    p.rag = new Ragdoll(j, kind, p.speed, this.rng);
    p.mode = 'ragdoll'; p.t = 0; p.blockX = b.r; p.speed = 0; p.vy = 0; p.onGround = true; p.y = 0;
    this.ev.push({ type: 'fall', cause: o.type, kind, x: p.x });
    this.damageCake(this.item.damage[kind]);
  }

  private damageCake(n: number): void {
    const before = this.cake;
    this.cake = Math.max(0, this.cake - n);
    if (before > 0) this.ev.push({ type: 'cakeDamage', amount: Math.round(before - this.cake), x: this.p.x, left: this.cake });
  }

  // ---------------------------------------------------------------- obstacles & cake

  private stepObstacles(dt: number, active: boolean): void {
    const p = this.p;
    for (const o of this.obstacles) {
      if (o.type === 'dog' || o.type === 'skater') {
        if (!o.active && active && p.x > o.x - (o.type === 'dog' ? 600 : 700)) o.active = true;
        if (o.active) {
          o.x += o.vx * dt; o.t += dt;
          if (o.type === 'dog' && o.x > p.x && !o.hit) {
            o.barkT -= dt;
            if (o.barkT <= 0) { o.barkT = 1.1; this.ev.push({ type: 'bark', x: o.x }); }
          }
        }
      }
      if (o.spray > 0) o.spray -= dt;
      if (o.type === 'cone' && o.hit) o.rot = lerp(o.rot, 1.45, Math.min(1, dt * 10));
    }
  }

  private stepCake(dt: number): void {
    const c = this.flyCake;
    if (!c) return;
    c.vy += GRAVITY * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    if (c.y >= -3 && c.vy > 0) {
      this.decals.push(c.x);
      this.ev.push({ type: 'splat', x: c.x });
      this.flyCake = null;
    }
  }

  private hints(): void {
    const p = this.p;
    for (const o of this.obstacles) {
      if (this.hinted.has(o.type)) continue;
      const d = o.x - p.x;
      if (d <= 0) continue;
      if (o.type === 'puddle' && d < 330) { this.hinted.add('puddle'); this.ev.push({ type: 'hint', text: 'tap JUMP', x: o.x, y: -60 }); }
      else if (o.type === 'hole' && d < 430) { this.hinted.add('hole'); this.ev.push({ type: 'hint', text: 'RUN, then JUMP', x: o.x + 46, y: -76 }); }
      else if (o.type === 'flower' && d < 300) { this.hinted.add('flower'); this.ev.push({ type: 'hint', text: 'grab the flowers', x: o.x, y: o.fy - 26 }); }
    }
  }
}
