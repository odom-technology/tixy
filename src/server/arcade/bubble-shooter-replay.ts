// ──────────────────────────────────────────────────────────────────────────
// GUMBALL DROP — server-side authoritative EVENT-PLAUSIBILITY bound-checker.
//
// (The slug, score table, reward curve and leaderboard all stay 'bubble-shooter'
// — this file just swaps the GAME the slug runs to our Suika-style merge game.)
//
// This is a PURE module (no DB, no IO, no Date.now/Math.random). A Suika-style
// merge game runs a soft-body-ish circle physics sim whose floats can't be
// re-simulated byte-for-byte on the server, so — exactly like sky-climber and
// flappy — the server does NOT replay the physics. Instead the client records a
// compact, ordered event log and the server BOUND-CHECKS it against a strict
// CONSERVATION INVARIANT plus timing/window bounds, and recomputes the score
// from the merge tiers alone.
//
// Game model:
//   • A tall jar. The player slides a drop position left/right at the top and
//     drops the "current" gumball. Gumballs are physics circles that fall, pile
//     up, and when two of the SAME tier touch they MERGE into one gumball of the
//     next tier (bigger), scoring points (more for higher merges).
//   • There are TIER_COUNT tiers (0 = smallest … MAX_TIER = the "watermelon").
//     Dropped gumballs are always one of the smallest few tiers (0..MAX_DROP_TIER),
//     and which one is SEED-DERIVED per drop ordinal (so the client can't choose
//     a fat ball — the queue is fixed and fair, and the server can re-derive it).
//   • Merging the two biggest (tier MAX_TIER) removes both for a jackpot.
//   • You LOSE when the pile overflows above the top fill-line (client-side; the
//     server never needs the lose condition — it only bound-checks the log).
//
// Event log (POSTed in the score body, NOT over WS): an ORDERED list of
//   { type:'drop', t }                — a gumball was dropped (tier is seed-fixed)
//   { type:'merge', tier:k, t }       — two tier-k gumballs merged into a tier-(k+1)
// `t` = ms since the run began (client clock; used only for cadence/window sanity
// — the authoritative elapsed is the server session durationMs).
//
// AUTHORITATIVE score = Σ MERGE_POINTS[tier] over every VALID merge event. The
// client's claimed score must equal this exactly (the route rejects on mismatch),
// so a client can never inflate the score: every point is recomputed from the
// merge tiers, and a merge tier is only accepted if it is physically reachable.
//
// WHY THE SCORE CANNOT BE INFLATED (the conservation invariant):
//   We walk the events in time order maintaining an inventory count[tier] of how
//   many gumballs of each tier currently exist:
//     • a DROP adds one gumball of the seed-derived tier for that drop ordinal,
//     • a MERGE of tier k REQUIRES count[k] ≥ 2 (else REJECT), consumes the two,
//       and (for k < MAX_TIER) produces one tier-(k+1).
//   So a tier-k merge is impossible without first having produced two tier-k
//   gumballs, which (for k ≥ 1) can ONLY come from earlier tier-(k-1) merges. By
//   induction, one tier-k merge requires 2^k tier-0-equivalent gumballs, i.e.
//   ~2^k real DROPS — and drops are rate-limited (MIN_DROP_INTERVAL_MS) and must
//   fall inside the server-measured session window. A faked high-tier merge spree
//   would need a physically impossible number of drops in the elapsed time, so
//   the timing bound caps the score by REAL TIME and the conservation bound caps
//   it by what was actually produced. Forging the log buys nothing.
//
// The CLIENT imports MERGE_POINTS / dropTierForOrdinal / TIER_RADII so its live
// score + drop queue are computed by identical logic — guaranteeing client ===
// server.
// ──────────────────────────────────────────────────────────────────────────

// ── Tier table (the client mirrors these for radii / merge logic) ──────────

