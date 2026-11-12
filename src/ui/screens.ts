import { ROUTES, SCRIPTS, scriptById } from '../data';
import { itemById } from '../sim/items';
import { fmtClock, parseClock } from '../sim/clock';
import type { Relation } from '../sim/types';
import { load, save } from '../platform/storage';
import { byId, setText } from './dom';

export interface StartChoice {
  name: string;
  relation: Relation;
  routeId: string;
  /** Script id: what the partner is like. */
  personality: string;
  /** The player opened the options this visit (for play stats; not saved). */
  customized?: boolean;
}
export interface BestRun { rank: string; arrival: string; score: number }

const RELATIONS: Relation[] = ['girlfriend', 'boyfriend', 'partner'];

/**
 * One tap to play: "Start walking" with the current (or remembered) setup shown on one line.
 * "Change" opens who's waiting, their name and the night.
 */
export class StartScreen {
  private readonly root = byId('start');
  private readonly form = byId<HTMLFormElement>('startForm');
  private readonly nameInput = byId<HTMLInputElement>('partnerName');
  private readonly routeList = byId('routeList');
  private readonly personalityList = byId('personalityList');
  private readonly personalityHint = byId('personalityHint');
  private readonly nameLabel = byId('nameLabel');
  private readonly panel = byId('setupPanel');
  private readonly toggle = byId<HTMLButtonElement>('setupToggle');
  private readonly summary = byId('setupSummary');
  private readonly startBtn = byId<HTMLButtonElement>('startBtn');
  private onRouteChange: ((routeId: string) => void) | null = null;
  private customized = false;

  constructor(onStart: (c: StartChoice) => void) {
    const saved = load<Partial<StartChoice>>('choice', {});
    if (saved.name) this.nameInput.value = saved.name;
    const rel = RELATIONS.includes(saved.relation as Relation) ? (saved.relation as Relation) : 'girlfriend';
    (this.form.querySelector(`input[name="relation"][value="${rel}"]`) as HTMLInputElement | null)?.click();
    this.renderPersonalities(scriptById(saved.personality).id);
    this.renderRoutes(saved.routeId ?? ROUTES[0].id);
    this.refresh();
    this.toggle.addEventListener('click', () => this.setOpen(this.toggle.getAttribute('aria-expanded') !== 'true'));
    this.form.addEventListener('change', e => {
      this.refresh();
      const t = e.target as HTMLInputElement;
      if (t.name === 'route') this.onRouteChange?.(t.value);
    });
    this.nameInput.addEventListener('input', () => this.refresh());
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      const c = this.choice();
      save('choice', c);
      onStart({ ...c, customized: this.customized });
    });
    this.focusStart();
  }

  /** Lets the title backdrop follow the selected route. */
  onRoute(fn: (routeId: string) => void): void { this.onRouteChange = fn; }

  choice(): StartChoice {
    const data = new FormData(this.form);
    const name = (String(data.get('partner') ?? '').trim() || 'Sam').slice(0, 14);
    const relation = (RELATIONS.find(r => r === data.get('relation')) ?? 'girlfriend');
    const routeId = String(data.get('route') ?? ROUTES[0].id);
    const personality = scriptById(String(data.get('personality') ?? '')).id;
    return { name, relation, routeId, personality };
  }

  /** `options: true` opens the setup right away (coming from "Pick another night"). */
  show(options = false): void {
    this.renderRoutes(this.choice().routeId);
    this.refresh();
    this.setOpen(options);
    this.root.hidden = false;
    if (!options) this.focusStart();
  }

  hide(): void { this.root.hidden = true; this.nameInput.blur(); }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.textContent = open ? 'Done' : 'Change';
    if (open) this.customized = true;
  }

  /** Name label and the one-line summary follow the current choices. */
  private refresh(): void {
    const c = this.choice();
    setText(this.nameLabel, `Your ${c.relation}'s name`);
    const name = document.createElement('b');
    name.textContent = c.name;
    const routeDef = ROUTES.find(r => r.id === c.routeId);
    const route = routeDef?.title ?? '';
    setText(byId('ledeItem'), itemById(routeDef?.item).word);
    const script = scriptById(c.personality);
    this.summary.replaceChildren(name, `, your ${script.adjective} ${c.relation} · ${route}`);
    setText(this.personalityHint, script.name);
  }

  /** So Enter or Space starts the game on a keyboard. */
  private focusStart(): void {
    try { this.startBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  private renderPersonalities(selected: string): void {
    this.personalityList.replaceChildren(...SCRIPTS.map(sc => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'personality'; input.value = sc.id; input.checked = sc.id === selected;
      const chip = document.createElement('span');
      chip.textContent = sc.adjective;
      label.append(input, chip);
      return label;
    }));
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
  /** What was carried: "cake", "soup". */
  item: string;
  falls: number;
  flowers: string;
  ignored: number;
}

export class EndScreen {
  private readonly root = byId('end');
  private readonly note = byId('shareNote');
  private readonly manual = byId<HTMLTextAreaElement>('shareManual');
  private readonly picture = byId<HTMLAnchorElement>('savePicture');

  constructor(onAgain: () => void, onMenu: () => void, onShare: () => Promise<{ note: string; manual?: string; picture?: string }>) {
    byId('againBtn').addEventListener('click', onAgain);
    byId('menuBtn').addEventListener('click', onMenu);
    byId('shareBtn').addEventListener('click', async () => {
      const { note, manual, picture } = await onShare();
      this.note.textContent = note;
      this.note.hidden = !note;
      this.manual.value = manual ?? '';
      this.manual.hidden = !manual;
      if (picture) this.picture.href = picture;
      this.picture.hidden = !picture;
      if (manual) { this.manual.focus({ preventScroll: true }); this.manual.select(); }
    });
  }

  show(v: EndView): void {
    setText(byId('endTime'), `Home at ${v.arrival} · ${v.lateText}`);
    setText(byId('endRank'), v.rank);
    setText(byId('endFrom'), v.from);
    setText(byId('endText'), v.line);
    setText(byId('stCake'), `${v.cake}%`);
    setText(byId('stItemLabel'), `${v.item[0].toUpperCase()}${v.item.slice(1)} left`);
    setText(byId('stFalls'), v.falls);
    setText(byId('stFlowers'), v.flowers);
    setText(byId('stIgnored'), v.ignored);
    this.note.hidden = true;
    this.manual.hidden = true;
    this.picture.hidden = true;
    this.root.hidden = false;
    try { byId('againBtn').focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  hide(): void { this.root.hidden = true; }
}
