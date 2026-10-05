// ---------------------------------------------------------------------------
// Seed 2048 starter items idempotently. Called on server startup from
// generateStoreDailyRotation. Items have stable IDs so re-runs are no-ops.
// ---------------------------------------------------------------------------

import { queryOne, withTransaction } from '@/server/db/client';

import { LEGACY_SEEDS_ON_SALE } from './legacy-catalog';

type SeedItem = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  slot: 'tiles' | 'grid' | 'background';
  assetRef: Record<string, unknown>;
};

// Canonical tile color ramps used across multiple skins. Each ramp must cover
// values 2..2048 plus a fallback for >=4096.
type TileRamp = {
  tile2Bg: string; tile2Fg: string;
  tile4Bg: string; tile4Fg: string;
  tile8Bg: string; tile8Fg: string;
  tile16Bg: string; tile16Fg: string;
  tile32Bg: string; tile32Fg: string;
  tile64Bg: string; tile64Fg: string;
  tile128Bg: string; tile128Fg: string;
  tile256Bg: string; tile256Fg: string;
  tile512Bg: string; tile512Fg: string;
  tile1024Bg: string; tile1024Fg: string;
  tile2048Bg: string; tile2048Fg: string;
  tileFallbackBg: string; tileFallbackFg: string;
};

const RAMP_CLASSIC: TileRamp = {
  tile2Bg: '#eee4da', tile2Fg: '#776e65',
  tile4Bg: '#ede0c8', tile4Fg: '#776e65',
  tile8Bg: '#f2b179', tile8Fg: '#f9f6f2',
  tile16Bg: '#f59563', tile16Fg: '#f9f6f2',
  tile32Bg: '#f67c5f', tile32Fg: '#f9f6f2',
  tile64Bg: '#f65e3b', tile64Fg: '#f9f6f2',
  tile128Bg: '#edcf72', tile128Fg: '#f9f6f2',
  tile256Bg: '#edcc61', tile256Fg: '#f9f6f2',
  tile512Bg: '#edc850', tile512Fg: '#f9f6f2',
  tile1024Bg: '#edc53f', tile1024Fg: '#f9f6f2',
  tile2048Bg: '#edc22e', tile2048Fg: '#f9f6f2',
  tileFallbackBg: '#3c3a32', tileFallbackFg: '#f9f6f2',
};

const RAMP_PASTEL: TileRamp = {
  tile2Bg: '#fef9f3', tile2Fg: '#7c6f64',
  tile4Bg: '#fde8d7', tile4Fg: '#7c6f64',
  tile8Bg: '#fac6b4', tile8Fg: '#7c3a31',
  tile16Bg: '#f6a8a8', tile16Fg: '#7c2d2d',
  tile32Bg: '#e39eb8', tile32Fg: '#5c1f3a',
  tile64Bg: '#c19ad8', tile64Fg: '#3d1f5c',
  tile128Bg: '#a5b4fc', tile128Fg: '#1e2a5e',
  tile256Bg: '#93c5fd', tile256Fg: '#1e3a5e',
  tile512Bg: '#7dd3fc', tile512Fg: '#0c4a6e',
  tile1024Bg: '#5eead4', tile1024Fg: '#134e4a',
  tile2048Bg: '#86efac', tile2048Fg: '#14532d',
  tileFallbackBg: '#4c1d95', tileFallbackFg: '#f5f3ff',
};

const RAMP_DARK: TileRamp = {
  tile2Bg: '#3f3f46', tile2Fg: '#e4e4e7',
  tile4Bg: '#52525b', tile4Fg: '#fafafa',
  tile8Bg: '#6366f1', tile8Fg: '#ffffff',
  tile16Bg: '#4f46e5', tile16Fg: '#ffffff',
  tile32Bg: '#7c3aed', tile32Fg: '#ffffff',
  tile64Bg: '#a855f7', tile64Fg: '#ffffff',
  tile128Bg: '#d946ef', tile128Fg: '#ffffff',
  tile256Bg: '#ec4899', tile256Fg: '#ffffff',
  tile512Bg: '#f43f5e', tile512Fg: '#ffffff',
  tile1024Bg: '#f97316', tile1024Fg: '#ffffff',
  tile2048Bg: '#eab308', tile2048Fg: '#1f1f1f',
  tileFallbackBg: '#facc15', tileFallbackFg: '#1f1f1f',
};

