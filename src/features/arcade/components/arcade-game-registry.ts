import {
  Axe,
  CarFront,
  Bird,
  Blocks,
  Bomb,
  Brain,
  Calculator,
  Cherry,
  CircleDot,
  CircleDotDashed,
  Club,
  Coins,
  Crosshair,
  Crown,
  Dice5,
  Disc3,
  Feather,
  Flag,
  Flame,
  Gem,
  Grid2x2,
  Grid3x3,
  Hammer,
  Hexagon,
  Keyboard,
  LayoutGrid,
  Layers,
  LineSquiggle,
  LockKeyhole,
  Navigation,
  Package,
  Rabbit,
  Rocket,
  Spade,
  Sparkles,
  Target,
  Ticket,
  Triangle,
  Truck,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { ArcadeEnamel } from '@/features/arcade/components/ui/arcade-ui';
import { getGameRename, getGameTitle, renameGameNamesInText } from '@/features/arcade/lib/game-renames';

export type ArcadeSectionId =
  | 'multiplayer'
  | 'casual'
  | 'competitive'
  | 'daily'
  | 'wager';
export type ArcadeDashboardSectionId = 'all' | ArcadeSectionId;

type ArcadeSectionDefinition = {
  id: ArcadeDashboardSectionId;
  label: string;
  description: string;
};

type ArcadeWagerSubsectionId =
  | 'quick-bets'
  | 'cash-out-runs'
  | 'board-grid'
  | 'cards-openings';

type ArcadeWagerSubsectionDefinition = {
  id: ArcadeWagerSubsectionId;
  label: string;
};

/* Rev. 2 floor groups, in the order they appear on the floor. */
export type ArcadeFloorGroupId =
  | 'with-friends'
  | 'boardwalk'
  | 'quick-play'
  | 'ticket-machines'
  | 'daily';

/* Where a game sits in the rev. 2 plan (docs/game-catalog.json).
   floor: on the main floor, in a group. reserve: off the floor, listed behind
   "more games". retired: scrapped, hidden from every list, route redirects
   or stays reachable by link. merged: folds into another game's slug. later:
   rebuilt after the relaunch, hidden until then. Nothing here deletes a route,
   a score, a purchase or a stored key. */
export type ArcadePlacement =
  | { status: 'floor'; group: ArcadeFloorGroupId }
  | { status: 'reserve'; group: ArcadeFloorGroupId }
  | { status: 'retired' }
  | { status: 'merged'; into: string }
  | { status: 'later'; group: ArcadeFloorGroupId };

export type ArcadeGameEntry = {
  slug: string;
  title: string;
  description: string;
  href: string;
  sectionId: ArcadeSectionId;
  wagerSubsectionId?: ArcadeWagerSubsectionId;
  icon: LucideIcon;
  routeLabel: string;
  mobileRouteLabel: string;
  arcadeHistoryType?: string;
  placement: ArcadePlacement;
};

/* Each floor section owns one enamel paint. */
export const ARCADE_SECTION_ENAMEL: Record<ArcadeSectionId, ArcadeEnamel> = {
  multiplayer: 'primary',
  casual: 'prize',
  competitive: 'info',
  daily: 'info',
  wager: 'tickets',
};

export const ARCADE_DASHBOARD_SECTIONS: ArcadeSectionDefinition[] = [
  {
    id: 'all',
    label: 'All games',
    description: 'Every game on the floor.',
  },
  {
    id: 'multiplayer',
    label: 'Multiplayer',
    description: 'Play friends or ranked opponents, live.',
  },
  {
    id: 'casual',
    label: 'Quick play',
    description: 'Short runs that chase your best.',
  },
  {
    id: 'competitive',
    label: 'Skill boards',
    description: 'Solo runs against the clock and the board.',
  },
  {
    id: 'daily',
    label: 'Daily puzzle',
    description: 'One new puzzle a day.',
  },
  {
    id: 'wager',
    label: 'Wagers',
    description: 'Machines that take a ticket bet and pay by their paytable.',
  },
];

export const ARCADE_SECTION_META: Record<ArcadeSectionId, ArcadeSectionDefinition> = {
  multiplayer: ARCADE_DASHBOARD_SECTIONS[1],
  casual: ARCADE_DASHBOARD_SECTIONS[2],
  competitive: ARCADE_DASHBOARD_SECTIONS[3],
  daily: ARCADE_DASHBOARD_SECTIONS[4],
  wager: ARCADE_DASHBOARD_SECTIONS[5],
};

export const ARCADE_WAGER_SUBSECTION_META: Record<
  ArcadeWagerSubsectionId,
  ArcadeWagerSubsectionDefinition
> = {
  'quick-bets': {
    id: 'quick-bets',
    label: 'Quick bets',
  },
  'cash-out-runs': {
    id: 'cash-out-runs',
    label: 'Cash-out runs',
  },
  'board-grid': {
    id: 'board-grid',
    label: 'Board & grid',
  },
  'cards-openings': {
    id: 'cards-openings',
    label: 'Cards & cases',
  },
};

const RAW_ARCADE_GAMES: ArcadeGameEntry[] = [
  {
    slug: 'typing-duel',
    title: 'Typing Duel',
    description: 'Race another player on the same seed with server-verified keystrokes.',
    href: '/typing-test/duel',
    sectionId: 'multiplayer',
    icon: Keyboard,
    routeLabel: 'Typing Duel',
    mobileRouteLabel: 'Duel',
    placement: { status: 'reserve', group: 'with-friends' },
  },
  {
    slug: 'reaction-time',
    title: 'Reaction Time',
    description: 'Hit the panel the instant it lights.',
    href: '/reaction-time',
    sectionId: 'casual',
    icon: Target,
    routeLabel: 'Reaction',
    mobileRouteLabel: 'React',
    placement: { status: 'merged', into: 'ticket-stop' },
  },
  {
    slug: 'flappy-bird',
    title: 'Flappy Bird',
    description: 'Flap through the gaps in the pipes.',
    href: '/flappy-bird',
    sectionId: 'casual',
    icon: Bird,
    routeLabel: 'Flappy',
    mobileRouteLabel: 'Flappy',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: 'snake',
    title: 'Snake',
    description: 'Eat, grow longer and never hit your own tail.',
    href: '/snake',
    sectionId: 'casual',
    icon: LineSquiggle,
    routeLabel: 'Snake',
    mobileRouteLabel: 'Snake',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: '2048',
    title: '2048',
    description: 'Slide the tiles to merge pairs until one reads 2048.',
    href: '/2048',
    sectionId: 'casual',
    icon: Grid2x2,
    routeLabel: '2048',
    mobileRouteLabel: '2048',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: 'coin-flip',
    title: 'Coin Flip',
    description: 'Call heads or tails and flip.',
    href: '/coin-flip',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Coins,
    routeLabel: 'Coin Flip',
    mobileRouteLabel: 'Coin',
    arcadeHistoryType: 'arcade-coin-flip',
    placement: { status: 'reserve', group: 'ticket-machines' },
  },
  {
    slug: 'typing-test',
    title: 'Typing Test',
    description: 'Type the passage as fast and clean as you can.',
    href: '/typing-test',
    sectionId: 'competitive',
    icon: Keyboard,
    routeLabel: 'Typing',
    mobileRouteLabel: 'Typing',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'tetris',
    title: 'Tetris',
    description: 'Clear lines as the blocks fall faster.',
    href: '/tetris',
    sectionId: 'competitive',
    icon: Grid2x2,
    routeLabel: 'Tetris',
    mobileRouteLabel: 'Tetris',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'connections',
    title: 'Connections',
    description: 'Sort the daily 16 words into four sets of four.',
    href: '/connections',
    sectionId: 'daily',
    icon: LayoutGrid,
    routeLabel: 'Connections',
    mobileRouteLabel: 'Connect',
    placement: { status: 'retired' },
  },
  {
    slug: '8-ball',
    title: '8-Ball Pool',
    description: 'Ranked pool against a friend or a bot.',
    href: '/8-ball',
    sectionId: 'multiplayer',
    icon: CircleDot,
    routeLabel: '8-Ball',
    mobileRouteLabel: '8-Ball',
    placement: { status: 'floor', group: 'with-friends' },
  },
  {
    slug: 'chess',
    title: 'Chess',
    description: 'Ranked, timed chess against a friend or a bot.',
    href: '/chess',
    sectionId: 'multiplayer',
    icon: Crown,
    routeLabel: 'Chess',
    mobileRouteLabel: 'Chess',
    placement: { status: 'floor', group: 'with-friends' },
  },
  {
    slug: 'mines',
    title: 'Mines',
    description: 'Turn tiles for gems and cash out before you hit a mine.',
    href: '/mines',
    sectionId: 'wager',
    wagerSubsectionId: 'board-grid',
    icon: Bomb,
    routeLabel: 'Mines',
    mobileRouteLabel: 'Mines',
    arcadeHistoryType: 'arcade-mines',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'slots',
    title: 'Slots',
    description: 'Spin three reels across five paylines.',
    href: '/slots',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Cherry,
    routeLabel: 'Slots',
    mobileRouteLabel: 'Slots',
    arcadeHistoryType: 'arcade-slots',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'crash',
    title: 'Crash',
    description: 'Ride the rising multiplier and cash out before it crashes.',
    href: '/crash',
    sectionId: 'wager',
    wagerSubsectionId: 'cash-out-runs',
    icon: Rocket,
    routeLabel: 'Crash',
    mobileRouteLabel: 'Crash',
    arcadeHistoryType: 'arcade-crash',
    placement: { status: 'reserve', group: 'ticket-machines' },
  },
  {
    slug: 'derby',
    title: 'Derby',
    description:
      'Up to 8 players keep a water jet on a moving target, and the water on target runs your horse. First to the wire wins.',
    href: '/derby',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Flag,
    routeLabel: 'Derby',
    mobileRouteLabel: 'Derby',
    arcadeHistoryType: 'arcade-derby',
    placement: { status: 'floor', group: 'with-friends' },
  },
  {
    slug: 'stoplight',
    title: 'Lucky Wheel',
    description: 'Spin the wheel for up to 25×.',
    href: '/stoplight',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: CircleDot,
    routeLabel: 'Wheel',
    mobileRouteLabel: 'Wheel',
    arcadeHistoryType: 'arcade-stoplight',
    placement: { status: 'merged', into: 'prize-wheel' },
  },
  {
    slug: 'plinko',
    title: 'Plinko',
    description: 'Drop a ball through the pegs. The slot it lands in pays.',
    href: '/plinko',
    sectionId: 'wager',
    wagerSubsectionId: 'board-grid',
    icon: Triangle,
    routeLabel: 'Plinko',
    mobileRouteLabel: 'Plinko',
    arcadeHistoryType: 'arcade-plinko',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'keno',
    title: 'Keno',
    description: 'Pick up to ten numbers. The more the draw matches, the more it pays.',
    href: '/keno',
    sectionId: 'wager',
    wagerSubsectionId: 'board-grid',
    icon: Grid3x3,
    routeLabel: 'Keno',
    mobileRouteLabel: 'Keno',
    arcadeHistoryType: 'arcade-keno',
    placement: { status: 'retired' },
  },
  {
    slug: 'lucky-cage',
    title: 'Lucky Cage',
    description: "Pick a ticket and crank the cage. Five of 20 balls drop, and your ticket comes in or it doesn't.",
    href: '/lucky-cage',
    sectionId: 'wager',
    wagerSubsectionId: 'board-grid',
    icon: Ticket,
    routeLabel: 'Lucky Cage',
    mobileRouteLabel: 'Cage',
    arcadeHistoryType: 'arcade-lucky-cage',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'coin-pusher',
    title: 'Coin Pusher',
    description: 'Drop coins onto two moving shelves and push them into the tray. Your machine keeps its coins between visits.',
    href: '/coin-pusher',
    sectionId: 'wager',
    wagerSubsectionId: 'board-grid',
    icon: Coins,
    routeLabel: 'Coin Pusher',
    mobileRouteLabel: 'Pusher',
    arcadeHistoryType: 'arcade-coin-pusher',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'dice',
    title: 'Dice',
    description: 'Set a number, call over or under, and roll.',
    href: '/dice',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Dice5,
    routeLabel: 'Dice',
    mobileRouteLabel: 'Dice',
    arcadeHistoryType: 'arcade-dice',
    placement: { status: 'reserve', group: 'ticket-machines' },
  },
  {
    slug: 'chicken',
    title: 'Crossy Chicken',
    description: "Cross a lane at a time and cash out before you're hit.",
    href: '/chicken',
    sectionId: 'wager',
    wagerSubsectionId: 'cash-out-runs',
    icon: Truck,
    routeLabel: 'Chicken',
    mobileRouteLabel: 'Chicken',
    arcadeHistoryType: 'arcade-chicken',
    placement: { status: 'retired' },
  },
  {
    slug: 'hilo',
    title: 'Hi-Lo',
    description: 'Call the next card higher or lower.',
    href: '/hilo',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Club,
    routeLabel: 'Hi-Lo',
    mobileRouteLabel: 'Hi-Lo',
    arcadeHistoryType: 'arcade-hilo',
    placement: { status: 'retired' },
  },
  {
    slug: '21',
    title: '21',
    description: 'Hit or stand against the dealer. Blackjack pays 3 to 2.',
    href: '/21',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Spade,
    routeLabel: '21',
    mobileRouteLabel: '21',
    arcadeHistoryType: 'arcade-blackjack',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'cases',
    title: 'Cases',
    description: 'Open a case for the multiplier inside.',
    href: '/cases',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Package,
    routeLabel: 'Cases',
    mobileRouteLabel: 'Cases',
    arcadeHistoryType: 'arcade-cases',
    placement: { status: 'retired' },
  },
  {
    slug: 'baccarat',
    title: 'Baccarat',
    description: 'Bet on player, banker or a tie, and the cards deal themselves.',
    href: '/baccarat',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Spade,
    routeLabel: 'Baccarat',
    mobileRouteLabel: 'Baccarat',
    arcadeHistoryType: 'arcade-baccarat',
    placement: { status: 'retired' },
  },
  {
    slug: 'fortune-teller',
    title: 'Fortune Teller',
    description: 'Turn three cards. Their multipliers compound, and one bust ends it.',
    href: '/fortune-teller',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Sparkles,
    routeLabel: 'Fortune Teller',
    mobileRouteLabel: 'Fortune',
    arcadeHistoryType: 'arcade-fortune-teller',
    placement: { status: 'retired' },
  },
  {
    slug: 'packs',
    title: 'Packs',
    description: 'Open a five-card pack. The rarer the cards, the more it pays.',
    href: '/packs',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Layers,
    routeLabel: 'Packs',
    mobileRouteLabel: 'Packs',
    arcadeHistoryType: 'arcade-packs',
    placement: { status: 'retired' },
  },
  {
    slug: 'darts',
    title: 'Darts',
    description: 'One throw. A bullseye pays the most.',
    href: '/darts',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Target,
    routeLabel: 'Darts',
    mobileRouteLabel: 'Darts',
    arcadeHistoryType: 'arcade-darts',
    placement: { status: 'retired' },
  },
  {
    slug: 'prize-claw',
    title: 'Prize Claw',
    description:
      'Park the claw over a prize and drop. Your aim sets the grip.',
    href: '/prize-claw',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Crosshair,
    routeLabel: 'Prize Claw',
    mobileRouteLabel: 'Claw',
    arcadeHistoryType: 'arcade-prize-claw',
    placement: { status: 'floor', group: 'boardwalk' },
  },
  {
    slug: 'lightspeed',
    title: 'Lightspeed',
    description: 'Pick a lane at every jump and cash out before you crash.',
    href: '/lightspeed',
    sectionId: 'wager',
    wagerSubsectionId: 'cash-out-runs',
    icon: Zap,
    routeLabel: 'Lightspeed',
    mobileRouteLabel: 'Light',
    arcadeHistoryType: 'arcade-lightspeed',
    placement: { status: 'retired' },
  },
  {
    slug: 'limbo',
    title: 'Limbo',
    description: 'Set a multiplier. The rocket pays if it climbs past it.',
    href: '/limbo',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Rocket,
    routeLabel: 'Limbo',
    mobileRouteLabel: 'Limbo',
    arcadeHistoryType: 'arcade-limbo',
    placement: { status: 'retired' },
  },
  {
    slug: 'dragon',
    title: 'Dragon Tower',
    description: 'Climb a row at a time, miss the eggs, and cash out before you fall.',
    href: '/dragon',
    sectionId: 'wager',
    wagerSubsectionId: 'cash-out-runs',
    icon: Flame,
    routeLabel: 'Dragon Tower',
    mobileRouteLabel: 'Dragon',
    arcadeHistoryType: 'arcade-dragon',
    placement: { status: 'retired' },
  },
  {
    slug: 'video-poker',
    title: 'Video Poker',
    description: 'Deal five, hold what you want and draw. Jacks or better pays.',
    href: '/video-poker',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Spade,
    routeLabel: 'Video Poker',
    mobileRouteLabel: 'Poker',
    arcadeHistoryType: 'arcade-video-poker',
    placement: { status: 'floor', group: 'ticket-machines' },
  },
  {
    slug: 'roulette',
    title: 'Roulette',
    description: 'Place chips on the felt and spin a single-zero wheel.',
    href: '/roulette',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: CircleDot,
    routeLabel: 'Roulette',
    mobileRouteLabel: 'Roulette',
    arcadeHistoryType: 'arcade-roulette',
    placement: { status: 'reserve', group: 'ticket-machines' },
  },
  {
    slug: 'prize-wheel',
    title: 'Prize Wheel',
    description: 'Spin the wheel. It pays the multiplier it stops on.',
    href: '/prize-wheel',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Disc3,
    routeLabel: 'Prize Wheel',
    mobileRouteLabel: 'Wheel',
    arcadeHistoryType: 'arcade-prize-wheel',
    placement: { status: 'reserve', group: 'ticket-machines' },
  },
  {
    slug: 'gem-roll',
    title: 'Gem Roll',
    description: 'Roll five gems. Matching colours pay like poker hands.',
    href: '/gem-roll',
    sectionId: 'wager',
    wagerSubsectionId: 'quick-bets',
    icon: Gem,
    routeLabel: 'Gem Roll',
    mobileRouteLabel: 'Gems',
    arcadeHistoryType: 'arcade-gem-roll',
    placement: { status: 'retired' },
  },
  {
    slug: 'scratch',
    title: 'Scratch Cards',
    description: 'Scratch the card. Three of a symbol pays its multiplier.',
    href: '/scratch',
    sectionId: 'wager',
    wagerSubsectionId: 'cards-openings',
    icon: Ticket,
    routeLabel: 'Scratch Cards',
    mobileRouteLabel: 'Scratch',
    arcadeHistoryType: 'arcade-scratch',
    placement: { status: 'retired' },
  },
  {
    slug: 'pump',
    title: 'Pump',
    description: 'Pump the balloon to raise the multiplier, and cash out before it pops.',
    href: '/pump',
    sectionId: 'wager',
    wagerSubsectionId: 'cash-out-runs',
    icon: Wind,
    routeLabel: 'Pump',
    mobileRouteLabel: 'Pump',
    arcadeHistoryType: 'arcade-pump',
    placement: { status: 'retired' },
  },
  {
    slug: 'word-grid',
    title: 'Word Grid',
    description: 'Crack the daily five-letter word in six guesses.',
    href: '/word-grid',
    sectionId: 'daily',
    icon: Grid3x3,
    routeLabel: 'Word Grid',
    mobileRouteLabel: 'Word',
    placement: { status: 'floor', group: 'daily' },
  },
  {
    slug: 'trick-shot',
    title: 'Trick Shot',
    description: 'One pool table a day. Clear it in the fewest tries, with friends on one card.',
    href: '/trick-shot',
    sectionId: 'daily',
    icon: CircleDotDashed,
    routeLabel: 'Trick Shot',
    mobileRouteLabel: 'Trick',
    placement: { status: 'floor', group: 'daily' },
  },
  {
    slug: 'mini-golf',
    title: 'Mini Golf',
    description: 'Nine boardwalk holes, a new course each day, friends on one scorecard.',
    href: '/mini-golf',
    sectionId: 'daily',
    icon: Flag,
    routeLabel: 'Mini Golf',
    mobileRouteLabel: 'Golf',
    placement: { status: 'floor', group: 'daily' },
  },
  {
    slug: 'pangram',
    title: 'Pangram',
    description: 'Build as many words as you can from seven daily letters.',
    href: '/pangram',
    sectionId: 'daily',
    icon: Hexagon,
    routeLabel: 'Pangram',
    mobileRouteLabel: 'Hex',
    placement: { status: 'reserve', group: 'daily' },
  },
  {
    slug: 'breakout',
    title: 'Breakout',
    description: 'Bounce the ball to clear every brick.',
    href: '/breakout',
    sectionId: 'casual',
    icon: Blocks,
    routeLabel: 'Breakout',
    mobileRouteLabel: 'Breakout',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'stack',
    title: 'Stack',
    description: 'Drop each sliding block to build the tower as high as you can.',
    href: '/stack',
    sectionId: 'casual',
    icon: Layers,
    routeLabel: 'Stack',
    mobileRouteLabel: 'Stack',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: 'sequence',
    title: 'Sequence Memory',
    description: 'Watch the growing pattern of pad flashes, then repeat it from memory.',
    href: '/sequence',
    sectionId: 'casual',
    icon: Brain,
    routeLabel: 'Sequence',
    mobileRouteLabel: 'Sequence',
    placement: { status: 'retired' },
  },
  {
    slug: 'ticket-stop',
    title: 'Ticket Stop',
    description: 'Stop the light in the amber window. Three rounds, each one faster.',
    href: '/ticket-stop',
    sectionId: 'casual',
    icon: CircleDotDashed,
    routeLabel: 'Ticket Stop',
    mobileRouteLabel: 'Stop',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: 'tumbler',
    title: 'Tumbler',
    description: 'Tap as the marker crosses the gold notch. It speeds up, and one miss ends the run.',
    href: '/tumbler',
    sectionId: 'casual',
    icon: LockKeyhole,
    routeLabel: 'Tumbler',
    mobileRouteLabel: 'Tumbler',
    placement: { status: 'merged', into: 'ticket-stop' },
  },
  {
    slug: 'high-striker',
    title: 'High Striker',
    description: 'Let go with the fill at the top to clear the line. Each swing is quicker, and one miss ends the run.',
    href: '/high-striker',
    sectionId: 'casual',
    icon: Hammer,
    routeLabel: 'High Striker',
    mobileRouteLabel: 'Striker',
    placement: { status: 'floor', group: 'boardwalk' },
  },
  {
    slug: 'skee-ball',
    title: 'Skee-Ball',
    description: 'Drag back and let go to roll up the ramp. Nine balls a frame, and the corner pockets pay 100.',
    href: '/skee-ball',
    sectionId: 'casual',
    icon: CircleDot,
    routeLabel: 'Skee-Ball',
    mobileRouteLabel: 'Skee-Ball',
    placement: { status: 'floor', group: 'boardwalk' },
  },
  {
    slug: 'knife-booth',
    title: 'Knife Booth',
    description: 'Throw knives into a spinning target. Hit a knife already in it and the run ends.',
    href: '/knife-booth',
    sectionId: 'casual',
    icon: Target,
    routeLabel: 'Knife Booth',
    mobileRouteLabel: 'Knife Booth',
    placement: { status: 'retired' },
  },
  {
    slug: 'melon-chop',
    title: 'Melon Chop',
    description: 'Swipe to slice fruit for 60 seconds. A bomb ends the run.',
    href: '/melon-chop',
    sectionId: 'casual',
    icon: Cherry,
    routeLabel: 'Melon Chop',
    mobileRouteLabel: 'Melon Chop',
    placement: { status: 'retired' },
  },
  {
    slug: 'tin-duck',
    title: 'Tin Duck Gallery',
    description: 'Shoot tin ducks for 75 seconds. Small, fast ducks score more, and gold ones score most.',
    href: '/tin-duck',
    sectionId: 'casual',
    icon: Crosshair,
    routeLabel: 'Tin Duck',
    mobileRouteLabel: 'Tin Duck',
    placement: { status: 'floor', group: 'boardwalk' },
  },
  {
    slug: 'ring-toss',
    title: 'Ring Toss',
    description: 'Flick rings onto a crate of bottles. Ten rings in 30 seconds, back rows pay more, and the gold bottle pays 100.',
    href: '/ring-toss',
    sectionId: 'casual',
    icon: Disc3,
    routeLabel: 'Ring Toss',
    mobileRouteLabel: 'Ring Toss',
    placement: { status: 'floor', group: 'boardwalk' },
  },
  {
    slug: 'boardwalk-hop',
    title: 'Boardwalk Hop',
    description: 'Hop the boardwalk a row at a time. Dodge the carts, ride the logs and keep moving.',
    href: '/boardwalk-hop',
    sectionId: 'casual',
    icon: Rabbit,
    routeLabel: 'Boardwalk Hop',
    mobileRouteLabel: 'Boardwalk',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'gopher',
    title: 'Gopher Pop',
    description: 'Bonk the gophers for 60 seconds. Leave the bombs alone.',
    href: '/gopher',
    sectionId: 'casual',
    icon: Hammer,
    routeLabel: 'Gopher Pop',
    mobileRouteLabel: 'Gopher Pop',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'ricochet',
    title: 'Ricochet',
    description: 'Flap between two spiked walls through the gap in each. Every wall is a point, and a little faster.',
    href: '/ricochet',
    sectionId: 'casual',
    icon: Feather,
    routeLabel: 'Ricochet',
    mobileRouteLabel: 'Ricochet',
    placement: { status: 'floor', group: 'quick-play' },
  },
  {
    slug: 'bumper-cars',
    title: 'Bumper Cars',
    description: 'Four to eight cars, 90-second rounds, most bumps wins. Bots fill the empty seats.',
    href: '/bumper-cars',
    sectionId: 'multiplayer',
    icon: CarFront,
    routeLabel: 'Bumper Cars',
    mobileRouteLabel: 'Bumper',
    placement: { status: 'floor', group: 'with-friends' },
  },
  {
    slug: 'swerve',
    title: 'Swerve',
    description: 'Steer a cart down a 3-lane chute and dodge the blocks. Each row you pass is a point.',
    href: '/swerve',
    sectionId: 'casual',
    icon: Navigation,
    routeLabel: 'Swerve',
    mobileRouteLabel: 'Swerve',
    placement: { status: 'retired' },
  },
  {
    slug: 'gunrush',
    title: 'Gunrush',
    description: 'Lead a squad of tin gunners down the boardwalk. Pick the gates that grow it, and hold off a horde every fifth row.',
    href: '/gunrush',
    sectionId: 'casual',
    icon: Crosshair,
    routeLabel: 'Gunrush',
    mobileRouteLabel: 'Gunrush',
    placement: { status: 'retired' },
  },
  {
    slug: 'sudoku',
    title: 'Sudoku',
    description: 'Fill the 9×9 grid against the clock.',
    href: '/sudoku',
    sectionId: 'competitive',
    icon: Grid3x3,
    routeLabel: 'Sudoku',
    mobileRouteLabel: 'Sudoku',
    placement: { status: 'retired' },
  },
  {
    slug: 'punch-card',
    title: 'Punch Card',
    description: 'Use the row and column clues to punch out a hidden picture.',
    href: '/punch-card',
    sectionId: 'competitive',
    icon: LayoutGrid,
    routeLabel: 'Punch Card',
    mobileRouteLabel: 'Punch Card',
    placement: { status: 'reserve', group: 'daily' },
  },
  {
    slug: 'freecell',
    title: 'FreeCell Sprint',
    description: 'Clear a FreeCell deal against the clock. Every deal can be solved.',
    href: '/freecell',
    sectionId: 'competitive',
    icon: Spade,
    routeLabel: 'FreeCell Sprint',
    mobileRouteLabel: 'FreeCell',
    placement: { status: 'retired' },
  },
  {
    slug: 'math',
    title: 'Mental Math Sprint',
    description: 'Solve as many arithmetic problems as you can in sixty seconds.',
    href: '/math',
    sectionId: 'competitive',
    icon: Calculator,
    routeLabel: 'Math Sprint',
    mobileRouteLabel: 'Math',
    placement: { status: 'retired' },
  },
  {
    slug: 'blitz-tactics',
    title: 'Blitz Tactics',
    description: 'Solve as many mate puzzles as you can in five minutes. Three misses end the run.',
    href: '/blitz-tactics',
    sectionId: 'competitive',
    icon: Zap,
    routeLabel: 'Blitz Tactics',
    mobileRouteLabel: 'Tactics',
    placement: { status: 'retired' },
  },
  {
    slug: 'connect-four',
    title: 'Connect Four',
    description: 'Drop discs to get four in a row, against a friend or a bot.',
    href: '/connect-four',
    sectionId: 'multiplayer',
    icon: Grid2x2,
    routeLabel: 'Connect 4',
    mobileRouteLabel: 'Connect 4',
    placement: { status: 'floor', group: 'with-friends' },
  },
  {
    slug: 'checkers',
    title: 'Checkers',
    description: 'Ranked checkers. Captures are forced, and kings move both ways.',
    href: '/checkers',
    sectionId: 'multiplayer',
    icon: Disc3,
    routeLabel: 'Checkers',
    mobileRouteLabel: 'Checkers',
    placement: { status: 'retired' },
  },
  {
    slug: 'reversi',
    title: 'Reversi',
    description: 'Flank discs to flip them, against a friend or a bot.',
    href: '/reversi',
    sectionId: 'multiplayer',
    icon: CircleDot,
    routeLabel: 'Reversi',
    mobileRouteLabel: 'Reversi',
    placement: { status: 'retired' },
  },
  {
    slug: 'battleship',
    title: 'Battleship',
    description: 'Hide your fleet and call shots. Sink theirs first.',
    href: '/battleship',
    sectionId: 'multiplayer',
    icon: Navigation,
    routeLabel: 'Battleship',
    mobileRouteLabel: 'Battleship',
    placement: { status: 'reserve', group: 'with-friends' },
  },
  {
    slug: 'bubble-shooter',
    title: 'Gumball Drop',
    description: 'Drop gumballs into the jar. Two alike merge into a bigger one, and an overflow ends the run.',
    href: '/bubble-shooter',
    sectionId: 'casual',
    icon: CircleDot,
    routeLabel: 'Gumball Drop',
    mobileRouteLabel: 'Gumball',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'gem-swap',
    title: 'Gem Swap',
    description: 'Swap gems to line up three or more in 60 seconds.',
    href: '/gem-swap',
    sectionId: 'casual',
    icon: Hexagon,
    routeLabel: 'Gem Swap',
    mobileRouteLabel: 'Gems',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'sky-climber',
    title: 'Sky Climber',
    description: 'Steer a jumper from platform to platform and climb as high as you can.',
    href: '/sky-climber',
    sectionId: 'casual',
    icon: Rocket,
    routeLabel: 'Sky Climber',
    mobileRouteLabel: 'Climb',
    placement: { status: 'retired' },
  },
  {
    slug: 'minesweeper',
    title: 'Minesweeper',
    description: 'Clear every safe tile without hitting a mine.',
    href: '/minesweeper',
    sectionId: 'competitive',
    icon: Bomb,
    routeLabel: 'Minesweeper',
    mobileRouteLabel: 'Mines',
    placement: { status: 'reserve', group: 'quick-play' },
  },
  {
    slug: 'log-splitter',
    title: 'Log Splitter',
    description: 'Chop left or right and keep clear of the branches. The clock drains, and a branch ends the run.',
    href: '/log-splitter',
    sectionId: 'casual',
    icon: Axe,
    routeLabel: 'Log Splitter',
    mobileRouteLabel: 'Splitter',
    placement: { status: 'retired' },
  },
  {
    slug: 'air-hockey',
    title: 'Air Hockey',
    description: 'Air hockey on one screen or against the computer. First to seven wins.',
    href: '/air-hockey',
    sectionId: 'casual',
    icon: CircleDot,
    routeLabel: 'Air Hockey',
    mobileRouteLabel: 'Hockey',
    placement: { status: 'reserve', group: 'with-friends' },
  },
];

/* The games as players see them. While the rename map is off this is the raw
   list, untouched. When it is on, only the display fields change (title,
   description, nav labels): slug, href, sectionId and arcadeHistoryType are
   stored keys and stay, and the old href still matches the page. */
export const ARCADE_GAMES: ArcadeGameEntry[] = RAW_ARCADE_GAMES.map((game) => {
  if (!getGameRename(game.slug)) return game;
  const title = getGameTitle(game.slug, game.title);
  return {
    ...game,
    title,
    description: renameGameNamesInText(game.description),
    routeLabel: title,
    mobileRouteLabel: title,
  };
});

const ARCADE_GAMES_BY_SLUG = Object.fromEntries(
  ARCADE_GAMES.map((game) => [game.slug, game]),
) as Record<string, ArcadeGameEntry>;

export function getArcadeGameBySlug(slug: string) {
  return ARCADE_GAMES_BY_SLUG[slug] ?? null;
}

export type ArcadeFloorGroup = {
  id: ArcadeFloorGroupId;
  /* Lowercase, as shown to players. */
  label: string;
  /* 0-based position on the floor. */
  order: number;
};

export const ARCADE_FLOOR_GROUPS: readonly ArcadeFloorGroup[] = [
  { id: 'with-friends', label: 'with friends', order: 0 },
  { id: 'boardwalk', label: 'boardwalk', order: 1 },
  { id: 'quick-play', label: 'quick play', order: 2 },
  { id: 'ticket-machines', label: 'ticket machines', order: 3 },
  { id: 'daily', label: 'daily', order: 4 },
];

export const ARCADE_FLOOR_GROUP_META = Object.fromEntries(
  ARCADE_FLOOR_GROUPS.map((group) => [group.id, group]),
) as Record<ArcadeFloorGroupId, ArcadeFloorGroup>;

/* The floor, group by group, in PLAN.md's table order. Each slug must be an
   entry in ARCADE_GAMES whose placement is floor in that group; the registry
   verifier (npm run test:floor-registry) checks this both ways. */
const FLOOR_ORDER: Record<ArcadeFloorGroupId, readonly string[]> = {
  'with-friends': ['8-ball', 'chess', 'connect-four', 'bumper-cars', 'derby'],
  boardwalk: ['skee-ball', 'high-striker', 'prize-claw', 'tin-duck', 'ring-toss'],
  'quick-play': [
    'snake',
    '2048',
    'stack',
    'ricochet',
    'ticket-stop',
    'flappy-bird',
  ],
  'ticket-machines': ['21', 'plinko', 'mines', 'video-poker', 'slots', 'lucky-cage', 'coin-pusher'],
  daily: ['word-grid', 'mini-golf', 'trick-shot'],
};

/* "more games" is off the floor for now: the reserve games come back there
   once they are rebuilt. Their routes, scores and boards stay as they are. */
export const RESERVE_ON_FLOOR = false;

/* The reserve list behind "more games", in PLAN.md's reserve order. */
const RESERVE_ORDER: readonly string[] = [
  'crash',
  'typing-test',
  'typing-duel',
  'tetris',
  'breakout',
  'minesweeper',
  'gem-swap',
  'bubble-shooter',
  'boardwalk-hop',
  'gopher',
  'air-hockey',
  'battleship',
  'pangram',
  'punch-card',
  'roulette',
  'dice',
  'coin-flip',
  'prize-wheel',
];

function entriesFor(slugs: readonly string[]): ArcadeGameEntry[] {
  return slugs
    .map((slug) => ARCADE_GAMES_BY_SLUG[slug])
    .filter((game): game is ArcadeGameEntry => Boolean(game));
}

export function getGamePlacement(slug: string): ArcadePlacement | null {
  return ARCADE_GAMES_BY_SLUG[slug]?.placement ?? null;
}

export function isOnFloor(slug: string): boolean {
  return getGamePlacement(slug)?.status === 'floor';
}

export function isInReserve(slug: string): boolean {
  return getGamePlacement(slug)?.status === 'reserve';
}

/* A game players can find in a list: on the floor or in the reserve.
   Retired, merged and later games are hidden from lists but keep their routes,
   scores, leaderboards, inventory and store items. */
export function isGameListed(slug: string): boolean {
  const status = getGamePlacement(slug)?.status;
  return status === 'floor' || status === 'reserve';
}

export function getFloorGroups(): { group: ArcadeFloorGroup; games: ArcadeGameEntry[] }[] {
  return ARCADE_FLOOR_GROUPS.map((group) => ({
    group,
    games: entriesFor(FLOOR_ORDER[group.id]),
  }));
}

/* Every floor game, flat, in group order. */
export function getFloorGames(): ArcadeGameEntry[] {
  return getFloorGroups().flatMap(({ games }) => games);
}

export function getReserveGames(): ArcadeGameEntry[] {
  return entriesFor(RESERVE_ORDER);
}

/* Floor games first, then the reserve: everything a list or search may show. */
export function getListedGames(): ArcadeGameEntry[] {
  return [...getFloorGames(), ...getReserveGames()];
}
