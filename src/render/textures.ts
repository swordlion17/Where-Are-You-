import Phaser from 'phaser';
import { mulberry32 } from '../sim/rng';

/**
 * Placeholder art, drawn once with Canvas 2D into textures at boot.
 * Replace any entry with a real PNG later: keep the key and the origin and nothing else changes.
 */

/** Texture pixels per world unit. */
export const TEX_SCALE = 2;
export const SKY_TILE = 1800;
export const TREE_TILE = 1300;

export interface TexInfo { ox: number; oy: number }
const info = new Map<string, TexInfo>();

/** Origin (0..1) for a generated texture, so world (x, y) lines up with its anchor. */
export function texOrigin(key: string): TexInfo { return info.get(key) ?? { ox: 0.5, oy: 1 }; }

type Draw = (c: CanvasRenderingContext2D) => void;

/** w/h in world units; (ax, ay) is the anchor inside that box, in world units. */
function make(scene: Phaser.Scene, key: string, w: number, h: number, ax: number, ay: number, draw: Draw): void {
  const tex = scene.textures.createCanvas(key, Math.ceil(w * TEX_SCALE), Math.ceil(h * TEX_SCALE));
  if (!tex) return;
  const c = tex.getContext();
  c.save();
  c.scale(TEX_SCALE, TEX_SCALE);
  c.translate(ax, ay);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  draw(c);
  c.restore();
  tex.refresh();
  info.set(key, { ox: ax / w, oy: ay / h });
}

const circle = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
const ell = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill(); };
const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
const hash = (i: number, j: number, s: number) => { const x = Math.sin(i * 12.9898 + j * 78.233 + s * 3.17) * 43758.5453; return x - Math.floor(x); };

