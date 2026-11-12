/**
 * The picture that "Share result" sends: the end of the conversation, the verdict, a few stats and
 * the link, sized for stories (1080x1920). Drawn on a canvas with the game's fonts; no DOM capture.
 */
export interface CardMessage { from: 'them' | 'me'; text: string }

export interface CardData {
  name: string;
  relation: string;
  route: string;
  arrival: string;
  lateText: string;
  rank: string;
  messages: CardMessage[];
  /** The Daily's run strip (🟩🟩💥…🏠), shown above the verdict. */
  strip?: string;
  itemEmoji: string;
  cake: number;
  falls: number;
  flowers: string;
  ignored: number;
  url: string;
}

export const CARD_W = 1080;
export const CARD_H = 1920;

const C = {
  night: '#1a1433', coral: '#ff6b4a', coralDeep: '#d9492b', amber: '#ffc857', paper: '#f8f5ff',
  ink: '#1d1631', muted: '#6c6285', her: '#ebe6f5', white: '#ffffff', line: 'rgba(29, 22, 49, 0.12)',
};
const DISPLAY = '"Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif';
const BODY = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Splits text into lines no wider than `max`, breaking at spaces (or inside a word that's too long). */
export function wrapLines(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next) <= max) { cur = next; continue; }
    if (cur) lines.push(cur);
    if (measure(word) <= max) { cur = word; continue; }
    // A single word wider than the line: break it by characters.
    cur = '';
    for (const ch of word) {
      if (cur && measure(cur + ch) > max) { lines.push(cur); cur = ''; }
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export async function renderShareCard(d: CardData): Promise<Blob> {
  await Promise.all([
    `800 120px ${DISPLAY}`, `600 40px ${BODY}`, `400 40px ${BODY}`,
  ].map(f => document.fonts?.load(f).catch(() => undefined)));

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');

  drawBackdrop(g);
  const M = 72;

  // Header: eyebrow + where/when.
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.coral;
  g.font = `600 34px ${BODY}`;
  spaced(g, 'WHERE ARE YOU?', M, 150, 5);
  g.fillStyle = 'rgba(248, 245, 255, 0.72)';
  g.font = `400 36px ${BODY}`;
  g.fillText(`${d.route} · home at ${d.arrival} · ${d.lateText}`, M, 204, CARD_W - 2 * M);

  // The chat, ending on their last words.
  const panelY = 260;
  const panelBottom = drawChat(g, d, M, panelY, CARD_W - 2 * M, d.strip ? 760 : 900);

  let y = panelBottom + 170;
  if (d.strip) {
    g.textAlign = 'center';
    g.font = `400 62px ${BODY}`;
    g.fillText(d.strip, CARD_W / 2, panelBottom + 112, CARD_W - 2 * M);
    y += 115;
  }

  // Verdict.
  g.textAlign = 'center';
  g.fillStyle = C.paper;
  let size = 150;
  g.font = `800 ${size}px ${DISPLAY}`;
  while (g.measureText(d.rank).width > CARD_W - 2 * M && size > 80) { size -= 6; g.font = `800 ${size}px ${DISPLAY}`; }
  g.fillText(d.rank, CARD_W / 2, y);

  // Stats.
  y += 110;
  chips(g, [`${d.itemEmoji} ${d.cake}%`, `💥 ${d.falls} ${d.falls === 1 ? 'fall' : 'falls'}`, `🌹 ${d.flowers}`, `👀 ${d.ignored} on read`], y);

  // Call to action + link.
  g.textAlign = 'center';
  g.fillStyle = C.paper;
  g.font = `600 44px ${BODY}`;
  g.fillText('Can you get home on time?', CARD_W / 2, CARD_H - 230);
  if (d.url) {
    const label = d.url.replace(/^https?:\/\//, '');
    g.font = `600 38px ${BODY}`;
    const w = g.measureText(label).width + 72;
    g.fillStyle = C.coral;
    roundRect(g, (CARD_W - w) / 2, CARD_H - 190, w, 84, 42); g.fill();
    g.fillStyle = C.white;
    g.fillText(label, CARD_W / 2, CARD_H - 135);
  }
  g.textAlign = 'left';

  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

function drawChat(g: CanvasRenderingContext2D, d: CardData, x: number, y: number, w: number, maxH: number): number {
  const pad = 40, head = 150, bubblePadX = 30, bubblePadY = 22, lineH = 52, gap = 18, fontSize = 40;
  const maxBubble = w * 0.74 - 2 * bubblePadX;
  g.font = `400 ${fontSize}px ${BODY}`;
  const measure = (s: string) => g.measureText(s).width;

  // Lay out from the newest message back, keeping whatever fits.
  const laid: { m: CardMessage; lines: string[]; bw: number; bh: number }[] = [];
  let used = 0;
  for (let i = d.messages.length - 1; i >= 0; i--) {
    const m = d.messages[i];
    const lines = wrapLines(m.text, maxBubble, measure);
    const bw = Math.max(...lines.map(measure)) + 2 * bubblePadX;
    const bh = lines.length * lineH + 2 * bubblePadY;
    if (laid.length && used + bh + gap > maxH - head - 2 * pad) break;
    laid.unshift({ m, lines, bw, bh });
    used += bh + gap;
  }
  const h = head + pad + used - gap + pad;

  // Panel.
  g.save();
  g.shadowColor = 'rgba(8, 4, 24, 0.45)'; g.shadowBlur = 60; g.shadowOffsetY = 24;
  g.fillStyle = C.paper; roundRect(g, x, y, w, h, 56); g.fill();
  g.restore();

  // Contact header.
  const ax = x + pad + 46, ay = y + 78;
  const grad = g.createLinearGradient(ax - 46, ay - 46, ax + 46, ay + 46);
  grad.addColorStop(0, C.coral); grad.addColorStop(1, C.amber);
  g.fillStyle = grad; g.beginPath(); g.arc(ax, ay, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.white; g.textAlign = 'center'; g.font = `800 44px ${DISPLAY}`;
  g.fillText((d.name.trim()[0] ?? '?').toUpperCase(), ax, ay + 15);
  g.textAlign = 'left';
  g.fillStyle = C.ink; g.font = `600 44px ${BODY}`;
  g.fillText(d.name, ax + 72, ay - 4, w - 2 * pad - 140);
  g.fillStyle = C.muted; g.font = `400 30px ${BODY}`;
  g.fillText(`your ${d.relation}`, ax + 72, ay + 38);
  g.fillStyle = C.line; g.fillRect(x, y + head, w, 2);

  // Bubbles.
  let by = y + head + pad;
  g.font = `400 ${fontSize}px ${BODY}`;
  for (const b of laid) {
    const mine = b.m.from === 'me';
    const bx = mine ? x + w - pad - b.bw : x + pad;
    g.fillStyle = mine ? C.coral : C.her;
    roundRect(g, bx, by, b.bw, b.bh, 40, mine ? { br: 12 } : { bl: 12 }); g.fill();
    g.fillStyle = mine ? C.white : C.ink;
    b.lines.forEach((line, i) => g.fillText(line, bx + bubblePadX, by + bubblePadY + 39 + i * lineH));
    by += b.bh + gap;
  }
  return y + h;
}

function drawBackdrop(g: CanvasRenderingContext2D): void {
  const sky = g.createLinearGradient(0, 0, 0, CARD_H);
  sky.addColorStop(0, '#120e2b'); sky.addColorStop(0.55, '#2a1f52'); sky.addColorStop(1, '#4a2f63');
  g.fillStyle = sky; g.fillRect(0, 0, CARD_W, CARD_H);

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255, 246, 239, ${0.25 + rnd() * 0.55})`;
    const s = 2 + rnd() * 3;
    g.fillRect(rnd() * CARD_W, rnd() * CARD_H * 0.85, s, s);
  }
  // Moon.
  g.fillStyle = '#fff6ef'; g.beginPath(); g.arc(CARD_W - 150, 120, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#16112f'; g.beginPath(); g.arc(CARD_W - 128, 104, 42, 0, Math.PI * 2); g.fill();

  // Low skyline with lit windows, kept under the call to action.
  for (let x = -20; x < CARD_W;) {
    const bw = 90 + rnd() * 110, bh = 110 + rnd() * 130, top = CARD_H - bh;
    g.fillStyle = '#211a40'; g.fillRect(x, top, bw, bh);
    for (let wy = top + 30; wy < CARD_H - 40; wy += 54) {
      for (let wx = x + 22; wx < x + bw - 34; wx += 44) {
        if (rnd() < 0.35) { g.fillStyle = 'rgba(255, 210, 122, 0.55)'; g.fillRect(wx, wy, 18, 26); }
      }
    }
    x += bw + 8 + rnd() * 18;
  }
  const fade = g.createLinearGradient(0, CARD_H - 520, 0, CARD_H);
  fade.addColorStop(0, 'rgba(26, 20, 51, 0)'); fade.addColorStop(1, 'rgba(18, 13, 38, 0.85)');
  g.fillStyle = fade; g.fillRect(0, CARD_H - 520, CARD_W, 520);
}

function chips(g: CanvasRenderingContext2D, labels: string[], y: number): void {
  g.font = `600 36px ${BODY}`;
  const padX = 30, gap = 18, h = 76;
  const widths = labels.map(l => g.measureText(l).width + 2 * padX);
  // Two rows if one doesn't fit.
  const rows: number[][] = [[]];
  let rowW = 0;
  widths.forEach((w, i) => {
    if (rows[rows.length - 1].length && rowW + gap + w > CARD_W - 120) { rows.push([]); rowW = 0; }
    rows[rows.length - 1].push(i); rowW += (rowW ? gap : 0) + w;
  });
  rows.forEach((row, r) => {
    const total = row.reduce((s, i) => s + widths[i], 0) + gap * (row.length - 1);
    let x = (CARD_W - total) / 2;
    const top = y + r * (h + gap);
    for (const i of row) {
      g.fillStyle = 'rgba(255, 255, 255, 0.1)'; roundRect(g, x, top, widths[i], h, h / 2); g.fill();
      g.fillStyle = C.paper; g.textAlign = 'left'; g.fillText(labels[i], x + padX, top + 50);
      x += widths[i] + gap;
    }
  });
}

/** Letter-spaced text (canvas letterSpacing isn't everywhere yet). */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + spacing; }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, corner: { bl?: number; br?: number } = {}): void {
  const bl = corner.bl ?? r, br = corner.br ?? r;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - br); g.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  g.lineTo(x + bl, y + h); g.quadraticCurveTo(x, y + h, x, y + h - bl);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
