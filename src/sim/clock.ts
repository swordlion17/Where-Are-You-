/** Seconds since midnight for an evening "H:MM" time (hours below 12 are treated as PM). */
export function parseClock(s: string): number {
  const [h, m] = s.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`Bad clock time: ${s}`);
  return (h < 12 ? h + 12 : h) * 3600 + m * 60;
}

/** "7:44" style, 12-hour, no suffix. */
export function fmtClock(sec: number): string {
  const h24 = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  return `${h24 % 12 || 12}:${String(m).padStart(2, '0')}`;
}

/** "8" for 8:00, "8:30" otherwise: how people write times in texts. */
export function fmtSpoken(sec: number): string {
  return Math.floor(sec / 60) % 60 === 0 ? String((Math.floor(sec / 3600) % 24) % 12 || 12) : fmtClock(sec);
}

export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
