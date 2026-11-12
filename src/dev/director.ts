import type Phaser from 'phaser';
import type { Game } from '../game/Game';
import { shouldJump } from '../sim/autopilot';
import { parseClock } from '../sim/clock';
import type { Obstacle, World } from '../sim/world';
import { CLIPS, type ClipPlan, type Segment } from './clips';

/**
 * Plays a scripted clip one video frame at a time, so a slow screenshot loop still produces smooth,
 * exact footage. Phaser's own loop is put to sleep; each frame steps the game twice at 60 Hz and moves
 * every CSS animation to the matching time. Inputs go through the real controls (keyboard events,
 * taps on reply buttons), so the buttons light up as they would for a player. Dev only.
 */
export const FPS = 30;
const SUBSTEPS = 2;
const STEP_MS = 1000 / (FPS * SUBSTEPS);
const REPLY_DELAY_MS = 1000; // the "thumb" taps a reply this long after it appears
const JUMP_HOLD_STEPS = 5;    // keep JUMP pressed ~80 ms so the button visibly lights up
const FREEZE_AFTER = 0.35;    // seconds of motion before a freeze-frame tail stops, so the last bubble finishes popping in
const MAX_SECONDS = 60;

// Private parts of Game, World and the scene that only this tool touches.
interface GameGuts { seed: number }
interface WorldGuts { hinted: Set<string> }
interface SceneGuts { snapCamera(): void }

const win = window as unknown as { __game: Game; __phaser: Phaser.Game };

export function clipNames(): string[] { return Object.keys(CLIPS); }

export function createDirector(name: string): Director {
  const plan = CLIPS[name];
  if (!plan) throw new Error(`No clip named "${name}". Clips: ${clipNames().join(', ')}`);
  return new Director(plan);
}

export class Director {
  done = false;
  private readonly game = win.__game;
  private readonly phaser = win.__phaser;
  private readonly deadline: number;
  private readonly origX = new Map<Obstacle, number>();
  private readonly animStart = new WeakMap<Animation, number>();
  private vt = 0; // animation clock, ms: video time plus off-camera time
  private recorded = 0; // seconds of actual footage
  private ptime = performance.now();
  private seg = -1;
  private segT = 0;
  private tailLeft: number | null = null;
  private hitSet = new Set<Obstacle>();
  private running = false;
  private jumpHeld = 0;
  private replySeen: number | null = null;
  private card: { el: HTMLElement; t: number } | null = null;

  constructor(private readonly plan: ClipPlan) {
    this.phaser.loop.sleep();
    // Instant button states: CSS transitions would be caught half-way in single frames.
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(style);
    (this.game as unknown as GameGuts).seed = plan.seed ?? 7;
    this.game.start({ name: plan.name ?? 'Sam', relation: plan.relation ?? 'girlfriend', routeId: plan.route, personality: plan.personality ?? 'classic' });
    // No tutorial hints ("tap JUMP", ...): they clutter the shot.
    for (const k of ['puddle', 'hole', 'flower']) (this.world as unknown as WorldGuts).hinted.add(k);
    for (const o of this.world.obstacles) this.origX.set(o, o.x);
    this.deadline = parseClock(this.game.route.deadline);

    this.game.clock = this.deadline + plan.warm.from * 60;
    this.offCamera(plan.warm.seconds);
    this.nextSegment();
  }

  private get world(): World { return this.game.world; }
  private get segment(): Segment { return this.plan.segments[this.seg]; }

  /** Advance one video frame. The caller screenshots after each call. */
  frame(): { done: boolean; t: number } {
    if (this.done) return { done: true, t: this.recorded };
    const s = this.segment;
    const frozen = s.freeze && this.tailLeft !== null && (s.tail ?? 0) - this.tailLeft > FREEZE_AFTER;
    if (!frozen) {
      for (let i = 0; i < SUBSTEPS; i++) this.substep(s);
      this.vt += 1000 / FPS;
      this.syncAnimations();
    }
    this.recorded += 1 / FPS;
    this.segT += 1 / FPS;
    this.updateCard();

    if (this.tailLeft === null && this.reached(s)) this.tailLeft = s.tail ?? 0;
    if (this.tailLeft !== null) {
      this.tailLeft -= 1 / FPS;
      if (this.tailLeft <= 0) this.nextSegment();
    }
    if (this.recorded > MAX_SECONDS) this.done = true;
    return { done: this.done, t: this.recorded };
  }

  // ------------------------------------------------------------------ segments

