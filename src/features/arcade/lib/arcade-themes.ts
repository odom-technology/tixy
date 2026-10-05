/* Arcade themes. Two systems sit under one account setting:

   - `tixy` (the rev. 2 brand) and its colour schemes: the same layout and
     type with a different set of --tixy-* colour tokens. The scheme lives
     on <html data-tixy-scheme>; the default scheme has no attribute.
   - `boardwalk`: Odom's original Midway look, the lacquered wood floor.

   <html data-arcade-theme> carries the system ('tixy' or 'boardwalk'), so
   every `[data-arcade-theme='tixy']` rule covers every scheme. The token
   values below are the source of truth: globals.css declares the same
   values per scheme, and `npm run test:themes` checks the two agree and
   that every text pair clears 4.5:1 (docs/design/tixy-rebrand/THEMES.md). */

export const ARCADE_THEME_IDS = [
  'tixy',
  'night-shift',
  'seaside',
  'cotton-candy',
  'high-contrast',
  'boardwalk',
] as const;

export type ArcadeThemeId = (typeof ARCADE_THEME_IDS)[number];

/** The layout system a theme renders with. */
export type ArcadeThemeSystem = 'tixy' | 'boardwalk';

/** The --tixy-* colour tokens a scheme sets, by token name. */
export type TixySchemeTokens = {
  /** The ground. */
  paper: string;
  /** Panels and rows. */
  'paper-2': string;
  /** Rows on panels, secondary buttons. */
  'paper-3': string;
  /** Text and the primary button fill. */
  ink: string;
  /** Muted text. */
  'ink-2': string;
  /** Faint text on paper and paper 2; control edges. */
  'ink-3': string;
  /** Tickets and you. */
  ticket: string;
  /** The dot, your turn, a new best, a loss, destructive. A fill. */
  red: string;
  /** Red as small text on paper, paper 2 and paper 3. */
  'red-text': string;
  /** The pool table. */
  felt: string;
  /** Text on a ticket fill (stubs, prices). */
  'on-ticket': string;
  /** Text on a red fill. */
  'on-red': string;
  /** The cabinet outside its screen: the shell, bezels, the floor tiles. */
  cabinet: string;
  /** Hairlines and quiet edges, as an `r g b` triplet used at low alpha. */
  line: string;
};

export type ArcadeThemeDefinition = {
  id: ArcadeThemeId;
  system: ArcadeThemeSystem;
  label: string;
  description: string;
  colorScheme: 'light' | 'dark';
  tokens: TixySchemeTokens;
};

export const DEFAULT_ARCADE_THEME: ArcadeThemeId = 'tixy';

/* Stored ids that no longer exist, mapped to the theme that replaced them.
   brass-token, soda-fountain and closing-time were palette swaps of the
   Midway floor, so they land on boardwalk, the one Midway theme left: same
   layout, same dark wood. The Holocron-era ids were mapped onto those
   three, so they follow them. */
const LEGACY_ARCADE_THEME_MAP: Record<string, ArcadeThemeId> = {
  'brass-token': 'boardwalk',
  'soda-fountain': 'boardwalk',
  'closing-time': 'boardwalk',
  'neon-grid': 'boardwalk',
  'token-gold': 'boardwalk',
  'cabinet-candy': 'boardwalk',
  'after-hours': 'boardwalk',
};

/** The default tixy palette (PLAN.md "Colour"). Cabinets keep it inside. */
export const TIXY_DEFAULT_TOKENS: TixySchemeTokens = {
  paper: '#f4ebdc',
  'paper-2': '#eadfcb',
  'paper-3': '#ded0b7',
  ink: '#1f1a16',
  'ink-2': '#54483d',
  'ink-3': '#6b5e51',
  ticket: '#f2a33c',
  red: '#b83627',
  'red-text': '#9a2d20',
  felt: '#2e7566',
  'on-ticket': '#1f1a16',
  'on-red': '#f4ebdc',
  cabinet: '#1f1a16',
  line: '31 26 22',
};

