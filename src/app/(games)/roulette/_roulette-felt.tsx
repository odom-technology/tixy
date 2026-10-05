'use client';

/* Roulette felt — the European single-zero bet board.
 *
 * Built as a CSS grid: a tall green 0 cell on the left, then a 12-column ×
 * 3-row number block (top row 3,6,9…36 per real felt orientation), the three
 * 2:1 column bets down the right edge, the three dozen bars beneath, and the
 * six even-money outside bets along the bottom. Between the numbers sit thin
 * interstitial "hit zones" for splits, streets, corners and six-lines so the
 * board plays like a real felt — click a number for a straight, the seam
 * between two numbers for a split, the line under a column of three for a
 * street, the cross where four numbers meet for a corner, and the outer seam
 * between two streets for a six-line. Every spot carries the exact pockets it
 * covers so the server can re-derive membership.
 *
 * Pure layout + chip placement; all wager logic lives in the client. Nothing
 * glows — flat enamel red/black numbers, green 0, cream chips on lacquered felt.
 */

import { type CSSProperties } from 'react';
import {
  RED_NUMBERS,
  ROULETTE_ODDS,
  type RouletteBet,
  type RouletteBetType,
} from '@/server/arcade/wager-games/roulette';

const RED_SET = new Set<number>(RED_NUMBERS);

export function feltColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_SET.has(n) ? 'red' : 'black';
}

/* ── Bet spot model ──────────────────────────────────────────────────────
   A spot is one clickable target on the felt. `key` is a stable id used to
   stack chips; `pockets` are the covered numbers (empty for condition-based
   outside bets). `label` shows on outside bets. */

export type RouletteSpot = {
  key: string;
  type: RouletteBetType;
  /** Covered pockets (0–36). Empty for condition-based outside bets. */
  pockets: number[];
  /** Display label for outside / wide bets. */
  label?: string;
};

/** Convert a placed spot + chip total into the wire RouletteBet. */
export function spotToBet(spot: RouletteSpot, amount: number): RouletteBet {
  return { type: spot.type, numbers: [...spot.pockets], amount };
}

/** Total return multiple for a spot (stake-inclusive), for the UI tooltip. */
export function spotMultiple(type: RouletteBetType): number {
  return ROULETTE_ODDS[type];
}

/* ── Felt geometry ───────────────────────────────────────────────────────
   The number block is 12 columns × 3 rows. Real European felt runs the TOP
   row as 3,6,9,…,36 and the BOTTOM row as 1,4,7,…,34, with the column index
   c (0..11) giving numbers (3c+1, 3c+2, 3c+3). We render rows top→bottom as
   r=0 → 3c+3, r=1 → 3c+2, r=2 → 3c+1 so the classic layout reads correctly. */

export const FELT_COLUMNS = 12;
export const FELT_ROWS = 3;

/** Number at grid (row r 0..2, column c 0..11). */
export function numberAt(r: number, c: number): number {
  return 3 * c + (3 - r);
}

/** The three "2 to 1" column bets (right edge). Column index 0 = top row set. */
function columnSpots(): RouletteSpot[] {
  const spots: RouletteSpot[] = [];
  for (let r = 0; r < FELT_ROWS; r++) {
    const pockets: number[] = [];
    for (let c = 0; c < FELT_COLUMNS; c++) pockets.push(numberAt(r, c));
    spots.push({
      key: `column:${r}`,
      type: 'column',
      pockets: pockets.sort((a, b) => a - b),
      label: '2:1',
    });
  }
  return spots;
}

/** The three dozen bars: 1–12, 13–24, 25–36. */
function dozenSpots(): RouletteSpot[] {
  const ranges: Array<[number, number, string]> = [
    [1, 12, '1st 12'],
    [13, 24, '2nd 12'],
    [25, 36, '3rd 12'],
  ];
  return ranges.map(([lo, hi, label]) => {
    const pockets: number[] = [];
    for (let n = lo; n <= hi; n++) pockets.push(n);
    return { key: `dozen:${lo}`, type: 'dozen' as const, pockets, label };
  });
}

/** The six even-money outside bets (condition based — no explicit pockets). */
export const OUTSIDE_EVEN_SPOTS: RouletteSpot[] = [
  { key: 'low', type: 'low', pockets: [], label: '1–18' },
  { key: 'even', type: 'even', pockets: [], label: 'even' },
  { key: 'red', type: 'red', pockets: [], label: 'red' },
  { key: 'black', type: 'black', pockets: [], label: 'black' },
  { key: 'odd', type: 'odd', pockets: [], label: 'odd' },
  { key: 'high', type: 'high', pockets: [], label: '19–36' },
];

export const COLUMN_SPOTS = columnSpots();
export const DOZEN_SPOTS = dozenSpots();

