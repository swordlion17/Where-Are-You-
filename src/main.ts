import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import './styles.css';
import Phaser from 'phaser';
import { Game } from './game/Game';
import { analytics } from './platform/analytics';
import { platformName } from './platform/device';
import { GameScene } from './render/GameScene';
import { Controls } from './ui/controls';
import { byId } from './ui/dom';
import { Hud } from './ui/hud';
import { Phone } from './ui/phone';
import { EndScreen, StartScreen } from './ui/screens';

const stage = byId('stage');
const controlsEl = byId('controls');

let game: Game;
const start = new StartScreen(c => game.start(c));
game = new Game(start.choice().routeId);
const end = new EndScreen(() => game.start(start.choice()), () => game.toMenu(), () => game.share());
game.attach({
  phone: new Phone(game.reducedMotion),
  hud: new Hud(),
  controls: new Controls(stage),
  start,
  end,
});
start.onRoute(id => game.preview(id));

const scene = new GameScene(game);
const phaser = new Phaser.Game({
  type: Phaser.AUTO,
  parent: stage,
  backgroundColor: '#1a1433',
  width: 1,
  height: 1,
  scale: { mode: Phaser.Scale.NONE },
  render: { antialias: true, powerPreference: 'high-performance' },
  // Dev only: ?timer drives the loop with setTimeout so automated tests run in background tabs.
  fps: { forceSetTimeOut: import.meta.env.DEV && new URLSearchParams(location.search).has('timer') },
  banner: false,
  scene: [scene],
});
// Dev only: hooks for automated checks, and the clip director used by `npm run clips`.
if (import.meta.env.DEV) Object.assign(window, { __game: game, __phaser: phaser, __director: () => import('./dev/director') });

const hudEl = byId('hud');
const repliesEl = byId('replies');

/** Canvas renders at device resolution, then is zoomed back to CSS size for crisp art on phones. */
function layout(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = stage.clientWidth, h = stage.clientHeight;
  phaser.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
  phaser.scale.setZoom(1 / dpr);
  // The street's band: below the phone + HUD and above the thumb buttons. Reply buttons come and go,
  // so when the HUD sits under the phone their height is left out, keeping the street from jumping.
  const hud = hudEl.getBoundingClientRect();
  const hudUnderPhone = hud.top >= byId('phone').getBoundingClientRect().bottom - 1;
  const top = hud.bottom - (hudUnderPhone ? repliesEl.offsetHeight : 0);
  const bottom = controlsEl.getBoundingClientRect().top;
  if (scene.isCreated) scene.layout({ w, h, dpr, top, bottom });
}

scene.onCreated = layout;
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
document.fonts?.ready.then(layout).catch(() => {});

// Anonymous play stats (no-ops unless configured; see src/platform/analytics.ts).
let embedded = true;
try { embedded = window.top !== window.self; } catch { /* cross-origin parent: embedded */ }
analytics.setBase({ app_version: __APP_VERSION__, platform: platformName, embedded });
analytics.track('game_loaded', { portrait: window.innerHeight >= window.innerWidth });
window.addEventListener('pagehide', () => game.leaving());