const RAMP_NEON: TileRamp = {
  tile2Bg: '#0f172a', tile2Fg: '#67e8f9',
  tile4Bg: '#1e293b', tile4Fg: '#22d3ee',
  tile8Bg: '#155e75', tile8Fg: '#cffafe',
  tile16Bg: '#0e7490', tile16Fg: '#ecfeff',
  tile32Bg: '#0891b2', tile32Fg: '#ffffff',
  tile64Bg: '#22d3ee', tile64Fg: '#083344',
  tile128Bg: '#67e8f9', tile128Fg: '#083344',
  tile256Bg: '#a5f3fc', tile256Fg: '#083344',
  tile512Bg: '#ec4899', tile512Fg: '#ffffff',
  tile1024Bg: '#d946ef', tile1024Fg: '#ffffff',
  tile2048Bg: '#a855f7', tile2048Fg: '#ffffff',
  tileFallbackBg: '#7e22ce', tileFallbackFg: '#ffffff',
};

const RAMP_SUNSET: TileRamp = {
  tile2Bg: '#fef3c7', tile2Fg: '#78350f',
  tile4Bg: '#fed7aa', tile4Fg: '#78350f',
  tile8Bg: '#fdba74', tile8Fg: '#78350f',
  tile16Bg: '#fb923c', tile16Fg: '#7c2d12',
  tile32Bg: '#f97316', tile32Fg: '#ffffff',
  tile64Bg: '#ea580c', tile64Fg: '#ffffff',
  tile128Bg: '#dc2626', tile128Fg: '#ffffff',
  tile256Bg: '#be123c', tile256Fg: '#ffffff',
  tile512Bg: '#9f1239', tile512Fg: '#fda4af',
  tile1024Bg: '#86198f', tile1024Fg: '#f5d0fe',
  tile2048Bg: '#581c87', tile2048Fg: '#e9d5ff',
  tileFallbackBg: '#1e1b4b', tileFallbackFg: '#c7d2fe',
};

const RAMP_HOLO: TileRamp = {
  tile2Bg: '#f0abfc', tile2Fg: '#4a044e',
  tile4Bg: '#e879f9', tile4Fg: '#4a044e',
  tile8Bg: '#c084fc', tile8Fg: '#ffffff',
  tile16Bg: '#a78bfa', tile16Fg: '#ffffff',
  tile32Bg: '#818cf8', tile32Fg: '#ffffff',
  tile64Bg: '#60a5fa', tile64Fg: '#ffffff',
  tile128Bg: '#22d3ee', tile128Fg: '#ffffff',
  tile256Bg: '#34d399', tile256Fg: '#ffffff',
  tile512Bg: '#a3e635', tile512Fg: '#1a2e05',
  tile1024Bg: '#facc15', tile1024Fg: '#422006',
  tile2048Bg: '#f472b6', tile2048Fg: '#500724',
  tileFallbackBg: '#f0abfc', tileFallbackFg: '#4a044e',
};

const RAMP_CHROME: TileRamp = {
  tile2Bg: '#e5e5e5', tile2Fg: '#171717',
  tile4Bg: '#d4d4d4', tile4Fg: '#171717',
  tile8Bg: '#a3a3a3', tile8Fg: '#0a0a0a',
  tile16Bg: '#737373', tile16Fg: '#fafafa',
  tile32Bg: '#525252', tile32Fg: '#fafafa',
  tile64Bg: '#404040', tile64Fg: '#22d3ee',
  tile128Bg: '#262626', tile128Fg: '#22d3ee',
  tile256Bg: '#171717', tile256Fg: '#67e8f9',
  tile512Bg: '#0a0a0a', tile512Fg: '#a5f3fc',
  tile1024Bg: '#164e63', tile1024Fg: '#cffafe',
  tile2048Bg: '#22d3ee', tile2048Fg: '#083344',
  tileFallbackBg: '#67e8f9', tileFallbackFg: '#083344',
};

