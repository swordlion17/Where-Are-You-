# itch.io page

Everything needed to put the web build on itch.io. Upload as a **Draft** first, check it, then make it public.

**Files** (made by `npm run package:web`, not in git):

- Game: `release/where-are-you-web-0.1.0.zip`
- Cover: `release/itch/cover.png` (1260×1000, itch's 630×500 ratio)
- Screenshots: `release/itch/01-texts.png`, `02-fall.png`, `03-night.png`, `04-end.png`

## 1. Create the project

itch.io → your avatar → **Upload new project**.

| Field | Value |
|---|---|
| Title | Where Are You? |
| Project URL | `where-are-you` |
| Short description or tagline | Get home with the cake before dinner. Your partner is texting. |
| Classification | Games |
| Kind of project | HTML |
| Release status | Prototype |
| Pricing | No payments |

## 2. Upload the game

- **Uploads** → *Upload files* → `where-are-you-web-0.1.0.zip`
- Tick **This file will be played in the browser**

## 3. Embed options

| Option | Value | Why |
|---|---|---|
| Embed in page | selected | |
| Viewport dimensions | 960 × 600 | Desktop gets the wide layout: phone top-right, long view of the street |
| Automatically start on page load | on | The game opens on its own menu, so nothing happens until the player taps Start |
| Fullscreen button | on | |
| Mobile friendly | on | |
| Orientation | Portrait | The phone layout is built for upright phones |
| Enable scrollbars | off | |
| SharedArrayBuffer support | off | Not used |

## 4. Description

Paste into **Description**:

> **Dinner is at 8:00. You promised to bring the cake.**
>
> One sidewalk between you and the door: puddles, banana peels, a dog that has opinions, a skater who doesn't look. Run and the cake wobbles. Fall and it splats. Meanwhile your phone keeps buzzing, and the texts get shorter.
>
> Answer them or leave them on read. Promise "5 min" if you dare. They're keeping track.
>
> **Controls**
> - **Phone:** tap JUMP, hold RUN, tap a reply on the phone
> - **Keyboard:** Space to jump, Shift or → to run
>
> Two nights so far: *Tuesday Dinner* and *Anniversary*. Pick girlfriend, boyfriend or partner and type their name. At the door you'll find out how they took it. Share it with them if you're brave.
>
> This is an early prototype. Tell us in the comments what made you laugh and what made you quit.

## 5. Details

| Field | Value |
|---|---|
| Genre | Platformer |
| Tags | Funny, Comedy, Runner, Casual, Short, Mobile, Romance, Cute, 2D, Singleplayer |
| AI generation disclosure | **Yes.** The code, the texts and the placeholder art and sound were made with Claude (the art and sound are drawn and synthesized by AI-written code). itch.io requires this to be disclosed. |
| Cover image | `release/itch/cover.png` |
| Screenshots | `01-texts.png`, `02-fall.png`, `03-night.png`, `04-end.png` (in that order) |
| Comments | Enabled. This is the feedback channel for Phase 0. |
| Visibility | **Draft** for now |

## 6. Check before going public

1. On desktop: the game starts, keyboard works after one click, sound plays after the first tap.
2. On a phone: the page shows *Run game*, it opens fullscreen and upright, and the buttons respond.
3. Finish a run and press **Share result**: a phone opens the share sheet, desktop says "Copied".
4. Then switch Visibility to **Public**.

## After the page exists

Shared results should end with a link to the game. Put the page URL in `src/config.ts` (`PLAY_URL`), run `npm run package:web` again, and replace the zip under *Uploads*.
