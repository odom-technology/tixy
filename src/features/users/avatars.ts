// ---------------------------------------------------------------------------
// Avatar registry. Users no longer paste an arbitrary avatar URL — their
// `image_url` may only ever be one of these curated, in-repo asset paths:
//   - a free DEFAULT avatar (available to everyone), or
//   - an ADMIN avatar (restricted to accounts with the admin role), or
//   - a STORE avatar they own (purchased from the cosmetics store).
//
// This module is the single source of truth for which paths are allowed. It is
// import-safe on both client and server (pure data + helpers, no DB/fs).
// ---------------------------------------------------------------------------

import { AVATARS, artPath } from '@/features/brand/avatars/catalog';

export const AVATAR_DIR = '/cosmetics/avatars';

export type AvatarRarity = 'common' | 'rare' | 'epic' | 'legendary';

const src = (file: string) => `${AVATAR_DIR}/${file}.png`;

export type DefaultAvatar = { id: string; name: string; src: string };
export type StoreAvatar = {
  /** store_items.id — also the id used for ownership/purchase. */
  id: string;
  name: string;
  rarity: AvatarRarity;
  /** in-repo asset path written to arcade_accounts.image_url when selected. */
  src: string;
};

/* The old free defaults. Accounts still point at these paths in
   `arcade_accounts.image_url`, and the files stay in public/cosmetics so every
   old URL keeps returning 200. They are not offered in the picker any more. */
const LEGACY_DEFAULT_AVATARS: DefaultAvatar[] = [
  { id: 'default-rookie-guy', name: 'Rookie', src: src('default-rookie-guy') },
  { id: 'default-rookie-gal', name: 'Newcomer', src: src('default-rookie-gal') },
  { id: 'default-anime-hero', name: 'Anime Hero', src: src('default-anime-hero') },
  { id: 'default-anime-heroine', name: 'Anime Heroine', src: src('default-anime-heroine') },
  { id: 'default-pixel-bot', name: 'Pixel Bot', src: src('default-pixel-bot') },
  { id: 'default-arcade-cat', name: 'Arcade Cat', src: src('default-arcade-cat') },
  { id: 'default-astro', name: 'Astro', src: src('default-astro') },
  { id: 'default-ghost', name: 'Spooky', src: src('default-ghost') },
];

// Profile choices for admins only. These never enter the store catalog or seeds.
export const ADMIN_AVATARS: DefaultAvatar[] = [
  { id: 'admin-odom-tech', name: 'Odom Tech', src: '/brand/odom-tech-avatar.svg' },
];

/** The stub every new account starts with. */
export const DEFAULT_NEW_ACCOUNT_AVATAR = '/art/avatars/stub-house.svg';

const stubPath = (id: string) => `/art/avatars/${id}.svg`;

/* Which stub draws each old free default. A lookup at render time, so no
   account row changes. */
const LEGACY_DEFAULT_STUB: Record<string, string> = {
  'default-rookie-guy': stubPath('stub-bowler'),
  'default-rookie-gal': stubPath('stub-bow'),
  'default-anime-hero': stubPath('stub-cowboy'),
  'default-anime-heroine': stubPath('stub-beret'),
  'default-pixel-bot': stubPath('stub-antenna'),
  'default-arcade-cat': stubPath('stub-toque'),
  'default-astro': stubPath('stub-headphones'),
  'default-ghost': stubPath('stub-cream'),
};

const STUB_BY_LEGACY_SRC = new Map<string, string>(
  LEGACY_DEFAULT_AVATARS.flatMap((a) => {
    const stub = LEGACY_DEFAULT_STUB[a.id]!;
    return [
      [a.src, stub],
      [a.src.replace(/\.png$/, '.webp'), stub],
    ] as [string, string][];
  }),
);

/** What to draw for a stored avatar path: the stub for an old free default,
    the path itself for anything else (stubs, items a player bought). */
export function displayAvatarUrl(value: string): string;
export function displayAvatarUrl(value: string | null | undefined): string | null;
export function displayAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return STUB_BY_LEGACY_SRC.get(value) ?? value;
}

/* Free defaults, granted to everyone. The art kit's stubs except the two the
   season card gives out. */
export const DEFAULT_AVATARS: DefaultAvatar[] = AVATARS.filter((a) => a.source === 'counter').map((a) => ({
  id: a.id,
  name: a.name,
  src: artPath(a, 'svg'),
}));