export function buildTextures(scene: Phaser.Scene): void {
  const rnd = mulberry32(11);

  // ---------- skyline tiles (day and night versions are cross-faded) ----------
  const buildings: { x: number; w: number; h: number; s: number }[] = [];
  for (let x = 0; x < SKY_TILE - 80;) { const w = 60 + rnd() * 90, h = 80 + rnd() * 170; buildings.push({ x, w, h, s: rnd() * 100 }); x += w + 4 + rnd() * 20; }
  for (const night of [false, true]) {
    make(scene, night ? 'skyline-night' : 'skyline-day', SKY_TILE, 260, 0, 260, c => {
      for (const b of buildings) {
        c.fillStyle = night ? '#18142f' : '#6a4a80';
        c.fillRect(b.x, -b.h, b.w, b.h);
        c.fillStyle = '#ffd27a';
        const litP = night ? 0.55 : 0.1;
        for (let wy = 14; wy < b.h - 18; wy += 22) for (let wx = 9; wx < b.w - 12; wx += 17) {
          if (hash(wx, wy, b.s) < litP) { c.globalAlpha = night ? 0.85 : 0.25; c.fillRect(b.x + wx, -b.h + wy, 7, 9); }
        }
        c.globalAlpha = 1;
      }
    });
  }

  // ---------- tree tiles ----------
  const trees: { x: number; r: number; h: number }[] = [];
  for (let x = 60; x < TREE_TILE - 60;) { trees.push({ x, r: 24 + rnd() * 20, h: 50 + rnd() * 40 }); x += 130 + rnd() * 210; }
  for (const night of [false, true]) {
    make(scene, night ? 'trees-night' : 'trees-day', TREE_TILE, 150, 0, 150, c => {
      for (const t of trees) {
        c.fillStyle = night ? '#110f22' : '#3e2a4f'; c.fillRect(t.x - 3, -t.h, 6, t.h);
        c.fillStyle = night ? '#1a1735' : '#5b3b70';
        circle(c, t.x, -t.h - t.r * 0.4, t.r); circle(c, t.x - t.r * 0.6, -t.h + t.r * 0.1, t.r * 0.7); circle(c, t.x + t.r * 0.6, -t.h + t.r * 0.1, t.r * 0.7);
      }
    });
  }

  // ---------- soft glow (used for lamps, sun, window) ----------
  make(scene, 'glow', 200, 200, 100, 100, c => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 100);
    g.addColorStop(0, 'rgba(255,214,140,0.9)'); g.addColorStop(0.35, 'rgba(255,210,122,0.35)'); g.addColorStop(1, 'rgba(255,210,122,0)');
    c.fillStyle = g; c.fillRect(-100, -100, 200, 200);
  });

  // ---------- moon (crescent cut with destination-out) ----------
  make(scene, 'moon', 44, 44, 22, 22, c => {
    c.fillStyle = '#f3ecff'; circle(c, 0, 0, 18);
    c.globalCompositeOperation = 'destination-out'; circle(c, 7, -4, 16.2); c.globalCompositeOperation = 'source-over';
  });

  // ---------- street furniture ----------
  make(scene, 'lamp', 40, 180, 4, 178, c => {
    c.fillStyle = '#2a2140'; c.fillRect(-2.5, -168, 5, 170); c.fillRect(-2.5, -170, 22, 4); c.fillRect(10, -173, 18, 7);
  });
  make(scene, 'bulb-on', 20, 10, 10, 5, c => { c.fillStyle = '#ffe2a0'; ell(c, 0, 0, 7, 3); });
  make(scene, 'bulb-off', 20, 10, 10, 5, c => { c.fillStyle = '#7d7192'; ell(c, 0, 0, 7, 3); });

  make(scene, 'sign', 40, 52, 20, 50, c => {
    c.strokeStyle = '#2a2140'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-10, 0); c.lineTo(-3, -36); c.moveTo(10, 0); c.lineTo(3, -36); c.stroke();
    c.fillStyle = '#ff8a3d'; rr(c, -17, -48, 34, 20, 3);
    c.save(); c.beginPath(); c.rect(-17, -48, 34, 20); c.clip();
    c.fillStyle = '#fff6ef';
    for (let i = -2; i < 4; i++) { c.beginPath(); c.moveTo(i * 12 - 4, -48); c.lineTo(i * 12 + 2, -48); c.lineTo(i * 12 - 8, -28); c.lineTo(i * 12 - 14, -28); c.fill(); }
    c.restore();
  });

  // ---------- obstacles ----------
  make(scene, 'cone', 28, 32, 14, 31, c => {
    c.fillStyle = '#ff8a3d'; c.beginPath(); c.moveTo(-9, -1); c.lineTo(9, -1); c.lineTo(1.5, -28); c.lineTo(-1.5, -28); c.closePath(); c.fill();
    c.fillStyle = '#fff6ef'; c.beginPath(); c.moveTo(-5.6, -11); c.lineTo(5.6, -11); c.lineTo(4.2, -16); c.lineTo(-4.2, -16); c.closePath(); c.fill();
    c.fillStyle = '#d9602a'; c.fillRect(-12, -3, 24, 4);
  });
  make(scene, 'hydrant', 30, 46, 15, 45, c => {
    c.fillStyle = '#e2413b'; rr(c, -8, -30, 16, 30, 3);
    c.beginPath(); c.arc(0, -30, 8.5, Math.PI, 0); c.fill();
    c.fillRect(-12, -22, 24, 6);
    c.fillStyle = '#b5302b'; c.fillRect(-11, -4, 22, 4); c.fillRect(-2, -41, 4, 4);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(-5, -28, 3, 22);
  });
  make(scene, 'puddle', 80, 12, 40, 6, c => {
    c.fillStyle = '#7fb6e6'; ell(c, 0, 1.5, 36, 4.5);
    c.fillStyle = 'rgba(255,255,255,.45)'; ell(c, -10, 0.5, 9, 1.2);
  });
  make(scene, 'banana', 26, 16, 13, 14, c => {
    c.strokeStyle = '#ffd23f'; c.lineWidth = 4.5; c.beginPath(); c.arc(0, -12, 9, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
    c.fillStyle = '#6b4a1f'; circle(c, 7.5, -6.5, 1.6);
  });
  make(scene, 'pigeon', 28, 18, 14, 17, c => {
    c.fillStyle = '#8d90ab'; ell(c, 0, -6, 7, 5);
    c.fillStyle = '#6b6f8e'; circle(c, -6, -10, 3.4);
    c.beginPath(); c.moveTo(6, -7); c.lineTo(11, -10); c.lineTo(10, -5); c.fill();
    c.fillStyle = '#ff9a3d'; c.beginPath(); c.moveTo(-9, -10.5); c.lineTo(-12.5, -9.5); c.lineTo(-9, -8.5); c.fill();
    c.fillRect(-2, -2, 1.2, 2); c.fillRect(1, -2, 1.2, 2);
    c.fillStyle = '#1a1433'; circle(c, -7, -11, 0.9);
  });
  make(scene, 'flower', 30, 40, 15, 14, c => {
    c.strokeStyle = '#4caf6e'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(1, 16); c.stroke();
    c.fillStyle = '#4caf6e'; ell(c, 4, 9, 4, 2, -0.5);
    c.fillStyle = '#e8384f'; circle(c, 0, 0, 6);
    c.fillStyle = '#ff6b80'; circle(c, -2, -2, 3.2);
    c.strokeStyle = '#b0213a'; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 3, 0.5, 4.5); c.stroke();
  });
  make(scene, 'sparkle', 10, 10, 5, 5, c => { c.fillStyle = '#ffc857'; c.fillRect(-1, -3.5, 2, 7); c.fillRect(-3.5, -1, 7, 2); });
  make(scene, 'splat', 50, 10, 22, 5, c => {
    c.fillStyle = '#ff9ec4'; ell(c, 0, -1, 16, 3.5);
    c.fillStyle = '#c98a5b'; ell(c, -6, -2, 6, 2.5);
    c.fillStyle = '#fff0f6'; ell(c, 7, -2, 5, 2);
    c.fillStyle = '#f6f2ff'; ell(c, 20, -0.5, 6, 1.6);
  });

  // ---------- home ----------
  make(scene, 'house', 360, 290, 30, 288, c => {
    c.fillStyle = '#e9a98f'; c.fillRect(0, -190, 300, 192);
    c.fillStyle = '#8c3a57'; c.beginPath(); c.moveTo(-24, -188); c.lineTo(150, -282); c.lineTo(324, -188); c.closePath(); c.fill();
    c.fillRect(220, -270, 22, 50);
    c.fillStyle = '#ffd27a'; c.fillRect(170, -160, 80, 60);
    c.fillStyle = '#fff1e6'; c.fillRect(208, -160, 4, 60); c.fillRect(170, -132, 80, 4);
    c.fillStyle = '#5b2a45'; c.fillRect(68, -86, 44, 86);
    c.fillStyle = '#ffc857'; circle(c, 104, -42, 2.6);
    c.fillStyle = '#c79a9f'; c.fillRect(58, -4, 64, 5);
  });
  make(scene, 'door-open', 60, 92, 22, 88, c => {
    c.fillStyle = '#ffd27a'; c.fillRect(0, -86, 44, 86);
    c.fillStyle = '#5b2a45'; c.fillRect(-10, -88, 10, 88);
  });
  make(scene, 'silhouette', 40, 64, 16, 62, c => {
    c.fillStyle = '#7a4a63'; circle(c, 0, -52, 10); rr(c, -12, -41, 24, 41, 9);
  });
  make(scene, 'mailbox', 44, 72, 22, 70, c => {
    c.fillStyle = '#2a2140'; c.fillRect(-2, -50, 4, 50);
    c.fillStyle = '#ff6b4a'; rr(c, -19, -68, 38, 20, 5);
  });
}