export const ARCADE_THEMES: ArcadeThemeDefinition[] = [
  {
    id: 'tixy',
    system: 'tixy',
    label: 'tixy',
    description: 'Paper floor, ink cabinets. The house colours.',
    colorScheme: 'light',
    tokens: TIXY_DEFAULT_TOKENS,
  },
  {
    id: 'night-shift',
    system: 'tixy',
    label: 'night shift',
    description: 'The floor after close, in ink panels and amber tickets.',
    colorScheme: 'dark',
    tokens: {
      paper: '#191512',
      'paper-2': '#241e19',
      'paper-3': '#302822',
      ink: '#f4ebdc',
      'ink-2': '#cdc1af',
      'ink-3': '#ab9d8a',
      ticket: '#f2a33c',
      red: '#e8705c',
      'red-text': '#f08f7d',
      felt: '#2e7566',
      'on-ticket': '#1f1a16',
      'on-red': '#191512',
      cabinet: '#0d0b09',
      line: '244 235 220',
    },
  },
  {
    id: 'seaside',
    system: 'tixy',
    label: 'seaside',
    description: 'Sea glass panels and harbour blue ink.',
    colorScheme: 'light',
    tokens: {
      paper: '#e4efea',
      'paper-2': '#d5e6df',
      'paper-3': '#c4dad1',
      ink: '#102a30',
      'ink-2': '#304a4f',
      'ink-3': '#465f63',
      ticket: '#f2a33c',
      red: '#b0322a',
      'red-text': '#922820',
      felt: '#2e7566',
      'on-ticket': '#102a30',
      'on-red': '#f6fbf9',
      cabinet: '#102a30',
      line: '16 42 48',
    },
  },
  {
    id: 'cotton-candy',
    system: 'tixy',
    label: 'cotton candy',
    description: 'Pink paper and plum ink, like the stall by the gate.',
    colorScheme: 'light',
    tokens: {
      paper: '#fbeaf0',
      'paper-2': '#f5dbe6',
      'paper-3': '#ecc9d9',
      ink: '#2c1632',
      'ink-2': '#5a3c5f',
      'ink-3': '#6e5173',
      ticket: '#f2a33c',
      red: '#b3263c',
      'red-text': '#951f33',
      felt: '#2e7566',
      'on-ticket': '#2c1632',
      'on-red': '#fff6f9',
      cabinet: '#2c1632',
      line: '44 22 50',
    },
  },
  {
    id: 'high-contrast',
    system: 'tixy',
    label: 'high contrast',
    description: 'Black on white with firmer lines, for reading at a glance.',
    colorScheme: 'light',
    tokens: {
      paper: '#ffffff',
      'paper-2': '#efefef',
      'paper-3': '#e0e0e0',
      ink: '#000000',
      'ink-2': '#262626',
      'ink-3': '#3d3d3d',
      ticket: '#f2a33c',
      red: '#a8141a',
      'red-text': '#8c1015',
      felt: '#2e7566',
      'on-ticket': '#000000',
      'on-red': '#ffffff',
      cabinet: '#000000',
      line: '0 0 0',
    },
  },
  {
    id: 'boardwalk',
    system: 'boardwalk',
    label: 'Retro boardwalk',
    description: 'The original floor, in lacquered wood and red enamel.',
    colorScheme: 'dark',
    tokens: {
      paper: '#16100a',
      'paper-2': '#261d13',
      'paper-3': '#30261b',
      ink: '#f6eddc',
      'ink-2': '#d4c6ac',
      'ink-3': '#b3a48a',
      ticket: '#f2a33c',
      red: '#e65a50',
      'red-text': '#ff8a85',
      felt: '#2e7566',
      'on-ticket': '#2a1b06',
      'on-red': '#16100a',
      cabinet: '#1f1a16',
      line: '246 237 220',
    },
  },
];

export function isArcadeThemeId(value: unknown): value is ArcadeThemeId {
  return ARCADE_THEME_IDS.includes(value as ArcadeThemeId);
}

export function getArcadeTheme(id: ArcadeThemeId): ArcadeThemeDefinition {
  return ARCADE_THEMES.find((theme) => theme.id === id) ?? ARCADE_THEMES[0];
}

/** 'boardwalk' for Odom's theme, 'tixy' for every tixy scheme. */
export function arcadeThemeSystem(id: ArcadeThemeId): ArcadeThemeSystem {
  return getArcadeTheme(id).system;
}

/** The value of <html data-tixy-scheme>, or undefined for the default. */
export function arcadeThemeScheme(id: ArcadeThemeId): string | undefined {
  return id === DEFAULT_ARCADE_THEME ? undefined : id;
}

/** Puts a theme on <html>: the system and the colour scheme. */
export function applyArcadeTheme(root: HTMLElement, id: ArcadeThemeId) {
  root.dataset.arcadeTheme = arcadeThemeSystem(id);
  const scheme = arcadeThemeScheme(id);
  if (scheme) root.dataset.tixyScheme = scheme;
  else delete root.dataset.tixyScheme;
}

/* Resolves stored theme values, mapping retired ids onto the theme that
   replaced them so persisted account settings keep working. */
export function normalizeArcadeThemeId(value: unknown): ArcadeThemeId | null {
  if (isArcadeThemeId(value)) return value;
  if (typeof value === 'string' && value in LEGACY_ARCADE_THEME_MAP) {
    return LEGACY_ARCADE_THEME_MAP[value];
  }
  return null;
}
