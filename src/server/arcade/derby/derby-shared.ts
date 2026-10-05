/**
 * Derby Royale — shared contract module.
 *
 * Types, constants, the horse roster, and all pure round math (odds, winner
 * draw, race-script generation). This file must remain importable from client
 * components (mirrors the swerve-replay pattern): no imports, no node APIs.
 * Randomness is injected — the server derives numeric sub-seeds from
 * HMAC-SHA256(roundSeed, label) and passes them in, so every output here is
 * deterministic and verifiable from the revealed seed.
 */

export const DERBY_HORSE_COUNT = 8;
export const DERBY_RTP = 0.96;

export const DERBY_BETTING_MS = 115_000;
export const DERBY_LOCKED_MS = 6_000;
export const DERBY_RESULTS_MS = 14_000;
export const DERBY_BET_GRACE_MS = 2_000;

export const DERBY_MIN_BET = 5;
export const DERBY_BET_INCREMENT = 5;
/* Derby bets are a shared round's pari-mutuel stakes, not a machine's: they
   stay at 250 while the ticket machines take any bet up to the balance. */
export const DERBY_MAX_BET = 250;

export const RACE_SAMPLE_MS = 500;
export const RACE_MIN_WINNER_MS = 55_000;
export const RACE_MAX_WINNER_MS = 63_000;

export type DerbyPhase = 'betting' | 'locked' | 'racing' | 'results';

export type HorsePersonality = 'front-runner' | 'stalker' | 'closer' | 'erratic';

export type DerbyHorse = {
  idx: number;
  name: string;
  /** jockey silks [primary, accent] — boardwalk enamel palette */
  silks: [string, string];
  /** painted-wood body tone */
  coat: string;
  personality: HorsePersonality;
  blurb: string;
};

/** Fixed roster. Odds SLOTS are shuffled onto horses each round, so nobody is
 * permanently the favorite; personality shapes pacing drama only, never odds. */
export const DERBY_HORSES: DerbyHorse[] = [
  { idx: 0, name: 'Bourbon Baron', silks: ['#D99A2B', '#3E2A1E'], coat: '#8A4B2A', personality: 'front-runner', blurb: 'Breaks like a shot and dares the field to catch him.' },
  { idx: 1, name: 'Tin Lizzy', silks: ['#F2E3C6', '#C6483C'], coat: '#B98A5A', personality: 'stalker', blurb: 'Sits second, waits, and rattles home late.' },
  { idx: 2, name: 'Nightjar', silks: ['#241812', '#2E7F74'], coat: '#3B2B22', personality: 'closer', blurb: 'Dead last at the turn. Then the lights go out.' },
  { idx: 3, name: 'Marmalade', silks: ['#E08A3C', '#F2E3C6'], coat: '#C97B3F', personality: 'erratic', blurb: 'Nobody knows which Marmalade shows up. Not even Marmalade.' },
  { idx: 4, name: 'Foxtrot Belle', silks: ['#C6483C', '#F2E3C6'], coat: '#A05C3B', personality: 'stalker', blurb: 'Dances through traffic like the rail owes her money.' },
  { idx: 5, name: 'Penny Whistle', silks: ['#2E7F74', '#D99A2B'], coat: '#6B4A2F', personality: 'front-runner', blurb: 'Cheap speed, expensive heartbreak — or the wire in front.' },
  { idx: 6, name: 'Thunderclap Joe', silks: ['#3E2A1E', '#B8834A'], coat: '#59341F', personality: 'closer', blurb: 'One run. Late. You will hear it before you see it.' },
  { idx: 7, name: 'Wooden Nickel', silks: ['#F2E3C6', '#2E7F74'], coat: '#C9A876', personality: 'erratic', blurb: "Don't take any wooden nickels. Unless he's 40-to-1." },
];

/** Base win-probability ladder for the 8 odds slots (favorite → longshot). */
export const DERBY_BASE_PROBS = [0.34, 0.21, 0.14, 0.1, 0.075, 0.055, 0.038, 0.027] as const;

