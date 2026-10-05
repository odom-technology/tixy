/* The profile showcase (docs/design/tixy-rebrand/PROFILES.md). Pure data,
   safe on both sides: the types, the unlock ladder, reading a stored list
   (including the pre-rev. 2 kinds) and the auto layout a player gets before
   they arrange anything. Rendering lives in player-profile.tsx; the server
   facts the auto layout needs come from player-profile.ts. */

export type ShowcaseType =
  | 'featured-score' // ref = game slug: one best, pinned
  | 'favorite-game' // ref = game slug: time, plays and best in one game
  | 'achievements' // the player's pinned achievements (details.featuredAchievementIds), else the rarest
  | 'items' // refs = owned item ids, else the rarest owned
  | 'season' // the season tier and its medal
  | 'bests'; // refs = game slugs to show, else every best, most played first

export type ProfileShowcase = {
  type: ShowcaseType;
  /** One game slug, for featured-score and favorite-game. */
  ref: string;
  /** Item ids (items) or game slugs (bests). Always present, may be empty. */
  refs: string[];
};

export type ShowcaseTypeInfo = {
  type: ShowcaseType;
  /** Lowercase label for pickers. */
  label: string;
  /** One sentence, for the picker's second line. */
  note: string;
  /** Can sit in more than one slot (with a different game each time). */
  repeatable: boolean;
};

export const SHOWCASE_TYPES: readonly ShowcaseTypeInfo[] = [
  { type: 'featured-score', label: 'featured score', note: 'One of your bests, big.', repeatable: true },
  { type: 'favorite-game', label: 'favorite game', note: 'Your time, plays and best in one game.', repeatable: true },
  { type: 'achievements', label: 'achievements', note: 'The ones you pin, or your rarest.', repeatable: false },
  { type: 'items', label: 'prizes', note: 'Prizes you own, up to six.', repeatable: false },
  { type: 'season', label: 'season', note: 'Your tier and the season medal.', repeatable: false },
  { type: 'bests', label: 'bests', note: 'Every game you have a number in.', repeatable: false },
];

const TYPE_SET = new Set<string>(SHOWCASE_TYPES.map((entry) => entry.type));

export const MAX_SHOWCASE_ITEMS = 6;
export const MAX_SHOWCASE_BESTS = 6;

/* The unlock ladder: a new player starts with two slots, so the profile looks
   finished on day one, and the next ones come at levels a regular reaches in
   their first weeks. Level 10 is 2,846 xp, level 20 about 9,800, level 30
   19,562 (server/arcade/levels). */
export const SHOWCASE_LADDER: ReadonlyArray<{ level: number; slots: number }> = [
  { level: 1, slots: 2 },
  { level: 5, slots: 3 },
  { level: 10, slots: 4 },
  { level: 20, slots: 5 },
  { level: 30, slots: 6 },
];

export const MAX_SHOWCASE_SLOTS = SHOWCASE_LADDER[SHOWCASE_LADDER.length - 1]!.slots;

const toLevel = (level: number) => Math.max(1, Math.floor(Number(level) || 1));

/** Showcase slots a level unlocks. */
export function maxShowcaseSlots(level: number): number {
  const lvl = toLevel(level);
  let slots = SHOWCASE_LADDER[0]!.slots;
  for (const step of SHOWCASE_LADDER) if (lvl >= step.level) slots = step.slots;
  return slots;
}

/** The next rung above a level, or null at the top. */
export function nextShowcaseUnlock(level: number): { level: number; slots: number } | null {
  const lvl = toLevel(level);
  return SHOWCASE_LADDER.find((step) => step.level > lvl) ?? null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const ITEM_RE = /^[a-zA-Z0-9_-]{1,120}$/;

function readSlug(value: unknown, isGame: (slug: string) => boolean) {
  if (typeof value !== 'string') return '';
  const slug = value.trim();
  return SLUG_RE.test(slug) && isGame(slug) ? slug : '';
}

function readList(value: unknown, read: (raw: unknown) => string, max: number) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const id = read(raw);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

const readItem = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return ITEM_RE.test(id) ? id : '';
};

