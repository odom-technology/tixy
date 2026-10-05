// ---------------------------------------------------------------------------
// Arcade — Coin flip game logic
// ---------------------------------------------------------------------------

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

export type CoinFlipSide = 'heads' | 'tails';

export type CoinFlipResult = {
  result: CoinFlipSide;
  pickedSide: CoinFlipSide;
  won: boolean;
  multiplier: number;
};

const COIN_FLIP_WIN_MULTIPLIER = ARCADE_RTP['arcade-coin-flip'] * 2;

export function resolveCoinFlip(
  seed: number,
  pickedSide: CoinFlipSide,
): CoinFlipResult {
  const rng = mulberry32(seed);
  const result: CoinFlipSide = rng() < 0.5 ? 'heads' : 'tails';
  const won = result === pickedSide;

  return {
    result,
    pickedSide,
    won,
    multiplier: won ? COIN_FLIP_WIN_MULTIPLIER : 0,
  };
}

export function computeCoinFlipPayout(
  wager: number,
  result: CoinFlipResult,
  seed: number,
): number {
  if (!result.won) return 0;
  return roundArcadePayout(
    wager * COIN_FLIP_WIN_MULTIPLIER,
    seed,
    `coin-flip:${result.pickedSide}`,
  );
}
