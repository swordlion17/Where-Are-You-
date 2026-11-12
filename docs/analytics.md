# Play stats (PostHog)

Anonymous events from the game tell us whether people who arrive from a clip actually play, finish, laugh and share. Code: `src/platform/analytics.ts`. Settings: `ANALYTICS` in `src/config.ts`.

## What is sent

| Event | When | Details |
|---|---|---|
| `game_loaded` | Page opens | portrait or not |
| `run_started` | Start walking / Walk again | route, relation (girlfriend/boyfriend/partner), attempt number this visit, whether the options were opened, whether a name other than "Sam" was typed (never the name) |
| `reply_tapped` | A reply is tapped | route, which text it answered (`where`, `four`...), which option |
| `run_finished` | End screen appears | route, attempt, seconds, rank, score, minutes late (negative = early), item (cake/soup), what was left of it (%) and how much spilled, falls, flowers, replies, left on read |
| `share_tapped` | Share result | route, rank, outcome (`image` = picture shared, `shared` = text only, `copied`, `failed`) |
| `run_quit` | Page closed mid-run | route, attempt, seconds, how far along (0–1), falls, cake % |

Every event also carries `app_version`, `platform` (web/android) and `embedded` (inside itch.io's frame or not).

What is **not** sent: the partner's name or anything else the player types; no cookies or local storage; no ID that survives a reload. Each page load gets a fresh random ID kept in memory, and events are marked anonymous (`$process_person_profile: false`), so PostHog creates no person profiles. Nothing is sent from dev builds (unless `?analytics` is in the URL) or when the browser sends Do Not Track or Global Privacy Control.

## One-time setup

1. Sign up at [posthog.com](https://posthog.com) (free tier). Choose **EU Cloud** when asked for a region.
2. Create a project named *Where Are You?*. Skip the SDK install steps; the game talks to the API directly.
3. **Project settings → Project API key** (starts with `phc_`): copy it. It is safe to share; it can only send events.
4. **Project settings**: turn on **Discard client IP data**.
5. Put the key in `src/config.ts` (`ANALYTICS.key`). If you chose US Cloud, set `host` to `https://us.i.posthog.com`.
6. Bump the version, `npm run package:web`, upload the new zip to itch.io (see [itch-page.md](itch-page.md#updating-the-game)).
7. Play one round on the itch.io page, then check **Activity** in PostHog: the events should appear within a minute.

Add this line to the itch.io description, under the controls:

> Anonymous play stats (no cookies, no personal data) help us tune the game.

## Dashboard

Make these in PostHog (**Product analytics → New insight**) and pin them to one dashboard:

1. **Funnel**: `game_loaded` → `run_started` → `run_finished` → `share_tapped`. The headline number for Phase 0.
2. **Endings**: Trends, `run_finished`, breakdown by `rank`.
3. **Where people quit**: Trends, `run_quit`, breakdown by `route`; add a second series with the average of `progress`.
4. **Replay rate**: Trends, `run_started`, breakdown by `attempt`. How many come back for a second walk.
5. **Replies**: Trends, `reply_tapped`, breakdown by `reply` then `option`. Which texts people answer, and how.

## Later, for Google Play

The Play Console's Data safety form must list this: app activity (in-app actions), collected, not shared, not linked to the user, used for analytics.
