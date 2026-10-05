export type RewardGameType =
  | 'snake'
  | 'flappy-bird'
  | 'typing-test'
  | 'reaction-time'
  | 'coin-flip'
  | '8-ball'
  | 'tetris'
  | 'connections'
  | '2048'
  | 'chess'
  | 'word-grid'
  | 'pangram'
  | 'stack'
  | 'sequence'
  | 'breakout'
  | 'tumbler'
  | 'gopher'
  | 'ricochet'
  | 'swerve'
  | 'sudoku'
  | 'math'
  | 'connect-four'
  | 'checkers'
  | 'reversi'
  | 'battleship'
  | 'bubble-shooter'
  | 'gem-swap'
  | 'sky-climber'
  | 'minesweeper'
  | 'log-splitter'
  | 'knife-booth'
  | 'melon-chop'
  | 'tin-duck'
  | 'boardwalk-hop'
  | 'high-striker'
  | 'skee-ball'
  | 'gunrush'
  | 'punch-card'
  | 'freecell'
  | 'keno'
  | 'prize-wheel'
  | 'baccarat'
  | 'gem-roll'
  | 'fortune-teller'
  | 'lucky-cage'
  | 'ring-toss'
  | 'mini-golf'
  | 'derby'
  | 'profile'
  | 'bumper-cars';

// fallow-ignore-next-line duplicate-export
export type CurrencyType = 'credits';
// fallow-ignore-next-line duplicate-export
export type StoreRarity =
  | 'common'
  | 'rare'
  | 'epic'
  | 'legendary';

export type StoreComplexity = 'low' | 'medium' | 'high' | 'multi';

export type StoreCurrencyType = CurrencyType;

export const CREDIT_INCREMENT = 5;
export const PRIMARY_CURRENCY_NAME = 'Tickets';
export const PRIMARY_CURRENCY_STORAGE_TYPE: CurrencyType = 'credits';
// Economy speed profile: unlimited play with a capped daily Ticket payout.
// 2026-06 rework: cap raised 150 → 300 and per-run rewards scaled up (see
// MAX_GAME_RUN_CREDITS / calculateGameRewardCredits in wallet.ts) so the cap is
// reachable in a normal session (~5 strong runs) while the daily featured game —
// paying 2x and earning above the cap — stays the fastest way to top up.
export const GAME_DAILY_TICKET_CAP = 300;
export const GAME_DAILY_CREDIT_CAP = GAME_DAILY_TICKET_CAP;

/** Max credits a single (non-featured) run can pay before the daily cap clamps it.
 *  The saturating reward curve in wallet.ts asymptotes to this value. */
export const MAX_GAME_RUN_CREDITS = 75;

// -----------------------------------------------------------------------------
// Daily login claim — Tickets for showing up, every day of the week. A 7-day
// ladder that repeats: 525 a week. Streaks count consecutive days.
// A player already on a streak when the ladder arrived keeps the amount they
// had (the legacy amounts below) until the streak breaks.
// -----------------------------------------------------------------------------
export const DAILY_CLAIM_LADDER = [25, 25, 50, 50, 75, 100, 200] as const;
export const DAILY_CLAIM_BASE_CREDITS = DAILY_CLAIM_LADDER[0];
/** Days in one turn of the ladder; the last day is the biggest. */
export const DAILY_CLAIM_LADDER_DAYS = DAILY_CLAIM_LADDER.length;

/** The work-day claim this replaced: 75, plus 7 a day of streak to 208. */
export const DAILY_CLAIM_LEGACY_BASE_CREDITS = 75;
export const DAILY_CLAIM_LEGACY_BONUS_PER_DAY = 7;
export const DAILY_CLAIM_LEGACY_MAX_BONUS_DAYS = 20;

export const MONTHLY_CREDIT_PAYOUTS = [1200, 900, 600, 300, 150] as const;

// Widened 2026-06 (30 → 40) now that the catalog spans every game, so the daily
// shop shows more variety across the new games. The generator fills any slots
// beyond the composition counts from the remaining pool.
export const STORE_ROTATION_CREDIT_SLOTS = 40;

