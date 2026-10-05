// ---------------------------------------------------------------------------
// Seed Coin Flip starter items idempotently. Called on server startup.
// Inserts ~15 thematic coin cosmetics across all 3 slots and rarities.
// Items have stable IDs so re-runs are no-ops.
// ---------------------------------------------------------------------------

import { queryOne, withTransaction } from '@/server/db/client';

import { LEGACY_SEEDS_ON_SALE } from './legacy-catalog';

type SeedItem = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  slot: 'coin' | 'trail' | 'background';
  assetRef: Record<string, unknown>;
};

const COIN_FLIP_STARTER_ITEMS: SeedItem[] = [
  // ── Coin ──────────────────────────────────────────────────────────
  {
    id: 'coin-flip-coin-classic-gold',
    name: 'Classic Gold',
    rarity: 'common',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#fcd34d', headsSecondary: '#f59e0b', headsText: '#92400e',
      tailsPrimary: '#7dd3fc', tailsSecondary: '#0ea5e9', tailsText: '#0c4a6e',
      border: '#d97706', shine: true,
    },
  },
  {
    id: 'coin-flip-coin-silver',
    name: 'Silver Dollar',
    rarity: 'common',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#e2e8f0', headsSecondary: '#94a3b8', headsText: '#334155',
      tailsPrimary: '#cbd5e1', tailsSecondary: '#64748b', tailsText: '#1e293b',
      border: '#475569', shine: true,
    },
  },
  {
    id: 'coin-flip-coin-neon',
    name: 'Neon Coin',
    rarity: 'rare',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#00ff88', headsSecondary: '#00cc6a', headsText: '#003d20',
      tailsPrimary: '#ff00ff', tailsSecondary: '#cc00cc', tailsText: '#3d003d',
      border: '#00ffff', shine: true, glow: true, glowColor: '#00ff88', glowSize: 20,
    },
  },
  {
    id: 'coin-flip-coin-obsidian',
    name: 'Obsidian Coin',
    rarity: 'rare',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#1e1e2e', headsSecondary: '#0a0a14', headsText: '#a855f7',
      tailsPrimary: '#0a0a14', tailsSecondary: '#1e1e2e', tailsText: '#ec4899',
      border: '#6d28d9', shine: false, glow: true, glowColor: '#a855f7', glowSize: 15,
    },
  },
  {
    id: 'coin-flip-coin-holographic',
    name: 'Holographic',
    rarity: 'epic',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#c084fc', headsSecondary: '#a855f7', headsText: '#ffffff',
      tailsPrimary: '#67e8f9', tailsSecondary: '#22d3ee', tailsText: '#ffffff',
      border: '#e879f9', shine: true, glow: true, glowColor: '#c084fc', glowSize: 30,
      rainbow: true,
    },
  },
  {
    id: 'coin-flip-coin-CHROME',
    name: 'CHROME Coin',
    rarity: 'legendary',
    slot: 'coin',
    assetRef: {
      headsPrimary: '#d4d4d8', headsSecondary: '#a1a1aa', headsText: '#18181b',
      tailsPrimary: '#a1a1aa', tailsSecondary: '#71717a', tailsText: '#18181b',
      border: '#e4e4e7', shine: true, glow: true, glowColor: '#22d3ee', glowSize: 40,
      metallic: true,
    },
  },

  // ── Trail ─────────────────────────────────────────────────────────
  {
    id: 'coin-flip-trail-sparkle',
    name: 'Sparkle Trail',
    rarity: 'common',
    slot: 'trail',
    assetRef: {
      particleType: 'sparkle', color: '#fbbf24', count: 8, spread: 15,
    },
  },
  {
    id: 'coin-flip-trail-fire',
    name: 'Fire Trail',
    rarity: 'rare',
    slot: 'trail',
    assetRef: {
      particleType: 'flame', color: '#ef4444', secondaryColor: '#f97316', count: 12, spread: 20,
    },
  },
  {
    id: 'coin-flip-trail-ice',
    name: 'Ice Trail',
    rarity: 'rare',
    slot: 'trail',
    assetRef: {
      particleType: 'crystal', color: '#22d3ee', secondaryColor: '#a5f3fc', count: 10, spread: 18,
    },
  },
  {
    id: 'coin-flip-trail-aurora',
    name: 'Aurora Trail',
    rarity: 'epic',
    slot: 'trail',
    assetRef: {
      particleType: 'wave', color: '#a855f7', secondaryColor: '#06b6d4', count: 15, spread: 25,
      rainbow: true,
    },
  },

  // ── Background ────────────────────────────────────────────────────
  {
    id: 'coin-flip-bg-dark',
    name: 'Dark Table',
    rarity: 'common',
    slot: 'background',
    assetRef: {
      bgGradientStart: '#0f172a', bgGradientEnd: '#1e293b',
      accentColor: '#334155',
    },
  },
  {
    id: 'coin-flip-bg-casino',
    name: 'Casino Green',
    rarity: 'common',
    slot: 'background',
    assetRef: {
      bgGradientStart: '#052e16', bgGradientEnd: '#14532d',
      accentColor: '#166534',
    },
  },
  {
    id: 'coin-flip-bg-space',
    name: 'Deep Space',
    rarity: 'rare',
    slot: 'background',
    assetRef: {
      bgGradientStart: '#020617', bgGradientEnd: '#0c0a1f',
      accentColor: '#312e81', stars: true,
    },
  },
  {
    id: 'coin-flip-bg-void',
    name: 'The Void',
    rarity: 'epic',
    slot: 'background',
    assetRef: {
      bgGradientStart: '#000000', bgGradientEnd: '#0a0010',
      accentColor: '#7c3aed', particles: true, particleColor: '#a855f7',
    },
  },
  {
    id: 'coin-flip-bg-chrome',
    name: 'Chrome Armory',
    rarity: 'legendary',
    slot: 'background',
    assetRef: {
      bgGradientStart: '#1c1917', bgGradientEnd: '#292524',
      accentColor: '#78716c', metallic: true, sigil: true,
    },
  },
];

