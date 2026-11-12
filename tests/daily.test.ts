import { describe, expect, it } from 'vitest';
import { SCRIPTS } from '../src/data';
import { dailyRoute, dayNumber, isFair, playthrough } from '../src/sim/daily';

const day = (offset: number) => new Date(2026, 10, 12 + offset, 15, 30); // local afternoon

describe('daily', () => {
  it('numbers days from 12 Nov 2026', () => {
    expect(dayNumber(new Date(2026, 10, 12, 0, 1))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 12, 23, 59))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 13, 0, 1))).toBe(2);
    expect(dayNumber(new Date(2027, 0, 1, 12))).toBe(51);
  });

  it('is the same night for everyone on the same date, and different the next day', () => {
    const a = JSON.stringify(dailyRoute(day(5))), b = JSON.stringify(dailyRoute(new Date(2026, 10, 17, 8)));
    expect(a).toBe(b);
    expect(JSON.stringify(dailyRoute(day(6)))).not.toBe(a);
  });

  it('60 days in a row are all fair, well formed and have texts for every obstacle', () => {
    for (let i = 0; i < 60; i++) {
      const r = dailyRoute(day(i));
      expect(isFair(r), `${r.title} is fair`).toBe(true);
      const xs = r.obstacles.map(o => o.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      expect(Math.min(...xs)).toBeGreaterThan(500);
      expect(Math.max(...xs)).toBeLessThan(r.length - 200);
      for (const sc of SCRIPTS) for (const o of r.obstacles) if (o.type !== 'flower') expect(sc.reactions[o.type]).toBeDefined();
      expect(playthrough(r, () => true, 1).arrived).toBe(true);
    }
  });

  it('a new day is ready quickly', () => {
    const t = performance.now();
    dailyRoute(day(400));
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
