/**
 * Gopher Pop — pure, deterministic pop-schedule generator + scoring sim + run
 * validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the gophers popping up so the player can bonk them) and the server score route
 * (which re-derives the exact same schedule to validate the submitted bonks).
 * Same `seed` ⇒ identical pop schedule on both sides, so the client can never
 * invent extra gophers or move bombs out of the way.
 *
 * Mechanic: a 3×3 grid of holes (indices 0..8). Over a 60-second sprint a
 * stream of "pops" is scheduled — each pop occupies one hole for a short window
 * [upStart, upEnd] and is one of:
 *   - normal gopher  — bonk for GOPHER_POINTS_NORMAL base points
 *   - golden gopher  — rare, shorter window, GOPHER_POINTS_GOLDEN base points
 *   - armored gopher — wears a helmet: the FIRST tap knocks the helmet off
 *                      (no points, does not break the combo), the SECOND tap
 *                      scores GOPHER_POINTS_ARMORED base points
 *   - bomb           — tapping it ends the run
 * Pop frequency RAMPS over the 60s (the gap between pops shrinks), so the back
 * half is busier than the warm-up. A hole is never double-booked: a new pop
 * scheduled onto a still-occupied hole is nudged to the next free slot.
 *
 * SCORING (implemented once in createGopherScorer, used verbatim by the client
 * for live feedback and by validateGopherRun for the authoritative recompute):
 *   - Base points by kind: normal 10, armored 30 (on the finishing hit),
 *     golden 50.
 *   - QUICK bonus: a bonk within GOPHER_QUICK_BONK_MS of the pop emerging
 *     multiplies the base ×1.5 (integer math: base + (base >> 1)).
 *   - COMBO: consecutive scored bonks build a streak. Multiplier tiers
 *     (applied to the quick-adjusted base, floor-rounded):
 *       streak 1–4 → ×1 · 5–9 → ×1.5 · 10–14 → ×2 · 15–19 → ×2.5 · 20+ → ×3
 *     The streak RESETS on a whiff (a tap that hits no live gopher) and when
 *     any gopher ESCAPES (its up-window expires unbonked — including an armored
 *     gopher that only had its helmet knocked off). Escapes are derived purely
 *     from the schedule + counted bonks, so a doctored bonk log cannot hide
 *     them. Bombs left alone are not escapes.
 *   - points = floor(quickBase * multiplier). All arithmetic is integer /
 *     deterministic, so client and server always agree to the point.
 *
 * Anti-cheat model (single-POST, no WebSocket):
 *  - The 60s sprint is bounded by the SERVER clock (game_sessions.started_at →
 *    validateGameSession durationMs) plus the per-bonk cadence floor enforced
 *    here. The seed is exposed in the session response, but a precomputing
 *    cheater still cannot beat the legit ceiling: every bonk must land inside a
 *    real gopher's up-window AND be spaced ≥ MIN_BONK_INTERVAL_MS from the
 *    previous counted bonk, so the maximum countable score is hard-capped by
 *    the schedule + time, not by knowledge of the stream.
 *  - The authoritative score is recomputed by replaying the submitted bonk log
 *    through the same scorer; the client-claimed number is never trusted (the
 *    route rejects a mismatch).
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** Sprint length in seconds (mirrors the session modeSec concept). */
export const GOPHER_SPRINT_DURATION_SEC = 60;

/** Sprint length in ms. */
export const GOPHER_SPRINT_DURATION_MS = GOPHER_SPRINT_DURATION_SEC * 1000;

/** Number of holes in the grid (3×3). */
export const GOPHER_HOLE_COUNT = 9;

/** Hard window for accepting a bonk's client timestamp `t` (ms).
 *  60s sprint + 2s grace for the final tap / network skew. */
export const GOPHER_MAX_BONK_T_MS = 62_000;

/** Minimum spacing between consecutive counted bonks (ms). A human cannot
 *  legitimately tap two distinct gophers faster than this; anything tighter is
 *  dropped (not counted) — protects the time-bounded ceiling. */
export const GOPHER_MIN_BONK_INTERVAL_MS = 90;

/** Absolute ceiling on how many bonks (scoring hits + armor breaks) we will
 *  ever count for one run. 62_000ms / 90ms ≈ 688; round down to a safe cap that
 *  also bounds the schedule length we ever generate. */
export const GOPHER_MAX_BONKS = 600;

/** Bonking within this window of the pop emerging earns the QUICK bonus. */
export const GOPHER_QUICK_BONK_MS = 380;

