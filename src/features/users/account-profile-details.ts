import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { readShowcases, type ProfileShowcase } from '@/features/users/profile-showcase';

export const ACCOUNT_PROFILE_DETAILS_KEY = 'profile.details';

/* The showcase lives in this same account-data JSON blob (no schema). Its
   types, the unlock ladder and the reading of older kinds are in
   profile-showcase.ts. */
export {
  MAX_SHOWCASE_SLOTS,
  maxShowcaseSlots,
  type ProfileShowcase,
  type ShowcaseType,
} from '@/features/users/profile-showcase';

export type AccountProfileDetails = {
  bio: string;
  /** Ordered homepage/profile pins. The first entry mirrors the legacy field. */
  favoriteGameSlugs: string[];
  /** @deprecated Backward-compatible first favorite for older saved records. */
  favoriteGameSlug: string;
  location: string;
  websiteUrl: string;
  // Free customization basics:
  bannerColor: string;
  accentColor: string;
  statusText: string;
  pronouns: string;
  featuredGameSlugs: string[];
  // A single owned cosmetic from before the item showcase. The auto layout's
  // prize slot still leads with it. Ownership is verified at render time.
  featuredItemId: string;
  // Up to MAX_FEATURED_ACHIEVEMENTS unlocked achievement ids to pin on the
  // profile. Unlock state is verified at render time, so stale ids drop out.
  featuredAchievementIds: string[];
  /* The showcase the player arranged, in order. Null until they save one:
     the profile then shows the auto layout (profile-showcase.ts). Rendering
     trims it to the slots the player's level unlocks. */
  showcases: ProfileShowcase[] | null;
};

export const DEFAULT_ACCOUNT_PROFILE_DETAILS: AccountProfileDetails = {
  bio: '',
  favoriteGameSlugs: [],
  favoriteGameSlug: '',
  location: '',
  websiteUrl: '',
  bannerColor: '',
  accentColor: '',
  statusText: '',
  pronouns: '',
  featuredGameSlugs: [],
  featuredItemId: '',
  featuredAchievementIds: [],
  showcases: null,
};

const FEATURED_ITEM_ID_MAX_LENGTH = 120;
export const MAX_FEATURED_ACHIEVEMENTS = 6;

const BIO_MAX_LENGTH = 280;
const LOCATION_MAX_LENGTH = 80;
const STATUS_MAX_LENGTH = 80;
const PRONOUNS_MAX_LENGTH = 32;
export const MAX_FEATURED_GAMES = 3;
export const MAX_FAVORITE_GAMES = 4;

const isGame = (slug: string) => Boolean(getArcadeGameBySlug(slug));

export function readAccountProfileDetails(value: unknown): AccountProfileDetails {
  if (!value || typeof value !== 'object') return DEFAULT_ACCOUNT_PROFILE_DETAILS;
  const record = value as Partial<Record<keyof AccountProfileDetails, unknown>>;
  const favoriteGameSlugs = readFavoriteGameSlugs(
    record.favoriteGameSlugs === undefined
      ? [record.favoriteGameSlug]
      : record.favoriteGameSlugs,
  );
  const favoriteGameSlug = favoriteGameSlugs[0] ?? '';
  return {
    bio: readText(record.bio, BIO_MAX_LENGTH),
    favoriteGameSlugs,
    favoriteGameSlug,
    location: readText(record.location, LOCATION_MAX_LENGTH),
    // Player-set websites are disabled (abuse vector). The field is retained for
    // back-compat but is always normalized to empty so it never renders or
    // round-trips, even if a raw value was previously stored or POSTed.
    websiteUrl: '',
    bannerColor: readColorHex(record.bannerColor),
    accentColor: readColorHex(record.accentColor),
    statusText: readText(record.statusText, STATUS_MAX_LENGTH),
    pronouns: readText(record.pronouns, PRONOUNS_MAX_LENGTH),
    featuredGameSlugs: readGameSlugs(record.featuredGameSlugs),
    featuredItemId: readItemId(record.featuredItemId),
    featuredAchievementIds: readAchievementIds(record.featuredAchievementIds),
    // Absent or not a list: the auto layout. A saved list, even an empty
    // one, is the player's own.
    showcases: Array.isArray(record.showcases) ? readShowcases(record.showcases, isGame) : null,
  };
}

function readItemId(value: unknown) {
  if (typeof value !== 'string') return '';
  // Store-item ids are kebab slugs like 'snake-body-neon'; keep it permissive.
  const trimmed = value.trim().slice(0, FEATURED_ITEM_ID_MAX_LENGTH);
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : '';
}

/** Achievement ids are kebab slugs ('snake-score-3', 'secret-konami'). */
export function readAchievementIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (out.length >= MAX_FEATURED_ACHIEVEMENTS) break;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, FEATURED_ITEM_ID_MAX_LENGTH);
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function hasProfileDetails(details: AccountProfileDetails) {
  return Boolean(
    details.bio ||
      details.favoriteGameSlugs.length > 0 ||
      details.location ||
      details.websiteUrl ||
      details.bannerColor ||
      details.accentColor ||
      details.statusText ||
      details.pronouns ||
      details.featuredGameSlugs.length > 0 ||
      details.featuredItemId ||
      details.showcases !== null,
  );
}

function readText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function readFavoriteGameSlug(value: unknown) {
  if (typeof value !== 'string') return '';
  const slug = value.trim();
  return slug && getArcadeGameBySlug(slug) ? slug : '';
}

/** Normalize an ordered set of up to four real registry games. */
export function readFavoriteGameSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const slug = readFavoriteGameSlug(item);
    if (slug && !out.includes(slug)) out.push(slug);
    if (out.length >= MAX_FAVORITE_GAMES) break;
  }
  return out;
}

function readColorHex(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : '';
}

function readGameSlugs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const slug = item.trim();
    if (slug && getArcadeGameBySlug(slug) && !out.includes(slug)) out.push(slug);
    if (out.length >= MAX_FEATURED_GAMES) break;
  }
  return out;
}
