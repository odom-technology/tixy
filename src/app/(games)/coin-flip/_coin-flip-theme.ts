// ---------------------------------------------------------------------------
// Coin-flip cosmetic theme — built from the user's equipped inventory items.
// ---------------------------------------------------------------------------

export type CoinFlipTheme = {
  // Coin
  headsPrimary: string;
  headsSecondary: string;
  headsText: string;
  tailsPrimary: string;
  tailsSecondary: string;
  tailsText: string;
  border: string;
  glow: boolean;
  glowColor: string;
  glowSize: number;
  rainbow: boolean;
  metallic: boolean;

  // Trail
  trailEnabled: boolean;
  trailParticleType: string;
  trailColor: string;
  trailSecondaryColor: string;
  trailCount: number;
  trailSpread: number;
  trailRainbow: boolean;

  // Background
  bgGradientStart: string;
  bgGradientEnd: string;
  bgAccentColor: string;
  bgStars: boolean;
  bgParticles: boolean;
  bgParticleColor: string;
  bgMetallic: boolean;
};

export const DEFAULT_COIN_FLIP_THEME: CoinFlipTheme = {
  // Midway default — heads is a lacquered amber/gold enamel token, tails a
  // prize-teal enamel token. Flat enamel paints; the glossy bevel + bottom
  // shade are layered in the client (box-shadow), and Midway never glows.
  headsPrimary: '#f7d35e',
  headsSecondary: '#c47c1f',
  headsText: '#2a1b06',
  tailsPrimary: '#46cdbb',
  tailsSecondary: '#1d8579',
  tailsText: '#07211d',
  border: '#9a621a',
  glow: false,
  glowColor: '#f2a33c',
  glowSize: 0,
  rainbow: false,
  metallic: false,

  trailEnabled: false,
  trailParticleType: 'sparkle',
  trailColor: '#fbbf24',
  trailSecondaryColor: '#f97316',
  trailCount: 8,
  trailSpread: 15,
  trailRainbow: false,

  bgGradientStart: '',
  bgGradientEnd: '',
  bgAccentColor: '',
  bgStars: false,
  bgParticles: false,
  bgParticleColor: '',
  bgMetallic: false,
};

function str(
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string {
  const v = ref?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

function num(
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = ref?.[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function bool(
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const v = ref?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

type EquippedEntry = {
  slot: string;
  item: { assetRef: Record<string, unknown> | null };
};

export function buildCoinFlipTheme(equipped: EquippedEntry[]): CoinFlipTheme {
  const theme = { ...DEFAULT_COIN_FLIP_THEME };

  for (const entry of equipped) {
    const slot = entry?.slot;
    const ref = entry?.item?.assetRef ?? null;
    if (!slot || !ref) continue;

    if (slot === 'coin') {
      theme.headsPrimary = str(ref, 'headsPrimary', theme.headsPrimary);
      theme.headsSecondary = str(ref, 'headsSecondary', theme.headsSecondary);
      theme.headsText = str(ref, 'headsText', theme.headsText);
      theme.tailsPrimary = str(ref, 'tailsPrimary', theme.tailsPrimary);
      theme.tailsSecondary = str(ref, 'tailsSecondary', theme.tailsSecondary);
      theme.tailsText = str(ref, 'tailsText', theme.tailsText);
      theme.border = str(ref, 'border', theme.border);
      theme.glow = bool(ref, 'glow', theme.glow);
      theme.glowColor = str(ref, 'glowColor', theme.glowColor);
      theme.glowSize = num(ref, 'glowSize', theme.glowSize, 0, 60);
      theme.rainbow = bool(ref, 'rainbow', theme.rainbow);
      theme.metallic = bool(ref, 'metallic', theme.metallic);
    } else if (slot === 'trail') {
      theme.trailEnabled = true;
      theme.trailParticleType = str(ref, 'particleType', theme.trailParticleType);
      theme.trailColor = str(ref, 'color', theme.trailColor);
      theme.trailSecondaryColor = str(ref, 'secondaryColor', theme.trailSecondaryColor);
      theme.trailCount = num(ref, 'count', theme.trailCount, 4, 30);
      theme.trailSpread = num(ref, 'spread', theme.trailSpread, 5, 40);
      theme.trailRainbow = bool(ref, 'rainbow', theme.trailRainbow);
    } else if (slot === 'background') {
      theme.bgGradientStart = str(ref, 'bgGradientStart', theme.bgGradientStart);
      theme.bgGradientEnd = str(ref, 'bgGradientEnd', theme.bgGradientEnd);
      theme.bgAccentColor = str(ref, 'accentColor', theme.bgAccentColor);
      theme.bgStars = bool(ref, 'stars', theme.bgStars);
      theme.bgParticles = bool(ref, 'particles', theme.bgParticles);
      theme.bgParticleColor = str(ref, 'particleColor', theme.bgParticleColor);
      theme.bgMetallic = bool(ref, 'metallic', theme.bgMetallic);
    }
  }

  return theme;
}