/** Base points per kind (armored pays on the finishing hit). */
export const GOPHER_POINTS_NORMAL = 10;
export const GOPHER_POINTS_ARMORED = 30;
export const GOPHER_POINTS_GOLDEN = 50;

/** Generous ceiling on a single run's total score, used by the route's coarse
 *  plausibility cap. A literally perfect run (every gopher bonked inside the
 *  QUICK window with a never-broken 20+ streak) computes to ≈5,000–5,500 pts;
 *  this stays a wide upper bound, never a tight one. */
export const GOPHER_MAX_RUN_SCORE = 15_000;

/** First-pop delay before the very first gopher appears (ms). */
const FIRST_POP_DELAY_MS = 650;

/** Pop gap (ms) between successive scheduled pops at the START of the sprint
 *  (slow warm-up) and at the END (fast finish). The gap is interpolated by sprint
 *  progress so frequency ramps smoothly. A small per-pop jitter is added. */
const GAP_START_MS = 900;
const GAP_END_MS = 360;
const GAP_JITTER_MS = 180;

/** How long a gopher / bomb stays up (ms). The up-window also shrinks slightly
 *  as the sprint progresses, so late gophers are quicker to bonk. */
const UP_MS_START = 900;
const UP_MS_END = 600;
const UP_MS_JITTER = 160;

/** Probability that a given pop is a BOMB instead of a gopher. Ramps up modestly
 *  so the danger rises with the pace (still mostly gophers). */
const BOMB_CHANCE_START = 0.08;
const BOMB_CHANCE_END = 0.2;

/** Special gopher odds (drawn only for non-bomb pops, from one shared roll).
 *  Golden is a flat rarity; armored ramps in as the sprint heats up. */
const GOLDEN_CHANCE = 0.05;
const ARMORED_CHANCE_START = 0;
const ARMORED_CHANCE_END = 0.18;

/** Up-window scale for specials: golden is snappier (harder to catch), armored
 *  lingers a touch longer (it needs two taps). */
const GOLDEN_UP_SCALE = 0.8;
const ARMORED_UP_SCALE = 1.15;

