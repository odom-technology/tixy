'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_CELLS,
  rowOf,
  colOf,
  type Shot,
  type ShipPlacement,
  type ShipType,
} from '@/features/arcade/lib/battleship';
import './_battleship.css';

const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** Map a shot list to per-cell outcomes. */
function shotMap(shots: Shot[]): Map<number, Shot> {
  const m = new Map<number, Shot>();
  for (const s of shots) m.set(s.cell, s);
  return m;
}

function cellsOf(ships: Array<{ id: ShipType; cells: number[] }>): Set<number> {
  const set = new Set<number>();
  for (const ship of ships) for (const c of ship.cells) set.add(c);
  return set;
}

function CoordHeader() {
  return (
    <div className="bs-coords-x mb-1 px-[2px]">
      {COL_LETTERS.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enemy waters — the grid you FIRE into
// ---------------------------------------------------------------------------

/** Track which cells belong to ships that just got sunk, so we can flash them. */
function useNewlySunk(sunkShips: Array<{ id: ShipType; cells: number[] }>) {
  const prevCountRef = useRef(sunkShips.length);
  const [flashCells, setFlashCells] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (sunkShips.length > prevCountRef.current) {
      const newly = sunkShips.slice(prevCountRef.current);
      const cells = new Set<number>();
      for (const s of newly) for (const c of s.cells) cells.add(c);
      setFlashCells(cells);
      prevCountRef.current = sunkShips.length;
      const t = window.setTimeout(() => setFlashCells(new Set()), 1000);
      return () => window.clearTimeout(t);
    }
    prevCountRef.current = sunkShips.length;
  }, [sunkShips]);
  return flashCells;
}

export function FiringGrid({
  shots,
  sunkShips,
  interactive,
  onFire,
  lastCell,
  dim = false,
  maxWidth = 'min(92vw, 460px)',
}: {
  shots: Shot[];
  sunkShips: Array<{ id: ShipType; cells: number[] }>;
  interactive: boolean;
  onFire: (cell: number) => void;
  lastCell: number | null;
  dim?: boolean;
  maxWidth?: string;
}) {
  const shotsByCell = shotMap(shots);
  const sunkCells = cellsOf(sunkShips);
  const flashCells = useNewlySunk(sunkShips);

  // Pop the most recently resolved shot (and remember whether it landed).
  const prevCountRef = useRef(shots.length);
  const [poppedCell, setPoppedCell] = useState<number | null>(null);
  const [poppedKind, setPoppedKind] = useState<'hit' | 'miss' | 'sunk' | null>(null);
  useEffect(() => {
    if (shots.length > prevCountRef.current) {
      const last = shots[shots.length - 1];
      setPoppedCell(last.cell);
      setPoppedKind(last.outcome === 'sunk' ? 'sunk' : last.outcome === 'hit' ? 'hit' : 'miss');
    }
    prevCountRef.current = shots.length;
  }, [shots]);

  return (
    <div className="battleship-arcade w-full" style={{ maxWidth, opacity: dim ? 0.85 : 1 }}>
      <div className={['bs-cabinet', interactive ? 'bs-armed' : ''].join(' ')}>
        <div className="bs-playfield">
          <CoordHeader />
          <div className="bs-grid">
            {Array.from({ length: BOARD_CELLS }).map((_, i) => {
              const shot = shotsByCell.get(i);
              const isHit = shot && (shot.outcome === 'hit' || shot.outcome === 'sunk');
              const isMiss = shot && shot.outcome === 'miss';
              const isSunk = sunkCells.has(i);
              const fireable = interactive && !shot;
              const popped = poppedCell === i;
              const flashing = flashCells.has(i);
              const shake = popped && (poppedKind === 'hit' || poppedKind === 'sunk');
              return (
                <div
                  key={`fire-${i}`}
                  className={[
                    'bs-cell',
                    fireable ? 'bs-cell-fireable' : '',
                    lastCell === i ? 'bs-cell-last' : '',
                    flashing ? 'bs-cell-flash' : '',
                    shake ? 'bs-cell-shake' : '',
                  ].join(' ')}
                  role={fireable ? 'button' : undefined}
                  tabIndex={fireable ? 0 : undefined}
                  aria-label={fireable ? `Fire at ${COL_LETTERS[colOf(i)]}${rowOf(i) + 1}` : undefined}
                  onClick={() => { if (fireable) onFire(i); }}
                  onKeyDown={(e) => {
                    if (!fireable) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFire(i); }
                  }}
                >
                  {isHit && <span className={['bs-hit', isSunk ? 'bs-hit-sunk' : '', popped ? 'bs-pop' : ''].join(' ')} aria-hidden />}
                  {isMiss && <span className={['bs-miss', popped ? 'bs-pop' : ''].join(' ')} aria-hidden />}
                  {popped && poppedKind === 'miss' && <span className="bs-splash" aria-hidden />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your fleet — your ships + INCOMING shots
// ---------------------------------------------------------------------------

export function FleetGrid({
  board,
  incomingShots,
  sunkShips,
  maxWidth = 'min(92vw, 460px)',
}: {
  board: ShipPlacement[] | null;
  incomingShots: Shot[];
  sunkShips: Array<{ id: ShipType; cells: number[] }>;
  maxWidth?: string;
}) {
  const shipCells = board ? cellsOf(board) : new Set<number>();
  const sunkCells = cellsOf(sunkShips);
  const shotsByCell = shotMap(incomingShots);
  const flashCells = useNewlySunk(sunkShips);

  // Pop the most recently received incoming shot.
  const prevCountRef = useRef(incomingShots.length);
  const [poppedCell, setPoppedCell] = useState<number | null>(null);
  const [poppedKind, setPoppedKind] = useState<'hit' | 'miss' | 'sunk' | null>(null);
  useEffect(() => {
    if (incomingShots.length > prevCountRef.current) {
      const last = incomingShots[incomingShots.length - 1];
      setPoppedCell(last.cell);
      setPoppedKind(last.outcome === 'sunk' ? 'sunk' : last.outcome === 'hit' ? 'hit' : 'miss');
    }
    prevCountRef.current = incomingShots.length;
  }, [incomingShots]);

  return (
    <div className="battleship-arcade w-full" style={{ maxWidth }}>
      <div className="bs-cabinet">
        <div className="bs-playfield">
          <CoordHeader />
          <div className="bs-grid">
            {Array.from({ length: BOARD_CELLS }).map((_, i) => {
              const hasShip = shipCells.has(i);
              const shot = shotsByCell.get(i);
              const isHit = shot && (shot.outcome === 'hit' || shot.outcome === 'sunk');
              const isMiss = shot && shot.outcome === 'miss';
              const isSunk = sunkCells.has(i);
              const popped = poppedCell === i;
              const flashing = flashCells.has(i);
              const shake = popped && (poppedKind === 'hit' || poppedKind === 'sunk');
              return (
                <div
                  key={`fleet-${i}`}
                  className={[
                    'bs-cell',
                    isSunk ? 'bs-ship-sunk' : '',
                    flashing ? 'bs-cell-flash' : '',
                    shake ? 'bs-cell-shake' : '',
                  ].join(' ')}
                >
                  {hasShip && <span className="bs-ship-seg" aria-hidden />}
                  {isHit && <span className={['bs-hit', isSunk ? 'bs-hit-sunk' : '', popped ? 'bs-pop' : ''].join(' ')} aria-hidden />}
                  {isMiss && <span className={['bs-miss', popped ? 'bs-pop' : ''].join(' ')} aria-hidden />}
                  {popped && poppedKind === 'miss' && <span className="bs-splash" aria-hidden />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placement grid — drop ships during the placement phase
// ---------------------------------------------------------------------------

export function PlacementGrid({
  placedCells,
  ghostCells,
  ghostValid,
  onCellEnter,
  onCellLeave,
  onCellClick,
  maxWidth = 'min(92vw, 460px)',
}: {
  placedCells: Set<number>;
  ghostCells: number[] | null;
  ghostValid: boolean;
  onCellEnter: (cell: number) => void;
  onCellLeave: () => void;
  onCellClick: (cell: number) => void;
  maxWidth?: string;
}) {
  const ghostSet = ghostCells ? new Set(ghostCells) : null;
  return (
    <div className="battleship-arcade w-full" style={{ maxWidth }}>
      <div className="bs-cabinet">
        <div className="bs-playfield">
          <CoordHeader />
          <div className="bs-grid" onMouseLeave={onCellLeave}>
            {Array.from({ length: BOARD_CELLS }).map((_, i) => {
              const hasShip = placedCells.has(i);
              const isGhost = ghostSet?.has(i) ?? false;
              return (
                <div
                  key={`place-${i}`}
                  className="bs-cell bs-cell-place"
                  role="button"
                  tabIndex={0}
                  aria-label={`${COL_LETTERS[colOf(i)]}${rowOf(i) + 1}`}
                  onMouseEnter={() => onCellEnter(i)}
                  onFocus={() => onCellEnter(i)}
                  onClick={() => onCellClick(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick(i); }
                  }}
                >
                  {hasShip && !isGhost && <span className="bs-ship-seg" aria-hidden />}
                  {isGhost && <span className={['bs-ghost', ghostValid ? '' : 'bs-ghost-bad'].join(' ')} aria-hidden />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export { BOARD_COLS, BOARD_ROWS };
