import { describe, expect, it } from 'vitest';
import { Tracker } from '../src/platform/analytics';

function tracker(over: { key?: string; enabled?: boolean; send?: (url: string, body: string) => void } = {}) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const t = new Tracker({
    key: over.key ?? 'phc_test',
    host: 'https://eu.i.posthog.com/',
    enabled: over.enabled ?? true,
    send: over.send ?? ((url, body) => sent.push({ url, body: JSON.parse(body) })),
    newId: () => `visit-${++n}`,
  });
  return { t, sent };
}

describe('analytics', () => {
  it('sends an anonymous event to the capture endpoint', () => {
    const { t, sent } = tracker();
    t.setBase({ app_version: '0.1.2', platform: 'web' });
    t.track('run_started', { route: 'tuesday', attempt: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(sent[0].body).toEqual({
      api_key: 'phc_test',
      event: 'run_started',
      distinct_id: 'visit-1',
      properties: { app_version: '0.1.2', platform: 'web', route: 'tuesday', attempt: 1, $process_person_profile: false },
    });
  });

  it('keeps one id for the whole visit, and a new one for the next visit', () => {
    const { t, sent } = tracker();
    t.track('game_loaded');
    t.track('run_started');
    expect(sent.map(s => s.body.distinct_id)).toEqual(['visit-1', 'visit-1']);

    const ids: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const visit = new Tracker({ key: 'k', host: 'h', enabled: true, send: (_u, body) => ids.push(JSON.parse(body).distinct_id) });
      visit.track('game_loaded');
    }
    expect(ids[0]).not.toEqual(ids[1]);
  });

  it('sends nothing when turned off or not configured', () => {
    for (const opts of [{ enabled: false }, { key: '' }]) {
      const { t, sent } = tracker(opts);
      t.track('game_loaded');
      expect(t.active).toBe(false);
      expect(sent).toHaveLength(0);
    }
  });

  it('never lets a failing network break the game', () => {
    const { t } = tracker({ send: () => { throw new Error('offline'); } });
    expect(() => t.track('share_tapped', { outcome: 'copied' })).not.toThrow();
  });
});
