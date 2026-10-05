/**
 * Seed the Connections daily-puzzle pool.
 *
 *   npx tsx scripts/seed-connections.ts
 *
 * Idempotent: clears `connections_puzzles` and re-inserts the curated set below
 * in order (the game serves them by workday index, cycling). Edit/extend the
 * PUZZLES list, or manage puzzles live in the admin editor at /admin/connections.
 *
 * Each puzzle = four groups of four UNIQUE words (16 total), one per difficulty
 * colour: yellow (easiest) → green → blue → purple (trickiest).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Load env the same way scripts/run-with-env.mjs does, so the documented
// `npx tsx` command works on its own.
for (const f of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (!k || process.env[k] !== undefined) continue;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    /* file may not exist */
  }
}

const Y = '#f8d74e' as const; // yellow  — easiest
const G = '#7ed66e' as const; // green
const B = '#6eb4f8' as const; // blue
const P = '#c97ed6' as const; // purple  — trickiest

type Color = typeof Y | typeof G | typeof B | typeof P;
type Group = { category: string; words: [string, string, string, string]; color: Color };

const PUZZLES: Group[][] = [
  [
    { category: 'Citrus fruits', words: ['LEMON', 'LIME', 'ORANGE', 'GRAPEFRUIT'], color: Y },
    { category: 'Tennis terms', words: ['ACE', 'LOVE', 'DEUCE', 'FAULT'], color: G },
    { category: 'Card games', words: ['HEARTS', 'SPADES', 'BRIDGE', 'RUMMY'], color: B },
    { category: 'Shades of blue', words: ['NAVY', 'TEAL', 'COBALT', 'AZURE'], color: P },
  ],
  [
    { category: 'Planets', words: ['MARS', 'VENUS', 'MERCURY', 'SATURN'], color: Y },
    { category: 'Chocolate bars', words: ['SNICKERS', 'TWIX', 'BOUNTY', 'KITKAT'], color: G },
    { category: 'Space mission words', words: ['ROCKET', 'ORBIT', 'LAUNCH', 'COMET'], color: B },
    { category: 'Roman gods', words: ['APOLLO', 'JUNO', 'NEPTUNE', 'VULCAN'], color: P },
  ],
  [
    { category: 'Breakfast foods', words: ['BACON', 'TOAST', 'EGGS', 'CEREAL'], color: Y },
    { category: 'Condiments', words: ['KETCHUP', 'MUSTARD', 'MAYO', 'RELISH'], color: G },
    { category: 'Ballroom dances', words: ['SALSA', 'TANGO', 'WALTZ', 'SWING'], color: B },
    { category: '___ + board', words: ['KEY', 'SURF', 'CARD', 'DASH'], color: P },
  ],
  [
    { category: 'Sea creatures', words: ['WHALE', 'SHARK', 'OCTOPUS', 'CRAB'], color: Y },
    { category: 'Apple products', words: ['IPHONE', 'IPAD', 'WATCH', 'MAC'], color: G },
    { category: 'Poker moves', words: ['FLUSH', 'BLUFF', 'FOLD', 'RAISE'], color: B },
    { category: 'Pool / billiards', words: ['CUE', 'BREAK', 'RACK', 'POCKET'], color: P },
  ],
  [
    { category: 'Pizza toppings', words: ['PEPPERONI', 'MUSHROOM', 'OLIVE', 'ONION'], color: Y },
    { category: 'Garden vegetables', words: ['CARROT', 'PEPPER', 'TOMATO', 'LETTUCE'], color: G },
    { category: 'Trees', words: ['OAK', 'PINE', 'MAPLE', 'BIRCH'], color: B },
    { category: 'At the casino', words: ['CHIP', 'DEAL', 'STACK', 'SHUFFLE'], color: P },
  ],
  [
    { category: 'Seasons', words: ['SPRING', 'SUMMER', 'FALL', 'WINTER'], color: Y },
    { category: 'Bed sizes', words: ['KING', 'QUEEN', 'TWIN', 'FULL'], color: G },
    { category: 'Coffee drinks', words: ['LATTE', 'MOCHA', 'ESPRESSO', 'AMERICANO'], color: B },
    { category: 'Chess pieces', words: ['ROOK', 'KNIGHT', 'BISHOP', 'PAWN'], color: P },
  ],
  [
    { category: 'Shades of red', words: ['CRIMSON', 'SCARLET', 'RUBY', 'CHERRY'], color: Y },
    { category: 'Orchard fruits', words: ['APPLE', 'PEACH', 'PLUM', 'GRAPE'], color: G },
    { category: 'Gemstones', words: ['EMERALD', 'SAPPHIRE', 'OPAL', 'TOPAZ'], color: B },
    { category: 'Vegas games', words: ['ACE', 'CHIP', 'DICE', 'SLOT'], color: P },
  ],
  [
    { category: 'Dog commands', words: ['SIT', 'STAY', 'ROLL', 'FETCH'], color: Y },
    { category: 'Bakery items', words: ['BAGEL', 'MUFFIN', 'SCONE', 'CROISSANT'], color: G },
    { category: 'Exercises', words: ['PLANK', 'BRIDGE', 'LUNGE', 'SQUAT'], color: B },
    { category: 'Film set terms', words: ['REEL', 'SCENE', 'TAKE', 'CUT'], color: P },
  ],
];

function validate(): void {
  PUZZLES.forEach((groups, idx) => {
    if (groups.length !== 4) throw new Error(`Puzzle ${idx}: need 4 groups`);
    const seen = new Set<string>();
    const colors = new Set<string>();
    for (const g of groups) {
      colors.add(g.color);
      if (g.words.length !== 4) throw new Error(`Puzzle ${idx} "${g.category}": need 4 words`);
      for (const w of g.words) {
        const key = w.trim().toLowerCase();
        if (seen.has(key)) throw new Error(`Puzzle ${idx}: duplicate word "${w}"`);
        seen.add(key);
      }
    }
    if (seen.size !== 16) throw new Error(`Puzzle ${idx}: need 16 unique words, got ${seen.size}`);
    if (colors.size !== 4) throw new Error(`Puzzle ${idx}: need one of each colour`);
  });
}

async function main() {
  validate();
  const { db } = await import('@/server/db/client');
  const { connectionsPuzzles } = await import('@/server/db/schema');

  await db.delete(connectionsPuzzles);
  for (let i = 0; i < PUZZLES.length; i += 1) {
    await db.insert(connectionsPuzzles).values({
      id: crypto.randomUUID(),
      sortOrder: i,
      groupsJson: JSON.stringify(PUZZLES[i]),
    });
  }
  console.log(`✓ Seeded ${PUZZLES.length} Connections puzzles.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
