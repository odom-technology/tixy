/* What the kit contains, and where its files go. The counter, the default
   picker and the season card read this list, so an item's id, name and path
   are written once. Paths are under public/ and never change once an item
   ships: they become an `asset_ref`. */

import type { FrameId } from './frames';
import type { MedalId } from './medals';
import type { NamecardId } from './namecards';
import type { StubAvatarSpec } from './stub-avatar';

export const ART_DIR = 'art';

export type ArtKind = 'avatar' | 'frame' | 'namecard' | 'medal';

/* Where an item is meant to come from. `counter` items are sold on the prize
   counter; `season` items are earned on the season card and `board` items on
   the weekly boards, and neither is ever sold. */
export type ArtSource = 'counter' | 'season' | 'board';

type Base = { id: string; name: string; source: ArtSource; note?: string };

export type AvatarItem = Base & { kind: 'avatar'; family: 'stubs'; spec: StubAvatarSpec };
export type FrameItem = Base & { kind: 'frame'; frame: FrameId };
export type NamecardItem = Base & { kind: 'namecard'; card: NamecardId };
export type MedalItem = Base & { kind: 'medal'; medal: MedalId };
export type ArtItem = AvatarItem | FrameItem | NamecardItem | MedalItem;

const avatar = (id: string, name: string, spec: StubAvatarSpec, extra: Partial<Base> = {}): AvatarItem => ({
  kind: 'avatar',
  family: 'stubs',
  id: `stub-${id}`,
  name,
  source: 'counter',
  spec,
  ...extra,
});

/* 24 avatars: the house stub, fifteen hats, then eight bare stubs with a
   face, a stock or a prop of their own. */
export const AVATARS: AvatarItem[] = [
  avatar('house', 'house stub', { ground: 'paper3', stock: 'amber' }, { note: 'The default for new accounts.' }),
  avatar('bowler', 'bowler', { ground: 'paper2', stock: 'blue', hat: 'bowler' }),
  avatar('beanie', 'propeller', { ground: 'paper3', stock: 'green', hat: 'propeller' }),
  avatar(
    'crown',
    'strip crown',
    { ground: 'red', stock: 'ink', hat: 'crown' },
    { source: 'season', note: 'Tier 30 of the season card.' },
  ),
  avatar('season-1', 'ticket cap', { ground: 'paper2', stock: 'green', hat: 'cap' }, { source: 'season', note: 'Tier 20 of the season card: the hat for the season.' }),
  avatar('top-hat', 'top hat', { ground: 'blue', stock: 'lit', hat: 'top-hat' }),
  avatar('party', 'party cone', { ground: 'blue', stock: 'amber', hat: 'party' }),
  avatar('toque', 'toque', { ground: 'red', stock: 'amber', hat: 'toque' }),
  avatar('cowboy', 'cowboy', { ground: 'paper2', stock: 'red', hat: 'cowboy' }),
  avatar('wizard', 'wizard', { ground: 'green', stock: 'lit', hat: 'wizard' }),
  avatar('beret', 'beret', { ground: 'blue', stock: 'brass', hat: 'beret' }),
  avatar('headphones', 'headphones', { ground: 'green', stock: 'amber', hat: 'headphones' }),
  avatar('sprout', 'sprout', { ground: 'paper3', stock: 'blue', hat: 'sprout' }),
  avatar('antenna', 'antenna', { ground: 'blue', stock: 'lit', hat: 'antenna' }),
  avatar('paper-hat', 'paper hat', { ground: 'green', stock: 'brass', hat: 'paper-hat' }),
  avatar('bow', 'bow', { ground: 'paper2', stock: 'amber', hat: 'bow' }),
  avatar('winker', 'winker', { ground: 'paper3', stock: 'blue', face: 'wink', prop: 'ticket' }),
  avatar('grinner', 'grinner', { ground: 'paper2', stock: 'green', face: 'grin', prop: 'coin' }),
  avatar('calm', 'calm stub', { ground: 'paper2', stock: 'ink', face: 'calm', prop: 'gumball' }),
  avatar('night', 'night shift', { ground: 'rail', stock: 'brass', prop: 'pennant' }),
  avatar('ink', 'ink stub', { ground: 'paper3', stock: 'ink', face: 'grin' }),
  avatar('holder', 'ticket holder', { ground: 'blue', stock: 'brass', face: 'grin', prop: 'ticket' }),
  avatar('cream', 'cream stub', { ground: 'rail', stock: 'lit', face: 'wink' }),
  avatar('brass', 'brass stub', { ground: 'green', stock: 'brass', face: 'calm', prop: 'coin' }),
];

