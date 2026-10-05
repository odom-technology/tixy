import type { SfxSpec } from './types';

/* Every sampled sound on tixy. A prompt names one physical event: the
   material, the action, the space. The boardwalk sounds like wood, tin,
   paper, coins and bells, so prompts ask for those and never for chiptune.
   "close mic, dry" keeps room tone out; `shape.slice` keeps the one hit
   when a take holds several. Which cue plays a sound, and how loud, is
   sfx-cues.ts. */

const DRY = 'close mic, dry, isolated, no music, no background';

export const SFX_CATALOG: SfxSpec[] = [
  // ---- core: on every page, loaded on the first gesture ----------------
  { id: 'confirm', bank: 'core', file: 'audio/arcade/confirm.mp3' },
  { id: 'reveal', bank: 'core', file: 'audio/arcade/reveal.mp3' },
  { id: 'win', bank: 'core', file: 'audio/arcade/win.mp3' },
  { id: 'big-win', bank: 'core', file: 'audio/arcade/big-win.mp3' },
  { id: 'lose', bank: 'core', file: 'audio/arcade/lose.mp3' },
  { id: 'cashout', bank: 'core', file: 'audio/arcade/cashout.mp3' },
  { id: 'impact', bank: 'core', file: 'audio/arcade/impact.mp3' },
  { id: 'level-up', bank: 'core', file: 'audio/arcade/level-up.mp3' },
  {
    id: 'ticket-tick', bank: 'core', seconds: 0.5, takes: 4, pick: [1, 2],
    prompt: `single soft click of an arcade ticket dispenser pushing out one paper ticket, tiny mechanism, ${DRY}`,
    shape: { slice: true, attackDb: -12, maxMs: 100, fadeMs: 30, levelDb: -20 },
  },
  {
    id: 'ticket-feed', bank: 'core', pick: [1], seconds: 1.2,
    prompt: `arcade ticket dispenser feeding out a long strip of paper tickets, quick motor whirr and paper flutter, ${DRY}`,
    shape: { maxMs: 1100, fadeMs: 120, levelDb: -20 },
  },
  {
    id: 'ticket-tear', bank: 'core', pick: [0], seconds: 0.6,
    prompt: `tearing one perforated paper ticket off a strip, quick crisp paper rip, ${DRY}`,
    shape: { slice: true, maxMs: 380, fadeMs: 60, levelDb: -18 },
  },
  {
    id: 'register-ding', bank: 'core', pick: [2], seconds: 1.5,
    prompt: `old brass cash register bell, one bright ding ringing out, ${DRY}`,
    shape: { slice: true, maxMs: 1400, fadeMs: 300, levelDb: -18 },
  },
  {
    id: 'coin-clink', bank: 'core', seconds: 0.5, takes: 4, pick: [0, 1, 2],
    prompt: `one metal coin dropped onto a small pile of coins, single bright clink, ${DRY}`,
    shape: { slice: true, maxMs: 350, fadeMs: 80, levelDb: -18 },
  },
  {
    id: 'coin-pour', bank: 'core', pick: [0], seconds: 1.6,
    prompt: `a handful of coins pouring into a metal tray, a short cascade of clinks that settles, ${DRY}`,
    shape: { maxMs: 1500, fadeMs: 250, levelDb: -17 },
  },
  {
    id: 'ui-tap', bank: 'core', seconds: 0.5, takes: 4, pick: [0, 1],
    prompt: `pressing a chunky plastic arcade push button, one short soft click, ${DRY}`,
    shape: { slice: true, maxMs: 90, fadeMs: 25, levelDb: -22 },
  },
  {
    id: 'whoosh', bank: 'core', pick: [0], seconds: 0.6,
    prompt: `airy whoosh swell, a soft broad swish of air passing quickly, ${DRY}`,
    shape: { maxMs: 450, fadeMs: 120, levelDb: -22 },
  },
  {
    id: 'prize-bell', bank: 'boardwalk', pick: [2], seconds: 1.5,
    prompt: `carnival game booth winner, a small brass hand bell rung three times quickly, ${DRY}`,
    shape: { maxMs: 1500, fadeMs: 300, levelDb: -17 },
  },
  {
    id: 'crowd-cheer', bank: 'boardwalk', pick: [2], seconds: 2.5,
    prompt: 'small crowd at a boardwalk carnival booth cheering and clapping for a winner, short burst, outdoors',
    shape: { maxMs: 2400, fadeMs: 700, levelDb: -20 },
  },
  {
    id: 'crowd-aww', bank: 'boardwalk', pick: [1], seconds: 1.5,
    prompt: 'small crowd at a carnival booth groaning a sympathetic aww after a near miss, short, outdoors',
    shape: { maxMs: 1400, fadeMs: 400, levelDb: -21 },
  },

  // ---- skee-ball -------------------------------------------------------
  {
    id: 'skee-knock', bank: 'skee-ball', seconds: 0.5, takes: 4, pick: [0, 1],
    prompt: `solid wooden ball hitting a hollow wooden ramp, one dull knock, ${DRY}`,
    shape: { slice: true, maxMs: 260, fadeMs: 60 },
  },
  {
    id: 'skee-rim', bank: 'skee-ball', pick: [0], seconds: 0.8,
    prompt: `wooden ball rattling around the wooden rim of a skee-ball ring before it drops, quick rattle, ${DRY}`,
    shape: { maxMs: 650, fadeMs: 120 },
  },
  {
    id: 'skee-cup', bank: 'skee-ball', seconds: 0.6, takes: 4, pick: [0, 3],
    prompt: `wooden ball dropping into a deep wooden scoring cup, hollow clunk, ${DRY}`,
    shape: { slice: true, maxMs: 400, fadeMs: 90 },
  },
  {
    id: 'skee-return', bank: 'skee-ball', pick: [1], seconds: 1.8,
    prompt: `skee-ball machine ball return, wooden balls rolling down a chute and clacking together as they stop, ${DRY}`,
    shape: { maxMs: 1700, fadeMs: 250, levelDb: -18 },
  },
  {
    id: 'skee-roll-loop', bank: 'skee-ball', pick: [0], seconds: 3, loop: true, takes: 2,
    prompt: `heavy wooden ball rolling steadily down a long wooden alley lane, smooth low rumble, ${DRY}`,
    shape: { levelDb: -20 },
  },

  // ---- high-striker ----------------------------------------------------
  {
    id: 'striker-whoosh', bank: 'high-striker', pick: [1], seconds: 0.6,
    prompt: `heavy airy whoosh swell, a big wooden mallet swung fast, broad deep swish, ${DRY}`,
    shape: { maxMs: 450, fadeMs: 100, levelDb: -19 },
  },
  {
    id: 'striker-hit', bank: 'high-striker', seconds: 0.6, takes: 4, pick: [1, 2],
    prompt: `heavy wooden mallet slamming down on a rubber strike pad, deep punchy thump, ${DRY}`,
    shape: { slice: true, maxMs: 380, fadeMs: 90, levelDb: -14 },
  },
  {
    id: 'striker-bell', bank: 'high-striker', pick: [1], seconds: 2.5,
    prompt: `large brass carnival strongman bell struck once by a metal puck, loud clang ringing out long, ${DRY}`,
    shape: { slice: true, maxMs: 2500, fadeMs: 600, levelDb: -14 },
  },
  {
    id: 'striker-rail', bank: 'high-striker', pick: [2], seconds: 1.2,
    prompt: `metal puck shooting up a tall steel rail, a fast rising bright metallic zing, ${DRY}`,
    shape: { maxMs: 1000, fadeMs: 150, levelDb: -21 },
  },
  {
    id: 'striker-land', bank: 'high-striker', pick: [0], seconds: 0.5,
    prompt: `metal puck dropping onto a wooden base, dull clunk, ${DRY}`,
    shape: { slice: true, maxMs: 300, fadeMs: 70 },
  },

  // ---- ring-toss -------------------------------------------------------
  {
    id: 'ring-throw', bank: 'ring-toss', pick: [0], seconds: 0.5,
    prompt: `light airy whoosh, a small ring thrown past, soft broad swish, ${DRY}`,
    shape: { maxMs: 400, fadeMs: 100, levelDb: -22 },
  },
  {
    id: 'ring-glass', bank: 'ring-toss', seconds: 0.5, takes: 4, pick: [0, 1, 2],
    prompt: `plastic ring clinking against the neck of a glass bottle, one bright clink, ${DRY}`,
    shape: { slice: true, maxMs: 380, fadeMs: 100, levelDb: -18 },
  },
  {
    id: 'ring-wood', bank: 'ring-toss', seconds: 0.6, takes: 3, pick: [1, 2],
    prompt: `plastic ring landing flat on a wooden board and clattering to a stop, ${DRY}`,
    shape: { maxMs: 500, fadeMs: 120 },
  },
  {
    id: 'ring-ringer', bank: 'ring-toss', pick: [1], seconds: 1.2,
    prompt: `plastic ring dropping over a glass bottle neck and spinning down to rest, rattle that slows and settles, ${DRY}`,
    shape: { maxMs: 1100, fadeMs: 200, levelDb: -18 },
  },

  // ---- tin-duck --------------------------------------------------------
  {
    id: 'duck-pop', bank: 'tin-duck', seconds: 0.5, takes: 4, pick: [1, 2],
    prompt: `carnival cork popgun firing, one sharp cork pop, ${DRY}`,
    shape: { slice: true, maxMs: 220, fadeMs: 50, levelDb: -16 },
  },
  {
    id: 'duck-clang', bank: 'tin-duck', seconds: 0.6, takes: 4, pick: [2, 3],
    prompt: `cork striking a small tin duck target and knocking it over, bright tinny clank, ${DRY}`,
    shape: { slice: true, maxMs: 450, fadeMs: 120, levelDb: -16 },
  },
  {
    id: 'duck-ping', bank: 'tin-duck', pick: [2], seconds: 0.5,
    prompt: `tapping a thin steel spoon on a small tin plate once, one high bright ting, ${DRY}`,
    shape: { slice: true, maxMs: 450, fadeMs: 150 },
  },
  {
    id: 'duck-pock', bank: 'tin-duck', pick: [1], seconds: 0.5,
    prompt: `cork bouncing off a wooden board, one short dry hollow knock, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 50 },
  },
  {
    id: 'duck-dry', bank: 'tin-duck', pick: [1], seconds: 0.5,
    prompt: `toy gun trigger pulled with nothing loaded, small dry plastic click, ${DRY}`,
    shape: { slice: true, attackDb: -12, maxMs: 100, fadeMs: 30, levelDb: -20 },
  },
  {
    id: 'duck-reload', bank: 'tin-duck', pick: [1], seconds: 0.9,
    prompt: `loading a cork popgun: click, short pause, then a spring lever cocking click, ${DRY}`,
    shape: { maxMs: 700, fadeMs: 80, levelDb: -19 },
  },

  // ---- prize-claw ------------------------------------------------------
  {
    id: 'claw-motor-loop', bank: 'prize-claw', pick: [0], seconds: 3, loop: true, takes: 2,
    prompt: `claw machine gantry moving, small electric motor whirring steadily with a light belt hum, ${DRY}`,
    shape: { levelDb: -22 },
  },
  {
    id: 'claw-drop', bank: 'prize-claw', pick: [0], seconds: 1.3,
    prompt: `claw machine claw lowering on its cable, small motor whine and cable unspooling, ${DRY}`,
    shape: { maxMs: 1200, fadeMs: 200, levelDb: -21 },
  },
  {
    id: 'claw-close', bank: 'prize-claw', pick: [0], seconds: 0.5,
    prompt: `metal claw machine claw snapping its prongs shut, mechanical clack, ${DRY}`,
    shape: { slice: true, maxMs: 260, fadeMs: 60 },
  },
  {
    id: 'claw-chute', bank: 'prize-claw', pick: [0], seconds: 1,
    prompt: `plush toy dropping down a claw machine prize chute and thumping against a plastic flap door, ${DRY}`,
    shape: { maxMs: 900, fadeMs: 150 },
  },
  {
    id: 'claw-slip', bank: 'prize-claw', pick: [2], seconds: 0.8,
    prompt: `plush toy slipping out of a claw and falling onto a pile of plush toys, soft muffled thud, ${DRY}`,
    shape: { maxMs: 600, fadeMs: 120 },
  },

  // ---- coin-pusher -----------------------------------------------------
  {
    id: 'pusher-drop', bank: 'coin-pusher', seconds: 0.6, takes: 4, pick: [0, 1, 2],
    prompt: `one coin falling flat onto a metal shelf covered in coins, short clatter, ${DRY}`,
    shape: { slice: true, maxMs: 380, fadeMs: 90, levelDb: -18 },
  },
  {
    id: 'pusher-slide', bank: 'coin-pusher', seconds: 0.6, takes: 3, pick: [0, 2],
    prompt: `coins sliding against each other as a metal pusher shoves them forward, scraping clinks, ${DRY}`,
    shape: { maxMs: 500, fadeMs: 120, levelDb: -20 },
  },
  {
    id: 'pusher-spill', bank: 'coin-pusher', pick: [0], seconds: 1.8,
    prompt: `many coins spilling over the edge of a coin pusher shelf and cascading into a metal tray, ${DRY}`,
    shape: { maxMs: 1700, fadeMs: 300, levelDb: -16 },
  },

  // ---- lucky-cage ------------------------------------------------------
  {
    id: 'cage-crank', bank: 'lucky-cage', pick: [0], seconds: 1,
    prompt: `turning the hand crank of a wire bingo cage, quick ratcheting mechanical clicks, ${DRY}`,
    shape: { maxMs: 900, fadeMs: 120, levelDb: -19 },
  },
  {
    id: 'cage-tumble-loop', bank: 'lucky-cage', pick: [0], seconds: 3, loop: true, takes: 2,
    prompt: `many small wooden balls tumbling constantly inside a turning wire drum, dense continuous rattle, ${DRY}`,
    shape: { levelDb: -21 },
  },
  {
    id: 'cage-chute', bank: 'lucky-cage', pick: [0], seconds: 0.8,
    prompt: `one wooden bingo ball rolling down a short wooden chute and clicking into a cup, ${DRY}`,
    shape: { maxMs: 700, fadeMs: 100 },
  },

  // ---- derby (carnival water race) ------------------------------------
  {
    id: 'derby-bell', bank: 'derby', pick: [2], seconds: 1.4,
    prompt: `carnival water race starting bell, a loud electric bell ringing for one second, ${DRY}`,
    shape: { maxMs: 1300, fadeMs: 200, levelDb: -17 },
  },
  {
    id: 'derby-water-loop', bank: 'derby', pick: [1], seconds: 3, loop: true, takes: 2,
    prompt: `water squirt gun stream spraying steadily onto a tin target, continuous hiss and drumming, ${DRY}`,
    shape: { levelDb: -22 },
  },
  {
    id: 'derby-horn', bank: 'derby', pick: [0], seconds: 0.7,
    prompt: `one short honk of an old brass bulb horn, ${DRY}`,
    shape: { slice: true, maxMs: 500, fadeMs: 100, levelDb: -18 },
  },

  // ---- 8-ball ----------------------------------------------------------
  {
    id: 'pool-strike', bank: '8-ball', seconds: 0.5, takes: 4, pick: [0, 1],
    prompt: `pool cue tip striking the white cue ball, one sharp crisp tock, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 50, levelDb: -16 },
  },
  {
    id: 'pool-clack', bank: '8-ball', seconds: 0.5, takes: 5, pick: [0, 1, 3],
    prompt: `two hard billiard balls cracking together, one very sharp bright crack, ${DRY}`,
    shape: { slice: true, maxMs: 180, fadeMs: 50, levelDb: -16 },
  },
  {
    id: 'pool-cushion', bank: '8-ball', seconds: 0.5, takes: 3, pick: [0, 1],
    prompt: `billiard ball bouncing off a felt-covered rubber table cushion, soft dull thump, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 60 },
  },
  {
    id: 'pool-pocket', bank: '8-ball', pick: [0], seconds: 1,
    prompt: `billiard ball dropping into a pool table pocket and rolling down the wooden return rail, ${DRY}`,
    shape: { maxMs: 900, fadeMs: 200, levelDb: -18 },
  },

  // ---- bumper-cars -----------------------------------------------------
  {
    id: 'bumper-thud', bank: 'bumper-cars', seconds: 0.6, takes: 4, pick: [2, 3],
    prompt: `two bumper cars colliding, thick rubber bumper thump, ${DRY}`,
    shape: { slice: true, maxMs: 350, fadeMs: 90, levelDb: -16 },
  },
  {
    id: 'bumper-crash', bank: 'bumper-cars', pick: [0], seconds: 0.8,
    prompt: `heavy bumper car crash, big rubbery bang with a fiberglass rattle, ${DRY}`,
    shape: { slice: true, maxMs: 600, fadeMs: 150, levelDb: -14 },
  },
  {
    id: 'bumper-horn', bank: 'bumper-cars', pick: [1], seconds: 0.7,
    prompt: `small toy car horn, a quick double honk, ${DRY}`,
    shape: { maxMs: 600, fadeMs: 80, levelDb: -19 },
  },

  // ---- slots -----------------------------------------------------------
  {
    id: 'slot-lever', bank: 'slots', pick: [0], seconds: 0.9,
    prompt: `pulling the lever of an old mechanical slot machine, heavy spring clunk and ratchet, ${DRY}`,
    shape: { maxMs: 800, fadeMs: 120, levelDb: -18 },
  },
  {
    id: 'slot-stop', bank: 'slots', seconds: 0.5, takes: 4, pick: [0, 1, 3],
    prompt: `mechanical slot machine reel stopping, one solid clunk, ${DRY}`,
    shape: { slice: true, maxMs: 220, fadeMs: 60, levelDb: -17 },
  },
  {
    id: 'slot-spin-loop', bank: 'slots', pick: [1], seconds: 2, loop: true, takes: 2,
    prompt: `mechanical slot machine reels spinning fast, steady clicking whir, ${DRY}`,
    shape: { levelDb: -22 },
  },

  // ---- cards (21, video poker) ----------------------------------------
  {
    id: 'card-deal', bank: 'cards', seconds: 0.5, takes: 4, pick: [0, 1, 3],
    prompt: `one playing card dealt and sliding across a felt table, quick soft flick, ${DRY}`,
    shape: { slice: true, maxMs: 220, fadeMs: 60, levelDb: -19 },
  },
  {
    id: 'card-flip', bank: 'cards', seconds: 0.5, takes: 3, pick: [0, 1],
    prompt: `one playing card flipped face up on a table, crisp papery snap, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 50, levelDb: -19 },
  },
  {
    id: 'chip-stack', bank: 'cards', seconds: 0.6, takes: 3, pick: [0, 1],
    prompt: `a few clay poker chips set down on a stack, short clacking, ${DRY}`,
    shape: { maxMs: 450, fadeMs: 100, levelDb: -18 },
  },

  // ---- boards (chess, checkers, connect four, reversi) -----------------
  {
    id: 'piece-place', bank: 'boards', seconds: 0.5, takes: 4, pick: [1, 2, 3],
    prompt: `wooden chess piece set down on a wooden board, one soft solid knock, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 50, levelDb: -18 },
  },
  {
    id: 'piece-capture', bank: 'boards', seconds: 0.6, takes: 3, pick: [0, 2],
    prompt: `two quick wooden chess pieces knocking together, tock-tock, ${DRY}`,
    shape: { maxMs: 400, fadeMs: 80, levelDb: -17 },
  },
  {
    id: 'disc-drop', bank: 'boards', seconds: 0.7, takes: 3, pick: [1, 2],
    prompt: `plastic disc dropped into a connect four grid, clattering down the slot to the bottom, ${DRY}`,
    shape: { maxMs: 550, fadeMs: 100, levelDb: -18 },
  },

  // ---- mini-golf -------------------------------------------------------
  {
    id: 'golf-putt', bank: 'mini-golf', seconds: 0.5, takes: 4, pick: [0, 1],
    prompt: `putter striking a golf ball on artificial turf, one clean soft tick, ${DRY}`,
    shape: { slice: true, maxMs: 220, fadeMs: 60, levelDb: -18 },
  },
  {
    id: 'golf-cup', bank: 'mini-golf', pick: [1], seconds: 0.9,
    prompt: `golf ball dropping into a plastic cup and rattling to rest, ${DRY}`,
    shape: { maxMs: 800, fadeMs: 150, levelDb: -17 },
  },
  {
    id: 'golf-wall', bank: 'mini-golf', seconds: 0.5, takes: 3, pick: [1, 2],
    prompt: `golf ball bouncing off a wooden mini golf border, short hollow knock, ${DRY}`,
    shape: { slice: true, maxMs: 200, fadeMs: 50 },
  },

  // ---- quick play ------------------------------------------------------
  {
    id: 'lock-click', bank: 'ticket-stop', seconds: 0.5, takes: 3, pick: [0, 2],
    prompt: `combination padlock dial clicking past one notch, tiny crisp metal click, ${DRY}`,
    shape: { slice: true, maxMs: 90, fadeMs: 25, levelDb: -19 },
  },
  {
    id: 'lock-open', bank: 'ticket-stop', pick: [1], seconds: 0.7,
    prompt: `steel padlock shackle snapping open, solid metal clack, ${DRY}`,
    shape: { slice: true, maxMs: 450, fadeMs: 100, levelDb: -16 },
  },
  {
    id: 'block-thunk', bank: 'stack', seconds: 0.5, takes: 4, pick: [0, 3],
    prompt: `heavy wooden block set down on top of another wooden block, solid thunk, ${DRY}`,
    shape: { slice: true, maxMs: 260, fadeMs: 70, levelDb: -16 },
  },
  {
    id: 'wing-flap', bank: 'flappy-bird', seconds: 0.5, takes: 3, pick: [0, 2],
    prompt: `pigeon flapping its wings once, a soft fast feathery flap, ${DRY}`,
    shape: { maxMs: 220, fadeMs: 60, levelDb: -20 },
  },
  {
    id: 'wheel-tick', bank: 'core', seconds: 0.5, takes: 4, pick: [1, 3],
    prompt: `leather flapper on a carnival prize wheel clicking past one wooden peg, short tick, ${DRY}`,
    shape: { slice: true, maxMs: 90, fadeMs: 25, levelDb: -20 },
  },
];
