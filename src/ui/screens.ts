import { ROUTES } from '../data';
import { fmtClock, parseClock } from '../sim/clock';
import type { Relation } from '../sim/types';
import { load, save } from '../platform/storage';
import { byId, setText } from './dom';

export interface StartChoice { name: string; relation: Relation; routeId: string }
export interface BestRun { rank: string; arrival: string; score: number }

const RELATIONS: Relation[] = ['girlfriend', 'boyfriend', 'partner'];

export class StartScreen {
  private readonly root = byId('start');
  private readonly form = byId<HTMLFormElement>('startForm');
  private readonly nameInput = byId<HTMLInputElement>('partnerName');
  private readonly routeList = byId('routeList');
  private readonly nameLabel = byId('nameLabel');
  private onRouteChange: ((routeId: string) => void) | null = null;

  constructor(onStart: (c: StartChoice) => void) {
    const saved = load<Partial<StartChoice>>('choice', {});
    if (saved.name) this.nameInput.value = saved.name;
    const rel = RELATIONS.includes(saved.relation as Relation) ? (saved.relation as Relation) : 'girlfriend';
    (this.form.querySelector(`input[name="relation"][value="${rel}"]`) as HTMLInputElement | null)?.click();
    this.renderRoutes(saved.routeId ?? ROUTES[0].id);
    this.updateLabel();
    this.form.addEventListener('change', e => {
      this.updateLabel();
      const t = e.target as HTMLInputElement;
      if (t.name === 'route') this.onRouteChange?.(t.value);
    });
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      const c = this.choice();
      save('choice', c);
      onStart(c);
    });
  }

  /** Lets the title backdrop follow the selected route. */
  onRoute(fn: (routeId: string) => void): void { this.onRouteChange = fn; }

  choice(): StartChoice {
    const data = new FormData(this.form);
    const name = (String(data.get('partner') ?? '').trim() || 'Sam').slice(0, 14);
    const relation = (RELATIONS.find(r => r === data.get('relation')) ?? 'girlfriend');
    const routeId = String(data.get('route') ?? ROUTES[0].id);
    return { name, relation, routeId };
  }

  show(): void {
    this.renderRoutes(this.choice().routeId);
    this.root.hidden = false;
  }

  hide(): void { this.root.hidden = true; this.nameInput.blur(); }

  private updateLabel(): void {
    const rel = this.choice().relation;
    setText(this.nameLabel, `Your ${rel}'s name`);
  }

  private renderRoutes(selected: string): void {
    this.routeList.replaceChildren(...ROUTES.map(r => {
      const label = document.createElement('label');
      label.className = 'route';
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'route'; input.value = r.id; input.checked = r.id === selected;
      const body = document.createElement('span');
      const best = load<BestRun | null>(`best.${r.id}`, null);
      const title = document.createElement('b'); title.textContent = r.title;
      const time = document.createElement('em'); time.textContent = `${fmtClock(parseClock(r.start))} → ${fmtClock(parseClock(r.deadline))} PM`;
      const blurb = document.createElement('small'); blurb.textContent = best ? `${r.blurb} Best: ${best.rank}.` : r.blurb;
      body.append(title, time, blurb);
      label.append(input, body);
      return label;
    }));
    if (!this.routeList.querySelector('input:checked')) (this.routeList.querySelector('input') as HTMLInputElement | null)?.click();
  }
}

export interface EndView {
  arrival: string;
  lateText: string;
  rank: string;
  line: string;
  from: string;
  cake: number;
  falls: number;
  flowers: string;
  ignored: number;
}

export class EndScreen {
  private readonly root = byId('end');
  private readonly note = byId('shareNote');

  constructor(onAgain: () => void, onMenu: () => void, onShare: () => Promise<string>) {
    byId('againBtn').addEventListener('click', onAgain);
    byId('menuBtn').addEventListener('click', onMenu);
    byId('shareBtn').addEventListener('click', async () => {
      const msg = await onShare();
      this.note.textContent = msg;
      this.note.hidden = !msg;
    });
  }

  show(v: EndView): void {
    setText(byId('endTime'), `Home at ${v.arrival} · ${v.lateText}`);
    setText(byId('endRank'), v.rank);
    setText(byId('endFrom'), v.from);
    setText(byId('endText'), v.line);
    setText(byId('stCake'), `${v.cake}%`);
    setText(byId('stFalls'), v.falls);
    setText(byId('stFlowers'), v.flowers);
    setText(byId('stIgnored'), v.ignored);
    this.note.hidden = true;
    this.root.hidden = false;
    try { byId('againBtn').focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  hide(): void { this.root.hidden = true; }
}
