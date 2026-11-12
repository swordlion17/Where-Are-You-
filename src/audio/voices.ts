/**
 * Every sound in the game, synthesized (no audio files). Each voice is a function of a mix and a
 * start time, so the same code plays live (AudioContext) or renders offline (OfflineAudioContext)
 * for the soundboard and for clips.
 */
export interface Mix {
  ctx: BaseAudioContext;
  /** Dry effects. */
  sfx: AudioNode;
  /** Reverb send (for chimes and stingers). */
  verb: AudioNode;
  /** Background beds and ambient events. */
  amb: AudioNode;
  /** Two seconds of white noise, looped by noise voices. */
  noise: AudioBuffer;
}

/** Builds the mix: buses → master → gentle compressor → `out`. */
export function createMix(ctx: BaseAudioContext, out: AudioNode): { mix: Mix; master: GainNode } {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp); comp.connect(out);
  const sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
  const amb = ctx.createGain(); amb.gain.value = 0.8; amb.connect(master);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 1.6, 3.2);
  const wet = ctx.createGain(); wet.gain.value = 0.45; verb.connect(wet); wet.connect(master);
  return { mix: { ctx, sfx, verb, amb, noise: whiteNoise(ctx, 2) }, master };
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// ------------------------------------------------------------------ building blocks

type Dest = AudioNode | AudioNode[];
type Filter = { type: BiquadFilterType; f: number; q?: number };

function connect(node: AudioNode, dest: Dest): void { for (const d of Array.isArray(dest) ? dest : [dest]) node.connect(d); }

/** Gain that rises to `peak` in `a` seconds and decays to silence over `d`. */
function env(m: Mix, t: number, peak: number, a: number, d: number, dest: Dest): GainNode {
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  connect(g, dest);
  return g;
}

function filtered(m: Mix, input: AudioNode, f: Filter | undefined, out: AudioNode): void {
  if (!f) { input.connect(out); return; }
  const bq = m.ctx.createBiquadFilter();
  bq.type = f.type; bq.frequency.value = f.f; bq.Q.value = f.q ?? 0.7;
  input.connect(bq); bq.connect(out);
}

interface ToneOpts { f: number; f2?: number; type?: OscillatorType; peak?: number; a?: number; d?: number; dest?: Dest; filter?: Filter; vibrato?: [rate: number, depth: number] }

function tone(m: Mix, t: number, o: ToneOpts): void {
  const a = o.a ?? 0.005, d = o.d ?? 0.2;
  const osc = m.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
  if (o.vibrato) {
    const lfo = m.ctx.createOscillator(), depth = m.ctx.createGain();
    lfo.frequency.value = o.vibrato[0]; depth.gain.value = o.vibrato[1];
    lfo.connect(depth); depth.connect(osc.frequency); lfo.start(t); lfo.stop(t + a + d + 0.05);
  }
  filtered(m, osc, o.filter, env(m, t, o.peak ?? 0.1, a, d, o.dest ?? m.sfx));
  osc.start(t); osc.stop(t + a + d + 0.05);
}

interface NoiseOpts { filter?: Filter; f2?: number; peak?: number; a?: number; d?: number; dest?: Dest }

