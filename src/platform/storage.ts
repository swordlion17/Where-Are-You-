/** localStorage with safe fallbacks (private windows, blocked storage). */
// Specific on purpose: itch.io serves every HTML5 game from one domain, so they all share localStorage.
const PREFIX = 'whereareyou.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

export function save(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
