export type WagerCelebrationTier = 'standard' | 'big' | 'jackpot';

export type WagerCelebrationInput = {
  amount: number;
  stake?: number;
  multiplier?: number | null;
  net?: number | null;
  jackpot?: boolean;
};

/**
 * One honest outcome classification shared by result cards, stage feedback,
 * sound, and HUD tone. Gross returns are judged relative to their debited
 * stake so a large-looking partial return never receives big-win treatment.
 */
export function getWagerCelebrationTier({
  amount,
  stake = 0,
  multiplier,
  net,
  jackpot = false,
}: WagerCelebrationInput): WagerCelebrationTier {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const resolvedMultiplier =
    multiplier != null && Number.isFinite(multiplier)
      ? multiplier
      : stake > 0
        ? safeAmount / stake
        : 0;

  if (stake > 0) {
    const profit = net ?? safeAmount - stake;
    if (profit <= 0) return 'standard';
    if (jackpot || resolvedMultiplier >= 10 || profit >= 5000) return 'jackpot';
    if (resolvedMultiplier >= 3 || profit >= 1000) return 'big';
    return 'standard';
  }

  if (jackpot || safeAmount >= 5000) return 'jackpot';
  if (safeAmount >= 1000) return 'big';
  return 'standard';
}

export function getWagerFeedbackEvent(
  input: WagerCelebrationInput & { won: boolean },
): 'loss' | 'round-win' | 'jackpot' {
  if (!input.won) return 'loss';
  return getWagerCelebrationTier(input) === 'standard'
    ? 'round-win'
    : 'jackpot';
}