/** Number of gumball tiers (0 = smallest … MAX_TIER = the "watermelon"). */
export const TIER_COUNT = 10;

/** The biggest tier. Merging two of these removes both for a jackpot. */
export const MAX_TIER = TIER_COUNT - 1; // 9

/** Dropped gumballs are always tier 0..MAX_DROP_TIER (the smallest few). The
 *  exact tier per drop is seed-derived (see dropTierForOrdinal). */
export const MAX_DROP_TIER = 2;

/** Logical radius (px) of each tier, smallest → biggest. The server never uses
 *  these (geometry isn't validated) — they're exported so the CLIENT physics and
 *  the next/preview UI read one source of truth. */
export const TIER_RADII: readonly number[] = [
  // Scaled up ~1.3x (2026-06) to shorten rounds: bigger gumballs eat vertical
  // space faster AND fewer fit per row (harder to line up merges), so the jar
  // tops out in a few minutes instead of 20+. Server never uses these (geometry
  // isn't validated) — they only drive the client physics + render.
  16, 20, 25, 31, 39, 48, 59, 70, 83, 98,
];

/**
 * Points scored when a merge of tier `k` happens (two tier-k → one tier-(k+1),
 * or the tier-MAX jackpot). Triangular growth ×10 so chasing big merges and
 * chains is where the score lives; the jackpot is a flat bonus. Index = the
 * INPUT tier of the merge (the tier of the two balls that touched).
 *   k:  0   1   2    3    4    5    6    7    8    9(=jackpot)
 */
export const MERGE_POINTS: readonly number[] = [
  10, 30, 60, 100, 150, 210, 280, 360, 450, 1000,
];

/** Points for a merge whose input tier is `k`. Pure; 0 for out-of-range. */
export const pointsForTier = (k: number): number =>
  Number.isInteger(k) && k >= 0 && k <= MAX_TIER ? MERGE_POINTS[k]! : 0;

// ── Anti-cheat bounds ──────────────────────────────────────────────────────

/** Hard ceiling on an authoritative run score (defense in depth alongside the
 *  route's client-score cap + the anti-cheat absolute limit). */
export const BUBBLE_SCORE_CAP = 5_000_000;

/** Max events (drops + merges) a legit run can record. Anything larger is
 *  rejected before any work. A drop + its (bounded) merges is a handful of
 *  events; a long marathon stays well under this. */
export const GUMBALL_MAX_EVENTS = 60_000;

/** Minimum wall-clock between consecutive DROPS. A human (and the client's own
 *  post-drop cooldown) cannot release gumballs faster than this; it caps how many
 *  drops — and therefore how much inventory, and therefore how much score — can
 *  be claimed inside the real session window. Generous so honest fast play never
 *  trips it, strict enough that the score is bounded by REAL TIME. */
export const MIN_DROP_INTERVAL_MS = 200;

/** Slack added to the session window for clock skew / submit latency. */
export const GUMBALL_GRACE_MS = 2000;

/** Tolerance subtracted from MIN_DROP_INTERVAL_MS for the per-gap drop check, so
 *  honest client jitter / rounding never false-rejects a legitimately fast-but-
 *  fair drop (ms). Well under the client's own ~340ms post-drop cooldown. */
export const DROP_GAP_GRACE_MS = 50;

// Back-compat aliases (the route / theme previously imported these names). The
// values are re-pointed at the Gumball Drop equivalents.
export const NUM_COLORS = TIER_COUNT;
export const BUBBLE_MAX_SHOTS = GUMBALL_MAX_EVENTS;

// ── Seeded RNG — identical mulberry32 to the client + the other replays ─────
const createSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * The tier of the `ordinal`-th DROPPED gumball (0-based), derived purely from the
 * seed. Mixing the ordinal into the seed (golden-ratio constant, all 32-bit)
 * makes this O(1) and order-independent so the client + server agree without any
 * shared cross-drop RNG state (mirrors the bubble queue / swerve rngForRow trick).
 *
 * Distribution is weighted toward the smallest tier so merges stay meaningful:
 *   tier 0 ≈ 60%, tier 1 ≈ 30%, tier 2 ≈ 10%. If no seed is supplied (guest /
 *   legacy), everything drops as tier 0 — still fully self-consistent.
 */