// Daily legendary marquee: legendaries are excluded from the 40 standard
// slots (composition below), which previously made seeded legendaries
// unpurchasable — the purchase gate requires being in today's rotation. Two
// dedicated slots (appended after the 40) surface a rotating pair each day;
// the store's featured carousel leads with them.
export const STORE_ROTATION_LEGENDARY_SLOTS = 2;

export const STORE_DAILY_RARITY_COMPOSITION: Record<
  Extract<StoreRarity, 'common' | 'rare' | 'epic'>,
  number
> = {
  epic: 8,
  rare: 16,
  common: 16,
};

const _STORE_BASE_CREDIT_PRICES: Record<
  Extract<StoreRarity, 'common' | 'rare' | 'epic'>,
  number
> = {
  common: 400,
  rare: 650,
  epic: 1000,
};

const _STORE_COMPLEXITY_MULTIPLIERS: Record<StoreComplexity, number> = {
  low: 1.0,
  medium: 1.3,
  high: 1.6,
  multi: 1.9,
};

const _STORE_SEASONAL_MULTIPLIER = 1.25;

export const STORE_RARITY_ORDER: StoreRarity[] = [
  'common',
  'rare',
  'epic',
  'legendary',
];

export const GLOBAL_ITEM_OWNER_ID = '__all_users__';

export const STORE_GAME_TYPES = [
  'snake',
  'flappy-bird',
  'typing-test',
  'reaction-time',
  'coin-flip',
  '8-ball',
  'tetris',
  'connections',
  '2048',
  'chess',
  'word-grid',
  'pangram',
  'stack',
  'sequence',
  'breakout',
  'tumbler',
  'gopher',
  'ricochet',
  'swerve',
  'sudoku',
  'math',
  'connect-four',
  'checkers',
  'reversi',
  'battleship',
  'bubble-shooter',
  'gem-swap',
  'sky-climber',
  'minesweeper',
  'log-splitter',
  'knife-booth',
  'melon-chop',
  'tin-duck',
  'boardwalk-hop',
  'high-striker',
  'skee-ball',
  'gunrush',
  'punch-card',
  'freecell',
  'keno',
  'prize-wheel',
  'baccarat',
  'gem-roll',
  'fortune-teller',
  'lucky-cage',
  'profile',
  // Ring toss: a new game's store type, after the stored ones.
  'ring-toss',
  // New games append here: these are stored keys.
  'mini-golf',
  'bumper-cars',
  // Derby: the race (derby royale's slug, reworked).
  'derby',
] as const;

const SNAKE_SLOTS = ['body', 'food', 'board'] as const;
const MINI_GOLF_SLOTS = ['course', 'ball', 'flag'] as const;
const BUMPER_CARS_SLOTS = ['car', 'rink', 'rail'] as const;
const FLAPPY_SLOTS = ['bird', 'pipe', 'background', 'trail'] as const;
const TYPING_SLOTS = [
  'theme',
  'caret',
  'text-style',
  'feedback',
] as const;
const REACTION_SLOTS = ['target', 'background'] as const;
const EIGHT_BALL_SLOTS = ['cue', 'table', 'balls', 'playercard'] as const;
const TETRIS_SLOTS = ['blocks', 'board', 'effects', 'ghost'] as const;
const COIN_FLIP_SLOTS = ['coin', 'trail', 'background'] as const;
const GAME_2048_SLOTS = ['tiles', 'grid', 'background'] as const;
const CHESS_SLOTS = ['pieces', 'board', 'clock'] as const;
// Profile cosmetics (flair) reuse the store/equip system via this game type.
// 'avatar' is special: equipping one writes the asset path to the account's
// image_url (the single source of truth for avatars) rather than rendering as
// flair — see equipStoreItemForUser + profile-flair (which ignores 'avatar').
const PROFILE_SLOTS = ['badge', 'frame', 'nameColor', 'title', 'background', 'avatar'] as const;

