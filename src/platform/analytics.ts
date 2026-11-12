import { ANALYTICS } from '../config';

/**
 * Anonymous play stats, sent straight to PostHog's capture API (no SDK).
 *
 * - No cookies and no storage: one random id per page load, kept in memory. Visits can't be linked to
 *   each other or to a person.
 * - Never sends the partner's name or anything typed by the player.
 * - Off in dev builds (add ?analytics to the URL to test), off when the browser asks not to be tracked
 *   (Global Privacy Control or Do Not Track), off when no project key is configured.
 */
export type EventName = 'game_loaded' | 'run_started' | 'reply_tapped' | 'run_finished' | 'run_quit' | 'share_tapped';
export type Props = Record<string, string | number | boolean | null>;

export interface TrackerOptions {
  key: string;
  host: string;
  enabled: boolean;
  send?: (url: string, body: string) => void;
  newId?: () => string;
}

export class Tracker {
  private readonly id: string;
  private base: Props = {};

  constructor(private readonly opts: TrackerOptions) {
    this.id = (opts.newId ?? randomId)();
  }

  get active(): boolean { return this.opts.enabled && this.opts.key.length > 0; }

  /** Properties added to every event (version, platform...). */
  setBase(props: Props): void { this.base = { ...this.base, ...props }; }

  track(event: EventName, props: Props = {}): void {
    if (!this.active) return;
    try {
      const body = JSON.stringify({
        api_key: this.opts.key,
        event,
        distinct_id: this.id,
        properties: { ...this.base, ...props, $process_person_profile: false },
      });
      (this.opts.send ?? post)(`${this.opts.host.replace(/\/+$/, '')}/i/v0/e/`, body);
    } catch { /* stats must never break the game */ }
  }
}

function post(url: string, body: string): void {
  // text/plain keeps this a simple request (no CORS preflight), and keepalive lets it finish while the
  // page is closing, which is when the "quit" event goes out.
  void fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })
    .catch(() => undefined);
}

function randomId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

function allowedHere(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has('analytics')) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl !== true && nav.doNotTrack !== '1';
}

export const analytics = new Tracker({ key: ANALYTICS.key, host: ANALYTICS.host, enabled: allowedHere() });
