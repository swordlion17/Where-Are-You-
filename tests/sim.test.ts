import { describe, expect, it } from 'vitest';
import { ROUTES, SCRIPTS } from '../src/data';
import { parseClock, fmtClock, fmtSpoken, fillTemplate } from '../src/sim/clock';
import { TIME_SCALE } from '../src/sim/constants';
import { Conversation, type ConvEvent } from '../src/sim/conversation';
import { shouldJump } from '../src/sim/autopilot';
import { mulberry32 } from '../src/sim/rng';
import { scoreRun } from '../src/sim/scoring';
import { World, type WorldInput } from '../src/sim/world';
import type { RouteDef } from '../src/sim/types';

const DT = 1 / 60;
const script = SCRIPTS[0];

/** Runs a route with the autopilot (or just walking). Returns the world and clock at arrival. */
function play(route: RouteDef, mode: 'walk' | 'bot' | 'flowers', seed = 1) {
  const w = new World(route, mulberry32(seed));
  let clock = parseClock(route.start);
  let t = 0;
  let arrived = false;
  while (!arrived && t < 180) {
    const input: WorldInput = { run: mode !== 'walk', jump: mode !== 'walk' && shouldJump(w, { flowers: mode === 'flowers' }) };
    const ev = w.step(DT, input, true);
    clock += DT * TIME_SCALE;
    t += DT;
    if (ev.some(e => e.type === 'arrive')) arrived = true;
  }
  return { w, clock, arrived, t };
}

describe('content data', () => {
  it.each(ROUTES.map(r => [r.id, r] as const))('route %s is well formed', (_id, r) => {
    expect(parseClock(r.deadline)).toBeGreaterThan(parseClock(r.start));
    const xs = r.obstacles.map(o => o.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(Math.max(...xs)).toBeLessThan(r.length - 200);
    expect(Math.min(...xs)).toBeGreaterThan(500);
    for (const o of r.obstacles) if (o.type === 'flower') expect(o.height).toBeDefined();
    for (const o of r.obstacles) if (o.type !== 'flower') expect(script.reactions[o.type]).toBeDefined();
  });

  it('every reply key used by the script exists', () => {
    for (const s of SCRIPTS) for (const t of s.schedule) if (t.replies) expect(s.replies[t.replies]).toBeDefined();
  });

  it('endings are ordered from best to worst and cover every score', () => {
    for (const s of SCRIPTS) {
      const mins = s.endings.map(e => e.minScore);
      expect([...mins].sort((a, b) => b - a)).toEqual(mins);
      expect(mins[mins.length - 1]).toBeLessThan(-100);
    }
  });
});

describe('clock', () => {
  it('formats evening times', () => {
    expect(fmtClock(parseClock('7:44'))).toBe('7:44');
    expect(fmtSpoken(parseClock('8:00'))).toBe('8');
    expect(fmtSpoken(parseClock('8:30'))).toBe('8:30');
    expect(fillTemplate('the {food} is {x}', { food: 'pasta' })).toBe('the pasta is {x}');
  });
});

describe('world', () => {
  it.each(ROUTES.map(r => [r.id, r] as const))('a careful runner finishes %s on time without falling into holes', (_id, r) => {
    const { w, clock, arrived } = play(r, 'bot');
    expect(arrived).toBe(true);
    expect(clock).toBeLessThanOrEqual(parseClock(r.deadline));
    expect(w.falls).toBeLessThanOrEqual(1);
  });

  it.each(ROUTES.map(r => [r.id, r] as const))('every flower on %s can be grabbed on a clean run', (_id, r) => {
    const { w, clock, arrived } = play(r, 'flowers');
    expect(arrived).toBe(true);
    expect(clock).toBeLessThanOrEqual(parseClock(r.deadline));
    expect(w.falls).toBe(0);
    expect(w.flowers).toBe(w.flowerTotal);
  });

  it.each(ROUTES.map(r => [r.id, r] as const))('only walking on %s is late and messy', (_id, r) => {
    const { w, clock, arrived } = play(r, 'walk');
    expect(arrived).toBe(true);
    expect(clock).toBeGreaterThan(parseClock(r.deadline));
    expect(w.falls).toBeGreaterThan(5);
    expect(w.cake).toBe(0);
  });

  it('ragdoll positions stay finite through every kind of fall', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { w } = play(ROUTES[0], 'walk', seed);
      for (const k of Object.values(w.pose())) {
        expect(Number.isFinite(k.x) && Number.isFinite(k.y)).toBe(true);
      }
    }
  });
});

describe('conversation', () => {
  const route = ROUTES[0];
  function run(conv: Conversation, from: number, seconds: number, playing = true): ConvEvent[] {
    const all: ConvEvent[] = [];
    let clock = from;
    for (let t = 0; t < seconds; t += DT) { clock += DT * TIME_SCALE; all.push(...conv.update(DT, clock, playing)); }
    return all;
  }
  const texts = (ev: ConvEvent[]) => ev.flatMap(e => (e.type === 'message' ? [e.text] : []));

  it('sends the intro, then scheduled texts with route values filled in', () => {
    const c = new Conversation(script, route);
    const ev = run(c, parseClock(route.start), 80);
    const got = texts(ev);
    expect(got.slice(0, 2)).toEqual(route.intro);
    expect(got).toContain("it's 8.");
    expect(got).toContain('the pasta is getting cold');
    expect(c.ignored).toBeGreaterThan(0);
  });

  it('a broken promise comes back to bite', () => {
    const c = new Conversation(script, route);
    let clock = parseClock(route.start);
    while (!c.replyOptions && clock < parseClock('8:30')) { clock += DT * TIME_SCALE; c.update(DT, clock, true); }
    const where = c.replyOptions;
    expect(where?.[1].promiseMinutes).toBe(5);
    const sent = c.choose(1, clock);
    expect(texts(sent)).toEqual(['5 min ❤️']);
    const later = texts(run(c, clock, 20));
    expect(later).toContain('you said 5 min. that was 5 min ago.');
    expect(c.replied).toBe(1);
  });
});

describe('scoring', () => {
  const route = ROUTES[0];
  const deadline = parseClock(route.deadline);
  it('on time with cake and flowers is the top rank', () => {
    const r = scoreRun({ mood: 80, cake: 90, flowers: 3, arrivedAt: deadline - 120, cakeClaim: false }, route, script);
    expect(r.rank).toBe('Partner of the Year');
    expect(r.lateText).toBe('2 min early');
  });
  it('very late with no cake is blocked and gets no extra lines', () => {
    const r = scoreRun({ mood: 5, cake: 0, flowers: 0, arrivedAt: deadline + 900, cakeClaim: true }, route, script);
    expect(r.rank).toBe('Blocked');
    expect(r.lines).toHaveLength(1);
    expect(r.lateText).toBe('15 min late');
  });
  it('claiming cake you no longer have is called out', () => {
    const r = scoreRun({ mood: 60, cake: 10, flowers: 0, arrivedAt: deadline + 60, cakeClaim: true }, route, script);
    expect(r.lines).toContain('you said you had cake.');
    expect(r.line).toContain('pasta');
  });
});
