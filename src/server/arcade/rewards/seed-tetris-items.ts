// ---------------------------------------------------------------------------
// Seed Tetris starter items idempotently. Called on server startup.
// Inserts ~15 thematic Tetris items across all 4 slots and rarities.
// Items have stable IDs so re-runs are no-ops.
// ---------------------------------------------------------------------------

import { queryOne, withTransaction } from '@/server/db/client';

import { LEGACY_SEEDS_ON_SALE } from './legacy-catalog';

type SeedItem = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  slot: 'blocks' | 'board' | 'effects' | 'ghost';
  assetRef: Record<string, unknown>;
};

const TETRIS_STARTER_ITEMS: SeedItem[] = [
  // ── Blocks ────────────────────────────────────────────────────────
  {
    id: 'tetris-blocks-arcade-classic',
    name: 'tixy Classic Blocks',
    rarity: 'common',
    slot: 'blocks',
    assetRef: {
      colorI: '#00f0f0', colorO: '#f0f000', colorT: '#a000f0',
      colorS: '#00f000', colorZ: '#f00000', colorJ: '#0000f0', colorL: '#f0a000',
      blockShading: 'bevel',
      highlightColor: '#ffffff', highlightIntensity: 15,
      borderColor: '#000000', borderWidth: 0,
      blockGlowEnabled: false, blockGlowColor: '#ffffff', blockGlowSize: 40,
    },
  },
  {
    id: 'tetris-blocks-candy',
    name: 'Candy Blocks',
    rarity: 'common',
    slot: 'blocks',
    assetRef: {
      colorI: '#67e8f9', colorO: '#fde68a', colorT: '#f0abfc',
      colorS: '#86efac', colorZ: '#fda4af', colorJ: '#a5b4fc', colorL: '#fdba74',
      blockShading: 'bevel',
      highlightColor: '#ffffff', highlightIntensity: 30,
      borderColor: '#000000', borderWidth: 0,
      blockGlowEnabled: false, blockGlowColor: '#ffffff', blockGlowSize: 40,
    },
  },
  {
    id: 'tetris-blocks-monochrome',
    name: 'Monochrome Blocks',
    rarity: 'common',
    slot: 'blocks',
    assetRef: {
      colorI: '#e5e5e5', colorO: '#cccccc', colorT: '#999999',
      colorS: '#b3b3b3', colorZ: '#7f7f7f', colorJ: '#4d4d4d', colorL: '#666666',
      blockShading: 'flat',
      highlightColor: '#ffffff', highlightIntensity: 25,
      borderColor: '#000000', borderWidth: 1,
      blockGlowEnabled: false, blockGlowColor: '#ffffff', blockGlowSize: 0,
    },
  },
  {
    id: 'tetris-blocks-neon-pulse',
    name: 'Neon Pulse',
    rarity: 'rare',
    slot: 'blocks',
    assetRef: {
      colorI: '#00e5ff', colorO: '#ffe600', colorT: '#e000ff',
      colorS: '#00ff7f', colorZ: '#ff1744', colorJ: '#2979ff', colorL: '#ff9100',
      blockShading: 'neon',
      highlightColor: '#ffffff', highlightIntensity: 35,
      borderColor: '#000000', borderWidth: 0,
      blockGlowEnabled: true, blockGlowColor: '#ffffff', blockGlowSize: 70,
    },
  },
  {
    id: 'tetris-blocks-chrome',
    name: 'Chrome Blocks',
    rarity: 'epic',
    slot: 'blocks',
    assetRef: {
      colorI: '#b0e0ff', colorO: '#ffeb99', colorT: '#d4a5ff',
      colorS: '#99ffa8', colorZ: '#ff9999', colorJ: '#99b5ff', colorL: '#ffc988',
      blockShading: 'gradient',
      highlightColor: '#ffffff', highlightIntensity: 45,
      borderColor: '#2a2a3a', borderWidth: 1,
      blockGlowEnabled: false, blockGlowColor: '#ffffff', blockGlowSize: 0,
    },
  },
  {
    id: 'tetris-blocks-korobeiniki-gold',
    name: 'Korobeiniki Gold',
    rarity: 'legendary',
    slot: 'blocks',
    assetRef: {
      colorI: '#ffd700', colorO: '#ffec8b', colorT: '#daa520',
      colorS: '#f4c430', colorZ: '#b8860b', colorJ: '#cd950c', colorL: '#ffb347',
      blockShading: 'gradient',
      highlightColor: '#fff8dc', highlightIntensity: 55,
      borderColor: '#8b6914', borderWidth: 2,
      blockGlowEnabled: true, blockGlowColor: '#ffd700', blockGlowSize: 85,
    },
  },

  // ── Board ─────────────────────────────────────────────────────────
  {
    id: 'tetris-board-midnight',
    name: 'Midnight Grid',
    rarity: 'common',
    slot: 'board',
    assetRef: {
      boardBgMode: 'solid', boardBgStart: '#0a0a14', boardBgEnd: '#0a0a14',
      gridLineColor: '#ffffff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#64c8ff', borderWidth: 2,
      borderGlowEnabled: false, borderGlowColor: '#64c8ff',
      emptyCellTint: '#ffffff', emptyCellTintStrength: 0,
      vignette: 0,
    },
  },
  {
    id: 'tetris-board-aurora',
    name: 'Aurora',
    rarity: 'rare',
    slot: 'board',
    assetRef: {
      boardBgMode: 'linear', boardBgStart: '#0a1a2e', boardBgEnd: '#1a0a2e',
      gridLineColor: '#ffffff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#a855f7', borderWidth: 3,
      borderGlowEnabled: true, borderGlowColor: '#a855f7',
      emptyCellTint: '#ffffff', emptyCellTintStrength: 0,
      vignette: 15,
    },
  },
  {
    id: 'tetris-board-hologrid',
    name: 'Hologrid',
    rarity: 'epic',
    slot: 'board',
    assetRef: {
      boardBgMode: 'radial', boardBgStart: '#001a2e', boardBgEnd: '#000511',
      gridLineColor: '#00ffff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#00ffff', borderWidth: 2,
      borderGlowEnabled: true, borderGlowColor: '#00ffff',
      emptyCellTint: '#00ffff', emptyCellTintStrength: 3,
      vignette: 30,
    },
  },

  // ── Effects ───────────────────────────────────────────────────────
  {
    id: 'tetris-effects-retro-crt',
    name: 'Retro CRT',
    rarity: 'common',
    slot: 'effects',
    assetRef: {
      lineClearStyle: 'sweep',
      lineClearColor: '#00ff41', lineClearIntensity: 85,
      tetrisClearColor: '#00ffaa',
      tspinHighlightColor: '#00ff41',
      lockFlashColor: '#00ff41', lockFlashIntensity: 40,
      hardDropImpactColor: '#00ff41', hardDropImpactSize: 50,
    },
  },
  {
    id: 'tetris-effects-firework',
    name: 'Firework Burst',
    rarity: 'rare',
    slot: 'effects',
    assetRef: {
      lineClearStyle: 'dissolve',
      lineClearColor: '#ffd700', lineClearIntensity: 90,
      tetrisClearColor: '#ff1493',
      tspinHighlightColor: '#ff00ff',
      lockFlashColor: '#ffd700', lockFlashIntensity: 30,
      hardDropImpactColor: '#ffd700', hardDropImpactSize: 80,
    },
  },
  {
    id: 'tetris-effects-shatter',
    name: 'Shatter',
    rarity: 'epic',
    slot: 'effects',
    assetRef: {
      lineClearStyle: 'shatter',
      lineClearColor: '#f87171', lineClearIntensity: 95,
      tetrisClearColor: '#fbbf24',
      tspinHighlightColor: '#f0abfc',
      lockFlashColor: '#f87171', lockFlashIntensity: 35,
      hardDropImpactColor: '#f87171', hardDropImpactSize: 70,
    },
  },
  {
    id: 'tetris-effects-cascade',
    name: 'Cascade',
    rarity: 'legendary',
    slot: 'effects',
    assetRef: {
      lineClearStyle: 'sweep',
      lineClearColor: '#a855f7', lineClearIntensity: 100,
      tetrisClearColor: '#ff00ff',
      tspinHighlightColor: '#00ffff',
      lockFlashColor: '#ffffff', lockFlashIntensity: 45,
      hardDropImpactColor: '#a855f7', hardDropImpactSize: 90,
    },
  },

  // ── Ghost ─────────────────────────────────────────────────────────
  {
    id: 'tetris-ghost-classic',
    name: 'Classic Ghost',
    rarity: 'common',
    slot: 'ghost',
    assetRef: {
      ghostStyle: 'filled-translucent', ghostOpacity: 20,
      ghostTintEnabled: false, ghostTintColor: '#ffffff',
      panelBgColor: '#0a0a14', panelBorderColor: '#2a2a3a',
      panelAccentColor: '#64c8ff',
    },
  },
  {
    id: 'tetris-ghost-stealth',
    name: 'Stealth',
    rarity: 'common',
    slot: 'ghost',
    assetRef: {
      ghostStyle: 'outline', ghostOpacity: 10,
      ghostTintEnabled: false, ghostTintColor: '#ffffff',
      panelBgColor: '#0a0a14', panelBorderColor: '#1a1a2a',
      panelAccentColor: '#3a3a5a',
    },
  },
  {
    id: 'tetris-ghost-neon',
    name: 'Neon Ghost',
    rarity: 'rare',
    slot: 'ghost',
    assetRef: {
      ghostStyle: 'dashed', ghostOpacity: 45,
      ghostTintEnabled: true, ghostTintColor: '#00ffff',
      panelBgColor: '#050510', panelBorderColor: '#00ffff',
      panelAccentColor: '#ff00ff',
    },
  },
  {
    id: 'tetris-ghost-holo',
    name: 'Holo Ghost',
    rarity: 'epic',
    slot: 'ghost',
    assetRef: {
      ghostStyle: 'filled-translucent', ghostOpacity: 35,
      ghostTintEnabled: true, ghostTintColor: '#a855f7',
      panelBgColor: '#0f0818', panelBorderColor: '#a855f7',
      panelAccentColor: '#ec4899',
    },
  },

  /* wave-d cluster-b additions (tetris) */
  {
    id: 'tetris-blocks-sunset-boardwalk',
    name: 'Sunset Boardwalk',
    rarity: 'rare',
    slot: 'blocks',
    assetRef: {
      colorI: '#f97316', colorO: '#fbbf24', colorT: '#ec4899',
      colorS: '#f59e0b', colorZ: '#dc2626', colorJ: '#7c3aed', colorL: '#fb923c',
      blockShading: 'gradient',
      highlightColor: '#fff1cf', highlightIntensity: 40,
      borderColor: '#3a1206', borderWidth: 1,
      blockGlowEnabled: false, blockGlowColor: '#f97316', blockGlowSize: 30,
    },
  },
  {
    id: 'tetris-board-boardwalk-oak',
    name: 'Boardwalk Oak',
    rarity: 'common',
    slot: 'board',
    assetRef: {
      boardBgMode: 'linear', boardBgStart: '#3a2414', boardBgEnd: '#1c130a',
      gridLineColor: '#6f5334', gridLineWidth: 1, gridVisible: true,
      borderColor: '#0f0a06', borderWidth: 2,
      borderGlowEnabled: false, borderGlowColor: '#caa85a',
      emptyCellTint: '#caa85a', emptyCellTintStrength: 2, vignette: 22,
    },
  },
  {
    id: 'tetris-ghost-amber',
    name: 'Amber Ghost',
    rarity: 'rare',
    slot: 'ghost',
    assetRef: {
      ghostStyle: 'dashed', ghostOpacity: 38,
      ghostTintEnabled: true, ghostTintColor: '#f2a33c',
      panelBgColor: '#17110a', panelBorderColor: '#f2a33c', panelAccentColor: '#facc15',
    },
  },
];

// Prices use the same tiers the admin UI generates (base × 1.3 complexity).
// Using round numbers that match what the automatic skin-studio pricing would
// produce for bevel/gradient/glow items at each rarity.
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

export const seedTetrisStarterItems = async () => {
  // Process-level cache: only run the count query once per server lifetime
  if (hasSeeded) return;
  // Idempotent check — only seed if the Tetris catalog has fewer than the starter count.
  try {
    // Count this seed's own ids: the counter adds other tetris items.
    const row = await queryOne<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM store_items WHERE id = ANY($1::text[])`,
      [TETRIS_STARTER_ITEMS.map((item) => item.id)],
    );
    const existing = Number(row?.count ?? 0);
    if (existing >= TETRIS_STARTER_ITEMS.length) {
      hasSeeded = true;
      return;
    }

    const now = Date.now();
    await withTransaction(async (client) => {
      for (const item of TETRIS_STARTER_ITEMS) {
        await client.query(UPSERT_STORE_ITEM_SQL, [
          item.id,
          item.name,
          'tetris',
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
  } catch (error) {
    console.error('[seed-tetris-items] Failed to seed Tetris starter items:', error);
  }
};
