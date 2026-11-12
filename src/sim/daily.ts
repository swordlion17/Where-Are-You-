import { shouldJump } from './autopilot';
import { parseClock } from './clock';
import { TIME_SCALE } from './constants';
import { mulberry32, type Rng } from './rng';
import type { ObstacleDef, ObstacleType, RouteDef } from './types';
import { World } from './world';

/**
 * The Daily: a new night every day, the same for everyone on that date. Generated from the day
 * number, then played by the autopilot to make sure it's fair (same rules the hand-made nights are
 * tested against). Layouts that fail are skipped for the next candidate.
 */
export const DAILY_ID = 'daily';
/** Daily #1. */
const EPOCH = Date.UTC(2026, 10, 12);
const DT = 1 / 60;

/** Daily number for a local calendar date (#1 = 12 Nov 2026). */
export function dayNumber(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86_400_000) + 1;
}

/** One occasion per weekday, Sunday first. Intro texts may use {item}. Foods are singular: texts say "the {food} is getting cold". */
const OCCASIONS: { title: string; food: string; emoji: string; intro: [string, string] }[] = [
  { title: 'Sunday Roast', food: 'roast', emoji: '🍗', intro: ['the roast is in the oven 🍗', "you're bringing the {item} right??"] },
  { title: 'Monday Leftovers', food: 'leftover lasagna', emoji: '🥡', intro: ['leftovers night. low effort, high love', 'just bring the {item} 🙏'] },
  { title: 'Taco Tuesday', food: 'taco meat', emoji: '🌮', intro: ['TACO TUESDAY 🌮', "the {item} is dessert. don't forget it"] },
  { title: 'Wednesday Date Night', food: 'risotto', emoji: '🕯️', intro: ['date night 🕯️ i made risotto', 'you have the {item}?'] },
  { title: 'Thursday Takeout', food: 'ramen', emoji: '🍜', intro: ['ordered ramen 🍜', 'your one job was the {item}'] },
  { title: 'Friday Pizza', food: 'pizza', emoji: '🍕', intro: ['pizza is ordered 🍕', 'bring the {item} and we never leave the couch'] },
  { title: 'Saturday Movie Night', food: 'popcorn', emoji: '🍿', intro: ['movie night 🍿 i picked a long one', 'get here with the {item} before the trailers end'] },
];

const STARTS = ['6:44', '7:14', '7:44', '8:14', '8:44'];

const cache = new Map<number, RouteDef>();

/** Today's (or `date`'s) Daily. */
export function dailyRoute(date = new Date()): RouteDef {
  const n = dayNumber(date);
  const hit = cache.get(n);
  if (hit) return hit;
  let route: RouteDef | null = null;
  for (let attempt = 0; attempt < 60 && !route; attempt++) {
    const r = generate(n, attempt, date.getDay());
    if (isFair(r)) route = r;
  }
  route ??= generate(n, 0, date.getDay()); // never seen in testing; better a hard night than none
  cache.set(n, route);
  return route;
}

// ------------------------------------------------------------------ generation

const WEIGHTS: Partial<Record<ObstacleType, number>> = { puddle: 3, banana: 2, cone: 2, hydrant: 1.5, pigeons: 1, flower: 2.7, hole: 1.2, dog: 1, skater: 0.8 };

