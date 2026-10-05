/** A new best is a score above 0 and above the best the run started with.
 *  The in-game moment (`useNewBestMoment`) and the result card use this one
 *  rule, so they agree. */
export function isNewBest(score: number, bestAtRunStart: number): boolean {
  return Number.isFinite(score) && score > 0 && score > Math.max(0, bestAtRunStart || 0);
}
