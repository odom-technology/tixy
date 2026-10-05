/**
 * Offline BANK VERIFICATION — independently re-proves every puzzle in the
 * checked-in Blitz Tactics bank.
 *
 *   npx tsx scripts/verify-blitz-tactics-bank.ts
 *
 * For each puzzle it RE-DERIVES the forced-mate uniqueness straight from the FEN
 * with chess.js (exhaustive search — no trust in the stored solution), then
 * confirms the stored solution's first move matches the uniquely-forcing move,
 * that the stored line is legal, and that it ends in checkmate. Exits non-zero
 * if ANY puzzle fails, so this doubles as a CI guard against a corrupted bank.
 *
 * This is the "machine-verified uniqueness" proof: the heart of the build.
 */
import { Chess } from 'chess.js';
import { BLITZ_PUZZLES } from '@/server/arcade/data/blitz-tactics-puzzles';

const byLan = (a: { lan: string }, b: { lan: string }) =>
  a.lan < b.lan ? -1 : a.lan > b.lan ? 1 : 0;

function hasMateInOne(g: Chess): boolean {
  for (const m of g.moves({ verbose: true })) {
    g.move(m);
    const mate = g.isCheckmate();
    g.undo();
    if (mate) return true;
  }
  return false;
}

/** Re-derive the unique forced-mate descriptor from a FEN (white to move). */
function analyze(fen: string): { mateIn: 1 | 2; firstMove: string } | null {
  let g: Chess;
  try {
    g = new Chess(fen);
  } catch {
    return null;
  }
  if (g.turn() !== 'w' || g.isGameOver()) return null;
  const moves = g.moves({ verbose: true });
  if (moves.length === 0) return null;

  // Unique mate-in-1?
  let m1: { lan: string } | null = null;
  let m1Count = 0;
  for (const m of moves) {
    g.move(m);
    const mate = g.isCheckmate();
    g.undo();
    if (mate) {
      m1Count += 1;
      m1 = m;
      if (m1Count > 1) break;
    }
  }
  if (m1Count === 1 && m1) return { mateIn: 1, firstMove: m1.lan };
  if (m1Count > 1) return null;

  // Unique forcing mate-in-2?
  let forcing: { lan: string } | null = null;
  let forcingCount = 0;
  for (const w of moves) {
    g.move(w);
    if (g.isCheckmate()) {
      g.undo();
      continue;
    }
    const replies = g.moves({ verbose: true });
    let allMate = replies.length > 0;
    for (const r of replies) {
      g.move(r);
      const ok = hasMateInOne(g);
      g.undo();
      if (!ok) {
        allMate = false;
        break;
      }
    }
    g.undo();
    if (allMate) {
      forcingCount += 1;
      forcing = w;
      if (forcingCount > 1) break;
    }
  }
  if (forcingCount === 1 && forcing) return { mateIn: 2, firstMove: forcing.lan };
  return null;
}

let ok = 0;
const failures: string[] = [];

for (let i = 0; i < BLITZ_PUZZLES.length; i += 1) {
  const p = BLITZ_PUZZLES[i];
  const a = analyze(p.fen);
  if (!a) {
    failures.push(`#${i} (${p.fen}): no unique forced mate found`);
    continue;
  }
  if (a.mateIn !== p.mateIn) {
    failures.push(`#${i}: stored mateIn ${p.mateIn} but derived ${a.mateIn}`);
    continue;
  }
  if (a.firstMove.toLowerCase() !== p.solution[0].toLowerCase()) {
    failures.push(
      `#${i}: stored first move ${p.solution[0]} != unique forcing move ${a.firstMove}`,
    );
    continue;
  }
  // Stored line must be legal and end in checkmate.
  const g = new Chess(p.fen);
  let legal = true;
  for (const mv of p.solution) {
    try {
      g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv.slice(4, 5) || undefined) as never });
    } catch {
      legal = false;
      break;
    }
  }
  if (!legal) {
    failures.push(`#${i}: stored line has an illegal move`);
    continue;
  }
  if (!g.isCheckmate()) {
    failures.push(`#${i}: stored line does not end in checkmate`);
    continue;
  }
  // Sanity: solution length matches mate distance (1 → len 1, 2 → len 3).
  const expectedLen = p.mateIn === 1 ? 1 : 3;
  if (p.solution.length !== expectedLen) {
    failures.push(`#${i}: solution length ${p.solution.length} != ${expectedLen} for mate-in-${p.mateIn}`);
    continue;
  }
  ok += 1;
}

const m1 = BLITZ_PUZZLES.filter((p) => p.mateIn === 1).length;
const bandCounts = [0, 1, 2, 3, 4].map(
  (b) => BLITZ_PUZZLES.filter((p) => p.band === b).length,
);
// avoid unused byLan warning (kept for parity with the generator's tie-break)
void byLan;

console.log(`Blitz Tactics bank: ${BLITZ_PUZZLES.length} puzzles`);
console.log(`  mate-in-1: ${m1}   mate-in-2: ${BLITZ_PUZZLES.length - m1}`);
console.log(`  bands [0..4]: [${bandCounts.join(', ')}]`);
console.log(`  re-verified OK: ${ok} / ${BLITZ_PUZZLES.length}`);

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length}):`);
  for (const f of failures.slice(0, 30)) console.error('  ' + f);
  process.exit(1);
}
console.log('\nALL PUZZLES PASS — every entry is a unique-first-move forced mate.');
