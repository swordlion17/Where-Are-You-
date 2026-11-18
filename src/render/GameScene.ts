import Phaser from 'phaser';
import type { Game } from '../game/Game';
import { handsCenter, type Joints } from '../sim/pose';
import type { Vec } from '../sim/types';
import type { World } from '../sim/world';
import { buildTextures, SKY_TILE, TEX_SCALE, texOrigin, TREE_TILE } from './textures';

type Gfx = Phaser.GameObjects.Graphics;
type Img = Phaser.GameObjects.Image;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; r: number; color: number; g: number; bird?: boolean; flap?: number }
interface FloatText { obj: Phaser.GameObjects.Text; x: number; y: number; t: number; life: number }

const COLORS = {
  skin: 0xf1c4a1, hair: 0x3b2418, shirt: 0xff6b4a, shirtD: 0xcf4d33, pants: 0x2d2856, pantsD: 0x211d44, shoe: 0x17112b, ink: 0x1a1433,
};
const LAMP_GAP = 560;
const FONT = '"Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif';

/** Portrait framing, in world units. */
const PORTRAIT = {
  view: 350,       // visible street width (landscape shows ~820). Sets the zoom on a phone held upright.
  below: 120,      // sidewalk (50) plus a strip of road with its lane line, kept visible above the thumb buttons
  minAbove: 230,   // room above the sidewalk for lamps and the player's jump; zoom shrinks to keep it
  camFrac: 0.15,   // player's position from the left edge; the rest of the view is look-ahead
};
const SKYLINE_TOP = 250; // tallest building in the skyline texture

/** Where the street may draw, in CSS pixels: below the phone + HUD, above the thumb buttons. */
export interface Frame { w: number; h: number; dpr: number; top: number; bottom: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Per-channel multiply of two 0xRRGGBB colors (how tints combine). */
function multiply(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255) << s;
  return ch(16) | ch(8) | ch(0);
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/**
 * Draws the street. Three cameras: background (screen space), world (zoomed, follows the player),
 * and an overlay for floating text. Reads game state; never changes it.
 */
export class GameScene extends Phaser.Scene {
  private bgLayer!: Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private sky!: Gfx;
  private walk!: Gfx;
  private actors!: Gfx;
  private street!: Gfx;
  private sunGlow!: Img;
  private moon!: Img;
  private skyline: { day: Img[]; night: Img[] } = { day: [], night: [] };
  private treeImgs: { day: Img[]; night: Img[] } = { day: [], night: [] };
  private runObjs: Phaser.GameObjects.GameObject[] = [];
  private obstacleImgs = new Map<object, Img[]>();
  private glows: { img: Img; bulbOn: Img; bulbOff: Img }[] = [];
  private houseBits: { doorOpen: Img; sil: Img; winGlow: Img } | null = null;
  private parts: Particle[] = [];
  private floats: FloatText[] = [];
  private stars: { x: number; y: number; s: number; p: number }[] = [];
  private rain!: Gfx;
  private drops: { x: number; y: number; len: number; v: number }[] = [];
  private builtFor: World | null = null;

  private W = 1; private H = 1; private dpr = 1; private S = 1; private GY = 1;
  private portrait = true; private bgK = 1; private skyTop = 0;
  private camX = 0; private shake = 0; private elapsed = 0; private frameDt = 0;
  /** Render-only motion (no effect on gameplay): springs for squash, lean, head and item follow-through, camera lead. */
  private anim = { squash: 0, squashV: 0, lean: 0, lastSpeed: 0, head: 0, headV: 0, item: 0, itemV: 0, lastHipY: 0, lead: 0 };

  /** Set by main.ts; called once the scene exists so the first layout can run. */
  onCreated: (() => void) | null = null;
  private created = false;

  constructor(private readonly game2: Game) { super('street'); }

  get isCreated(): boolean { return this.created; }

  create(): void {
    buildTextures(this);
    this.bgLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    this.uiLayer = this.add.layer();
    this.worldCam = this.cameras.add(0, 0, 1, 1, false, 'world');
    this.uiCam = this.cameras.add(0, 0, 1, 1, false, 'ui');
    this.cameras.main.ignore([this.worldLayer, this.uiLayer]);
    this.worldCam.ignore([this.bgLayer, this.uiLayer]);
    this.uiCam.ignore([this.bgLayer, this.worldLayer]);

    this.sky = this.add.graphics(); this.bgLayer.add(this.sky);
    for (const kind of ['day', 'night'] as const) {
      for (let i = 0; i < 3; i++) {
        const t = this.add.image(0, 0, `trees-${kind}`).setOrigin(0, 1); this.treeImgs[kind].push(t);
      }
      for (let i = 0; i < 3; i++) {
        const s = this.add.image(0, 0, `skyline-${kind}`).setOrigin(0, 1); this.skyline[kind].push(s);
      }
    }
    this.sunGlow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD);
    this.moon = this.add.image(0, 0, 'moon');
    // Back-to-front in the background layer.
    this.bgLayer.add([this.sunGlow, ...this.skyline.day, ...this.skyline.night, this.moon, ...this.treeImgs.day, ...this.treeImgs.night]);

