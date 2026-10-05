/* ──────────────────────────────────────────────────────────────────────────
   Touch haptics — a tiny wrapper over navigator.vibrate. Cue names map to
   short, restrained patterns (this is a carnival cabinet, not a phone alarm).
   Silently no-ops where the API is missing (iOS Safari, desktops) or blocked.
   ────────────────────────────────────────────────────────────────────────── */

export type HapticCue =
  | 'tap'
  | 'tick'
  | 'light'
  | 'medium'
  | 'success'
  | 'win'
  | 'failure';

const PATTERNS: Record<HapticCue, number | number[]> = {
  tap: 8,
  /** Every scoring input: a peg, a tile, a point. Short enough to repeat. */
  tick: 6,
  light: 12,
  medium: 20,
  success: [14, 40, 22],
  /** A win: heavier and longer than success. */
  win: [24, 50, 36],
  failure: [26, 60, 26],
};

export function playHaptic(cue: HapticCue): void {
  if (typeof navigator === 'undefined') return;
  // Chromium logs a console error (rather than throwing) when vibrate is
  // called before the first user gesture. Some controlled inputs invoke their
  // onChange callback while hydrating, so guard the shared helper instead of
  // requiring every caller to distinguish initialization from interaction.
  const activation = (
    navigator as Navigator & {
      userActivation?: { hasBeenActive: boolean };
    }
  ).userActivation;
  if (activation && !activation.hasBeenActive) return;
  const vibrate = navigator.vibrate;
  if (typeof vibrate !== 'function') return;
  try {
    vibrate.call(navigator, PATTERNS[cue]);
  } catch {
    // Some browsers throw on vibrate without a user gesture — ignore.
  }
}

/** Feel kit: a light tick on every scoring input. */
export function hapticTick(): void {
  playHaptic('tick');
}

/** Feel kit: the heavier pattern for a win. */
export function hapticWin(): void {
  playHaptic('win');
}
