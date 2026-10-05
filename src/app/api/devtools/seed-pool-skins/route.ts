import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { withTransaction } from '@/server/db/client';

/** Deterministic ID from item name + slot so re-running the seeder is idempotent. */
function stableId(name: string, slot: string): string {
  return `8ball-seed-${createHash('sha256').update(`${name}|${slot}`).digest('hex').slice(0, 16)}`;
}

/**
 * DEV-ONLY: Seeds 8-Ball Pool cosmetic items and grants them to the
 * calling user. Hit GET /api/dev/seed-pool-skins in your browser.
 * Blocked in production via NODE_ENV check.
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

const ITEMS = [
  // ── CUE SKINS ──────────────────────────────────────────────────

  {
    name: 'Neon Cue',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['cue'],
    assetRef: {
      cueColor: '#06b6d4',
      cueTipColor: '#0891b2',
      cueGlow: true,
      cueGlowColor: '#22d3ee',
    },
  },
  {
    name: 'Golden Cue',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 10,
    slots: ['cue'],
    assetRef: {
      cueColor: '#fbbf24',
      cueTipColor: '#b45309',
      cueGlow: true,
      cueGlowColor: '#fcd34d',
    },
  },
  {
    name: 'Crimson Cue',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['cue'],
    assetRef: {
      cueColor: '#ef4444',
      cueTipColor: '#991b1b',
      cueGlow: false,
      cueGlowColor: '#ffffff',
    },
  },
  {
    name: 'Obsidian Cue',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['cue'],
    assetRef: {
      cueColor: '#1e1b4b',
      cueTipColor: '#0f0f0f',
      cueGlow: true,
      cueGlowColor: '#7c3aed',
    },
  },
  {
    name: 'CHROME Cue',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 15,
    slots: ['cue'],
    assetRef: {
      cueColor: '#d4d4d8',
      cueTipColor: '#71717a',
      cueGlow: true,
      cueGlowColor: '#e4e4e7',
    },
  },
  {
    name: 'Sakura Cue',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['cue'],
    assetRef: {
      cueColor: '#f9a8d4',
      cueTipColor: '#be185d',
      cueGlow: false,
      cueGlowColor: '#ffffff',
    },
  },

  // ── TABLE SKINS ────────────────────────────────────────────────

  {
    name: 'Midnight Table',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['table'],
    assetRef: {
      feltColor: '#0f172a',
      feltDark: '#020617',
      railColor: '#1e293b',
      railBorder: '#0f172a',
      pocketColor: '#000000',
    },
  },
  {
    name: 'Royal Purple Table',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['table'],
    assetRef: {
      feltColor: '#3b0764',
      feltDark: '#2e1065',
      railColor: '#581c87',
      railBorder: '#3b0764',
      pocketColor: '#0a0a0a',
    },
  },
  {
    name: 'Crimson Table',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['table'],
    assetRef: {
      feltColor: '#7f1d1d',
      feltDark: '#5c1616',
      railColor: '#991b1b',
      railBorder: '#7f1d1d',
      pocketColor: '#0a0a0a',
    },
  },
  {
    name: 'Ocean Table',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['table'],
    assetRef: {
      feltColor: '#164e63',
      feltDark: '#0e3a4a',
      railColor: '#155e75',
      railBorder: '#0c4a5e',
      pocketColor: '#042f2e',
    },
  },
  {
    name: 'CHROME Table',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 12,
    slots: ['table'],
    assetRef: {
      feltColor: '#18181b',
      feltDark: '#0f0f11',
      railColor: '#a1a1aa',
      railBorder: '#71717a',
      pocketColor: '#000000',
    },
  },
  {
    name: 'Synthwave Table',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 10,
    slots: ['table'],
    assetRef: {
      feltColor: '#1e1b4b',
      feltDark: '#160f3d',
      railColor: '#db2777',
      railBorder: '#9d174d',
      pocketColor: '#0a0a0a',
    },
  },
  {
    name: 'Classic Blue Table',
    rarity: 'common',
    currencyType: 'credits',
    price: 300,
    slots: ['table'],
    assetRef: {
      feltColor: '#1e3a5f',
      feltDark: '#172e4d',
      railColor: '#5c3a1e',
      railBorder: '#3d2510',
      pocketColor: '#0a0a0a',
    },
  },

  // ── BALL SKINS ─────────────────────────────────────────────────

  {
    name: 'Neon Balls',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['balls'],
    assetRef: {
      ballYellow: '#facc15',
      ballBlue: '#38bdf8',
      ballRed: '#fb7185',
      ballPurple: '#c084fc',
      ballOrange: '#fb923c',
      ballGreen: '#4ade80',
      ballMaroon: '#f472b6',
    },
  },
  {
    name: 'Pastel Balls',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['balls'],
    assetRef: {
      ballYellow: '#fef08a',
      ballBlue: '#bfdbfe',
      ballRed: '#fecaca',
      ballPurple: '#e9d5ff',
      ballOrange: '#fed7aa',
      ballGreen: '#bbf7d0',
      ballMaroon: '#fecdd3',
    },
  },
  {
    name: 'Jewel Tone Balls',
    rarity: 'epic',
    currencyType: 'credits',
    price: 750,
    slots: ['balls'],
    assetRef: {
      ballYellow: '#ca8a04',
      ballBlue: '#1e40af',
      ballRed: '#991b1b',
      ballPurple: '#6b21a8',
      ballOrange: '#c2410c',
      ballGreen: '#166534',
      ballMaroon: '#881337',
    },
  },
  {
    name: 'Monochrome Balls',
    rarity: 'epic',
    currencyType: 'credits',
    price: 700,
    slots: ['balls'],
    assetRef: {
      ballYellow: '#e2e8f0',
      ballBlue: '#94a3b8',
      ballRed: '#64748b',
      ballPurple: '#475569',
      ballOrange: '#cbd5e1',
      ballGreen: '#334155',
      ballMaroon: '#1e293b',
    },
  },
  {
    name: 'CHROME Balls',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 8,
    slots: ['balls'],
    assetRef: {
      ballYellow: '#d4d4d8',
      ballBlue: '#a1a1aa',
      ballRed: '#e4e4e7',
      ballPurple: '#71717a',
      ballOrange: '#f4f4f5',
      ballGreen: '#52525b',
      ballMaroon: '#3f3f46',
    },
  },
];

export async function GET() {
  if (!IS_DEV) {
    return NextResponse.json({ error: 'Not available in production.' }, { status: 403 });
  }

  let identity;
  try {
    identity = await requireIdentity();
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const now = Date.now();
  const insertItemSql = `INSERT INTO store_items
      (id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NULL, $8, $9)
     ON CONFLICT (id) DO NOTHING`;
  const insertOwnedSql = `INSERT INTO user_owned_items
      (user_id, item_id, acquired_at, acquired_source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, item_id) DO NOTHING`;

  const results: string[] = [];
  await withTransaction(async (client) => {
    for (const item of ITEMS) {
      const id = stableId(item.name, item.slots[0]);
      await client.query(insertItemSql, [
        id,
        item.name,
        '8-ball',
        item.rarity,
        item.currencyType,
        item.price,
        JSON.stringify(item.slots),
        JSON.stringify(item.assetRef),
        now,
      ]);
      await client.query(insertOwnedSql, [identity.userId, id, now, 'dev-seed']);
      results.push(`✓ ${item.name} (${item.rarity})`);
    }
  });

  return NextResponse.json({
    message: `Seeded ${results.length} 8-Ball Pool items and granted to ${identity.userId}`,
    items: results,
  });
}
