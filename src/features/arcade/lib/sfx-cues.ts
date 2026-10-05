import type { SfxId } from './sfx-bank';

/* Which cues play a recorded sample instead of their procedural sound, and
   how loud. Tune here: no game code changes when a cue gets a sample or
   moves between them. A cue with a procedural sound in sound-manager.ts
   plays that until its bank has loaded, so the first hit is never silent;
   a cue with no procedural sound names one as its `fallback`.
   Samples come from sfx-bank.ts; see docs/ASSET_PROVENANCE.md. */

export type SampledCue = {
  sfx: SfxId;
  /** Gain on top of the sample's own level. Default 1. */
  volume?: number;
  /**
   * Random playback-rate spread, ± this fraction, when the caller sets no
   * pitch, so a sound heard many times a minute never repeats exactly.
   */
  jitter?: number;
  /** The procedural cue to play until the sample loads, when this cue has
   *  none of its own (a game-specific name for a shared sound). */
  fallback?: string;
};

export const SAMPLED_CUES: Record<string, SampledCue> = {
  // The house cues the wager games and settlements share.
  arcadeBet: { sfx: 'confirm', volume: 0.62 },
  arcadeReveal: { sfx: 'reveal', volume: 0.58 },
  arcadeWin: { sfx: 'win', volume: 0.66 },
  arcadeBigWin: { sfx: 'big-win', volume: 0.64 },
  // A loss sits just under a win: the lose sample is 4.5 dB hotter than
  // the win sample, so it plays at about half the win's volume.
  arcadeLose: { sfx: 'lose', volume: 0.36 },
  arcadeCashout: { sfx: 'cashout', volume: 0.62 },
  arcadeExplode: { sfx: 'impact', volume: 0.7 },
  arcadeCrash: { sfx: 'impact', volume: 0.7 },
  win: { sfx: 'win', volume: 0.66 },
  lose: { sfx: 'lose', volume: 0.36 },
  tetrisLevelUp: { sfx: 'level-up', volume: 0.64 },
  tetrisTSpin: { sfx: 'level-up', volume: 0.64 },
  coinStreakMilestone: { sfx: 'level-up', volume: 0.64 },
  achievementUnlock: { sfx: 'level-up', volume: 0.64 },
  accountLevelUp: { sfx: 'level-up', volume: 0.64 },

  // Tickets and the counter, on every page. Volumes start level with the
  // procedural sound each replaces (scripts/sfx/measure.ts), then the
  // moments that should stand out get a lift.
  printerTick: { sfx: 'ticket-tick', volume: 0.12, jitter: 0.05 },
  ticketTear: { sfx: 'ticket-tear', volume: 0.2 },
  registerDing: { sfx: 'register-ding', volume: 0.6 },
  wheelPeg: { sfx: 'wheel-tick', volume: 0.17 },

  // Skee-ball (ring roll).
  skeeWoodKnock: { sfx: 'skee-knock', volume: 0.21, jitter: 0.05 },
  skeeRimRattle: { sfx: 'skee-rim', volume: 0.1, jitter: 0.04 },
  skeeCupDrop: { sfx: 'skee-cup', volume: 0.38, jitter: 0.03 },
  skeeChute: { sfx: 'skee-return', volume: 0.1 },

  // High striker.
  strikerWhoosh: { sfx: 'striker-whoosh', volume: 0.1, jitter: 0.04 },
  strikerImpact: { sfx: 'striker-hit', volume: 0.62, jitter: 0.03 },
  strikerBell: { sfx: 'striker-bell', volume: 0.95 },
  strikerPuckLand: { sfx: 'striker-land', volume: 0.29, jitter: 0.04 },

  // Ring toss.
  ringToss: { sfx: 'ring-throw', volume: 0.08 },
  ringGlass: { sfx: 'ring-glass', volume: 0.3 },
  ringClink: { sfx: 'ring-glass', volume: 0.32 },
  ringWood: { sfx: 'ring-wood', volume: 0.33 },
  ringDown: { sfx: 'ring-ringer', volume: 0.3 },

  // Tin duck.
  duckPop: { sfx: 'duck-pop', volume: 0.63, jitter: 0.04 },
  duckClang: { sfx: 'duck-clang', volume: 0.59 },
  duckPock: { sfx: 'duck-pock', volume: 0.45, jitter: 0.05 },
  duckDry: { sfx: 'duck-dry', volume: 0.15 },
  duckReload: { sfx: 'duck-reload', volume: 0.14 },

  // Prize claw.
  clawClose: { sfx: 'claw-close', volume: 0.22 },
  clawChute: { sfx: 'claw-chute', volume: 0.17 },
  clawSlip: { sfx: 'claw-slip', volume: 0.13 },

  // Coin pusher. Its spill climbs a pitch ladder; samples follow it.
  pusherDrop: { sfx: 'pusher-drop', volume: 0.1 },
  pusherClink: { sfx: 'coin-clink', volume: 0.21 },
  pusherSpill: { sfx: 'pusher-spill', volume: 0.35 },

  // Lucky cage.
  cageCrank: { sfx: 'cage-crank', volume: 0.11 },
  cageChute: { sfx: 'cage-chute', volume: 0.25 },

  // Derby.
  derbyBell: { sfx: 'derby-bell', volume: 0.32 },

  // 8-ball. Plinko shares 'pocketed', so the table plays its own name.
  cueStrike: { sfx: 'pool-strike', volume: 0.32 },
  cushionHit: { sfx: 'pool-cushion', volume: 0.07 },
  poolPocket: { sfx: 'pool-pocket', volume: 0.86, fallback: 'pocketed' },

  // Bumper cars.
  bumperThud: { sfx: 'bumper-thud', volume: 0.74 },
  bumperBig: { sfx: 'bumper-crash', volume: 0.87 },
  bumperHorn: { sfx: 'bumper-horn', volume: 0.52 },

  // Slots: one clunk per reel, pitched by the reel.
  slotsClunk: { sfx: 'slot-stop', volume: 0.77 },

  // Boards: chess, checkers, four up.
  boardMove: { sfx: 'piece-place', volume: 0.45, jitter: 0.04 },
  boardCapture: { sfx: 'piece-capture', volume: 0.59 },
  connectFourDrop: { sfx: 'disc-drop', volume: 0.51 },

  // Mini golf.
  golfPutt: { sfx: 'golf-putt', volume: 0.33 },
  golfCup: { sfx: 'golf-cup', volume: 0.71 },

  // Ticket stop: the click climbs a pitch ladder.
  lockClick: { sfx: 'lock-click', volume: 0.5 },
  lockOpen: { sfx: 'lock-open', volume: 0.4 },

  // Stack.
  stackPlace: { sfx: 'block-thunk', volume: 0.44, jitter: 0.03 },
};
