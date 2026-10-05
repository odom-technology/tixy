// ---------------------------------------------------------------------------
// Derby Royale — round engine (singleton, pinned on globalThis).
//
// One continuous, server-driven round loop for the whole site, running forever
// even with zero players:
//
//   betting (115s) -> locked (6s) -> racing (script.durationMs) -> results (14s)
//   -> new round -> ...
//
// Design contract:
//  - ABSOLUTE-timestamp deadlines. Every transition re-arms a single setTimeout
//    to the next deadline; clients get deadlines + serverNow and count down
//    locally. A 10s heartbeat broadcasts a slim `sync` frame; full state is
//    broadcast at every transition.
//  - Round row persisted at creation and updated at every transition (crash
//    safety). Nothing is exposed to clients before it should be: the winner and
//    race script are computed at `locked` but the script is broadcast only at
//    `racing` start; the seed is revealed only in the `results` broadcast.
//  - Boot recovery: the outcome is fully determined by the committed seed, so
//    nothing is ever re-rolled. Load the newest round, recompute deadlines from
//    the seed, and either resume in place or fast-forward (deterministic settle
//    of any unsettled bets) and start a fresh round.
//
// Provably-fair derivation (verifier-reproducible):
//   seed      = 32 random bytes, hex (64 chars)
//   seedHash  = sha256(seed)                      published when betting opens
//   randomness = HMAC-SHA256(key=seed, msg=label) streams, labels:
//     'form'   -> mulberry32(uint32) feeds computeRoundOdds (jitter + shuffle)
//     'winner' -> u01 = first 52 bits (big-endian) / 2^52, feeds drawWinner
//     'script' -> mulberry32(uint32) feeds generateRaceScript
//     'payout' -> uint32 seed for roundArcadePayout (per-bet label = bet id)
//   uint32(label) = first 4 bytes, big-endian, of HMAC-SHA256(seed, label).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

import { getPool, query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  DERBY_BETTING_MS,
  DERBY_HORSE_COUNT,
  DERBY_LOCKED_MS,
  DERBY_RESULTS_MS,
  computeRoundOdds,
  drawWinner,
  generateRaceScript,
  mulberry32,
  type DerbyEvent,
  type DerbyPhase,
  type DerbyPublicRound,
  type RaceScript,
  type RoundOdds,
} from './derby-shared';

const HEARTBEAT_MS = 10_000;

// ---------------------------------------------------------------------------
// Seed derivation (exported so bets.ts / history / the verifier reuse it)
// ---------------------------------------------------------------------------

function hmac(seedHex: string, label: string): Buffer {
  return crypto.createHmac('sha256', seedHex).update(label).digest();
}

/** uint32 = first 4 bytes, big-endian, of HMAC-SHA256(seed, label). */
export function hmacUint32(seedHex: string, label: string): number {
  return hmac(seedHex, label).readUInt32BE(0);
}

/** u01 in [0,1) = first 52 bits (big-endian) of HMAC-SHA256(seed, label) / 2^52. */
export function hmacFloat52(seedHex: string, label: string): number {
  const digest = hmac(seedHex, label);
  const hi = digest.readUInt32BE(0); // top 32 bits
  const lo20 = digest.readUInt32BE(4) >>> 12; // next 20 bits
  return (hi * 0x100000 + lo20) / 2 ** 52;
}

/** Numeric round seed feeding roundArcadePayout (per-bet label = bet id). */
export function derbyPayoutSeed(seedHex: string): number {
  return hmacUint32(seedHex, 'payout');
}

/**
 * Full deterministic outcome for a round, recomputed purely from its seed.
 * Used at `locked`, on boot recovery, and by the history/verify path.
 */
export function computeDerbyOutcome(seedHex: string): {
  odds: RoundOdds;
  winnerIdx: number;
  script: RaceScript;
} {
  const odds = computeRoundOdds(mulberry32(hmacUint32(seedHex, 'form')));
  const winnerIdx = drawWinner(hmacFloat52(seedHex, 'winner'), odds.m);
  const script = generateRaceScript(
    mulberry32(hmacUint32(seedHex, 'script')),
    winnerIdx,
    odds.m,
  );
  return { odds, winnerIdx, script };
}

