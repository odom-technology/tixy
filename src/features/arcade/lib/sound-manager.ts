// ---------------------------------------------------------------------------
// tixy Sound Manager — shared audio system for all games.
//
// - Programmatic Web Audio synthesis for fast, repeatable gameplay feedback
// - Tiny sampled "hero" cues for high-value moments, fetched only after unmute
// - Lazy AudioContext creation (deferred until first user interaction)
// - Device-local level (off, low, high) in localStorage, low by default;
//   audio still waits for the first pointer or key press
// - Per-sound cooldown to prevent cacophony during rapid events
// - Master gain node for instant mute/unmute of all playing sounds
// ---------------------------------------------------------------------------

import { SFX_BANK, type SfxId } from './sfx-bank';
import { SAMPLED_CUES, type SampledCue } from './sfx-cues';

const LS_KEY = 'holocron_sfx_muted';
/** The on-level beside the mute flag: 'low' or 'high'. */
const LS_LEVEL_KEY = 'holocron_sfx_level';

/** off is the mute flag; low and high are the master gain while on. */
export type SoundLevel = 'off' | 'low' | 'high';
type OnLevel = Exclude<SoundLevel, 'off'>;
const LEVEL_GAIN: Record<OnLevel, number> = { low: 0.4, high: 1 };
const SOUND_LEVELS: readonly SoundLevel[] = ['off', 'low', 'high'];

/**
 * Resolve stored values. A player who never touched sound gets low. A stored
 * mute stays muted. A stored unmute from before levels existed played at
 * full gain, so it stays high.
 */
export function resolveStoredSoundLevel(
  storedMuted: string | null,
  storedLevel: string | null,
): { muted: boolean; level: OnLevel } {
  const level: OnLevel | null =
    storedLevel === 'low' || storedLevel === 'high' ? storedLevel : null;
  if (storedMuted === null) return { muted: false, level: level ?? 'low' };
  return { muted: storedMuted === 'true', level: level ?? (storedMuted === 'true' ? 'low' : 'high') };
}
const DEFAULT_MIN_INTERVAL_MS = 50; // ms — default cooldown between same sound type

/**
 * Recorded samples replace the moments where real texture (wood, tin, paper,
 * coins, bells) makes the arcade feel physical. Repetitive, latency-critical
 * sounds stay procedural, so they stay instant and cost no network. The
 * files and their banks are sfx-bank.ts (generated); which cue plays which
 * sample, and how loud, is sfx-cues.ts.
 */
const SOUND_MIN_INTERVAL_MS: Record<string, number> = {
  // Typing needs a much tighter guard than general UI cues. At high WPM,
  // legitimate key presses can land only a few milliseconds apart.
  typingThock: 8,
  typingThockRelease: 8,
  duckPop: 100,
  duckClang: 50,
  duckPlate: 70,
  duckPock: 50,
  duckDry: 90,
  duckReload: 500,
  duckChime: 100,
  // Sampled cues have longer tails than synth taps. These guards keep rapid
  // reveal animations and duplicate settlement updates from stacking them.
  arcadeBet: 90,
  arcadeReveal: 110,
  arcadeWin: 250,
  arcadeBigWin: 500,
  arcadeLose: 250,
  arcadeCashout: 300,
  arcadeExplode: 180,
  arcadeCrash: 180,
  win: 250,
  lose: 250,
  tetrisLevelUp: 450,
  tetrisTSpin: 450,
  coinStreakMilestone: 450,
  achievementUnlock: 450,
  accountLevelUp: 450,
  // Pool breaks generate dense collision bursts; shorter intervals keep them punchy.
  cueStrike: 40,
  ballCollision: 14,
  cushionHit: 18,
  pocketed: 34,
  poolPocket: 34,
  // Stacker's cabinet: several lamps can land in one frame; one crack each.
  stackerShatter: 30,
  // Midway cabinets: the long sustained beds must not retrigger on top of
  // themselves, but the short contact taps should stay crisp.
  skeeRoll: 200,
  skeeChute: 260,
  skeeRimRattle: 120,
  skeeCupDrop: 90,
  skeeCradle: 120,
  skeeWoodKnock: 40,
  // One chime per landing; the lit ring's second note follows 90 ms later.
  skeeChime: 60,
  strikerWhoosh: 140,
  strikerImpact: 90,
  strikerBell: 300,
  strikerPuckLand: 90,
  strikerThud: 120,
  // Lucky Cage: the tumble bed is sustained and the client already paces it at
  // ~190 ms, so this only guards against pile-up. The chute/seat beats must stay
  // under the reduced-motion release gap (170 ms) or cues get swallowed.
  cageCrank: 300,
  cageTumble: 170,
  cageGate: 200,
  cageChute: 120,
  cageSeat: 120,
  // Prize Claw: the servo bed loops while the carriage moves, so it needs the
  // longest guard; the close/grip taps are contact sounds and must stay crisp.
  clawServo: 160,
  clawWhine: 500,
  clawRailRun: 240,
  clawClose: 90,
  clawGrip: 90,
  clawSlip: 200,
  clawChute: 300,
  clawDoorFlap: 90,
  // Multiplayer boards share one context and mixer. Selection cues are
  // intentionally guarded more tightly than moves so hover/focus churn cannot
  // turn into a wall of sound.
  boardSelect: 70,
  boardHoverSelect: 70,
  boardMove: 35,
  boardCapture: 60,
  boardJump: 60,
  boardCheck: 160,
  boardCastle: 160,
  boardPromote: 220,
  boardGameEnd: 500,
  boardWin: 500,
  boardLowTime: 700,
  boardTurn: 250,
  connectFourDrop: 80,
  reversiPlace: 70,
  reversiFlip: 100,
  battleshipPlace: 55,
  battleshipFire: 120,
  battleshipHit: 140,
  battleshipSunk: 260,
  battleshipMiss: 120,
  battleshipWin: 500,
  battleshipLose: 500,
  gemSelect: 45,
  gemSwap: 70,
  gemInvalid: 130,
  gemClear: 90,
  gemGameOver: 500,
  // Tickets (tixy/1-kit): one tick per stub, a receipt step every ~69 ms.
  printerTick: 60,
  receiptFeed: 40,
  ticketTear: 300,
  registerDing: 250,
  // A new best: once a run, so a long gap keeps a stray double from sounding.
  newBest: 600,
  // Ticket stop's lock: hits can land 200 ms apart, so the click stays short.
  lockClick: 30,
  lockOpen: 300,
  lockJam: 300,
  // Coin pusher: a pour lands a dozen coins a second, so clinks stay tight;
  // a spill can drop two coins in one frame, and each gets its note.
  pusherDrop: 30,
  pusherClink: 28,
  pusherSpill: 24,
  // Bumper cars: eight cars can bump in one frame; a thud each, kept apart.
  bumperThud: 35,
  bumperBig: 60,
  bumperRail: 45,
  bumperHorn: 400,
  bumperCount: 300,
  // Ring toss: a ring can tick two necks 20 ms apart, so clinks stay short.
  ringToss: 120,
  ringClink: 22,
  ringGlass: 30,
  ringWood: 30,
  ringTap: 30,
  ringDown: 300,
  ringChime: 120,
  ringGold: 300,
  // Daily spin: the flapper clicks on every peg; at speed they run together.
  wheelPeg: 28,
  wheelPull: 200,
  wheelLand: 200,
  wheelBig: 600,
};

// ---------------------------------------------------------------------------
// Sound definitions — each is a pure fire-and-forget function.
// (ctx, masterGain, noiseBuffer, volume) => void
// ---------------------------------------------------------------------------

type SoundFn = (
  ctx: AudioContext,
  master: GainNode,
  noise: AudioBuffer,
  vol: number,
  /** Optional frequency multiplier (pitch ladders, e.g. 2^(streak/12)). */
  pitch?: number,
) => void;

function createNoise(
  ctx: AudioContext,
  buffer: AudioBuffer,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

type SynthEnvelope = { attack: number; decay: number; peak: number };

/** Shared scheduling primitives for the multiplayer board cue bank. */
function scheduleSynthTone(
  ctx: AudioContext,
  dest: AudioNode,
  startAt: number,
  options: {
    type?: OscillatorType;
    frequency: number;
    frequencyEnd?: number;
    envelope: SynthEnvelope;
  },
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type ?? 'triangle';
  osc.frequency.setValueAtTime(options.frequency, startAt);
  if (options.frequencyEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, options.frequencyEnd),
      startAt + options.envelope.attack + options.envelope.decay,
    );
  }
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(
    Math.max(0.0001, options.envelope.peak),
    startAt + options.envelope.attack,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + options.envelope.attack + options.envelope.decay,
  );
  osc.connect(gain).connect(dest);
  osc.start(startAt);
  osc.stop(startAt + options.envelope.attack + options.envelope.decay + 0.05);
}

function scheduleSynthNoise(
  ctx: AudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  startAt: number,
  envelope: SynthEnvelope,
  filterFrequency: number,
  filterType: BiquadFilterType = 'lowpass',
): void {
  const src = createNoise(ctx, buffer);
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = filterType;
  filter.frequency.value = filterFrequency;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(
    Math.max(0.0001, envelope.peak),
    startAt + envelope.attack,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + envelope.attack + envelope.decay,
  );
  src.connect(filter).connect(gain).connect(dest);
  src.start(startAt);
  src.stop(startAt + envelope.attack + envelope.decay + 0.05);
}

function scheduleSynthChord(
  ctx: AudioContext,
  dest: AudioNode,
  startAt: number,
  frequencies: readonly number[],
  options: {
    type?: OscillatorType;
    decay?: number;
    volume?: number;
    stagger?: number;
  } = {},
): void {
  const decay = options.decay ?? 0.35;
  const volume = options.volume ?? 1;
  const stagger = options.stagger ?? 0;
  frequencies.forEach((frequency, index) => {
    scheduleSynthTone(ctx, dest, startAt + index * stagger, {
      type: options.type ?? 'sine',
      frequency,
      envelope: {
        attack: 0.01,
        decay,
        peak: (0.13 * volume) / Math.sqrt(frequencies.length),
      },
    });
  });
}

function scheduleBoardTap(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  startAt: number,
  options: {
    bodyFrequency: number;
    bodyEnd?: number;
    bodyDecay?: number;
    noiseFrequency?: number;
    noiseDecay?: number;
    volume?: number;
  },
): void {
  const volume = options.volume ?? 1;
  scheduleSynthNoise(
    ctx,
    dest,
    noise,
    startAt,
    { attack: 0.002, decay: options.noiseDecay ?? 0.05, peak: 0.12 * volume },
    options.noiseFrequency ?? 2600,
  );
  scheduleSynthTone(ctx, dest, startAt + 0.004, {
    type: 'triangle',
    frequency: options.bodyFrequency,
    frequencyEnd: options.bodyEnd ?? options.bodyFrequency * 0.65,
    envelope: {
      attack: 0.003,
      decay: options.bodyDecay ?? 0.12,
      peak: 0.2 * volume,
    },
  });
}

