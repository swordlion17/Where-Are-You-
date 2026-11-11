import { fillTemplate, fmtClock, fmtSpoken, parseClock } from './clock';
import { REPLY_SECONDS, START_MOOD, TIME_SCALE } from './constants';
import type { ReplyOption, RouteDef, Script } from './types';

export type ConvEvent =
  | { type: 'typing' }
  | { type: 'message'; from: 'them' | 'me'; text: string }
  | { type: 'replies'; options: string[]; seconds: number }
  | { type: 'repliesClosed' }
  | { type: 'status'; text: string };

interface Queued { text: string; replies?: string }

/**
 * The partner's side of the evening: scheduled texts, reactions to what happens
 * on the street, quick replies, promises, and mood. Pure logic, no DOM.
 */
export class Conversation {
  mood = START_MOOD;
  received = 0;
  ignored = 0;
  replied = 0;
  cakeClaim = false;

  private readonly deadline: number;
  private readonly vars: Record<string, string | number>;
  private queue: Queued[] = [];
  private typingT = 0;
  private gapT = 0.9;
  private current: Queued | null = null;
  private replyT = 0;
  private replyKey: string | null = null;
  private fired = new Set<number>();
  private reacted = new Set<string>();
  private promises: { until: number; min: number }[] = [];
  private introSent = false;
  private out: ConvEvent[] = [];

  constructor(private readonly script: Script, private readonly route: RouteDef) {
    this.deadline = parseClock(route.deadline);
    this.vars = { ...route.vars, deadline: fmtSpoken(this.deadline) };
  }

  /** Nothing typing, nothing queued. */
  get idle(): boolean { return this.queue.length === 0 && this.typingT <= 0 && this.current === null; }
  get replyOptions(): ReplyOption[] | null { return this.replyKey ? this.script.replies[this.replyKey] ?? null : null; }

  update(dt: number, clock: number, playing: boolean): ConvEvent[] {
    this.out = [];
    if (playing) {
      if (!this.introSent) { this.introSent = true; for (const t of this.route.intro) this.enqueue(t, undefined, true); }
      this.script.schedule.forEach((s, i) => {
        if (!this.fired.has(i) && clock >= this.deadline + s.at * 60) { this.fired.add(i); this.enqueue(s.text, s.replies, true); }
      });
      for (let i = this.promises.length - 1; i >= 0; i--) {
        if (clock > this.promises[i].until) {
          const p = this.promises.splice(i, 1)[0];
          this.enqueue(fillTemplate(this.script.promiseBroken, { min: p.min }), undefined, true);
          this.mood -= 10;
        }
      }
      if (clock > this.deadline) this.mood -= (dt * TIME_SCALE / 60) * 2.5;
      if (this.replyT > 0) {
        this.replyT -= dt;
        if (this.replyT <= 0) {
          this.ignored++; this.mood -= 4; this.closeReplies();
          this.out.push({ type: 'status', text: `Read ${fmtClock(clock)}` });
        }
      }
    }
    this.pump(dt);
    this.mood = Math.max(0, Math.min(100, this.mood));
    return this.out;
  }

  /** One-time reaction to something that happened on the street. */
  react(key: string): void {
    if (this.reacted.has(key) || !this.script.reactions[key]) return;
    this.reacted.add(key);
    this.enqueue(this.script.reactions[key], undefined, false);
  }

  adjustMood(delta: number): void { this.mood = Math.max(0, Math.min(100, this.mood + delta)); }

  /** Player picked reply `index`. Returns the events to show immediately. */
  choose(index: number, clock: number): ConvEvent[] {
    const opts = this.replyOptions;
    if (!opts || !opts[index]) return [];
    const o = opts[index];
    this.closeReplies();
    this.replied++;
    this.adjustMood(o.mood);
    if (o.promiseMinutes) this.promises.push({ until: clock + o.promiseMinutes * 60, min: o.promiseMinutes });
    if (o.claimsCake) this.cakeClaim = true;
    if (o.answer) { this.queue.unshift({ text: this.fill(o.answer) }); this.gapT = Math.max(this.gapT, 0.6); }
    return [{ type: 'repliesClosed' }, { type: 'message', from: 'me', text: o.text }, { type: 'status', text: 'online' }];
  }

  /** The run is over: drop pending texts and replies, then send the final lines. */
  finish(lines: string[]): ConvEvent[] {
    this.queue = [];
    this.promises = [];
    const wasOpen = this.replyKey !== null;
    this.closeReplies();
    for (const l of lines) this.queue.push({ text: l });
    this.gapT = Math.min(this.gapT, 0.2);
    return wasOpen ? [{ type: 'repliesClosed' }] : [];
  }

  /** Pending replies are dropped (e.g. when the run ends) without counting as ignored. */
  private closeReplies(): void { this.replyKey = null; this.replyT = 0; }

  private fill(text: string): string { return fillTemplate(text, this.vars); }

  private enqueue(text: string, replies: string | undefined, priority: boolean): void {
    if (!priority && this.queue.length >= 2) return;
    this.queue.push({ text: this.fill(text), replies });
  }

  private pump(dt: number): void {
    if (this.typingT > 0) {
      this.typingT -= dt;
      if (this.typingT <= 0) this.deliver();
      return;
    }
    if (this.gapT > 0) { this.gapT -= dt; return; }
    const next = this.queue.shift();
    if (next) {
      this.current = next;
      this.typingT = 0.55 + Math.min(1.0, next.text.length * 0.028);
      this.out.push({ type: 'typing' }, { type: 'status', text: 'typing…' });
    }
  }

  private deliver(): void {
    const cur = this.current!;
    this.current = null;
    this.received++;
    this.out.push({ type: 'message', from: 'them', text: cur.text }, { type: 'status', text: 'online' });
    if (cur.replies && this.script.replies[cur.replies]) {
      if (this.replyKey) { this.ignored++; this.mood -= 4; }
      this.replyKey = cur.replies;
      this.replyT = REPLY_SECONDS;
      this.out.push({ type: 'replies', options: this.script.replies[cur.replies].map(r => r.text), seconds: REPLY_SECONDS });
    }
    this.gapT = 0.45;
  }
}
