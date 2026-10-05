import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { withTransaction } from '@/server/db/client';

/**
 * DEV-ONLY: Seeds Flappy Bird cosmetic items and grants them to the
 * calling user. Hit GET /api/dev/seed-flappy-skins in your browser.
 * Blocked in production via NODE_ENV check.
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

const ITEMS = [
  // ── BIRD SKINS ──────────────────────────────────────────────
  {
    name: 'Hologram Bird',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 10,
    slots: ['bird'],
    assetRef: {
      birdPrimary: '#06b6d4',
      birdSecondary: '#22d3ee',
      birdGlow: true,
      birdGlowColor: '#67e8f9',
      birdGlowSize: 18,
      birdOutline: true,
      birdOutlineColor: '#ffffff',
      birdOutlineWidth: 1.5,
    },
  },
  {
    name: 'Ember Bird',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['bird'],
    assetRef: {
      birdPrimary: '#292524',
      birdSecondary: '#ea580c',
      birdGlow: true,
      birdGlowColor: '#f97316',
      birdGlowSize: 14,
    },
  },
  {
    name: 'Void Bird',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['bird'],
    assetRef: {
      birdPrimary: '#0a0a0a',
      birdSecondary: '#581c87',
      birdOutline: true,
      birdOutlineColor: '#a855f7',
      birdOutlineWidth: 2,
    },
  },
  {
    name: 'Chrome Bird',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['bird'],
    assetRef: {
      birdPrimary: '#d4d4d8',
      birdSecondary: '#a1a1aa',
      birdOutline: true,
      birdOutlineColor: '#e4e4e7',
      birdOutlineWidth: 1,
    },
  },
  {
    name: 'CHROME Bird',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 15,
    slots: ['bird'],
    assetRef: {
      birdPrimary: '#c0c0c0',
      birdSecondary: '#8b8682',
      birdGlow: true,
      birdGlowColor: '#d4d4d8',
      birdGlowSize: 10,
      birdOutline: true,
      birdOutlineColor: '#fafafa',
      birdOutlineWidth: 1.5,
    },
  },

  // ── PIPE SKINS ──────────────────────────────────────────────
  {
    name: 'Neon Pipes',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['pipe'],
    assetRef: {
      pipePrimary: '#db2777',
      pipeSecondary: '#06b6d4',
      pipeGlow: true,
      pipeGlowColor: '#ec4899',
      pipeGlowSize: 10,
    },
  },
  {
    name: 'Obsidian Pipes',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['pipe'],
    assetRef: {
      pipePrimary: '#1a1a2e',
      pipeSecondary: '#16213e',
    },
  },
  {
    name: 'Gold Pipes',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['pipe'],
    assetRef: {
      pipePrimary: '#b8860b',
      pipeSecondary: '#ffd700',
      pipeGlow: true,
      pipeGlowColor: '#fbbf24',
      pipeGlowSize: 6,
    },
  },
  {
    name: 'Ice Pipes',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['pipe'],
    assetRef: {
      pipePrimary: '#e0f2fe',
      pipeSecondary: '#7dd3fc',
    },
  },

  // ── BACKGROUNDS ─────────────────────────────────────────────
  {
    name: 'Sunset',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['background'],
    assetRef: {
      skyTop: '#ea580c',
      skyBottom: '#fb923c',
      ground: '#78350f',
    },
  },
  {
    name: 'Deep Space',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['background'],
    assetRef: {
      skyTop: '#020617',
      skyBottom: '#0f172a',
      ground: '#1e293b',
    },
  },
  {
    name: 'Synthwave',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 10,
    slots: ['background'],
    assetRef: {
      skyTop: '#2e1065',
      skyBottom: '#db2777',
      ground: '#06b6d4',
    },
  },
  {
    name: 'Storm',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['background'],
    assetRef: {
      skyTop: '#1f2937',
      skyBottom: '#475569',
      ground: '#57534e',
    },
  },

  // ── TRAILS ──────────────────────────────────────────────────
  {
    name: 'Rainbow Trail',
    rarity: 'legendary',
    currencyType: 'credits',
    price: 12,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'],
    },
  },
  {
    name: 'Frost Trail',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#bfdbfe', '#dbeafe', '#e0f7fa', '#ffffff'],
    },
  },
  {
    name: 'Shadow Trail',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#1e1b4b', '#312e81', '#4338ca'],
    },
  },
  {
    name: 'Sakura Trail',
    rarity: 'rare',
    currencyType: 'credits',
    price: 500,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#fda4af', '#fecdd3', '#ffe4e6', '#ffffff'],
    },
  },
  {
    name: 'Galaxy Trail',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#7c3aed', '#2563eb', '#06b6d4', '#d946ef'],
    },
  },
  {
    name: 'Inferno Trail',
    rarity: 'epic',
    currencyType: 'credits',
    price: 800,
    slots: ['trail'],
    assetRef: {
      trailColors: ['#ef4444', '#f97316', '#fbbf24'],
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
      const id = crypto.randomUUID();
      await client.query(insertItemSql, [
        id,
        item.name,
        'flappy-bird',
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
    message: `Seeded ${results.length} Flappy Bird items and granted to ${identity.userId}`,
    items: results,
  });
}
