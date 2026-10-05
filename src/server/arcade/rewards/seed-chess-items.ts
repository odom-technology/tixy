// ---------------------------------------------------------------------------
// Seed Chess starter items idempotently. Called on server startup.
// Covers the three chess cosmetic slots: pieces, board, clock.
// ---------------------------------------------------------------------------

import { queryOne, withTransaction } from '@/server/db/client';

import { LEGACY_SEEDS_ON_SALE } from './legacy-catalog';

type SeedItem = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  slot: 'pieces' | 'board' | 'clock';
  assetRef: Record<string, unknown>;
};

const CHESS_STARTER_ITEMS: SeedItem[] = [
  // ── Board ─────────────────────────────────────────────────────────
  {
    id: 'chess-board-classic-walnut',
    name: 'Classic Walnut',
    rarity: 'common',
    slot: 'board',
    assetRef: {
      boardLightColor: '#f0d9b5',
      boardDarkColor: '#b58863',
      boardBorderColor: '#3d2817',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#22c55e',
      boardLegalMoveColor: '#22c55e',
    },
  },
  {
    id: 'chess-board-seafoam',
    name: 'Seafoam',
    rarity: 'common',
    slot: 'board',
    assetRef: {
      boardLightColor: '#e8f4ea',
      boardDarkColor: '#4a7c59',
      boardBorderColor: '#1e3a2a',
      boardHighlightColor: '#fde04770',
      boardSelectedColor: '#10b981',
      boardLegalMoveColor: '#10b981',
    },
  },
  {
    id: 'chess-board-midnight',
    name: 'Midnight',
    rarity: 'rare',
    slot: 'board',
    assetRef: {
      boardLightColor: '#cbd5e1',
      boardDarkColor: '#334155',
      boardBorderColor: '#0f172a',
      boardHighlightColor: '#38bdf870',
      boardSelectedColor: '#60a5fa',
      boardLegalMoveColor: '#38bdf8',
    },
  },
  {
    id: 'chess-board-rosewood',
    name: 'Rosewood',
    rarity: 'rare',
    slot: 'board',
    assetRef: {
      boardLightColor: '#fde6d8',
      boardDarkColor: '#9c4a4a',
      boardBorderColor: '#5c1e1e',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#f97316',
      boardLegalMoveColor: '#f97316',
    },
  },
  {
    id: 'chess-board-emerald-throne',
    name: 'Emerald Throne',
    rarity: 'epic',
    slot: 'board',
    assetRef: {
      boardLightColor: '#f0fdf4',
      boardDarkColor: '#065f46',
      boardBorderColor: '#042f2e',
      boardHighlightColor: '#fde04770',
      boardSelectedColor: '#fbbf24',
      boardLegalMoveColor: '#34d399',
    },
  },
  {
    id: 'chess-board-obsidian-gold',
    name: 'Obsidian & Gold',
    rarity: 'legendary',
    slot: 'board',
    assetRef: {
      boardLightColor: '#fde68a',
      boardDarkColor: '#18181b',
      boardBorderColor: '#000000',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#fbbf24',
      boardLegalMoveColor: '#fbbf24',
    },
  },

  // ── Pieces ────────────────────────────────────────────────────────
  {
    id: 'chess-pieces-ivory-ebony',
    name: 'Ivory & Ebony',
    rarity: 'common',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#f8fafc',
      piecesBlackColor: '#0f172a',
      piecesWhiteShadow: 'rgba(0, 0, 0, 0.7)',
      piecesBlackShadow: 'rgba(255, 255, 255, 0.2)',
    },
  },
  {
    id: 'chess-pieces-slate',
    name: 'Slate',
    rarity: 'common',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#e2e8f0',
      piecesBlackColor: '#1e293b',
      piecesWhiteShadow: 'rgba(0, 0, 0, 0.6)',
      piecesBlackShadow: 'rgba(148, 163, 184, 0.35)',
    },
  },
  {
    id: 'chess-pieces-royal',
    name: 'Royal',
    rarity: 'rare',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#fef3c7',
      piecesBlackColor: '#3730a3',
      piecesWhiteShadow: 'rgba(120, 53, 15, 0.7)',
      piecesBlackShadow: 'rgba(233, 213, 255, 0.45)',
    },
  },
  {
    id: 'chess-pieces-jade',
    name: 'Jade Dynasty',
    rarity: 'epic',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#d1fae5',
      piecesBlackColor: '#064e3b',
      piecesWhiteShadow: 'rgba(6, 78, 59, 0.8)',
      piecesBlackShadow: 'rgba(167, 243, 208, 0.4)',
    },
  },
  {
    id: 'chess-pieces-gilded',
    name: 'Gilded',
    rarity: 'legendary',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#fde68a',
      piecesBlackColor: '#92400e',
      piecesWhiteShadow: 'rgba(180, 83, 9, 0.85)',
      piecesBlackShadow: 'rgba(254, 243, 199, 0.55)',
    },
  },

  // ── Clock ─────────────────────────────────────────────────────────
  {
    id: 'chess-clock-default',
    name: 'Standard Chronometer',
    rarity: 'common',
    slot: 'clock',
    assetRef: {
      clockActiveColor: '#34d399',
      clockActiveBg: 'rgba(16, 185, 129, 0.1)',
      clockWarningColor: '#ef4444',
    },
  },
  {
    id: 'chess-clock-crimson',
    name: 'Crimson Alarm',
    rarity: 'rare',
    slot: 'clock',
    assetRef: {
      clockActiveColor: '#f87171',
      clockActiveBg: 'rgba(220, 38, 38, 0.12)',
      clockWarningColor: '#fbbf24',
    },
  },
  {
    id: 'chess-clock-neon',
    name: 'Neon Flux',
    rarity: 'epic',
    slot: 'clock',
    assetRef: {
      clockActiveColor: '#22d3ee',
      clockActiveBg: 'rgba(34, 211, 238, 0.12)',
      clockWarningColor: '#f472b6',
    },
  },

  /* wave-d cluster-b additions (chess) */
  {
    id: 'chess-board-frostbite',
    name: 'Frostbite',
    rarity: 'rare',
    slot: 'board',
    assetRef: {
      boardLightColor: '#e0f2fe',
      boardDarkColor: '#0369a1',
      boardBorderColor: '#082f49',
      boardHighlightColor: '#7dd3fc70',
      boardSelectedColor: '#38bdf8',
      boardLegalMoveColor: '#38bdf8',
    },
  },
  {
    id: 'chess-pieces-crimson-court',
    name: 'Crimson Court',
    rarity: 'epic',
    slot: 'pieces',
    assetRef: {
      piecesWhiteColor: '#fee2e2',
      piecesBlackColor: '#7f1d1d',
      piecesWhiteShadow: 'rgba(127, 29, 29, 0.75)',
      piecesBlackShadow: 'rgba(254, 226, 226, 0.45)',
    },
  },
  {
    id: 'chess-clock-mint',
    name: 'Mint Tempo',
    rarity: 'rare',
    slot: 'clock',
    assetRef: {
      clockActiveColor: '#34d399',
      clockActiveBg: 'rgba(52, 211, 153, 0.12)',
      clockWarningColor: '#fb7185',
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

export const seedChessStarterItems = async () => {
  if (hasSeeded) return;
  try {
    // Count this seed's own ids: the counter adds other chess items.
    const row = await queryOne<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM store_items WHERE id = ANY($1::text[])`,
      [CHESS_STARTER_ITEMS.map((item) => item.id)],
    );
    const existing = Number(row?.count ?? 0);
    if (existing >= CHESS_STARTER_ITEMS.length) {
      hasSeeded = true;
      return;
    }

    const now = Date.now();
    await withTransaction(async (client) => {
      for (const item of CHESS_STARTER_ITEMS) {
        await client.query(UPSERT_STORE_ITEM_SQL, [
          item.id,
          item.name,
          'chess',
          item.rarity,
          CURRENCY_BY_RARITY[item.rarity],
          PRICE_BY_RARITY[item.rarity],
          JSON.stringify([item.slot]),
          LEGACY_SEEDS_ON_SALE,
          null,
          JSON.stringify(item.assetRef),
          now,
        ]);
      }
    });
    hasSeeded = true;
  } catch (error) {
    console.error('Failed to seed Chess starter items:', error);
  }
};
