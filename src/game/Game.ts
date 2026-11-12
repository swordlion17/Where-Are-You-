import { sfx, unlockAudio } from '../audio/sfx';
import { PLAY_URL } from '../config';
import { routeById, scriptById } from '../data';
import { analytics } from '../platform/analytics';
import { buzz, shareText } from '../platform/device';
import { load, save } from '../platform/storage';
import { fmtClock, parseClock } from '../sim/clock';
import { TIME_SCALE } from '../sim/constants';
import { Conversation, type ConvEvent } from '../sim/conversation';
import { mulberry32 } from '../sim/rng';
import { scoreRun, type Result } from '../sim/scoring';
import type { Relation, RouteDef, Script } from '../sim/types';
import { World, type WorldEvent } from '../sim/world';
import type { Controls } from '../ui/controls';
import type { Hud } from '../ui/hud';
import type { Phone } from '../ui/phone';
import type { BestRun, EndScreen, StartChoice, StartScreen } from '../ui/screens';
import { renderShareCard, type CardMessage } from '../ui/shareCard';

export type FxEvent = WorldEvent | { type: 'float'; text: string; x: number; y: number; color: string; size: number; life: number };
type State = 'title' | 'play' | 'ending' | 'over';

export interface Ui { phone: Phone; hud: Hud; controls: Controls; start: StartScreen; end: EndScreen }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const DUSK = parseClock('7:44');
const DEFAULT_FACES = ['🥰', '🙂', '😐', '🙃', '😶'];
const COLORS = { cream: '#fff6ef', pink: '#ff9ec4', amber: '#ffc857', rose: '#ff6b8f', blush: '#ffd6e7' };

/**
 * Owns one run: world + conversation + clock, and the state machine around them
 * (title → play → ending → over). The Phaser scene calls update() every frame.
 */
export class Game {
  state: State = 'title';
  route: RouteDef;
  world!: World;
  convo!: Conversation;
  clock = 0;
  partnerName = 'Sam';
  relation: Relation = 'girlfriend';
  /** The partner's personality: who texts, and how. */
  script: Script = scriptById(undefined);
  readonly reducedMotion: boolean;
  private ui: Ui | null = null;
  private fx: FxEvent[] = [];
  private seed = (Date.now() & 0xffff) | 1;
  private endT = 0;
  private knocked = false;
  private opened = false;
  private endWait = 0;
  private result: Result | null = null;
  /** Runs started this visit, and when the current one started (for play stats). */
  private attempt = 0;
  private runStartedAt = 0;
  /** The run's texts, for the share card. */
  private chat: CardMessage[] = [];
  /** Share card for the finished run, rendered as soon as the end screen shows. */
  private card: Promise<File | null> | null = null;
  private pictureUrl: string | null = null;

  constructor(routeId: string) {
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.route = routeById(routeId);
    this.newRun();
  }

  attach(ui: Ui): void { this.ui = ui; }

  /** 0 at dusk, 1 once it's fully dark. */
  get night(): number { return clamp((this.clock - DUSK) / (26 * 60), 0, 1); }

  drainFx(): FxEvent[] { const f = this.fx; this.fx = []; return f; }

  /** Title backdrop shows the selected route, standing still. */
  preview(routeId: string): void {
    if (this.state !== 'title' && this.state !== 'over') return;
    this.route = routeById(routeId);
    this.newRun();
  }

  start(c: StartChoice): void {
    const ui = this.ui!;
    unlockAudio();
    this.partnerName = c.name;
    this.relation = c.relation;
    this.script = scriptById(c.personality);
    this.route = routeById(c.routeId);
    this.newRun();
    this.state = 'play';
    ui.phone.clear();
    ui.phone.setContact(this.partnerName);
    ui.start.hide();
    ui.end.hide();
    ui.controls.setEnabled(true);
    this.float('hold RUN to hurry →', 70, -120, COLORS.amber, 18, 2.8);
    this.attempt++;
    this.runStartedAt = performance.now();
    analytics.track('run_started', {
      route: this.route.id, relation: this.relation, personality: this.script.id, attempt: this.attempt,
      // Whether the options were opened and the name changed from the default; never the name itself.
      customized: c.customized ?? false, own_name: c.name !== 'Sam',
    });
  }

  /** Call when the page is going away: a run still in progress counts as quit. */
  leaving(): void {
    if (this.state !== 'play') return;
    const w = this.world;
    analytics.track('run_quit', {
      route: this.route.id, attempt: this.attempt, seconds: this.runSeconds(),
      progress: Math.round((w.p.x / w.finishX) * 100) / 100, falls: w.falls, cake: Math.round(w.cake),
    });
  }

