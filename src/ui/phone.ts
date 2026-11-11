import type { ConvEvent } from '../sim/conversation';
import { byId, setText } from './dom';

const MAX_BUBBLES = 7;

/** The messaging panel at the top of the screen. Renders conversation events; holds no game state. */
export class Phone {
  private readonly el = byId('phone');
  private readonly msgs = byId('msgs');
  private readonly replies = byId('replies');
  private readonly status = byId('csub');
  private readonly clock = byId('clock');
  private readonly batPct = byId('batPct');
  private readonly batFill = byId('batFill');
  private readonly name = byId('cname');
  private readonly avatar = byId('avatar');
  private readonly mood = byId('mood');
  private typing: HTMLElement | null = null;
  private pickHandler: ((i: number) => void) | null = null;

  constructor(private readonly reducedMotion: boolean) {}

  setContact(name: string): void {
    setText(this.name, name);
    setText(this.avatar, name.charAt(0).toUpperCase());
  }

  setClock(text: string, late: boolean): void {
    setText(this.clock, text);
    this.clock.classList.toggle('late', late);
  }

  setBattery(pct: number): void {
    setText(this.batPct, `${pct}%`);
    this.batFill.style.width = `${Math.max(6, pct)}%`;
  }

  setMood(emoji: string): void { setText(this.mood, emoji); }

  clear(): void {
    this.msgs.replaceChildren();
    this.typing = null;
    this.hideReplies();
    setText(this.status, 'online');
  }

  apply(e: ConvEvent, onPick: (index: number) => void): void {
    switch (e.type) {
      case 'typing': this.showTyping(); break;
      case 'message':
        this.removeTyping();
        this.addBubble(e.text, e.from);
        if (e.from === 'them') this.buzz();
        break;
      case 'replies': this.showReplies(e.options, e.seconds, onPick); break;
      case 'repliesClosed': this.hideReplies(); break;
      case 'status': setText(this.status, e.text); break;
    }
  }

  private addBubble(text: string, from: 'them' | 'me'): void {
    const b = document.createElement('div');
    b.className = `bub ${from === 'them' ? 'her' : 'me'}`;
    b.textContent = text;
    this.msgs.appendChild(b);
    while (this.msgs.children.length > MAX_BUBBLES) this.msgs.firstElementChild?.remove();
  }

  private showTyping(): void {
    this.removeTyping();
    const t = document.createElement('div');
    t.className = 'bub her typing';
    t.setAttribute('aria-label', 'typing');
    t.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    this.msgs.appendChild(t);
    this.typing = t;
  }

  private removeTyping(): void { this.typing?.remove(); this.typing = null; }

  private buzz(): void {
    if (this.reducedMotion) return;
    this.el.classList.remove('buzz');
    void this.el.offsetWidth;
    this.el.classList.add('buzz');
  }

  private showReplies(options: string[], seconds: number, onPick: (i: number) => void): void {
    this.replies.replaceChildren();
    this.pickHandler = onPick;
    options.forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      // pointerdown so a thumb tap lands instantly, even while the other thumb holds RUN.
      b.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); this.pick(i); });
      b.addEventListener('click', () => this.pick(i));
      this.replies.appendChild(b);
    });
    const bar = document.createElement('i');
    bar.className = 'timer';
    bar.style.animationDuration = `${seconds}s`;
    this.replies.appendChild(bar);
    this.replies.hidden = false;
  }

  private pick(i: number): void {
    const h = this.pickHandler;
    if (!h) return;
    this.pickHandler = null;
    h(i);
  }

  private hideReplies(): void {
    this.replies.hidden = true;
    this.replies.replaceChildren();
    this.pickHandler = null;
  }
}