const TILES_EFFECT_CLASSIC = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 120,
  glowThreshold: 256, glowColor: '#fde68a', glowSize: 16, glowPulse: false,
};
const TILES_EFFECT_PUNCHY = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 90,
  glowThreshold: 128, glowColor: '#f0abfc', glowSize: 22, glowPulse: true,
};
const TILES_EFFECT_CALM = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 160,
  glowThreshold: 512, glowColor: '#7dd3fc', glowSize: 14, glowPulse: false,
};
const TILES_EFFECT_NEON = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 100,
  glowThreshold: 64, glowColor: '#22d3ee', glowSize: 26, glowPulse: true,
};
const TILES_EFFECT_HOLO = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 110,
  glowThreshold: 128, glowColor: '#e879f9', glowSize: 30, glowPulse: true,
};
const TILES_EFFECT_CHROME = {
  mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 120,
  glowThreshold: 256, glowColor: '#22d3ee', glowSize: 32, glowPulse: true,
};

const GAME_2048_STARTER_ITEMS: SeedItem[] = [
  // ── Tiles ──────────────────────────────────────────────────────────
  {
    id: '2048-tiles-classic',
    name: 'Classic',
    rarity: 'common',
    slot: 'tiles',
    assetRef: { ...RAMP_CLASSIC, ...TILES_EFFECT_CLASSIC },
  },
  {
    id: '2048-tiles-pastel',
    name: 'Pastel',
    rarity: 'common',
    slot: 'tiles',
    assetRef: { ...RAMP_PASTEL, ...TILES_EFFECT_CALM },
  },
  {
    id: '2048-tiles-dark-mode',
    name: 'Dark Mode',
    rarity: 'rare',
    slot: 'tiles',
    assetRef: { ...RAMP_DARK, ...TILES_EFFECT_PUNCHY },
  },
  {
    id: '2048-tiles-neon-cyber',
    name: 'Neon Cyber',
    rarity: 'rare',
    slot: 'tiles',
    assetRef: { ...RAMP_NEON, ...TILES_EFFECT_NEON },
  },
  {
    id: '2048-tiles-sunset',
    name: 'Sunset Gradient',
    rarity: 'epic',
    slot: 'tiles',
    assetRef: { ...RAMP_SUNSET, ...TILES_EFFECT_PUNCHY },
  },
  {
    id: '2048-tiles-holographic',
    name: 'Holographic',
    rarity: 'epic',
    slot: 'tiles',
    assetRef: { ...RAMP_HOLO, ...TILES_EFFECT_HOLO },
  },
  {
    id: '2048-tiles-CHROME',
    name: 'CHROME Tier',
    rarity: 'legendary',
    slot: 'tiles',
    assetRef: { ...RAMP_CHROME, ...TILES_EFFECT_CHROME },
  },

  // ── Grid ───────────────────────────────────────────────────────────
  {
    id: '2048-grid-warm',
    name: 'Default Warm',
    rarity: 'common',
    slot: 'grid',
    assetRef: { gridBg: '#bbada0', gridBorder: '#a59689', cellBg: '#cdc1b4' },
  },
  {
    id: '2048-grid-slate',
    name: 'Slate',
    rarity: 'common',
    slot: 'grid',
    assetRef: { gridBg: '#334155', gridBorder: '#1e293b', cellBg: '#475569' },
  },
  {
    id: '2048-grid-forest',
    name: 'Forest',
    rarity: 'rare',
    slot: 'grid',
    assetRef: { gridBg: '#14532d', gridBorder: '#052e16', cellBg: '#166534' },
  },
  {
    id: '2048-grid-blueprint',
    name: 'Blueprint',
    rarity: 'rare',
    slot: 'grid',
    assetRef: { gridBg: '#1e3a8a', gridBorder: '#172554', cellBg: '#1d4ed8' },
  },
  {
    id: '2048-grid-cyber-mesh',
    name: 'Cyber Mesh',
    rarity: 'epic',
    slot: 'grid',
    assetRef: { gridBg: '#0f172a', gridBorder: '#22d3ee', cellBg: '#1e293b' },
  },

  // ── Background ─────────────────────────────────────────────────────
  {
    id: '2048-bg-studio',
    name: 'Studio Charcoal',
    rarity: 'common',
    slot: 'background',
    assetRef: {
      containerBg: '#1f2937', containerBorder: '#334155',
      containerGradientEnabled: false,
      containerGradientStart: '#0f172a', containerGradientEnd: '#1e293b',
      containerGradientDirection: 'diagonal',
    },
  },
  {
    id: '2048-bg-deep-space',
    name: 'Deep Space',
    rarity: 'rare',
    slot: 'background',
    assetRef: {
      containerBg: '#020617', containerBorder: '#1e293b',
      containerGradientEnabled: true,
      containerGradientStart: '#020617', containerGradientEnd: '#1e1b4b',
      containerGradientDirection: 'radial',
    },
  },
  {
    id: '2048-bg-aurora',
    name: 'Aurora',
    rarity: 'epic',
    slot: 'background',
    assetRef: {
      containerBg: '#064e3b', containerBorder: '#0ea5e9',
      containerGradientEnabled: true,
      containerGradientStart: '#064e3b', containerGradientEnd: '#6366f1',
      containerGradientDirection: 'diagonal',
    },
  },

  /* wave-d cluster-b additions (2048) */
  {
    id: '2048-tiles-molten',
    name: 'Molten Core',
    rarity: 'epic',
    slot: 'tiles',
    assetRef: {
      tile2Bg: '#2a1205', tile2Fg: '#ffd9a0',
      tile4Bg: '#3a1c08', tile4Fg: '#ffcf8a',
      tile8Bg: '#7a2e0a', tile8Fg: '#ffd7a0',
      tile16Bg: '#9a3a0c', tile16Fg: '#ffe0b0',
      tile32Bg: '#c2410c', tile32Fg: '#fff5e6',
      tile64Bg: '#ea580c', tile64Fg: '#fff5e6',
      tile128Bg: '#f97316', tile128Fg: '#2a1206',
      tile256Bg: '#fb923c', tile256Fg: '#2a1206',
      tile512Bg: '#fbbf24', tile512Fg: '#2a1b06',
      tile1024Bg: '#fcd34d', tile1024Fg: '#2a1b06',
      tile2048Bg: '#fde68a', tile2048Fg: '#2a1b06',
      tileFallbackBg: '#7f1d1d', tileFallbackFg: '#fecaca',
      mergePulseEnabled: true, spawnAnimEnabled: true, slideDurationMs: 95,
      glowThreshold: 128, glowColor: '#fb923c', glowSize: 24, glowPulse: true,
    },
  },
  {
    id: '2048-grid-royal',
    name: 'Royal Velvet',
    rarity: 'rare',
    slot: 'grid',
    assetRef: { gridBg: '#2e1065', gridBorder: '#150430', cellBg: '#3b0764' },
  },
  {
    id: '2048-bg-sunrise',
    name: 'Sunrise Boardwalk',
    rarity: 'common',
    slot: 'background',
    assetRef: {
      containerBg: '#7c2d12', containerBorder: '#fbbf24',
      containerGradientEnabled: true,
      containerGradientStart: '#7c2d12', containerGradientEnd: '#facc15',
      containerGradientDirection: 'vertical',
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

export const seed2048StarterItems = async () => {
  if (hasSeeded) return;
  try {
    // Count this seed's own ids: the counter adds other 2048 items.
    const row = await queryOne<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM store_items WHERE id = ANY($1::text[])`,
      [GAME_2048_STARTER_ITEMS.map((item) => item.id)],
    );
    const existing = Number(row?.count ?? 0);
    if (existing >= GAME_2048_STARTER_ITEMS.length) {
      hasSeeded = true;
      return;
    }

    const now = Date.now();
    await withTransaction(async (client) => {
      for (const item of GAME_2048_STARTER_ITEMS) {
        await client.query(UPSERT_STORE_ITEM_SQL, [
          item.id,
          item.name,
          '2048',
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
    console.log(
      `[seed-2048] Seeded ${GAME_2048_STARTER_ITEMS.length} 2048 starter items`,
    );
  } catch (error) {
    console.error('[seed-2048] Failed to seed 2048 starter items:', error);
  }
};
