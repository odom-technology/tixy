// ---------------------------------------------------------------------------
// Arcade — Plinko game logic
// ---------------------------------------------------------------------------

import {
  PLINKO_ALLOWED_ROWS,
  PLINKO_ALLOWED_RISKS,
  PLINKO_MULTIPLIERS,
  PLINKO_RTP_FACTORS,
  type PlinkoRisk,
  type PlinkoRows,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

export type PlinkoConfig = {
  rows: PlinkoRows;
  risk: PlinkoRisk;
};

export type PlinkoResult = {
  /** Sequence of bounces for client animation. */
  path: ('L' | 'R')[];
  /** Which slot (0..rows) the ball landed in. */
  slotIndex: number;
  rows: PlinkoRows;
  risk: PlinkoRisk;
  /** Display multiplier from the payout table. */
  multiplier: number;
};

/** Validate plinko configuration from client. */
export function validatePlinkoConfig(config: unknown): PlinkoConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;

  const rows = c.rows;
  if (
    typeof rows !== 'number' ||
    !(PLINKO_ALLOWED_ROWS as readonly number[]).includes(rows)
  ) {
    return null;
  }

  const risk = c.risk;
  if (
    typeof risk !== 'string' ||
    !(PLINKO_ALLOWED_RISKS as readonly string[]).includes(risk)
  ) {
    return null;
  }

  return { rows: rows as PlinkoRows, risk: risk as PlinkoRisk };
}

/** Resolve the plinko outcome from a seed. */
export function resolvePlinko(
  seed: number,
  rows: PlinkoRows,
  risk: PlinkoRisk,
): PlinkoResult {
  const rng = mulberry32(deriveSubSeed(seed, 'plinko-path'));
  const path: ('L' | 'R')[] = [];
  let position = 0;

  for (let i = 0; i < rows; i++) {
    const goRight = rng() >= 0.5;
    path.push(goRight ? 'R' : 'L');
    if (goRight) position++;
  }

  const multiplier = PLINKO_MULTIPLIERS[risk][rows][position] ?? 0;

  return { path, slotIndex: position, rows, risk, multiplier };
}

/** Compute plinko payout with RTP correction factor applied. */
export function computePlinkoPayout(
  wager: number,
  result: PlinkoResult,
  seed: number,
): number {
  if (result.multiplier <= 0) return 0;
  const factor = PLINKO_RTP_FACTORS[result.risk][result.rows];
  return roundArcadePayout(
    wager * result.multiplier * factor,
    seed,
    `plinko:${result.risk}:${result.rows}:${result.slotIndex}`,
  );
}