export const FRAMES: FrameItem[] = [
  { kind: 'frame', id: 'frame-ticket', name: 'ticket ring', frame: 'ticket', source: 'season', note: 'Tier 5 of the season card. Amber and perforated.' },
  { kind: 'frame', id: 'frame-brass', name: 'brass rail', frame: 'brass', source: 'counter', note: 'Brass with four rivets, for the 8-ball shelf.' },
  { kind: 'frame', id: 'frame-bulbs', name: 'bulb ring', frame: 'bulbs', source: 'counter' },
];

export const NAMECARDS: NamecardItem[] = [
  { kind: 'namecard', id: 'namecard-lights', name: 'string lights', card: 'lights', source: 'season', note: 'Tier 10 of the season card.' },
  { kind: 'namecard', id: 'namecard-awning', name: 'awning', card: 'awning', source: 'counter' },
  { kind: 'namecard', id: 'namecard-planks', name: 'boardwalk', card: 'planks', source: 'counter' },
  { kind: 'namecard', id: 'namecard-bezel', name: 'cabinet', card: 'bezel', source: 'counter' },
  { kind: 'namecard', id: 'namecard-rail', name: 'pool rail', card: 'rail', source: 'counter' },
];

export const MEDALS: MedalItem[] = [
  { kind: 'medal', id: 'medal-season-1', name: 'season 0', medal: 'season-1', source: 'season', note: 'Tier 25 of the season card.' },
  { kind: 'medal', id: 'medal-board-first', name: 'first place', medal: 'board-first', source: 'board', note: 'First on a weekly board.' },
  { kind: 'medal', id: 'medal-ticket', name: 'ticket', medal: 'ticket', source: 'counter' },
  { kind: 'medal', id: 'medal-eight-ball', name: '8-ball', medal: 'eight-ball', source: 'counter' },
  { kind: 'medal', id: 'medal-target', name: 'skee-ball', medal: 'target', source: 'counter' },
  { kind: 'medal', id: 'medal-bell', name: 'high striker', medal: 'bell', source: 'counter' },
  { kind: 'medal', id: 'medal-claw', name: 'prize claw', medal: 'claw', source: 'counter' },
  { kind: 'medal', id: 'medal-pawn', name: 'chess', medal: 'pawn', source: 'counter' },
  { kind: 'medal', id: 'medal-drop', name: 'plinko', medal: 'drop', source: 'counter' },
  { kind: 'medal', id: 'medal-cabinet', name: 'cabinet', medal: 'cabinet', source: 'counter' },
  { kind: 'medal', id: 'medal-crown', name: 'crown', medal: 'crown', source: 'counter' },
];

export const ART_ITEMS: ArtItem[] = [...AVATARS, ...FRAMES, ...NAMECARDS, ...MEDALS];

const DIRS: Record<ArtKind, string> = {
  avatar: 'avatars',
  frame: 'frames',
  namecard: 'namecards',
  medal: 'medals',
};

/* Public paths, for example `/art/avatars/stub-house.svg`. */
export const artPath = (item: Pick<ArtItem, 'id' | 'kind'>, ext: 'svg' | 'png') =>
  `/${ART_DIR}/${DIRS[item.kind]}/${item.id}.${ext}`;

/* The PNG sizes, 2x the largest size the app shows each at. */
export const PNG_SIZE: Record<ArtKind, { width: number; height: number }> = {
  avatar: { width: 192, height: 192 },
  frame: { width: 192, height: 192 },
  medal: { width: 192, height: 192 },
  namecard: { width: 512, height: 128 },
};