const SOUNDS: Record<string, SoundFn> = {
  /**
   * A compact mechanical-keyboard "thock": warm case resonance, a damped
   * switch bottom-out, and just enough filtered surface noise for definition.
   * Pitch is varied by the caller so a fast run never sounds like one sample
   * being machine-gunned.
   */
  typingThock: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;

    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(205 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(86 * pitch, t + 0.055);
    bodyGain.gain.setValueAtTime(0.16 * vol, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    body.connect(bodyGain).connect(master);
    body.start(t);
    body.stop(t + 0.08);

    const switchTone = ctx.createOscillator();
    const switchGain = ctx.createGain();
    switchTone.type = 'triangle';
    switchTone.frequency.setValueAtTime(760 * pitch, t);
    switchTone.frequency.exponentialRampToValueAtTime(310 * pitch, t + 0.025);
    switchGain.gain.setValueAtTime(0.035 * vol, t);
    switchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
    switchTone.connect(switchGain).connect(master);
    switchTone.start(t);
    switchTone.stop(t + 0.045);

    const surface = createNoise(ctx, noise);
    const surfaceFilter = ctx.createBiquadFilter();
    const surfaceGain = ctx.createGain();
    surfaceFilter.type = 'bandpass';
    surfaceFilter.frequency.value = 1180 * pitch;
    surfaceFilter.Q.value = 0.75;
    surfaceGain.gain.setValueAtTime(0.026 * vol, t);
    surfaceGain.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
    surface.connect(surfaceFilter).connect(surfaceGain).connect(master);
    surface.start(t);
    surface.stop(t + 0.04);
  },

  /** Softer switch return to give each press a physical up/down cadence. */
  typingThockRelease: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const spring = ctx.createOscillator();
    const springGain = ctx.createGain();
    spring.type = 'triangle';
    spring.frequency.setValueAtTime(360 * pitch, t);
    spring.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.022);
    springGain.gain.setValueAtTime(0.025 * vol, t);
    springGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    spring.connect(springGain).connect(master);
    spring.start(t);
    spring.stop(t + 0.045);

    const returnNoise = createNoise(ctx, noise);
    const returnFilter = ctx.createBiquadFilter();
    const returnGain = ctx.createGain();
    returnFilter.type = 'highpass';
    returnFilter.frequency.value = 1900 * pitch;
    returnGain.gain.setValueAtTime(0.009 * vol, t);
    returnGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    returnNoise.connect(returnFilter).connect(returnGain).connect(master);
    returnNoise.start(t);
    returnNoise.stop(t + 0.024);
  },

  // ── Flappy Bird ─────────────────────────────────────────────
  flap: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(520, t + 0.05);
    g.gain.setValueAtTime(0.18 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
  },

  score: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [520, 0],
      [700, 0.045],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.14 * vol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.045);
      osc.connect(g).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.055);
    }
  },

  hit: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.12);
    g.gain.setValueAtTime(0.28 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.14);
  },

  fall: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.linearRampToValueAtTime(100, t + 0.35);
    g.gain.setValueAtTime(0.18 * vol, t);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.42);
  },

  // ── Flappy bird, the tixy pass (docs/design/tixy-rebrand/FLAPPY.md) ──
  // Every one takes a pitch so a skin's sound tint steps it.

  /** The flap: a soft air thump under a quick rising chirp. 70 ms. */
  flappyFlap: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400 * pitch, t);
    lp.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.06);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.006);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.075);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(560 * pitch, t + 0.04);
    g.gain.setValueAtTime(0.07 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.06);
  },

  /** A gate passed: a short bell. The pitch ladder climbs it a semitone a
   *  gate. 140 ms. */
  flappyGate: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [freq, level, len] of [
      [784, 0.12, 0.14],
      [1568, 0.035, 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * pitch;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + len + 0.01);
    }
  },

  /** Every tenth gate: the bell and its fifth, a beat apart. 260 ms. */
  flappyMilestone: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [784, 0],
      [1175, 0.07],
      [1568, 0.14],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * pitch;
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(0.11 * vol, t + offset + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
      osc.connect(g).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.13);
    }
  },

  /** A near miss: a quick air whoosh past a pipe's lip. 180 ms. */
  flappyWhoosh: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.17);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.19);
  },

  /** The crash: a hard knock with a short crunch. 160 ms. */
  flappyCrash: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.14);
    g.gain.setValueAtTime(0.34 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.17);

    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900 * pitch;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.08);
  },

  /** The bird lands on the boards after a crash: a dull thud. 120 ms. */
  flappyThud: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.1);
    g.gain.setValueAtTime(0.2 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
  },

  // ── Snake ───────────────────────────────────────────────────
  eat: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(820, t + 0.045);
    g.gain.setValueAtTime(0.18 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.07);
  },

  die: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.linearRampToValueAtTime(50, t + 0.25);
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.3);
  },

  // ── Stack ───────────────────────────────────────────────────
  /** Dull "thock" for a sliced (non-perfect) placement. Fixed pitch. */
  stackPlace: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.07);
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
    // Soft noise tick for the "cut" texture.
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.07 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp).connect(g2).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  /**
   * Bright PERFECT chime. `pitch` escalates it one semitone per consecutive
   * perfect (pass 2^(streak/12)); resets to 1 when the streak breaks.
   */
  stackPerfect: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [660, 0],
      [990, 0.05],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * pitch;
      g.gain.setValueAtTime(0.16 * vol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.14);
      osc.connect(g).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.16);
    }
  },

  /** Descending thud when the block misses the tower (run over). */
  stackMiss: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.linearRampToValueAtTime(55, t + 0.28);
    g.gain.setValueAtTime(0.26 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.34);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.18);
  },

  /** Stacker's cabinet: the row lands. A heavy, short thunk, fixed pitch,
   *  on every stop that places a row. */
  stackerThunk: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(62, t + 0.09);
    g.gain.setValueAtTime(0.32 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
    // A dull knock on top, so it reads as a lamp housing, not a drum.
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(lp).connect(g2).connect(master);
    src.start(t);
    src.stop(t + 0.05);
  },

  /** Stacker's cabinet: lamps that fell off hit the floor and break. Three
   *  short bright cracks, a few ms apart. */
  stackerShatter: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    [0, 0.018, 0.041].forEach((offset, i) => {
      const src = createNoise(ctx, noise);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200 + i * 900;
      bp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.linearRampToValueAtTime((0.16 - i * 0.035) * vol, t + offset + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.06);
      src.connect(bp).connect(g).connect(master);
      src.start(t + offset);
      src.stop(t + offset + 0.07);
    });
  },

  // ── Tetris ──────────────────────────────────────────────────
  tetrisPieceMove: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 300;
    g.gain.setValueAtTime(0.06 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.04);
  },

  tetrisPieceRotate: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.linearRampToValueAtTime(600, t + 0.03);
    g.gain.setValueAtTime(0.1 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.05);
  },

  tetrisPieceLock: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 200;
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.07);
  },

  tetrisHardDrop: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Low thud
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 150;
    g.gain.setValueAtTime(0.2 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
    // Noise burst
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(lp).connect(g2).connect(master);
    src.start(t);
    src.stop(t + 0.07);
  },

  tetrisLineClear: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.1);
    g.gain.setValueAtTime(0.14 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
  },

  tetrisLineClearMulti: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(1000, t + 0.18);
    g.gain.setValueAtTime(0.16 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.22);
    // Harmonic
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(600, t);
    osc2.frequency.linearRampToValueAtTime(1400, t + 0.15);
    g2.gain.setValueAtTime(0.08 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    osc2.connect(g2).connect(master);
    osc2.start(t);
    osc2.stop(t + 0.19);
  },

  tetrisTSpin: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [440, 554, 659]; // A4 C#5 E5
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = notes[i];
      const s = t + i * 0.05;
      g.gain.setValueAtTime(0.1 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.06);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.07);
    }
  },

  tetrisLevelUp: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [523, 659, 784]; // C5 E5 G5
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0.12 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.08);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.09);
    }
  },

  tetrisGameOver: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [392, 330, 262, 196]; // G4 E4 C4 G3
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const s = t + i * 0.1;
      g.gain.setValueAtTime(0.11 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.14);
    }
  },

  tetrisBackToBack: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [880, 1047, 1319]; // A5 C6 E6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const s = t + i * 0.04;
      g.gain.setValueAtTime(0.08 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.06);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.07);
    }
  },

  // ── 8-Ball Pool ─────────────────────────────────────────────
  cueStrike: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 1.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.36 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.05);

    // Low-frequency thump to reinforce high-power breaks.
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(220, t);
    thump.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    thumpGain.gain.setValueAtTime(0.15 * vol, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    thump.connect(thumpGain).connect(master);
    thump.start(t);
    thump.stop(t + 0.1);
  },

  ballCollision: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.045);
  },

  cushionHit: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  pocketed: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Low sine thunk
    const osc = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.linearRampToValueAtTime(120, t + 0.13);
    g1.gain.setValueAtTime(0.2 * vol, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g1).connect(master);
    osc.start(t);
    osc.stop(t + 0.15);
    // Noise tail
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.08 * vol, t + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(g2).connect(master);
    src.start(t);
    src.stop(t + 0.13);
  },

  foul: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(200, t + 0.2);
    g.gain.setValueAtTime(0.14 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.24);
  },

  win: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const s = t + i * 0.08;
      g.gain.setValueAtTime(0.13 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.12);
    }
  },

  lose: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [392, 330, 262]; // G4 E4 C4
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const s = t + i * 0.1;
      g.gain.setValueAtTime(0.11 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.14);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.16);
    }
  },

  // ── Coin Flip ─────────────────────────────────────────────────

  /** Whoosh sound when coin is tossed into the air. */
  coinFlip: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Filtered noise whoosh
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.linearRampToValueAtTime(2000, t + 0.15);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.linearRampToValueAtTime(0.06 * vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.65);
  },

  /** Metallic clink when coin lands — correct call (streak continues). */
  coinCorrect: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    // Two-tone rising chime
    for (const [freq, offset] of [
      [660, 0],      // E5
      [880, 0.06],   // A5
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.16 * vol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.12);
      osc.connect(g).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.14);
    }
  },

  /** Dull thud when coin lands — wrong call (streak over). */
  coinWrong: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Low frequency thud
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.linearRampToValueAtTime(80, t + 0.15);
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.22);
    // Noise layer for texture
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.06 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.15);
  },

  /** Ascending sparkle for streak milestones (5, 10, 20). */
  coinStreakMilestone: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]!;
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0.12 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.12);
    }
  },

  // ── tixy — shared ────────────────────────────────────────

  /** Place-your-bet click / button press. */
  arcadeBet: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 480 * pitch;
    g.gain.setValueAtTime(0.1 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.05);
  },

  /** Gem Swap — quiet selection tick. */
  gemSelect: (ctx, master, _n, vol) => {
    scheduleSynthTone(ctx, master, ctx.currentTime, {
      type: 'triangle',
      frequency: 520,
      envelope: { attack: 0.004, decay: 0.05, peak: 0.06 * vol },
    });
  },

  /** Gem Swap — accepted adjacent swap. */
  gemSwap: (ctx, master, _n, vol) => {
    scheduleSynthTone(ctx, master, ctx.currentTime, {
      type: 'sine',
      frequency: 360,
      frequencyEnd: 480,
      envelope: { attack: 0.004, decay: 0.06, peak: 0.09 * vol },
    });
  },

  /** Gem Swap — rejected move, a two-stage wooden thunk. */
  gemInvalid: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'square',
      frequency: 200,
      frequencyEnd: 120,
      envelope: { attack: 0.004, decay: 0.14, peak: 0.12 * vol },
    });
    scheduleSynthTone(ctx, master, t + 0.06, {
      type: 'sine',
      frequency: 150,
      frequencyEnd: 90,
      envelope: { attack: 0.004, decay: 0.12, peak: 0.08 * vol },
    });
  },

  /** Gem Swap — cascade chime; pitch rises by cascade depth. */
  gemClear: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const base = 440 * pitch;
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: base,
      frequencyEnd: base * 1.5,
      envelope: { attack: 0.005, decay: 0.13, peak: 0.13 * vol },
    });
    if (pitch > 1.1) {
      scheduleSynthTone(ctx, master, t + 0.02, {
        type: 'triangle',
        frequency: base * 1.5,
        envelope: { attack: 0.005, decay: 0.1, peak: 0.07 * vol },
      });
    }
    if (pitch > 1.35) {
      scheduleSynthTone(ctx, master, t + 0.05, {
        type: 'sine',
        frequency: base * 2,
        envelope: { attack: 0.004, decay: 0.08, peak: 0.05 * vol },
      });
    }
  },

  /** Gem Swap — settling end-of-round descent. */
  gemGameOver: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    [523, 415, 330, 247].forEach((frequency, index) => {
      scheduleSynthTone(ctx, master, t + index * 0.1, {
        type: 'sine',
        frequency,
        envelope: { attack: 0.006, decay: 0.16, peak: 0.11 * vol },
      });
    });
  },

  /** tixy win — ascending chime. */
  arcadeWin: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]! * pitch;
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0.14 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.12);
    }
  },

  /** Achievement unlock — bright badge stamp followed by a short flourish. */
  achievementUnlock: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const notes = [659, 784, 1047, 1319];
    notes.forEach((frequency, index) => {
      scheduleSynthTone(ctx, master, t + index * 0.055, {
        type: index === 0 ? 'triangle' : 'sine',
        frequency: frequency * pitch,
        envelope: {
          attack: 0.004,
          decay: index === notes.length - 1 ? 0.24 : 0.12,
          peak: (index === 0 ? 0.14 : 0.1) * vol,
        },
      });
    });
  },

  /** tixy loss — descending dull tone. */
  arcadeLose: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [330, 262, 196]; // E4 C4 G3
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]!;
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.1 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.14);
    }
  },

  /** Big tixy win — sparkly ascending arpeggio. */
  arcadeBigWin: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319, 1568]; // C5 E5 G5 C6 E6 G6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]!;
      const s = t + i * 0.05;
      g.gain.setValueAtTime(0.12 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.12);
    }
  },

  /** Mines — gem reveal (safe tile). */
  arcadeReveal: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600 * pitch, t);
    osc.frequency.linearRampToValueAtTime(900 * pitch, t + 0.04);
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.07);
  },

  /** Mines — mine explosion. */
  arcadeExplode: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.2);
    g.gain.setValueAtTime(0.25 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.28);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.15 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.22);
  },

  /** Slots — reel spin tick. */
  arcadeReelTick: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 350;
    g.gain.setValueAtTime(0.04 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.02);
  },

  /** Slots — reel stop. */
  arcadeReelStop: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 250;
    g.gain.setValueAtTime(0.15 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.07);
  },

  /** Slots — a reel locks: a click over a low thump. Honors pitch. */
  slotsClunk: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'square';
    click.frequency.value = 320 * pitch;
    cg.gain.setValueAtTime(0.05 * vol, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(cg).connect(master);
    click.start(t);
    click.stop(t + 0.04);

    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150 * pitch, t);
    thump.frequency.exponentialRampToValueAtTime(65 * pitch, t + 0.14);
    tg.gain.setValueAtTime(0.28 * vol, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    thump.connect(tg).connect(master);
    thump.start(t);
    thump.stop(t + 0.17);
  },

  /** Crash — rising tension tone (called periodically while flying). */
  arcadeTick: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440 * pitch;
    g.gain.setValueAtTime(0.03 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.025);
  },

  /** Crash — explosion on crash. */
  arcadeCrash: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(0.2 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.38);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.28);
  },

  /** Cash out — cha-ching register sound. */
  arcadeCashout: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const notes = [1047, 1319]; // C6 E6
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]!;
      const s = t + i * 0.04;
      g.gain.setValueAtTime(0.16 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.08);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.1);
    }
  },

  /** Wheel — spin whoosh. */
  arcadeSpin: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.linearRampToValueAtTime(2000, t + 0.2);
    bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 * vol, t);
    g.gain.linearRampToValueAtTime(0.04 * vol, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.85);
  },

  /** Plinko — ball bounce on peg. */
  /** Without a pitch it scatters; with one (a pitch ladder) it holds 880 Hz
   *  times the pitch so each rung is audible. */
  arcadeBounce: (ctx, master, _n, vol, pitch) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(
      pitch == null ? 800 + Math.random() * 400 : 880 * pitch,
      t,
    );
    g.gain.setValueAtTime(0.06 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.035);
  },

  /** Dice — roll sound. */
  arcadeRoll: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.18);
  },

  // ── Gopher Pop ──────────────────────────────────────────────
  /** Mallet bonk — a padded "thock". `pitch` climbs with the combo tier
   *  (e.g. 2^(tier/12)) so streaks audibly escalate. */
  gopherBonk: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    // Body thump.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.1);
    g.gain.setValueAtTime(0.3 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
    // Felt tap (short noise burst) on top.
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 * pitch;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  /** Armored gopher — helmet CLANK (metallic ping, no score yet). */
  gopherClank: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    for (const [freq, amp] of [
      [620, 0.14],
      [935, 0.1],
      [1480, 0.06],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * 0.97, t + 0.09);
      g.gain.setValueAtTime(amp * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.12);
    }
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.05);
  },

  /** Golden gopher bonked — a bright three-note payday chime. */
  gopherGolden: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [784, 0],
      [988, 0.06],
      [1319, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.16 * vol, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.22);
      osc.connect(g).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.24);
    }
  },

  /** A gopher slipped away (escape) — a tiny descending "nyah" blip. */
  gopherEscape: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.11);
    g.gain.setValueAtTime(0.07 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
  },

  // ── Midway cabinets (Skee-Ball, High Striker) ───────────────
  // These are physical-object sounds, not slot-machine stingers: wood, brass,
  // enamel and sheet metal. Each is layered (body + surface) so the same
  // event reads differently depending on WHAT the ball or hammer touched.

  /** Skee-Ball — the ball leaves the hand and rolls onto the lane boards. */
  skeeRoll: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Low board rumble that opens up as the ball picks up speed.
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.linearRampToValueAtTime(520, t + 0.3);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.05);
    g.gain.setValueAtTime(0.09 * vol, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.58);
    // A woody release knock as it hits the boards.
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(96, t + 0.09);
    og.gain.setValueAtTime(0.1 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.12);
  },

  /** Skee-Ball — dull knock on lacquered lane wood (rail nudge, dead ball). */
  skeeWoodKnock: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(230, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.07);
    g.gain.setValueAtTime(0.11 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.06 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  /** Skee-Ball — the ball rattles the brass rim and stays out. */
  skeeRimRattle: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    // Three decaying metallic taps, each a touch flatter than the last.
    for (let i = 0; i < 3; i += 1) {
      const s = t + i * 0.055;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1180 - i * 130;
      g.gain.setValueAtTime(0.035 * vol * (1 - i * 0.24), s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.05);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.06);
    }
  },

  /** Skee-Ball — the ball drops into a cup: hollow wooden thock. */
  skeeCupDrop: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.13);
    g.gain.setValueAtTime(0.13 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.19);
    // Cup-throat air.
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(340, t + 0.14);
    bp.Q.value = 2.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.16);
  },

  /** Skee-Ball — the ball running the sheet-metal return chute. */
  skeeChute: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.linearRampToValueAtTime(820, t + 0.42);
    bp.Q.value = 3.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.055 * vol, t + 0.07);
    g.gain.setValueAtTime(0.055 * vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.52);
  },

  /** Skee-Ball — the ring chime. A struck bell: a sine body and an
   *  inharmonic partial that dies first. `pitch` is the ring's step (10 is
   *  1, 50 an octave up). */
  skeeChime: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const base = 659.25 * pitch;
    const partials: Array<[number, number, number]> = [
      [1, 0.12, 0.9],
      [2.0, 0.05, 0.5],
      [2.76, 0.035, 0.22],
    ];
    for (const [ratio, level, decay] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }
  },

  /** Skee-Ball — the ball settles into the wire cradle: two soft clicks. */
  skeeCradle: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i += 1) {
      const s = t + i * 0.085;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(i === 0 ? 420 : 300, s);
      osc.frequency.exponentialRampToValueAtTime(i === 0 ? 200 : 160, s + 0.05);
      g.gain.setValueAtTime((i === 0 ? 0.075 : 0.045) * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.07);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.08);
    }
  },

  // ── Mini golf ──
  /** Mini golf: the putter meets the ball. A short hard tock (a bright
   *  triangle that drops fast) over a click of noise. `pitch` follows pace. */
  golfPutt: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1150 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.035);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.08);
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.03);
  },

  /** Mini golf: the ball drops into the cup. It knocks the liner twice,
   *  rattles, and settles with a hollow thunk. */
  golfCup: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const knocks: Array<[number, number, number]> = [
      [0, 980, 0.11],
      [0.055, 1240, 0.07],
      [0.095, 860, 0.05],
      [0.125, 1100, 0.035],
    ];
    for (const [at, f, level] of knocks) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      g.gain.setValueAtTime(level * vol, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.03);
      osc.connect(g).connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.035);
    }
    const at = t + 0.17;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, at);
    osc.frequency.exponentialRampToValueAtTime(90, at + 0.14);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22 * vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + 0.22);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.07 * vol, at);
    ng.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
    src.connect(lp).connect(ng).connect(master);
    src.start(at);
    src.stop(at + 0.09);
  },

  /** High Striker — the mallet head cutting the air on the way down. */
  strikerWhoosh: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.16);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.075 * vol, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.24);
  },

  /** High Striker — mallet onto the brass plate. `pitch` scales with power. */
  strikerImpact: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    // Deep body thud — the timber and the base cabinet taking the load.
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(140 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(46, t + 0.22);
    bg.gain.setValueAtTime(0.24 * vol, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    body.connect(bg).connect(master);
    body.start(t);
    body.stop(t + 0.32);
    // Brass plate ring on top of it.
    const plate = ctx.createOscillator();
    const pg = ctx.createGain();
    plate.type = 'triangle';
    plate.frequency.setValueAtTime(560 * pitch, t);
    plate.frequency.exponentialRampToValueAtTime(300 * pitch, t + 0.16);
    pg.gain.setValueAtTime(0.07 * vol, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    plate.connect(pg).connect(master);
    plate.start(t);
    plate.stop(t + 0.22);
    // Grit and dust off the pad.
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.14);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.18);
  },

  /** High Striker — the brass bell, struck and left ringing. */
  strikerBell: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    // A struck bell is inharmonic: a hum note plus stretched partials.
    const partials = [
      { f: 523, a: 0.16, d: 1.9 },
      { f: 1046, a: 0.13, d: 1.5 },
      { f: 1571, a: 0.07, d: 1.0 },
      { f: 2402, a: 0.045, d: 0.7 },
      { f: 3210, a: 0.028, d: 0.42 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = p.f;
      g.gain.setValueAtTime(p.a * vol, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + p.d);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + p.d + 0.05);
    }
    // The clapper's initial metallic click.
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'square';
    click.frequency.value = 4200;
    cg.gain.setValueAtTime(0.03 * vol, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(cg).connect(master);
    click.start(t);
    click.stop(t + 0.04);
  },

  /** High Striker — the puck falling back and landing on its stop. */
  strikerPuckLand: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(78, t + 0.11);
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.17);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.08);
  },

  /** High Striker: a weak swing. A dull thud with no ring: a low sine that
   *  falls, and a short muffled knock of noise. */
  strikerThud: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.3);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.1);
  },

  // ── Lucky Cage (brass boardwalk lottery cabinet) ────────────
  /** Lucky Cage — the crank handle taking up: a brass ratchet on a wooden body. */
  cageCrank: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Four ratchet pawl clicks, accelerating as the drum takes up speed.
    const offsets = [0, 0.085, 0.155, 0.21];
    offsets.forEach((off, i) => {
      const s = t + off;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 620 + i * 70;
      g.gain.setValueAtTime(0.045 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.035);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.045);
    });
    // The cabinet carcass answering each click with a dull woody thump.
    const body = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 640;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.001, t);
    bg.gain.linearRampToValueAtTime(0.05 * vol, t + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    body.connect(lp).connect(bg).connect(master);
    body.start(t);
    body.stop(t + 0.32);
  },

  /** Lucky Cage — twenty balls rattling the brass drum: a dense bed, not a tone.
   *  Volume is driven by the tumble solver's collision loudness. */
  cageTumble: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Wooden/ivory clatter body: mid-band noise that opens and shuts quickly.
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(760, t);
    bp.frequency.linearRampToValueAtTime(1180, t + 0.14);
    bp.frequency.linearRampToValueAtTime(680, t + 0.34);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.38);
    // Two individual ball knocks riding on top so the bed reads as objects.
    for (let i = 0; i < 2; i += 1) {
      const s = t + 0.03 + i * 0.09;
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(430 - i * 60, s);
      osc.frequency.exponentialRampToValueAtTime(240 - i * 40, s + 0.05);
      og.gain.setValueAtTime(0.04 * vol, s);
      og.gain.exponentialRampToValueAtTime(0.001, s + 0.06);
      osc.connect(og).connect(master);
      osc.start(s);
      osc.stop(s + 0.07);
    }
  },

  /** Lucky Cage — the gate hatch unlatching: one brass clack, then the drum
   *  slowing behind it. */
  cageGate: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // The latch itself — bright, metallic, immediately damped.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(330, t + 0.06);
    g.gain.setValueAtTime(0.09 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.11);
    // Sympathetic brass ring from the cage wire.
    const ring = ctx.createOscillator();
    const rg = ctx.createGain();
    ring.type = 'sine';
    ring.frequency.value = 1560;
    rg.gain.setValueAtTime(0.028 * vol, t + 0.01);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    ring.connect(rg).connect(master);
    ring.start(t + 0.01);
    ring.stop(t + 0.28);
    // Hatch air as it swings clear.
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.04 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.11);
  },

  /** Lucky Cage — a ball running the brass chute: a descending roll, no impact. */
  cageChute: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    // Roll noise sweeping down as the ball loses height in the trough.
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.36);
    bp.Q.value = 2.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.06 * vol, t + 0.05);
    g.gain.setValueAtTime(0.06 * vol, t + 0.24);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.42);
    // Hollow trough resonance following the same fall.
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.36);
    // From silence: a gain's default is 1, so before its first event the
    // sine would sound at full scale.
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.045 * vol, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
  },

  /** Lucky Cage: a ball clacking into its cradle on the return rail. A wooden
   *  knock under an ivory tick. `pitch` steps up a semitone per ball. */
  cageSeat: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const knock = ctx.createOscillator();
    const kg = ctx.createGain();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(230 * pitch, t);
    knock.frequency.exponentialRampToValueAtTime(95 * pitch, t + 0.07);
    kg.gain.setValueAtTime(0.2 * vol, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    knock.connect(kg).connect(master);
    knock.start(t);
    knock.stop(t + 0.13);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(330 * pitch, t + 0.05);
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
    // The baize under the rail takes the edge off the contact.
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600 * pitch;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  // ── Prize Claw (walnut-and-brass claw cabinet) ──────────────
  /** Prize Claw — the gantry servo: a small DC motor under load, not a tone. */
  clawServo: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 220;
    // Slow wobble so the motor reads as mechanical rather than synthetic.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 11;
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.035 * vol, t + 0.03);
    g.gain.setValueAtTime(0.035 * vol, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.16);
    lfo.stop(t + 0.16);
  },

  /**
   * Prize Claw — the winch motor on a drop or a lift: one rising whine that
   * lasts about a second, a little unsteady, then a drop in pitch as it stops.
   * `pitch` lowers it for a labouring lift.
   */
  clawWhine: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const dur = 1.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 * pitch, t);
    lp.frequency.linearRampToValueAtTime(2200 * pitch, t + 0.8);
    lp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.042 * vol, t + 0.08);
    g.gain.setValueAtTime(0.042 * vol, t + dur - 0.14);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g).connect(master);
    // Two slightly detuned voices make the beat of a real armature.
    for (const detune of [1, 1.012]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260 * pitch * detune, t);
      osc.frequency.exponentialRampToValueAtTime(760 * pitch * detune, t + 0.8);
      osc.frequency.exponentialRampToValueAtTime(520 * pitch * detune, t + dur);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 9;
      lfoGain.gain.value = 12 * pitch;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(lp);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
    }
  },

  /** Prize Claw — the trolley running the brass rail: a filtered noise sweep. */
  clawRailRun: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1700, t + 0.12);
    bp.frequency.linearRampToValueAtTime(820, t + 0.24);
    bp.Q.value = 3.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.045 * vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.28);
  },

  /** Prize Claw — three fingers closing: two metallic taps, fast decay. */
  clawClose: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [900, 0],
      [1400, 0.022],
    ] as const) {
      const s = t + offset;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, s);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, s + 0.03);
      g.gain.setValueAtTime(0.075 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.035);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.045);
    }
  },

  /** Prize Claw — the prize seating in the fingers: a muted thud into felt. */
  clawGrip: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(96, t + 0.07);
    g.gain.setValueAtTime(0.085 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
    // Felt compressing under the tips.
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.032 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.08);
  },

  /** Prize Claw — the prize rolling off the tips: a downward glide plus rustle. */
  clawSlip: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.1);
    g.gain.setValueAtTime(0.06 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.12);
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.03 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.13);
  },

  /** Prize Claw — the prize tumbling the chute ramp, then a wooden knock. */
  clawChute: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1300, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.26);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.055 * vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.32);
    // The trough taking the weight at the bottom.
    const knock = ctx.createOscillator();
    const kg = ctx.createGain();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(150, t + 0.22);
    knock.frequency.exponentialRampToValueAtTime(78, t + 0.3);
    kg.gain.setValueAtTime(0.07 * vol, t + 0.22);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    knock.connect(kg).connect(master);
    knock.start(t + 0.22);
    knock.stop(t + 0.34);
  },

  /** Prize Claw — the sprung prize door slapping shut at the player's hand. */
  clawDoorFlap: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(190, t + 0.04);
    g.gain.setValueAtTime(0.055 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.07);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.038 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.07);
  },

  // ── Multiplayer boards ──────────────────────────────────────
  // These cues replace the per-route AudioContexts previously owned by chess,
  // checkers, Connect Four, Reversi, and Battleship. Their timbre and cadence
  // intentionally match the old route-local synths.
  boardMove: (ctx, master, noise, vol) => {
    scheduleBoardTap(ctx, master, noise, ctx.currentTime, {
      bodyFrequency: 260,
      bodyEnd: 160,
      bodyDecay: 0.14,
      volume: vol,
    });
  },

  boardCapture: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleBoardTap(ctx, master, noise, t, {
      bodyFrequency: 180,
      bodyEnd: 100,
      bodyDecay: 0.22,
      noiseFrequency: 4200,
      noiseDecay: 0.08,
      volume: 1.25 * vol,
    });
    scheduleSynthTone(ctx, master, t + 0.07, {
      type: 'square',
      frequency: 120,
      frequencyEnd: 80,
      envelope: { attack: 0.003, decay: 0.16, peak: 0.11 * vol },
    });
  },

  boardJump: (ctx, master, noise, vol) => {
    scheduleBoardTap(ctx, master, noise, ctx.currentTime, {
      bodyFrequency: 180,
      bodyEnd: 100,
      bodyDecay: 0.22,
      noiseFrequency: 4200,
      noiseDecay: 0.08,
      volume: 1.25 * vol,
    });
  },

  boardCheck: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [520, 780], {
      type: 'triangle',
      decay: 0.28,
      stagger: 0.07,
      volume: vol,
    });
  },

  boardCastle: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleBoardTap(ctx, master, noise, t, {
      bodyFrequency: 220,
      bodyEnd: 160,
      bodyDecay: 0.12,
      volume: vol,
    });
    scheduleBoardTap(ctx, master, noise, t + 0.09, {
      bodyFrequency: 280,
      bodyEnd: 200,
      bodyDecay: 0.14,
      volume: vol,
    });
  },

  boardPromote: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [523.25, 659.25, 783.99], {
      type: 'sine',
      decay: 0.45,
      stagger: 0.08,
      volume: vol,
    });
  },

  boardGameEnd: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [440, 392, 329.63], {
      type: 'triangle',
      decay: 0.9,
      stagger: 0.22,
      volume: 1.1 * vol,
    });
  },

  boardWin: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [392, 523.25, 659.25, 783.99], {
      type: 'triangle',
      decay: 0.5,
      stagger: 0.1,
      volume: 1.1 * vol,
    });
  },

  boardLowTime: (ctx, master, _noise, vol) => {
    scheduleSynthTone(ctx, master, ctx.currentTime, {
      type: 'square',
      frequency: 1000,
      envelope: { attack: 0.003, decay: 0.1, peak: 0.1 * vol },
    });
  },

  boardTurn: (ctx, master, _noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 880,
      envelope: { attack: 0.005, decay: 0.22, peak: 0.08 * vol },
    });
    scheduleSynthTone(ctx, master, t + 0.01, {
      type: 'sine',
      frequency: 1175,
      envelope: { attack: 0.005, decay: 0.28, peak: 0.06 * vol },
    });
  },

  boardSelect: (ctx, master, noise, vol) => {
    scheduleBoardTap(ctx, master, noise, ctx.currentTime, {
      bodyFrequency: 520,
      bodyEnd: 420,
      bodyDecay: 0.04,
      noiseFrequency: 3200,
      noiseDecay: 0.02,
      volume: 0.55 * vol,
    });
  },

  boardHoverSelect: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [520], {
      type: 'triangle',
      decay: 0.05,
      volume: 0.5 * vol,
    });
  },

  connectFourDrop: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.06,
      peak: 0.16 * vol,
    }, 3600);
    scheduleSynthTone(ctx, master, t + 0.004, {
      type: 'triangle',
      frequency: 200,
      frequencyEnd: 110,
      envelope: { attack: 0.003, decay: 0.16, peak: 0.22 * vol },
    });
    scheduleSynthTone(ctx, master, t + 0.09, {
      type: 'square',
      frequency: 130,
      frequencyEnd: 90,
      envelope: { attack: 0.003, decay: 0.1, peak: 0.08 * vol },
    });
  },

  reversiPlace: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.045,
      peak: 0.14 * vol,
    }, 3200);
    scheduleSynthTone(ctx, master, t + 0.004, {
      type: 'triangle',
      frequency: 240,
      frequencyEnd: 150,
      envelope: { attack: 0.003, decay: 0.12, peak: 0.2 * vol },
    });
  },

  reversiFlip: (ctx, master, _noise, vol) => {
    [523.25, 587.33, 659.25].forEach((frequency, index) => {
      scheduleSynthTone(ctx, master, ctx.currentTime + index * 0.045, {
        type: 'sine',
        frequency,
        envelope: { attack: 0.004, decay: 0.09, peak: 0.06 * vol },
      });
    });
  },

  battleshipPlace: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.05,
      peak: 0.12 * vol,
    }, 2200);
    scheduleSynthTone(ctx, master, t + 0.004, {
      type: 'square',
      frequency: 180,
      frequencyEnd: 110,
      envelope: { attack: 0.003, decay: 0.1, peak: 0.14 * vol },
    });
  },

  battleshipFire: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'triangle',
      frequency: 320,
      frequencyEnd: 90,
      envelope: { attack: 0.002, decay: 0.18, peak: 0.18 * vol },
    });
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.08,
      peak: 0.1 * vol,
    }, 1400);
  },

  battleshipHit: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.28,
      peak: 0.2 * vol,
    }, 2400);
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 180,
      frequencyEnd: 50,
      envelope: { attack: 0.004, decay: 0.3, peak: 0.2 * vol },
    });
  },

  battleshipSunk: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.002,
      decay: 0.45,
      peak: 0.26 * vol,
    }, 1800);
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 130,
      frequencyEnd: 50,
      envelope: { attack: 0.004, decay: 0.5, peak: 0.26 * vol },
    });
  },

  battleshipMiss: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, {
      attack: 0.004,
      decay: 0.22,
      peak: 0.12 * vol,
    }, 900, 'bandpass');
    scheduleSynthTone(ctx, master, t + 0.01, {
      type: 'sine',
      frequency: 420,
      frequencyEnd: 260,
      envelope: { attack: 0.006, decay: 0.18, peak: 0.05 * vol },
    });
  },

  battleshipWin: (ctx, master, _noise, vol) => {
    scheduleSynthChord(ctx, master, ctx.currentTime, [392, 523.25, 659.25, 783.99], {
      type: 'triangle',
      decay: 0.5,
      stagger: 0.1,
      volume: 1.1 * vol,
    });
  },

  battleshipLose: (ctx, master, _noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthChord(ctx, master, t, [392, 311.13, 261.63, 196], {
      type: 'sine',
      decay: 0.55,
      stagger: 0.14,
      volume: 0.95 * vol,
    });
    scheduleSynthTone(ctx, master, t + 0.05, {
      type: 'sine',
      frequency: 110,
      frequencyEnd: 45,
      envelope: { attack: 0.01, decay: 0.7, peak: 0.18 * vol },
    });
  },

  // ── Tickets: the strip, the receipt, the balance (tixy/1-kit) ──
  // Paper and a small thermal printer. Kept quiet: they repeat.

  /** The ticket strip prints one stub: three head clicks over a motor thunk. */
  printerTick: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.022;
      const src = createNoise(ctx, noise);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (2600 + i * 380) * pitch;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09 * vol, s);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.014);
      src.connect(bp).connect(g).connect(master);
      src.start(s);
      src.stop(s + 0.02);
    }
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(90 * pitch, t + 0.06);
    og.gain.setValueAtTime(0.025 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.08);
  },

  /** One printer step of a receipt feeding out. 16 of these are the chatter. */
  receiptFeed: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (3200 + Math.random() * 500) * pitch;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.016);
  },

  /** The strip tears off: a short paper rip that rises. */
  ticketTear: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 0.24);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    // Fibres give way in steps, so the rip crackles instead of hissing.
    for (let i = 0; i < 8; i++) {
      const s = t + i * 0.03;
      g.gain.linearRampToValueAtTime((0.1 + (i % 2) * 0.05) * vol, s + 0.008);
      g.gain.linearRampToValueAtTime(0.03 * vol, s + 0.026);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.32);
  },

  // ── Ticket stop: the lock ─────────────────────────────────
  /** A hit: a dry tumbler click over a short bell. `pitch` climbs a
   *  semitone a hit (the ladder), so a level reads as a rising phrase. */
  lockClick: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.022, peak: 0.16 * vol }, 3400, 'highpass');
    scheduleSynthTone(ctx, master, t, {
      type: 'triangle',
      frequency: 1046 * pitch,
      envelope: { attack: 0.002, decay: 0.11, peak: 0.13 * vol },
    });
    scheduleSynthTone(ctx, master, t + 0.004, {
      type: 'sine',
      frequency: 523 * pitch,
      frequencyEnd: 500 * pitch,
      envelope: { attack: 0.003, decay: 0.16, peak: 0.09 * vol },
    });
  },

  /** The lock opens: the shackle clacks free, then a rising chord. */
  lockOpen: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.05, peak: 0.16 * vol }, 1800);
    scheduleSynthTone(ctx, master, t, {
      type: 'square',
      frequency: 190,
      frequencyEnd: 95,
      envelope: { attack: 0.002, decay: 0.07, peak: 0.07 * vol },
    });
    scheduleSynthChord(ctx, master, t + 0.05, [784, 988, 1175, 1568], {
      type: 'triangle',
      decay: 0.42,
      volume: 1.3 * vol,
      stagger: 0.045,
    });
  },

  /** A miss: the lock jams. A low buzz and a dull thud, falling. */
  lockJam: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.002, decay: 0.12, peak: 0.12 * vol }, 520);
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(62, t + 0.34);
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13 * vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
  },

  /** Tickets land in the balance: a register bell over a drawer clunk. */
  registerDing: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    for (const [freq, peak] of [[1319, 0.11], [2637, 0.05], [3956, 0.02]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(peak * vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(g).connect(master);
      osc.start(t + 0.02);
      osc.stop(t + 0.72);
    }
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.07);
  },
  /** A new best (tixy/r-kit): a felt knock, then two bright strikes a fifth
   *  apart. One sound for the moment the number punches in, about 320 ms. */
  /** Your account levels up on a result (tixy/r-kit): the level-up sample,
   *  or tetris's procedural rise until it loads. */
  accountLevelUp: (ctx, master, noise, vol, pitch) => SOUNDS.tetrisLevelUp?.(ctx, master, noise, vol, pitch),

  newBest: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.06);
    for (const [at, freq, peak] of [[0, 784, 0.12], [0.075, 1175, 0.13]] as const) {
      for (const [mult, share] of [[1, 1], [2, 0.32], [3.01, 0.12]] as const) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = mult === 1 ? 'triangle' : 'sine';
        osc.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(peak * share * vol, t + at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.26);
        osc.connect(g).connect(master);
        osc.start(t + at);
        osc.stop(t + at + 0.28);
      }
    }
  },
  // ── Tin Duck Gallery ────────────────────────────────────────
  /** The cork gun: a pop, then the pump's click and clack. */
  duckPop: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(170 * pitch, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.11);
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.05);
    for (const [at, f, a] of [[0.075, 1700, 0.07], [0.135, 950, 0.09]] as const) {
      const click = ctx.createOscillator();
      const cg = ctx.createGain();
      click.type = 'square';
      click.frequency.value = f;
      cg.gain.setValueAtTime(a * vol, t + at);
      cg.gain.exponentialRampToValueAtTime(0.001, t + at + 0.016);
      click.connect(cg).connect(master);
      click.start(t + at);
      click.stop(t + at + 0.02);
    }
  },

  /** A cork on tin: a short, bright clang. `pitch` climbs with a streak. */
  duckClang: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const partials = [
      { r: 1, a: 0.13, d: 0.34 },
      { r: 1.52, a: 0.1, d: 0.24 },
      { r: 2.31, a: 0.07, d: 0.17 },
      { r: 3.4, a: 0.04, d: 0.1 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1180 * pitch * p.r;
      g.gain.setValueAtTime(p.a * vol, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + p.d);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + p.d + 0.02);
    }
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.04);
  },

  /** A plate struck and left ringing. */
  duckPlate: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const partials = [
      { r: 1, a: 0.14, d: 1.5 },
      { r: 2.01, a: 0.09, d: 1.0 },
      { r: 2.76, a: 0.06, d: 0.7 },
      { r: 4.1, a: 0.035, d: 0.35 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 760 * pitch * p.r;
      g.gain.setValueAtTime(p.a * vol, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + p.d);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + p.d + 0.02);
    }
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.04);
  },

  /** A cork into the backboard: a dull knock. */
  duckPock: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(64, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.14);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.1 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  /** A trigger pulled on an empty gun. */
  duckDry: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1300;
    g.gain.setValueAtTime(0.1 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.014);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.02);
  },

  /** Six corks dropped in, one tick each, then the breech shut. */
  duckReload: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i += 1) {
      const at = t + 0.06 + i * 0.185;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 620 + i * 70;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.09 * vol, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      osc.connect(g).connect(master);
      osc.start(at);
      osc.stop(at + 0.05);
    }
    const at = t + 1.2;
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * vol, at);
    ng.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    src.connect(lp).connect(ng).connect(master);
    src.start(at);
    src.stop(at + 0.06);
  },

  /** Two bell notes: the gold duck's arrival and its hit. */
  duckChime: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [at, f] of [[0, 1320], [0.09, 1760]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * pitch;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.11 * vol, t + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + at + 0.55);
      osc.connect(g).connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.6);
    }
  },

  /** Derby: a toy horse's gallop, four wooden clops on a rocking beat. */
  derbyHoof: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [at, f, a] of [[0, 520, 1], [0.07, 440, 0.8], [0.19, 560, 0.9], [0.26, 470, 0.7]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f * pitch, t + at);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55 * pitch, t + at + 0.05);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.09 * vol * a, t + at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, t + at + 0.07);
      osc.connect(g).connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.09);
      const src = createNoise(ctx, noise);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 2200;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.035 * vol * a, t + at);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + at + 0.03);
      src.connect(hp).connect(ng).connect(master);
      src.start(t + at);
      src.stop(t + at + 0.04);
    }
  },

  /** Derby: the booth's electric bell at the wire. A clapper hammers one
   *  small bell 24 times a second for a little over a second. */
  derbyBell: (ctx, master, _n, vol) => {
    const t = ctx.currentTime;
    const strikes = 30;
    for (let i = 0; i < strikes; i += 1) {
      const at = t + i / 24;
      const fade = 1 - i / (strikes + 4);
      for (const [f, a, d] of [[2093, 0.07, 0.16], [2794, 0.045, 0.11], [4186, 0.02, 0.06]] as const) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(a * vol * fade, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0004, at + d);
        osc.connect(g).connect(master);
        osc.start(at);
        osc.stop(at + d + 0.02);
      }
    }
    // The bell rings on after the clapper stops.
    const end = t + strikes / 24;
    for (const [f, a, d] of [[2093, 0.06, 0.9], [2794, 0.03, 0.6]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(a * vol, end);
      g.gain.exponentialRampToValueAtTime(0.0004, end + d);
      osc.connect(g).connect(master);
      osc.start(end);
      osc.stop(end + d + 0.05);
    }
  },

  /** Derby: the stream finds the bull. A small bright tink on the tin. */
  derbyBull: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.02, peak: 0.05 * vol }, 5200, 'highpass');
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 1760 * pitch,
      frequencyEnd: 1700 * pitch,
      envelope: { attack: 0.002, decay: 0.16, peak: 0.07 * vol },
    });
  },

  // ── Coin Pusher ───────────────────────────────────────────────
  // Metal on metal: a click of noise and a few inharmonic partials that die
  // fast, the way a coin rings. Pitch moves the whole ring.

  /** A coin leaves the chute: one small tink. */
  pusherDrop: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.012, peak: 0.07 * vol }, 5200, 'highpass');
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 4180 * pitch,
      envelope: { attack: 0.001, decay: 0.05, peak: 0.045 * vol },
    });
  },

  /** A coin lands on a shelf, a playfield or other coins. */
  pusherClink: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.016, peak: 0.1 * vol }, 3800, 'highpass');
    for (const [f, d, g] of [
      [2350, 0.11, 0.07],
      [3780, 0.07, 0.05],
      [5560, 0.045, 0.035],
    ] as const) {
      scheduleSynthTone(ctx, master, t, {
        type: 'sine',
        frequency: f * pitch,
        envelope: { attack: 0.001, decay: d, peak: g * vol },
      });
    }
  },

  /** A coin drops into the tray: a metal clunk and a bright paid note that
      climbs the pitch ladder through a spill. */
  pusherSpill: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.002, decay: 0.05, peak: 0.1 * vol }, 1900);
    for (const [f, d, g] of [
      [1180, 0.16, 0.06],
      [1910, 0.12, 0.045],
      [2840, 0.08, 0.035],
    ] as const) {
      scheduleSynthTone(ctx, master, t, {
        type: 'sine',
        frequency: f,
        envelope: { attack: 0.002, decay: d, peak: g * vol },
      });
    }
    scheduleSynthTone(ctx, master, t + 0.03, {
      type: 'triangle',
      frequency: 1318.5 * pitch,
      envelope: { attack: 0.003, decay: 0.26, peak: 0.075 * vol },
    });
  },

  // ── Bumper cars ───────────────────────────────────────────────
  // Rubber on rubber: a low body thump with a short slap of noise on top.
  // Pitch carries the force (lower is harder), so a hit sounds its weight.

  /** Two cars meet. */
  bumperThud: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 150 * pitch,
      frequencyEnd: 62 * pitch,
      envelope: { attack: 0.003, decay: 0.16, peak: 0.34 * vol },
    });
    scheduleSynthTone(ctx, master, t, {
      type: 'triangle',
      frequency: 310 * pitch,
      frequencyEnd: 140 * pitch,
      envelope: { attack: 0.002, decay: 0.07, peak: 0.12 * vol },
    });
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.045, peak: 0.16 * vol }, 900 * pitch);
  },

  /** A big hit: the thump, then the pole's contact crackling on the grid. */
  bumperBig: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 120 * pitch,
      frequencyEnd: 45,
      envelope: { attack: 0.003, decay: 0.26, peak: 0.42 * vol },
    });
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.001, decay: 0.08, peak: 0.2 * vol }, 700);
    for (let i = 0; i < 4; i += 1) {
      const at = t + 0.02 + i * 0.027 + (i % 2) * 0.008;
      scheduleSynthNoise(ctx, master, noise, at, { attack: 0.0005, decay: 0.018, peak: (0.11 - i * 0.02) * vol }, 4200, 'highpass');
    }
    scheduleSynthTone(ctx, master, t + 0.02, {
      type: 'square',
      frequency: 2400,
      frequencyEnd: 1500,
      envelope: { attack: 0.001, decay: 0.06, peak: 0.018 * vol },
    });
  },

  /** A car into the rail's padding: duller and shorter than a car. */
  bumperRail: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 105 * pitch,
      frequencyEnd: 55,
      envelope: { attack: 0.004, decay: 0.12, peak: 0.22 * vol },
    });
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.002, decay: 0.05, peak: 0.08 * vol }, 420);
  },

  /** The power horn: on at the start, off at the end. Two reeds a third apart. */
  bumperHorn: (ctx, master, _noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const f of [311.1, 392]) {
      scheduleSynthTone(ctx, master, t, {
        type: 'sawtooth',
        frequency: f * pitch,
        envelope: { attack: 0.03, decay: 0.7, peak: 0.05 * vol },
      });
    }
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 155.6 * pitch,
      envelope: { attack: 0.03, decay: 0.7, peak: 0.08 * vol },
    });
  },

  /** One beat of the count in, and of the last ten seconds. */
  bumperCount: (ctx, master, _noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthTone(ctx, master, t, {
      type: 'triangle',
      frequency: 660 * pitch,
      envelope: { attack: 0.002, decay: 0.12, peak: 0.09 * vol },
    });
  },

  // ── Ring toss ──

  /** Ring toss: the ring leaving the hand, a short rising breath of air. */
  ringToss: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.14);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07 * vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.2);
  },

  /** Ring toss: plastic on a glass neck. A bottle's bright inharmonic ping,
   *  very short. `pitch` follows the neck (higher up the neck, higher). */
  ringClink: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const partials: Array<[number, number, number]> = [
      [1, 0.09, 0.16],
      [2.32, 0.06, 0.09],
      [3.86, 0.035, 0.05],
      [5.4, 0.02, 0.03],
    ];
    for (const [r, a, d] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1680 * pitch * r;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a * vol, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0003, t + d);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
    const src = createNoise(ctx, noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.07 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    src.connect(hp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.02);
  },

  /** Ring toss: the ring against a bottle's body or shoulder: lower, rounder. */
  ringGlass: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const partials: Array<[number, number, number]> = [
      [1, 0.08, 0.22],
      [2.7, 0.04, 0.1],
    ];
    for (const [r, a, d] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 860 * pitch * r;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a * vol, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0003, t + d);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.03);
  },

  /** Ring toss: a plastic ring slapping a wooden crate or the platform. */
  ringWood: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(310 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(150 * pitch, t + 0.05);
    g.gain.setValueAtTime(0.12 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
    const src = createNoise(ctx, noise);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.09 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(bp).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.04);
  },

  /** Ring toss: ring on ring, a dry plastic tick. */
  ringTap: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1450 * pitch;
    g.gain.setValueAtTime(0.05 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.03);
  },

  /** Ring toss: the ring-down. The ring settles round the shoulder the way a
   *  dropped coin does: taps that come faster and softer, then a last clunk. */
  ringDown: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    let at = 0;
    let gap = 0.075;
    for (let i = 0; i < 9; i += 1) {
      const s = t + at;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = (900 + i * 55) * pitch;
      const level = 0.07 * vol * (1 - i * 0.08);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(level, s + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0003, s + 0.05);
      osc.connect(g).connect(master);
      osc.start(s);
      osc.stop(s + 0.06);
      at += gap;
      gap *= 0.78;
    }
    const s = t + at + 0.01;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420 * pitch, s);
    osc.frequency.exponentialRampToValueAtTime(190 * pitch, s + 0.06);
    g.gain.setValueAtTime(0.1 * vol, s);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
    osc.connect(g).connect(master);
    osc.start(s);
    osc.stop(s + 0.12);
    const src = createNoise(ctx, noise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, s);
    ng.gain.exponentialRampToValueAtTime(0.001, s + 0.04);
    src.connect(lp).connect(ng).connect(master);
    src.start(s);
    src.stop(s + 0.05);
  },

  /** Ring toss: the ringer's chime, a struck bell. `pitch` climbs a semitone
   *  for each ringer in a row. */
  ringChime: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    const base = 783.99 * pitch;
    const partials: Array<[number, number, number]> = [
      [1, 0.12, 1.1],
      [2.0, 0.05, 0.6],
      [3.01, 0.03, 0.3],
    ];
    for (const [ratio, level, decay] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }
  },

  /** Ring toss: the gold bottle. Three bell notes going up. */
  ringGold: (ctx, master, _n, vol, pitch = 1) => {
    const t = ctx.currentTime;
    for (const [at, f] of [[0, 1046.5], [0.08, 1318.5], [0.16, 1568]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * pitch;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.1 * vol, t + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + at + 0.7);
      osc.connect(g).connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.75);
    }
  },

  // ── Daily spin: the wheel (DAILY_WHEEL.md) ─────────────────
  /** The flapper slips off a peg: a dry rubber-on-wood click. `pitch` drops
   *  it a little as the wheel slows. */
  wheelPeg: (ctx, master, noise, vol, pitch = 1) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.0008, decay: 0.018, peak: 0.2 * vol }, 2300 * pitch, 'bandpass');
    scheduleSynthTone(ctx, master, t, {
      type: 'triangle',
      frequency: 760 * pitch,
      frequencyEnd: 430 * pitch,
      envelope: { attack: 0.001, decay: 0.03, peak: 0.07 * vol },
    });
  },

  /** The handle is pulled: a ratchet run and the spring letting go. */
  wheelPull: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      scheduleSynthNoise(ctx, master, noise, t + i * 0.024, { attack: 0.001, decay: 0.014, peak: 0.12 * vol }, 3000 + i * 260, 'bandpass');
    }
    scheduleSynthTone(ctx, master, t + 0.1, {
      type: 'sine',
      frequency: 180,
      frequencyEnd: 420,
      envelope: { attack: 0.004, decay: 0.16, peak: 0.08 * vol },
    });
  },

  /** The wheel comes to rest: the flapper settles with a thunk, one bell. */
  wheelLand: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.002, decay: 0.06, peak: 0.14 * vol }, 700);
    scheduleSynthTone(ctx, master, t, {
      type: 'sine',
      frequency: 150,
      frequencyEnd: 80,
      envelope: { attack: 0.003, decay: 0.12, peak: 0.12 * vol },
    });
    scheduleSynthTone(ctx, master, t + 0.04, {
      type: 'sine',
      frequency: 1175,
      envelope: { attack: 0.004, decay: 0.5, peak: 0.08 * vol },
    });
  },

  /** The 100 or the 200: a bell run up two octaves over a low hit. */
  wheelBig: (ctx, master, noise, vol) => {
    const t = ctx.currentTime;
    scheduleSynthNoise(ctx, master, noise, t, { attack: 0.002, decay: 0.09, peak: 0.12 * vol }, 900);
    scheduleSynthChord(ctx, master, t + 0.03, [523, 659, 784, 1047, 1319, 1568, 2093], {
      type: 'triangle',
      decay: 0.55,
      volume: 1.6 * vol,
      stagger: 0.06,
    });
  },
};

