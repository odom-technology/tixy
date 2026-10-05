import type React from 'react';

export const PLAYERCARD_ANIMATIONS = [
  'none',
  'shimmer',
  'gradient-shift',
  'glow-pulse',
  'aurora',
  'fire-edge',
  'holographic',
] as const;

export type PlayercardAnimation = (typeof PLAYERCARD_ANIMATIONS)[number];

export type PlayercardTheme = {
  cardBg: string;
  cardAnimation: PlayercardAnimation;
  cardBorder: string;
  nameColor: string;
  eloColor: string;
  animationPrimaryColor: string;
  animationSecondaryColor: string;
};

export const DEFAULT_PLAYERCARD_THEME: PlayercardTheme = {
  cardBg: 'linear-gradient(135deg, rgba(30,30,40,0.95), rgba(20,20,30,0.95))',
  cardAnimation: 'none',
  cardBorder: 'rgba(255,255,255,0.1)',
  nameColor: '#ffffff',
  eloColor: '#9ca3af',
  animationPrimaryColor: '#7dd3fc',
  animationSecondaryColor: '#f59e0b',
};

/**
 * Bot-tier playercard themes shared across tixy games that render
 * opponent playercards (8-ball, chess). Keyed by difficulty name so any
 * game with `bot:easy|medium|hard` user ids can look up a themed card.
 */
export const BOT_PLAYERCARD_THEMES: Record<string, PlayercardTheme> = {
  easy: {
    cardBg: 'linear-gradient(135deg, #0f3d1a 0%, #1a5c2e 50%, #0d2e14 100%)',
    cardAnimation: 'none',
    cardBorder: '#22c55e40',
    nameColor: '#86efac',
    eloColor: '#4ade80',
    animationPrimaryColor: '#4ade80',
    animationSecondaryColor: '#22d3ee',
  },
  medium: {
    cardBg: 'linear-gradient(135deg, #3d2800 0%, #5c3d0a 50%, #2e1f00 100%)',
    cardAnimation: 'glow-pulse',
    cardBorder: '#eab30840',
    nameColor: '#fde68a',
    eloColor: '#f59e0b',
    animationPrimaryColor: '#fbbf24',
    animationSecondaryColor: '#f97316',
  },
  hard: {
    cardBg: 'linear-gradient(135deg, #3d0011 0%, #6b0020 30%, #1a0008 100%)',
    cardAnimation: 'fire-edge',
    cardBorder: '#ef444460',
    nameColor: '#fca5a5',
    eloColor: '#ef4444',
    animationPrimaryColor: '#fb7185',
    animationSecondaryColor: '#f97316',
  },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const parseRgbChannels = (color: string): [number, number, number] | null => {
  const trimmed = color.trim();

  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split('');
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ];
  }

  const shortHexAlpha = trimmed.match(/^#([0-9a-fA-F]{4})$/);
  if (shortHexAlpha) {
    const [r, g, b] = shortHexAlpha[1].split('');
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ];
  }

  const longHex = trimmed.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (longHex) {
    return [
      Number.parseInt(longHex[1].slice(0, 2), 16),
      Number.parseInt(longHex[1].slice(2, 4), 16),
      Number.parseInt(longHex[1].slice(4, 6), 16),
    ];
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;

  const parts = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
    return null;
  }

  return [
    clamp(Math.round(parts[0] ?? 0), 0, 255),
    clamp(Math.round(parts[1] ?? 0), 0, 255),
    clamp(Math.round(parts[2] ?? 0), 0, 255),
  ];
};

