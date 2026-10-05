// ──────────────────────────────────────────────────────────────────────────
// SKY CLIMBER — server-side authoritative LAYOUT + event-plausibility verifier.
//
// This is a PURE module (no DB, no IO, no Date.now/Math.random). Continuous
// physics games can't be re-simulated float-exact, so instead of replaying the
// jumper's arc the server BOUND-CHECKS the recorded landing stream against the
// seed-derived platform layout (the Flappy/Breakout model).
//
// Game model (single-POST, seed-deterministic, vertical endless climber):
//   • A jumper auto-bounces UP a vertical playfield. The player only steers it
//     left/right (the screen wraps); the bounce is automatic.
//   • The layout is one platform per ROW, stacked upward. Row r's platform x and
//     TYPE are derived purely from the session seed (skySeed → mulberry32), so
//     the client and server agree on the layout and the server can re-derive
//     every platform's type without trusting the client.
//   • A normal/moving/breakable platform launches the jumper up to NORMAL_REACH
//     rows; a spring launches it up to SPRING_REACH rows. So from a platform at
//     row a you can next land on any platform in (a, a + reach(type_a)] — you
//     physically cannot reach higher than the launch carries you, and there is
//     always a platform within reach (one per row).
//   • A "landing" is recorded as { row, t }: the jumper bounced off the platform
//     at `row`, `t` ms since the run began. Falling below the view ends the run.
//   • SCORE = the highest platform row the jumper landed on (max height, in rows
//     — clean integers). The float apex overshoot above the last platform is
//     cosmetic and never scored, so the number is fully verifiable.
//
// AUTHORITATIVE score = the highest row reached in a TIME-ORDERED bounce chain
// where ALL hold:
//   1. the chain starts reachable from row 0 (the start platform). Landings are
//      processed in arrival-time order — the jumper may bounce UP and also fall
//      back DOWN onto a lower platform (so a spring BELOW the current peak still
//      boosts you), so rows are NOT required to strictly increase and may repeat,
//   2. every UPWARD step row_b − row_a ≤ reach(type_a), where type_a is re-derived
//      from the seed (the client's claim is never trusted) — you can't ascend more
//      rows than the launch power of the platform you left allows. Downward/level
//      hops (falling onto a lower or same platform) are always physically allowed,
//   3. timing respects the bounce physics: consecutive landings are spaced at
//      least the per-launch minimum airtime apart (a jumper cannot land again
//      before its arc could carry it — true for up AND down hops, since landing
//      lower than the launch takes even longer), AND every landing falls inside
//      the bounded server session window. Reject impossibly-fast / teleporting runs.
// The score route compares the client-claimed score to this highest row and
// rejects on mismatch. Height still requires a chain of seed-typed upward hops,
// each costing min airtime, so the reach bound caps height by the SEEDED LAYOUT
// and the min-airtime bound caps it by TIME — down-hops only waste time and can't
// inflate the score, and the (non-secret) layout buys nothing.
//
// Everything here is pure: no Date.now(), no Math.random(), no I/O. The CLIENT
// imports these same constants + platformForRow so its live render and live
// score are computed by identical logic — guaranteeing client === server.
// ──────────────────────────────────────────────────────────────────────────

// ── Playfield geometry (the client mirrors these for rendering/physics) ─────

/** Logical playfield width in px. The jumper's x wraps within [0, FIELD_WIDTH). */
export const FIELD_WIDTH = 360;

/** Platform width in px (centred on the platform's x anchor). */
export const PLATFORM_WIDTH = 64;

/** World-space vertical gap between two consecutive platform rows (px). The
 *  jumper's world-y for row r is r * ROW_RISE. */
export const ROW_RISE = 44;

// ── Bounce physics (the client mirrors these so its arc matches the bounds) ──
// World units: +y is UP, gravity pulls it down. Launch velocity is tuned so a
// normal bounce apexes at exactly NORMAL_REACH rows and a spring at SPRING_REACH
// rows (apex = v² / 2g). The min airtime a bounce can take is the time to apex
// (landing right at the top of the reach), which is v / g — the server's per-step
// minimum interval is derived from that, minus a grace for honest client jitter.

/** Downward acceleration, world px per frame² (60fps reference). */
export const GRAVITY = 0.42;

/** Launch velocity off a normal/moving/breakable platform (world px/frame).
 *  apex = NORMAL_LAUNCH_V² / (2·GRAVITY) ≈ NORMAL_REACH · ROW_RISE. */
export const NORMAL_LAUNCH_V = Math.sqrt(2 * GRAVITY * 3 * ROW_RISE);

/** Launch velocity off a spring platform (world px/frame).
 *  apex = SPRING_LAUNCH_V² / (2·GRAVITY) ≈ SPRING_REACH · ROW_RISE. */
export const SPRING_LAUNCH_V = Math.sqrt(2 * GRAVITY * 10 * ROW_RISE);

/** Max rows a normal/moving/breakable launch can ascend before falling back. */
export const NORMAL_REACH = 3;

/** Max rows a spring launch can ascend before falling back. */
export const SPRING_REACH = 10;