// 2026-06 cosmetics expansion — slots for the newer solo/PvP games. Wager games
// are intentionally excluded (no cosmetics there yet). Themes apply on top of the
// Midway default look, so an empty loadout leaves each game visually unchanged.
const GOPHER_SLOTS = ['gopher', 'turf', 'effects'] as const;
const RICOCHET_SLOTS = ['bird', 'obstacle', 'background', 'trail'] as const;
const SWERVE_SLOTS = ['cart', 'track', 'environment'] as const;
const TUMBLER_SLOTS = ['dial', 'pegs', 'background'] as const;
const BREAKOUT_SLOTS = ['paddle', 'ball', 'bricks', 'background'] as const;
const STACK_SLOTS = ['blocks', 'background', 'effects'] as const;
const SEQUENCE_SLOTS = ['pads', 'background'] as const;
const SUDOKU_SLOTS = ['board', 'numbers', 'accent'] as const;
const MATH_SLOTS = ['theme', 'accent'] as const;
const CONNECT_FOUR_SLOTS = ['discs', 'board', 'background'] as const;
const CHECKERS_SLOTS = ['pieces', 'board'] as const;
const CONNECTIONS_SLOTS = ['tiles', 'accent'] as const;
const WORD_GRID_SLOTS = ['tiles', 'keyboard', 'accent'] as const;
const PANGRAM_SLOTS = ['honeycomb', 'accent', 'background'] as const;
// 2026-06 new games — cosmetic slots. Themes apply on top of the Midway default,
// so an empty loadout leaves each game visually unchanged.
const REVERSI_SLOTS = ['discs', 'board', 'background'] as const;
const BATTLESHIP_SLOTS = ['ships', 'board', 'background'] as const;
const BUBBLE_SHOOTER_SLOTS = ['bubbles', 'launcher', 'background'] as const;
const GEM_SWAP_SLOTS = ['gems', 'board', 'background'] as const;
const SKY_CLIMBER_SLOTS = ['climber', 'platforms', 'background'] as const;
// wave-d: registry slot names realigned to what buildMinesweeperTheme() consumes
// (board/numbers/accent). The prior ['tiles','mines','accent'] never matched the
// reader, so board/numbers skins could not equip. No seeded item or DB row used
// the old 'tiles'/'mines' minesweeper slots, so this is a safe replace.
const MINESWEEPER_SLOTS = ['board', 'numbers', 'accent'] as const;
// Log Splitter (two-button panic rhythm). Themes apply on top of the Midway
// default, so an empty loadout leaves the game visually unchanged.
const LOG_SPLITTER_SLOTS = ['axe', 'tree', 'background', 'effects'] as const;
// Knife Booth (spinning-target skill game). Cosmetic slots overlay the Midway
// default, so an empty loadout leaves the game visually unchanged.
const KNIFE_BOOTH_SLOTS = ['knife', 'target', 'effects'] as const;
// Melon Chop (swipe-slice blitz). Cosmetic slots overlay the Midway default, so
// an empty loadout leaves the game visually unchanged.
//   blade    → the swipe trail + optional trail glow
//   fruit    → the fruit set body/highlight per variant
//   splatter → the juice-splatter particle tint
const MELON_CHOP_SLOTS = ['blade', 'fruit', 'splatter'] as const;
// Tin Duck Gallery (scrolling shooting-gallery skill game). Cosmetic slots overlay
// the Midway default, so an empty loadout leaves the booth visually unchanged.
//   duck  → the tin ducks (incl. the golden bonus duck) + knock-down flip
//   sight → the crosshair / gun sight that follows the pointer
//   booth → the framing curtains + valance + backboard enamel
const TIN_DUCK_SLOTS = ['duck', 'sight', 'booth'] as const;
// Punch Card (nonogram). paper → grid papers; ink → marker inks (fill/X);
// reveal → highlight + solved-reveal palette.
const PUNCH_CARD_SLOTS = ['paper', 'ink', 'reveal'] as const;
// FreeCell Sprint. felt = table felt + rails; cards = card-back medallion +
// empty-slot frames + foundation/free-cell tint; cascade = auto-complete win
// burst. All overlay the Midway default, so an empty loadout is unchanged.
const FREECELL_SLOTS = ['felt', 'cards', 'cascade'] as const;
// Boardwalk Hop (2.5D grid road-hopper). hopper → the player mascot; lane → the
// boardwalk planks + cart/flume hazards; scene → sky / horizon / drop shadows.
// All overlay the Midway default, so an empty loadout leaves the game unchanged.
const BOARDWALK_HOP_SLOTS = ['hopper', 'lane', 'scene'] as const;
// High Striker (3D strongman tower). tower → the wooden striker board + bell;
// puck → the climbing puck + hammer; background → the midway night scene. All
// overlay the Midway default, so an empty loadout leaves the game unchanged.
const HIGH_STRIKER_SLOTS = ['tower', 'puck', 'background'] as const;
// Skee-Ball (3D roll-and-score ramp). lane → the walnut lane + kicker ramp +
// rails; rings → the enamel scoring rings + corner pockets + the ball;
// background → the midway night scene. All overlay the Midway default, so an
// empty loadout leaves the game unchanged.
const SKEE_BALL_SLOTS = ['lane', 'rings', 'background'] as const;
// Ring toss: one skin set fills all three (crate and bottles, rings, booth).
const RING_TOSS_SLOTS = ['crate', 'rings', 'booth'] as const;
// Derby: track → the backboard's rails and the target wall, horses → the toy
// horses' make, lane → the counter and your water gun.
const DERBY_SLOTS = ['track', 'horses', 'lane'] as const;
// Gunrush (3D endless squad runner). squad → the gunner figures, their rim glow
// and muzzle flash; arsenal → the weapon bodies, tracers and the gate arches
// they stand under; track → the boardwalk lane, rails, enemies, sky and fog.
// All overlay the Midway default, so an empty loadout leaves the run unchanged.
// See app/(games)/gunrush/_gunrush-theme.ts.
const GUNRUSH_SLOTS = ['squad', 'arsenal', 'track'] as const;
// Keno (wager board). Cosmetic slots overlay the Midway default, so an empty
// loadout leaves the board visually unchanged. See app/(games)/keno/_keno-theme.ts.
const KENO_SLOTS = ['spots', 'balls', 'background'] as const;
// Prize Wheel (wager wheel-of-fortune). Cosmetic slots overlay the Midway
// default enamel theme, so an empty loadout leaves the wheel visually
// unchanged. See app/(games)/prize-wheel/_prize-wheel-theme.ts.
//   segments → the enamel bands painted on each wheel wedge (loss..jackpot)
//   wheel    → the rim, hub cap, pointer/flapper and spoke dividers
const PRIZE_WHEEL_SLOTS = ['segments', 'wheel'] as const;
// Baccarat (wager card table). Cosmetic slots overlay the Midway default, so an
// empty loadout leaves the felt visually unchanged. See
// app/(games)/baccarat/_baccarat-theme.ts.
//   felt   → the table felt backdrop + rail
//   zones  → the Player / Banker / Tie bet-zone enamels
//   accent → the winning-zone glow + house card-back deck
const BACCARAT_SLOTS = ['felt', 'zones', 'accent'] as const;
// Gem Roll (instant pattern wager). Cosmetic slots overlay the Midway default,
// so an empty loadout leaves the sockets visually unchanged. See
// app/(games)/gem-roll/_gem-roll-theme.ts.
//   gems  → the 7 gem colours (ruby..rose)
//   tray  → the socket tray body/rim the gems seat in
//   flare → the match-flare + payline callout tint
const GEM_ROLL_SLOTS = ['gems', 'tray', 'flare'] as const;
// Fortune Teller (wager tarot cards). Cosmetic slots overlay the Midway default,
// so an empty loadout leaves the booth visually unchanged. See
// app/(games)/fortune-teller/_fortune-teller-theme.ts.
//   cloth    → the velvet booth backdrop + frame + trim
//   ball     → the crystal ball core, halo, rim and printed ink
//   cardback → the face-down tarot card back
const FORTUNE_TELLER_SLOTS = ['cloth', 'ball', 'cardback'] as const;
// Lucky Cage (3D boardwalk lottery cabinet). Cosmetic slots overlay the
// hand-built default cabinet, so an empty loadout renders the machine exactly as
// designed. See app/(games)/lucky-cage/_lucky-cage-theme.ts.
//   cabinet    → the walnut carcass, apron, chute trough and return rail
//   cage       → the aged brass cage, axle, crank and gate
//   balls      → the ball body/ink and the five painted rack bands
//   background → the night-boardwalk backdrop, deck and practical bulbs
const LUCKY_CAGE_SLOTS = ['cabinet', 'cage', 'balls', 'background'] as const;