/* Interstitial inside-bet seams between numbers. We generate:
   - vertical splits  (numbers stacked in the same column, r & r+1)
   - horizontal splits (adjacent columns, same row)
   - streets          (a row of 3 in one column index → bottom edge of column)
   - corners          (4 numbers meeting at a column/row intersection)
   - six-lines        (two adjacent streets → outer bottom seam)
   Each seam knows its covered pockets. */

export type SeamSpot = RouletteSpot & {
  /** Placement on the number grid in fractional grid units (for absolute
   *  positioning over the 12×3 block). col/row are 0-based grid lines. */
  gx: number; // 0..FELT_COLUMNS  (vertical grid line position)
  gy: number; // 0..FELT_ROWS     (horizontal grid line position)
  orient: 'v' | 'h' | 'cross';
};

export function buildSeams(): SeamSpot[] {
  const seams: SeamSpot[] = [];

  // Vertical splits — between row r and r+1 in the same column c.
  for (let c = 0; c < FELT_COLUMNS; c++) {
    for (let r = 0; r < FELT_ROWS - 1; r++) {
      const a = numberAt(r, c);
      const b = numberAt(r + 1, c);
      const pockets = [a, b].sort((x, y) => x - y);
      seams.push({
        key: `split:v:${pockets.join('-')}`,
        type: 'split',
        pockets,
        gx: c + 0.5,
        gy: r + 1,
        orient: 'h', // visual seam runs horizontally between stacked cells
      });
    }
  }

  // Horizontal splits — between column c and c+1 in the same row r.
  for (let c = 0; c < FELT_COLUMNS - 1; c++) {
    for (let r = 0; r < FELT_ROWS; r++) {
      const a = numberAt(r, c);
      const b = numberAt(r, c + 1);
      const pockets = [a, b].sort((x, y) => x - y);
      seams.push({
        key: `split:h:${pockets.join('-')}`,
        type: 'split',
        pockets,
        gx: c + 1,
        gy: r + 0.5,
        orient: 'v', // visual seam runs vertically between side-by-side cells
      });
    }
  }

  // Corners — 4 numbers around the interior cross of columns c/c+1, rows r/r+1.
  for (let c = 0; c < FELT_COLUMNS - 1; c++) {
    for (let r = 0; r < FELT_ROWS - 1; r++) {
      const pockets = [
        numberAt(r, c),
        numberAt(r, c + 1),
        numberAt(r + 1, c),
        numberAt(r + 1, c + 1),
      ].sort((x, y) => x - y);
      seams.push({
        key: `corner:${pockets.join('-')}`,
        type: 'corner',
        pockets,
        gx: c + 1,
        gy: r + 1,
        orient: 'cross',
      });
    }
  }

  // Streets — the 3 numbers in column index c (the full vertical strip). Placed
  // on the TOP outer edge of the block (gy = 0) at the column centre.
  for (let c = 0; c < FELT_COLUMNS; c++) {
    const pockets = [numberAt(0, c), numberAt(1, c), numberAt(2, c)].sort(
      (x, y) => x - y,
    );
    seams.push({
      key: `street:${pockets.join('-')}`,
      type: 'street',
      pockets,
      gx: c + 0.5,
      gy: 0,
      orient: 'cross',
    });
  }

  // Six-lines — two adjacent streets (columns c & c+1) → outer top seam at the
  // boundary between them (gy = 0, gx = c+1).
  for (let c = 0; c < FELT_COLUMNS - 1; c++) {
    const pockets = [
      numberAt(0, c),
      numberAt(1, c),
      numberAt(2, c),
      numberAt(0, c + 1),
      numberAt(1, c + 1),
      numberAt(2, c + 1),
    ].sort((x, y) => x - y);
    seams.push({
      key: `six:${pockets.join('-')}`,
      type: 'six-line',
      pockets,
      gx: c + 1,
      gy: 0,
      orient: 'cross',
    });
  }

  return seams;
}

export const SEAM_SPOTS = buildSeams();

/* ── Chip ────────────────────────────────────────────────────────────────
   A cream keycap chip with the denomination painted on. Stacks show the
   summed amount. Sizes flex with the cell. */

export function ChipDisc({
  amount,
  size = 'md',
  highlight = false,
}: {
  amount: number;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  return (
    <span
      className={`rl-chip rl-chip-${size}${highlight ? ' rl-chip-hot' : ''}`}
      aria-hidden
    >
      <span className='rl-chip-face'>{compactChip(amount)}</span>
    </span>
  );
}

/** Compact chip label (1.2k, 15k, 1.5M) so big stacks still fit a disc. */
export function compactChip(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  const v = n / 1_000_000;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
}

/** Inline style helper to place a seam hit-zone over the number block using
 *  grid-line fractions. The block is a 12×3 grid; we position by percentage. */
export function seamStyle(seam: SeamSpot): CSSProperties {
  const leftPct = (seam.gx / FELT_COLUMNS) * 100;
  const topPct = (seam.gy / FELT_ROWS) * 100;
  return { left: `${leftPct}%`, top: `${topPct}%` };
}
