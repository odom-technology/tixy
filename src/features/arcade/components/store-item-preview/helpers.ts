import { getGameTitle } from '@/features/arcade/lib/game-renames';
import type { RewardGameType } from '@/features/arcade/lib/rewards';

export type PreviewItem = {
  id?: string;
  name: string;
  gameType: RewardGameType;
  slots: string[];
  assetRef: Record<string, unknown> | null;
  setLabels?: string[];
  /* Optional — lets animated store surfaces key sheen/glow off the tier
     without widening every call site (plain previews ignore it). */
  rarity?: string;
};

export type BodyGradientMode = 'flat' | 'linear' | 'radial' | 'combined';
export type BodyGlowStyle = 'none' | 'steady' | 'pulse' | 'pulse-dual';

export const BODY_GRADIENT_MODES: readonly string[] = [
  'flat',
  'linear',
  'radial',
  'combined',
];
export const BODY_GLOW_STYLES: readonly string[] = ['none', 'steady', 'pulse', 'pulse-dual'];

const IMAGE_KEYS = [
  'boardImageUrl',
  'image',
  'imageUrl',
  'preview',
  'previewUrl',
  'thumbnail',
  'thumbnailUrl',
  'url',
  'src',
];

const FALLBACK_GRADIENTS: Record<RewardGameType, string[]> = {
  snake: ['#0f172a', '#16a34a', '#22c55e'],
  'flappy-bird': ['#1e293b', '#0ea5e9', '#38bdf8'],
  'typing-test': ['#0f172a', '#6366f1', '#22d3ee'],
  'reaction-time': ['#0f172a', '#f97316', '#facc15'],
  '8-ball': ['#0f172a', '#1a6b37', '#22c55e'],
  tetris: ['#0f172a', '#14b8a6', '#2dd4bf'],
  'coin-flip': ['#0f172a', '#f59e0b', '#0ea5e9'],
  connections: ['#0f172a', '#f8d74e', '#c97ed6'],
  '2048': ['#0f172a', '#818cf8', '#eab308'],
  chess: ['#0f172a', '#6b7280', '#f5deb3'],
  'word-grid': ['#0f172a', '#2f8f7d', '#22c55e'],
  pangram: ['#0f172a', '#e3a52e', '#2f8f7d'],
  stack: ['#0f172a', '#e3a52e', '#2f8f7d'],
  sequence: ['#0f172a', '#c33a2b', '#2f8f7d'],
  breakout: ['#0f172a', '#c33a2b', '#e3a52e'],
  tumbler: ['#0f172a', '#e3a52e', '#c33a2b'],
  'high-striker': ['#160d05', '#c33a2b', '#e3a52e'],
  'skee-ball': ['#160d05', '#2bb2a0', '#e3a52e'],
  gunrush: ['#140f0a', '#35d0e8', '#e0483f'],
  gopher: ['#0f172a', '#2f8f7d', '#e3a52e'],
  ricochet: ['#0f172a', '#818cf8', '#2f8f7d'],
  swerve: ['#0f172a', '#c33a2b', '#818cf8'],
  sudoku: ['#0f172a', '#2f8f7d', '#818cf8'],
  math: ['#0f172a', '#818cf8', '#e3a52e'],
  'connect-four': ['#0f172a', '#c33a2b', '#e3a52e'],
  checkers: ['#0f172a', '#2f8f7d', '#c33a2b'],
  reversi: ['#0f172a', '#2f8f7d', '#e3a52e'],
  battleship: ['#0f172a', '#0ea5e9', '#1a6b37'],
  'bubble-shooter': ['#0f172a', '#c97ed6', '#22d3ee'],
  'gem-swap': ['#0f172a', '#818cf8', '#c97ed6'],
  'sky-climber': ['#0f172a', '#38bdf8', '#facc15'],
  minesweeper: ['#0f172a', '#6b7280', '#c33a2b'],
  keno: ['#0f172a', '#c73538', '#2fb8a6'],
  'prize-wheel': ['#241a10', '#f2c14e', '#c73538'],
  baccarat: ['#0a2419', '#1f7a4d', '#e3a52e'],
  'gem-roll': ['#171009', '#c73538', '#3a86c4'],
  'fortune-teller': ['#170a26', '#a855f7', '#e0a23a'],
  'lucky-cage': ['#20130a', '#bf9648', '#a8342c'],
  'ring-toss': ['#2a211b', '#3f7f62', '#b83627'],
  'mini-golf': ['#2f7d57', '#e8dcc4', '#b83627'],
  'bumper-cars': ['#4a443d', '#b83627', '#f2a33c'],
  derby: ['#9a713f', '#2a231d', '#b83627'],
  'log-splitter': ['#0f172a', '#7c5a3a', '#4fae52'],
  'knife-booth': ['#0f172a', '#c0c7d0', '#c33a2b'],
  'melon-chop': ['#123028', '#d63b56', '#8ec63f'],
  'tin-duck': ['#123c2e', '#f2c14e', '#e86a3a'],
  'boardwalk-hop': ['#1f5763', '#f2c14e', '#c79a5e'],
  'punch-card': ['#1c160d', '#c8791f', '#2fb8a6'],
  freecell: ['#0c211d', '#1d8579', '#f2a33c'],
  profile: ['#0f172a', '#f59e0b', '#22c55e'],
};