  private runSeconds(): number { return Math.round((performance.now() - this.runStartedAt) / 100) / 10; }

  toMenu(): void {
    this.state = 'title';
    this.ui!.end.hide();
    this.ui!.start.show(true);
    this.preview(this.route.id);
  }

  update(dt: number): void {
    const ui = this.ui;
    if (!ui) return;
    const playing = this.state === 'play';
    if (this.state !== 'title') {
      if (playing) this.clock += dt * TIME_SCALE;
      const input = playing ? { run: ui.controls.run, jump: ui.controls.consumeJump() } : { run: false, jump: false };
      for (const e of this.world.step(dt, input, playing)) this.onWorld(e);
    }
    if (playing || this.state === 'ending') for (const e of this.convo.update(dt, this.clock, playing)) this.showConv(e);
    if (this.state === 'ending') this.stepEnding(dt);
    ui.controls.sync();
    this.renderHud();
  }

  /**
   * Shares the result: the picture plus text where the device can, otherwise the text. `manual` is
   * set when nothing worked (the end screen shows the text to copy); `picture` is a link to save the
   * image where it couldn't be shared directly (desktop browsers).
   */
  async share(): Promise<{ note: string; manual?: string; picture?: string }> {
    const r = this.result;
    if (!r) return { note: '' };
    const lines = [
      `Where Are You? 🏠 ${this.route.title}`,
      `Home at ${r.arrival} (${r.lateText})`,
      `🎂 cake ${r.cake}% · 💥 ${this.world.falls} falls · 🌹 ${this.world.flowers}/${this.world.flowerTotal}`,
      `My ${this.script.adjective} ${this.relation} ${this.partnerName}: "${r.line}"`,
      `Rank: ${r.rank}`,
    ];
    if (PLAY_URL) lines.push(`Play: ${PLAY_URL}`);
    const text = lines.join('\n');
    const file = (await this.card) ?? undefined;
    const out = await shareText('Where Are You?', text, file);
    analytics.track('share_tapped', { route: this.route.id, rank: r.rank, outcome: out });
    if (out === 'image' || out === 'shared') return { note: '' };
    if (file && !this.pictureUrl) this.pictureUrl = URL.createObjectURL(file);
    const picture = this.pictureUrl ?? undefined;
    if (out === 'copied') return { note: 'Copied. Paste it in the group chat.', picture };
    return { note: "Couldn't open sharing here. Copy this instead:", manual: text, picture };
  }

  // ------------------------------------------------------------------ internals

  private newRun(): void {
    this.world = new World(this.route, mulberry32(this.seed++));
    this.convo = new Conversation(this.script, this.route);
    this.clock = parseClock(this.route.start);
    this.fx = [];
    this.result = null;
    this.endT = 0; this.knocked = false; this.opened = false; this.endWait = 0;
    this.chat = [];
    this.card = null;
    if (this.pictureUrl) { URL.revokeObjectURL(this.pictureUrl); this.pictureUrl = null; }
  }

  private float(text: string, x: number, y: number, color: string, size = 16, life = 1.4): void {
    this.fx.push({ type: 'float', text, x, y, color, size, life });
  }

  private onWorld(e: WorldEvent): void {
    this.fx.push(e);
    const w = this.world;
    switch (e.type) {
      case 'jump': sfx.jump(); break;
      case 'land': sfx.land(); break;
      case 'fall':
        sfx.fall(); buzz('heavy');
        this.convo.adjustMood(-2);
        this.convo.react(e.cause);
        if (w.falls === 3) this.convo.react('fall3');
        if (w.falls === 5) this.convo.react('fall5');
        break;
      case 'cakeDamage':
        this.float(`-${e.amount}% cake`, e.x + 6, -92, COLORS.pink, 15, 1.3);
        if (e.left === 0) this.float('the cake is gone', e.x + 6, -118, COLORS.amber, 16, 1.8);
        break;
      case 'splat': sfx.splat(); buzz('medium'); break;
      case 'flower': sfx.flower(); this.float('+1 flower', e.x, e.y - 20, COLORS.pink, 15, 1.1); break;
      case 'pigeons': sfx.coo(); this.convo.react('pigeons'); break;
      case 'bark': sfx.bark(); this.float('woof', e.x - 22, -40, COLORS.cream, 13, 0.9); break;
      case 'getup': if (e.firstScoop) this.float('*scoops the cake back on the plate*', e.x + 20, -100, COLORS.blush, 13, 1.9); break;
      case 'popOut': this.float('boing', e.x, -60, COLORS.amber, 15, 1); break;
      case 'hint': this.float(e.text, e.x, e.y, COLORS.amber, 19, 2.4); break;
      case 'runningLong': this.convo.react('run'); break;
      case 'arrive': this.arrive(); break;
    }
  }