export const dropTierForOrdinal = (
  seed: number | null | undefined,
  ordinal: number,
): number => {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return 0;
  let mixed = (Math.trunc(seed) ^ Math.imul(ordinal + 1, 0x9e3779b1)) | 0;
  mixed = (mixed ^ 0x85ebca6b) | 0;
  const roll = createSeededRng(mixed >>> 0)();
  if (roll < 0.6) return 0;
  if (roll < 0.9) return 1;
  return 2;
};

// ── Recorded event + result shapes ─────────────────────────────────────────

/** One recorded event. `drop` = the player released a gumball (its tier is
 *  seed-fixed, never client-chosen). `merge` = two tier-`tier` gumballs touched
 *  and merged. `t` = ms since the run began (client clock). */
export type GumballEvent = {
  type: 'drop' | 'merge';
  /** Present (and authoritative for scoring) on merge events: the INPUT tier. */
  tier?: number;
  t: number;
};

export type GumballReplayResult = {
  /** Authoritative score = Σ MERGE_POINTS[tier] over valid merges (capped). */
  score: number;
  /** How many events were validated before the run was fully consumed. */
  counted: number;
  /** How many DROP events were counted (used by the route's bounds/telemetry). */
  drops: number;
  /** How many MERGE events were counted. */
  merges: number;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
  /** True if the run landed at least one tier-MAX jackpot merge. */
  won: boolean;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Verify a recorded Gumball Drop run and return the authoritative score.
 *
 * Walks the events in time order maintaining the per-tier inventory, enforcing:
 *   1. structural validity (known type, finite t ≥ 0, integer merge tier in range),
 *   2. the CONSERVATION invariant (a tier-k merge needs count[k] ≥ 2; a drop adds
 *      the seed-derived tier; a non-jackpot merge produces one of the next tier),
 *   3. timing: drops spaced ≥ MIN_DROP_INTERVAL_MS apart, every event inside the
 *      server session window, and the drop count ≤ what fits in that window.
 * The score is recomputed entirely from the merge tiers; the route compares it to
 * the client's claim and rejects on mismatch.
 *
 * Pure + never throws. Any structural / conservation / timing violation rejects
 * the whole run (a cheat signal, mirroring the other bound-checkers).
 *
 * @param rawEvents recorded events ({ type, tier?, t })
 * @param durationMs the bounded server session/replay duration in ms
 * @param seed       the server `bubbleSeed` for this session (drop-tier queue)
 */
export const replayGumballDropSession = (
  rawEvents: GumballEvent[],
  durationMs: number,
  seed?: number | null,
): GumballReplayResult => {
  const reject = (reason: string): GumballReplayResult => ({
    score: 0,
    counted: 0,
    drops: 0,
    merges: 0,
    rejected: true,
    reason,
    won: false,
  });

  if (!Array.isArray(rawEvents)) return reject('Events payload missing');
  if (rawEvents.length > GUMBALL_MAX_EVENTS) {
    return reject(`Event payload too large (${rawEvents.length})`);
  }
  if (rawEvents.length === 0) {
    return {
      score: 0,
      counted: 0,
      drops: 0,
      merges: 0,
      rejected: false,
      reason: null,
      won: false,
    };
  }

  // Keep only well-formed entries, then order by time (stable on original index).
  // Sorting by `t` means out-of-order delivery / client batching can't reorder
  // the run; the conservation walk below is what enforces causality.
  const clean = rawEvents
    .map((e, i) => ({
      type: e?.type,
      tier: Number((e as GumballEvent)?.tier),
      t: Number((e as GumballEvent)?.t),
      idx: i,
    }))
    .filter(
      (e) =>
        (e.type === 'drop' || e.type === 'merge') &&
        isFiniteNumber(e.t) &&
        e.t >= 0,
    )
    .sort((a, b) => a.t - b.t || a.idx - b.idx);

  if (clean.length === 0) return reject('No well-formed events');

  // The bounded upper edge for any event timestamp: the server-measured elapsed
  // plus a little grace for the final event / network skew. The client clock is
  // only sanity-checked; the server session duration is the real elapsed.
  const windowMs =
    isFiniteNumber(durationMs) && durationMs > 0
      ? durationMs + GUMBALL_GRACE_MS
      : Number.POSITIVE_INFINITY;

  // Inventory of gumballs currently in the jar, indexed by tier.
  const count = new Array<number>(TIER_COUNT).fill(0);
  let score = 0;
  let counted = 0;
  let drops = 0;
  let merges = 0;
  let won = false;
  let dropOrdinal = 0;
  let prevDropT = -Infinity;

  for (const ev of clean) {
    if (ev.t > windowMs) {
      return reject(
        `Event outside session window (t=${Math.round(ev.t)}ms > ${Math.round(windowMs)}ms)`,
      );
    }

    if (ev.type === 'drop') {
      // ── Cadence: a human / the client cooldown can't drop faster than this. ──
      if (prevDropT !== -Infinity) {
        const gap = ev.t - prevDropT;
        if (gap < MIN_DROP_INTERVAL_MS - DROP_GAP_GRACE_MS) {
          return reject(
            `Drops too fast (gap=${Math.round(gap)}ms < ${MIN_DROP_INTERVAL_MS}ms)`,
          );
        }
      }
      const tier = dropTierForOrdinal(seed, dropOrdinal);
      count[tier] += 1;
      dropOrdinal += 1;
      drops += 1;
      prevDropT = ev.t;
      counted += 1;
      continue;
    }

    // ── Merge: enforce the conservation invariant + recompute the score. ──
    const k = ev.tier;
    if (!Number.isInteger(k) || k < 0 || k > MAX_TIER) {
      return reject(`Merge with invalid tier (${ev.tier})`);
    }
    if (count[k]! < 2) {
      return reject(
        `Impossible tier-${k} merge (have ${count[k]} of that tier, need 2)`,
      );
    }
    count[k]! -= 2;
    if (k < MAX_TIER) {
      count[k + 1]! += 1;
    } else {
      // Jackpot: two biggest gumballs vanish (nothing produced).
      won = true;
    }
    score += MERGE_POINTS[k]!;
    merges += 1;
    counted += 1;

    if (score >= BUBBLE_SCORE_CAP) {
      score = BUBBLE_SCORE_CAP;
      break;
    }
  }

  // ── Window bound: the drop count can't exceed what is physically droppable in
  //    the elapsed window at MIN_DROP_INTERVAL_MS apart (defense in depth on top
  //    of the per-gap check, in case of clustered timestamps). ──
  if (Number.isFinite(windowMs)) {
    const maxDrops = Math.floor(windowMs / MIN_DROP_INTERVAL_MS) + 8;
    if (drops > maxDrops) {
      return reject(
        `Too many drops (${drops}) for the elapsed window (${Math.round(windowMs)}ms)`,
      );
    }
  }

  // ── Cheap structural guard subsumed by conservation: total merges can never
  //    exceed total drops (each merge nets at least one gumball away). ──
  if (merges > drops) {
    return reject(`More merges (${merges}) than drops (${drops})`);
  }

  return {
    score: Math.min(BUBBLE_SCORE_CAP, score),
    counted,
    drops,
    merges,
    rejected: false,
    reason: null,
    won,
  };
};

/** Alias kept to match a `validateGumballRun` naming if preferred. */
export const validateGumballRun = replayGumballDropSession;