export type RoundOdds = {
  /** display probability per horse index (post-jitter, Σ=1) */
  p: number[];
  /** display/payout multiplier per horse index, 2 decimals, source of truth for payouts */
  m: number[];
  /** which odds slot (0 = favorite ladder slot) each horse drew this round */
  slot: number[];
};

export type RaceScript = {
  /** time of last finisher + tail, ms; racing phase length */
  durationMs: number;
  /** [horse][sample] cumulative progress 0..1 every RACE_SAMPLE_MS; monotonic; winner hits 1 first */
  progress: number[][];
  /** [horse][sample] cosmetic lane drift −1..1 (identical weaving on every client) */
  lane: number[][];
  finishOrder: number[];
  finishTimesMs: number[];
  winnerIdx: number;
};

export type DerbyPublicRound = {
  id: string;
  roundNumber: number;
  phase: DerbyPhase;
  seedHash: string;
  odds: RoundOdds;
  bettingEndsAt: number;
  raceStartsAt: number | null;
  raceEndsAt: number | null;
  resultsEndAt: number | null;
  betTotals: number[];
  betCounts: number[];
  totalWagered: number;
};

export type DerbyChatMessage = { id: number; name: string; body: string; at: number };

export type DerbyRecentRound = {
  roundNumber: number;
  winnerIdx: number;
  winnerMultiplier: number;
  seed: string;
  seedHash: string;
};

export type DerbyMyBet = { horseIdx: number; amount: number; multiplier: number; payout: number | null };

export type DerbySnapshot = {
  serverNow: number;
  round: DerbyPublicRound;
  script: RaceScript | null;
  myBets: DerbyMyBet[];
  recentRounds: DerbyRecentRound[];
  chat: DerbyChatMessage[];
};

export type DerbyEvent =
  | { type: 'phase'; round: DerbyPublicRound; serverNow: number }
  | { type: 'script'; roundId: string; script: RaceScript; serverNow: number }
  | { type: 'bet'; roundId: string; horseIdx: number; amount: number; name: string; betTotals: number[]; betCounts: number[] }
  | { type: 'chat'; msg: DerbyChatMessage }
  | { type: 'results'; roundId: string; winnerIdx: number; finishOrder: number[]; seed: string; topWins: { name: string; amount: number; payout: number }[]; serverNow: number }
  | { type: 'sync'; roundId: string; phase: DerbyPhase; bettingEndsAt: number; raceStartsAt: number | null; raceEndsAt: number | null; resultsEndAt: number | null; betTotals: number[]; serverNow: number };

/* ------------------------------------------------------------------ */
/* Deterministic RNG (seeded from HMAC-derived uint32s server-side)    */
/* ------------------------------------------------------------------ */

export type Rng = () => number;

/** mulberry32 — matches the platform's arcade-rng flavor, dependency-free. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Odds                                                                */
/* ------------------------------------------------------------------ */

export function computeRoundOdds(rng: Rng): RoundOdds {
  const n = DERBY_HORSE_COUNT;
  // jitter the ladder ±15% then renormalize
  const jittered = DERBY_BASE_PROBS.map((p) => p * (0.85 + rng() * 0.3));
  const sum = jittered.reduce((a, b) => a + b, 0);
  const slotP = jittered.map((p) => p / sum);
  // Fisher–Yates: assign slots to horses
  const slotForHorse = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slotForHorse[i], slotForHorse[j]] = [slotForHorse[j], slotForHorse[i]];
  }
  const p = slotForHorse.map((s) => slotP[s]);
  const m = p.map((pi) => Math.max(1.05, Math.round((DERBY_RTP / pi) * 100) / 100));
  return { p, m, slot: slotForHorse };
}