  private showConv(e: ConvEvent): void {
    if (e.type === 'message') this.chat.push({ from: e.from, text: e.text });
    if (e.type === 'message' && e.from === 'them') { sfx.ping(); buzz('light'); }
    this.ui!.phone.apply(e, i => this.pick(i));
  }

  private pick(i: number): void {
    if (this.state !== 'play') return;
    analytics.track('reply_tapped', { route: this.route.id, reply: this.convo.openReplies, option: i });
    sfx.send();
    for (const e of this.convo.choose(i, this.clock)) this.showConv(e);
  }

  private arrive(): void {
    this.state = 'ending';
    this.ui!.controls.setEnabled(false);
    this.result = scoreRun({
      mood: this.convo.mood, cake: this.world.cake, flowers: this.world.flowers,
      arrivedAt: this.clock, cakeClaim: this.convo.cakeClaim,
    }, this.route, this.script);
    for (const e of this.convo.finish([])) this.showConv(e);
  }

  private stepEnding(dt: number): void {
    const w = this.world, r = this.result!;
    this.endT += dt;
    if (!this.knocked && this.endT > 0.9) { this.knocked = true; sfx.knock(); this.float('knock knock', w.doorX, -100, COLORS.amber, 17, 1.4); }
    if (!this.opened && this.endT > 1.7) {
      this.opened = true;
      w.doorOpen = true;
      sfx.door();
      for (const e of this.convo.finish(r.lines)) this.showConv(e);
      this.float('♥', w.doorX + 4, -100, COLORS.rose, 28, 2.2);
    }
    if (this.opened && this.state === 'ending' && this.convo.idle) {
      this.endWait += dt;
      if (this.endWait > 1.6) this.showEnd();
    }
  }

  private showEnd(): void {
    const r = this.result!, w = this.world;
    this.state = 'over';
    const key = `best.${this.route.id}`;
    const best = load<BestRun | null>(key, null);
    if (!best || r.score > best.score) save(key, { rank: r.rank, arrival: r.arrival, score: r.score });
    analytics.track('run_finished', {
      route: this.route.id, attempt: this.attempt, seconds: this.runSeconds(),
      rank: r.rank, score: Math.round(r.score),
      late_minutes: Math.round(((this.clock - parseClock(this.route.deadline)) / 60) * 10) / 10,
      cake: r.cake, falls: w.falls, flowers: w.flowers,
      replied: this.convo.replied, left_on_read: this.convo.ignored,
    });
    this.card = renderShareCard({
      name: this.partnerName, relation: `${this.script.adjective} ${this.relation}`, route: this.route.title, arrival: r.arrival, lateText: r.lateText,
      rank: r.rank, messages: this.chat.slice(-8), cake: r.cake, falls: w.falls, flowers: `${w.flowers}/${w.flowerTotal}`,
      ignored: this.convo.ignored, url: PLAY_URL,
    }).then(b => new File([b], 'where-are-you.png', { type: 'image/png' })).catch(() => null);
    this.ui!.end.show({
      arrival: r.arrival, lateText: r.lateText, rank: r.rank, line: r.line,
      from: `${this.partnerName}, your ${this.script.adjective} ${this.relation}`,
      cake: r.cake, falls: w.falls, flowers: `${w.flowers}/${w.flowerTotal}`, ignored: this.convo.ignored,
    });
  }

  private renderHud(): void {
    const ui = this.ui!, w = this.world;
    const deadline = parseClock(this.route.deadline);
    ui.phone.setClock(fmtClock(this.clock), this.clock > deadline);
    ui.phone.setBattery(Math.max(1, 23 - Math.floor(((this.clock - parseClock(this.route.start)) / 60) * 0.7)));
    const m = this.convo.mood;
    const faces = this.script.faces ?? DEFAULT_FACES;
    ui.phone.setMood(faces[m >= 85 ? 0 : m >= 65 ? 1 : m >= 45 ? 2 : m >= 25 ? 3 : 4]);
    ui.hud.set(Math.round(w.cake), w.flowers, w.flowerTotal, Math.ceil(w.distanceLeft / 20));
  }
}