const isColorValue = (value: string) =>
  /^#([0-9a-f]{3,8})$/i.test(value) ||
  /^rgb(a)?\(/i.test(value) ||
  /^hsl(a)?\(/i.test(value);

/**
 * Prefer WebP siblings for `/cosmetics/**.png` masters. Sources ship both
 * formats; WebP is ~3–5× smaller for the same visual at store/profile sizes.
 * Falls back to the original path when not a cosmetics PNG.
 */
export function preferCosmeticsWebp(url: string): string {
  if (!url.startsWith('/cosmetics/')) return url;
  if (url.endsWith('.png') || url.endsWith('.PNG')) {
    return `${url.slice(0, -4)}.webp`;
  }
  return url;
}

export const getAssetImageUrl = (assetRef: Record<string, unknown> | null) => {
  if (!assetRef) return null;
  for (const key of IMAGE_KEYS) {
    const value = assetRef[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    ) {
      return preferCosmeticsWebp(trimmed);
    }
  }
  return null;
};

export const getAssetColors = (
  gameType: RewardGameType,
  assetRef: Record<string, unknown> | null,
) => {
  const customStart = assetRef?.previewBgStart;
  const customEnd = assetRef?.previewBgEnd;
  const customEnabled = assetRef?.previewBgEnabled;
  if (
    customEnabled === true &&
    typeof customStart === 'string' &&
    isColorValue(customStart.trim())
  ) {
    if (typeof customEnd === 'string' && isColorValue(customEnd.trim())) {
      return [customStart.trim(), customEnd.trim()];
    }
    return [customStart.trim(), customStart.trim()];
  }
  const colors: string[] = [];
  if (assetRef) {
    for (const value of Object.values(assetRef)) {
      if (typeof value === 'string' && isColorValue(value.trim())) {
        colors.push(value.trim());
      }
      if (colors.length >= 4) break;
    }
  }
  return colors.length > 0 ? colors : (FALLBACK_GRADIENTS[gameType] ?? ['#0f172a']);
};

export const readStr = (
  ar: Record<string, unknown> | null,
  key: string,
  fb: string,
) => {
  const v = ar?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
};

export const readNum = (
  ar: Record<string, unknown> | null,
  key: string,
  fb: number,
  min: number,
  max: number,
) => {
  const v = ar?.[key];
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return fb;
  return Math.max(min, Math.min(max, n));
};

export const readBool = (
  ar: Record<string, unknown> | null,
  key: string,
  fb = false,
) => {
  const v = ar?.[key];
  return typeof v === 'boolean' ? v : fb;
};

// --- Color math ---
const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const e =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const v = Number.parseInt(e, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export const lerpHex = (a: string, b: string, t: number) => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};

export const formatGameLabel = (gameType: RewardGameType) => {
  switch (gameType) {
    case 'snake':
      return 'Snake';
    case 'flappy-bird':
      return getGameTitle('flappy-bird', 'Flappy Bird');
    case 'typing-test':
      return 'Typing';
    case 'reaction-time':
      return 'Reaction';
    case '8-ball':
      return '8-Ball';
    case 'tetris':
      return getGameTitle('tetris', 'Tetris');
    default:
      return gameType;
  }
};

export const getTypingFontFamilyCss = (family: unknown) => {
  if (family === 'sans') return 'ui-sans-serif, system-ui, sans-serif';
  if (family === 'serif') return 'ui-serif, Georgia, Cambria, serif';
  return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
};

export const readEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : fallback;
};