  private nextSegment(): void {
    this.seg++;
    if (this.seg >= this.plan.segments.length) { this.done = true; return; }
    const s = this.segment;
    if (s.skip) this.offCamera(s.skip);
    const w = this.world;
    if (s.set) {
      if (s.set.clock !== undefined) this.game.clock = this.deadline + s.set.clock * 60;
      if (s.set.x !== undefined) this.teleport(s.set.x < 0 ? w.finishX + s.set.x : s.set.x);
      if (s.set.cake !== undefined) w.cake = s.set.cake;
      if (s.set.mood !== undefined) this.game.convo.mood = s.set.mood;
    }
    this.hitSet = new Set([...this.origX].filter(([, x]) => s.hit?.includes(x)).map(([o]) => o));
    if (s.card) this.showCard(s.card);
    this.segT = 0;
    this.tailLeft = null;
    this.replySeen = null;
  }

  private reached(s: Segment): boolean {
    if (s.until === 'over') return this.game.state === 'over';
    if ('text' in s.until) {
      const text = s.until.text;
      return [...document.querySelectorAll('#msgs .bub')].some(b => b.textContent?.includes(text));
    }
    return this.segT >= s.until.seconds;
  }

  /** Let time pass without filming: obstacles moved away and the player kept in place. */
  private offCamera(seconds: number): void {
    const w = this.world;
    const saved = w.obstacles.map(o => [o.x, o.x1] as const);
    for (const o of w.obstacles) { o.x = -1e6; o.x1 = -1e6 + 10; }
    const pinX = w.p.x;
    this.key('keyup', 'ShiftLeft'); this.running = false;
    const steps = Math.round((seconds * 1000) / STEP_MS);
    for (let i = 0; i < steps; i++) {
      w.p.x = pinX;
      this.step();
      if (i % SUBSTEPS === 1) { this.vt += 1000 / FPS; this.syncAnimations(); }
    }
    w.obstacles.forEach((o, i) => { o.x = saved[i][0]; o.x1 = saved[i][1]; });
  }

  private teleport(x: number): void {
    const p = this.world.p;
    Object.assign(p, { x, y: 0, vy: 0, onGround: true, mode: 'normal', rag: null, getupFrom: null, hole: null, tilt: 0, tiltV: 0 });
    (this.phaser.scene.getScene('street') as unknown as SceneGuts).snapCamera();
  }

  // ------------------------------------------------------------------ input + stepping

  private substep(s: Segment): void {
    if (this.game.state === 'play') {
      const run = s.run ?? true;
      if (run !== this.running) { this.key(run ? 'keydown' : 'keyup', 'ShiftLeft'); this.running = run; }
      if (this.jumpHeld > 0) { if (--this.jumpHeld === 0) this.key('keyup', 'Space'); }
      else if (shouldJump(this.world, { ignore: o => this.hitSet.has(o), flowers: s.flowers })) { this.key('keydown', 'Space'); this.jumpHeld = JUMP_HOLD_STEPS; }
      this.tapReply(s);
    }
    this.step();
  }

  private step(): void {
    this.ptime += STEP_MS;
    this.phaser.step(this.ptime, STEP_MS);
  }

  private tapReply(s: Segment): void {
    const key = this.game.convo.openReplies;
    const buttons = document.querySelectorAll<HTMLButtonElement>('#replies button');
    if (!key || buttons.length === 0) { this.replySeen = null; return; }
    this.replySeen ??= this.vt;
    const choice = s.replies?.[key];
    if (choice !== undefined && this.vt - this.replySeen >= REPLY_DELAY_MS) {
      buttons[choice]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      this.replySeen = null;
    }
  }

  private key(type: 'keydown' | 'keyup', code: string): void {
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : 'Shift', bubbles: true }));
  }

  // ------------------------------------------------------------------ CSS time + captions

  /** Pause every CSS animation and set it to video time, so bubbles pop at the right speed. */
  private syncAnimations(): void {
    for (const a of document.getAnimations()) {
      let start = this.animStart.get(a);
      if (start === undefined) { start = this.vt; this.animStart.set(a, start); a.pause(); }
      a.currentTime = this.vt - start;
    }
  }

  private showCard(text: string): void {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'absolute', inset: '0', zIndex: '50', display: 'grid', placeItems: 'center', padding: '0 24px',
      background: 'rgba(26, 20, 51, 0.88)', color: '#fff6ef', textAlign: 'center',
      font: '800 40px/1.05 "Bricolage Grotesque", system-ui, sans-serif', letterSpacing: '-0.02em',
    });
    document.getElementById('app')?.append(el);
    this.card = { el, t: 0 };
  }

  private updateCard(): void {
    if (!this.card) return;
    this.card.t += 1 / FPS;
    const a = this.card.t < 1.2 ? 1 : 1 - (this.card.t - 1.2) / 0.3;
    if (a <= 0) { this.card.el.remove(); this.card = null; return; }
    this.card.el.style.opacity = String(a);
  }
}
