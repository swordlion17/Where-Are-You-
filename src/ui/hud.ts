import { isMuted, setMuted } from '../audio/sfx';
import { load, save } from '../platform/storage';
import { byId, setText } from './dom';

export class Hud {
  private readonly cake = byId('hudCake');
  private readonly cakeChip = byId('cakeChip');
  private readonly itemIcon = byId('hudItemIcon');
  private readonly flowers = byId('hudFlowers');
  private readonly dist = byId('hudDist');
  private readonly mute = byId<HTMLButtonElement>('muteBtn');

  constructor() {
    setMuted(load('muted', false));
    this.renderMute();
    this.mute.addEventListener('click', () => {
      setMuted(!isMuted());
      save('muted', isMuted());
      this.renderMute();
    });
  }

  /** What's being carried this run (🎂 cake, 🍲 soup). */
  setItem(emoji: string, word: string): void {
    setText(this.itemIcon, emoji);
    this.cakeChip.title = `${word[0].toUpperCase()}${word.slice(1)} left`;
  }

  private lastPct = 100;

  set(cakePct: number, flowers: number, flowerTotal: number, metersLeft: number): void {
    if (cakePct < this.lastPct - 2) this.bump(); // a visible hit, not every 1% of soup
    if (cakePct < this.lastPct - 2 || cakePct > this.lastPct) this.lastPct = cakePct;
    setText(this.cake, `${cakePct}%`);
    this.cakeChip.classList.toggle('low', cakePct < 35);
    setText(this.flowers, `${flowers}/${flowerTotal}`);
    setText(this.dist, `${metersLeft} m`);
  }

  private bump(): void {
    this.cakeChip.classList.remove('bump');
    void this.cakeChip.offsetWidth; // restart the animation
    this.cakeChip.classList.add('bump');
  }

  private renderMute(): void {
    const m = isMuted();
    this.mute.textContent = m ? '🔇' : '🔊';
    this.mute.setAttribute('aria-pressed', String(m));
    this.mute.setAttribute('aria-label', m ? 'Turn sound on' : 'Mute sound');
  }
}
