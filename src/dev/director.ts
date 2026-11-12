import type Phaser from 'phaser';
import { Ambience, type AmbienceState } from '../audio/ambience';
import { setSoundRecorder, type SoundEvent } from '../audio/sfx';
import { createMix, voices, type Mix } from '../audio/voices';
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

/** A sound the game made, at its time in the footage. */
type LoggedSound = SoundEvent & { t: number };

export class Director {
  done = false;
  /** Every sound and ambience update while filming, for the soundtrack. */
  private readonly sounds: LoggedSound[] = [];
  private filming = false;
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
    setSoundRecorder(e => { if (this.filming) this.sounds.push({ ...e, t: this.recorded }); });
    this.offCamera(plan.warm.seconds);
    this.nextSegment();
    this.filming = true;
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
  /**
   * Renders what the game played while filming into a WAV (base64), with the same synth the game
   * uses live. Called once, after the last frame.
   */
  async soundtrack(): Promise<string> {
    setSoundRecorder(null);
    const sr = 44100, seconds = this.recorded + 0.5;
    const off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    const { mix } = createMix(off, off.destination);
    const amb = new Ambience(mix);
    let lastAmbience = -1;
    for (const e of this.sounds) {
      const t = e.t + 0.02;
      if ('ambience' in e) { if (e.t !== lastAmbience) { amb.update(t, e.ambience as AmbienceState); lastAmbience = e.t; } }
      else (voices[e.voice] as (m: Mix, t: number, ...a: unknown[]) => void)(mix, t, ...e.args);
    }
    return wavBase64(await off.startRendering());
  }

  private offCamera(seconds: number): void {
    const wasFilming = this.filming;
    this.filming = false;
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
    this.filming = wasFilming;
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

/** 16-bit stereo PCM WAV, base64 (to hand back to the recorder script). */
function wavBase64(buf: AudioBuffer): string {
  const n = buf.length, sr = buf.sampleRate, ch = [buf.getChannelData(0), buf.getChannelData(Math.min(1, buf.numberOfChannels - 1))];
  const v = new DataView(new ArrayBuffer(44 + n * 4));
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) v.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
  const bytes = new Uint8Array(v.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