/** Safety cap on schedule length (defensive — the time window bounds it anyway). */
const MAX_SCHEDULE_LEN = GOPHER_MAX_BONKS + 64;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (math-sprint,
// typing-words, sequence-replay). Returns a function producing floats in [0, 1).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

/** What pops out of a hole. */
export type GopherKind = 'normal' | 'golden' | 'armored' | 'bomb';

export interface GopherPop {
  /** 0-based position in the deterministic stream. */
  index: number;
  /** Hole index 0..GOPHER_HOLE_COUNT-1. */
  hole: number;
  /** When the pop emerges (ms since sprint start). */
  upStart: number;
  /** When the pop has fully ducked back (ms since sprint start). Bonkable while
   *  upStart ≤ t ≤ upEnd. */
  upEnd: number;
  /** True ⇒ this is a bomb (hitting it ends the run). Mirror of kind==='bomb'. */
  isBomb: boolean;
  /** Pop kind: normal / golden / armored gopher, or bomb. */
  kind: GopherKind;
}

function lerp(a: number, b: number, tNorm: number): number {
  return a + (b - a) * tNorm;
}

/**
 * Pure, deterministic pop schedule for a seed. Identical output on the client and
 * the server. Pops are generated sequentially in time; each one's hole is chosen
 * so it never overlaps another still-up pop in the SAME hole (we pick a free hole,
 * preferring the RNG's choice but scanning forward if it's busy). Generation stops
 * once a pop's upStart would exceed the sprint window (or the safety cap is hit).
 *
 * RNG draw order per pop is FIXED (up-jitter, hole, bomb, special, gap) so the
 * stream stays stable regardless of any branching.
 *
 * The returned array is sorted by `upStart` ascending (generation order already
 * is monotonic in time).
 */
export function deriveGopherSchedule(seed: number): GopherPop[] {
  const rng = mulberry32(seed | 0);
  const pops: GopherPop[] = [];

  // Per-hole "busy until" tracker so a hole is never double-booked.
  const holeBusyUntil = new Array<number>(GOPHER_HOLE_COUNT).fill(-Infinity);

  let cursor = FIRST_POP_DELAY_MS;
  let index = 0;

  while (cursor < GOPHER_SPRINT_DURATION_MS && pops.length < MAX_SCHEDULE_LEN) {
    // Sprint progress 0..1 used to ramp gap, up-time, bomb + armored chance.
    const progress = Math.max(
      0,
      Math.min(1, cursor / GOPHER_SPRINT_DURATION_MS),
    );

    // Draw 1 — up-window jitter (length shrinks as the sprint speeds up).
    const upBase = lerp(UP_MS_START, UP_MS_END, progress);
    const upDraw = rng();

    // Draw 2 — hole pick. Choose a hole that is currently free (its previous
    // occupant has ducked). Start from the RNG's pick and scan forward to the
    // next free hole; if every hole is somehow busy, fall back to the RNG pick
    // (shouldn't happen with 9 holes and these gaps, but keeps generation total
    // + deterministic). The probe loop consumes no RNG.
    const upStart = Math.round(cursor);
    const pick = Math.floor(rng() * GOPHER_HOLE_COUNT) % GOPHER_HOLE_COUNT;
    let hole = pick;
    for (let probe = 0; probe < GOPHER_HOLE_COUNT; probe += 1) {
      const candidate = (pick + probe) % GOPHER_HOLE_COUNT;
      if (holeBusyUntil[candidate]! <= upStart) {
        hole = candidate;
        break;
      }
    }

    // Draw 3 — bomb or gopher (ramps with progress).
    const bombChance = lerp(BOMB_CHANCE_START, BOMB_CHANCE_END, progress);
    const isBomb = rng() < bombChance;

    // Draw 4 — special roll (ALWAYS drawn, even for bombs, so the stream never
    // shifts). Non-bomb pops become golden (flat rarity) or armored (ramps in).
    const specialRoll = rng();
    let kind: GopherKind = 'normal';
    if (isBomb) {
      kind = 'bomb';
    } else if (specialRoll < GOLDEN_CHANCE) {
      kind = 'golden';
    } else if (
      specialRoll <
      GOLDEN_CHANCE + lerp(ARMORED_CHANCE_START, ARMORED_CHANCE_END, progress)
    ) {
      kind = 'armored';
    }

    // Up-window length for this pop (kind-scaled; clamped to a sane minimum,
    // and the end clamped so a pop near 60s still has a non-negative window).
    let upMs = Math.round(upBase + (upDraw - 0.5) * 2 * UP_MS_JITTER);
    if (kind === 'golden') upMs = Math.round(upMs * GOLDEN_UP_SCALE);
    else if (kind === 'armored') upMs = Math.round(upMs * ARMORED_UP_SCALE);
    const upEnd = Math.min(
      GOPHER_MAX_BONK_T_MS,
      upStart + Math.max(260, upMs),
    );

    pops.push({ index, hole, upStart, upEnd, isBomb, kind });
    holeBusyUntil[hole] = upEnd;
    index += 1;

    // Draw 5 — advance the cursor by the ramped gap (+ jitter) to the next pop.
    const gapBase = lerp(GAP_START_MS, GAP_END_MS, progress);
    const gap = gapBase + (rng() - 0.5) * 2 * GAP_JITTER_MS;
    cursor += Math.max(140, gap);
  }

  return pops;
}

// ---------------------------------------------------------------------------
// Scoring — combo multiplier tiers + per-bonk points (all integer math)
// ---------------------------------------------------------------------------

/** Combo multiplier ×2 (so half-steps stay integers): 2 ⇒ ×1 … 6 ⇒ ×3.
 *  `streak` is the count of consecutive scored bonks INCLUDING the current one. */
export function gopherComboMultiplierX2(streak: number): number {
  if (streak >= 20) return 6;
  if (streak >= 15) return 5;
  if (streak >= 10) return 4;
  if (streak >= 5) return 3;
  return 2;
}

/** Base points for a scoring hit of `kind` (bombs never score). */
export function gopherBasePoints(kind: GopherKind): number {
  if (kind === 'golden') return GOPHER_POINTS_GOLDEN;
  if (kind === 'armored') return GOPHER_POINTS_ARMORED;
  return GOPHER_POINTS_NORMAL;
}

/** Points for one scoring bonk: quick-adjusted base × combo multiplier,
 *  floor-rounded. Pure integer math ⇒ bit-identical on client + server. */
export function gopherBonkPoints(
  kind: GopherKind,
  quick: boolean,
  streak: number,
): number {
  let base = gopherBasePoints(kind);
  if (quick) base = base + (base >> 1); // ×1.5 in integer math
  return Math.floor((base * gopherComboMultiplierX2(streak)) / 2);
}

// ---------------------------------------------------------------------------
// Deterministic run scorer — the ONE state machine both sides step through.
// ---------------------------------------------------------------------------

/** A gopher whose up-window expired unbonked (streak breaker). */
export interface GopherEscape {
  popIndex: number;
  hole: number;
  kind: GopherKind;
  /** True if the streak was > 0 when this escape reset it. */
  brokeStreak: boolean;
  /** The streak value the escape wiped out. */
  prevStreak: number;
}

export type GopherBonkOutcome =
  /** Tapped a live bomb — the run is over; nothing after this scores. */
  | { type: 'bomb'; popIndex: number }
  /** No live, unbonked gopher in that hole — the combo resets. */
  | { type: 'whiff'; brokeStreak: boolean; prevStreak: number }
  /** Tap ignored entirely (cadence floor / counted cap / post-bomb). Does NOT
   *  break the combo — mirrors the server dropping the entry. */
  | { type: 'ignored' }
  /** First hit on an armored gopher: helmet off, no points, combo preserved. */
  | { type: 'armor-break'; popIndex: number }
  /** A scoring hit. */
  | {
      type: 'score';
      popIndex: number;
      kind: GopherKind;
      points: number;
      /** Streak including this bonk. */
      streak: number;
      /** Multiplier ×2 applied to this bonk (2 ⇒ ×1 … 6 ⇒ ×3). */
      multX2: number;
      quick: boolean;
    };

export interface GopherScorer {
  /** Process every escape strictly BEFORE time `t` (ms). Idempotent + monotonic;
   *  returns the escapes newly processed. `bonk()` calls this internally, so
   *  feeding only taps (the server) or taps + per-frame ticks (the client)
   *  produces the same state. Always pass INTEGER ms (the client floors its
   *  clock exactly like the submitted bonk timestamps). */
  advanceTo(t: number): GopherEscape[];
  /** Step one tap through the machine. `t` must be integer ms, non-decreasing. */
  bonk(hole: number, t: number): GopherBonkOutcome;
  /** Whether a pop has been fully scored (renders as bonked/ducked). */
  isUsed(popIndex: number): boolean;
  /** Whether an armored pop has lost its helmet. */
  isArmorBroken(popIndex: number): boolean;
  readonly score: number;
  readonly streak: number;
  readonly bestStreak: number;
  /** Counted inputs: scoring hits + armor breaks. */
  readonly counted: number;
  readonly bombHit: boolean;
}

export function createGopherScorer(
  schedule: readonly GopherPop[],
): GopherScorer {
  // Escape processing order = ascending upEnd (upStart order is not enough —
  // window lengths vary). Bombs never escape.
  const byUpEnd = schedule
    .filter((pop) => pop.kind !== 'bomb')
    .slice()
    .sort((a, b) => a.upEnd - b.upEnd || a.index - b.index);

  let escapeCursor = 0;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let counted = 0;
  let bombHit = false;
  let lastCountedT = -Infinity;
  const used = new Set<number>();
  const armorBroken = new Set<number>();

  const advanceTo = (t: number): GopherEscape[] => {
    const escapes: GopherEscape[] = [];
    while (
      escapeCursor < byUpEnd.length &&
      byUpEnd[escapeCursor]!.upEnd < t
    ) {
      const pop = byUpEnd[escapeCursor]!;
      escapeCursor += 1;
      if (used.has(pop.index)) continue; // bonked in time — no escape
      const prevStreak = streak;
      const brokeStreak = streak > 0;
      streak = 0;
      escapes.push({
        popIndex: pop.index,
        hole: pop.hole,
        kind: pop.kind,
        brokeStreak,
        prevStreak,
      });
    }
    return escapes;
  };

  const bonk = (hole: number, t: number): GopherBonkOutcome => {
    advanceTo(t);
    if (bombHit) return { type: 'ignored' };

    // Find the pop that is up at this hole at time t. Holes are never
    // double-booked, so at most one pop is live here; a live bomb dominates.
    let live: GopherPop | null = null;
    for (let i = 0; i < schedule.length; i += 1) {
      const pop = schedule[i]!;
      if (pop.hole !== hole) continue;
      if (t < pop.upStart || t > pop.upEnd) continue;
      if (pop.kind === 'bomb') {
        live = pop;
        break;
      }
      if (!used.has(pop.index)) {
        live = pop;
        break;
      }
    }

    if (live && live.kind === 'bomb') {
      bombHit = true;
      return { type: 'bomb', popIndex: live.index };
    }

    if (!live) {
      // Empty hole / ducked gopher / already-bonked pop → whiff, combo resets.
      const prevStreak = streak;
      const brokeStreak = streak > 0;
      streak = 0;
      return { type: 'whiff', brokeStreak, prevStreak };
    }

    // Cadence floor + counted cap — the tap is silently ignored (the server
    // drops the entry without scoring it, so it must not mutate combo state).
    if (counted >= GOPHER_MAX_BONKS) return { type: 'ignored' };
    if (
      lastCountedT !== -Infinity &&
      t - lastCountedT < GOPHER_MIN_BONK_INTERVAL_MS
    ) {
      return { type: 'ignored' };
    }

    if (live.kind === 'armored' && !armorBroken.has(live.index)) {
      armorBroken.add(live.index);
      lastCountedT = t;
      counted += 1;
      return { type: 'armor-break', popIndex: live.index };
    }

    used.add(live.index);
    lastCountedT = t;
    counted += 1;
    streak += 1;
    if (streak > bestStreak) bestStreak = streak;
    const quick = t - live.upStart <= GOPHER_QUICK_BONK_MS;
    const multX2 = gopherComboMultiplierX2(streak);
    const points = gopherBonkPoints(live.kind, quick, streak);
    score += points;
    return {
      type: 'score',
      popIndex: live.index,
      kind: live.kind,
      points,
      streak,
      multX2,
      quick,
    };
  };

  return {
    advanceTo,
    bonk,
    isUsed: (popIndex) => used.has(popIndex),
    isArmorBroken: (popIndex) => armorBroken.has(popIndex),
    get score() {
      return score;
    },
    get streak() {
      return streak;
    },
    get bestStreak() {
      return bestStreak;
    },
    get counted() {
      return counted;
    },
    get bombHit() {
      return bombHit;
    },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One submitted bonk from the client. `t` = ms since the sprint started (client
 *  clock — used only for window/cadence sanity; the authoritative elapsed time is
 *  the server session durationMs). `hole` is the grid hole that was tapped. */
export interface GopherBonk {
  hole: number;
  t: number;
}

export interface GopherRunResult {
  /** Authoritative score = points from the deterministic scorer replay. */
  score: number;
  /** How many submitted taps were counted (scoring hits + armor breaks). */
  counted: number;
  /** Bonks dropped as malformed / out-of-window / too-fast / no-gopher / dup. */
  dropped: number;
  /** True if a bomb was bonked (the run stops counting at that point). */
  bombHit: boolean;
  /** Longest combo streak of the run. */
  bestStreak: number;
}

/**
 * Re-derive the authoritative score from a submitted bonk list.
 *
 * Algorithm:
 *  - Re-derive the deterministic schedule from the seed.
 *  - Sort the submitted bonks by `t` (so out-of-order delivery doesn't unfairly
 *    drop valid bonks), then walk them in time order through the SAME scorer
 *    state machine the client used live (escapes between taps are processed
 *    lazily inside the scorer, so hidden whiffs can't fake a combo).
 *  - The first bonk that lands on a live BOMB STOPS the run: nothing after it
 *    is counted (mirrors the client ending on a bomb).
 *
 * The function is pure and never throws on bad input — malformed entries are
 * simply dropped.
 */
export function validateGopherRun(
  seed: number,
  bonks: readonly GopherBonk[],
  durationMs: number,
): GopherRunResult {
  if (!Array.isArray(bonks) || bonks.length === 0) {
    return { score: 0, counted: 0, dropped: 0, bombHit: false, bestStreak: 0 };
  }

  const schedule = deriveGopherSchedule(seed);

  // Upper bound for acceptable `t`: the smaller of the hard 62s window and the
  // server-measured elapsed time plus a small grace for the final tap.
  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(GOPHER_MAX_BONK_T_MS, durationMs + 1_500)
      : GOPHER_MAX_BONK_T_MS;

  const candidates = bonks
    .filter(
      (entry): entry is GopherBonk =>
        !!entry &&
        Number.isInteger(entry.hole) &&
        entry.hole >= 0 &&
        entry.hole < GOPHER_HOLE_COUNT &&
        typeof entry.t === 'number' &&
        Number.isFinite(entry.t),
    )
    .slice()
    .sort((x, y) => x.t - y.t);

  const scorer = createGopherScorer(schedule);
  let dropped = bonks.length - candidates.length;

  for (const entry of candidates) {
    if (scorer.bombHit) {
      // Run already ended on a bomb — ignore everything after it.
      dropped += 1;
      continue;
    }
    // Window check (the honest client only ever submits integer t ≥ 0).
    const t = Math.floor(entry.t);
    if (t < 0 || t > serverWindowMs) {
      dropped += 1;
      continue;
    }
    const outcome = scorer.bonk(entry.hole, t);
    if (outcome.type !== 'score' && outcome.type !== 'armor-break') {
      dropped += 1;
    }
  }

  return {
    score: scorer.score,
    counted: scorer.counted,
    dropped,
    bombHit: scorer.bombHit,
    bestStreak: scorer.bestStreak,
  };
}