/** One candidate layout (exported for tests and tuning). */
export function generate(n: number, attempt: number, weekday: number): RouteDef {
  const rng = mulberry32(((n * 9973) ^ (attempt * 7919 + 17)) >>> 0 || 1);
  const occ = OCCASIONS[weekday];
  const soup = rng() < 0.4;
  const rain = rng() < 0.25;
  const start = STARTS[Math.floor(rng() * STARTS.length)];
  const [h, m] = start.split(':').map(Number);
  const deadline = `${h + Math.floor((m + 16) / 60)}:${String((m + 16) % 60).padStart(2, '0')}`;
  const length = soup ? 6600 + Math.floor(rng() * 9) * 100 : 8200 + Math.floor(rng() * 11) * 100;
  const weights = { ...WEIGHTS, puddle: (WEIGHTS.puddle ?? 0) + (rain ? 2 : 0) };

  const obstacles: ObstacleDef[] = [];
  let x = 650 + Math.floor(rng() * 150);
  while (x < length - 300) {
    let type = weighted(rng, weights);
    if (type === obstacles.at(-1)?.type) type = weighted(rng, weights);
    const prevX = obstacles.at(-1)?.x ?? 0;
    // Dogs and skaters run at you: keep the stretch before them clear so you never meet one on top
    // of something else. Holes need a run-up.
    const gapBefore = type === 'dog' ? 560 : type === 'skater' ? 680 : type === 'hole' ? 300 : 0;
    x = Math.max(x, prevX + gapBefore);
    if (x >= length - 300) break;
    const def: ObstacleDef = { type, x };
    if (type === 'flower') def.height = rng() < 0.5 ? 'high' : 'low';
    obstacles.push(def);
    x += (type === 'hole' ? 330 : 250) + Math.floor(rng() * 170);
  }

  const late = `${occ.food[0].toUpperCase()}${occ.food.slice(1)} at ${deadline}.`;
  const extras = [rain ? 'Rain.' : '', soup ? 'Soup tonight. Running spills it.' : ''].filter(Boolean).join(' ');
  return {
    id: `${DAILY_ID}-${n}`,
    title: `Daily #${n}: ${occ.title}`,
    blurb: `${late} New every day, same for everyone.${extras ? ` ${extras}` : ''}`,
    item: soup ? 'soup' : 'cake',
    ...(rain ? { weather: 'rain' as const } : {}),
    start, deadline, length,
    intro: [...occ.intro],
    vars: { food: occ.food },
    obstacles,
    daily: { n, emoji: occ.emoji },
  };
}

function weighted(rng: Rng, w: Partial<Record<ObstacleType, number>>): ObstacleType {
  const entries = Object.entries(w) as [ObstacleType, number][];
  let r = rng() * entries.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
  return entries[0][0];
}

// ------------------------------------------------------------------ fairness

interface Outcome { arrived: boolean; margin: number; falls: number; left: number }

/** Plays the night with a RUN policy (held through jumps) and the autopilot's jumps. */
export function playthrough(r: RouteDef, run: (t: number, w: World) => boolean, seed: number, jump = true): Outcome {
  const w = new World(r, mulberry32(seed));
  let t = 0, running = false, arrived = false;
  while (!arrived && t < 150) {
    if (w.p.onGround) running = run(t, w);
    arrived = w.step(DT, { run: running, jump: jump && shouldJump(w) }, true).some(e => e.type === 'arrive');
    t += DT;
  }
  const margin = (parseClock(r.deadline) - (parseClock(r.start) + t * TIME_SCALE)) / 60;
  return { arrived, margin, falls: w.falls, left: w.cake };
}

/** The bar every Daily has to clear before anyone sees it. */
export function isFair(r: RouteDef): boolean {
  const flowers = r.obstacles.filter(o => o.type === 'flower').length;
  if (flowers < 3 || flowers > 6 || !r.obstacles.some(o => o.type === 'hole')) return false;
  const best = playthrough(r, () => true, 1);
  if (!best.arrived || best.falls > 1) return false;
  if (playthrough(r, () => false, 1, false).margin >= 0) return false; // walking into everything must be late
  if (r.item === 'cake') return best.margin >= 2.5 && best.margin <= 5;
  // Soup: sprinting has to cost most of it; a steady pace has to save most of it, on time.
  const avg = (run: (t: number, w: World) => boolean) => [1, 2, 3].map(s => playthrough(r, run, s));
  const sprint = avg(() => true), pace = avg(carefulPace);
  const mean = (xs: Outcome[]) => xs.reduce((s, o) => s + o.left, 0) / xs.length;
  return mean(sprint) < 50 && mean(pace) > 50 && pace.every(o => o.arrived && o.margin >= 0);
}

/** How a careful soup carrier plays: walk, run up to holes (you can't clear one walking), and run one second in three to keep time. */
export function carefulPace(t: number, w: World): boolean {
  return w.holes.some(h => h.x - w.p.x < 320 && h.x1 > w.p.x) || t % 3 < 1;
}
