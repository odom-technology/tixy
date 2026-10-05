/**
 * Seed the cosmetics catalog for the 2026-06 economy + skins expansion.
 *
 *   npx tsx scripts/seed-cosmetics.ts
 *
 * Idempotent: every item has a stable id and is UPSERTed (ON CONFLICT id DO
 * UPDATE), so re-runs refresh the curated catalog without touching admin- or
 * battlepass-created items or anyone's ownership/equips.
 *
 * The asset_ref keys for each game/slot match exactly what that game's
 * `_<game>-theme.ts` reader consumes, so equipping a seeded item actually
 * re-skins the game. Color keys also drive the shared store/inventory/profile
 * preview (it extracts hex colors from asset_ref); `previewBg*` keys pin the
 * preview's backdrop gradient for a cleaner card.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { LEGACY_SEEDS_ON_SALE } from '@/server/arcade/rewards/legacy-catalog';
import type { RewardGameType, StoreRarity } from '@/features/arcade/lib/rewards';
import { STORE_AVATARS } from '@/features/users/avatars';

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

type Rarity = Extract<StoreRarity, 'common' | 'rare' | 'epic' | 'legendary'>;

type SeedItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  rarity: Rarity;
  slots: string[];
  active?: boolean;
  seasonTag?: string | null;
  assetRef: Record<string, unknown>;
};

// Prices tuned for the post-2026-06 economy (daily cap 300, daily claim up to
// ~200/day). Commons are a day or two of play; legendaries are aspirational.
const PRICE_BY_RARITY: Record<Rarity, number> = {
  common: 450,
  rare: 750,
  epic: 1200,
  legendary: 2000,
};

/** Pin the preview backdrop gradient so cards read cleanly. */
const pv = (start: string, end: string) => ({
  previewBgEnabled: true,
  previewBgStart: start,
  previewBgEnd: end,
});

