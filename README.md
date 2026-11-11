# Where Are You?

A one-thumb mobile game: get home with the cake before dinner while your partner's texts get shorter and colder.

Stack: **TypeScript + Phaser 4 + Vite**, packaged for Android (and later iOS) with **Capacitor 8**. The same build runs as a web page, which is what we link from TikTok/Shorts.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (first time only) |
| `npm run dev` | Dev server at http://localhost:5173, also reachable from a phone on the same Wi-Fi |
| `npm test` | Simulation and content tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production web build into `dist/` |
| `npm run cap:sync` | Build, then copy the web build into the Android project |
| `npm run android:open` | Open the Android project in Android Studio (Run ▶ installs it on a connected phone) |

Dev-only URL flag: `?timer` drives the game loop with `setTimeout` so automated browser tests keep running in a background tab. `window.__game` is exposed in dev builds for the same reason.

## Layout

```
src/
  sim/        Pure game logic. No Phaser, no DOM. Unit-tested.
    world.ts          player movement, obstacles, collisions, falls, cake damage → WorldEvents
    ragdoll.ts        Verlet stick-figure ragdoll for falls
    pose.ts           procedural walk/run/jump pose
    conversation.ts   their texts: schedule, reactions, quick replies, promises, mood → ConvEvents
    scoring.ts        rank + final lines at the door
  data/       Content. Edit these to add nights and texts; no code changes needed.
    routes/*.json     one file per night: times, length, intro texts, obstacles
    scripts/*.json    one file per partner personality: schedule, replies, reactions, endings
  game/Game.ts        state machine (title → play → ending → over); wires sim ↔ UI ↔ audio
  render/             Phaser scene + placeholder art (drawn in code; swap for PNGs by texture key)
  ui/                 DOM overlays: phone, HUD, thumb controls, start/end screens
  audio/sfx.ts        synthesized placeholder sound effects
  platform/           storage, haptics, native share (Capacitor on device, web fallbacks)
tests/sim.test.ts     content validation + a bot that must finish every route on time
prototype/            the original single-file prototype (reference only)
android/              Capacitor Android project (generated, committed)
```

### Adding a night

1. Copy `src/data/routes/tuesday.json`, change `id`, times, `length`, `intro`, `vars.food` and the obstacle list.
2. Add it to `ROUTES` in `src/data/index.ts`.
3. `npm test`: the bot has to finish it on time, and walking-only must end up late. If either fails, the layout needs work.

Script texts are written relative to the deadline (`"at": -10` = ten minutes before). `{deadline}` and any route `vars` such as `{food}` are filled in automatically.

### Replacing placeholder art

Every sprite comes from `src/render/textures.ts` under a key (`cone`, `hydrant`, `house`…). Load a PNG with the same key and the same anchor and the rest of the code doesn't change. The player, dog and skater are still drawn as vector shapes in `GameScene.ts`; those become sprite sheets when the art is ready.

## itch.io (web)

`npm run package:web` builds and zips `dist/` into `release/where-are-you-web-<version>.zip`, ready to upload as an HTML game. Page copy, embed settings and the upload checklist are in [docs/itch-page.md](docs/itch-page.md).

Things to know about running inside itch.io's iframe:

- Every HTML5 game on itch.io shares one domain (`html-classic.itch.zone`), so saved data uses the `whereareyou.` prefix.
- The iframe allows the share sheet but not the clipboard API. Sharing falls back to an older copy method, then to a text box the player copies by hand.
- `PLAY_URL` in `src/config.ts` is appended to shared results. Set it once the page exists.

## Android

Requires Android Studio and **JDK 21**. Android Studio's bundled JDK (25) is too new for the Gradle 8.14 that Capacitor ships, so builds fail with "Unsupported class file major version 69". A portable Temurin 21 lives in `~/.jdks/jdk-21.0.13+9`. In Android Studio pick it under *Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK*.

From the command line (Git Bash):

```bash
npm run cap:sync
cd android
JAVA_HOME="$USERPROFILE/.jdks/jdk-21.0.13+9" ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`.

The app ID is `com.cakegame.whereareyou` (confirmed). It is set in `capacitor.config.ts` and `android/app/build.gradle`, and can't be changed once the app is published.
