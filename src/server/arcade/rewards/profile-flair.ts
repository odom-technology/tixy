// ---------------------------------------------------------------------------
// Equipped profile flair (badge / frame / name color / title), read from the
// store's user_equipped_items for the 'profile' game type. asset_ref carries
// the visual: nameColor/frame -> {color}, badge -> {emoji}, title -> {text}.
// ---------------------------------------------------------------------------
import { FRAMES, NAMECARDS } from '@/features/brand/avatars/catalog';
import type { FrameId } from '@/features/brand/avatars/frames';
import type { NamecardId } from '@/features/brand/avatars/namecards';
import { query } from '@/server/db/client';

const FRAME_IDS: ReadonlySet<string> = new Set(FRAMES.map((f) => f.frame));
const NAMECARD_IDS: ReadonlySet<string> = new Set(NAMECARDS.map((n) => n.card));

export type ProfileFlair = {
  nameColor: string | null;
  nameGradient: string | null;
  nameGlowColor: string | null;
  nameAnimated: boolean;
  badge: string | null;
  /** Generated badge image URL (preferred over the emoji when present). */
  badgeImage: string | null;
  frameColor: string | null;
  /** An art kit frame: a ring drawn over the avatar. Wins over `frameColor`. */
  frameArt: FrameId | null;
  title: string | null;
  /** Equipped profile background → a ready-to-use CSS background value. */
  background: string | null;
  /** An art kit namecard. Wins over `background`. */
  namecardArt: NamecardId | null;
};

export const EMPTY_PROFILE_FLAIR: ProfileFlair = {
  nameColor: null,
  nameGradient: null,
  nameGlowColor: null,
  nameAnimated: false,
  badge: null,
  badgeImage: null,
  frameColor: null,
  frameArt: null,
  title: null,
  background: null,
  namecardArt: null,
};

/** Read an in-repo/remote image URL from an asset_ref, if any. */
function readImageUrl(ref: Record<string, unknown>): string | null {
  for (const key of ['imageUrl', 'image', 'src', 'url']) {
    const v = ref[key];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t.startsWith('/') || t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:image/')) {
      return t;
    }
  }
  return null;
}

type FlairRow = { user_id?: string; slot: string; asset_ref: string | null; name: string };

function parseAssetRef(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function flairFromRows(rows: FlairRow[]): ProfileFlair {
  const flair: ProfileFlair = { ...EMPTY_PROFILE_FLAIR };
  for (const row of rows) {
    const ref = parseAssetRef(row.asset_ref);
    if (row.slot === 'nameColor' && typeof ref.color === 'string') {
      flair.nameColor = ref.color;
      if (typeof ref.gradient === 'string') flair.nameGradient = ref.gradient;
      if (typeof ref.glowColor === 'string') flair.nameGlowColor = ref.glowColor;
      flair.nameAnimated = ref.animated === true;
    }
    else if (row.slot === 'frame' && typeof ref.frame === 'string' && FRAME_IDS.has(ref.frame)) {
      flair.frameArt = ref.frame as FrameId;
    } else if (row.slot === 'frame' && typeof ref.color === 'string') flair.frameColor = ref.color;
    else if (row.slot === 'badge') {
      flair.badge = typeof ref.emoji === 'string' ? ref.emoji : null;
      flair.badgeImage = readImageUrl(ref);
    } else if (row.slot === 'title') flair.title = typeof ref.text === 'string' ? ref.text : row.name;
    else if (row.slot === 'background' && typeof ref.namecard === 'string' && NAMECARD_IDS.has(ref.namecard)) {
      flair.namecardArt = ref.namecard as NamecardId;
    } else if (row.slot === 'background') {
      const img = readImageUrl(ref);
      if (img) {
        flair.background = `center / cover no-repeat url('${img}')`;
      } else {
        const start = typeof ref.bgStart === 'string' ? ref.bgStart : null;
        const end = typeof ref.bgEnd === 'string' ? ref.bgEnd : start;
        if (start) flair.background = `linear-gradient(135deg, ${start}, ${end})`;
      }
    }
  }
  return flair;
}

export async function getEquippedProfileFlair(userId: string): Promise<ProfileFlair> {
  const rows = await query<FlairRow>(
    `SELECT e.slot, i.asset_ref, i.name
     FROM user_equipped_items e
     JOIN store_items i ON i.id = e.item_id
     WHERE e.user_id = $1 AND e.game_type = 'profile'`,
    [userId],
  );
  return flairFromRows(rows.rows);
}

/** Batched flair for many users (leaderboards, lists). */
export async function listEquippedProfileFlairForUsers(userIds: string[]): Promise<Map<string, ProfileFlair>> {
  const result = new Map<string, ProfileFlair>();
  const ids = [...new Set(userIds)].slice(0, 200);
  if (ids.length === 0) return result;

  const rows = await query<FlairRow>(
    `SELECT e.user_id, e.slot, i.asset_ref, i.name
     FROM user_equipped_items e
     JOIN store_items i ON i.id = e.item_id
     WHERE e.user_id = ANY($1::text[]) AND e.game_type = 'profile'`,
    [ids],
  );

  const byUser = new Map<string, FlairRow[]>();
  for (const row of rows.rows) {
    if (!row.user_id) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  for (const [uid, list] of byUser) result.set(uid, flairFromRows(list));
  return result;
}