// Purchasable store avatars. `id` doubles as the store_items id; the seed
// (scripts/seed-cosmetics.ts) creates a matching 'profile' / 'avatar' item.
export const STORE_AVATARS: StoreAvatar[] = [
  { id: 'profile-avatar-snake', name: 'Neon Serpent', rarity: 'common', src: src('snake-neon') },
  { id: 'profile-avatar-tetris', name: 'Block Head', rarity: 'common', src: src('tetris-blockhead') },
  { id: 'profile-avatar-flappy', name: 'Sky Pilot', rarity: 'common', src: src('flappy-pilot') },
  { id: 'profile-avatar-gopher', name: 'Burrow Buddy', rarity: 'common', src: src('gopher-digger') },
  { id: 'profile-avatar-mines', name: 'Little Sapper', rarity: 'common', src: src('mines-sapper') },
  { id: 'profile-avatar-2048', name: 'Golden Tile', rarity: 'rare', src: src('2048-tilemask') },
  { id: 'profile-avatar-breakout', name: 'Brick Striker', rarity: 'rare', src: src('breakout-striker') },
  { id: 'profile-avatar-swerve', name: 'Speed Demon', rarity: 'rare', src: src('swerve-racer') },
  { id: 'profile-avatar-plinko', name: 'Lucky Chip', rarity: 'rare', src: src('plinko-lucky') },
  { id: 'profile-avatar-ninja', name: 'Cyber Ninja', rarity: 'rare', src: src('cyber-ninja') },
  { id: 'profile-avatar-chess', name: 'The Monarch', rarity: 'epic', src: src('chess-monarch') },
  { id: 'profile-avatar-slots', name: 'Jackpot', rarity: 'epic', src: src('slots-jackpot') },
  { id: 'profile-avatar-samurai', name: 'Blossom Samurai', rarity: 'epic', src: src('anime-samurai') },
  { id: 'profile-avatar-vaporwave', name: 'Vapor Idol', rarity: 'epic', src: src('vaporwave-idol') },
  { id: 'profile-avatar-dragon', name: 'Emberlord', rarity: 'legendary', src: src('dragon-emberlord') },
  { id: 'profile-avatar-champion', name: 'Golden Champion', rarity: 'legendary', src: src('golden-champion') },
  // wave-d: store2 avatar batch (6 committed PNGs). Rarities spread sensibly.
  { id: 'profile-avatar-store2-clown', name: 'Big Top Clown', rarity: 'common', src: src('store2-avatar-clown') },
  { id: 'profile-avatar-store2-frog', name: 'Lily Hopper', rarity: 'common', src: src('store2-avatar-frog') },
  { id: 'profile-avatar-store2-panda', name: 'Bamboo Bandit', rarity: 'rare', src: src('store2-avatar-panda') },
  { id: 'profile-avatar-store2-fox', name: 'Sly Fox', rarity: 'rare', src: src('store2-avatar-fox') },
  { id: 'profile-avatar-store2-owl', name: 'Night Owl', rarity: 'epic', src: src('store2-avatar-owl') },
  { id: 'profile-avatar-store2-retro-bot', name: 'Retro Bot', rarity: 'epic', src: src('store2-avatar-retro-bot') },
  // wave-d: store2 avatar batch #2 (6 committed PNGs). Rarities spread sensibly.
  { id: 'profile-avatar-store2-carnival-strongman', name: 'The Strongman', rarity: 'common', src: src('store2-avatar-carnival-strongman') },
  { id: 'profile-avatar-store2-arcade-yeti', name: 'Arcade Yeti', rarity: 'rare', src: src('store2-avatar-arcade-yeti') },
  { id: 'profile-avatar-store2-deep-mermaid', name: 'Abyssal Siren', rarity: 'rare', src: src('store2-avatar-deep-mermaid') },
  { id: 'profile-avatar-store2-neon-knight', name: 'Neon Knight', rarity: 'epic', src: src('store2-avatar-neon-knight') },
  { id: 'profile-avatar-store2-pixel-wizard', name: 'Pixel Wizard', rarity: 'epic', src: src('store2-avatar-pixel-wizard') },
  { id: 'profile-avatar-store2-cosmic-drifter', name: 'Cosmic Drifter', rarity: 'legendary', src: src('store2-avatar-cosmic-drifter') },
];

const DEFAULT_AVATAR_SRCS = new Set([
  ...DEFAULT_AVATARS.map((a) => a.src),
  ...LEGACY_DEFAULT_AVATARS.map((a) => a.src),
]);
const ADMIN_AVATAR_SRCS = new Set(ADMIN_AVATARS.map((a) => a.src));
const STORE_AVATAR_BY_SRC = new Map(STORE_AVATARS.map((a) => [a.src, a]));
const STORE_AVATAR_BY_ID = new Map(STORE_AVATARS.map((a) => [a.id, a]));

/** An avatar path an account may point at when it owns something under this folder. */
export const isAvatarAssetPath = (value: string) =>
  value.startsWith(`${AVATAR_DIR}/`) || value.startsWith('/art/avatars/');

/** A path everyone may use (no ownership required). */
export function isDefaultAvatarSrc(value: string): boolean {
  return DEFAULT_AVATAR_SRCS.has(value);
}

/** A curated avatar path that requires the admin role (not store ownership). */
export function isAdminAvatarSrc(value: string): boolean {
  return Boolean(adminAvatarBySrc(value));
}

/** Recognize URL/path variants too, so registration cannot bypass the role check. */
export function adminAvatarBySrc(value: string): DefaultAvatar | undefined {
  try {
    const url = new URL(value, 'https://arcade.invalid');
    const pathname = new URL(decodeURIComponent(url.pathname), 'https://arcade.invalid').pathname;
    return ADMIN_AVATARS.find((avatar) => avatar.src === pathname);
  } catch {
    return undefined;
  }
}

/** The store avatar served at this path, if any. */
export function storeAvatarBySrc(value: string): StoreAvatar | undefined {
  return STORE_AVATAR_BY_SRC.get(value);
}

export function storeAvatarById(id: string): StoreAvatar | undefined {
  return STORE_AVATAR_BY_ID.get(id);
}

/** Is this any known curated avatar path? This does not grant selection rights. */
export function isKnownAvatarSrc(value: string): boolean {
  return DEFAULT_AVATAR_SRCS.has(value) || ADMIN_AVATAR_SRCS.has(value) || STORE_AVATAR_BY_SRC.has(value);
}