export type SnakeSlot = (typeof SNAKE_SLOTS)[number];
export type FlappySlot = (typeof FLAPPY_SLOTS)[number];
export type TypingSlot = (typeof TYPING_SLOTS)[number];
export type ReactionSlot = (typeof REACTION_SLOTS)[number];
export type EightBallSlot = (typeof EIGHT_BALL_SLOTS)[number];
export type TetrisSlot = (typeof TETRIS_SLOTS)[number];
export type CoinFlipSlot = (typeof COIN_FLIP_SLOTS)[number];
export type Game2048Slot = (typeof GAME_2048_SLOTS)[number];
export type ChessSlot = (typeof CHESS_SLOTS)[number];
export type ProfileSlot = (typeof PROFILE_SLOTS)[number];

type SlotOf<T extends readonly string[]> = T[number];

export type GameSlot =
  | SnakeSlot
  | FlappySlot
  | TypingSlot
  | ReactionSlot
  | EightBallSlot
  | TetrisSlot
  | CoinFlipSlot
  | Game2048Slot
  | ChessSlot
  | ProfileSlot
  | SlotOf<typeof GOPHER_SLOTS>
  | SlotOf<typeof RICOCHET_SLOTS>
  | SlotOf<typeof SWERVE_SLOTS>
  | SlotOf<typeof TUMBLER_SLOTS>
  | SlotOf<typeof BREAKOUT_SLOTS>
  | SlotOf<typeof STACK_SLOTS>
  | SlotOf<typeof SEQUENCE_SLOTS>
  | SlotOf<typeof SUDOKU_SLOTS>
  | SlotOf<typeof MATH_SLOTS>
  | SlotOf<typeof CONNECT_FOUR_SLOTS>
  | SlotOf<typeof CHECKERS_SLOTS>
  | SlotOf<typeof CONNECTIONS_SLOTS>
  | SlotOf<typeof WORD_GRID_SLOTS>
  | SlotOf<typeof PANGRAM_SLOTS>
  | SlotOf<typeof REVERSI_SLOTS>
  | SlotOf<typeof BATTLESHIP_SLOTS>
  | SlotOf<typeof BUBBLE_SHOOTER_SLOTS>
  | SlotOf<typeof GEM_SWAP_SLOTS>
  | SlotOf<typeof SKY_CLIMBER_SLOTS>
  | SlotOf<typeof MINESWEEPER_SLOTS>
  | SlotOf<typeof LOG_SPLITTER_SLOTS>
  | SlotOf<typeof KNIFE_BOOTH_SLOTS>
  | SlotOf<typeof MELON_CHOP_SLOTS>
  | SlotOf<typeof TIN_DUCK_SLOTS>
  | SlotOf<typeof BOARDWALK_HOP_SLOTS>
  | SlotOf<typeof HIGH_STRIKER_SLOTS>
  | SlotOf<typeof SKEE_BALL_SLOTS>
  | SlotOf<typeof RING_TOSS_SLOTS>
  | SlotOf<typeof DERBY_SLOTS>
  | SlotOf<typeof GUNRUSH_SLOTS>
  | SlotOf<typeof PUNCH_CARD_SLOTS>
  | SlotOf<typeof FREECELL_SLOTS>
  | SlotOf<typeof KENO_SLOTS>
  | SlotOf<typeof PRIZE_WHEEL_SLOTS>
  | SlotOf<typeof BACCARAT_SLOTS>
  | SlotOf<typeof GEM_ROLL_SLOTS>
  | SlotOf<typeof FORTUNE_TELLER_SLOTS>
  | SlotOf<typeof LUCKY_CAGE_SLOTS>
  | SlotOf<typeof MINI_GOLF_SLOTS>
  | SlotOf<typeof BUMPER_CARS_SLOTS>;

