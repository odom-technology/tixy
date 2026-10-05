// ---------------------------------------------------------------------------
// SEQUENCE MEMORY — server-authoritative replay verifier (pure, no DB/imports).
//
// The game shows a growing sequence of pad flashes. Round N = the first N pads
// of a single deterministic sequence derived from the server seed. The player
// repeats round N; one wrong tap ends the run; the score is the longest fully
// correct round reached.
//
// The sequence is NOT secret — the player is shown it. The seed only exists so
// the client and the server agree on the EXACT pad order, so the server can
// re-derive it and validate the player's taps without trusting the client.
//
// This mirrors the client sequence builder (mulberry32 + the same draw cadence:
// one pad per draw, pad = floor(rng() * PAD_COUNT)). The replay is discrete
// tap-sequence validation — no floating-point physics — so it is robust.
// ---------------------------------------------------------------------------

export const PAD_COUNT = 4;

/** Identical mulberry32 to the client (and to flappy/snake replays). */
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
 * Build the first `length` pads of the deterministic sequence for `seed`.
 * One RNG draw per pad, in order — the client MUST build it the same way.
 */
export const buildSequence = (seed: number, length: number): number[] => {
  const nextRandom = createSeededRng(seed);
  const pads: number[] = [];
  const safeLength = Math.max(0, Math.floor(length));
  for (let i = 0; i < safeLength; i += 1) {
    pads.push(Math.floor(nextRandom() * PAD_COUNT));
  }
  return pads;
};

export type SequenceTapEvent = {
  /** client-relative timestamp (ms). Used only for ordering. */
  t: number;
  /** 1-based round the player was repeating when this tap was made. */
  round: number;
  /** 0-based position within that round's sequence this tap answers. */
  index: number;
  /** pad the player tapped, 0..PAD_COUNT-1. */
  pad: number;
};

export type SequenceReplayResult = {
  /** authoritative score = longest fully correct round the taps prove. */
  score: number;
};

const isValidPad = (pad: unknown): pad is number =>
  typeof pad === 'number' &&
  Number.isInteger(pad) &&
  pad >= 0 &&
  pad < PAD_COUNT;

const isNonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Validate the player's tap stream against the seed sequence and return the
 * longest fully-correct round.
 *
 * A round R (which has R pads) is "completed" iff, for every position
 * 0..R-1, there is a tap with round === R and index === p whose pad equals
 * the seed sequence's pad at that absolute position, AND the round contains
 * no wrong tap. The score is the highest completed R. Any single wrong pad
 * at the right position fails that round (and, in the real game, ends the
 * run) — so the score is that round minus one.
 *
 * Taps are grouped by round and sorted by (index, t) so out-of-delivery WS
 * ordering does not matter; correctness is positional, not arrival-based.
 */
export const replaySequenceSession = (
  tapEvents: SequenceTapEvent[],
  seed: number,
): SequenceReplayResult => {
  const taps = (Array.isArray(tapEvents) ? tapEvents : [])
    .filter(
      (event) =>
        event != null &&
        Number.isFinite(event.t) &&
        isNonNegInt(event.round) &&
        event.round >= 1 &&
        isNonNegInt(event.index) &&
        isValidPad(event.pad),
    )
    .sort((a, b) => a.round - b.round || a.index - b.index || a.t - b.t);

  if (taps.length === 0) {
    return { score: 0 };
  }

  // Group taps by round.
  const byRound = new Map<number, SequenceTapEvent[]>();
  let maxRound = 0;
  for (const tap of taps) {
    maxRound = Math.max(maxRound, tap.round);
    const list = byRound.get(tap.round);
    if (list) list.push(tap);
    else byRound.set(tap.round, [tap]);
  }

  // Full sequence we ever need is maxRound pads long (round R uses the first
  // R pads of the same sequence).
  const sequence = buildSequence(seed, maxRound);

  let longestCompletedRound = 0;
  for (let round = 1; round <= maxRound; round += 1) {
    const roundTaps = byRound.get(round);
    if (!roundTaps) break; // a missing round breaks the chain — can't go higher

    // Keep the FIRST tap for each index (a re-tap of the same slot is ignored;
    // the wrong-then-right exploit is prevented because the run ends on the
    // first wrong tap in the real game — we honor the first answer per slot).
    const answeredFirst = new Map<number, number>();
    for (const tap of roundTaps) {
      if (!answeredFirst.has(tap.index)) {
        answeredFirst.set(tap.index, tap.pad);
      }
    }

    let roundOk = true;
    for (let position = 0; position < round; position += 1) {
      const answered = answeredFirst.get(position);
      if (answered === undefined || answered !== sequence[position]) {
        roundOk = false;
        break;
      }
    }

    if (!roundOk) break; // first failed round ends the chain
    longestCompletedRound = round;
  }

  return { score: longestCompletedRound };
};

/** Alias kept to match the spec's `validateSequenceRun` naming if preferred. */
export const validateSequenceRun = replaySequenceSession;
