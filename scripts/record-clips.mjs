// Renders the scripted clips in src/dev/clips.ts to vertical MP4s (1080x1920, 30 fps, with the game's sound) in release/clips/.
//
//   npm run clips                      all clips
//   npm run clips -- five-minutes      just one (or several)
//
// Starts its own Vite dev server, drives headless Edge/Chrome over the DevTools protocol, and pipes
// one screenshot per video frame into ffmpeg. Needs ffmpeg: on PATH, in ~/tools/ffmpeg-*/bin, or FFMPEG=path.
// Browser: Edge or Chrome in the usual place, or BROWSER=path.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const PORT = 5199;
const DEBUG_PORT = 9334;
const VIEW = { width: 360, height: 640, deviceScaleFactor: 3 }; // → 1080x1920
const FPS = 30;
const OUT = 'release/clips';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found. Set BROWSER=/path/to/browser.');
  return found;
}

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const tools = join(homedir(), 'tools');
  if (existsSync(tools)) {
    for (const d of readdirSync(tools).filter(n => n.startsWith('ffmpeg')).sort().reverse()) {
      const exe = join(tools, d, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (existsSync(exe)) return exe;
    }
  }
  return 'ffmpeg';
}

/** Minimal DevTools-protocol client for one page. */
async function connect(port) {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* starting */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('Browser did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function waitFor(page, expression, what, ms = 20000) {
  const t = Date.now();
  while (!(await page.evaluate(expression))) {
    if (Date.now() - t > ms) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

function encoder(ffmpeg, file) {
  const proc = spawn(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    // Screenshots are full-range sRGB JPEGs; convert to the limited-range BT.709 that phones and TikTok expect.
    '-vf', 'scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv,format=yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS), '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => proc.on('exit', code => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}`)))));
  return {
    write: buf => new Promise(res => (proc.stdin.write(buf) ? res() : proc.stdin.once('drain', res))),
    end: () => { proc.stdin.end(); return done; },
  };
}

async function recordClip(page, ffmpeg, name) {
  await page.send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await waitFor(page, `!!(window.__director && window.__phaser?.scene.getScene('street')?.isCreated && document.fonts.status === 'loaded')`, 'the game to load');
  await sleep(300);
  await page.evaluate(`(async () => { window.__clip = (await window.__director()).createDirector(${JSON.stringify(name)}); })()`);

  const file = join(OUT, `${name}.mp4`);
  const silent = join(OUT, `${name}.video.mp4`), wav = join(OUT, `${name}.wav`);
  const enc = encoder(ffmpeg, silent);
  const started = Date.now();
  let frames = 0;
  for (;;) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    await enc.write(Buffer.from(data, 'base64'));
    frames++;
    const r = await page.evaluate('window.__clip.frame()');
    if (r.done) break;
  }
  await enc.end();

  // Soundtrack: the game's own sounds, rendered offline from what it played while filming.
  writeFileSync(wav, Buffer.from(await page.evaluate('window.__clip.soundtrack()'), 'base64'));
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=14', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', '-movflags', '+faststart', file]);
  rmSync(silent); rmSync(wav);
  console.log(`  ${file}: ${(frames / FPS).toFixed(1)} s, ${frames} frames, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

function run(cmd, args) {
  return new Promise((res, rej) => spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    .on('exit', code => (code === 0 ? res() : rej(new Error(`${cmd} exited with ${code}`)))));
}

const ffmpeg = findFfmpeg();
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'warn', clearScreen: false });
await server.listen();
const profile = join(tmpdir(), `way-clips-${process.pid}`);
const browser = spawn(findBrowser(), [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let page;
try {
  page = await connect(DEBUG_PORT);
  await page.send('Emulation.setDeviceMetricsOverride', { ...VIEW, mobile: true });
  await page.send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await waitFor(page, '!!window.__director', 'the dev build');
  const all = await page.evaluate('(async () => (await window.__director()).clipNames())()');
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter(n => !all.includes(n));
  if (unknown.length) throw new Error(`Unknown clip(s): ${unknown.join(', ')}. Available: ${all.join(', ')}`);
  mkdirSync(OUT, { recursive: true });
  for (const name of wanted.length ? wanted : all) {
    console.log(`Recording ${name}...`);
    await recordClip(page, ffmpeg, name);
  }
} finally {
  page?.close();
  browser.kill();
  await server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold it */ }
}