/** Public read-only cue catalog for validation tooling and semantic adapters. */
export const ARCADE_SOUND_CUES: readonly string[] = Object.freeze(
  Array.from(new Set([...Object.keys(SOUNDS), ...Object.keys(SAMPLED_CUES)])).sort(),
);

/** Whether a cue has a procedural sound (its fallback while samples load). */
export function hasProceduralCue(name: string): boolean {
  return Object.hasOwn(SOUNDS, name);
}

/**
 * Render a cue's procedural sound offline, mono at 44.1 kHz, for tooling
 * that measures loudness (scripts/sfx/measure.ts via /kit/sounds). Browser
 * only; null for a cue with no procedural sound.
 */
export async function renderProceduralCue(name: string, seconds = 3): Promise<Float32Array | null> {
  const cue = SOUNDS[name];
  if (!cue || typeof OfflineAudioContext === 'undefined') return null;
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
  const noise = ctx.createBuffer(1, Math.ceil(rate * 0.6), rate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const master = ctx.createGain();
  master.connect(ctx.destination);
  cue(ctx as unknown as AudioContext, master, noise, 1);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

// ---------------------------------------------------------------------------
// Manager class
// ---------------------------------------------------------------------------

/* Banks a game route loads besides the one named after it. A route with
   no entry loads the bank of its own name, if there is one. Renamed routes
   (game-renames.ts) point at the bank of the registry slug. */
const ROUTE_BANKS: Record<string, readonly string[]> = {
  'ring-roll': ['skee-ball', 'boardwalk'],
  'four-up': ['boards'],
  flap: ['flappy-bird'],
  '21': ['cards'],
  'video-poker': ['cards'],
  chess: ['boards'],
  checkers: ['boards'],
  'connect-four': ['boards'],
  reversi: ['boards'],
  'skee-ball': ['skee-ball', 'boardwalk'],
  'high-striker': ['high-striker', 'boardwalk'],
  'ring-toss': ['ring-toss', 'boardwalk'],
  'tin-duck': ['tin-duck', 'boardwalk'],
  'prize-claw': ['prize-claw', 'boardwalk'],
};

/* An MP3 decodes with encoder silence at both ends; a loop skips it so the
   seam never drops out. */
const loopBoundsCache = new WeakMap<AudioBuffer, [number, number]>();
function loopBounds(buffer: AudioBuffer): [number, number] {
  const cached = loopBoundsCache.get(buffer);
  if (cached) return cached;
  const data = buffer.getChannelData(0);
  let a = 0;
  let b = data.length - 1;
  while (a < b && Math.abs(data[a]!) < 1e-4) a += 1;
  while (b > a && Math.abs(data[b]!) < 1e-4) b -= 1;
  const bounds: [number, number] = b - a > buffer.sampleRate * 0.1
    ? [a / buffer.sampleRate, (b + 1) / buffer.sampleRate]
    : [0, buffer.duration];
  loopBoundsCache.set(buffer, bounds);
  return bounds;
}

/** Run when the main thread is idle, or after 1.5 s where that is unsupported. */
function whenIdle(task: () => void): void {
  if (typeof window === 'undefined') return;
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === 'function') idle.call(window, task, { timeout: 3000 });
  else window.setTimeout(task, 1500);
}

/* A skin's sound tint (SKINS.md): one filter in front of the master gain,
   and a small pitch step for cues that take a pitch. 'house' is no tint. */
export type SoundTint = 'house' | 'warm' | 'bright' | 'wood' | 'tin' | 'felt' | 'paper';

const TINTS: Record<Exclude<SoundTint, 'house'>, { type: BiquadFilterType; frequency: number; q: number; gain: number; pitch: number }> = {
  warm: { type: 'lowpass', frequency: 2400, q: 0.7, gain: 0, pitch: 0.94 },
  bright: { type: 'highshelf', frequency: 2500, q: 0.7, gain: 6, pitch: 1.06 },
  wood: { type: 'peaking', frequency: 380, q: 1.2, gain: 6, pitch: 0.9 },
  tin: { type: 'peaking', frequency: 2800, q: 3, gain: 8, pitch: 1.1 },
  felt: { type: 'lowpass', frequency: 1300, q: 0.7, gain: 0, pitch: 0.92 },
  paper: { type: 'highpass', frequency: 500, q: 0.7, gain: 0, pitch: 1.04 },
};

class SoundManagerImpl {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private tint: SoundTint = 'house';
  /* The tint's input, wired into masterGain; rebuilt when the tint or the
     context changes. */
  private tintInput: GainNode | null = null;
  private tintFor: { tint: SoundTint; ctx: AudioContext } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private _muted: boolean;
  private _level: OnLevel;
  private _unlocked = false;
  private lastPlayTime = new Map<string, number>();
  /* Decoded samples by URL, and loads in flight. */
  private sampleBuffers = new Map<string, AudioBuffer>();
  private sampleLoads = new Map<string, Promise<AudioBuffer | null>>();
  /* Banks to load once a gesture unlocks audio; core is always one. */
  private wantedBanks = new Set<string>(['core']);
  private loadedBanks = new Set<string>();
  /* The variant each sample played last, so the next one differs. */
  private lastVariant = new Map<SfxId, number>();
  private muteListeners = new Set<() => void>();

  constructor() {
    let stored: string | null = null;
    let storedLevel: string | null = null;
    let readable = false;
    try {
      if (typeof window !== 'undefined') {
        stored = localStorage.getItem(LS_KEY);
        storedLevel = localStorage.getItem(LS_LEVEL_KEY);
        readable = true;
      }
    } catch { /* SSR or blocked storage */ }
    // On and low for a player who never chose; a stored mute stays muted.
    // Without window (SSR) the manager stays silent.
    const resolved = resolveStoredSoundLevel(stored, storedLevel);
    this._muted = readable ? resolved.muted : true;
    this._level = resolved.level;
    if (typeof window !== 'undefined') {
      // A persisted opt-in is honored only after a fresh trusted gesture. The
      // capture listener runs before game click/key handlers, so their first
      // cue can still start immediately without allowing remote updates to
      // create or queue surprise audio beforehand.
      window.addEventListener('pointerdown', () => this.unlock(), {
        capture: true,
        passive: true,
      });
      window.addEventListener('keydown', () => this.unlock(), { capture: true });
      // Starting the audio device costs tens of milliseconds. Do it while the
      // page is idle, suspended, so the first gesture only has to resume().
      whenIdle(() => this.warm());
      window.addEventListener('storage', (event) => {
        if (event.key === LS_LEVEL_KEY) {
          if (event.newValue === 'low' || event.newValue === 'high') {
            this.applyLevel(event.newValue, false);
          }
          return;
        }
        if (event.key !== LS_KEY || event.newValue === null) return;
        this.applyMuted(event.newValue === 'true', false);
      });
    }
  }

  private ensureContext(): boolean {
    if (this.ctx && this.ctx.state !== 'closed') return true;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.masterGainValue();
      // Pre-generate one shared noise buffer. The longer tail covers board-game
      // impact/explosion cues while remaining tiny compared with sampled audio.
      const rate = this.ctx.sampleRate;
      const len = Math.ceil(rate * 0.6);
      this.noiseBuffer = this.ctx.createBuffer(1, len, rate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  /** Idle-time setup: create the context (suspended until a gesture) and
   * its noise buffer, so unlock() in the gesture is only a resume(). Plays
   * nothing: play() still waits for unlock(). */
  private warm(): void {
    if (this._muted || typeof window === 'undefined') return;
    if (this.ctx && this.ctx.state !== 'closed') return;
    this.ensureContext();
  }

  /** Call synchronously from a trusted pointer/key gesture so later animation
   * cues are allowed to play after the gesture stack has unwound. */
  unlock(): void {
    if (this._muted || typeof window === 'undefined') return;
    // Normally warm() already built the context at idle time; a gesture that
    // beats it pays the creation cost once.
    if (!this.ensureContext() || !this.ctx) return;
    this._unlocked = true;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Audio is enhancement; a browser may still decline the gesture.
      });
    }
    this.queueBanks();
  }

  /**
   * Load a game's sample bank ahead of its first cue: call on mount. Before
   * the first gesture this only notes the bank; nothing is fetched while
   * muted. Cues still play their procedural sound until the bank is in.
   */
  preload(bank: string): void {
    this.wantedBanks.add(bank);
    if (this._unlocked) this.queueBanks();
  }

  private queueBanks(): void {
    if (this._muted || typeof window === 'undefined') return;
    // The game on screen: its first path segment, and any banks it shares.
    const route = window.location.pathname.split('/')[1] ?? '';
    for (const bank of ROUTE_BANKS[route] ?? [route]) {
      if (bank) this.wantedBanks.add(bank);
    }
    for (const bank of this.wantedBanks) {
      if (this.loadedBanks.has(bank)) continue;
      this.loadedBanks.add(bank);
      whenIdle(() => this.loadBank(bank));
    }
  }

  private loadBank(bank: string): void {
    if (this._muted || !this.ensureContext()) {
      this.loadedBanks.delete(bank);
      return;
    }
    // Only what some cue plays: the catalog holds sounds still on audition.
    for (const cue of Object.values(SAMPLED_CUES)) {
      const entry = SFX_BANK[cue.sfx];
      if (entry.bank !== bank) continue;
      for (const url of entry.files) void this.loadSample(url);
    }
  }

  private loadSample(url: string): Promise<AudioBuffer | null> {
    const existing = this.sampleBuffers.get(url);
    if (existing) return Promise.resolve(existing);

    const pending = this.sampleLoads.get(url);
    if (pending) return pending;

    const context = this.ctx;
    if (!context) return Promise.resolve(null);

    const load = fetch(url, { cache: 'force-cache' })
      .then((response) => response.ok ? response.arrayBuffer() : null)
      .then((encoded) => encoded ? context.decodeAudioData(encoded) : null)
      .then((buffer) => {
        if (buffer) this.sampleBuffers.set(url, buffer);
        return buffer;
      })
      .catch(() => null)
      .finally(() => {
        this.sampleLoads.delete(url);
      });

    this.sampleLoads.set(url, load);
    return load;
  }

  /** A loaded variant of a sample, never the one it played last. */
  private pickVariant(id: SfxId): AudioBuffer | null {
    const files = SFX_BANK[id].files;
    const ready: number[] = [];
    files.forEach((url, i) => {
      if (this.sampleBuffers.has(url)) ready.push(i);
    });
    if (ready.length === 0) return null;
    const last = this.lastVariant.get(id);
    const choices = ready.length > 1 ? ready.filter((i) => i !== last) : ready;
    const pick = choices[Math.floor(Math.random() * choices.length)]!;
    this.lastVariant.set(id, pick);
    return this.sampleBuffers.get(files[pick]!)!;
  }

  private playSample(cue: SampledCue, options?: { volume?: number; pitch?: number }): boolean {
    if (!this.ctx || !this.masterGain) return false;
    const buffer = this.pickVariant(cue.sfx);
    if (!buffer) return false;

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    const spread = options?.pitch === undefined && cue.jitter ? 1 + (Math.random() * 2 - 1) * cue.jitter : 1;
    source.playbackRate.value = Math.min(2, Math.max(0.5, (options?.pitch ?? 1) * spread * this.tintPitch()));
    gain.gain.value = (cue.volume ?? 1) * (options?.volume ?? 1);
    source.connect(gain).connect(this.output());
    source.start();
    return true;
  }

  /** Tint every cue that follows, until it is set back to 'house'. A game
   *  sets its equipped skin's tint on load and 'house' when it unmounts. */
  setTint(tint: SoundTint): void {
    this.tint = tint in TINTS ? tint : 'house';
  }

  private output(): GainNode {
    const ctx = this.ctx!;
    if (this.tint === 'house') return this.masterGain!;
    if (this.tintInput && this.tintFor?.tint === this.tint && this.tintFor.ctx === ctx) return this.tintInput;
    this.tintInput?.disconnect();
    const spec = TINTS[this.tint as Exclude<SoundTint, 'house'>];
    const input = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.frequency;
    filter.Q.value = spec.q;
    filter.gain.value = spec.gain;
    input.connect(filter).connect(this.masterGain!);
    this.tintInput = input;
    this.tintFor = { tint: this.tint, ctx };
    return input;
  }

  private tintPitch(): number {
    return this.tint === 'house' ? 1 : TINTS[this.tint as Exclude<SoundTint, 'house'>].pitch;
  }

  play(name: string, options?: { volume?: number; pitch?: number }): void {
    if (this._muted || !this._unlocked) return;
    if (typeof window === 'undefined') return;
    if (!this.ensureContext()) return;
    if (this.ctx?.state === 'suspended') {
      if (!navigator.userActivation?.isActive) return;
      void this.ctx.resume().catch(() => {
        // Audio is enhancement; the browser may still decline the gesture.
      });
    }

    // Per-sound cooldown
    const now = performance.now();
    const last = this.lastPlayTime.get(name) ?? 0;
    const minInterval = SOUND_MIN_INTERVAL_MS[name] ?? DEFAULT_MIN_INTERVAL_MS;
    if (now - last < minInterval) return;
    this.lastPlayTime.set(name, now);

    try {
      const sampled = SAMPLED_CUES[name];
      if (sampled) {
        if (this.playSample(sampled, options)) return;
        // The first cue after a cold load still gets the procedural fallback;
        // later plays use the sample once its bank is in.
        this.preload(SFX_BANK[sampled.sfx].bank);
      }
      SOUNDS[sampled?.fallback ?? name]?.(
        this.ctx!,
        this.output(),
        this.noiseBuffer!,
        options?.volume ?? 1,
        // Undefined when the caller set no pitch; cues default it to 1. A
        // tint steps only a pitch the caller set.
        options?.pitch === undefined ? undefined : options.pitch * this.tintPitch(),
      );
    } catch {
      // Audio is enhancement — never crash
    }
  }

  /**
   * A rolling rumble for an object whose path is known when it is let go
   * (a skee-ball). `speeds` are 0 to 1, spread evenly over `seconds`:
   * loudness and brightness follow them, and 0 is silence (a ball in the
   * air). Scheduled once, so it costs nothing per frame. Returns a stop
   * function that fades it out in 30 ms.
   */
  playRoll(speeds: ArrayLike<number>, seconds: number, options?: { volume?: number }): () => void {
    const noop = () => {};
    if (this._muted || !this._unlocked || typeof window === 'undefined') return noop;
    if (!this.ensureContext() || !this.ctx || !this.masterGain || !this.noiseBuffer) return noop;
    if (this.ctx.state === 'suspended') {
      if (!navigator.userActivation?.isActive) return noop;
      void this.ctx.resume().catch(() => undefined);
    }
    if (speeds.length < 2 || !(seconds > 0)) return noop;
    try {
      const ctx = this.ctx;
      const vol = options?.volume ?? 1;
      const t = ctx.currentTime + 0.005;
      const n = speeds.length + 1;
      const noiseGain = new Float32Array(n);
      const band = new Float32Array(n);
      const bodyGain = new Float32Array(n);
      const bodyFreq = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        // The last point is silence, so the stop never clicks.
        const raw = i < speeds.length ? Number(speeds[i]) : 0;
        const s = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
        noiseGain[i] = 0.0001 + 0.13 * vol * Math.pow(s, 0.75);
        band[i] = 150 + 650 * s;
        bodyGain[i] = 0.0001 + 0.1 * vol * s;
        bodyFreq[i] = 48 + 64 * s;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueCurveAtTime(band, t, seconds);
      const g = ctx.createGain();
      g.gain.setValueCurveAtTime(noiseGain, t, seconds);
      src.connect(bp).connect(g).connect(this.output());
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueCurveAtTime(bodyFreq, t, seconds);
      const bg = ctx.createGain();
      bg.gain.setValueCurveAtTime(bodyGain, t, seconds);
      body.connect(bg).connect(this.output());
      src.start(t);
      body.start(t);
      src.stop(t + seconds + 0.05);
      body.stop(t + seconds + 0.05);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        try {
          const now = ctx.currentTime;
          for (const gain of [g.gain, bg.gain]) {
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(gain.value, now);
            gain.linearRampToValueAtTime(0.0001, now + 0.03);
          }
          src.stop(now + 0.05);
          body.stop(now + 0.05);
        } catch {
          // Already stopped.
        }
      };
    } catch {
      return noop;
    }
  }

  private applyMuted(muted: boolean, persist: boolean): void {
    const changed = muted !== this._muted;
    this._muted = muted;
    if (muted) this._unlocked = false;
    if (persist) {
      try {
        localStorage.setItem(LS_KEY, String(muted));
      } catch { /* blocked storage */ }
    }
    this.syncGain();
    if (!muted && persist) {
      this.unlock();
    }
    if (changed) {
      for (const listener of this.muteListeners) listener();
    }
  }

  private masterGainValue(): number {
    return this._muted ? 0 : LEVEL_GAIN[this._level];
  }

  private syncGain(): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.masterGainValue(),
        this.ctx.currentTime,
      );
    }
  }

  private applyLevel(level: OnLevel, persist: boolean): void {
    const changed = level !== this._level;
    this._level = level;
    if (persist) {
      try {
        localStorage.setItem(LS_LEVEL_KEY, level);
      } catch { /* blocked storage */ }
    }
    this.syncGain();
    if (changed) {
      for (const listener of this.muteListeners) listener();
    }
  }

  /** Gain the level applies: 0 when off, else the low or high gain. Other
   * audio graphs (tetris music) multiply this in to follow the setting. */
  getGain(): number {
    return this.masterGainValue();
  }

  /** off, low or high. off is the same as muted. */
  getLevel(): SoundLevel {
    return this._muted ? 'off' : this._level;
  }

  /** Set and store the level. Call from a click so audio can unlock. */
  setLevel(level: SoundLevel): void {
    if (level === 'off') {
      this.setMuted(true);
      return;
    }
    this.applyLevel(level, true);
    if (this._muted) this.setMuted(false);
  }

  /** Step off, low, high, off. Returns the new level. */
  cycleLevel(): SoundLevel {
    const index = SOUND_LEVELS.indexOf(this.getLevel());
    const next = SOUND_LEVELS[(index + 1) % SOUND_LEVELS.length]!;
    this.setLevel(next);
    return next;
  }

  setMuted(muted: boolean): void {
    this.applyMuted(muted, true);
  }

  isMuted(): boolean {
    return this._muted;
  }

  toggle(): boolean {
    const next = !this._muted;
    this.setMuted(next);
    return next;
  }

  /**
   * A tone that follows a value the player is holding (a mallet drawn back).
   * `set(level)` moves the pitch and brightness: 0 is a low hum, 1 is two
   * octaves up, and it may go past 1. `stop()` fades it out. Smoothed on the
   * audio clock, so a slow frame never steps the pitch.
   */
  startHoldTone(options?: { volume?: number }): { set: (level: number) => void; stop: (fadeMs?: number) => void } {
    const noop = { set: () => {}, stop: () => {} };
    if (this._muted || !this._unlocked || typeof window === 'undefined') return noop;
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return noop;
    if (this.ctx.state === 'suspended') {
      if (!navigator.userActivation?.isActive) return noop;
      void this.ctx.resume().catch(() => undefined);
    }
    try {
      const ctx = this.ctx;
      const vol = options?.volume ?? 1;
      const t = ctx.currentTime;
      const body = ctx.createOscillator();
      body.type = 'triangle';
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      const g = ctx.createGain();
      const freq = (level: number) => 120 * Math.pow(2, 1.8 * Math.max(0, level));
      body.frequency.setValueAtTime(freq(0), t);
      sub.frequency.setValueAtTime(freq(0) / 2, t);
      lp.frequency.setValueAtTime(700, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 * vol, t + 0.05);
      body.connect(lp);
      sub.connect(lp);
      lp.connect(g).connect(this.output());
      body.start(t);
      sub.start(t);
      let stopped = false;
      return {
        set: (level: number) => {
          if (stopped) return;
          const now = ctx.currentTime;
          const l = Number.isFinite(level) ? level : 0;
          body.frequency.setTargetAtTime(freq(l), now, 0.03);
          sub.frequency.setTargetAtTime(freq(l) / 2, now, 0.03);
          lp.frequency.setTargetAtTime(700 + 2600 * Math.min(1.5, Math.max(0, l)), now, 0.04);
          g.gain.setTargetAtTime((0.045 + 0.04 * Math.min(1.2, Math.max(0, l))) * vol, now, 0.04);
        },
        stop: (fadeMs = 40) => {
          if (stopped) return;
          stopped = true;
          try {
            const now = ctx.currentTime;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
            g.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
            body.stop(now + fadeMs / 1000 + 0.02);
            sub.stop(now + fadeMs / 1000 + 0.02);
          } catch {
            // Already stopped.
          }
        },
      };
    } catch {
      return noop;
    }
  }

  /**
   * Derby's water gun, live for as long as the water can run. `set` takes
   * `water` (0 to 1, the trigger), `hit` (0 off the target, else 0.35 at
   * the rim to 1 on the bull) and `run` (your horse's speed, 0 to 1): a
   * hiss while the water runs, a drumming on the tin while it hits, pitched
   * by how close to the middle, and the rail motor's whir under your horse.
   * Smoothed on the audio clock, so the frame rate never steps it.
   */
  startWaterJet(options?: { volume?: number }): {
    set: (state: { water: number; hit: number; run: number }) => void;
    stop: (fadeMs?: number) => void;
  } {
    const noop = { set: () => {}, stop: () => {} };
    if (this._muted || !this._unlocked || typeof window === 'undefined') return noop;
    if (!this.ensureContext() || !this.ctx || !this.masterGain || !this.noiseBuffer) return noop;
    if (this.ctx.state === 'suspended') {
      if (!navigator.userActivation?.isActive) return noop;
      void this.ctx.resume().catch(() => undefined);
    }
    try {
      const ctx = this.ctx;
      const vol = options?.volume ?? 1;
      const t = ctx.currentTime;
      const out = this.output();
      // The hiss: the jet leaving the nozzle.
      const hissSrc = ctx.createBufferSource();
      hissSrc.buffer = this.noiseBuffer;
      hissSrc.loop = true;
      const hissHp = ctx.createBiquadFilter();
      hissHp.type = 'highpass';
      hissHp.frequency.value = 2400;
      const hiss = ctx.createGain();
      hiss.gain.setValueAtTime(0.0001, t);
      hissSrc.connect(hissHp).connect(hiss).connect(out);
      // The drum: water on tin, a band of noise that flutters.
      const drumSrc = ctx.createBufferSource();
      drumSrc.buffer = this.noiseBuffer;
      drumSrc.loop = true;
      const drumBp = ctx.createBiquadFilter();
      drumBp.type = 'bandpass';
      drumBp.Q.value = 3.2;
      drumBp.frequency.setValueAtTime(700, t);
      const flutter = ctx.createGain();
      flutter.gain.setValueAtTime(0.6, t);
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 19;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.4;
      lfo.connect(lfoDepth).connect(flutter.gain);
      const drum = ctx.createGain();
      drum.gain.setValueAtTime(0.0001, t);
      drumSrc.connect(drumBp).connect(flutter).connect(drum).connect(out);
      // The motor: the rail pulling your horse.
      const motor = ctx.createOscillator();
      motor.type = 'sawtooth';
      motor.frequency.setValueAtTime(60, t);
      const motorLp = ctx.createBiquadFilter();
      motorLp.type = 'lowpass';
      motorLp.frequency.value = 520;
      const motorGain = ctx.createGain();
      motorGain.gain.setValueAtTime(0.0001, t);
      motor.connect(motorLp).connect(motorGain).connect(out);
      hissSrc.start(t);
      drumSrc.start(t, 0.31);
      lfo.start(t);
      motor.start(t);
      let stopped = false;
      const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
      return {
        set: ({ water, hit, run }) => {
          if (stopped) return;
          const now = ctx.currentTime;
          const w = clamp01(water);
          const h = clamp01(hit);
          const r = clamp01(run);
          hiss.gain.setTargetAtTime(0.0001 + 0.028 * vol * w * (h > 0 ? 0.6 : 1), now, 0.012);
          drum.gain.setTargetAtTime(0.0001 + (h > 0 ? (0.05 + 0.07 * h) * vol * w : 0), now, 0.012);
          drumBp.frequency.setTargetAtTime(520 + 900 * h, now, 0.02);
          motor.frequency.setTargetAtTime(55 + 120 * r, now, 0.05);
          motorGain.gain.setTargetAtTime(0.0001 + 0.022 * vol * r, now, 0.04);
        },
        stop: (fadeMs = 60) => {
          if (stopped) return;
          stopped = true;
          try {
            const now = ctx.currentTime;
            for (const g of [hiss.gain, drum.gain, motorGain.gain]) {
              g.cancelScheduledValues(now);
              g.setValueAtTime(Math.max(0.0001, g.value), now);
              g.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
            }
            const end = now + fadeMs / 1000 + 0.03;
            hissSrc.stop(end);
            drumSrc.stop(end);
            lfo.stop(end);
            motor.stop(end);
          } catch {
            // Already stopped.
          }
        },
      };
    } catch {
      return noop;
    }
  }

  /**
   * A sampled bed that runs until stopped: a motor, a tumbling cage, reels.
   * `name` is a cue in sfx-cues.ts whose sample is a loop. `set` moves the
   * volume (0 to 1 of the cue's level) and the playback rate, smoothed on
   * the audio clock. If the file is still loading, the bed starts when it
   * lands, unless it was stopped first. Fades in over `fadeMs`.
   */
  startLoop(name: string, options?: { volume?: number; rate?: number; fadeMs?: number }): {
    set: (state: { volume?: number; rate?: number }) => void;
    stop: (fadeMs?: number) => void;
  } {
    const noop = { set: () => {}, stop: () => {} };
    const cue = SAMPLED_CUES[name];
    if (!cue || this._muted || !this._unlocked || typeof window === 'undefined') return noop;
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return noop;
    if (this.ctx.state === 'suspended') {
      if (!navigator.userActivation?.isActive) return noop;
      void this.ctx.resume().catch(() => undefined);
    }
    const ctx = this.ctx;
    const level = cue.volume ?? 1;
    let volume = options?.volume ?? 1;
    let rate = options?.rate ?? 1;
    let stopped = false;
    let source: AudioBufferSourceNode | null = null;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.output());
    const begin = (buffer: AudioBuffer) => {
      if (stopped) return;
      const [loopStart, loopEnd] = loopBounds(buffer);
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
      source.playbackRate.value = Math.min(2, Math.max(0.25, rate * this.tintPitch()));
      source.connect(gain);
      const now = ctx.currentTime;
      source.start(now, loopStart);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, level * volume), now + (options?.fadeMs ?? 60) / 1000);
    };
    const url = SFX_BANK[cue.sfx].files[0]!;
    const ready = this.sampleBuffers.get(url);
    if (ready) begin(ready);
    else void this.loadSample(url).then((buffer) => buffer && begin(buffer));
    return {
      set: (state) => {
        if (stopped) return;
        const now = ctx.currentTime;
        if (state.volume !== undefined && Number.isFinite(state.volume)) {
          volume = Math.max(0, state.volume);
          if (source) gain.gain.setTargetAtTime(Math.max(0.0001, level * volume), now, 0.03);
        }
        if (state.rate !== undefined && Number.isFinite(state.rate)) {
          rate = state.rate;
          source?.playbackRate.setTargetAtTime(Math.min(2, Math.max(0.25, rate * this.tintPitch())), now, 0.04);
        }
      },
      stop: (fadeMs = 80) => {
        if (stopped) return;
        stopped = true;
        try {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
          gain.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
          source?.stop(now + fadeMs / 1000 + 0.02);
        } catch {
          // Already stopped.
        }
      },
    };
  }

  /**
   * For /kit/sounds: play a cue's procedural sound, or any audio file by URL
   * (an audition take), ignoring samples and cooldowns.
   */
  audition(target: { cue: string } | { url: string }, options?: { volume?: number; pitch?: number }): void {
    if (this._muted || !this._unlocked || !this.ensureContext() || !this.ctx) return;
    if ('cue' in target) {
      SOUNDS[target.cue]?.(this.ctx, this.output(), this.noiseBuffer!, options?.volume ?? 1, options?.pitch);
      return;
    }
    void this.loadSample(target.url).then((buffer) => {
      if (!buffer || !this.ctx) return;
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = options?.pitch ?? 1;
      gain.gain.value = options?.volume ?? 1;
      source.connect(gain).connect(this.output());
      source.start();
    });
  }

  /** Reactive mute and level subscription for controls mounted anywhere. */
  subscribe(listener: () => void): () => void {
    this.muteListeners.add(listener);
    return () => {
      this.muteListeners.delete(listener);
    };
  }
}

// Singleton — safe to import on server (all methods no-op without window)
export const SoundManager = new SoundManagerImpl();