/** Read one stored slot, mapping the kinds profiles saved before rev. 2. */
export function readShowcase(raw: unknown, isGame: (slug: string) => boolean): ProfileShowcase | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { type?: unknown; ref?: unknown; refs?: unknown };
  const game = () => readSlug(record.ref, isGame);
  switch (record.type) {
    case 'featured-score':
    case 'stat-highlight': {
      const ref = game();
      return ref ? { type: 'featured-score', ref, refs: [] } : null;
    }
    case 'favorite-game':
    case 'game-stats': {
      const ref = game();
      return ref ? { type: 'favorite-game', ref, refs: [] } : null;
    }
    case 'achievements':
      return { type: 'achievements', ref: '', refs: [] };
    case 'items':
      return { type: 'items', ref: '', refs: readList(record.refs, readItem, MAX_SHOWCASE_ITEMS) };
    case 'featured-item': {
      const id = readItem(record.ref);
      return { type: 'items', ref: '', refs: id ? [id] : [] };
    }
    case 'rarest-item':
      return { type: 'items', ref: '', refs: [] };
    case 'season':
      return { type: 'season', ref: '', refs: [] };
    case 'bests':
    case 'featured-games':
      return {
        type: 'bests',
        ref: '',
        refs: readList(record.refs, (slug) => readSlug(slug, isGame), MAX_SHOWCASE_BESTS),
      };
    default:
      // 'level-badge' and anything unknown: the level is in the header.
      return null;
  }
}

/** The key that makes two slots the same showcase. */
export function showcaseKey(showcase: ProfileShowcase) {
  const info = SHOWCASE_TYPES.find((entry) => entry.type === showcase.type);
  return info?.repeatable ? `${showcase.type}:${showcase.ref}` : showcase.type;
}

/** Read a stored list: known kinds only, no duplicates, at most six. */
export function readShowcases(value: unknown, isGame: (slug: string) => boolean): ProfileShowcase[] {
  if (!Array.isArray(value)) return [];
  const out: ProfileShowcase[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const showcase = readShowcase(raw, isGame);
    if (!showcase) continue;
    const key = showcaseKey(showcase);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(showcase);
    if (out.length >= MAX_SHOWCASE_SLOTS) break;
  }
  return out;
}

export function isShowcaseType(value: unknown): value is ShowcaseType {
  return typeof value === 'string' && TYPE_SET.has(value);
}

/** What the server knows about a player, for the auto layout. */
export type ShowcaseFacts = {
  /** Games with a number, most played first. */
  bestSlugs: string[];
  /** Every game played, with or without a number, most played first. */
  playedSlugs: string[];
  hasAchievements: boolean;
  hasItems: boolean;
};

/* The layout a player gets before they arrange anything, best first: the
   number they are proudest of, then proof (achievements, prizes), then the
   season, then everything else. Slots with nothing to show are skipped, so a
   brand new player still gets a season tile and no empty boxes. */
export function autoShowcases(facts: ShowcaseFacts): ProfileShowcase[] {
  const out: ProfileShowcase[] = [];
  const [top] = facts.bestSlugs;
  if (top) out.push({ type: 'featured-score', ref: top, refs: [] });
  if (facts.hasAchievements) out.push({ type: 'achievements', ref: '', refs: [] });
  if (facts.hasItems) out.push({ type: 'items', ref: '', refs: [] });
  out.push({ type: 'season', ref: '', refs: [] });
  /* The favorite is the most played game that is not already the featured
     score, so a player with two games does not see one game twice. */
  const favorite = facts.playedSlugs.find((slug) => slug !== top) ?? facts.playedSlugs[0];
  if (favorite) out.push({ type: 'favorite-game', ref: favorite, refs: [] });
  if (facts.bestSlugs.length > 1) out.push({ type: 'bests', ref: '', refs: [] });
  return out;
}

/** The slots a profile shows: the player's own list, or the auto layout,
 *  cut to what their level unlocks. */
export function visibleShowcases(input: {
  stored: ProfileShowcase[] | null;
  level: number;
  facts: ShowcaseFacts;
}): ProfileShowcase[] {
  const list = input.stored ?? autoShowcases(input.facts);
  return list.slice(0, maxShowcaseSlots(input.level));
}