const toRgba = (color: string, alpha: number, fallbackColor: string): string => {
  const parsed = parseRgbChannels(color) ?? parseRgbChannels(fallbackColor) ?? [255, 255, 255];
  const normalizedAlpha = clamp(alpha, 0, 1);
  const alphaText = normalizedAlpha.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alphaText})`;
};

export const isPlayercardAnimation = (value: unknown): value is PlayercardAnimation =>
  typeof value === 'string'
  && PLAYERCARD_ANIMATIONS.includes(value as PlayercardAnimation);

export const getPlayercardAnimationStylesheet = (prefix = 'pc'): string => `
@keyframes ${prefix}-shimmer {
  0% {
    background-position: -200% center;
    box-shadow: 0 0 6px 0 var(--pc-anim-primary-soft);
  }
  50% {
    box-shadow: 0 0 14px 2px var(--pc-anim-secondary-soft);
  }
  100% {
    background-position: 200% center;
    box-shadow: 0 0 6px 0 var(--pc-anim-primary-soft);
  }
}
@keyframes ${prefix}-gradient-shift {
  0% {
    filter: hue-rotate(0deg);
    box-shadow: 0 0 8px 0 var(--pc-anim-primary-soft);
  }
  50% {
    box-shadow: 0 0 14px 2px var(--pc-anim-secondary-soft);
  }
  100% {
    filter: hue-rotate(360deg);
    box-shadow: 0 0 8px 0 var(--pc-anim-primary-soft);
  }
}
@keyframes ${prefix}-glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px 0 var(--pc-anim-primary-soft);
  }
  50% {
    box-shadow:
      0 0 20px 4px var(--pc-anim-primary-strong),
      0 0 28px 8px var(--pc-anim-secondary-soft);
  }
}
@keyframes ${prefix}-aurora {
  0% {
    background-position: 0% 50%;
    box-shadow: 0 0 8px 0 var(--pc-anim-primary-soft);
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 0 14px 2px var(--pc-anim-secondary-soft);
  }
  100% {
    background-position: 0% 50%;
    box-shadow: 0 0 8px 0 var(--pc-anim-primary-soft);
  }
}
@keyframes ${prefix}-fire-edge {
  0%, 100% {
    box-shadow:
      inset 0 0 12px 2px var(--pc-anim-primary-medium),
      0 0 8px 1px var(--pc-anim-secondary-soft);
  }
  50% {
    box-shadow:
      inset 0 0 20px 4px var(--pc-anim-primary-strong),
      0 0 14px 3px var(--pc-anim-secondary-medium);
  }
}
@keyframes ${prefix}-holo {
  0% {
    background-position: 0% 50%;
    filter: hue-rotate(0deg) saturate(1.5);
    box-shadow: 0 0 10px 0 var(--pc-anim-primary-soft);
  }
  50% {
    background-position: 100% 50%;
    filter: hue-rotate(60deg) saturate(2);
    box-shadow: 0 0 14px 3px var(--pc-anim-secondary-soft);
  }
  100% {
    background-position: 0% 50%;
    filter: hue-rotate(0deg) saturate(1.5);
    box-shadow: 0 0 10px 0 var(--pc-anim-primary-soft);
  }
}
`;

const getAnimationColorVars = (theme: Pick<PlayercardTheme, 'animationPrimaryColor' | 'animationSecondaryColor'>) =>
  ({
    '--pc-anim-primary-soft': toRgba(
      theme.animationPrimaryColor,
      0.28,
      DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
    ),
    '--pc-anim-primary-medium': toRgba(
      theme.animationPrimaryColor,
      0.42,
      DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
    ),
    '--pc-anim-primary-strong': toRgba(
      theme.animationPrimaryColor,
      0.62,
      DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
    ),
    '--pc-anim-secondary-soft': toRgba(
      theme.animationSecondaryColor,
      0.24,
      DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
    ),
    '--pc-anim-secondary-medium': toRgba(
      theme.animationSecondaryColor,
      0.42,
      DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
    ),
  }) as React.CSSProperties;

export const getPlayercardAnimationStyle = (
  theme: Pick<PlayercardTheme, 'cardAnimation' | 'animationPrimaryColor' | 'animationSecondaryColor'>,
  options?: { prefix?: string },
): React.CSSProperties => {
  const prefix = options?.prefix ?? 'pc';
  const vars = getAnimationColorVars(theme);

  switch (theme.cardAnimation) {
    case 'shimmer':
      return {
        ...vars,
        backgroundSize: '200% 100%',
        animation: `${prefix}-shimmer 3s linear infinite`,
      };
    case 'gradient-shift':
      return {
        ...vars,
        animation: `${prefix}-gradient-shift 6s linear infinite`,
      };
    case 'glow-pulse':
      return {
        ...vars,
        animation: `${prefix}-glow-pulse 2s ease-in-out infinite`,
      };
    case 'aurora':
      return {
        ...vars,
        backgroundSize: '300% 300%',
        animation: `${prefix}-aurora 8s ease-in-out infinite`,
      };
    case 'fire-edge':
      return {
        ...vars,
        animation: `${prefix}-fire-edge 1.5s ease-in-out infinite`,
      };
    case 'holographic':
      return {
        ...vars,
        backgroundSize: '200% 200%',
        animation: `${prefix}-holo 4s ease-in-out infinite`,
      };
    default:
      return {};
  }
};
