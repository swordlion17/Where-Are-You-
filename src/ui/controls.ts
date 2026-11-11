import { byId } from './dom';

const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
const RUN_KEYS = ['ShiftLeft', 'ShiftRight', 'ArrowRight', 'KeyD'];

/** Thumb buttons + keyboard. Jumps are latched until the game reads them. */
export class Controls {
  private readonly root = byId('controls');
  private readonly jumpBtn = byId<HTMLButtonElement>('btnJump');
  private readonly runBtn = byId<HTMLButtonElement>('btnRun');
  private runKey = false;
  private runTouch = false;
  private jumpLatched = false;
  private enabled = false;

  constructor(stage: HTMLElement) {
    this.jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); this.jump(); this.jumpBtn.classList.add('on'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.jumpBtn.addEventListener(ev, () => this.jumpBtn.classList.remove('on'));
    this.runBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.runTouch = true;
      try { this.runBtn.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.runBtn.addEventListener(ev, () => { this.runTouch = false; });
    for (const b of [this.jumpBtn, this.runBtn]) b.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('pointerdown', () => this.jump());

    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (JUMP_KEYS.includes(e.code)) { e.preventDefault(); if (!e.repeat) { this.jump(); this.jumpBtn.classList.add('on'); } }
      if (RUN_KEYS.includes(e.code)) { e.preventDefault(); this.runKey = true; }
    });
    window.addEventListener('keyup', e => {
      if (JUMP_KEYS.includes(e.code)) this.jumpBtn.classList.remove('on');
      if (RUN_KEYS.includes(e.code)) this.runKey = false;
    });
    window.addEventListener('blur', () => { this.runKey = false; this.runTouch = false; });
  }

  get run(): boolean { return this.enabled && (this.runKey || this.runTouch); }

  consumeJump(): boolean {
    const j = this.jumpLatched;
    this.jumpLatched = false;
    return j;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.classList.toggle('off', !on);
    if (!on) { this.runKey = false; this.runTouch = false; this.jumpLatched = false; }
  }

  /** Reflect the run state on the button (keyboard runs light it up too). */
  sync(): void { this.runBtn.classList.toggle('on', this.run); }

  private jump(): void { if (this.enabled) this.jumpLatched = true; }
}
