import { voices, type Mix } from './voices';

export interface AmbienceState {
  /** A run is on screen (play, ending, end screen). */
  active: boolean;
  /** 0 = daylight, 1 = full night. */
  night: number;
  rain: boolean;
}

interface Bed { gain: GainNode; level: number }

/**
 * The street's background: a low city hum, rain when it rains, and scattered events (birds by day,
 * crickets at night, the odd passing car, raindrops). Call `update` every frame with the time the
 * sounds should start at, so it works live and when rendering clips offline.
 */
export class Ambience {
  private beds: Record<'hum' | 'rain' | 'rumble', Bed> | null = null;
  private next = { bird: 0, cricket: 0, car: 0, drip: 0 };

  constructor(private readonly m: Mix) {}

  update(t: number, s: AmbienceState): void {
    const beds = (this.beds ??= this.makeBeds(t));
    this.fade(beds.hum, t, s.active ? 0.035 : 0);
    this.fade(beds.rain, t, s.active && s.rain ? 0.04 : 0);
    this.fade(beds.rumble, t, s.active && s.rain ? 0.03 : 0);
    if (!s.active) return;

    if (s.night < 0.35 && !s.rain && t >= this.next.bird) { this.bird(t); this.next.bird = t + rand(1.6, 4.5); }
    if (s.night > 0.55 && !s.rain && t >= this.next.cricket) { this.cricket(t); this.next.cricket = t + rand(0.7, 1.3); }
    if (t >= this.next.car) { if (this.next.car > 0) this.car(t); this.next.car = t + rand(7, 14); }
    if (s.rain && t >= this.next.drip) { voices.drip(this.m, t, 0.012, this.m.amb); this.next.drip = t + rand(0.15, 0.6); }
  }

  private makeBeds(t: number): Record<'hum' | 'rain' | 'rumble', Bed> {
    const bed = (filters: [BiquadFilterType, number][]): Bed => {
      const src = this.m.ctx.createBufferSource();
      src.buffer = this.m.noise; src.loop = true;
      let node: AudioNode = src;
      for (const [type, f] of filters) {
        const bq = this.m.ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f;
        node.connect(bq); node = bq;
      }
      const gain = this.m.ctx.createGain(); gain.gain.setValueAtTime(0, t);
      node.connect(gain); gain.connect(this.m.amb);
      src.start(t, rand(0, 1.5));
      return { gain, level: 0 };
    };
    return {
      hum: bed([['lowpass', 220], ['lowpass', 220]]),
      rain: bed([['highpass', 900], ['lowpass', 7000]]),
      rumble: bed([['lowpass', 380]]),
    };
  }

  private fade(b: Bed, t: number, level: number): void {
    if (Math.abs(b.level - level) < 1e-4) return;
    b.level = level;
    b.gain.gain.setTargetAtTime(level, t, 0.6);
  }

  private panned(t: number, pan: number): AudioNode {
    const p = this.m.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, t);
    p.connect(this.m.amb);
    return p;
  }

  private bird(t: number): void {
    const out = this.panned(t, rand(-0.8, 0.8));
    const base = rand(2600, 3800), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = t + i * rand(0.07, 0.11), up = Math.random() < 0.5;
      const o = this.m.ctx.createOscillator(), g = this.m.ctx.createGain();
      o.frequency.setValueAtTime(base * (up ? 0.85 : 1.15), at);
      o.frequency.exponentialRampToValueAtTime(base * (up ? 1.2 : 0.8), at + 0.05);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.03, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.08);
    }
  }

  private cricket(t: number): void {
    const out = this.panned(t, rand(-0.9, 0.9));
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.035;
      const o = this.m.ctx.createOscillator(), g = this.m.ctx.createGain();
      o.frequency.value = rand(4400, 4800);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.02, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.025);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.04);
    }
  }

  /** A car passing in the distance, left to right or right to left. */
  private car(t: number): void {
    const dir = Math.random() < 0.5 ? -1 : 1, dur = 2.6;
    const p = this.m.ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.8 * dir, t); p.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
    const src = this.m.ctx.createBufferSource(); src.buffer = this.m.noise; src.loop = true;
    const bq = this.m.ctx.createBiquadFilter(); bq.type = 'bandpass'; bq.Q.value = 1.4;
    bq.frequency.setValueAtTime(280, t); bq.frequency.linearRampToValueAtTime(620, t + dur * 0.5); bq.frequency.linearRampToValueAtTime(260, t + dur);
    const g = this.m.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq); bq.connect(g); g.connect(p); p.connect(this.m.amb);
    src.start(t, rand(0, 1.5)); src.stop(t + dur + 0.05);
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
