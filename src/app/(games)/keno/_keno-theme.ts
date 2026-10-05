// ---------------------------------------------------------------------------
// Keno cosmetic theme — built from the user's equipped inventory items.
//
// The board is DOM (not canvas); the client feeds these values into scoped CSS
// custom properties. Defaults reference the tixy tokens (var(--…)) so an
// EMPTY loadout renders identically to the stock cabinet look. Equipped
// skins overlay concrete hex colours on top.
//
// Slots (registered in the shared reward-slot registry — rewards.ts):
//   spots      → the picked-spot enamel + the "hit" (picked & drawn) enamel
//   balls      → the drawn-number "ball" token (a drawn number you did not pick)
//   background → the board well backdrop + accent
// ---------------------------------------------------------------------------

export type KenoCosmeticTheme = {
  // spots slot — a spot the player picked, before/without a hit
  pickBg: string;
  pickHi: string;
  pickOn: string;
  // spots slot — a picked spot that was drawn (a hit)
  hitBg: string;
  hitHi: string;
  hitOn: string;
  // balls slot — a drawn number the player did NOT pick
  ballBg: string;
  ballHi: string;
  ballOn: string;
  // background slot
  boardWell: string;
  accent: string;
};

/** Stock tixy look: your pick is paper, a hit is red, a drawn number you did
 *  not pick is a quiet ring on the screen. Flat, so the Hi values (the top of
 *  the old enamel ramp) are the same colours as their bases. */
export const DEFAULT_KENO_THEME: KenoCosmeticTheme = {
  pickBg: 'var(--tixy-paper)',
  pickHi: 'var(--tixy-paper)',
  pickOn: 'var(--tixy-ink)',
  hitBg: 'var(--tixy-red)',
  hitHi: 'var(--tixy-red)',
  hitOn: 'var(--tixy-on-red)',
  ballBg: 'var(--tixy-screen-2)',
  ballHi: 'var(--tixy-screen-2)',
  ballOn: 'var(--tixy-paper)',
  boardWell: 'var(--tixy-screen)',
  accent: 'var(--tixy-on-ink-2)',
};

const str = (
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string => {
  const v = ref?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
};

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

export function buildKenoTheme(
  response: InventoryCosmeticResponse,
): KenoCosmeticTheme {
  const theme: KenoCosmeticTheme = { ...DEFAULT_KENO_THEME };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const ref = equipped?.item?.assetRef ?? null;
    if (!slot || !ref) continue;

    if (slot === 'spots') {
      theme.pickBg = str(ref, 'pickColor', str(ref, 'pickBg', theme.pickBg));
      theme.pickHi = str(ref, 'pickHi', theme.pickBg);
      theme.pickOn = str(ref, 'pickOn', theme.pickOn);
      theme.hitBg = str(ref, 'hitColor', str(ref, 'hitBg', theme.hitBg));
      theme.hitHi = str(ref, 'hitHi', theme.hitBg);
      theme.hitOn = str(ref, 'hitOn', theme.hitOn);
    } else if (slot === 'balls') {
      theme.ballBg = str(ref, 'ballColor', str(ref, 'ballBg', theme.ballBg));
      theme.ballHi = str(ref, 'ballHi', theme.ballBg);
      theme.ballOn = str(ref, 'ballOn', theme.ballOn);
    } else if (slot === 'background') {
      theme.boardWell = str(ref, 'wellColor', str(ref, 'boardWell', theme.boardWell));
      theme.accent = str(ref, 'accent', str(ref, 'accentColor', theme.accent));
    }
  }

  return theme;
}
