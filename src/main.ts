import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import './styles.css';
import Phaser from 'phaser';
import { Game } from './game/Game';
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
if (import.meta.env.DEV) Object.assign(window, { __game: game, __phaser: phaser });

/** Canvas renders at device resolution, then is zoomed back to CSS size for crisp art on phones. */
function layout(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = stage.clientWidth, h = stage.clientHeight;
  phaser.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
  phaser.scale.setZoom(1 / dpr);
  const groundY = Math.min(h - 70, controlsEl.getBoundingClientRect().top - 14);
  if (scene.isCreated) scene.layout(w, h, dpr, groundY);
}

scene.onCreated = layout;
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
