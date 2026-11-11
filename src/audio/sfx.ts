/** Tiny WebAudio synth for placeholder sound effects. No audio files needed. */
let ac: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ac && Ctor) ac = new Ctor();
    if (ac && ac.state === 'suspended') void ac.resume();
  } catch { ac = null; }
}

export function setMuted(m: boolean): void { muted = m; }
export function isMuted(): boolean { return muted; }

function tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.12, slide = 0, delay = 0): void {
  if (!ac || muted) return;
  try {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.05);
  } catch { /* audio is optional */ }
}

function noise(d: number, v = 0.2, delay = 0, freq = 900): void {
  if (!ac || muted) return;
  try {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t); s.stop(t + d + 0.05);
  } catch { /* audio is optional */ }
}

export const sfx = {
  ping() { tone(1175, 0.12, 'sine', 0.11); tone(1568, 0.18, 'sine', 0.09, 0, 0.1); },
  send() { tone(700, 0.1, 'sine', 0.08, 500); },
  jump() { tone(380, 0.14, 'square', 0.035, 320); },
  land() { noise(0.06, 0.08, 0, 500); },
  fall() { tone(520, 0.4, 'triangle', 0.11, -400); },
  splat() { noise(0.28, 0.35, 0, 700); tone(150, 0.22, 'sine', 0.18, -80); },
  flower() { tone(988, 0.1, 'sine', 0.09); tone(1319, 0.16, 'sine', 0.09, 0, 0.08); tone(1760, 0.2, 'sine', 0.07, 0, 0.16); },
  bark() { tone(330, 0.07, 'square', 0.05, -140); tone(300, 0.08, 'square', 0.05, -140, 0.12); },
  coo() { tone(420, 0.18, 'sine', 0.06, -120); noise(0.3, 0.12, 0, 2500); },
  knock() { noise(0.06, 0.5, 0, 400); noise(0.06, 0.5, 0.18, 400); noise(0.06, 0.5, 0.36, 400); },
  door() { tone(523, 0.2, 'sine', 0.08); tone(659, 0.2, 'sine', 0.08, 0, 0.12); tone(784, 0.35, 'sine', 0.08, 0, 0.24); },
};