function noise(m: Mix, t: number, o: NoiseOpts): void {
  const a = o.a ?? 0.003, d = o.d ?? 0.1;
  const src = m.ctx.createBufferSource();
  src.buffer = m.noise; src.loop = true;
  const f = o.filter ?? { type: 'lowpass', f: 1000 };
  const bq = m.ctx.createBiquadFilter();
  bq.type = f.type; bq.frequency.setValueAtTime(f.f, t); bq.Q.value = f.q ?? 0.7;
  if (o.f2) bq.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
  src.connect(bq); bq.connect(env(m, t, o.peak ?? 0.1, a, d, o.dest ?? m.sfx));
  src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ the sounds

export type FallKind = 'trip' | 'slip' | 'hit' | 'hole';

export const voices = {
  /** Incoming text. Happy: bright and rising. The colder the mood, the lower and flatter it gets. */
  ping(m: Mix, t: number, mood = 75): void {
    const notes = mood >= 65 ? [1319, 1760] : mood >= 45 ? [1175, 1397] : mood >= 25 ? [1047, 988] : [880, 784];
    notes.forEach((f, i) => {
      const at = t + i * 0.11;
      tone(m, at, { f, peak: 0.14, d: 0.4, dest: [m.sfx, m.verb] });
      tone(m, at, { f: f * 4, peak: 0.025, d: 0.05 }); // mallet tick
    });
  },

  /** Your reply going out. */
  send(m: Mix, t: number): void {
    noise(m, t, { filter: { type: 'bandpass', f: 700, q: 1.2 }, f2: 3400, peak: 0.15, a: 0.03, d: 0.15 });
    tone(m, t + 0.13, { f: 1046, peak: 0.06, d: 0.08 });
  },

  step(m: Mix, t: number, run: boolean): void {
    const v = run ? 0.065 : 0.042, j = rand(0.85, 1.15);
    noise(m, t, { filter: { type: 'lowpass', f: (run ? 950 : 650) * j }, peak: v, d: 0.035 });
    tone(m, t, { f: 115 * j, f2: 60, peak: v, d: 0.05 });
  },

  jump(m: Mix, t: number): void {
    noise(m, t, { filter: { type: 'bandpass', f: 380, q: 1 }, f2: 1500, peak: 0.13, a: 0.03, d: 0.14 });
  },

  land(m: Mix, t: number, hard = false): void {
    tone(m, t, { f: 130, f2: 55, peak: hard ? 0.16 : 0.09, d: 0.12 });
    noise(m, t, { filter: { type: 'lowpass', f: 500 }, peak: hard ? 0.08 : 0.04, d: 0.05 });
  },

  fall(m: Mix, t: number, kind: FallKind): void {
    if (kind === 'hole') {
      // Slide whistle all the way down.
      tone(m, t, { f: 1150, f2: 170, peak: 0.07, a: 0.02, d: 0.75, vibrato: [9, 22], dest: [m.sfx, m.verb] });
      tone(m, t + 0.8, { f: 90, f2: 40, peak: 0.2, d: 0.3 });
      return;
    }
    if (kind === 'slip') tone(m, t, { f: 1500, f2: 2700, type: 'triangle', peak: 0.045, d: 0.09 });
    if (kind === 'hit') tone(m, t, { f: 430, f2: 250, type: 'square', peak: 0.035, d: 0.09, filter: { type: 'lowpass', f: 1800 } });
    if (kind === 'trip') noise(m, t, { filter: { type: 'bandpass', f: 2300, q: 2 }, peak: 0.06, d: 0.08 });
    const body = t + (kind === 'slip' ? 0.2 : 0.06);
    tone(m, body, { f: 95, f2: 42, peak: 0.22, d: 0.3 });
    noise(m, body, { filter: { type: 'lowpass', f: 700 }, peak: 0.12, d: 0.12 });
  },

  splat(m: Mix, t: number, item: string): void {
    if (item === 'soup') {
      noise(m, t, { filter: { type: 'highpass', f: 1300 }, peak: 0.18, d: 0.45 });
      noise(m, t, { filter: { type: 'lowpass', f: 450 }, peak: 0.12, d: 0.2 });
      for (let i = 0; i < 6; i++) voices.drip(m, t + rand(0.05, 0.5), 0.035);
      return;
    }
    noise(m, t, { filter: { type: 'bandpass', f: 1300, q: 1.6 }, f2: 250, peak: 0.24, d: 0.28 });
    tone(m, t, { f: 150, f2: 55, peak: 0.18, d: 0.22 });
  },

  /** One drop of soup (or rain) hitting the ground. */
  drip(m: Mix, t: number, peak = 0.03, dest?: AudioNode): void {
    const f = rand(1500, 3000);
    tone(m, t, { f, f2: f * 0.5, peak, d: 0.05, dest: dest ?? m.sfx });
  },

  flower(m: Mix, t: number): void {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(m, t + i * 0.06, { f, type: 'triangle', peak: 0.06, d: 0.28, dest: [m.sfx, m.verb] }));
  },

  bark(m: Mix, t: number): void {
    for (const dt of [0, 0.17]) {
      tone(m, t + dt, { f: 560, f2: 240, type: 'sawtooth', peak: 0.11, a: 0.008, d: 0.1, filter: { type: 'lowpass', f: 1300, q: 3 } });
      noise(m, t + dt, { filter: { type: 'bandpass', f: 900, q: 2 }, peak: 0.08, d: 0.06 });
    }
  },

  /** Pigeons taking off: wing flutter, then a coo. */
  coo(m: Mix, t: number): void {
    for (let i = 0; i < 9; i++) noise(m, t + i * 0.045, { filter: { type: 'bandpass', f: 1700, q: 0.9 }, peak: 0.08, d: 0.03 });
    tone(m, t + 0.2, { f: 400, f2: 330, peak: 0.07, a: 0.04, d: 0.3, vibrato: [7, 12] });
  },

  knock(m: Mix, t: number): void {
    for (const dt of [0, 0.17]) {
      noise(m, t + dt, { filter: { type: 'bandpass', f: 900, q: 5 }, peak: 0.35, d: 0.04 });
      tone(m, t + dt, { f: 210, f2: 170, peak: 0.15, d: 0.07 });
    }
  },

  /** Door creaking open. */
  door(m: Mix, t: number): void {
    tone(m, t, { f: 150, f2: 115, type: 'sawtooth', peak: 0.14, a: 0.06, d: 0.6, vibrato: [11, 9], filter: { type: 'bandpass', f: 1100, q: 4 } });
  },

  /** Popping back out of a hole. */
  boing(m: Mix, t: number): void {
    tone(m, t, { f: 240, f2: 560, peak: 0.07, a: 0.01, d: 0.38, vibrato: [15, 60] });
  },

  /** Fire hydrant spraying. */
  spray(m: Mix, t: number): void {
    noise(m, t, { filter: { type: 'highpass', f: 2800 }, peak: 0.05, a: 0.05, d: 1.3 });
  },

  /**
   * Plays as the end screen appears. `tier` 0 is the best ending, `tiers - 1` the worst: a warm
   * chord at the top, a sad trombone at the bottom.
   */
  stinger(m: Mix, t: number, tier: number, tiers: number): void {
    const r = tiers > 1 ? tier / (tiers - 1) : 0;
    const chime = (fs: number[], gap: number, d: number, peak = 0.09) => fs.forEach((f, i) => tone(m, t + i * gap, { f, type: 'triangle', peak, d, dest: [m.sfx, m.verb] }));
    if (r === 0) { chime([523, 659, 784, 1047], 0.09, 0.9, 0.06); chime([523, 659, 784], 0, 1.4, 0.05); return; }
    if (r <= 0.3) { chime([659, 784, 1047], 0.1, 0.7); return; }
    if (r <= 0.6) { chime([587, 523], 0.18, 0.5); return; }
    if (r < 1) { chime([659, 523, 440], 0.16, 0.55); return; }
    // Sad trombone.
    const brass = { type: 'sawtooth' as OscillatorType, peak: 0.09, filter: { type: 'lowpass' as BiquadFilterType, f: 1400, q: 1 } };
    [466, 440, 415].forEach((f, i) => tone(m, t + i * 0.36, { ...brass, f, a: 0.03, d: 0.3 }));
    tone(m, t + 1.08, { ...brass, f: 392, f2: 370, a: 0.03, d: 1.0, vibrato: [5.5, 9] });
  },
};

export type VoiceName = keyof typeof voices;