/** Odds only (published when betting opens — before any winner is drawn). */
function computeDerbyOdds(seedHex: string): RoundOdds {
  return computeRoundOdds(mulberry32(hmacUint32(seedHex, 'form')));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type EngineRound = {
  id: string;
  roundNumber: number;
  seedHex: string;
  seedHash: string;
  odds: RoundOdds;
  phase: DerbyPhase;
  bettingEndsAt: number;
  raceStartsAt: number;
  raceEndsAt: number | null;
  resultsEndAt: number | null;
  winnerIdx: number | null;
  finishOrder: number[] | null;
  script: RaceScript | null;
  betTotals: number[];
  betCounts: number[];
  totalWagered: number;
};

type LoadedRoundRow = {
  id: string;
  round_number: string | number;
  seed: string;
  seed_hash: string;
  odds_json: RoundOdds;
  phase: DerbyPhase | 'settled';
  winner_idx: number | null;
  finish_order_json: number[] | null;
  bet_count: number | string;
  total_wagered: number | string;
  betting_ends_at: string | number | null;
  race_starts_at: string | number | null;
  race_ends_at: string | number | null;
  results_end_at: string | number | null;
  is_settled: boolean;
};

const zeros = () => new Array<number>(DERBY_HORSE_COUNT).fill(0);
const toMs = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

class DerbyEngine {
  private current: EngineRound | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readyPromise: Promise<void> | null = null;

  /** Idempotently boot the engine (safe to call from server.ts and routes). */
  ensureStarted(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.readyPromise = this.boot().catch((error) => {
        console.error('[derby] engine boot failed:', error);
        // Reset so a later request can retry the boot.
        this.started = false;
        this.readyPromise = null;
      });
    }
    return this.readyPromise ?? Promise.resolve();
  }

  whenReady(): Promise<void> {
    return this.readyPromise ?? this.ensureStarted();
  }

  // --- public read API ------------------------------------------------------

  getPublicRound(): DerbyPublicRound | null {
    const r = this.current;
    if (!r) return null;
    return {
      id: r.id,
      roundNumber: r.roundNumber,
      phase: r.phase,
      seedHash: r.seedHash,
      odds: r.odds,
      bettingEndsAt: r.bettingEndsAt,
      raceStartsAt: r.raceStartsAt,
      raceEndsAt: r.raceEndsAt,
      resultsEndAt: r.resultsEndAt,
      betTotals: [...r.betTotals],
      betCounts: [...r.betCounts],
      totalWagered: r.totalWagered,
    };
  }

  /** The script is only exposed once racing has started (never earlier). */
  getCurrentScript(): RaceScript | null {
    const r = this.current;
    if (!r) return null;
    return r.phase === 'racing' || r.phase === 'results' ? r.script : null;
  }

  getServerNow(): number {
    return Date.now();
  }

  /** Minimal round view for bet validation. */
  getCurrentRoundMeta(): {
    id: string;
    phase: DerbyPhase;
    bettingEndsAt: number;
    oddsM: number[];
  } | null {
    const r = this.current;
    if (!r) return null;
    return {
      id: r.id,
      phase: r.phase,
      bettingEndsAt: r.bettingEndsAt,
      oddsM: r.odds.m,
    };
  }

  /** Bump in-memory bet totals after a committed bet; returns fresh copies. */
  recordLocalBet(
    roundId: string,
    horseIdx: number,
    amount: number,
  ): { betTotals: number[]; betCounts: number[] } | null {
    const r = this.current;
    if (!r || r.id !== roundId) return null;
    if (horseIdx < 0 || horseIdx >= DERBY_HORSE_COUNT) return null;
    r.betTotals[horseIdx] += amount;
    r.betCounts[horseIdx] += 1;
    r.totalWagered += amount;
    return { betTotals: [...r.betTotals], betCounts: [...r.betCounts] };
  }

  // --- lifecycle ------------------------------------------------------------

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(at: number) {
    this.clearTimer();
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, delay);
  }

  private startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const r = this.current;
      if (!r) return;
      const event: DerbyEvent = {
        type: 'sync',
        roundId: r.id,
        phase: r.phase,
        bettingEndsAt: r.bettingEndsAt,
        raceStartsAt: r.raceStartsAt,
        raceEndsAt: r.raceEndsAt,
        resultsEndAt: r.resultsEndAt,
        betTotals: [...r.betTotals],
        serverNow: Date.now(),
      };
      broadcast('derby', event);
    }, HEARTBEAT_MS);
    // Do not keep the process alive solely for the heartbeat.
    this.heartbeat.unref?.();
  }

  private async onTimer() {
    const r = this.current;
    if (!r) return;
    try {
      switch (r.phase) {
        case 'betting':
          await this.toLocked();
          break;
        case 'locked':
          await this.toRacing();
          break;
        case 'racing':
          await this.toResults();
          break;
        case 'results':
          await this.toSettledAndNext();
          break;
      }
    } catch (error) {
      console.error('[derby] transition failed, retrying shortly:', error);
      // Re-arm a short retry so a transient DB blip doesn't freeze the loop.
      this.arm(Date.now() + 2_000);
    }
  }

  private broadcastPhase() {
    const round = this.getPublicRound();
    if (!round) return;
    const event: DerbyEvent = { type: 'phase', round, serverNow: Date.now() };
    broadcast('derby', event);
  }

  // --- transitions ----------------------------------------------------------

  private async createRound(): Promise<void> {
    const id = crypto.randomUUID();
    const seedHex = crypto.randomBytes(32).toString('hex');
    const seedHash = crypto.createHash('sha256').update(seedHex).digest('hex');
    const odds = computeDerbyOdds(seedHex);

    const now = Date.now();
    const bettingEndsAt = now + DERBY_BETTING_MS;
    const raceStartsAt = bettingEndsAt + DERBY_LOCKED_MS;

    const inserted = await queryOne<{ round_number: string | number }>(
      `
        INSERT INTO derby_rounds
          (id, seed, seed_hash, odds_json, phase, betting_ends_at, race_starts_at, created_at)
        VALUES ($1, $2, $3, $4, 'betting', to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), now())
        RETURNING round_number
      `,
      [id, seedHex, seedHash, JSON.stringify(odds), bettingEndsAt, raceStartsAt],
    );

    this.current = {
      id,
      roundNumber: Number(inserted?.round_number ?? 0),
      seedHex,
      seedHash,
      odds,
      phase: 'betting',
      bettingEndsAt,
      raceStartsAt,
      raceEndsAt: null,
      resultsEndAt: null,
      winnerIdx: null,
      finishOrder: null,
      script: null,
      betTotals: zeros(),
      betCounts: zeros(),
      totalWagered: 0,
    };

    this.broadcastPhase();
    this.arm(bettingEndsAt);
  }

  private async toLocked(): Promise<void> {
    const r = this.current;
    if (!r) return;

    const { winnerIdx, script } = computeDerbyOutcome(r.seedHex);
    const raceEndsAt = r.raceStartsAt + script.durationMs;
    const resultsEndAt = raceEndsAt + DERBY_RESULTS_MS;

    // Durable write FIRST: if it throws, the in-memory phase stays 'betting'
    // and the retry timer re-runs this same transition instead of skipping it.
    await query(
      `
        UPDATE derby_rounds
        SET phase = 'locked', winner_idx = $2, finish_order_json = $3,
            race_ends_at = to_timestamp($4 / 1000.0),
            results_end_at = to_timestamp($5 / 1000.0)
        WHERE id = $1
      `,
      [r.id, winnerIdx, JSON.stringify(script.finishOrder), raceEndsAt, resultsEndAt],
    );

    r.phase = 'locked';
    r.winnerIdx = winnerIdx;
    r.finishOrder = script.finishOrder;
    r.script = script;
    r.raceEndsAt = raceEndsAt;
    r.resultsEndAt = resultsEndAt;

    // Phase broadcast only — the script is withheld until racing begins.
    this.broadcastPhase();
    this.arm(r.raceStartsAt);
  }

  private async toRacing(): Promise<void> {
    const r = this.current;
    if (!r || r.raceEndsAt === null) return;
    await query(`UPDATE derby_rounds SET phase = 'racing' WHERE id = $1`, [r.id]);
    r.phase = 'racing';

    this.broadcastPhase();
    if (r.script) {
      const event: DerbyEvent = {
        type: 'script',
        roundId: r.id,
        script: r.script,
        serverNow: Date.now(),
      };
      broadcast('derby', event);
    }
    this.arm(r.raceEndsAt);
  }

  private async toResults(): Promise<void> {
    const r = this.current;
    if (!r || r.winnerIdx === null || r.resultsEndAt === null) return;

    // Settle BEFORE advancing the in-memory phase: if settlement throws, the
    // retry timer re-enters this transition (settlement is idempotent) rather
    // than sailing on to 'settled' with unpaid bets.
    const { settleDerbyRound } = await import('./bets');
    const { topWins } = await settleDerbyRound({
      roundId: r.id,
      roundNumber: r.roundNumber,
      seedHex: r.seedHex,
      winnerIdx: r.winnerIdx,
    });
    r.phase = 'results';

    this.broadcastPhase();
    const event: DerbyEvent = {
      type: 'results',
      roundId: r.id,
      winnerIdx: r.winnerIdx,
      finishOrder: r.finishOrder ?? r.script?.finishOrder ?? [],
      seed: r.seedHex,
      topWins,
      serverNow: Date.now(),
    };
    broadcast('derby', event);
    this.arm(r.resultsEndAt);
  }

  private async toSettledAndNext(): Promise<void> {
    const r = this.current;
    if (r) {
      // Belt-and-braces: settlement is idempotent, so re-running it here
      // guarantees no round is ever marked 'settled' with unpaid bets, even
      // after a mid-results crash/retry.
      if (r.winnerIdx !== null) {
        const { settleDerbyRound } = await import('./bets');
        await settleDerbyRound({
          roundId: r.id,
          roundNumber: r.roundNumber,
          seedHex: r.seedHex,
          winnerIdx: r.winnerIdx,
        });
      }
      await query(`UPDATE derby_rounds SET phase = 'settled' WHERE id = $1`, [r.id]);
    }
    await this.createRound();
  }

  // --- boot recovery --------------------------------------------------------

  private async loadBetTotals(
    roundId: string,
  ): Promise<{ betTotals: number[]; betCounts: number[]; totalWagered: number }> {
    const rows = await query<{
      horse_idx: number;
      total: string | number;
      cnt: string | number;
    }>(
      `
        SELECT horse_idx, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
        FROM derby_bets
        WHERE round_id = $1
        GROUP BY horse_idx
      `,
      [roundId],
    );
    const betTotals = zeros();
    const betCounts = zeros();
    let totalWagered = 0;
    for (const row of rows.rows) {
      const idx = Number(row.horse_idx);
      if (idx < 0 || idx >= DERBY_HORSE_COUNT) continue;
      const total = Number(row.total);
      betTotals[idx] = total;
      betCounts[idx] = Number(row.cnt);
      totalWagered += total;
    }
    return { betTotals, betCounts, totalWagered };
  }

  /**
   * Cross-process leadership: a Postgres session advisory lock held on a
   * dedicated connection. The globalThis pin protects against dev-HMR double
   * starts within one process; this protects against two *processes* (e.g. a
   * dev server plus a stray prod build) both running the loop and racing
   * round transitions. The non-leader parks and retries — if the leader dies,
   * its connection drops and the lock frees.
   */
  private async acquireLeadership(): Promise<void> {
    // 'derby' as a bigint key, stable across processes.
    const LOCK_KEY = '0x6465726279';
    for (;;) {
      const client = await getPool().connect();
      try {
        const res = await client.query<{ ok: boolean }>(
          'SELECT pg_try_advisory_lock($1::bigint) AS ok',
          [LOCK_KEY],
        );
        if (res.rows[0]?.ok) {
          this.leaderClient = client;
          client.on('error', (err) => {
            console.error('[derby] leader connection lost, re-electing:', err.message);
            this.leaderClient = null;
            this.clearTimer();
            this.started = false;
            this.readyPromise = null;
            void this.ensureStarted();
          });
          return;
        }
      } catch {
        // fall through to release + retry
      }
      client.release();
      console.warn('[derby] another engine holds the leader lock; retrying in 15s');
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  private leaderClient: import('pg').PoolClient | null = null;

  private async boot(): Promise<void> {
    await this.acquireLeadership();
    const row = await queryOne<LoadedRoundRow>(
      `
        SELECT id, round_number, seed, seed_hash, odds_json, phase,
               winner_idx, finish_order_json, bet_count, total_wagered,
               (EXTRACT(EPOCH FROM betting_ends_at) * 1000)::bigint AS betting_ends_at,
               (EXTRACT(EPOCH FROM race_starts_at) * 1000)::bigint AS race_starts_at,
               (EXTRACT(EPOCH FROM race_ends_at) * 1000)::bigint AS race_ends_at,
               (EXTRACT(EPOCH FROM results_end_at) * 1000)::bigint AS results_end_at,
               (settled_at IS NOT NULL) AS is_settled
        FROM derby_rounds
        ORDER BY round_number DESC
        LIMIT 1
      `,
    );

    this.startHeartbeat();

    if (!row) {
      await this.createRound();
      return;
    }

    // A terminal round means the server went down between rounds — start fresh.
    if (row.phase === 'settled') {
      await this.createRound();
      return;
    }

    // Recompute the full outcome from the committed seed (never re-rolled). This
    // gives us the canonical race duration to fill any deadline the crash left
    // unpersisted.
    const { winnerIdx, script, odds } = computeDerbyOutcome(row.seed);
    const bettingEndsAt =
      toMs(row.betting_ends_at) ?? Date.now() + DERBY_BETTING_MS;
    const raceStartsAt =
      toMs(row.race_starts_at) ?? bettingEndsAt + DERBY_LOCKED_MS;
    const raceEndsAt = toMs(row.race_ends_at) ?? raceStartsAt + script.durationMs;
    const resultsEndAt =
      toMs(row.results_end_at) ?? raceEndsAt + DERBY_RESULTS_MS;

    const totals = await this.loadBetTotals(row.id);

    const base: EngineRound = {
      id: row.id,
      roundNumber: Number(row.round_number),
      seedHex: row.seed,
      seedHash: row.seed_hash,
      odds: row.odds_json ?? odds,
      phase: 'betting',
      bettingEndsAt,
      raceStartsAt,
      raceEndsAt,
      resultsEndAt,
      winnerIdx,
      finishOrder: script.finishOrder,
      script,
      betTotals: totals.betTotals,
      betCounts: totals.betCounts,
      totalWagered: totals.totalWagered,
    };

    const now = Date.now();

    // Resume betting: hide the winner/script until later phases.
    if (now < bettingEndsAt) {
      this.current = { ...base, phase: 'betting', winnerIdx: null, finishOrder: null, script: null };
      await this.persistPhaseIfChanged(row.phase, 'betting');
      this.broadcastPhase();
      this.arm(bettingEndsAt);
      return;
    }

    // Resume locked: winner/script known, script still withheld from clients.
    if (now < raceStartsAt) {
      this.current = { ...base, phase: 'locked' };
      await this.persistLockedIfNeeded(row, winnerIdx, script, raceEndsAt, resultsEndAt);
      this.broadcastPhase();
      this.arm(raceStartsAt);
      return;
    }

    // Resume racing: broadcast the script so late/rejoining clients can seek.
    if (now < raceEndsAt) {
      this.current = { ...base, phase: 'racing' };
      await this.persistLockedIfNeeded(row, winnerIdx, script, raceEndsAt, resultsEndAt);
      await this.persistPhaseIfChanged(row.phase, 'racing');
      this.broadcastPhase();
      const event: DerbyEvent = {
        type: 'script',
        roundId: row.id,
        script,
        serverNow: Date.now(),
      };
      broadcast('derby', event);
      this.arm(raceEndsAt);
      return;
    }

    // Race is over. Settle deterministically (idempotent) then either resume the
    // results window or fast-forward to a fresh round.
    const { settleDerbyRound } = await import('./bets');
    const { topWins } = await settleDerbyRound({
      roundId: row.id,
      roundNumber: Number(row.round_number),
      seedHex: row.seed,
      winnerIdx,
    });

    if (now < resultsEndAt) {
      this.current = { ...base, phase: 'results' };
      this.broadcastPhase();
      const event: DerbyEvent = {
        type: 'results',
        roundId: row.id,
        winnerIdx,
        finishOrder: script.finishOrder,
        seed: row.seed,
        topWins,
        serverNow: Date.now(),
      };
      broadcast('derby', event);
      this.arm(resultsEndAt);
      return;
    }

    // Everything elapsed while we were down — mark terminal and open a new round.
    await query(`UPDATE derby_rounds SET phase = 'settled' WHERE id = $1`, [row.id]);
    await this.createRound();
  }

  private async persistPhaseIfChanged(
    from: DerbyPhase | 'settled',
    to: DerbyPhase,
  ): Promise<void> {
    if (from === to) return;
    await query(`UPDATE derby_rounds SET phase = $2 WHERE id = $1`, [
      this.current?.id,
      to,
    ]);
  }

  private async persistLockedIfNeeded(
    row: LoadedRoundRow,
    winnerIdx: number,
    script: RaceScript,
    raceEndsAt: number,
    resultsEndAt: number,
  ): Promise<void> {
    // Fill in winner/deadlines if the crash happened before the locked write.
    if (
      row.winner_idx !== null &&
      row.race_ends_at !== null &&
      row.results_end_at !== null
    ) {
      return;
    }
    await query(
      `
        UPDATE derby_rounds
        SET winner_idx = $2, finish_order_json = $3,
            race_ends_at = to_timestamp($4 / 1000.0),
            results_end_at = to_timestamp($5 / 1000.0)
        WHERE id = $1
      `,
      [row.id, winnerIdx, JSON.stringify(script.finishOrder), raceEndsAt, resultsEndAt],
    );
  }
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

declare global {
   
  var __derbyEngine__: DerbyEngine | undefined;
}

export function getDerbyEngine(): DerbyEngine {
  if (!globalThis.__derbyEngine__) {
    globalThis.__derbyEngine__ = new DerbyEngine();
  }
  return globalThis.__derbyEngine__;
}

/** Start the engine once (called from server.ts right after attachGameWs). */
export function startDerbyEngine(): void {
  void getDerbyEngine().ensureStarted();
}

export type { DerbyEngine };