export const GAME_SLOTS: Record<RewardGameType, readonly GameSlot[]> = {
  snake: SNAKE_SLOTS,
  'flappy-bird': FLAPPY_SLOTS,
  'typing-test': TYPING_SLOTS,
  'reaction-time': REACTION_SLOTS,
  '8-ball': EIGHT_BALL_SLOTS,
  tetris: TETRIS_SLOTS,
  'coin-flip': COIN_FLIP_SLOTS,
  connections: CONNECTIONS_SLOTS,
  '2048': GAME_2048_SLOTS,
  chess: CHESS_SLOTS,
  'word-grid': WORD_GRID_SLOTS,
  pangram: PANGRAM_SLOTS,
  stack: STACK_SLOTS,
  sequence: SEQUENCE_SLOTS,
  breakout: BREAKOUT_SLOTS,
  tumbler: TUMBLER_SLOTS,
  gopher: GOPHER_SLOTS,
  ricochet: RICOCHET_SLOTS,
  swerve: SWERVE_SLOTS,
  sudoku: SUDOKU_SLOTS,
  math: MATH_SLOTS,
  'connect-four': CONNECT_FOUR_SLOTS,
  checkers: CHECKERS_SLOTS,
  reversi: REVERSI_SLOTS,
  battleship: BATTLESHIP_SLOTS,
  'bubble-shooter': BUBBLE_SHOOTER_SLOTS,
  'gem-swap': GEM_SWAP_SLOTS,
  'sky-climber': SKY_CLIMBER_SLOTS,
  minesweeper: MINESWEEPER_SLOTS,
  'log-splitter': LOG_SPLITTER_SLOTS,
  'knife-booth': KNIFE_BOOTH_SLOTS,
  'melon-chop': MELON_CHOP_SLOTS,
  'tin-duck': TIN_DUCK_SLOTS,
  'boardwalk-hop': BOARDWALK_HOP_SLOTS,
  'high-striker': HIGH_STRIKER_SLOTS,
  'skee-ball': SKEE_BALL_SLOTS,
  gunrush: GUNRUSH_SLOTS,
  'punch-card': PUNCH_CARD_SLOTS,
  freecell: FREECELL_SLOTS,
  keno: KENO_SLOTS,
  'prize-wheel': PRIZE_WHEEL_SLOTS,
  baccarat: BACCARAT_SLOTS,
  'gem-roll': GEM_ROLL_SLOTS,
  'fortune-teller': FORTUNE_TELLER_SLOTS,
  'lucky-cage': LUCKY_CAGE_SLOTS,
  'ring-toss': RING_TOSS_SLOTS,
  'mini-golf': MINI_GOLF_SLOTS,
  'bumper-cars': BUMPER_CARS_SLOTS,
  derby: DERBY_SLOTS,
  profile: PROFILE_SLOTS,
};

const _TYPING_MODES = [15, 30, 60] as const;

// fallow-ignore-next-line duplicate-export
export type TypingMode = (typeof _TYPING_MODES)[number];

export const isRewardGameType = (value: string): value is RewardGameType =>
  STORE_GAME_TYPES.includes(value as RewardGameType);

export const isCurrencyType = (value: string): value is CurrencyType =>
  value === 'credits';

export const isStoreRarity = (value: string): value is StoreRarity =>
  STORE_RARITY_ORDER.includes(value as StoreRarity);

export const getCurrencyDisplayName = (_value: CurrencyType): string =>
  PRIMARY_CURRENCY_NAME;

export const roundCreditsPrice = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(CREDIT_INCREMENT, Math.round(value / CREDIT_INCREMENT) * CREDIT_INCREMENT);
};

const _isGameSlotForType = (
  gameType: RewardGameType,
  slot: string,
): slot is GameSlot => GAME_SLOTS[gameType].includes(slot as GameSlot);