/** Minimum airtime (ms) a normal/moving/breakable bounce can take — the time to
 *  apex (≈ v/g frames), below the true ~408ms so honest jitter never rejects. */
export const MIN_NORMAL_BOUNCE_MS = 340;

/** Minimum airtime (ms) a spring bounce can take — well below its true ~745ms. */
export const MIN_SPRING_BOUNCE_MS = 600;

/** Tolerance subtracted from the min-airtime so honest client jitter / rounding
 *  never false-rejects a legitimately fast-but-fair bounce (ms). */
export const BOUNCE_GRACE_MS = 90;

/** A run can never legitimately exceed this many rows of height (defense in
 *  depth alongside the route's client-score cap + anti-cheat absolute limit). */
export const SKY_SCORE_CAP = 50_000;

// ── Platform types ──────────────────────────────────────────────────────────

export type PlatformType = 'normal' | 'moving' | 'breakable' | 'spring';

/** One platform in the seed-derived layout (one per row). `x` is the centre
 *  anchor; `moveAmp`/`movePhase` drive the client's horizontal oscillation for
 *  moving platforms (purely cosmetic — the server never validates x). */
export type SkyPlatform = {
  row: number;
  x: number;
  type: PlatformType;
  moveAmp: number;
  movePhase: number;
};

/** Max rows a launch off `type` can ascend. Pure + identical client/server. */
export const reachForType = (type: PlatformType): number =>
  type === 'spring' ? SPRING_REACH : NORMAL_REACH;

/** Minimum airtime (ms) a bounce off `type` can take. Pure + identical. */
export const minBounceMsForType = (type: PlatformType): number =>
  type === 'spring' ? MIN_SPRING_BOUNCE_MS : MIN_NORMAL_BOUNCE_MS;