    this.walk = this.add.graphics().setDepth(0);
    this.actors = this.add.graphics().setDepth(10);
    this.street = this.add.graphics().setDepth(20);
    this.worldLayer.add([this.walk, this.actors, this.street]);

    const rnd = Phaser.Math.RND;
    this.stars = Array.from({ length: 70 }, () => ({ x: rnd.frac(), y: rnd.frac(), s: rnd.realInRange(0.5, 1.9), p: rnd.realInRange(0, 6) }));
    // Rain is drawn in screen space in front of the street, under the floating text.
    this.rain = this.add.graphics();
    this.uiLayer.add(this.rain);
    this.drops = Array.from({ length: 150 }, () => ({ x: rnd.frac(), y: rnd.frac(), len: rnd.realInRange(0.6, 1.2), v: rnd.realInRange(0.9, 1.3) }));
    this.created = true;
    this.onCreated?.();
  }

  /**
   * Called on every window resize. Portrait: the street fills the band between the HUD and the thumb
   * buttons, zoomed in, with the skyline scaled up to reach the HUD. Landscape: wide view, sidewalk just
   * above the buttons.
   */
  layout(f: Frame): void {
    const { w, h, dpr } = f;
    this.dpr = dpr;
    this.W = Math.round(w * dpr);
    this.H = Math.round(h * dpr);
    this.portrait = h >= w;
    let sCss: number, groundY: number;
    if (this.portrait) {
      const band = Math.max(1, f.bottom - f.top);
      sCss = clamp(w / PORTRAIT.view, 0.55, 1.6);
      if (band < (PORTRAIT.minAbove + PORTRAIT.below) * sCss) sCss = Math.max(0.55, band / (PORTRAIT.minAbove + PORTRAIT.below));
      groundY = f.bottom - PORTRAIT.below * sCss;
      this.bgK = clamp((groundY - f.top - 28) / (SKYLINE_TOP * sCss), 1, 1.6);
      this.skyTop = f.top * dpr;
    } else {
      sCss = clamp(Math.min(h / 430, w / 820), 0.55, 1.6);
      groundY = Math.min(h - 70, f.bottom - 14);
      // Same idea as portrait, so squarer windows don't show a wall of empty sky. The phone sits at the
      // top-right in landscape and simply covers the tallest buildings.
      this.bgK = clamp((groundY - f.top - 28) / (SKYLINE_TOP * sCss), 1, 1.6);
      this.skyTop = 0;
    }
    this.S = sCss * dpr;
    this.GY = Math.round(groundY * dpr);
    for (const cam of [this.cameras.main, this.worldCam, this.uiCam]) cam.setSize(this.W, this.H);
    this.worldCam.setZoom(this.S);
    this.snapCamera();
  }