/**
 * Winner draw over q_i ∝ 1/m_i (renormalized). Because payout uses m_i, the
 * effective RTP m_i·q_i is EXACTLY equal for all horses (≈ DERBY_RTP),
 * independent of display rounding. u01 comes from HMAC(seed, 'winner').
 */
export function drawWinner(u01: number, m: number[]): number {
  const inv = m.map((mi) => 1 / mi);
  const total = inv.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < inv.length; i++) {
    acc += inv[i] / total;
    if (u01 < acc) return i;
  }
  return inv.length - 1;
}

/** Effective per-horse RTP for a given multiplier table (for the verifier). */
export function effectiveRtp(m: number[]): number {
  const s = m.reduce((a, mi) => a + 1 / mi, 0);
  return 1 / s;
}

/* ------------------------------------------------------------------ */
/* Race script                                                         */
/* ------------------------------------------------------------------ */

type PaceParams = { pow: number; blend: number; wiggleAmp: number };

function paceParams(personality: HorsePersonality, rng: Rng): PaceParams {
  switch (personality) {
    case 'front-runner':
      return { pow: 0.78 + rng() * 0.1, blend: 0.55, wiggleAmp: 0.008 + rng() * 0.006 };
    case 'stalker':
      return { pow: 0.95 + rng() * 0.13, blend: 0.5, wiggleAmp: 0.008 + rng() * 0.006 };
    case 'closer':
      return { pow: 1.22 + rng() * 0.18, blend: 0.5, wiggleAmp: 0.008 + rng() * 0.006 };
    case 'erratic':
      return { pow: 0.85 + rng() * 0.45, blend: 0.45, wiggleAmp: 0.014 + rng() * 0.01 };
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pace warp W: [0,1]→[0,1], monotone, W(0)=0, W(1)=1.
 * Three monotone terms — linear floor, personality power curve, and a
 * front-loaded gate-break burst (real fields break hard, then sort) — plus a
 * sine wiggle that vanishes at both ends with slope bounded below the linear
 * floor, so monotonicity (and bounded acceleration) hold by construction.
 */
function makeWarp(params: PaceParams, rng: Rng): (u: number) => number {
  const { pow, blend, wiggleAmp } = params;
  // burst share: everyone lunges from the gate; front-runners most
  const burst = (pow < 1 ? 0.1 : 0.07) + rng() * 0.05;
  const linear = 1 - blend - burst;
  const waves = [1, 2, 3].map(() => ({
    f: 1 + rng() * 2.5,
    phase: rng() * Math.PI * 2,
    amp: wiggleAmp * (0.5 + rng() * 0.5),
  }));
  return (u: number) => {
    const base =
      linear * u + blend * Math.pow(u, pow) + burst * (1 - Math.pow(1 - u, 3));
    let w = 0;
    for (const wv of waves) w += wv.amp * Math.sin(2 * Math.PI * wv.f * u + wv.phase);
    return base + w * Math.sin(Math.PI * u);
  };
}

/**
 * Full deterministic race. Winner is decided BEFORE this runs (drawWinner);
 * this only choreographs a believable race that honors it:
 *  - finish times: winner first; photo finish (<400 ms margin) ~20% of rounds
 *  - remaining order via odds-weighted sampling without replacement
 *  - personality pace warps create natural lead changes
 *  - rubber-band compression keeps the pack tight until ~85% race time
 */
export function generateRaceScript(rng: Rng, winnerIdx: number, m: number[]): RaceScript {
  const n = DERBY_HORSE_COUNT;
  const winnerMs = RACE_MIN_WINNER_MS + rng() * (RACE_MAX_WINNER_MS - RACE_MIN_WINNER_MS);

  // finish order: winner, then Plackett–Luce over remaining by q ∝ 1/m
  const remaining = Array.from({ length: n }, (_, i) => i).filter((i) => i !== winnerIdx);
  const finishOrder = [winnerIdx];
  while (remaining.length > 0) {
    const weights = remaining.map((i) => 1 / m[i]);
    const total = weights.reduce((a, b) => a + b, 0);
    let u = rng() * total;
    let pick = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      u -= weights[i];
      if (u <= 0) { pick = i; break; }
    }
    finishOrder.push(remaining.splice(pick, 1)[0]);
  }

  // finish times: photo finish 20%, otherwise clear margins; tail capped
  const photo = rng() < 0.2;
  const finishTimesMs: number[] = new Array(n).fill(0);
  let t = winnerMs;
  finishTimesMs[winnerIdx] = t;
  for (let place = 1; place < n; place++) {
    const gap = place === 1
      ? photo ? 50 + rng() * 350 : 400 + rng() * 1100
      : 200 + rng() * 900;
    t += gap;
    finishTimesMs[finishOrder[place]] = t;
  }
  const lastMs = t;
  const durationMs = Math.ceil((lastMs + 800) / RACE_SAMPLE_MS) * RACE_SAMPLE_MS;
  const samples = Math.floor(durationMs / RACE_SAMPLE_MS) + 1;

  const warps = DERBY_HORSES.map((h) => makeWarp(paceParams(h.personality, rng), rng));

  // raw progress: horse i follows its warp against its own finish clock
  const progress: number[][] = Array.from({ length: n }, () => new Array(samples).fill(0));
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < samples; s++) {
      const ms = s * RACE_SAMPLE_MS;
      const u = Math.min(1, ms / finishTimesMs[i]);
      progress[i][s] = u >= 1 ? 1 : warps[i](u);
    }
  }

  // rubber-band: compress deviation from the pack mean early, release by 85%
  // of the winner's race so finish behavior (and times) are untouched
  for (let s = 0; s < samples; s++) {
    const ms = s * RACE_SAMPLE_MS;
    const uw = ms / winnerMs;
    const kappa = 0.4 + 0.6 * smoothstep(0.15, 0.88, uw);
    if (kappa >= 1) break;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += progress[i][s];
    mean /= n;
    for (let i = 0; i < n; i++) {
      if (progress[i][s] >= 1) continue;
      progress[i][s] = mean + (progress[i][s] - mean) * kappa;
    }
  }
  // compression is monotone-safe in practice, but enforce it exactly anyway
  for (let i = 0; i < n; i++) {
    for (let s = 1; s < samples; s++) {
      if (progress[i][s] < progress[i][s - 1]) progress[i][s] = progress[i][s - 1];
      if (progress[i][s] > 1) progress[i][s] = 1;
    }
  }

  // cosmetic lane drift: slow seeded wander, calm at the gate and the wire
  const lane: number[][] = Array.from({ length: n }, () => new Array(samples).fill(0));
  for (let i = 0; i < n; i++) {
    const f1 = 0.6 + rng() * 0.9;
    const f2 = 1.4 + rng() * 1.6;
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;
    const a2 = 0.25 + rng() * 0.3;
    for (let s = 0; s < samples; s++) {
      const u = Math.min(1, (s * RACE_SAMPLE_MS) / finishTimesMs[i]);
      const envelope = Math.sin(Math.PI * Math.min(1, u * 1.15));
      lane[i][s] = envelope * (0.7 * Math.sin(2 * Math.PI * f1 * u + p1) + a2 * Math.sin(2 * Math.PI * f2 * u + p2));
    }
  }

  return { durationMs, progress, lane, finishOrder, finishTimesMs, winnerIdx };
}

/** Catmull-Rom sample of a script channel at an arbitrary ms (client render). */
export function sampleScriptChannel(channel: number[], ms: number): number {
  const x = ms / RACE_SAMPLE_MS;
  const i1 = Math.floor(x);
  const t = x - i1;
  const at = (i: number) => channel[Math.min(channel.length - 1, Math.max(0, i))];
  const p0 = at(i1 - 1);
  const p1 = at(i1);
  const p2 = at(i1 + 1);
  const p3 = at(i1 + 2);
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