const items: SeedItem[] = [];
// Duplicate ids must be a seed-time crash: three branches append to this file
// concurrently, and a hand-written id collision merges without a git conflict,
// then upserts last-writer-wins — silently morphing an already-sold item.
const seenIds = new Set<string>();
const add = (
  gameType: RewardGameType,
  slot: string,
  id: string,
  name: string,
  rarity: Rarity,
  assetRef: Record<string, unknown>,
) => {
  if (seenIds.has(id)) {
    throw new Error(`[seed-cosmetics] duplicate item id '${id}' — ids must be unique`);
  }
  seenIds.add(id);
  // Image-backed items only seed when their PNG exists (same policy as the
  // STORE_AVATARS loop below): a half-shipped asset batch must never put a
  // broken store card on sale — profile-flair renders url(imageUrl) directly
  // and does NOT fall back to the gradient when the file 404s.
  const imageUrl = assetRef.imageUrl;
  if (typeof imageUrl === 'string' && imageUrl.startsWith('/')) {
    const assetPath = path.join(process.cwd(), 'public', imageUrl.replace(/^\//, ''));
    if (!fs.existsSync(assetPath)) {
      console.warn(`[seed-cosmetics] skipping ${id} — missing ${imageUrl}`);
      return;
    }
  }
  items.push({ id, name, gameType, rarity, slots: [slot], assetRef });
};

/* ───────────────────────────── GOPHER ─────────────────────────────
   slots: gopher (mole), turf (board/holes), effects (bonk feedback) */
add('gopher', 'gopher', 'gopher-gopher-classic', 'Burrow Brown', 'common', {
  gopherBody: '#b07a47', gopherBodyHi: '#c79363', gopherBodyLo: '#8a5d33',
  gopherEdge: '#5d3d20', gopherNose: '#3a2414', gopherPaw: '#c79363', ...pv('#3a2414', '#b07a47'),
});
add('gopher', 'gopher', 'gopher-gopher-arctic', 'Arctic Digger', 'rare', {
  gopherBody: '#d7e6ef', gopherBodyHi: '#ffffff', gopherBodyLo: '#a9c4d6',
  gopherEdge: '#7d9bb0', gopherNose: '#5b7b8a', gopherPaw: '#ffffff', ...pv('#2b3b47', '#d7e6ef'),
});
add('gopher', 'gopher', 'gopher-gopher-neon', 'Neon Critter', 'epic', {
  gopherBody: '#22d3ee', gopherBodyHi: '#a5f3fc', gopherBodyLo: '#0e7490',
  gopherEdge: '#083344', gopherNose: '#cffafe', gopherPaw: '#a5f3fc',
  gopherGlowEnabled: true, gopherGlowColor: '#22d3ee', ...pv('#062c3a', '#22d3ee'),
});
add('gopher', 'turf', 'gopher-turf-meadow', 'Meadow Turf', 'common', {
  woodTop: '#3f7d3a', woodMid: '#356b31', woodBottom: '#274f24', woodGrain: '#2c5a28',
  holeDark: '#1c2a1a', holeFloor: '#14210f', rimHi: '#4f9447', rimLo: '#2c5a28', ...pv('#14210f', '#3f7d3a'),
});
add('gopher', 'turf', 'gopher-turf-dusk', 'Dusk Sands', 'rare', {
  woodTop: '#d8a657', woodMid: '#c08c3e', woodBottom: '#8a5f24', woodGrain: '#a8772f',
  holeDark: '#3a2412', holeFloor: '#23150a', rimHi: '#e8c07a', rimLo: '#a8772f', ...pv('#23150a', '#d8a657'),
});
add('gopher', 'effects', 'gopher-effects-spark', 'Spark Burst', 'rare', {
  bonkFlashColor: '#fff7cc', particleColor: '#facc15',
  particleColors: ['#facc15', '#fb923c', '#fef3c7'], ...pv('#1a1407', '#facc15'),
});
add('gopher', 'effects', 'gopher-effects-arcade', 'Arcade Pop', 'epic', {
  bonkFlashColor: '#ffffff', particleColor: '#ec4899',
  particleColors: ['#ec4899', '#22d3ee', '#a855f7', '#fde047'], ...pv('#16071a', '#ec4899'),
});
/* wave-d cluster-a additions (gopher) */
add('gopher', 'gopher', 'gopher-gopher-shadow', 'Shadow Mole', 'rare', {
  gopherBody: '#7c3aed', gopherBodyHi: '#a78bfa', gopherBodyLo: '#5b21b6', gopherEdge: '#2e1065', gopherNose: '#1c0a3a', gopherPaw: '#a78bfa', ...pv('#1a0f2e', '#7c3aed'),
});
add('gopher', 'turf', 'gopher-turf-tundra', 'Tundra Turf', 'common', {
  woodTop: '#4a6b7a', woodMid: '#38525e', woodBottom: '#253840', woodGrain: '#567685', holeDark: '#0a1418', holeFloor: '#060d10', rimHi: '#6d97a8', rimLo: '#2b4048', ...pv('#0a1418', '#4a6b7a'),
});
add('gopher', 'effects', 'gopher-effects-emerald', 'Emerald Sparks', 'rare', {
  bonkFlashColor: '#ecfdf5', particleColor: '#34d399', particleColors: ['#34d399', '#a7f3d0', '#facc15', '#22d3ee'], ...pv('#04140e', '#34d399'),
});

/* ──────────────────────────── RICOCHET ────────────────────────────
   slots: bird, obstacle, background, trail */
add('ricochet', 'bird', 'ricochet-bird-ember', 'Ember Dart', 'common', {
  birdPrimary: '#f97316', birdSecondary: '#c2410c', birdHighlight: '#fdba74',
  birdBelly: '#fed7aa', beak: '#fbbf24', beakLo: '#d97706', ...pv('#1a0d04', '#f97316'),
});
add('ricochet', 'bird', 'ricochet-bird-plasma', 'Plasma Dart', 'epic', {
  birdPrimary: '#a855f7', birdSecondary: '#7e22ce', birdHighlight: '#e9d5ff',
  birdBelly: '#f3e8ff', beak: '#22d3ee', beakLo: '#0891b2', birdGlow: '#a855f7', ...pv('#150724', '#a855f7'),
});
add('ricochet', 'obstacle', 'ricochet-obstacle-rust', 'Rust Spikes', 'common', {
  obstacleColor: '#6b7280', spikeColor: '#9ca3af', obstacleEdge: '#374151',
  rail: '#52525b', railHi: '#71717a', railLo: '#3f3f46', ...pv('#18181b', '#9ca3af'),
});
add('ricochet', 'obstacle', 'ricochet-obstacle-toxic', 'Toxic Spikes', 'rare', {
  obstacleColor: '#4d7c0f', spikeColor: '#84cc16', obstacleEdge: '#1a2e05',
  rail: '#3f6212', railHi: '#a3e635', railLo: '#1a2e05', ...pv('#0c1503', '#84cc16'),
});
add('ricochet', 'background', 'ricochet-background-aurora', 'Aurora Well', 'rare', {
  well: '#0b1b2b', wellEdge: '#05101a', accent: '#34d399', enamelRed: '#22d3ee',
  stars: true, ...pv('#05101a', '#0b3b4a'),
});
add('ricochet', 'trail', 'ricochet-trail-comet', 'Comet Trail', 'epic', {
  trailEnabled: true, trailColor: '#38bdf8', trailLength: 18, ...pv('#04121a', '#38bdf8'),
});
/* wave-d cluster-a additions (ricochet) */
add('ricochet', 'bird', 'ricochet-bird-frost', 'Frost Finch', 'rare', {
  birdPrimary: '#7dd3fc', birdSecondary: '#0ea5e9', birdHighlight: '#e0f2fe', birdBelly: '#f0f9ff', beak: '#fb923c', beakLo: '#ea580c', ...pv('#04121a', '#7dd3fc'),
});
add('ricochet', 'obstacle', 'ricochet-obstacle-gold', 'Golden Fangs', 'rare', {
  obstacleColor: '#ca8a04', spikeColor: '#fde047', obstacleEdge: '#713f12', rail: '#78350f', railHi: '#a16207', railLo: '#451a03', ...pv('#1a1004', '#fde047'),
});
add('ricochet', 'trail', 'ricochet-trail-neon', 'Neon Streak', 'epic', {
  trailEnabled: true, trailColor: '#f472b6', trailLength: 22, ...pv('#1a0612', '#f472b6'),
});

/* ───────────────────────────── SWERVE (3D) ────────────────────────
   slots: cart, track, environment */
add('swerve', 'cart', 'swerve-cart-redline', 'Redline', 'common', {
  cartPrimary: '#dc2626', cartSecondary: '#7f1d1d', cartStripe: '#fca5a5', cartGlass: '#1e293b', ...pv('#1a0606', '#dc2626'),
});
add('swerve', 'cart', 'swerve-cart-voltage', 'Voltage', 'epic', {
  cartPrimary: '#22d3ee', cartSecondary: '#0e7490', cartStripe: '#a5f3fc', cartGlass: '#082f49',
  cartGlow: '#22d3ee', cartGlowIntensity: 0.6, ...pv('#03212b', '#22d3ee'),
});
add('swerve', 'track', 'swerve-track-midnight', 'Midnight Asphalt', 'rare', {
  trackColor: '#1e293b', laneLineColor: '#fbbf24', edgeColor: '#0f172a', edgeTopColor: '#334155',
  tieColor: '#475569', blockRed: '#ef4444', blockTeal: '#2dd4bf', ...pv('#0a0f1a', '#334155'),
});
add('swerve', 'environment', 'swerve-environment-sunset', 'Sunset Drive', 'epic', {
  skyColor: '#f97316', fogColor: '#fb7185', groundColor: '#7c2d12', accent: '#fde68a', ...pv('#2a0f06', '#f97316'),
});
add('swerve', 'environment', 'swerve-environment-vapor', 'Vaporwave', 'legendary', {
  skyColor: '#581c87', fogColor: '#db2777', groundColor: '#1e1b4b', accent: '#22d3ee', ...pv('#150726', '#db2777'),
});
/* wave-d cluster-a additions (swerve) */
add('swerve', 'cart', 'swerve-cart-golden', 'Golden Bullet', 'rare', {
  cartPrimary: '#f59e0b', cartSecondary: '#92400e', cartStripe: '#fde68a', cartGlass: '#451a03', cartGlow: '#fbbf24', cartGlowIntensity: 0.7, ...pv('#1a1004', '#f59e0b'),
});
add('swerve', 'track', 'swerve-track-canyon', 'Canyon Run', 'rare', {
  trackColor: '#7c2d12', laneLineColor: '#fde68a', edgeColor: '#431407', edgeTopColor: '#9a3412', tieColor: '#5c2410', blockRed: '#ef4444', blockTeal: '#14b8a6', ...pv('#1c0a04', '#9a3412'),
});
add('swerve', 'environment', 'swerve-environment-arctic', 'Arctic Night', 'legendary', {
  skyColor: '#0c1a2e', fogColor: '#1e3a5f', groundColor: '#0a1420', accent: '#7dd3fc', ...pv('#040a14', '#7dd3fc'),
});

/* ───────────────────────────── TUMBLER ────────────────────────────
   slots: dial, pegs, background */
add('tumbler', 'dial', 'tumbler-dial-brass', 'Polished Brass', 'common', {
  dialColor: '#caa85a', dialMid: '#a8842f', dialLo: '#6b521b', dialDeep: '#3a2c0e',
  dialAccent: '#f2d98a', pointerColor: '#fef3c7', pointerHi: '#ffffff', ...pv('#1a1407', '#caa85a'),
});
add('tumbler', 'dial', 'tumbler-dial-chrome', 'Cold Chrome', 'rare', {
  dialColor: '#cbd5e1', dialMid: '#94a3b8', dialLo: '#475569', dialDeep: '#1e293b',
  dialAccent: '#f1f5f9', pointerColor: '#38bdf8', pointerHi: '#e0f2fe',
  dialGlowEnabled: true, dialGlowColor: '#38bdf8', ...pv('#0a0f1a', '#cbd5e1'),
});
add('tumbler', 'pegs', 'tumbler-pegs-gold', 'Gold Notch', 'common', {
  pegColor: '#fbbf24', pegActiveColor: '#fde68a', pegHitColor: '#f97316', pegEdge: '#92400e', ...pv('#1a1004', '#fbbf24'),
});
add('tumbler', 'pegs', 'tumbler-pegs-emerald', 'Emerald Notch', 'rare', {
  pegColor: '#34d399', pegActiveColor: '#a7f3d0', pegHitColor: '#22d3ee', pegEdge: '#065f46', ...pv('#04140e', '#34d399'),
});
add('tumbler', 'background', 'tumbler-background-walnut', 'Deep Walnut', 'common', {
  bgTop: '#4a3322', bgMid: '#3a2718', bgBottom: '#241509', bgGrain: '#5a4030',
  bgWell: '#160d05', bgWellEdge: '#0a0603', accent: '#34d399', accentAmber: '#fbbf24', accentRed: '#ef4444', ...pv('#0a0603', '#4a3322'),
});
/* wave-d cluster-a additions (tumbler) */
add('tumbler', 'dial', 'tumbler-dial-obsidian', 'Obsidian Dial', 'epic', {
  dialColor: '#3f3f46', dialMid: '#27272a', dialLo: '#18181b', dialDeep: '#09090b', dialAccent: '#71717a', pointerColor: '#a855f7', pointerHi: '#e9d5ff', dialGlowEnabled: true, dialGlowColor: '#a855f7', ...pv('#0a0812', '#a855f7'),
});
add('tumbler', 'pegs', 'tumbler-pegs-ruby', 'Ruby Notch', 'common', {
  pegColor: '#f43f5e', pegActiveColor: '#fda4af', pegHitColor: '#fbbf24', pegEdge: '#881337', ...pv('#1a060c', '#f43f5e'),
});
add('tumbler', 'background', 'tumbler-background-ivory', 'Ivory Cabinet', 'rare', {
  bgTop: '#d6c4a8', bgMid: '#b89e78', bgBottom: '#8a6f4a', bgGrain: '#e0d0b4', bgWell: '#2a2018', bgWellEdge: '#140f0a', accentTeal: '#2bb2a0', accentAmber: '#f59e0b', accentRed: '#dc2626', ...pv('#140f0a', '#d6c4a8'),
});

/* ──────────────────────────── KNIFE BOOTH ─────────────────────────
   slots: knife (thrown blade + handle), target (spinning wood target),
   effects (stick-thunk sparks + bonus-fruit tint) */
add('knife-booth', 'knife', 'knife-booth-knife-steel', 'Carnival Steel', 'common', {
  bladeColor: '#c7d0da', bladeHi: '#f4f7fb', bladeLo: '#8b95a1', bladeEdge: '#4b525c',
  handleColor: '#8a3b22', handleAccent: '#c1613d', ...pv('#140c06', '#c7d0da'),
});
add('knife-booth', 'knife', 'knife-booth-knife-gold', 'Gilded Dagger', 'rare', {
  bladeColor: '#fcd34d', bladeHi: '#fff7cc', bladeLo: '#b8860b', bladeEdge: '#7c5a10',
  handleColor: '#5b2a12', handleAccent: '#c1613d',
  knifeGlowEnabled: true, knifeGlowColor: '#fcd34d', ...pv('#1a1407', '#fcd34d'),
});
add('knife-booth', 'target', 'knife-booth-target-oak', 'Seasoned Oak', 'common', {
  woodColor: '#a5703c', woodHi: '#c98f52', woodLo: '#6f4a24', woodEdge: '#3c2712',
  ringColor: '#815631', bullColor: '#c8402f', bullEdge: '#7c1f18', ...pv('#140c06', '#a5703c'),
});
add('knife-booth', 'target', 'knife-booth-target-emerald', 'Emerald Bullseye', 'rare', {
  woodColor: '#2f6f5a', woodHi: '#4fae8f', woodLo: '#1c4437', woodEdge: '#0e241d',
  ringColor: '#3a8a70', bullColor: '#facc15', bullEdge: '#a16207', ...pv('#04140e', '#2f6f5a'),
});
add('knife-booth', 'effects', 'knife-booth-effects-neon', 'Neon Thunk', 'epic', {
  sparkColor: '#22d3ee', sparkHotColor: '#a5f3fc',
  fruitColor: '#f472b6', fruitHi: '#fbcfe8', fruitLeaf: '#34d399', ...pv('#062c3a', '#22d3ee'),
});
/* wave-d cluster-a additions (knife-booth) */
add('knife-booth', 'knife', 'knife-booth-knife-frost', 'Frost Fang', 'epic', {
  bladeColor: '#a5f3fc', bladeHi: '#ecfeff', bladeLo: '#22d3ee', bladeEdge: '#0e7490', handleColor: '#1e3a5f', handleAccent: '#38bdf8', knifeGlowEnabled: true, knifeGlowColor: '#a5f3fc', ...pv('#03212b', '#a5f3fc'),
});
add('knife-booth', 'target', 'knife-booth-target-crimson', 'Crimson Rings', 'common', {
  woodColor: '#7f1d1d', woodHi: '#b91c1c', woodLo: '#450a0a', woodEdge: '#1c0505', ringColor: '#991b1b', bullColor: '#fde047', bullEdge: '#a16207', ...pv('#1c0505', '#7f1d1d'),
});
add('knife-booth', 'effects', 'knife-booth-effects-golden', 'Golden Thunk', 'rare', {
  sparkColor: '#fbbf24', sparkHotColor: '#fef9c3', fruitColor: '#f97316', fruitHi: '#fed7aa', fruitLeaf: '#65a30d', ...pv('#1a1004', '#fbbf24'),
});

/* ──────────────────────────── MELON CHOP ──────────────────────────
   slots: blade (swipe trail + optional glow), fruit (fruit-set body/hi per
   variant + leaf), splatter (juice-splatter particle tint) */
add('melon-chop', 'blade', 'melon-chop-blade-steel', 'Carnival Steel', 'common', {
  trailColor: '#f7eedd', trailCore: '#ffffff', ...pv('#071612', '#f7eedd'),
});
add('melon-chop', 'blade', 'melon-chop-blade-plasma', 'Plasma Edge', 'rare', {
  trailColor: '#38bdf8', trailCore: '#e0f2fe',
  bladeGlowEnabled: true, bladeGlowColor: '#38bdf8', ...pv('#04202c', '#38bdf8'),
});
add('melon-chop', 'fruit', 'melon-chop-fruit-orchard', 'Orchard Ripe', 'common', {
  fruitBody0: '#d63b56', fruitHi0: '#ff8aa0',
  fruitBody1: '#f2a13c', fruitHi1: '#ffd08a',
  fruitBody2: '#8ec63f', fruitHi2: '#c9f08a',
  fruitBody3: '#7b5cd6', fruitHi3: '#c3b0ff',
  fruitBody4: '#2bb2a0', fruitHi4: '#8fe6da',
  fruitRind: '#3c8a4a', leaf: '#4fae52', ...pv('#071612', '#d63b56'),
});
add('melon-chop', 'fruit', 'melon-chop-fruit-neon', 'Neon Tropics', 'epic', {
  fruitBody0: '#ff2d95', fruitHi0: '#ffb3d9',
  fruitBody1: '#ffb020', fruitHi1: '#ffe08a',
  fruitBody2: '#22e0a1', fruitHi2: '#b0ffe4',
  fruitBody3: '#38bdf8', fruitHi3: '#c0ecff',
  fruitBody4: '#a855f7', fruitHi4: '#e6cbff',
  fruitRind: '#0f766e', leaf: '#34d399', ...pv('#0a0620', '#22e0a1'),
});
add('melon-chop', 'splatter', 'melon-chop-splatter-berry', 'Berry Splash', 'rare', {
  juiceColor: '#e11d74', juiceHiColor: '#ffd7ea', ...pv('#1a0714', '#e11d74'),
});

/* ─────────────────────────── TIN DUCK GALLERY ─────────────────────
   slots: duck (scrolling tin ducks), sight (crosshair + muzzle/spark),
   booth (curtains + valance + backboard) */
add('tin-duck', 'duck', 'tin-duck-duck-tin', 'Painted Tin', 'common', {
  duckColor: '#e7edf2', duckHi: '#ffffff', duckLo: '#aeb9c4', duckEdge: '#4b525c',
  bellyColor: '#f6c862', beakColor: '#e8863a', eyeColor: '#20140a', ...pv('#0c3a30', '#e7edf2'),
});
add('tin-duck', 'duck', 'tin-duck-duck-golden', 'Golden Flock', 'rare', {
  duckColor: '#f2b93f', duckHi: '#ffe08a', duckLo: '#c78d1f', duckEdge: '#8a5c10',
  bellyColor: '#fff3cd', beakColor: '#c87a1a', eyeColor: '#3a2408',
  duckGlowEnabled: true, duckGlowColor: '#ffe08a', ...pv('#1a1407', '#f2b93f'),
});
add('tin-duck', 'duck', 'tin-duck-duck-teal', 'Enamel Teal', 'rare', {
  duckColor: '#2bb2a0', duckHi: '#6fd3c2', duckLo: '#1d8073', duckEdge: '#0e3a34',
  bellyColor: '#f6eddc', beakColor: '#e8a23c', eyeColor: '#08201c', ...pv('#04231d', '#2bb2a0'),
});
add('tin-duck', 'sight', 'tin-duck-sight-neon', 'Neon Reticle', 'epic', {
  sightColor: '#a5f3fc', sightAccent: '#22d3ee',
  muzzleColor: '#67e8f9', muzzleHot: '#ecfeff', sparkColor: '#22d3ee', sparkHot: '#cffafe',
  ...pv('#062c3a', '#22d3ee'),
});
add('tin-duck', 'booth', 'tin-duck-booth-royal', 'Royal Booth', 'rare', {
  curtainColor: '#5b3ea8', curtainLo: '#3f2a7a', curtainShade: '#281a52',
  valanceColor: '#f2c14e', skyTop: '#2a4d8f', skyBottom: '#12234a',
  backboardColor: '#1a2c52', backboardLine: '#0c1730', railColor: '#4a3320', railHi: '#6a4a2c',
  ...pv('#12234a', '#f2c14e'),
});

/* ─────────────────────────── BOARDWALK HOP ────────────────────────
   slots: hopper (mascot), lane (planks + cart/flume hazards), scene (sky/shadow) */
add('boardwalk-hop', 'hopper', 'boardwalk-hop-hopper-duckling', 'Enamel Duckling', 'common', {
  hopperBody: '#f2c14e', hopperShade: '#c8942f', hopperBelly: '#fbe6b4', hopperFace: '#3a2414',
  ...pv('#3a2414', '#f2c14e'),
});
add('boardwalk-hop', 'hopper', 'boardwalk-hop-hopper-frog', 'Lucky Frog', 'rare', {
  hopperBody: '#7ac74f', hopperShade: '#4f9331', hopperBelly: '#d8f2b4', hopperFace: '#20340f',
  ...pv('#20340f', '#7ac74f'),
});
add('boardwalk-hop', 'hopper', 'boardwalk-hop-hopper-neon', 'Neon Hopper', 'epic', {
  hopperBody: '#22d3ee', hopperShade: '#0e7490', hopperBelly: '#cffafe', hopperFace: '#062c3a',
  hopperGlow: '#22d3ee', hopperGlowIntensity: 0.8, ...pv('#062c3a', '#22d3ee'),
});
add('boardwalk-hop', 'lane', 'boardwalk-hop-lane-seaside', 'Seaside Planks', 'common', {
  plankLight: '#d8b072', plankDark: '#b3853f', roadTop: '#5b5450', roadSide: '#3f3a37',
  flumeTop: '#2f7d8a', flumeSide: '#1f5763', cartBody: '#c73538', cartShade: '#8f2427',
  logBody: '#7a5230', logShade: '#553920', laneEdge: '#2c1d0f', ...pv('#1f5763', '#d8b072'),
});
add('boardwalk-hop', 'lane', 'boardwalk-hop-lane-midnight', 'Midnight Midway', 'epic', {
  plankLight: '#3c4a63', plankDark: '#2a3348', roadTop: '#1c2233', roadSide: '#121626',
  flumeTop: '#3b2f6b', flumeSide: '#241a4a', cartBody: '#ec4899', cartShade: '#a52c67',
  logBody: '#5a4a8a', logShade: '#3a2f5c', laneEdge: '#0a0d18', ...pv('#121626', '#ec4899'),
});
add('boardwalk-hop', 'scene', 'boardwalk-hop-scene-sunset', 'Sunset Pier', 'rare', {
  skyTop: '#f6a06a', skyBottom: '#ffe0a8', horizon: '#f0b070',
  tileShadow: 'rgba(40,16,8,0.34)', accent: '#ff7e54', ...pv('#f6a06a', '#ffe0a8'),
});

/* ─────────────────────────── LOG SPLITTER ─────────────────────────
   slots: axe (blade/handle/lumberjack), tree (bark/branches), background
   (sky/ground), effects (wood-chip particles) */
add('log-splitter', 'axe', 'log-splitter-axe-iron', 'Iron Splitter', 'common', {
  bladeColor: '#c7cdd4', bladeHi: '#eef2f6', bladeEdge: '#6b7280',
  handleColor: '#8a5a2b', shirtColor: '#b23b3b', ...pv('#141414', '#c7cdd4'),
});
add('log-splitter', 'axe', 'log-splitter-axe-frost', 'Frostbite Axe', 'rare', {
  bladeColor: '#a5d8f0', bladeHi: '#e0f4ff', bladeEdge: '#3b7ea1',
  handleColor: '#5b6b7a', shirtColor: '#2f6f8f',
  axeGlowEnabled: true, axeGlowColor: '#7fd3f0', ...pv('#061620', '#a5d8f0'),
});
add('log-splitter', 'tree', 'log-splitter-tree-blossom', 'Blossom Pine', 'rare', {
  barkColor: '#8a6a52', barkHi: '#a98867', barkLo: '#5c4636', grain: '#6f5442',
  branchColor: '#9c7a5f', branchHi: '#c0a084', branchEdge: '#4a3626', ring: '#d8b98f',
  ...pv('#1a0f0a', '#f7b8d0'),
});
add('log-splitter', 'background', 'log-splitter-background-dusk', 'Autumn Dusk', 'rare', {
  skyTop: '#f0894e', skyBottom: '#3a2352', ground: '#4a3320', groundEdge: '#2a1c10',
  accent: '#ffd27f', ...pv('#1c1030', '#f0894e'),
});
add('log-splitter', 'effects', 'log-splitter-effects-embers', 'Ember Chips', 'epic', {
  chipColor: '#f7c05a', chipColorAlt: '#e8763a', flashColor: '#fff1cf', ...pv('#1a0d04', '#f7c05a'),
});
/* wave-d cluster-a additions (log-splitter) */
add('log-splitter', 'axe', 'log-splitter-axe-molten', 'Molten Cleaver', 'rare', {
  bladeColor: '#f97316', bladeHi: '#fdba74', bladeEdge: '#9a3412', handleColor: '#451a03', shirtColor: '#7f1d1d', axeGlowEnabled: true, axeGlowColor: '#fb923c', ...pv('#1a0604', '#f97316'),
});
add('log-splitter', 'tree', 'log-splitter-tree-birch', 'Birch Grove', 'common', {
  barkColor: '#d6cbb8', barkHi: '#f0e9dc', barkLo: '#9c8f78', grain: '#3a3530', ring: '#e8dcc4', branchColor: '#b0a48c', branchHi: '#d4c8b0', branchEdge: '#5c5344', ...pv('#1a1814', '#d6cbb8'),
});
add('log-splitter', 'background', 'log-splitter-background-emerald', 'Emerald Dawn', 'rare', {
  skyTop: '#34d399', skyBottom: '#065f46', ground: '#1c3325', groundEdge: '#0d1a13', accent: '#d9f99d', ...pv('#0d1a13', '#34d399'),
});

/* ──────────────────────────── BREAKOUT ────────────────────────────
   slots: paddle, ball, bricks, background */
add('breakout', 'paddle', 'breakout-paddle-arcade', 'Arcade Slab', 'common', {
  paddleColor: '#e2e8f0', paddleAccent: '#94a3b8', ...pv('#0a0f1a', '#e2e8f0'),
});
add('breakout', 'paddle', 'breakout-paddle-laser', 'Laser Slab', 'rare', {
  paddleColor: '#22d3ee', paddleAccent: '#a5f3fc', paddleGlow: '#22d3ee', paddleGlowEnabled: true, ...pv('#03212b', '#22d3ee'),
});
add('breakout', 'ball', 'breakout-ball-plasma', 'Plasma Orb', 'rare', {
  ballColor: '#f472b6', ballEdge: '#be185d', ballGlow: '#f472b6', ballGlowEnabled: true, ballTrail: true, ...pv('#1a0612', '#f472b6'),
});
add('breakout', 'bricks', 'breakout-bricks-spectrum', 'Spectrum Wall', 'epic', {
  brickColors: ['#ef4444', '#f97316', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7'],
  brickEdge: '#0f172a', ...pv('#0a0f1a', '#a855f7'),
});
add('breakout', 'bricks', 'breakout-bricks-ice', 'Glacier Wall', 'rare', {
  brickColorA: '#bae6fd', brickColorB: '#7dd3fc', brickColorC: '#38bdf8', brickEdge: '#075985', ...pv('#04121a', '#7dd3fc'),
});
add('breakout', 'background', 'breakout-background-grid', 'Neon Grid', 'common', {
  bgTop: '#0b1120', bgBottom: '#020617', accent: '#22d3ee', ...pv('#020617', '#0b3b4a'),
});
/* wave-d cluster-a additions (breakout) */
add('breakout', 'paddle', 'breakout-paddle-ember', 'Ember Slab', 'common', {
  paddleColor: '#f97316', paddleAccent: '#fdba74', ...pv('#1a0d04', '#f97316'),
});
add('breakout', 'ball', 'breakout-ball-golden', 'Golden Orb', 'rare', {
  ballColor: '#fbbf24', ballEdge: '#b45309', ballGlow: '#fbbf24', ballGlowEnabled: true, ballTrail: true, ...pv('#1a1004', '#fbbf24'),
});
add('breakout', 'bricks', 'breakout-bricks-sunset', 'Sunset Wall', 'epic', {
  brickColors: ['#f43f5e', '#fb7185', '#f97316', '#fbbf24', '#a855f7', '#ec4899'], brickEdge: '#4c0519', ...pv('#1a060c', '#f43f5e'),
});

/* ───────────────────────────── STACK ──────────────────────────────
   slots: blocks, background, effects */
add('stack', 'blocks', 'stack-blocks-sunrise', 'Sunrise Stack', 'common', {
  blockBase: '#f97316', blockBaseEdge: '#9a3412', blockTop: '#fbbf24', blockTopEdge: '#b45309',
  perfectColor: '#fde68a', ...pv('#1a0d04', '#f97316'),
});
add('stack', 'blocks', 'stack-blocks-prism', 'Prism Stack', 'epic', {
  blockBase: '#a855f7', blockBaseEdge: '#6b21a8', blockTop: '#22d3ee', blockTopEdge: '#0e7490',
  perfectColor: '#f0abfc', blockGlowEnabled: true, blockGlowColor: '#a855f7', ...pv('#150724', '#a855f7'),
});
add('stack', 'background', 'stack-background-twilight', 'Twilight', 'common', {
  screenTop: '#1e1b4b', screenBottom: '#020617', accent: '#818cf8', ...pv('#020617', '#1e1b4b'),
});
add('stack', 'effects', 'stack-effects-confetti', 'Confetti Slice', 'rare', {
  sliceColor: '#f472b6', perfectFlashColor: '#fde047', particleColor: '#22d3ee', ...pv('#16071a', '#f472b6'),
});
/* wave-d cluster-a additions (stack) */
add('stack', 'blocks', 'stack-blocks-oceanic', 'Oceanic Stack', 'common', {
  blockBase: '#0ea5e9', blockBaseEdge: '#075985', blockTop: '#22d3ee', blockTopEdge: '#0e7490', perfectColor: '#a5f3fc', ...pv('#03212b', '#0ea5e9'),
});
add('stack', 'blocks', 'stack-blocks-molten', 'Molten Stack', 'rare', {
  blockBase: '#ef4444', blockBaseEdge: '#7f1d1d', blockTop: '#f59e0b', blockTopEdge: '#92400e', perfectColor: '#fde68a', blockGlowEnabled: true, blockGlowColor: '#f97316', blockGlowSize: 24, ...pv('#1a0604', '#ef4444'),
});
add('stack', 'effects', 'stack-effects-golden', 'Golden Slice', 'rare', {
  sliceColor: '#fbbf24', perfectFlashColor: '#fef9c3', particleColor: '#f97316', ...pv('#1a1004', '#fbbf24'),
});

/* ──────────────────────────── SEQUENCE ────────────────────────────
   slots: pads, background */
add('sequence', 'pads', 'sequence-pads-classic', 'Classic Simon', 'common', {
  padColors: ['#22c55e', '#ef4444', '#fbbf24', '#3b82f6'], padActiveColor: '#ffffff', ...pv('#0a0f1a', '#22c55e'),
});
add('sequence', 'pads', 'sequence-pads-neon', 'Neon Pads', 'rare', {
  padColors: ['#22d3ee', '#f472b6', '#a3e635', '#a855f7'], padActiveColor: '#ffffff',
  padGlowEnabled: true, padGlowColor: '#ffffff', ...pv('#0a0f1a', '#22d3ee'),
});
add('sequence', 'background', 'sequence-background-noir', 'Noir Bezel', 'common', {
  bgTop: '#27272a', bgBottom: '#09090b', accent: '#f4f4f5', ...pv('#09090b', '#27272a'),
});
/* wave-d cluster-a additions (sequence) */
add('sequence', 'pads', 'sequence-pads-sunset', 'Sunset Pads', 'rare', {
  padColors: ['#f43f5e', '#f97316', '#fbbf24', '#a855f7'], padActiveColor: '#ffffff', padGlowEnabled: true, padGlowColor: '#fbbf24', ...pv('#1a0a04', '#f97316'),
});
add('sequence', 'pads', 'sequence-pads-ocean', 'Ocean Pads', 'common', {
  padColors: ['#0ea5e9', '#22d3ee', '#14b8a6', '#6366f1'], padActiveColor: '#f0f9ff', ...pv('#04121a', '#0ea5e9'),
});
add('sequence', 'background', 'sequence-background-walnut', 'Walnut Bezel', 'common', {
  bgTop: '#6b4a2e', bgBottom: '#3a2818', accent: '#f2a33c', ...pv('#1a1008', '#6b4a2e'),
});

/* ────────────────────────── REACTION-TIME ─────────────────────────
   slots: target, background */
add('reaction-time', 'target', 'reaction-target-classic', 'Stoplight', 'common', {
  waitColor: '#dc2626', goColor: '#22c55e', readyColor: '#22c55e', tooSoonColor: '#ea580c', ...pv('#0a0f1a', '#22c55e'),
});
add('reaction-time', 'target', 'reaction-target-pulse', 'Pulse Beacon', 'rare', {
  waitColor: '#7c3aed', goColor: '#22d3ee', readyColor: '#22d3ee', tooSoonColor: '#f43f5e',
  targetGlowEnabled: true, targetGlowColor: '#22d3ee', ...pv('#03212b', '#22d3ee'),
});
add('reaction-time', 'background', 'reaction-background-slate', 'Slate Panel', 'common', {
  bgColor: '#0f172a', panelBg: '#1e293b', badgeColor: '#38bdf8', accent: '#38bdf8', ...pv('#020617', '#1e293b'),
});
/* wave-d cluster-a additions (reaction-time) */
add('reaction-time', 'target', 'reaction-target-neon', 'Neon Reflex', 'rare', {
  waitColor: '#db2777', goColor: '#a3e635', tooSoonColor: '#f97316', targetGlowEnabled: true, targetGlowColor: '#a3e635', ...pv('#0c1a04', '#a3e635'),
});
add('reaction-time', 'target', 'reaction-target-molten', 'Molten Trigger', 'common', {
  waitColor: '#7f1d1d', goColor: '#f97316', tooSoonColor: '#fbbf24', ...pv('#1a0604', '#f97316'),
});
add('reaction-time', 'background', 'reaction-background-carbon', 'Carbon Panel', 'common', {
  panelBg: '#18181b', panelBorder: '#3f3f46', badgeColor: '#f472b6', accent: '#f472b6', ...pv('#09090b', '#3f3f46'),
});

/* ───────────────────────────── SUDOKU ─────────────────────────────
   slots: board, numbers, accent */
add('sudoku', 'board', 'sudoku-board-paper', 'Newsprint', 'common', {
  cellBg: '#faf7ef', givenCellBg: '#efe9d8', gridLineColor: '#cbb89a', boxBorderColor: '#5b4a2e',
  selectedCellColor: '#fde68a', ...pv('#2b2618', '#faf7ef'),
});
add('sudoku', 'board', 'sudoku-board-midnight', 'Midnight Grid', 'rare', {
  cellBg: '#0f172a', givenCellBg: '#1e293b', gridLineColor: '#334155', boxBorderColor: '#64748b',
  selectedCellColor: '#1d4ed8', ...pv('#020617', '#1e293b'),
});
add('sudoku', 'numbers', 'sudoku-numbers-ink', 'Inkwell', 'common', {
  givenDigitColor: '#1e293b', enteredDigitColor: '#2563eb', conflictColor: '#dc2626', fontFamily: 'serif', ...pv('#0a0f1a', '#2563eb'),
});
add('sudoku', 'accent', 'sudoku-accent-emerald', 'Emerald Focus', 'rare', {
  accentColor: '#10b981', peerHighlight: '#064e3b', selectedGlow: true, ...pv('#04140e', '#10b981'),
});
/* wave-d cluster-b additions (sudoku) */
add('sudoku', 'board', 'sudoku-board-blueprint', 'Blueprint', 'rare', {
  cellBg: '#0b1a3a', givenCellBg: '#12275a', gridLineColor: '#1e3a8a',
  boxBorderColor: '#93c5fd', selectedCellColor: '#38bdf8', ...pv('#020617', '#1e3a8a'),
});
add('sudoku', 'numbers', 'sudoku-numbers-neon', 'Neon Digits', 'rare', {
  givenDigitColor: '#e2e8f0', enteredDigitColor: '#22d3ee', conflictColor: '#f472b6',
  fontFamily: 'sans', ...pv('#03212b', '#22d3ee'),
});
add('sudoku', 'accent', 'sudoku-accent-rose', 'Rose Focus', 'common', {
  accentColor: '#fb7185', peerHighlight: '#3a0d18', selectedGlow: true, ...pv('#1a060c', '#fb7185'),
});

/* ─────────────────────────── PUNCH CARD ───────────────────────────
   slots: paper (grid papers), ink (marker inks), reveal (highlight + reveal) */
add('punch-card', 'paper', 'punch-card-paper-newsprint', 'Newsprint Card', 'common', {
  cellBg: '#faf3e2', boardBg: '#2b2214', gridLineColor: '#cbb89a', clueBg: '#efe3c6', clueColor: '#4a3922',
  ...pv('#2b2214', '#faf3e2'),
});
add('punch-card', 'paper', 'punch-card-paper-blueprint', 'Blueprint', 'rare', {
  cellBg: '#0e2a44', boardBg: '#061626', gridLineColor: '#1e4a6e', clueBg: '#123a5c', clueColor: '#a9d6f5',
  ...pv('#061626', '#0e2a44'),
});
add('punch-card', 'ink', 'punch-card-ink-charcoal', 'Charcoal Punch', 'common', {
  fillColor: '#2c2114', fillEdge: '#120c06', xColor: '#b0703f', ...pv('#120c06', '#2c2114'),
});
add('punch-card', 'ink', 'punch-card-ink-cherry', 'Cherry Ink', 'rare', {
  fillColor: '#b91c1c', fillEdge: '#5c0a0a', xColor: '#3f6212', ...pv('#1a0606', '#b91c1c'),
});
add('punch-card', 'reveal', 'punch-card-reveal-sunburst', 'Sunburst Reveal', 'epic', {
  accentColor: '#f59e0b', revealColor: '#f59e0b', solvedGlow: true, ...pv('#1a1204', '#f59e0b'),
});

/* ──────────────────────────── FREECELL SPRINT ─────────────────────────
   slots: felt (table felt + rails), cards (slot frames + foundation/free-cell
   tint + card-back medallion), cascade (auto-complete win burst) */
add('freecell', 'felt', 'freecell-felt-emerald', 'Emerald Parlor', 'common', {
  feltTop: '#14322b', feltBottom: '#0c211d', railColor: '#2c2013', ...pv('#0c211d', '#1d8579'),
});
add('freecell', 'felt', 'freecell-felt-crimson', 'Velvet Room', 'rare', {
  feltTop: '#3a1420', feltBottom: '#210a11', railColor: '#2a1710', ...pv('#210a11', '#b91c4a'),
});
add('freecell', 'felt', 'freecell-felt-midnight', 'Midnight Baize', 'epic', {
  feltTop: '#16233f', feltBottom: '#0a1122', railColor: '#1a2036', ...pv('#0a1122', '#3b6bd6'),
});
add('freecell', 'cards', 'freecell-cards-ruby', 'Ruby Backs', 'rare', {
  slotFrame: '#5a3e20', foundationTint: '#c0322f', freeCellTint: '#8a5a30', backTheme: 'fuchsia',
  ...pv('#1f1710', '#c0322f'),
});
add('freecell', 'cascade', 'freecell-cascade-gilded', 'Gilded Cascade', 'legendary', {
  burstColor: '#ffd76a', winGlow: true, ...pv('#1a1204', '#ffd76a'),
});

/* ────────────────────────────── MATH ──────────────────────────────
   slots: theme, accent */
add('math', 'theme', 'math-theme-chalkboard', 'Chalkboard', 'common', {
  panelBg: '#0f2419', panelBorder: '#1f4d36', problemTextColor: '#ecfdf5', ...pv('#06140d', '#1f4d36'),
});
add('math', 'theme', 'math-theme-cyber', 'Cyberdeck', 'rare', {
  panelBg: '#0b1120', panelBorder: '#1e3a8a', problemTextColor: '#bfdbfe', ...pv('#020617', '#1e3a8a'),
});
add('math', 'accent', 'math-accent-volt', 'Voltage Accent', 'rare', {
  correctColor: '#22c55e', wrongColor: '#ef4444', accentColor: '#22d3ee', timerColor: '#facc15',
  panelGlow: true, ...pv('#03212b', '#22d3ee'),
});
/* wave-d cluster-b additions (math) */
add('math', 'theme', 'math-theme-carnival', 'Carnival Booth', 'common', {
  panelBg: '#3a1206', panelBorder: '#f59e0b', problemTextColor: '#fff1cf', ...pv('#1a0d04', '#f59e0b'),
});
add('math', 'accent', 'math-accent-mint', 'Mint Sprint', 'rare', {
  correctColor: '#34d399', wrongColor: '#fb7185', accentColor: '#22d3ee', timerColor: '#a3e635',
  panelGlow: true, ...pv('#03212b', '#22d3ee'),
});

/* ─────────────────────────── CONNECT FOUR ─────────────────────────
   slots: discs, board, background */
add('connect-four', 'discs', 'connect-four-discs-classic', 'Classic Chips', 'common', {
  player1Color: '#ef4444', player1Edge: '#991b1b', player1Glint: '#fca5a5',
  player2Color: '#facc15', player2Edge: '#a16207', player2Glint: '#fef08a', ...pv('#0a0f1a', '#ef4444'),
});
add('connect-four', 'discs', 'connect-four-discs-neon', 'Neon Chips', 'epic', {
  player1Color: '#f472b6', player1Edge: '#be185d', player1Glint: '#fbcfe8',
  player2Color: '#22d3ee', player2Edge: '#0e7490', player2Glint: '#a5f3fc',
  discGlow: true, ...pv('#16071a', '#f472b6'),
});
add('connect-four', 'board', 'connect-four-board-ocean', 'Ocean Cabinet', 'rare', {
  boardColor: '#1d4ed8', boardColorDeep: '#1e3a8a', holeColor: '#0b1120', holeColorDeep: '#020617',
  frameTop: '#1e40af', frameBottom: '#172554', frameEdge: '#0f172a', ...pv('#020617', '#1d4ed8'),
});
add('connect-four', 'background', 'connect-four-background-arcade', 'Arcade Mat', 'common', {
  bgTop: '#1e1b4b', bgBottom: '#020617', accent: '#818cf8', ...pv('#020617', '#1e1b4b'),
});
/* wave-d cluster-b additions (connect-four) */
add('connect-four', 'discs', 'connect-four-discs-gold-rush', 'Gold Rush Chips', 'rare', {
  player1Color: '#059669', player1Edge: '#064e3b', player1Glint: '#6ee7b7',
  player2Color: '#fbbf24', player2Edge: '#a16207', player2Glint: '#fef08a',
  discGlow: true, ...pv('#04140e', '#fbbf24'),
});
add('connect-four', 'board', 'connect-four-board-cherry', 'Cherrywood Cabinet', 'rare', {
  boardColor: '#9f1239', boardColorDeep: '#6a0f2a', holeColor: '#3a0715', holeColorDeep: '#1f040c',
  frameTop: '#fde6d8', frameBottom: '#f2c9b8', frameEdge: '#2a0a12', ...pv('#1f040c', '#9f1239'),
});
add('connect-four', 'background', 'connect-four-background-galaxy', 'Galaxy Mat', 'common', {
  bgTop: '#1e1b4b', bgBottom: '#0b1120', accent: '#a855f7', ...pv('#0b1120', '#1e1b4b'),
});

/* ──────────────────────────── CHECKERS ────────────────────────────
   slots: pieces, board */
add('checkers', 'pieces', 'checkers-pieces-classic', 'Diner Discs', 'common', {
  lightPieceColor: '#f5f0e1', lightPieceEdge: '#bcae8a', lightPieceHi: '#ffffff',
  darkPieceColor: '#c0392b', darkPieceEdge: '#7b241c', darkPieceHi: '#e6796b',
  kingAccent: '#facc15', crownStroke: '#7b241c', ...pv('#1a0d0a', '#c0392b'),
});
add('checkers', 'pieces', 'checkers-pieces-royal', 'Royal Set', 'epic', {
  lightPieceColor: '#f8fafc', lightPieceEdge: '#94a3b8', lightPieceHi: '#ffffff',
  darkPieceColor: '#4c1d95', darkPieceEdge: '#2e1065', darkPieceHi: '#a78bfa',
  kingAccent: '#fbbf24', crownStroke: '#2e1065', kingShimmer: true, ...pv('#150724', '#7c3aed'),
});
add('checkers', 'board', 'checkers-board-walnut', 'Walnut Board', 'common', {
  lightSquareColor: '#e8d4a8', darkSquareColor: '#6b4423', boardBorder: '#3a2414',
  highlightColor: '#22c55e', lastMoveColor: '#fbbf24', ...pv('#1a1008', '#6b4423'),
});
/* wave-d cluster-b additions (checkers) */
add('checkers', 'pieces', 'checkers-pieces-obsidian-jade', 'Obsidian & Jade', 'epic', {
  lightPieceColor: '#d1fae5', lightPieceEdge: '#6ee7b7', lightPieceHi: '#f0fdf4',
  darkPieceColor: '#18181b', darkPieceEdge: '#000000', darkPieceHi: '#3f3f46',
  kingAccent: '#34d399', crownStroke: '#065f46', kingShimmer: true, ...pv('#04140e', '#18181b'),
});
add('checkers', 'board', 'checkers-board-slate-ice', 'Slate Ice', 'common', {
  lightSquareColor: '#cbd5e1', darkSquareColor: '#334155', boardBorder: '#0f172a',
  highlightColor: '#38bdf8', lastMoveColor: 'rgba(56, 189, 248, 0.40)', ...pv('#0a0f1a', '#334155'),
});

/* ────────────────────────── CONNECTIONS ───────────────────────────
   slots: tiles, accent */
add('connections', 'tiles', 'connections-tiles-bold', 'Bold Categories', 'rare', {
  tileBg: '#efefe6', tileText: '#121212', selectedTileBg: '#5a594e', selectedTileText: '#ffffff',
  groupColor1: '#f7da21', groupColor2: '#7dd87d', groupColor3: '#6aaae4', groupColor4: '#b886e0', ...pv('#1a1a16', '#f7da21'),
});
add('connections', 'accent', 'connections-accent-ruby', 'Ruby Lives', 'common', {
  accentColor: '#e11d48', mistakeColor: '#e11d48', ...pv('#1a060c', '#e11d48'),
});
/* wave-d cluster-b additions (connections) */
add('connections', 'tiles', 'connections-tiles-twilight', 'Twilight Tiles', 'rare', {
  tileBg: '#1e293b', tileText: '#e2e8f0', selectedTileBg: '#38bdf8', selectedTileText: '#04202b',
  groupColor1: '#fbbf24', groupColor2: '#34d399', groupColor3: '#60a5fa', groupColor4: '#f472b6',
  ...pv('#020617', '#38bdf8'),
});
add('connections', 'accent', 'connections-accent-gold', 'Gold Lives', 'common', {
  accentColor: '#facc15', mistakeColor: '#f97316', ...pv('#1a1004', '#facc15'),
});

/* ──────────────────────────── WORD GRID ───────────────────────────
   slots: tiles, keyboard, accent */
add('word-grid', 'tiles', 'word-grid-tiles-classic', 'Classic Grid', 'common', {
  correctColor: '#6aaa64', presentColor: '#c9b458', absentColor: '#787c7e',
  tileBorder: '#d3d6da', tileText: '#1a1a1b', ...pv('#0f0f10', '#6aaa64'),
});
add('word-grid', 'tiles', 'word-grid-tiles-dusk', 'High Contrast', 'rare', {
  correctColor: '#f5793a', presentColor: '#85c0f9', absentColor: '#3a3a3c',
  tileBorder: '#565758', tileText: '#ffffff', ...pv('#0a0f1a', '#f5793a'),
});
add('word-grid', 'keyboard', 'word-grid-keyboard-slate', 'Slate Keys', 'common', {
  keyBg: '#818384', keyText: '#ffffff', keyActive: '#565758', ...pv('#1a1a1b', '#818384'),
});
add('word-grid', 'accent', 'word-grid-accent-mint', 'Mint Accent', 'common', {
  accentColor: '#34d399', ...pv('#04140e', '#34d399'),
});
/* wave-d cluster-b additions (word-grid) */
add('word-grid', 'tiles', 'word-grid-tiles-neon', 'Neon Guess', 'rare', {
  correctColor: '#22c55e', presentColor: '#eab308', absentColor: '#27272a',
  tileBorder: '#3f3f46', tileText: '#fafafa', ...pv('#09090b', '#22c55e'),
});
add('word-grid', 'keyboard', 'word-grid-keyboard-carbon', 'Carbon Keys', 'common', {
  keyBg: '#3f3f46', keyText: '#fafafa', keyActive: '#22d3ee', ...pv('#18181b', '#3f3f46'),
});
add('word-grid', 'accent', 'word-grid-accent-coral', 'Coral Accent', 'common', {
  accentColor: '#fb7185', ...pv('#1a060c', '#fb7185'),
});

/* ───────────────────────────── PANGRAM ────────────────────────────
   slots: honeycomb, accent, background */
add('pangram', 'honeycomb', 'pangram-honeycomb-honey', 'Honeypot', 'common', {
  centerCellColor: '#f7da21', outerCellColor: '#efefe6', cellText: '#1a1a16', cellPressColor: '#e8c200', ...pv('#1a1a16', '#f7da21'),
});
add('pangram', 'honeycomb', 'pangram-honeycomb-hive', 'Royal Hive', 'epic', {
  centerCellColor: '#a855f7', outerCellColor: '#1e1b3a', cellText: '#f3e8ff', cellPressColor: '#7c3aed', ...pv('#150724', '#a855f7'),
});
add('pangram', 'accent', 'pangram-accent-amber', 'Amber Rank', 'common', {
  accentColor: '#f59e0b', rankColor: '#fbbf24', ...pv('#1a1004', '#f59e0b'),
});
add('pangram', 'background', 'pangram-background-night', 'Night Wells', 'rare', {
  bgTop: '#0f172a', bgBottom: '#020617', ...pv('#020617', '#0f172a'),
});
/* wave-d cluster-b additions (pangram) */
add('pangram', 'honeycomb', 'pangram-honeycomb-emerald', 'Emerald Comb', 'rare', {
  centerCellColor: '#34d399', outerCellColor: '#04211a', cellText: '#d1fae5',
  cellPressColor: '#10b981', ...pv('#04140e', '#34d399'),
});
add('pangram', 'accent', 'pangram-accent-rose', 'Rose Rank', 'common', {
  accentColor: '#fb7185', rankColor: '#f472b6', ...pv('#1a060c', '#fb7185'),
});
add('pangram', 'background', 'pangram-background-abyss', 'Abyss Wells', 'rare', {
  bgTop: '#0b1120', bgBottom: '#020617', ...pv('#020617', '#0b1120'),
});

/* ─────────────────────────────── KENO ─────────────────────────────
   slots: spots (picked/hit spots), balls (drawn balls), background (well).
   Keys match buildKenoTheme() in app/(games)/keno/_keno-theme.ts. */
add('keno', 'spots', 'keno-spots-classic', 'Cardinal Spots', 'common', {
  pickColor: '#c73538', pickHi: '#d34b4e', pickOn: '#ffefe4',
  hitColor: '#2fb8a6', hitHi: '#46cdbb', hitOn: '#04231e', ...pv('#0c1c1a', '#2fb8a6'),
});
add('keno', 'spots', 'keno-spots-royal', 'Royal Spots', 'epic', {
  pickColor: '#8a52c4', pickHi: '#a268d6', pickOn: '#f3e9ff',
  hitColor: '#22d3ee', hitHi: '#67e8f9', hitOn: '#04222b', ...pv('#150724', '#a268d6'),
});
add('keno', 'balls', 'keno-balls-gold', 'Gold Rush Balls', 'rare', {
  ballColor: '#e0a23a', ballHi: '#f4c057', ballOn: '#2a1b06', ...pv('#1a1004', '#f4c057'),
});
add('keno', 'balls', 'keno-balls-neon', 'Neon Balls', 'epic', {
  ballColor: '#ec4899', ballHi: '#f472b6', ballOn: '#2a0716', ...pv('#1a0611', '#ec4899'),
});
add('keno', 'background', 'keno-background-midnight', 'Midnight Parlor', 'rare', {
  wellColor: '#0b1120', accent: '#38bdf8', ...pv('#020617', '#0b3b4a'),
});
/* wave-d cluster-b additions (keno) */
add('keno', 'spots', 'keno-spots-emerald', 'Emerald Spots', 'rare', {
  pickColor: '#059669', pickHi: '#34d399', pickOn: '#04211a',
  hitColor: '#f59e0b', hitHi: '#fbbf24', hitOn: '#2a1b06', ...pv('#04140e', '#34d399'),
});
add('keno', 'balls', 'keno-balls-plasma', 'Plasma Balls', 'epic', {
  ballColor: '#a855f7', ballHi: '#c084fc', ballOn: '#f3e9ff', ...pv('#150724', '#a855f7'),
});
add('keno', 'background', 'keno-background-crimson', 'Crimson Parlor', 'common', {
  wellColor: '#1a060c', accent: '#f43f5e', ...pv('#1a060c', '#f43f5e'),
});

/* ────────────────────────── PRIZE WHEEL ───────────────────────────
   slots: segments (enamel bands loss..jackpot on each wedge), wheel (rim,
   hub cap, pointer/flapper, spoke dividers).
   Keys match buildPrizeWheelTheme() in
   app/(games)/prize-wheel/_prize-wheel-theme.ts:
     segments → <band>Face/<band>Edge/<band>On for band ∈
                loss, small, base, mid, big, huge, jackpot
     wheel    → rim, rimEdge, hub, hubEdge, hubOn, pointer, pointerEdge, spoke */
add('prize-wheel', 'segments', 'prize-wheel-segments-neon', 'Neon Midway', 'epic', {
  lossFace: '#1b1030', lossEdge: '#0c0718', lossOn: '#8a7fb5',
  smallFace: '#22d3ee', smallEdge: '#0a5566', smallOn: '#04222b',
  baseFace: '#34d399', baseEdge: '#0f5f45', baseOn: '#04231a',
  midFace: '#a855f7', midEdge: '#4a1d80', midOn: '#f3e9ff',
  bigFace: '#ec4899', bigEdge: '#6a1338', bigOn: '#ffe4f0',
  hugeFace: '#f59e0b', hugeEdge: '#7a4e16', hugeOn: '#2a1b06',
  jackpotFace: '#f43f5e', jackpotEdge: '#6a1020', jackpotOn: '#fff0f3',
  ...pv('#0c0718', '#a855f7'),
});
add('prize-wheel', 'segments', 'prize-wheel-segments-tropic', 'Tropic Reef', 'rare', {
  lossFace: '#0a2e2b', lossEdge: '#04201d', lossOn: '#79b8b0',
  smallFace: '#5eead4', smallEdge: '#0f6157', smallOn: '#042420',
  baseFace: '#38bdf8', baseEdge: '#0c4a6e', baseOn: '#04202b',
  midFace: '#818cf8', midEdge: '#2f3a8f', midOn: '#eef0ff',
  bigFace: '#c084fc', bigEdge: '#5a1e8a', bigOn: '#f6ecff',
  hugeFace: '#fbbf24', hugeEdge: '#7a4e16', hugeOn: '#2a1b06',
  jackpotFace: '#fb7185', jackpotEdge: '#6a1020', jackpotOn: '#fff0f3',
  ...pv('#04201d', '#38bdf8'),
});
add('prize-wheel', 'segments', 'prize-wheel-segments-candy', 'Candy Carnival', 'common', {
  lossFace: '#3a2233', lossEdge: '#1e0f1c', lossOn: '#d9b3cf',
  smallFace: '#fca5a5', smallEdge: '#7f1d1d', smallOn: '#2a0606',
  baseFace: '#fdba74', baseEdge: '#7c2d12', baseOn: '#2a1206',
  midFace: '#f472b6', midEdge: '#831843', midOn: '#2a0716',
  bigFace: '#a78bfa', bigEdge: '#4c1d95', bigOn: '#f3e9ff',
  hugeFace: '#facc15', hugeEdge: '#713f12', hugeOn: '#2a1b06',
  jackpotFace: '#f43f5e', jackpotEdge: '#6a1020', jackpotOn: '#fff0f3',
  ...pv('#1e0f1c', '#f472b6'),
});
add('prize-wheel', 'wheel', 'prize-wheel-wheel-gold', 'Gilded Cabinet', 'rare', {
  rim: '#3a2a10', rimEdge: '#140d03', hub: '#4a3512', hubEdge: '#140d03', hubOn: '#ffe9a8',
  pointer: '#ffd45e', pointerEdge: '#8a5a12', spoke: '#140d03',
  ...pv('#140d03', '#ffd45e'),
});
add('prize-wheel', 'wheel', 'prize-wheel-wheel-obsidian', 'Obsidian Cabinet', 'epic', {
  rim: '#12151b', rimEdge: '#04060a', hub: '#181c24', hubEdge: '#04060a', hubOn: '#cfe6ff',
  pointer: '#38bdf8', pointerEdge: '#0c4a6e', spoke: '#04060a',
  ...pv('#04060a', '#38bdf8'),
});
/* wave-d cluster-b additions (prize-wheel) */
add('prize-wheel', 'segments', 'prize-wheel-segments-ember', 'Ember Ladder', 'rare', {
  lossFace: '#292524', lossEdge: '#0c0a09', lossOn: '#a8a29e',
  smallFace: '#f59e0b', smallEdge: '#7a4e16', smallOn: '#2a1b06',
  baseFace: '#f97316', baseEdge: '#7c2d12', baseOn: '#2a1206',
  midFace: '#ef4444', midEdge: '#7f1d1d', midOn: '#fff0f0',
  bigFace: '#e11d48', bigEdge: '#6a1020', bigOn: '#fff0f3',
  hugeFace: '#c026d3', hugeEdge: '#5a1466', hugeOn: '#fbeafe',
  jackpotFace: '#facc15', jackpotEdge: '#713f12', jackpotOn: '#2a1b06',
  ...pv('#0c0a09', '#f59e0b'),
});
add('prize-wheel', 'wheel', 'prize-wheel-wheel-silver', 'Brushed Silver', 'epic', {
  rim: '#3f3f46', rimEdge: '#18181b', hub: '#52525b', hubEdge: '#18181b', hubOn: '#f4f4f5',
  pointer: '#e4e4e7', pointerEdge: '#71717a', spoke: '#18181b', ...pv('#18181b', '#e4e4e7'),
});

/* ────────────────────────────── BACCARAT ──────────────────────────
   slots: felt (table backdrop + rail), zones (Player/Banker/Tie enamels),
   accent (winning-zone glow + house card-back deck).
   Keys match buildBaccaratTheme() in app/(games)/baccarat/_baccarat-theme.ts. */
add('baccarat', 'felt', 'baccarat-felt-emerald', 'Monte Carlo Green', 'common', {
  feltTop: '#12513a', feltBottom: '#0a3325', rail: '#0a2419', ...pv('#0a2419', '#1f7a4d'),
});
add('baccarat', 'felt', 'baccarat-felt-midnight', 'Midnight Salon', 'rare', {
  feltTop: '#1a2440', feltBottom: '#0a1024', rail: '#060a18', ...pv('#060a18', '#3b4f8f'),
});
add('baccarat', 'felt', 'baccarat-felt-crimson', 'Crimson Parlor', 'epic', {
  feltTop: '#4a1220', feltBottom: '#2a0a12', rail: '#1a0509', ...pv('#1a0509', '#a3324a'),
});
add('baccarat', 'zones', 'baccarat-zones-classic', 'Classic Sabot', 'common', {
  playerColor: '#2563eb', playerHi: '#3b82f6', playerOn: '#f0f6ff',
  bankerColor: '#c73538', bankerHi: '#d34b4e', bankerOn: '#fff0ee',
  tieColor: '#16a34a', tieHi: '#22c55e', tieOn: '#04210f', ...pv('#0a2419', '#2563eb'),
});
add('baccarat', 'zones', 'baccarat-zones-royal', 'Royal Trio', 'epic', {
  playerColor: '#7c3aed', playerHi: '#a26bf0', playerOn: '#f3e9ff',
  bankerColor: '#e0a23a', bankerHi: '#f4c057', bankerOn: '#2a1b06',
  tieColor: '#22d3ee', tieHi: '#67e8f9', tieOn: '#04222b', ...pv('#150724', '#a26bf0'),
});
add('baccarat', 'accent', 'baccarat-accent-gold', 'Gilded Deck', 'rare', {
  accent: '#f4c057', backTheme: 'fuchsia', ...pv('#1a1004', '#f4c057'),
});

/* ────────────────────────────── GEM ROLL ──────────────────────────
   slots: gems (the 7 gem enamels, <color>Face/<color>Hi/<color>Edge for
   color ∈ ruby..rose), tray (trayBody/trayRim/socket/socketEdge), flare
   (flare/callout). Keys match buildGemRollTheme() in
   app/(games)/gem-roll/_gem-roll-theme.ts. */
add('gem-roll', 'gems', 'gem-roll-gems-neon', 'Neon Gemstones', 'epic', {
  rubyFace: '#f43f5e', rubyHi: '#fb7185', rubyEdge: '#6a1020',
  amberFace: '#fb923c', amberHi: '#fdba74', amberEdge: '#7c2d12',
  citrineFace: '#facc15', citrineHi: '#fde047', citrineEdge: '#713f12',
  emeraldFace: '#34d399', emeraldHi: '#6ee7b7', emeraldEdge: '#065f46',
  sapphireFace: '#38bdf8', sapphireHi: '#7dd3fc', sapphireEdge: '#0c4a6e',
  amethystFace: '#a855f7', amethystHi: '#c084fc', amethystEdge: '#4a1d80',
  roseFace: '#f472b6', roseHi: '#f9a8d4', roseEdge: '#831843',
  ...pv('#0c0718', '#a855f7'),
});
add('gem-roll', 'gems', 'gem-roll-gems-frost', 'Frostbite Gems', 'rare', {
  rubyFace: '#60a5fa', rubyHi: '#93c5fd', rubyEdge: '#1e3a8a',
  amberFace: '#22d3ee', amberHi: '#67e8f9', amberEdge: '#0e5566',
  citrineFace: '#a5f3fc', citrineHi: '#cffafe', citrineEdge: '#0e7490',
  emeraldFace: '#5eead4', emeraldHi: '#99f6e4', emeraldEdge: '#0f6157',
  sapphireFace: '#818cf8', sapphireHi: '#a5b4fc', sapphireEdge: '#2f3a8f',
  amethystFace: '#c4b5fd', amethystHi: '#ddd6fe', amethystEdge: '#5b21b6',
  roseFace: '#e0f2fe', roseHi: '#f0f9ff', roseEdge: '#7dd3fc',
  ...pv('#04121b', '#67e8f9'),
});
add('gem-roll', 'gems', 'gem-roll-gems-classic', 'Jeweller’s Case', 'common', {
  rubyFace: '#dc2626', rubyHi: '#f87171', rubyEdge: '#5a181b',
  amberFace: '#ea580c', amberHi: '#fb923c', amberEdge: '#7a3410',
  citrineFace: '#ca8a04', citrineHi: '#eab308', citrineEdge: '#6f4310',
  emeraldFace: '#16a34a', emeraldHi: '#4ade80', emeraldEdge: '#14532d',
  sapphireFace: '#2563eb', sapphireHi: '#60a5fa', sapphireEdge: '#1e3a8a',
  amethystFace: '#7c3aed', amethystHi: '#a78bfa', amethystEdge: '#4c1d95',
  roseFace: '#db2777', roseHi: '#f472b6', roseEdge: '#831843',
  ...pv('#1a0d12', '#dc2626'),
});
add('gem-roll', 'tray', 'gem-roll-tray-onyx', 'Onyx Setting', 'rare', {
  trayBody: '#14151b', trayRim: '#04060a', socket: '#0c0d12', socketEdge: '#04060a',
  ...pv('#04060a', '#3b4f8f'),
});
add('gem-roll', 'flare', 'gem-roll-flare-prism', 'Prism Flash', 'epic', {
  flare: '#22d3ee', callout: '#e0f7ff', ...pv('#03212b', '#22d3ee'),
});

/* ─────────────────────────── FORTUNE TELLER ───────────────────────
   slots: cloth (velvet backdrop + booth frame + trim), ball (crystal ball
   core/halo/rim/ink), cardback (face-down tarot card). Keys match
   buildFortuneTellerTheme() in app/(games)/fortune-teller/_fortune-teller-theme.ts. */
add('fortune-teller', 'cloth', 'fortune-teller-cloth-plum', 'Velvet Plum', 'common', {
  clothTop: '#2a1140', clothBottom: '#170a26', clothTrim: '#e0a23a', boothFrame: '#241a10',
  ...pv('#170a26', '#a855f7'),
});
add('fortune-teller', 'cloth', 'fortune-teller-cloth-emerald', 'Emerald Séance', 'rare', {
  clothTop: '#0d3b2e', clothBottom: '#06211a', clothTrim: '#f4c057', boothFrame: '#10251c',
  ...pv('#06211a', '#2fb8a6'),
});
add('fortune-teller', 'cloth', 'fortune-teller-cloth-obsidian', 'Obsidian Parlour', 'epic', {
  clothTop: '#191423', clothBottom: '#0a0710', clothTrim: '#38bdf8', boothFrame: '#0c0a12',
  ...pv('#0a0710', '#38bdf8'),
});
add('fortune-teller', 'ball', 'fortune-teller-ball-amethyst', 'Amethyst Orb', 'rare', {
  ballCore: '#c9a8e8', ballHalo: '#a855f7', ballRim: '#2a1d10', ballOn: '#1e0733',
  ...pv('#150724', '#c084fc'),
});
add('fortune-teller', 'cardback', 'fortune-teller-cardback-gilt', 'Gilded Arcana', 'epic', {
  backFace: '#3a2466', backEdge: '#0f0a05', backInk: '#ffd45e',
  ...pv('#140d03', '#ffd45e'),
});

/* ───────────────────────────── PROFILE ────────────────────────────
   slots: nameColor, frame, badge, title, background (NEW).
   These are the shop-purchasable profile cosmetics; the battlepass seeds its
   own exclusive profile items separately. */
// NOTE: profile flair reader expects color/emoji/text keys (see profile-flair.ts).
add('profile', 'nameColor', 'profile-namecolor-aqua', 'Aqua Name', 'common', { color: '#22d3ee', ...pv('#03212b', '#22d3ee') });
add('profile', 'nameColor', 'profile-namecolor-rose', 'Rose Name', 'common', { color: '#fb7185', ...pv('#1a060c', '#fb7185') });
add('profile', 'frame', 'profile-frame-amber', 'Amber Frame', 'rare', { color: '#f59e0b', ...pv('#1a1004', '#f59e0b') });
add('profile', 'frame', 'profile-frame-violet', 'Violet Frame', 'rare', { color: '#a855f7', ...pv('#150724', '#a855f7') });
add('profile', 'badge', 'profile-badge-star', 'Star Badge', 'common', { emoji: '⭐', imageUrl: '/cosmetics/badges/profile-badge-star.png', ...pv('#1a1407', '#facc15') });
add('profile', 'badge', 'profile-badge-fire', 'Fire Badge', 'rare', { emoji: '🔥', imageUrl: '/cosmetics/badges/profile-badge-fire.png', ...pv('#1a0d04', '#f97316') });
add('profile', 'badge', 'profile-badge-diamond', 'Diamond Badge', 'epic', { emoji: '💎', imageUrl: '/cosmetics/badges/profile-badge-diamond.png', ...pv('#03212b', '#22d3ee') });
add('profile', 'title', 'profile-title-rookie', 'Rookie', 'common', { text: 'Rookie', ...pv('#0a0f1a', '#818cf8') });
add('profile', 'title', 'profile-title-highroller', 'High Roller', 'epic', { text: 'High Roller', ...pv('#1a1004', '#fbbf24') });
add('profile', 'background', 'profile-background-nebula', 'Nebula', 'epic', {
  bgStyle: 'gradient', bgStart: '#4c1d95', bgEnd: '#0b1120', imageUrl: '/cosmetics/banners/profile-background-nebula.png', ...pv('#0b1120', '#4c1d95'),
});
add('profile', 'background', 'profile-background-sunset', 'Sunset Strip', 'rare', {
  bgStyle: 'gradient', bgStart: '#f97316', bgEnd: '#1e1b4b', imageUrl: '/cosmetics/banners/profile-background-sunset.png', ...pv('#1e1b4b', '#f97316'),
});
/* wave-d cluster-b additions (profile) */
// Titles (slot 'title', assetRef {text, ...pv()}) — arcade/carnival voice
add('profile', 'title', 'profile-title-carny', 'Carny', 'common', { text: 'Carny', ...pv('#1a1004', '#f59e0b') });
add('profile', 'title', 'profile-title-quarter-slayer', 'Quarter Slayer', 'common', { text: 'Quarter Slayer', ...pv('#0a0f1a', '#94a3b8') });
add('profile', 'title', 'profile-title-prize-hound', 'Prize Hound', 'common', { text: 'Prize Hound', ...pv('#04140e', '#34d399') });
add('profile', 'title', 'profile-title-claw-master', 'Claw Master', 'common', { text: 'Claw Master', ...pv('#0a0f1a', '#38bdf8') });
add('profile', 'title', 'profile-title-high-striker', 'High Striker', 'rare', { text: 'High Striker', ...pv('#1a0d04', '#f97316') });
add('profile', 'title', 'profile-title-ticket-tycoon', 'Ticket Tycoon', 'rare', { text: 'Ticket Tycoon', ...pv('#1a1004', '#fbbf24') });
add('profile', 'title', 'profile-title-boardwalk-baron', 'Boardwalk Baron', 'rare', { text: 'Boardwalk Baron', ...pv('#1a0f06', '#d8a657') });
add('profile', 'title', 'profile-title-pit-boss', 'Pit Boss', 'epic', { text: 'Pit Boss', ...pv('#1a060c', '#e11d48') });
add('profile', 'title', 'profile-title-token-baron', 'Token Baron', 'epic', { text: 'Token Baron', ...pv('#150724', '#a855f7') });
add('profile', 'title', 'profile-title-midway-maestro', 'Midway Maestro', 'epic', { text: 'Midway Maestro', ...pv('#03212b', '#22d3ee') });
add('profile', 'title', 'profile-title-jackpot-king', 'Jackpot King', 'legendary', { text: 'Jackpot King', ...pv('#1a1004', '#fbbf24') });
// Name colors (slot 'nameColor', assetRef {color, ...pv()})
add('profile', 'nameColor', 'profile-namecolor-emerald', 'Emerald Name', 'common', { color: '#34d399', ...pv('#04140e', '#34d399') });
add('profile', 'nameColor', 'profile-namecolor-gold', 'Gold Name', 'rare', { color: '#fbbf24', ...pv('#1a1004', '#fbbf24') });
add('profile', 'nameColor', 'profile-namecolor-violet', 'Violet Name', 'rare', { color: '#a855f7', ...pv('#150724', '#a855f7') });
// Frames (slot 'frame', assetRef {color, ...pv()})
add('profile', 'frame', 'profile-frame-teal', 'Teal Frame', 'common', { color: '#2dd4bf', ...pv('#04201d', '#2dd4bf') });
add('profile', 'frame', 'profile-frame-crimson', 'Crimson Frame', 'rare', { color: '#e11d48', ...pv('#1a060c', '#e11d48') });
add('profile', 'frame', 'profile-frame-gilded', 'Gilded Frame', 'epic', { color: '#fbbf24', ...pv('#1a1004', '#fbbf24') });
// wave-d: store2 banner batch (9 committed PNGs) → profile 'background' items.
// bgStart/bgEnd paint the store preview + namecards; note profile-flair uses
// the gradient only when imageUrl is ABSENT — a present-but-404 image renders
// blank, which is why add() refuses to seed image items whose PNG is missing.
add('profile', 'background', 'profile-background-store2-midway-dusk', 'Midway at Dusk', 'common', {
  bgStyle: 'image', bgStart: '#f97316', bgEnd: '#1e1b4b', imageUrl: '/cosmetics/banners/store2-midway-dusk.png', ...pv('#1e1b4b', '#f97316'),
});
add('profile', 'background', 'profile-background-store2-ticket-cascade', 'Ticket Cascade', 'common', {
  bgStyle: 'image', bgStart: '#fbbf24', bgEnd: '#7f1d1d', imageUrl: '/cosmetics/banners/store2-ticket-cascade.png', ...pv('#1a0604', '#fbbf24'),
});
add('profile', 'background', 'profile-background-store2-candy-jungle', 'Candy Jungle', 'common', {
  bgStyle: 'image', bgStart: '#f472b6', bgEnd: '#065f46', imageUrl: '/cosmetics/banners/store2-candy-jungle.png', ...pv('#04140e', '#f472b6'),
});
add('profile', 'background', 'profile-background-store2-neon-boardwalk', 'Neon Boardwalk', 'rare', {
  bgStyle: 'image', bgStart: '#22d3ee', bgEnd: '#150724', imageUrl: '/cosmetics/banners/store2-neon-boardwalk.png', ...pv('#150724', '#22d3ee'),
});
add('profile', 'background', 'profile-background-store2-retro-grid-sunset', 'Retro Grid Sunset', 'rare', {
  bgStyle: 'image', bgStart: '#f43f5e', bgEnd: '#4c1d95', imageUrl: '/cosmetics/banners/store2-retro-grid-sunset.png', ...pv('#1a060c', '#f43f5e'),
});
add('profile', 'background', 'profile-background-store2-deep-sea-arcade', 'Deep Sea Arcade', 'rare', {
  bgStyle: 'image', bgStart: '#38bdf8', bgEnd: '#020617', imageUrl: '/cosmetics/banners/store2-deep-sea-arcade.png', ...pv('#020617', '#38bdf8'),
});
add('profile', 'background', 'profile-background-store2-cosmic-pinball', 'Cosmic Pinball', 'epic', {
  bgStyle: 'image', bgStart: '#a855f7', bgEnd: '#0b1120', imageUrl: '/cosmetics/banners/store2-cosmic-pinball.png', ...pv('#0b1120', '#a855f7'),
});
add('profile', 'background', 'profile-background-store2-clockwork-workshop', 'Clockwork Workshop', 'epic', {
  bgStyle: 'image', bgStart: '#d8a657', bgEnd: '#1c1008', imageUrl: '/cosmetics/banners/store2-clockwork-workshop.png', ...pv('#1c1008', '#d8a657'),
});
add('profile', 'background', 'profile-background-store2-aurora-peaks', 'Aurora Peaks', 'legendary', {
  bgStyle: 'image', bgStart: '#34d399', bgEnd: '#041022', imageUrl: '/cosmetics/banners/store2-aurora-peaks.png', ...pv('#041022', '#34d399'),
});
// wave-d: store2 badge batch (7 committed PNGs) → profile 'badge' items.
// emoji is the fallback glyph; imageUrl is the generated PNG (preferred when present).
add('profile', 'badge', 'profile-badge-store2-joystick-crest', 'Joystick Crest', 'common', { emoji: '🕹️', imageUrl: '/cosmetics/badges/store2-joystick-crest.png', ...pv('#0a0f1a', '#38bdf8') });
add('profile', 'badge', 'profile-badge-store2-lucky-clover', 'Lucky Clover', 'common', { emoji: '🍀', imageUrl: '/cosmetics/badges/store2-lucky-clover.png', ...pv('#04140e', '#34d399') });
add('profile', 'badge', 'profile-badge-store2-lightning-coin', 'Lightning Coin', 'rare', { emoji: '⚡', imageUrl: '/cosmetics/badges/store2-lightning-coin.png', ...pv('#1a1004', '#fbbf24') });
add('profile', 'badge', 'profile-badge-store2-star-cluster', 'Star Cluster', 'rare', { emoji: '✨', imageUrl: '/cosmetics/badges/store2-star-cluster.png', ...pv('#150724', '#a855f7') });
add('profile', 'badge', 'profile-badge-store2-crystal-die', 'Crystal Die', 'rare', { emoji: '🎲', imageUrl: '/cosmetics/badges/store2-crystal-die.png', ...pv('#03212b', '#22d3ee') });
add('profile', 'badge', 'profile-badge-store2-pixel-skull', 'Pixel Skull', 'epic', { emoji: '💀', imageUrl: '/cosmetics/badges/store2-pixel-skull.png', ...pv('#0a0f1a', '#a3e635') });
add('profile', 'badge', 'profile-badge-store2-rocket-wing', 'Rocket Wing', 'epic', { emoji: '🚀', imageUrl: '/cosmetics/badges/store2-rocket-wing.png', ...pv('#1a060c', '#f43f5e') });

/* ─────────────────────────────── SNAKE ─────────────────────────────
   wave-d cluster-a — NEW section. Slots body/food/board (SNAKE_SLOTS);
   buildSnakeTheme consumes these keys. */
add('snake', 'body', 'snake-body-molten', 'Molten Serpent', 'epic', {
  bodyPrimary: '#f97316', bodySecondary: '#7c2d12', bodyGradient: 'combined', bodyPatternStyle: 'stripes', bodyPatternColor: '#fde68a', bodyPatternIntensity: 42, bodyGlowEnabled: true, bodyGlowColor: '#f97316', bodyGlowColorAlt: '#fbbf24', bodyGlowStyle: 'pulse', bodyGlowSpeed: 60, bodyGlowSize: 62, ...pv('#1a0a04', '#f97316'),
});
add('snake', 'body', 'snake-body-synthwave', 'Synthwave Viper', 'rare', {
  bodyPrimary: '#a855f7', bodySecondary: '#6b21a8', bodyGradient: 'linear', bodyPatternStyle: 'dots', bodyPatternColor: '#22d3ee', bodyPatternIntensity: 55, bodyGlowEnabled: true, bodyGlowColor: '#a855f7', bodyGlowColorAlt: '#22d3ee', bodyGlowStyle: 'pulse-dual', bodyGlowSpeed: 70, bodyGlowSize: 56, ...pv('#150724', '#a855f7'),
});
add('snake', 'food', 'snake-food-deepsea', 'Deep Sea Pearl', 'rare', {
  foodPrimary: '#38bdf8', foodHighlight: '#e0f2fe', foodStemColor: '#075985', foodLeafColor: '#22d3ee', foodShape: 'orb', foodSize: 112, foodPulse: 60, foodGlowEnabled: true, foodGlowColor: '#38bdf8', foodGlowSize: 72, ...pv('#04121a', '#38bdf8'),
});
add('snake', 'board', 'snake-board-midnight', 'Midnight Grid', 'common', {
  boardColorA: '#0b1120', boardColorB: '#0f172a', boardTileColorA2: '#111a2e', boardTileColorB2: '#0a0f1a', boardGlobalGradientEnabled: true, boardGlobalGradientStart: '#13203b', boardGlobalGradientEnd: '#05070d', boardGlobalGradientDirection: 'radial', boardGlobalGradientStrength: 60, boardGridLineColor: '#1e3a5f', boardGridLineWidth: 1, boardBorderColor: '#050a14', boardBorderWidth: 4, boardVignette: 80, ...pv('#05070d', '#0f172a'),
});

/* ────────────────────────── BUBBLE-SHOOTER ─────────────────────────
   wave-d cluster-a — NEW section. Slots bubbles/launcher/background
   (BUBBLE_SHOOTER_SLOTS); buildGumballTheme reads palette[]/color0..9,
   bgColor/fieldColor/wallColor/aimColor/deathLineColor. */
add('bubble-shooter', 'bubbles', 'bubble-shooter-bubbles-jawbreaker', 'Jawbreaker', 'rare', {
  palette: ['#ef4444', '#f97316', '#facc15', '#84cc16', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'], ...pv('#0a0f1e', '#f43f5e'),
});
add('bubble-shooter', 'bubbles', 'bubble-shooter-bubbles-frozen', 'Frozen Treats', 'common', {
  palette: ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#a5f3fc', '#67e8f9'], ...pv('#04121a', '#38bdf8'),
});
add('bubble-shooter', 'background', 'bubble-shooter-background-neon', 'Neon Jar', 'rare', {
  bgColor: '#0a0f1e', fieldColor: '#14142e', wallColor: '#a855f7', aimColor: '#22d3ee', deathLineColor: '#f43f5e', ...pv('#050716', '#a855f7'),
});

/* ─────────────────────────────── GEM-SWAP ──────────────────────────
   wave-d cluster-a — NEW section. Slots gems/board/background
   (GEM_SWAP_SLOTS); buildGemTheme reads palette[]/color0..5,
   boardColor/gridColor/cellColor/selectColor, bgColor. */
add('gem-swap', 'gems', 'gem-swap-gems-neon', 'Neon Jewels', 'rare', {
  palette: ['#f43f5e', '#22d3ee', '#facc15', '#4ade80', '#a855f7', '#f472b6'], ...pv('#03212b', '#22d3ee'),
});
add('gem-swap', 'gems', 'gem-swap-gems-pastel', 'Pastel Candy', 'common', {
  palette: ['#fca5a5', '#93c5fd', '#fde68a', '#86efac', '#c4b5fd', '#f9a8d4'], ...pv('#1a1420', '#f9a8d4'),
});
add('gem-swap', 'board', 'gem-swap-board-onyx', 'Onyx Board', 'rare', {
  boardColor: '#18181b', gridColor: '#3f3f46', cellColor: '#09090b', selectColor: '#a5f3fc', ...pv('#09090b', '#3f3f46'),
});

/* ────────────────────────────── SKY-CLIMBER ────────────────────────
   wave-d cluster-a — NEW section. Slots climber/platforms/background
   (SKY_CLIMBER_SLOTS); buildSkyTheme reads climberBody/Accent,
   normal/moving/breakable/spring/platformEdge/springColor,
   skyTop/skyBottom/hazeColor. */
add('sky-climber', 'climber', 'sky-climber-climber-neon', 'Neon Jumper', 'rare', {
  climberBody: '#22d3ee', climberAccent: '#0e2a33', ...pv('#03212b', '#22d3ee'),
});
add('sky-climber', 'platforms', 'sky-climber-platforms-candy', 'Candy Planks', 'rare', {
  normal: '#f472b6', moving: '#22d3ee', breakable: '#fbbf24', spring: '#a3e635', platformEdge: '#3a0a2a', springColor: '#ecfccb', ...pv('#1a0612', '#f472b6'),
});
add('sky-climber', 'background', 'sky-climber-background-aurora', 'Aurora Sky', 'legendary', {
  skyTop: '#041022', skyBottom: '#0f5132', hazeColor: '#34d399', ...pv('#041022', '#34d399'),
});

/* ─────────────────────────────── MINESWEEPER ───────────────────────
   wave-d cluster-b — NEW section. Slots board/numbers/accent, matching
   buildMinesweeperTheme AND the wave-d registry fix (rewards.ts). All four
   items equip end-to-end now that GAME_SLOTS.minesweeper = board/numbers/accent. */
add('minesweeper', 'accent', 'minesweeper-accent-cyan', 'Cyan Sweep', 'rare', {
  accentColor: '#22d3ee', hoverHighlight: '#0e2a3a', revealGlow: true, ...pv('#03212b', '#22d3ee'),
});
add('minesweeper', 'accent', 'minesweeper-accent-amber', 'Amber Sweep', 'common', {
  accentColor: '#f59e0b', hoverHighlight: '#3a2a10', revealGlow: false, ...pv('#1a1004', '#f59e0b'),
});
add('minesweeper', 'board', 'minesweeper-board-slate', 'Slate Field', 'rare', {
  coverBg: '#334155', revealedBg: '#0f172a', gridLineColor: '#0b1120',
  boxBorderColor: '#64748b', ...pv('#020617', '#1e293b'),
});
add('minesweeper', 'numbers', 'minesweeper-numbers-crimson', 'Crimson Digits', 'common', {
  revealedDigitColor: '#e2e8f0', mineColor: '#dc2626', flagColor: '#f59e0b',
  fontFamily: 'sans', ...pv('#1a060c', '#dc2626'),
});

/* ─────────────────────────────── TYPING TEST ───────────────────────
   wave-d cluster-b — NEW section. Registry TYPING_SLOTS =
   ['theme','caret','text-style','feedback'] — all match the reader. */
add('typing-test', 'caret', 'typing-test-caret-neon', 'Neon Caret', 'rare', {
  caretColor: '#22d3ee', caretType: 'block', caretThickness: 4,
  caretGlowStrength: 60, caretPulseMode: 'soft', caretTrailEnabled: true, ...pv('#03212b', '#22d3ee'),
});
add('typing-test', 'text-style', 'typing-test-text-serif-scholar', 'Serif Scholar', 'common', {
  textColor: '#a8a29e', correctColor: '#f5f5f4', errorColor: '#ef4444',
  textFontFamily: 'serif', textFontWeight: 600, textLetterSpacing: 0.5, textWordSpacing: 14,
  textCurrentWordStyle: 'box', textCurrentWordColor: '#f59e0b', textCurrentWordStrength: 55,
  ...pv('#1c1917', '#a8a29e'),
});
add('typing-test', 'theme', 'typing-test-theme-terminal', 'Terminal Green', 'rare', {
  panelBg: '#04140e', panelBorder: '#22c55e', hudFrameStyle: 'terminal',
  hudBadgeStyle: 'block', hudMeterStyle: 'pulse', hudAccentColor: '#22c55e',
  hudTextColor: '#bbf7d0', hudSurfaceColor: '#04140e', hudBorderColor: '#166534',
  hudShadowStrength: 40, ...pv('#04140e', '#22c55e'),
});
add('typing-test', 'feedback', 'typing-test-feedback-spark', 'Spark Feedback', 'epic', {
  missEffectColor: '#f472b6', feedbackStyle: 'particles', feedbackStrength: 70,
  feedbackDurationMs: 220, feedbackParticlesEnabled: true, ...pv('#16071a', '#f472b6'),
});

/* ─────────────────────────────── GUNRUSH (3D) ──────────────────────
   NEW section. Slots squad/arsenal/track (GUNRUSH_SLOTS); buildGunrushTheme
   reads squadPrimary/squadSecondary/squadGlow/squadGlowIntensity/muzzleColor,
   gunColor/gunAccent/tracerColor/gateGood/gateBad/gateWeapon, and
   trackColor/trackStripeColor/railColor/railTopColor/enemyColor/
   enemyEliteColor/skyColor/fogColor/groundColor/accent. Every key is optional —
   an omitted one keeps the default boardwalk look. */
add('gunrush', 'squad', 'gunrush-squad-crimson', 'Crimson Company', 'common', {
  squadPrimary: '#c73538', squadSecondary: '#f2e4c6', muzzleColor: '#ffd98a', ...pv('#1a0606', '#c73538'),
});
add('gunrush', 'squad', 'gunrush-squad-obsidian', 'Obsidian Guard', 'rare', {
  squadPrimary: '#4b5563', squadSecondary: '#e5e7eb', muzzleColor: '#fbbf24', ...pv('#0a0f1a', '#4b5563'),
});
add('gunrush', 'squad', 'gunrush-squad-voltage', 'Voltage Platoon', 'epic', {
  squadPrimary: '#22d3ee', squadSecondary: '#cffafe', squadGlow: '#22d3ee', squadGlowIntensity: 0.7,
  muzzleColor: '#a5f3fc', ...pv('#03212b', '#22d3ee'),
});
add('gunrush', 'arsenal', 'gunrush-arsenal-gunmetal', 'Gunmetal Standard', 'common', {
  gunColor: '#2b2f36', gunAccent: '#8c6a3a', tracerColor: '#ffe7a8',
  gateGood: '#35d0e8', gateBad: '#e0483f', gateWeapon: '#c07be8', ...pv('#0e1114', '#8c6a3a'),
});
add('gunrush', 'arsenal', 'gunrush-arsenal-plasma', 'Plasma Works', 'epic', {
  gunColor: '#1e1b4b', gunAccent: '#818cf8', tracerColor: '#a5b4fc',
  gateGood: '#34d399', gateBad: '#f43f5e', gateWeapon: '#a855f7', ...pv('#0b0a24', '#818cf8'),
});
add('gunrush', 'arsenal', 'gunrush-arsenal-gilded', 'Gilded Ordnance', 'legendary', {
  gunColor: '#3a2c0e', gunAccent: '#f2d98a', tracerColor: '#fde68a',
  gateGood: '#fbbf24', gateBad: '#b91c1c', gateWeapon: '#fef3c7', ...pv('#1a1407', '#f2d98a'),
});
add('gunrush', 'track', 'gunrush-track-midnight-pier', 'Midnight Pier', 'rare', {
  trackColor: '#33415a', trackStripeColor: '#3f5170', railColor: '#1e293b', railTopColor: '#64748b',
  enemyColor: '#2f8f7d', enemyEliteColor: '#c33a2b', skyColor: '#070c16', fogColor: '#0b1220',
  groundColor: '#111a2b', accent: '#93c5fd', ...pv('#070c16', '#64748b'),
});
add('gunrush', 'track', 'gunrush-track-neon-strip', 'Neon Strip', 'epic', {
  trackColor: '#2a0d3a', trackStripeColor: '#3d1454', railColor: '#170721', railTopColor: '#f472b6',
  enemyColor: '#22d3ee', enemyEliteColor: '#a855f7', skyColor: '#0b0316', fogColor: '#1a0630',
  groundColor: '#160424', accent: '#f472b6', ...pv('#0b0316', '#f472b6'),
});
add('gunrush', 'track', 'gunrush-track-frostline', 'Frostline', 'rare', {
  trackColor: '#4a6b7a', trackStripeColor: '#5a7e8f', railColor: '#253840', railTopColor: '#bae6fd',
  enemyColor: '#7dd3fc', enemyEliteColor: '#0ea5e9', skyColor: '#040a14', fogColor: '#0c1a2e',
  groundColor: '#0a1420', accent: '#e0f2fe', ...pv('#040a14', '#7dd3fc'),
});

const ADMIN_PROFILE_ITEMS: SeedItem[] = [
  {
    id: 'admin-name-celestial-circuit',
    name: 'Admin Celestial Name',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['nameColor'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      color: '#38e8ff',
      gradient: 'linear-gradient(90deg, #38e8ff, #fbbf24, #38e8ff)',
      glowColor: '#38e8ff',
      animated: true,
      adminOnly: true,
      ...pv('#031525', '#38e8ff'),
    },
  },
  {
    id: 'admin-badge-celestial-circuit',
    name: 'Admin Celestial Badge',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['badge'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      emoji: '✦',
      imageUrl: '/cosmetics/badges/admin-badge-celestial-circuit.png',
      adminOnly: true,
      ...pv('#031525', '#38e8ff'),
    },
  },
  {
    id: 'admin-bg-celestial-circuit',
    name: 'Admin Celestial Circuit',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['background'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      bgStyle: 'image',
      bgStart: '#031525',
      bgEnd: '#0b1120',
      imageUrl: '/cosmetics/banners/admin-bg-celestial-circuit.png',
      adminOnly: true,
      ...pv('#031525', '#38e8ff'),
    },
  },
  {
    id: 'admin-name-neon-emperor',
    name: 'Admin Neon Name',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['nameColor'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      color: '#ff3da8',
      gradient: 'linear-gradient(90deg, #ff3da8, #f59e0b, #ff3da8)',
      glowColor: '#ff3da8',
      animated: true,
      adminOnly: true,
      ...pv('#1a0611', '#ff3da8'),
    },
  },
  {
    id: 'admin-badge-neon-emperor',
    name: 'Admin Neon Badge',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['badge'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      emoji: '◆',
      imageUrl: '/cosmetics/badges/admin-badge-neon-emperor.png',
      adminOnly: true,
      ...pv('#1a0611', '#ff3da8'),
    },
  },
  {
    id: 'admin-bg-neon-emperor',
    name: 'Admin Neon Emperor',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['background'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      bgStyle: 'image',
      bgStart: '#1a0611',
      bgEnd: '#12070a',
      imageUrl: '/cosmetics/banners/admin-bg-neon-emperor.png',
      adminOnly: true,
      ...pv('#1a0611', '#ff3da8'),
    },
  },
  {
    id: 'admin-name-void-aurora',
    name: 'Admin Void Name',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['nameColor'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      color: '#34f5c5',
      gradient: 'linear-gradient(90deg, #34f5c5, #a855f7, #34f5c5)',
      glowColor: '#34f5c5',
      animated: true,
      adminOnly: true,
      ...pv('#031812', '#34f5c5'),
    },
  },
  {
    id: 'admin-badge-void-aurora',
    name: 'Admin Void Badge',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['badge'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      emoji: '◈',
      imageUrl: '/cosmetics/badges/admin-badge-void-aurora.png',
      adminOnly: true,
      ...pv('#031812', '#34f5c5'),
    },
  },
  {
    id: 'admin-bg-void-aurora',
    name: 'Admin Void Aurora',
    gameType: 'profile',
    rarity: 'legendary',
    slots: ['background'],
    active: false,
    seasonTag: 'admin',
    assetRef: {
      bgStyle: 'image',
      bgStart: '#031812',
      bgEnd: '#140b22',
      imageUrl: '/cosmetics/banners/admin-bg-void-aurora.png',
      adminOnly: true,
      ...pv('#031812', '#34f5c5'),
    },
  },
];

items.push(...ADMIN_PROFILE_ITEMS);

/* ───────────────────────── PROFILE AVATARS ─────────────────────────
   Purchasable avatar portraits. Equipping one sets the account image_url
   (see equipStoreItemForUser). Only seed avatars whose generated PNG exists
   on disk so a half-generated batch never ships a broken store card — re-run
   this seed after generating the rest and the new ones light up. */
for (const avatar of STORE_AVATARS) {
  const assetPath = path.join(process.cwd(), 'public', avatar.src.replace(/^\//, ''));
  if (!fs.existsSync(assetPath)) {
    console.warn(`[seed-cosmetics] skipping avatar ${avatar.id} — missing ${avatar.src}`);
    continue;
  }
  add('profile', 'avatar', avatar.id, avatar.name, avatar.rarity, {
    imageUrl: avatar.src,
    ...pv('#0b1120', '#1e293b'),
  });
}

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
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

/** Idempotent: UPSERTs the full curated catalog. Safe to re-run on every deploy. */
export async function seedCosmetics() {
  const now = Date.now();
  // Guard against a stray bad hex slipping into a card.
  for (const it of items) {
    for (const [k, v] of Object.entries(it.assetRef)) {
      if (typeof v === 'string' && v.startsWith('#') && !/^#[0-9a-fA-F]{3,8}$/.test(v)) {
        throw new Error(`Bad hex for ${it.id}.${k}: ${v}`);
      }
    }
  }
  await withTransaction(async (client) => {
    for (const it of items) {
      await client.query(UPSERT_SQL, [
        it.id,
        it.name,
        it.gameType,
        it.rarity,
        'credits',
        PRICE_BY_RARITY[it.rarity],
        JSON.stringify(it.slots),
        (it.active ?? true) && LEGACY_SEEDS_ON_SALE,
        it.seasonTag ?? null,
        JSON.stringify(it.assetRef),
        now,
      ]);
    }
    for (const it of ADMIN_PROFILE_ITEMS) {
      await client.query(
        `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
         SELECT user_id, $1, $2, 'admin_grant'
         FROM arcade_account_roles
         WHERE role = 'admin'
         ON CONFLICT(user_id, item_id) DO NOTHING`,
        [it.id, now],
      );
    }
  });
  const byGame = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.gameType] = (acc[it.gameType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[seed-cosmetics] upserted ${items.length} items`);
  console.table(byGame);
  return items.length;
}

// Run standalone: `npx tsx scripts/seed-cosmetics.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedCosmetics()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-cosmetics] failed:', err);
      process.exit(1);
    });
}