  private get camFrac(): number { return this.portrait ? PORTRAIT.camFrac : 0.24; }
  private snapCamera(): void { this.camX = this.game2.world.focusX - (this.W / this.S) * this.camFrac; }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.033, Math.max(0, deltaMs / 1000));
    this.elapsed += dt;
    this.frameDt = dt;
    this.game2.update(dt);
    const w = this.game2.world;
    if (w !== this.builtFor) this.buildRun(w);
    this.consumeEvents();
    this.stepParticles(dt);
    // Lead the camera a little further when running, easing in and out so speed changes don't jolt the view.
    const viewW = this.W / this.S;
    const leadTarget = w.p.mode === 'normal' ? clamp((w.p.speed - 140) / 105, 0, 1) * viewW * 0.05 : 0;
    this.anim.lead += (leadTarget - this.anim.lead) * Math.min(1, dt * 2);
    this.camX += (w.focusX + this.anim.lead - viewW * this.camFrac - this.camX) * Math.min(1, dt * 5);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.draw(w);
  }

  // ------------------------------------------------------------------ per-run objects

  private place(key: string, x: number, y: number, depth: number): Img {
    const o = texOrigin(key);
    const img = this.add.image(x, y, key).setOrigin(o.ox, o.oy).setScale(1 / TEX_SCALE).setDepth(depth);
    this.worldLayer.add(img);
    this.runObjs.push(img);
    return img;
  }

  private buildRun(w: World): void {
    for (const o of this.runObjs) o.destroy();
    this.runObjs = []; this.obstacleImgs.clear(); this.glows = []; this.parts = [];
    for (const f of this.floats) f.obj.destroy();
    this.floats = [];
    this.builtFor = w;

    for (let lx = 260; lx < w.houseX - 60; lx += LAMP_GAP) {
      this.place('lamp', lx, 2, 1);
      const bulbOn = this.place('bulb-on', lx + 19, -164, 1.1);
      const bulbOff = this.place('bulb-off', lx + 19, -164, 1.1);
      const img = this.place('glow', lx + 19, -150, 30).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5);
      this.glows.push({ img, bulbOn, bulbOff });
    }
    this.place('house', w.houseX, 2, 2);
    this.place('mailbox', w.houseX - 36, 2, 3);
    const name = this.add.text(w.houseX - 36, -58, this.game2.partnerName.toUpperCase().slice(0, 8), {
      fontFamily: FONT, fontSize: '40px', fontStyle: '800', color: '#fff6ef',
    }).setOrigin(0.5).setScale(0.225).setDepth(3.1);
    this.worldLayer.add(name); this.runObjs.push(name);
    const winGlow = this.place('glow', w.houseX + 210, -130, 1.9).setBlendMode(Phaser.BlendModes.ADD).setScale(1.2).setAlpha(0.5);
    this.houseBits = {
      sil: this.place('silhouette', w.houseX + 214, -100, 2.1).setScale(0.4),
      doorOpen: this.place('door-open', w.doorX - 22, 0, 2.2).setVisible(false),
      winGlow,
    };
    for (const h of w.holes) this.place('sign', h.x - 56, 2, 3);
    for (const o of w.obstacles) {
      if (o.type === 'hole' || o.type === 'dog' || o.type === 'skater') continue;
      if (o.type === 'pigeons') { this.obstacleImgs.set(o, o.birds.map(dx => this.place('pigeon', o.x + dx, 1, 5))); continue; }
      const key = o.type === 'flower' ? 'flower' : o.type;
      const img = this.place(key, o.x, o.type === 'flower' ? o.fy : o.type === 'puddle' ? 0 : 1, o.type === 'puddle' ? 4 : 5);
      const imgs = [img];
      if (o.type === 'flower') imgs.push(this.place('sparkle', o.x + 11, o.fy - 9, 5.1));
      this.obstacleImgs.set(o, imgs);
    }
    this.snapCamera();
  }

  // ------------------------------------------------------------------ events → particles & floats

  private consumeEvents(): void {
    const w = this.game2.world;
    for (const e of this.game2.drainFx()) {
      switch (e.type) {
        case 'splat': {
          const soup = w.item.id === 'soup';
          const decal = this.place('splat', e.x, 0, 4);
          if (soup) decal.setData('baseTint', 0xe0893c); // multiplied with the time-of-day tint in draw()
          this.shake = Math.max(this.shake, 0.5);
          const cols = soup ? [0xe8893a, 0xf2b25c, 0xc8642a, 0xffd28a] : [0xff9ec4, 0xfff0f6, 0xc98a5b, 0xff6b8f];
          for (let i = 0; i < 22; i++) { const a = -Math.PI * Math.random(), v = 120 + Math.random() * 260; this.parts.push({ x: e.x, y: -4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.8 + Math.random() * 0.5, r: 1.8 + Math.random() * 3, color: cols[i % 4], g: 1 }); }
          break;
        }
        case 'spill': {
          // A few drops over the rim, flung the way the pot is tipping.
          const h = handsCenter(w.pose()), dir = Math.sign(w.p.tilt) || 1;
          for (let i = 0; i < 2; i++) this.parts.push({ x: h.x + dir * 9, y: h.y - 8, vx: w.p.speed * 0.6 + dir * (30 + Math.random() * 60), vy: -40 - Math.random() * 90, life: 0.7, r: 1.4 + Math.random() * 1.2, color: i ? 0xf2b25c : 0xe8893a, g: 1 });
          break;
        }
        case 'jump':
          this.anim.squashV -= 6; // stretch on take-off
          this.anim.itemV -= 30;
          break;
        case 'fall':
          this.shake = 0.7;
          if (e.cause === 'banana') this.parts.push({ x: e.x + 8, y: -6, vx: 260, vy: -300, life: 1.2, r: 3.5, color: 0xffd23f, g: 1 });
          break;
        case 'flower':
          for (let i = 0; i < 10; i++) this.parts.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 220, life: 0.6, r: 2, color: i % 2 ? 0xffc857 : 0xff6b80, g: 0.4 });
          break;
        case 'pigeons':
          for (const x of e.xs) this.parts.push({ bird: true, x, y: -8, vx: -40 - Math.random() * 140, vy: -170 - Math.random() * 140, life: 2.4, r: 0, color: 0x8d90ab, g: 0, flap: Math.random() * 6 });
          break;
        case 'land':
          // Squash on landing; the item dips and rebounds a beat later.
          this.anim.squashV += e.hard ? 9 : 6;
          this.anim.itemV += e.hard ? 70 : 45;
          for (let i = 0; i < 5; i++) this.parts.push({ x: e.x + (Math.random() - 0.5) * 16, y: -1, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 80, life: 0.35, r: 2, color: 0xf0dce6, g: 0.3 });
          break;
        case 'float':
          this.addFloat(e.text, e.x, e.y, e.color, e.size, e.life);
          break;
      }
    }
    for (const o of w.obstacles) {
      if (o.type === 'hydrant' && o.spray > 0) {
        for (let i = 0; i < 2; i++) this.parts.push({ x: o.x, y: -40, vx: (Math.random() - 0.5) * 140, vy: -280 - Math.random() * 220, life: 0.9, r: 2, color: 0x9fd0ff, g: 1 });
      }
    }
  }

  private addFloat(text: string, x: number, y: number, color: string, size: number, life: number): void {
    const obj = this.add.text(0, 0, text, {
      fontFamily: FONT, fontSize: `${Math.round(size * this.dpr)}px`, fontStyle: '800', color,
      stroke: 'rgba(26,20,51,0.85)', strokeThickness: Math.round(4 * this.dpr),
    }).setOrigin(0.5, 1);
    this.uiLayer.add(obj);
    this.floats.push({ obj, x, y, t: 0, life });
  }

  private stepParticles(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      if (p.bird) { p.vy -= 40 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.flap = (p.flap ?? 0) + dt * 22; continue; }
      p.vy += 1900 * 0.6 * p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > 0 && p.vy > 0) { p.y = 0; p.vy *= -0.25; p.vx *= 0.5; }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t > f.life) { f.obj.destroy(); this.floats.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ drawing

  private draw(w: World): void {
    const raining = this.game2.route.weather === 'rain';
    // Rain clouds make it dusk early: darker sky, tinted street, lamps on.
    const n = raining ? Math.max(this.game2.night, 0.55) : this.game2.night;
    const sx = this.shake > 0 && !this.game2.reducedMotion ? (Math.random() - 0.5) * this.shake * 10 * this.dpr : 0;
    const sy = this.shake > 0 && !this.game2.reducedMotion ? (Math.random() - 0.5) * this.shake * 8 * this.dpr : 0;
    this.drawSky(n, raining);
    this.drawParallax(n, sx, sy);

    const viewW = this.W / this.S;
    const x0 = this.camX - 80, x1 = this.camX + viewW + 80;
    this.worldCam.centerOn(this.camX + viewW / 2 - sx / this.S, -this.GY / this.S + (this.H / 2) / this.S - sy / this.S);

    const tint = mix(0xffffff, 0x8f84b8, n);
    for (const o of this.runObjs) {
      const img = o as Img;
      if (img.texture?.key === 'glow' || img.texture?.key === 'door-open' || !('setTint' in img)) continue;
      const base = img.getData('baseTint') as number | undefined;
      img.setTint(base === undefined ? tint : multiply(base, tint));
    }
    this.updateObstacleSprites(w);
    this.updateLamps(n);
    this.drawSidewalk(w, n, x0, x1);
    this.drawActors(w, x0, x1);
    this.drawStreet(n, x0, x1);
    this.drawRain(raining);
    this.drawFloats();
  }

  private drawRain(raining: boolean): void {
    const g = this.rain;
    g.clear();
    if (!raining || this.game2.reducedMotion) return;
    const W = this.W, H = this.H, dt = this.frameDt;
    const len = 22 * this.dpr, slant = 0.22;
    g.lineStyle(1.4 * this.dpr, 0xc9d3ff, 0.32);
    for (const d of this.drops) {
      d.y += d.v * dt * 1.6;
      d.x -= d.v * dt * 1.6 * slant * (H / W);
      if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
      if (d.x < 0) d.x += 1;
      const x = d.x * W, y = d.y * H, l = len * d.len;
      g.lineBetween(x, y, x + l * slant, y - l);
    }
  }

  private drawSky(n: number, overcast: boolean): void {
    const g = this.sky, W = this.W, H = this.H, GY = this.GY;
    g.clear();
    let top = mix(0x33255f, 0x090820, n), mid = mix(0x9c4f86, 0x1d1842, n), low = mix(0xffb07a, 0x3b2c5e, n);
    if (overcast) { top = mix(top, 0x2c3045, 0.6); mid = mix(mid, 0x3c4258, 0.6); low = mix(low, 0x55596e, 0.6); }
    g.fillStyle(mix(0x2b2350, 0x14112a, n), 1); g.fillRect(0, 0, W, H);
    g.fillGradientStyle(top, top, mid, mid, 1); g.fillRect(0, 0, W, GY * 0.55);
    g.fillGradientStyle(mid, mid, low, low, 1); g.fillRect(0, GY * 0.55 - 1, W, GY * 0.45 + 2);
    if (n > 0.05 && !overcast) {
      for (const s of this.stars) {
        g.fillStyle(0xfff6ef, n * (0.55 + 0.45 * Math.sin(this.elapsed * 1.7 + s.p)));
        g.fillRect(s.x * W, s.y * GY * 0.8, s.s * this.dpr, s.s * this.dpr);
      }
    }
    const sunX = W * 0.7, sunY = GY - (150 * this.bgK - n * 190) * this.S;
    const sun = overcast ? 0 : 1 - n;
    g.fillStyle(0xffd796, sun); g.fillCircle(sunX, sunY, 40 * this.S);
    this.sunGlow.setPosition(sunX, sunY).setScale((this.S * 1.4) / TEX_SCALE).setAlpha(0.6 * sun);
    const moonY = this.portrait ? Math.max(this.skyTop + 46 * this.S, GY - 430 * this.S) : Math.max(GY * 0.42, GY - 430 * this.S);
    this.moon.setPosition(W * 0.84, moonY).setScale(this.S / TEX_SCALE).setAlpha(overcast ? 0 : clamp((n - 0.2) / 0.8, 0, 1));
  }

  private drawParallax(n: number, sx: number, sy: number): void {
    // In portrait the skyline (and, less so, the trees) is drawn larger so it rises to the HUD. Scroll speed
    // on screen stays the same.
    const layers: [Img[], Img[], number, number, number][] = [
      [this.skyline.day, this.skyline.night, 0.22, SKY_TILE, this.bgK],
      [this.treeImgs.day, this.treeImgs.night, 0.5, TREE_TILE, 1 + (this.bgK - 1) * 0.6],
    ];
    for (const [day, night, par, tile, k] of layers) {
      const tileW = tile * k;
      const off = this.camX * par;
      const k0 = Math.floor(off / tileW);
      for (let i = 0; i < 3; i++) {
        const x = ((k0 + i) * tileW - off) * this.S + sx;
        for (const [img, a] of [[day[i], 1 - n], [night[i], n]] as const) {
          img.setPosition(x, this.GY + 2 * this.dpr + sy).setScale((this.S * k) / TEX_SCALE).setAlpha(a).setVisible(a > 0.01 && x < this.W);
        }
      }
    }
  }

  private updateObstacleSprites(w: World): void {
    for (const o of w.obstacles) {
      const imgs = this.obstacleImgs.get(o);
      if (!imgs) continue;
      switch (o.type) {
        case 'flower': {
          const y = o.fy + Math.sin(this.elapsed * 3 + o.x) * 3;
          imgs[0].setVisible(!o.hit).setY(y);
          imgs[1].setVisible(!o.hit).setY(y - 9).setAlpha(0.5 + 0.5 * Math.sin(this.elapsed * 5 + o.x));
          break;
        }
        case 'pigeons':
          imgs.forEach((img, i) => img.setVisible(!o.hit).setY(1 - Math.max(0, Math.sin(this.elapsed * 3 + i * 1.7)) * 1.5));
          break;
        case 'banana': imgs[0].setVisible(!o.hit); break;
        case 'cone': imgs[0].setRotation(o.rot).setX(o.x + o.rot * 6); break;
        default: break;
      }
    }
    if (this.houseBits) {
      const open = w.doorOpen;
      this.houseBits.doorOpen.setVisible(open);
      if (open) this.houseBits.sil.setPosition(w.doorX + 4, 0).setScale(0.5);
    }
  }

  private updateLamps(n: number): void {
    const on = n > 0.12, a = clamp((n - 0.12) * 1.6, 0, 1);
    for (const l of this.glows) {
      l.img.setAlpha(0.55 * a).setVisible(on);
      l.bulbOn.setVisible(on); l.bulbOff.setVisible(!on);
    }
    if (this.houseBits) this.houseBits.winGlow.setAlpha(0.25 + 0.45 * n);
  }

  private drawSidewalk(w: World, n: number, x0: number, x1: number): void {
    const g = this.walk;
    g.clear();
    g.fillStyle(mix(0xd8b4c0, 0x4a3f66, n), 1); g.fillRect(x0, 0, x1 - x0, 42);
    g.fillStyle(mix(0xf0d3d8, 0x5d5180, n), 1); g.fillRect(x0, -1, x1 - x0, 4);
    g.fillStyle(mix(0xb5919f, 0x3a3155, n), 1);
    for (let x = Math.floor(x0 / 64) * 64; x < x1; x += 64) g.fillRect(x, 3, 2, 39);
    g.fillStyle(mix(0x9b7487, 0x2a2342, n), 1); g.fillRect(x0, 42, x1 - x0, 8);
    for (const h of w.holes) {
      if (h.x1 < x0 || h.x > x1) continue;
      g.fillStyle(0x120d20, 1); g.fillRect(h.x, -1, h.x1 - h.x, 51);
      g.fillStyle(0x2a2040, 1); g.fillRect(h.x, -1, 5, 51); g.fillRect(h.x1 - 5, -1, 5, 51);
    }
  }

  private drawStreet(n: number, x0: number, x1: number): void {
    const g = this.street;
    g.clear();
    const bottom = (this.H - this.GY) / this.S + 40;
    g.fillStyle(mix(0x4a3d5c, 0x1b1729, n), 1); g.fillRect(x0, 50, x1 - x0, bottom);
    g.fillStyle(mix(0xffd27a, 0x8a7a4a, n), 0.7);
    for (let x = Math.floor(x0 / 140) * 140; x < x1; x += 140) g.fillRect(x, 104, 70, 5);
  }

  private drawActors(w: World, x0: number, x1: number): void {
    const g = this.actors;
    g.clear();
    for (const o of w.obstacles) {
      if (o.x < x0 - 60 || o.x > x1 + 60) continue;
      if (o.type === 'dog') this.drawDog(g, o.x, o.t, o.active);
      else if (o.type === 'skater') this.drawSkater(g, o.x, o.active);
    }
    const p = w.p;
    const j = this.animatePose(w, w.pose());
    if (p.mode !== 'hole' || p.y < 60) {
      if (p.mode !== 'hole') { g.fillStyle(0x140e28, 0.25); g.fillEllipse(j.hip.x, 1, 32 * (1 - clamp(-p.y / 220, 0, 0.6)) * (1 + this.anim.squash * 0.6), 6); }
      this.drawPerson(g, j, w.holdingCake ? { tilt: p.tilt, hp: w.cake, dy: this.anim.item } : null, w.dazed);
    }
    if (w.flyCake) this.drawItem(g, w.flyCake.x, w.flyCake.y, w.flyCake.rot, w.flyCake.hp);
    for (const q of this.parts) {
      const a = Math.min(1, q.life / 0.4);
      if (q.bird) {
        const wing = Math.sin(q.flap ?? 0) * 5;
        this.limb(g, [{ x: q.x - 7, y: q.y - wing }, { x: q.x, y: q.y }, { x: q.x + 7, y: q.y - wing }], 2.2, q.color, a);
        g.fillStyle(q.color, a); g.fillCircle(q.x, q.y, 2.6);
      } else { g.fillStyle(q.color, a); g.fillCircle(q.x, q.y, q.r); }
    }
  }

  private drawFloats(): void {
    for (const f of this.floats) {
      const a = clamp(1 - (f.t - f.life * 0.6) / (f.life * 0.4), 0, 1);
      // Text for something on screen stays fully on screen (the player stands close to the left edge in
      // portrait). Text for something off screen, like a dog barking up ahead, stays off screen.
      const half = f.obj.width / 2, pad = 8 * this.dpr;
      let x = (f.x - this.camX) * this.S;
      if (x >= 0 && x <= this.W) x = half * 2 + pad * 2 < this.W ? clamp(x, half + pad, this.W - half - pad) : this.W / 2;
      f.obj.setPosition(x, this.GY + (f.y - f.t * 28) * this.S).setAlpha(a);
    }
  }

  // ------------------------------------------------------------------ characters (placeholder vector art)

  /** Polyline with round joints and caps. */
  private limb(g: Gfx, pts: Vec[], width: number, color: number, alpha = 1): void {
    g.lineStyle(width, color, alpha);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    g.fillStyle(color, alpha);
    for (const p of pts) g.fillCircle(p.x, p.y, width / 2);
  }

  /**
   * Follow-through on top of the procedural pose: squash and stretch around the feet, a lean into
   * speed changes, and a head that lags the body's bob. Springs advance by the frame's dt.
   */
  private animatePose(w: World, j: Joints): Joints {
    const a = this.anim, p = w.p, dt = Math.max(1e-4, this.frameDt);
    const spring = (x: number, v: number, k: number, c: number): [number, number] => {
      v += (-k * x - c * v) * dt;
      return [x + v * dt, v];
    };
    [a.squash, a.squashV] = spring(a.squash, a.squashV, 260, 16);
    [a.item, a.itemV] = spring(a.item, a.itemV, 180, 9);
    const upright = p.mode === 'normal' || p.mode === 'done';
    const accel = upright ? (p.speed - a.lastSpeed) / dt : 0;
    a.lastSpeed = p.speed;
    a.lean += (clamp(accel / 1600, -1, 1) - a.lean) * Math.min(1, dt * 6);
    // Head lags the hip's vertical motion (a little overlap on every step and landing).
    const hipVy = (j.hip.y - a.lastHipY) / dt;
    a.lastHipY = j.hip.y;
    a.headV += clamp(-hipVy, -400, 400) * 0.06 * dt * 60;
    [a.head, a.headV] = spring(a.head, a.headV, 320, 18);
    if (!upright || this.game2.reducedMotion) return j;

    const sq = clamp(a.squash, -0.25, 0.3), baseY = p.y, hipX = j.hip.x;
    const out = {} as Joints;
    for (const k of Object.keys(j) as (keyof Joints)[]) {
      const q = j[k];
      const height = baseY - q.y; // above the feet
      let x = hipX + (q.x - hipX) * (1 + sq * 0.5);
      const y = baseY - height * (1 - sq);
      // Lean the upper body into acceleration, back when braking.
      if (k !== 'kneeL' && k !== 'kneeR' && k !== 'footL' && k !== 'footR' && k !== 'hip') x += a.lean * 7 * clamp(height / 70, 0, 1.2);
      out[k] = { x, y };
    }
    out.head = { x: out.head.x, y: out.head.y + clamp(a.head, -3, 3) };
    return out;
  }

  private drawPerson(g: Gfx, j: Joints, cake: { tilt: number; hp: number; dy?: number } | null, dazed: boolean): void {
    this.limb(g, [j.neck, j.elbowR, j.handR], 5.5, COLORS.shirtD);
    g.fillStyle(COLORS.skin, 1); g.fillCircle(j.handR.x, j.handR.y, 2.6);
    this.limb(g, [j.hip, j.kneeR, j.footR], 7.5, COLORS.pantsD);
    g.fillStyle(COLORS.shoe, 1); g.fillEllipse(j.footR.x + 2.5, j.footR.y - 1, 10, 6);
    this.limb(g, [j.hip, j.neck], 14, COLORS.shirt);
    this.limb(g, [j.hip, j.kneeL, j.footL], 7.5, COLORS.pants);
    g.fillStyle(COLORS.shoe, 1); g.fillEllipse(j.footL.x + 2.5, j.footL.y - 1, 10, 6);
    this.drawHead(g, j, dazed);
    if (cake) { const h = handsCenter(j); this.drawItem(g, h.x, h.y + clamp(cake.dy ?? 0, -5, 5), cake.tilt, cake.hp); }
    this.limb(g, [j.neck, j.elbowL, j.handL], 5.5, COLORS.shirt);
    g.fillStyle(COLORS.skin, 1); g.fillCircle(j.handL.x, j.handL.y, 3);
  }

  private drawHead(g: Gfx, j: Joints, dazed: boolean): void {
    const ang = Math.atan2(j.head.y - j.neck.y, j.head.x - j.neck.x) + Math.PI / 2;
    g.save(); g.translateCanvas(j.head.x, j.head.y); g.rotateCanvas(ang);
    g.fillStyle(COLORS.skin, 1); g.fillCircle(0, 0, 10);
    g.fillStyle(COLORS.hair, 1);
    g.beginPath(); g.arc(0, 0, 10.8, Math.PI * 0.95, Math.PI * 2.05); g.closePath(); g.fillPath();
    g.fillEllipse(-5, -2, 12, 14);
    if (dazed) {
      g.lineStyle(1.6, COLORS.ink, 1); g.lineBetween(3, -3, 7, 1); g.lineBetween(7, -3, 3, 1);
    } else { g.fillStyle(COLORS.ink, 1); g.fillCircle(5, -0.5, 1.5); }
    g.fillStyle(0xff6e82, 0.45); g.fillCircle(4, 4, 2.4);
    g.restore();
  }

  private drawItem(g: Gfx, x: number, y: number, rot: number, hp: number): void {
    if (this.game2.world.item.id === 'soup') this.drawSoup(g, x, y, rot, hp);
    else this.drawCake(g, x, y, rot, hp);
  }

  /** A pot carried by both handles: soup level follows `hp`, steam while there's enough left. */
  private drawSoup(g: Gfx, x: number, y: number, rot: number, hp: number): void {
    g.save(); g.translateCanvas(x, y); g.rotateCanvas(rot);
    const w = 13, h = 15, f = Math.max(0, hp) / 100;
    g.fillStyle(0x2f3550, 1); g.fillRoundedRect(-w - 6, -h + 2, 6, 3.4, 1.5); g.fillRoundedRect(w, -h + 2, 6, 3.4, 1.5);
    g.fillStyle(0x434c6b, 1); g.fillRoundedRect(-w, -h, 2 * w, h, { tl: 2, tr: 2, bl: 6, br: 6 });
    g.fillStyle(0x59648a, 1); g.fillRect(-w + 3, -h + 4, 3, h - 7);
    g.fillStyle(0x2a2f47, 1); g.fillEllipse(0, -h, 2 * w + 2, 7);
    if (f > 0) {
      g.fillStyle(0xe8893a, 1); g.fillEllipse(0, -h + 0.5, (2 * w - 2) * (0.45 + 0.55 * f), 4.4 * (0.5 + 0.5 * f));
      g.fillStyle(0xf6b35f, 1); g.fillEllipse(-3, -h, 5 * f + 1, 1.4);
    }
    g.restore();
    if (f > 0.3) {
      // Steam stays upright whatever the pot does.
      for (let i = 0; i < 3; i++) {
        const t = (this.elapsed * 0.9 + i / 3) % 1;
        g.fillStyle(0xffffff, 0.35 * (1 - t) * f);
        g.fillCircle(x - 6 + i * 6 + Math.sin(this.elapsed * 3 + i * 2) * 2, y - h - 4 - t * 16, 2.2 + t * 2.5);
      }
    }
  }

  private drawCake(g: Gfx, x: number, y: number, rot: number, hp: number): void {
    g.save(); g.translateCanvas(x, y); g.rotateCanvas(rot);
    g.fillStyle(0xf6f2ff, 1); g.fillEllipse(0, 0, 34, 6);
    g.fillStyle(0xd9d0ea, 1); g.fillEllipse(0, 1.3, 28, 3);
    if (hp <= 0) {
      g.fillStyle(0xc98a5b, 1); g.fillCircle(-5, -2, 2); g.fillCircle(3, -1.8, 1.5);
      g.fillStyle(0xff9ec4, 1); g.fillCircle(7, -2, 1.8);
      g.restore(); return;
    }
    const f = hp / 100, h = 5 + 13 * f, w = 8 + 5 * f + (1 - f) * 3;
    g.fillStyle(0xc98a5b, 1); g.fillRoundedRect(-w, -h, 2 * w, h, 3);
    g.fillStyle(0xfff0f6, 1); g.fillRect(-w, -h * 0.55, 2 * w, 2);
    g.fillStyle(0xff8fbd, 1); g.fillRoundedRect(-w - 1, -h - 3, 2 * w + 2, 6, 3);
    for (let i = 0; i < 4; i++) g.fillCircle(-w + 3 + (i * (2 * w - 6)) / 3, -h + 3, 1.7);
    if (hp > 55) {
      g.fillStyle(0xfff6ef, 1); g.fillRect(-1.2, -h - 11, 2.4, 8);
      g.fillStyle(0xffc857, 1); g.fillEllipse(0, -h - 13.5 + Math.sin(this.elapsed * 20) * 0.4, 3.6, 6);
    }
    g.restore();
  }

  private drawDog(g: Gfx, x: number, t: number, moving: boolean): void {
    const la = Math.sin(t * 18) * 5 * (moving ? 1 : 0);
    for (const [dx, a] of [[-11, la], [-6, -la], [9, -la], [14, la]]) this.limb(g, [{ x: x + dx, y: -13 }, { x: x + dx + a, y: -1 }], 3.5, 0x7a4f2c);
    this.limb(g, [{ x: x + 17, y: -20 }, { x: x + 25, y: -28 + Math.sin(this.elapsed * 25) * 3 }], 3.5, 0x7a4f2c);
    g.fillStyle(0xb9814f, 1); g.fillEllipse(x + 2, -17, 34, 17);
    g.fillCircle(x - 15, -24, 8.5); g.fillEllipse(x - 22, -21, 12, 8);
    g.fillStyle(0x7a4f2c, 1); g.fillEllipse(x - 11, -27, 7, 13);
    g.fillStyle(COLORS.ink, 1); g.fillCircle(x - 27, -22, 1.8); g.fillCircle(x - 17, -26, 1.4);
    g.fillStyle(0xff6b4a, 1); g.fillRect(x - 11, -21, 3, 8);
  }

  private drawSkater(g: Gfx, x: number, moving: boolean): void {
    if (moving) {
      g.lineStyle(2, 0xfff6ef, 0.35);
      g.lineBetween(x + 20, -30, x + 40, -30); g.lineBetween(x + 22, -44, x + 46, -44); g.lineBetween(x + 20, -16, x + 36, -16);
    }
    g.fillStyle(0x2b2350, 1); g.fillRoundedRect(x - 17, -8, 34, 3.5, 1.5);
    g.fillStyle(0xffc857, 1); g.fillCircle(x - 11, -3, 2.6); g.fillCircle(x + 11, -3, 2.6);
    this.limb(g, [{ x: x + 1, y: -34 }, { x: x - 4, y: -21 }, { x: x - 8, y: -9 }], 6.5, 0x2d2856);
    this.limb(g, [{ x: x + 1, y: -34 }, { x: x + 7, y: -21 }, { x: x + 8, y: -9 }], 6.5, 0x2d2856);
    this.limb(g, [{ x: x + 1, y: -34 }, { x: x - 4, y: -55 }], 13, 0x3fb68b);
    this.limb(g, [{ x: x - 4, y: -52 }, { x: x - 17, y: -46 }, { x: x - 26, y: -50 }], 5, 0x3fb68b);
    this.limb(g, [{ x: x - 4, y: -52 }, { x: x + 10, y: -44 }, { x: x + 20, y: -40 }], 5, 0x3fb68b);
    g.fillStyle(COLORS.skin, 1); g.fillCircle(x - 7, -65, 9);
    g.fillStyle(0x2b2350, 1); g.beginPath(); g.arc(x - 7, -66, 9.6, Math.PI, 0); g.closePath(); g.fillPath();
    g.fillStyle(COLORS.ink, 1); g.fillCircle(x - 12, -64, 1.4);
  }
}
