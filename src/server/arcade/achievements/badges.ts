// Which badge each achievement wears. The art is in
// src/features/brand/avatars/badges.tsx; an achievement's `icon` is the
// reference "badge:<glyph>:<tier>" that AchievementIcon draws. Ids never
// change, so this is keyed by series id (every tier shares a glyph and the
// tier sets the rim) and by id for the rest.
import { badgeRef, type BadgeGlyphId } from '@/features/brand/avatars/badges';

const BY_SERIES: Record<string, BadgeGlyphId> = {
  'snake-score': 'snake',
  '2048-tile': 'tile2048',
  'stack-score': 'stack',
  'high-striker-score': 'bell',
  'high-striker-bell-ringer': 'bell',
  'high-striker-depth': 'mallet',
  'high-striker-bells': 'bell',
  'tin-duck-score': 'duck',
  'tin-duck-gallery-score': 'duck',
  'chess-wins': 'pawn',
  '8ball-wins': 'eight-ball',
  'connect-four-wins': 'connect',
  'skee-ball-score': 'target',
  'ricochet-score': 'ricochet',
  'ticket-stop-score': 'lock',
  'trick-shot-clears': 'trick-shot',
  'trick-shot-streak': 'trick-streak',
  'ring-toss-score': 'ring',
  'derby-wins': 'horseshoe',
  'mini-golf-aces': 'mini-golf',
  'bumper-cars-bumps': 'bumper-cars',
  'mp-wins': 'duel',
  'mp-streak': 'chevrons',
  'mp-bots': 'robot',
  'global-games': 'joystick',
  'global-streak': 'calendar',
  'global-hours': 'hourglass',
  'economy-tickets': 'tickets',
  'meta-collector': 'gumball',
  'meta-achiever': 'trophy',
  'daily-streak': 'flame',
  'daily-solved': 'puzzle',
  // Folded into ticket stop: held tiers keep the lock.
  'tumbler-score': 'lock',
  'reaction-ms': 'lock',
};

const BY_ID: Record<string, BadgeGlyphId> = {
  'first-game': 'ticket',
  'jack-of-all': 'fan',
  '2048-ascendant': 'beyond',
  untouchable: 'shield',
  centurion: 'laurel',
  'trick-shot-first-try': 'trick-first',
  'arcade-master': 'crown',
  'speed-demon': 'lock',
  'high-roller': 'tickets',
  'secret-konami': 'dpad',
  'secret-konami-master': 'dpad-master',
  'secret-logo': 'poke',
  'secret-night-owl': 'moon',
  'secret-early-bird': 'sun',
  'secret-explorer': 'map',
  'secret-humble': 'sprout',
  'secret-window-shopper': 'window',
  'secret-fashionista': 'hat',
  'secret-palindrome': 'mirror',
  'secret-leet': 'gem',
  'secret-marathon': 'replay',
  'secret-birthday': 'cake',
  'secret-newyear': 'burst',
  'secret-pi': 'pie',
  'secret-rage-quit': 'grass',
  'secret-lurker': 'eye',
  'secret-lab': 'unknown',
  'secret-comeback': 'unknown',
  'secret-completionist': 'trophy',
};

const FLOOR_GROUP_GLYPHS: Record<string, BadgeGlyphId> = {
  'with-friends': 'group-with-friends',
  boardwalk: 'group-boardwalk',
  'quick-play': 'group-quick-play',
  'ticket-machines': 'group-ticket-machines',
  daily: 'group-daily',
};

/** What a locked secret shows until it is earned. */
export const SECRET_ICON = badgeRef('unknown', 0);

/** A series with no glyph of its own (a game that left the floor) wears the cabinet. */
const FALLBACK: BadgeGlyphId = 'cabinet';

export function badgeGlyphFor(id: string, seriesId?: string, floorGroup?: string): BadgeGlyphId {
  if (seriesId && BY_SERIES[seriesId]) return BY_SERIES[seriesId];
  if (floorGroup && FLOOR_GROUP_GLYPHS[floorGroup]) return FLOOR_GROUP_GLYPHS[floorGroup];
  return BY_ID[id] ?? FALLBACK;
}

export const badgeIconFor = (id: string, tier: number, seriesId?: string, floorGroup?: string) =>
  badgeRef(badgeGlyphFor(id, seriesId, floorGroup), tier);
