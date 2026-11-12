import { Ambience, type AmbienceState } from './ambience';
import { createMix, voices, type FallKind, type Mix, type VoiceName } from './voices';

/** Live audio: one AudioContext, created on the first tap (browsers require a gesture). */
let ctx: AudioContext | null = null;
let mix: Mix | null = null;
let master: GainNode | null = null;
let ambience: Ambience | null = null;
let muted = false;
let lastDrip = 0;

type VoiceArgs<N extends VoiceName> = Parameters<(typeof voices)[N]> extends [Mix, number, ...infer R] ? R : never;

/** Dev hook (clip recording): sees every sound and ambience update, so clips can get a soundtrack. */
export type SoundEvent = { voice: VoiceName; args: unknown[] } | { ambience: AmbienceState };
let recorder: ((e: SoundEvent) => void) | null = null;
export function setSoundRecorder(fn: ((e: SoundEvent) => void) | null): void { recorder = fn; }

export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx && Ctor) {
      ctx = new Ctor();
      ({ mix, master } = createMix(ctx, ctx.destination));
      master.gain.value = muted ? 0 : 1;
      ambience = new Ambience(mix);
      // Silence (and save battery) while the tab or app is in the background.
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) void ctx.suspend(); else void ctx.resume();
      });
    }
    if (ctx && ctx.state === 'suspended' && !document.hidden) void ctx.resume();
  } catch { ctx = null; mix = null; }
}

export function setMuted(m: boolean): void {
  muted = m;
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
}
export function isMuted(): boolean { return muted; }

function play<N extends VoiceName>(name: N, ...args: VoiceArgs<N>): void {
  recorder?.({ voice: name, args });
  if (!ctx || !mix || muted) return;
  try {
    (voices[name] as (m: Mix, t: number, ...a: unknown[]) => void)(mix, ctx.currentTime + 0.01, ...args);
  } catch { /* audio is optional */ }
}

export const sfx = {
  ping: (mood: number) => play('ping', mood),
  send: () => play('send'),
  step: (run: boolean) => play('step', run),
  jump: () => play('jump'),
  land: (hard: boolean) => play('land', hard),
  fall: (kind: FallKind) => play('fall', kind),
  splat: (item: string) => play('splat', item),
  /** Soup sloshing out; throttled so a long spill drips instead of buzzing. */
  spill: () => {
    const now = performance.now();
    if (now - lastDrip < 110) return;
    lastDrip = now;
    play('drip', 0.03);
  },
  flower: () => play('flower'),
  bark: () => play('bark'),
  coo: () => play('coo'),
  knock: () => play('knock'),
  door: () => play('door'),
  boing: () => play('boing'),
  spray: () => play('spray'),
  /** End screen: tier 0 = best ending. */
  stinger: (tier: number, tiers: number) => play('stinger', tier, tiers),
};

/** Called every frame with the street's state; fades beds and schedules ambient events. */
export function updateAmbience(s: AmbienceState): void {
  recorder?.({ ambience: s });
  if (!ctx || !ambience) return;
  try { ambience.update(ctx.currentTime + 0.05, s); } catch { /* audio is optional */ }
}
