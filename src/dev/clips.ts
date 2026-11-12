import type { Relation } from '../sim/types';

/**
 * Scripted moments for short vertical clips (TikTok / Shorts / Reels). Rendered frame by frame with
 * `npm run clips`; see scripts/record-clips.mjs. Dev only, never part of the game build.
 *
 * Clock values are minutes relative to the route's deadline (-10 = ten minutes before dinner).
 * Obstacles are named by their `x` in the route JSON.
 */
export interface Segment {
  /** Play this many seconds off camera first (obstacles cleared), so time passes for a jump cut. */
  skip?: number;
  /** Applied after the skip. Negative x counts back from the finish line. */
  set?: { clock?: number; x?: number; cake?: number; mood?: number };
  /** Big caption over the first moments of the segment, e.g. "12 minutes later". */
  card?: string;
  /** Hold RUN (default true). */
  run?: boolean;
  /** Walk into these obstacles (route x) instead of jumping them. */
  hit?: number[];
  /** Jump for high flowers too. */
  flowers?: boolean;
  /** Reply key (from the script) → option to tap. Anything not listed is left on read. */
  replies?: Record<string, number>;
  /** When the segment ends: the end screen, a phone text containing this, or a duration. */
  until: 'over' | { text: string } | { seconds: number };
  /** Keep recording this long after `until` (default 0). */
  tail?: number;
  /** Freeze-frame the tail (after a moment for the last bubble to pop in), so nothing buries the punchline. */
  freeze?: boolean;
}

export interface ClipPlan {
  route: string;
  name?: string;
  relation?: Relation;
  /** Script id (default "classic"). */
  personality?: string;
  /** World seed, so falls look the same on every render. */
  seed?: number;
  /** Off-camera warm-up so the phone already has a few texts: start at this clock, play this long. */
  warm: { from: number; seconds: number };
  segments: Segment[];
}

export const CLIPS: Record<string, ClipPlan> = {
  // Promise "5 min", then everything goes wrong; ends on her text calling it out.
  'five-minutes': {
    route: 'tuesday',
    warm: { from: -13, seconds: 9 },
    segments: [{
      set: { x: 1900 },
      replies: { where: 1 },
      hit: [2160, 2950, 3800, 4460, 6180],
      until: { text: 'that was' },
      tail: 2.5,
      freeze: true,
    }],
  },

  // Ignore every text, cut to arriving 12 minutes late with no cake: "new phone who dis".
  'left-on-read': {
    route: 'tuesday',
    warm: { from: -13, seconds: 9 },
    segments: [
      { set: { x: 4300 }, hit: [4460, 5350], until: { seconds: 8.5 } },
      { skip: 36, set: { x: -720, cake: 0, mood: 30 }, card: '12 minutes later', hit: [8020], until: 'over', tail: 3 },
    ],
  },

  // The wholesome one: "omw!!", every flower, early, cake intact.
  'partner-of-the-year': {
    route: 'tuesday',
    warm: { from: -13.5, seconds: 9 },
    segments: [{ set: { x: 5700 }, replies: { where: 0 }, flowers: true, until: 'over', tail: 3 }],
  },

  // The worrier, rainy parents night: "omw!!", then the dot vanishes into a hole.
  'dot-disappeared': {
    route: 'parents',
    personality: 'worried',
    warm: { from: -13, seconds: 9 },
    segments: [{ set: { x: 2400 }, replies: { where: 0 }, hit: [3400], until: { text: 'DISAPPEARED' }, tail: 2.5, freeze: true }],
  },

  // The worrier, ignored: two puddles, a jump cut, and "i made posters."
  'missing-person': {
    route: 'parents',
    personality: 'worried',
    warm: { from: -13, seconds: 9 },
    segments: [
      { set: { x: 5100 }, hit: [5350, 5600], until: { seconds: 8 } },
      { skip: 45, set: { x: -650, cake: 0, mood: 25 }, card: '15 minutes later', hit: [8800], until: 'over', tail: 3 },
    ],
  },

  // Anniversary night: "omw!!", then straight into a hole. Short on purpose; loops well.
  underground: {
    route: 'anniversary',
    warm: { from: -11.5, seconds: 9 },
    segments: [{ set: { x: 2400 }, replies: { where: 0 }, hit: [3300], until: { text: 'underground' }, tail: 3 }],
  },
};