// ── Seeded RNG — identical mulberry32 to the client + the other replays ──────
const createSeededRng = (seed: number) => {
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
 * Derive a stable per-row RNG from (seed, row). Mixing the row into the seed
 * (golden-ratio constant, all 32-bit) makes the layout O(1) and pure: no need to
 * replay from row 0 to get row N, and no cross-row state to drift between client
 * and server. Mirrors the swerve rngForRow trick.
 */
const rngForRow = (seed: number, row: number): (() => number) => {
  let mixed = (seed ^ Math.imul(row + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return createSeededRng(mixed >>> 0);
};

/** Probability that row `row` is a SPRING. Small + slowly ramping so springs
 *  stay a treat; capped so the layout never becomes a spring elevator. */
const springChance = (row: number): number =>
  Math.min(0.14, 0.05 + row * 0.0006);

/** Probability that row `row` is BREAKABLE (given it isn't a spring). Ramps with
 *  height so the climb gets meaner deeper in; capped well under 1. */
const breakableChance = (row: number): number =>
  Math.min(0.32, row * 0.0035);

/** Probability that row `row` is MOVING (given it isn't spring/breakable). */
const movingChance = (row: number): number =>
  Math.min(0.3, 0.08 + row * 0.0025);

/**
 * The platform type for `row` (0-indexed), derived purely from the seed. Row 0
 * (and the first few warm-up rows) are always `normal` so a run always has a
 * gentle, predictable start. O(1) + pure + identical on client and server.
 */
export const platformTypeForRow = (seed: number, row: number): PlatformType => {
  const r = row > 0 ? Math.floor(row) : 0;
  if (r < 4) return 'normal';
  const rng = rngForRow(seed, r);
  const roll = rng();
  if (roll < springChance(r)) return 'spring';
  if (roll < springChance(r) + breakableChance(r)) return 'breakable';
  if (roll < springChance(r) + breakableChance(r) + movingChance(r)) {
    return 'moving';
  }
  return 'normal';
};

/**
 * The full platform for `row` (0-indexed), derived purely from the seed: its x
 * anchor, type, and (for moving platforms) oscillation amplitude + phase. Row 0
 * is the centred start platform the jumper begins on. The CLIENT derives this
 * identically so the rendered tower matches what the server validates; the
 * server only ever reads `.type` (x is cosmetic — never gates the score).
 */
export const platformForRow = (seed: number, row: number): SkyPlatform => {
  const r = row > 0 ? Math.floor(row) : 0;
  if (r === 0) {
    return {
      row: 0,
      x: FIELD_WIDTH / 2,
      type: 'normal',
      moveAmp: 0,
      movePhase: 0,
    };
  }
  const rng = rngForRow(seed, r);
  // Burn the first draw for the type decision so x/move draws are independent.
  rng();
  const margin = PLATFORM_WIDTH / 2 + 6;
  const x = margin + rng() * (FIELD_WIDTH - 2 * margin);
  const type = platformTypeForRow(seed, r);
  const moveAmp =
    type === 'moving'
      ? Math.min(
          // keep the platform on-screen across its full swing
          Math.min(x - margin, FIELD_WIDTH - margin - x),
          28 + rng() * 46,
        )
      : 0;
  const movePhase = type === 'moving' ? rng() * Math.PI * 2 : 0;
  return { row: r, x, type, moveAmp, movePhase };
};

// ── Recorded event + result shapes ──────────────────────────────────────────

/** One recorded landing: the jumper bounced off the platform at `row` at `t` ms
 *  since the run began. `t` is the client clock — used only for the cadence/arc
 *  sanity bound; the authoritative elapsed is the server session durationMs. */
export type SkyLanding = {
  row: number;
  t: number;
};

export type SkyReplayResult = {
  /** Authoritative score = highest validated row landed on (max height). */
  score: number;
  /** How many recorded landings were validated before the chain ended. */
  counted: number;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
};

const isNonNegFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isRowIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * Verify a recorded Sky Climber run and return the authoritative score (the
 * highest row legitimately landed on).
 *
 * The landings must form a strictly ascending chain starting reachable from the
 * row-0 start platform; each step's row gain must be within the seed-derived
 * reach of the platform left behind; and the timing must respect the bounce
 * physics (per-launch minimum airtime) plus the bounded session window.
 *
 * Pure + never throws on bad input — malformed entries are dropped, and any
 * structural/timing violation rejects the whole run (a cheat signal, mirroring
 * swerve). The score is the highest row of the validated chain.
 *
 * @param landings   recorded landings ({ row, t })
 * @param durationMs the bounded server session/replay duration in ms
 * @param seed       the server `skySeed` for this session
 */
export const replaySkySession = (
  landings: SkyLanding[],
  durationMs: number,
  seed: number,
): SkyReplayResult => {
  const reject = (reason: string): SkyReplayResult => ({
    score: 0,
    counted: 0,
    rejected: true,
    reason,
  });

  if (!Array.isArray(landings) || landings.length === 0) {
    return { score: 0, counted: 0, rejected: false, reason: null };
  }

  if (landings.length > SKY_SCORE_CAP) {
    return reject(`Landing payload too large (${landings.length})`);
  }

  // Keep only well-formed entries, then order by ARRIVAL TIME (the jumper can go
  // up and fall back down, so the chain isn't monotonic in row — it's a real
  // time sequence of bounces). Ties break by row.
  const clean = landings
    .filter((l) => l != null && isRowIndex(l.row) && isNonNegFinite(l.t))
    .slice()
    .sort((a, b) => a.t - b.t || a.row - b.row);

  if (clean.length === 0) {
    return reject('No well-formed landing events');
  }

  // The bounded upper edge for any landing timestamp: the smaller of an infinite
  // ceiling and the server-measured elapsed plus a little grace for the final
  // landing / network skew. (The client clock is only sanity-checked; the server
  // session duration is the real elapsed.)
  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs + 1_500
      : Number.POSITIVE_INFINITY;

  let score = 0;
  let counted = 0;
  let prevRow = 0; // the start platform (row 0) is the implicit launch point
  let prevType: PlatformType = 'normal'; // row 0 is always normal
  let prevT = -Infinity;

  for (const landing of clean) {
    // ── Reach: an UPWARD step cannot exceed the launch power of the platform we
    //    left (type re-derived from the seed, never trusted). Falling onto a
    //    lower or same-row platform is always physically allowed. ──
    if (landing.row > prevRow) {
      const reach = reachForType(prevType);
      if (landing.row - prevRow > reach) {
        return reject(
          `Row ${landing.row} out of reach from row ${prevRow} ` +
            `(gap=${landing.row - prevRow} > ${reach} for a ${prevType} launch)`,
        );
      }
    }

    // ── Timing vs the bounce arc: a landing cannot happen sooner than the arc
    //    off the previous platform could carry the jumper (landing lower than the
    //    launch takes even longer, so the same min-airtime floor is safe), nor
    //    after the bounded session window. ──
    const minGap = minBounceMsForType(prevType) - BOUNCE_GRACE_MS;
    if (prevT === -Infinity) {
      // First landing: measured from the run start (the initial bounce off row 0).
      if (landing.t + BOUNCE_GRACE_MS < minBounceMsForType('normal')) {
        return reject(
          `First landing too early (t=${Math.round(landing.t)}ms < ` +
            `${minBounceMsForType('normal')}ms)`,
        );
      }
    } else if (landing.t - prevT < minGap) {
      return reject(
        `Row ${landing.row} landed too fast after row ${prevRow} ` +
          `(gap=${Math.round(landing.t - prevT)}ms < ${Math.round(minGap)}ms)`,
      );
    }
    if (landing.t > serverWindowMs) {
      return reject(
        `Row ${landing.row} landing outside session window ` +
          `(t=${Math.round(landing.t)}ms > ${Math.round(serverWindowMs)}ms)`,
      );
    }

    prevRow = landing.row;
    prevType = platformTypeForRow(seed, landing.row);
    prevT = landing.t;
    counted += 1;
    if (landing.row > score) score = landing.row; // max height reached

    if (score >= SKY_SCORE_CAP) {
      score = SKY_SCORE_CAP;
      break;
    }
  }

  return { score, counted, rejected: false, reason: null };
};

/** Alias kept to match a `validateSkyRun` naming preference. */
export const validateSkyRun = replaySkySession;