const PRICE_BY_RARITY: Record<SeedItem['rarity'], number> = {
  common: 400,
  rare: 650,
  epic: 1000,
  legendary: 1500,
};

const CURRENCY_BY_RARITY: Record<SeedItem['rarity'], 'credits'> = {
  common: 'credits',
  rare: 'credits',
  epic: 'credits',
  legendary: 'credits',
};

const UPSERT_STORE_ITEM_SQL = `
  INSERT INTO store_items (
    id,
    name,
    game_type,
    rarity,
    currency_type,
    price,
    slots_json,
    active,
    season_tag,
    asset_ref,
    created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  -- An existing row keeps its price unless it is free (then it gets the seed
  -- price back), and a seed can take it off sale but never put it back on
  -- sale. Admin hides and prices survive a deploy.
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    game_type = excluded.game_type,
    rarity = excluded.rarity,
    currency_type = excluded.currency_type,
    slots_json = excluded.slots_json,
    price = CASE WHEN store_items.price <= 0 AND excluded.price > 0 THEN excluded.price ELSE store_items.price END,
    active = store_items.active AND excluded.active,
    season_tag = excluded.season_tag,
    asset_ref = excluded.asset_ref
`;

let hasSeeded = false;

export const seedCoinFlipStarterItems = async () => {
  if (hasSeeded) return;
  try {
    // Count this seed's own ids: the counter adds other coin-flip items.
    const row = await queryOne<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM store_items WHERE id = ANY($1::text[])`,
      [COIN_FLIP_STARTER_ITEMS.map((item) => item.id)],
    );
    const existing = Number(row?.count ?? 0);
    if (existing >= COIN_FLIP_STARTER_ITEMS.length) {
      hasSeeded = true;
      return;
    }

    const now = Date.now();
    await withTransaction(async (client) => {
      for (const item of COIN_FLIP_STARTER_ITEMS) {
        await client.query(UPSERT_STORE_ITEM_SQL, [
          item.id,
          item.name,
          'coin-flip',
          item.rarity,
          CURRENCY_BY_RARITY[item.rarity],
          PRICE_BY_RARITY[item.rarity],
          JSON.stringify([item.slot]),
          LEGACY_SEEDS_ON_SALE, // active
          null, // season_tag
          JSON.stringify(item.assetRef),
          now,
        ]);
      }
    });
    hasSeeded = true;
    console.log(`[seed-coin-flip] Seeded ${COIN_FLIP_STARTER_ITEMS.length} coin flip starter items`);
  } catch (error) {
    console.error('[seed-coin-flip] Failed to seed coin flip starter items:', error);
  }
};
