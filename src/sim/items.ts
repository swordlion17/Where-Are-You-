/**
 * What you carry home. The world keeps one number for its condition (0-100, `World.cake`); the
 * item decides how falls hurt it and whether it spills when it wobbles.
 */
export type ItemId = 'cake' | 'soup';

export interface ItemDef {
  id: ItemId;
  /** Used in texts ({item}) and the UI: "cake", "soup". */
  word: string;
  /** {itemEmoji} in texts, HUD and share card. */
  emoji: string;
  /** Condition lost per kind of mishap. */
  damage: { slip: number; hit: number; trip: number; hole: number; pigeons: number; hardLanding: number };
  /**
   * Spilling: every radian of wobble beyond `spillTilt` loses `spill` % per second. Walking barely
   * wobbles; running, jumps and landings do. 0 = never spills.
   */
  spill: number;
  spillTilt: number;
  /** Shown after the first fall. */
  scoop: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  cake: {
    id: 'cake', word: 'cake', emoji: '🎂',
    damage: { slip: 25, hit: 22, trip: 30, hole: 20, pigeons: 4, hardLanding: 2 },
    spill: 0, spillTilt: 1,
    scoop: '*scoops the cake back on the plate*',
  },
  soup: {
    id: 'soup', word: 'soup', emoji: '🍲',
    damage: { slip: 30, hit: 26, trip: 34, hole: 26, pigeons: 5, hardLanding: 0 }, // landings already slosh it
    spill: 110, spillTilt: 0.12,
    scoop: '*scoops the soup back into the pot*',
  },
};

export function itemById(id: string | undefined): ItemDef {
  return ITEMS[id as ItemId] ?? ITEMS.cake;
}

/** Template values every text can use: {item} and {itemEmoji}. */
export function itemVars(id: string | undefined): { item: string; itemEmoji: string } {
  const item = itemById(id);
  return { item: item.word, itemEmoji: item.emoji };
}
