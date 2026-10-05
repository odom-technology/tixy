/**
 * Derby races on the server: lobbies, the aim log, judging and settling.
 *
 * The water race is a pure function of its seed, its lanes and every
 * lane's aim samples (src/features/arcade/lib/derby). The server owns the
 * log: it checks every batch a phone sends, keeps the ticks it may still
 * take, stores them, publishes them on `derbyRace:{id}`, and judges the
 * race from the log.
 *
 * Timing (DERBY.md, "Netcode"): a tick's aim is taken until
 * DERBY_MAX_LAG_MS after the tick, never ahead of the server's clock by
 * more than DERBY_MAX_LEAD_MS. A tick older than the lag is final for every
 * lane: what wasn't sent was dry. So a result the server's clock has passed
 * by the lag (and a margin) can't change, and that is when it settles.
 *
 * Settle once: running -> finished is one compare-and-swap in the same
 * transaction that writes every lane's place, forfeit and tickets and the
 * players' stats. A batch holds the race row FOR SHARE while it is stored,
 * the settle takes it FOR UPDATE, so a batch is either in the judged log or
 * turned down. Tickets are paid after the commit, keyed by race and
 * player, so a retry (the sweeper) can't pay twice.
 *
 * State is in Postgres; the models are a cache pinned on globalThis (the
 * custom server and Next's route bundles share it), rebuilt from the log
 * after a restart.
 */
import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  DERBY_COUNTDOWN_MS,
  DERBY_DISCONNECT_FORFEIT_MS,
  DERBY_LANES,
  DERBY_LOBBY_MAX_MS,
  DERBY_LOBBY_TIMEOUT_MS,
  DERBY_MAX_LAG_MS,
  DERBY_MAX_TICKS,
  DERBY_PUBLIC_FILL_MS,
  DERBY_RACE_MAX_MS,
  DERBY_RULES_VERSION,
  DERBY_SEAL_MARGIN_MS,
  DERBY_TICK_MS,
  DerbyRaceModel,
  derbyBotSkillFor,
  derbyCheckSamples,
  derbyKeepRange,
  derbyPlaceOf,
  derbySealTick,
  derbyTickets,
  derbyTracking,
  type DerbyLaneSpec,
  type DerbyResult,
} from '@/features/arcade/lib/derby';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { recordMatchRunResult, type MatchRunResult } from '@/server/arcade/match-run-results';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { awardGameRunCredits } from '@/server/arcade/rewards/wallet';
import { isGuestUserId } from '@/server/auth/guest';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { broadcast } from '@/server/events';

export type DerbyRaceKind = 'practice' | 'public' | 'invite';
export type DerbyRaceStatus = 'lobby' | 'running' | 'finished' | 'cancelled';
export type DerbyForfeit = 'left' | 'timeout' | 'idle';

/** Lanes people take, in order: the middle first. */
export const DERBY_LANE_ORDER = [3, 4, 2, 5, 1, 6, 0, 7] as const;

export const derbyRaceTopic = (raceId: string) => `derbyRace:${raceId}`;
export const DERBY_LOBBY_TOPIC = 'derbyRaceLobby';

export type DerbyUser = { userId: string; userName: string };

/** The tables (0072). */
const RACES = 'derby_water_races';
const LANES = 'derby_water_lanes';
const AIMS = 'derby_water_aims';

type RaceRow = {
  id: string;
  kind: DerbyRaceKind;
  status: DerbyRaceStatus;
  seed: string | number;
  rules: number;
  hostUserId: string;
  rematchOf: string | null;
  createdAt: string | number;
  fillAt: string | number | null;
  startAt: string | number | null;
  endT: number | null;
  winnerLane: number | null;
  timedOut: boolean | null;
  settledAt: string | number | null;
};

type LaneRow = {
  lane: number;
  kind: 'human' | 'bot';
  userId: string | null;
  userName: string;
  botSkill: number | null;
  joinedAt: string | number;
  lastSeenAt: string | number;
  leftAt: string | number | null;
  nextTick: number;
  lastX: number | null;
  lastY: number | null;
  lastS: number | null;
  batches: number;
  wetTicks: number;
  place: number | null;
  forfeit: DerbyForfeit | null;
  tickets: number | null;
  paidAt: string | number | null;
};

type BatchRow = { lane: number; prev: number; from: number; samples: number[] };

const RACE_COLS = `id, kind, status, seed, rules, host_user_id AS "hostUserId", rematch_of AS "rematchOf",
  created_at AS "createdAt", fill_at AS "fillAt", start_at AS "startAt", end_t AS "endT",
  winner_lane AS "winnerLane", timed_out AS "timedOut", settled_at AS "settledAt"`;
const LANE_COLS = `lane, kind, od_user_id AS "userId", user_name AS "userName", bot_skill AS "botSkill",
  joined_at AS "joinedAt", last_seen_at AS "lastSeenAt", left_at AS "leftAt", next_tick AS "nextTick",
  last_x AS "lastX", last_y AS "lastY", last_s AS "lastS", batches, wet_ticks AS "wetTicks",
  place, forfeit, tickets, paid_at AS "paidAt"`;

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** When it is safe to judge a race whose first crossing is at `endT`. */
const settleDelay = DERBY_MAX_LAG_MS + DERBY_SEAL_MARGIN_MS + 2 * DERBY_TICK_MS;

// ---------------------------------------------------------------------------
// The in-memory side: models, timers, results for the result card
// ---------------------------------------------------------------------------

type CachedRace = {
  id: string;
  startAt: number;
  model: DerbyRaceModel;
};

type DerbyRuntime = {
  races: Map<string, CachedRace>;
  timers: Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>;
  results: Map<string, MatchRunResult>;
  sweeper: ReturnType<typeof setInterval> | null;
  lastSeenWrite: Map<string, number>;
  rejectLogs: Map<string, number>;
};

const RUNTIME_KEY = '__arcadeDerbyWaterRuntime__';
function runtime(): DerbyRuntime {
  const g = globalThis as unknown as Record<string, DerbyRuntime | undefined>;
  let rt = g[RUNTIME_KEY];
  if (!rt) {
    rt = {
      races: new Map(),
      timers: new Map(),
      results: new Map(),
      sweeper: null,
      lastSeenWrite: new Map(),
      rejectLogs: new Map(),
    };
    g[RUNTIME_KEY] = rt;
  }
  return rt;
}

function laneSpecs(lanes: LaneRow[]): DerbyLaneSpec[] {
  return lanes.map((l) =>
    l.kind === 'human' ? { lane: l.lane, kind: 'human' as const } : { lane: l.lane, kind: 'bot' as const, botSkill: l.botSkill ?? 0 },
  );
}

async function loadRace(raceId: string, sql: Pick<PoolClient, 'query'> | null = null): Promise<RaceRow | null> {
  const text = `SELECT ${RACE_COLS} FROM ${RACES} WHERE id = $1`;
  if (sql) return (await sql.query<RaceRow>(text, [raceId])).rows[0] ?? null;
  return queryOne<RaceRow>(text, [raceId]);
}

async function loadLanes(raceId: string, sql: Pick<PoolClient, 'query'> | null = null): Promise<LaneRow[]> {
  const text = `SELECT ${LANE_COLS} FROM ${LANES} WHERE race_id = $1 ORDER BY lane`;
  const res = sql ? await sql.query<LaneRow>(text, [raceId]) : await query<LaneRow>(text, [raceId]);
  return res.rows;
}

async function loadBatches(raceId: string, since = 0): Promise<BatchRow[]> {
  const res = await query<{ lane: number; prev: number; from: number; samples: number[] }>(
    `SELECT lane, prev_tick AS prev, from_tick AS "from", samples FROM ${AIMS}
      WHERE race_id = $1 AND to_tick > $2 ORDER BY lane, prev_tick`,
    [raceId, since],
  );
  return res.rows.map((r) => ({ lane: r.lane, prev: Number(r.prev), from: Number(r.from), samples: r.samples.map(Number) }));
}

/** The race's model, from the cache or rebuilt from the log. Running and finished races only. */
async function cachedRace(race: RaceRow): Promise<CachedRace | null> {
  const rt = runtime();
  const hit = rt.races.get(race.id);
  if (hit) return hit;
  const startAt = num(race.startAt);
  if (startAt === null) return null;
  const lanes = await loadLanes(race.id);
  const model = new DerbyRaceModel(Number(race.seed), laneSpecs(lanes));
  for (const batch of await loadBatches(race.id)) model.confirm(batch.lane, batch.prev, batch.from, batch.samples);
  // A finished race is final everywhere.
  if (race.status === 'finished') model.seal(DERBY_MAX_TICKS);
  const entry: CachedRace = { id: race.id, startAt, model };
  rt.races.set(race.id, entry);
  if (rt.races.size > 200) {
    const oldest = rt.races.keys().next().value;
    if (oldest && oldest !== race.id) rt.races.delete(oldest);
  }
  return entry;
}

/** Check the race at `atMs` (wall clock), unless a check is due sooner. */
function scheduleCheck(raceId: string, atMs: number, force = false) {
  const rt = runtime();
  const existing = rt.timers.get(raceId);
  if (existing && !force && existing.at <= atMs && existing.at > Date.now()) return;
  if (existing) clearTimeout(existing.timer);
  const delay = Math.max(0, Math.min(DERBY_RACE_MAX_MS + DERBY_COUNTDOWN_MS + 10_000, atMs - Date.now())) + 25;
  const timer = setTimeout(() => {
    rt.timers.delete(raceId);
    void tickRace(raceId).catch((error) => console.error(`derby: check ${raceId} failed`, error));
  }, delay);
  timer.unref?.();
  rt.timers.set(raceId, { at: atMs, timer });
}

/** The earliest moment the race could be decided, from what is known now. */
function firstCrossing(model: DerbyRaceModel): number {
  let first = DERBY_RACE_MAX_MS;
  for (let lane = 0; lane < DERBY_LANES; lane += 1) {
    const cross = model.crossTime(lane);
    if (cross !== null && cross < first) first = cross;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Snapshot: what a phone needs to draw the race
// ---------------------------------------------------------------------------

export type DerbySnapshot = {
  id: string;
  kind: DerbyRaceKind;
  status: DerbyRaceStatus;
  seed: number;
  rules: number;
  hostUserId: string;
  fillAt: number | null;
  startAt: number | null;
  serverNow: number;
  myLane: number | null;
  lanes: Array<{
    lane: number;
    kind: 'human' | 'bot';
    userId: string | null;
    name: string;
    botSkill: number | null;
    next: number;
    place: number | null;
    forfeit: DerbyForfeit | null;
    tickets: number | null;
    away: boolean;
  }>;
  batches: BatchRow[];
  sealed: number;
  result: DerbyResult | null;
  rematch: string | null;
  /** The viewer's tickets and achievements once paid (result card). */
  reward: MatchRunResult | null;
};

export async function getDerbySnapshot(raceId: string, viewerId: string | null, since = 0): Promise<DerbySnapshot | null> {
  let race = await loadRace(raceId);
  if (!race) return null;
  // A request is a chance to move the race on: start a due lobby, settle a
  // decided race.
  const moved = await tickRace(raceId, race);
  if (moved) race = (await loadRace(raceId)) ?? race;
  const lanes = await loadLanes(raceId);
  const now = Date.now();
  const live = race.status === 'running' || race.status === 'finished';
  const batches = live ? await loadBatches(raceId, Math.max(0, Math.floor(since))) : [];
  const rematch = await queryOne<{ id: string }>(
    `SELECT id FROM ${RACES} WHERE rematch_of = $1 AND status IN ('lobby', 'running') ORDER BY created_at DESC LIMIT 1`,
    [raceId],
  );
  const mine = viewerId ? lanes.find((l) => l.userId === viewerId) : undefined;
  const startAt = num(race.startAt);
  let result: DerbyResult | null = null;
  if (race.status === 'finished' && race.winnerLane !== null && race.endT !== null) {
    const cache = await cachedRace(race);
    const judged = cache?.model.decided() ?? null;
    result =
      judged && judged.winner === race.winnerLane
        ? judged
        : { winner: race.winnerLane, endT: Number(race.endT), timedOut: Boolean(race.timedOut), order: [], distance: [] };
    if (!result.order.length) {
      result.order = [...lanes].sort((a, b) => (a.place ?? 9) - (b.place ?? 9)).map((l) => l.lane);
    }
  }
  return {
    id: race.id,
    kind: race.kind,
    status: race.status,
    seed: Number(race.seed),
    rules: race.rules,
    hostUserId: race.hostUserId,
    fillAt: num(race.fillAt),
    startAt,
    serverNow: now,
    myLane: mine ? mine.lane : null,
    lanes: lanes.map((l) => ({
      lane: l.lane,
      kind: l.kind,
      userId: l.userId,
      name: l.userName,
      botSkill: l.botSkill,
      next: Number(l.nextTick),
      place: l.place,
      forfeit: l.forfeit,
      tickets: l.tickets,
      away: l.kind === 'human' && (l.leftAt !== null || now - Number(l.lastSeenAt) > DERBY_LOBBY_TIMEOUT_MS),
    })),
    batches,
    sealed: startAt !== null && live ? Math.min(DERBY_MAX_TICKS, derbySealTick(now - startAt)) : 0,
    result,
    rematch: rematch?.id ?? null,
    reward: mine && viewerId ? (runtime().results.get(`${raceId}:${viewerId}`) ?? null) : null,
  };
}

/** The race this person is in (a lobby, a race on, or one that finished in
 *  the last minute, so a phone that drops near the wire comes back to the
 *  result), for a rejoin. */
export async function findActiveDerbyRace(userId: string): Promise<string | null> {
  const now = Date.now();
  const row = await queryOne<{ id: string }>(
    `SELECT r.id FROM ${RACES} r
       JOIN ${LANES} l ON l.race_id = r.id
      WHERE l.od_user_id = $1 AND l.left_at IS NULL
        AND (r.status = 'lobby'
          OR (r.status = 'running' AND r.start_at > $2)
          OR (r.status = 'finished' AND r.settled_at > $3))
      ORDER BY r.created_at DESC LIMIT 1`,
    [userId, now - DERBY_RACE_MAX_MS - 5_000, now - 60_000],
  );
  return row?.id ?? null;
}

/** Is there a race with this id (for routes that check before acting)? */
export async function derbyRaceKind(raceId: string): Promise<{ kind: DerbyRaceKind; status: DerbyRaceStatus } | null> {
  return queryOne<{ kind: DerbyRaceKind; status: DerbyRaceStatus }>(`SELECT kind, status FROM ${RACES} WHERE id = $1`, [raceId]);
}

/** The open rematch lobby for a race, if any. */
export async function findDerbyRematchLobby(raceId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${RACES} WHERE rematch_of = $1 AND status = 'lobby' ORDER BY created_at ASC LIMIT 1`,
    [raceId],
  );
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Lobbies
// ---------------------------------------------------------------------------

function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

async function insertHuman(client: PoolClient, raceId: string, lane: number, user: DerbyUser, now: number) {
  await client.query(
    `INSERT INTO ${LANES} (race_id, lane, kind, od_user_id, user_name, joined_at, last_seen_at)
     VALUES ($1, $2, 'human', $3, $4, $5, $5)`,
    [raceId, lane, user.userId, user.userName.slice(0, 40) || 'Player', now],
  );
}

/** Fill the empty lanes with bots and open the gate after the countdown. */
async function startInTx(client: PoolClient, race: RaceRow, now: number): Promise<number | null> {
  const lanes = await loadLanes(race.id, client);
  if (!lanes.some((l) => l.kind === 'human' && l.leftAt === null)) return null;
  const startAt = now + DERBY_COUNTDOWN_MS;
  const claimed = await client.query(
    `UPDATE ${RACES} SET status = 'running', start_at = $2, updated_at = $3 WHERE id = $1 AND status = 'lobby'`,
    [race.id, startAt, now],
  );
  if ((claimed.rowCount ?? 0) === 0) return null;
  // People who left the lobby don't race.
  await client.query(`DELETE FROM ${LANES} WHERE race_id = $1 AND kind = 'human' AND left_at IS NOT NULL`, [race.id]);
  const taken = new Set(lanes.filter((l) => l.leftAt === null).map((l) => l.lane));
  const seed = Number(race.seed);
  for (let lane = 0; lane < DERBY_LANES; lane += 1) {
    if (taken.has(lane)) continue;
    await client.query(
      `INSERT INTO ${LANES} (race_id, lane, kind, od_user_id, user_name, bot_skill, joined_at, last_seen_at, next_tick)
       VALUES ($1, $2, 'bot', NULL, $3, $4, $5, $5, $6)`,
      [race.id, lane, DERBY_BOT_LANE_NAMES[lane], derbyBotSkillFor(seed, lane), now, DERBY_MAX_TICKS],
    );
  }
  return startAt;
}

export const DERBY_BOT_LANE_NAMES = [
  'Tin Lizzy',
  'Nightjar',
  'Marmalade',
  'Penny Whistle',
  'Foxtrot',
  'Wooden Nickel',
  'Boardwalk Bea',
  'Saltwater',
] as const;

/** After the gate is set: the first check is when the fastest bot could win. */
async function afterStart(raceId: string, startAt: number) {
  const race = await loadRace(raceId);
  const cache = race ? await cachedRace(race) : null;
  scheduleCheck(raceId, startAt + (cache ? firstCrossing(cache.model) : DERBY_RACE_MAX_MS) + settleDelay, true);
}

export async function createDerbyRace(kind: DerbyRaceKind, user: DerbyUser, rematchOf: string | null = null): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  let startAt: number | null = null;
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ${RACES} (id, kind, status, seed, rules, host_user_id, rematch_of, created_at, updated_at, fill_at)
       VALUES ($1, $2, 'lobby', $3, $4, $5, $6, $7, $7, $8)`,
      [id, kind, newSeed(), DERBY_RULES_VERSION, user.userId, rematchOf, now, kind === 'public' ? now + DERBY_PUBLIC_FILL_MS : null],
    );
    await insertHuman(client, id, DERBY_LANE_ORDER[0], user, now);
    if (kind === 'practice') {
      const race = await loadRace(id, client);
      if (race) startAt = await startInTx(client, race, now);
    }
  });
  if (startAt !== null) {
    broadcast(derbyRaceTopic(id), { type: 'started', raceId: id, startAt, serverNow: Date.now() });
    await afterStart(id, startAt);
  } else if (kind === 'public') {
    scheduleCheck(id, now + DERBY_PUBLIC_FILL_MS, true);
    broadcast(DERBY_LOBBY_TOPIC, { type: 'race_open', raceId: id });
  }
  ensureDerbySweeper();
  return id;
}

/** Join a lobby, or come back to a race you are in. */
export async function joinDerbyRace(raceId: string, user: DerbyUser): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const now = Date.now();
  let full = false;
  const outcome = await withTransaction(async (client) => {
    const race = (await client.query<RaceRow>(`SELECT ${RACE_COLS} FROM ${RACES} WHERE id = $1 FOR UPDATE`, [raceId])).rows[0];
    if (!race) return { ok: false as const, error: 'That race is gone.', status: 404 };
    const lanes = await loadLanes(raceId, client);
    const mine = lanes.find((l) => l.userId === user.userId);
    if (mine) {
      // A rejoin: same lane. A person who left a running race stays out.
      if (race.status === 'lobby' && mine.leftAt !== null) {
        await client.query(`UPDATE ${LANES} SET left_at = NULL, last_seen_at = $3 WHERE race_id = $1 AND lane = $2`, [raceId, mine.lane, now]);
      } else {
        await client.query(`UPDATE ${LANES} SET last_seen_at = $3 WHERE race_id = $1 AND lane = $2`, [raceId, mine.lane, now]);
      }
      return { ok: true as const };
    }
    if (race.status !== 'lobby') return { ok: false as const, error: 'That race has started.', status: 409 };
    const taken = new Set(lanes.map((l) => l.lane));
    const lane = DERBY_LANE_ORDER.find((l) => !taken.has(l));
    if (lane === undefined) return { ok: false as const, error: 'That race is full.', status: 409 };
    await insertHuman(client, raceId, lane, user, now);
    full = taken.size + 1 >= DERBY_LANES;
    return { ok: true as const };
  });
  if (outcome.ok) {
    broadcast(derbyRaceTopic(raceId), { type: 'lanes', raceId });
    if (full) await startDerbyRace(raceId, null);
  }
  return outcome;
}

/** Play now: a public lobby with room, or a new one. */
export async function quickJoinDerby(user: DerbyUser): Promise<string> {
  const active = await findActiveDerbyRace(user.userId);
  if (active) return active;
  const now = Date.now();
  const joined = await withTransaction(async (client) => {
    const candidate = await client.query<{ id: string }>(
      `SELECT r.id FROM ${RACES} r
        WHERE r.kind = 'public' AND r.status = 'lobby' AND r.fill_at > $1
          AND (SELECT count(*) FROM ${LANES} l WHERE l.race_id = r.id AND l.left_at IS NULL) < $2
        ORDER BY r.created_at ASC
        FOR UPDATE SKIP LOCKED LIMIT 1`,
      [now + 1_500, DERBY_LANES],
    );
    const row = candidate.rows[0];
    if (!row) return null;
    const lanes = await loadLanes(row.id, client);
    const taken = new Set(lanes.map((l) => l.lane));
    const lane = DERBY_LANE_ORDER.find((l) => !taken.has(l));
    if (lane === undefined) return null;
    await insertHuman(client, row.id, lane, user, now);
    return { id: row.id, full: taken.size + 1 >= DERBY_LANES };
  });
  if (joined) {
    broadcast(derbyRaceTopic(joined.id), { type: 'lanes', raceId: joined.id });
    if (joined.full) await startDerbyRace(joined.id, null);
    return joined.id;
  }
  return createDerbyRace('public', user);
}

/** The host starts an invite race; the timer starts a public one (by null). */
export async function startDerbyRace(raceId: string, byUserId: string | null): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  const startAt = await withTransaction(async (client) => {
    const race = (await client.query<RaceRow>(`SELECT ${RACE_COLS} FROM ${RACES} WHERE id = $1 FOR UPDATE`, [raceId])).rows[0];
    if (!race || race.status !== 'lobby') return null;
    if (byUserId !== null && race.hostUserId !== byUserId) return null;
    return startInTx(client, race, now);
  });
  if (startAt === null) return { ok: false, error: 'The race could not start.' };
  runtime().races.delete(raceId);
  broadcast(derbyRaceTopic(raceId), { type: 'started', raceId, startAt, serverNow: Date.now() });
  await afterStart(raceId, startAt);
  return { ok: true };
}

/** Leave: out of a lobby, or a forfeit in a running race. */
export async function leaveDerbyRace(raceId: string, userId: string): Promise<void> {
  const now = Date.now();
  const race = await loadRace(raceId);
  if (!race) return;
  if (race.status === 'lobby') {
    if (race.hostUserId === userId && race.kind === 'invite') {
      await query(`UPDATE ${RACES} SET status = 'cancelled', updated_at = $2 WHERE id = $1 AND status = 'lobby'`, [raceId, now]);
      broadcast(derbyRaceTopic(raceId), { type: 'cancelled', raceId });
      return;
    }
    await query(`DELETE FROM ${LANES} WHERE race_id = $1 AND od_user_id = $2`, [raceId, userId]);
  } else if (race.status === 'running') {
    await query(`UPDATE ${LANES} SET left_at = $3 WHERE race_id = $1 AND od_user_id = $2 AND left_at IS NULL`, [raceId, userId, now]);
  }
  broadcast(derbyRaceTopic(raceId), { type: 'lanes', raceId });
}

/** A heartbeat: the page is open. Written at most every 3 s per lane. */
export async function heartbeatDerby(raceId: string, userId: string): Promise<void> {
  const rt = runtime();
  const key = `${raceId}:${userId}`;
  const now = Date.now();
  if (now - (rt.lastSeenWrite.get(key) ?? 0) < 3_000) return;
  rt.lastSeenWrite.set(key, now);
  if (rt.lastSeenWrite.size > 5_000) rt.lastSeenWrite.clear();
  await query(`UPDATE ${LANES} SET last_seen_at = $3 WHERE race_id = $1 AND od_user_id = $2`, [raceId, userId, now]);
}

// ---------------------------------------------------------------------------
// Aim batches
// ---------------------------------------------------------------------------

export type DerbyAimInput = { from: unknown; samples: unknown };

export type DerbyAimResult =
  | { ok: true; kept: { prev: number; from: number; n: number } | null; next: number; sealed: number; serverNow: number }
  | { ok: false; status: number; error: string; reason: string; next?: number; serverNow: number };

/** Check, trim, store and publish one batch of a lane's aim samples. */
export async function submitDerbyAims(raceId: string, user: DerbyUser, input: DerbyAimInput): Promise<DerbyAimResult> {
  const reject = (status: number, reason: string, error: string, next?: number): DerbyAimResult => ({
    ok: false,
    status,
    reason,
    error,
    next,
    serverNow: Date.now(),
  });

  const { from, samples } = input;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0 || from >= DERBY_MAX_TICKS) {
    void logReject(raceId, user, 'malformed', `from=${String(from)}`);
    return reject(400, 'malformed', 'That aim was malformed.');
  }
  // Shape and range first, before anything is read: cheap to turn down.
  const shape = derbyCheckSamples(samples, null);
  if (shape.ok === false && shape.reason !== 'teleport') {
    void logReject(raceId, user, shape.reason, `from=${from}`);
    return reject(400, shape.reason, 'That aim was out of range.');
  }
  const flat = samples as number[];
  const n = flat.length / 3;

  const race = await loadRace(raceId);
  if (!race) return reject(404, 'missing', 'That race is gone.');
  if (race.status !== 'running' || num(race.startAt) === null) {
    return reject(409, race.status === 'finished' ? 'finished' : 'not_running', 'The race is not running.');
  }
  const startAt = Number(race.startAt);
  const cache = await cachedRace(race);
  if (!cache) return reject(409, 'not_running', 'The race is not running.');

  type TxOut =
    | { kind: 'ok'; prev: number; keepFrom: number; keepTo: number; next: number; stored: number[] | null; laneNo: number }
    | { kind: 'reject'; status: number; reason: string; error: string; next?: number };
  const out = await withTransaction<TxOut>(async (client) => {
    // Hold the race against a settle while this batch is stored.
    const status = (await client.query<{ status: string }>(`SELECT status FROM ${RACES} WHERE id = $1 FOR SHARE`, [raceId])).rows[0];
    if (!status || status.status !== 'running') return { kind: 'reject', status: 409, reason: 'finished', error: 'The race is over.' };
    const lane = (
      await client.query<LaneRow>(`SELECT ${LANE_COLS} FROM ${LANES} WHERE race_id = $1 AND od_user_id = $2 FOR UPDATE`, [
        raceId,
        user.userId,
      ])
    ).rows[0];
    if (!lane) return { kind: 'reject', status: 403, reason: 'not_in_race', error: 'You are not in this race.' };
    if (lane.leftAt !== null) return { kind: 'reject', status: 409, reason: 'left', error: 'You left this race.' };
    const now = Date.now();
    const nowRace = now - startAt;
    if (nowRace < 0) return { kind: 'reject', status: 409, reason: 'before_gate', error: 'The gate is not open yet.' };
    const next = Number(lane.nextTick);
    const oldest = Math.max(0, Math.ceil((nowRace - DERBY_MAX_LAG_MS) / DERBY_TICK_MS));
    const keep = derbyKeepRange(next, from, n, nowRace);
    if (!keep) {
      // Nothing new to keep: all held already, too old, or not yet due.
      if (from > Math.floor(nowRace / DERBY_TICK_MS) + 40) {
        return { kind: 'reject', status: 409, reason: 'future', error: 'That aim is ahead of the clock.', next: Math.max(next, oldest) };
      }
      return { kind: 'ok', prev: next, keepFrom: next, keepTo: next, next: Math.max(next, oldest), stored: null, laneNo: lane.lane };
    }
    const { keepFrom, keepTo } = keep;
    const stored = flat.slice((keepFrom - from) * 3, (keepTo - from) * 3);
    // The speed check runs across the batch and from the last stored tick.
    const before: [number, number, number] | null =
      keepFrom === next && lane.lastX !== null && lane.lastY !== null && lane.lastS !== null ? [lane.lastX, lane.lastY, lane.lastS] : null;
    const motion = derbyCheckSamples(stored, before);
    if (motion.ok === false) {
      return { kind: 'reject', status: 400, reason: motion.reason, error: 'That aim moved faster than a hand can.', next };
    }
    const kept = keepTo - keepFrom;
    let wet = 0;
    for (let i = 0; i < kept; i += 1) wet += stored[i * 3 + 2] === 1 ? 1 : 0;
    await client.query(
      `INSERT INTO ${AIMS} (race_id, lane, prev_tick, from_tick, to_tick, samples, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [raceId, lane.lane, next, keepFrom, keepTo, stored, now],
    );
    await client.query(
      `UPDATE ${LANES}
          SET next_tick = $3, last_x = $4, last_y = $5, last_s = $6, batches = batches + 1, wet_ticks = wet_ticks + $7,
              last_seen_at = GREATEST(last_seen_at, $8)
        WHERE race_id = $1 AND lane = $2`,
      [raceId, lane.lane, keepTo, stored[(kept - 1) * 3], stored[(kept - 1) * 3 + 1], stored[(kept - 1) * 3 + 2], wet, now],
    );
    return { kind: 'ok', prev: next, keepFrom, keepTo, next: Math.max(keepTo, oldest), stored, laneNo: lane.lane };
  });

  if (out.kind === 'reject') {
    if (out.reason !== 'finished' && out.reason !== 'before_gate') {
      void logReject(raceId, user, out.reason, `from=${from} n=${n}`, out.reason === 'future' ? 'flag' : 'reject');
    }
    return reject(out.status, out.reason, out.error, out.next);
  }
  const sealed = derbySealTick(Date.now() - startAt);
  if (out.stored) {
    const applied = cache.model.confirm(out.laneNo, out.prev, out.keepFrom, out.stored);
    // Out of step with the log (a missed update): rebuild from the log.
    if (applied !== 'applied') runtime().races.delete(raceId);
    broadcast(derbyRaceTopic(raceId), {
      type: 'aims',
      raceId,
      batch: { lane: out.laneNo, prev: out.prev, from: out.keepFrom, samples: out.stored },
      sealed,
      serverNow: Date.now(),
    });
    // The race may now end sooner: check after the new first crossing.
    scheduleCheck(raceId, startAt + firstCrossing(cache.model) + settleDelay);
  }
  return {
    ok: true,
    kept: out.stored ? { prev: out.prev, from: out.keepFrom, n: out.keepTo - out.keepFrom } : null,
    next: out.next,
    sealed,
    serverNow: Date.now(),
  };
}

async function logReject(raceId: string, user: DerbyUser, reason: string, detail: string, result: 'reject' | 'flag' = 'reject') {
  const rt = runtime();
  const key = `${raceId}:${user.userId}`;
  const count = (rt.rejectLogs.get(key) ?? 0) + 1;
  rt.rejectLogs.set(key, count);
  if (rt.rejectLogs.size > 5_000) rt.rejectLogs.clear();
  if (count > 6) return;
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'derby',
      userId: user.userId,
      userName: user.userName,
      score: 0,
      result,
      severity: result,
      reason: `Derby aim ${result === 'flag' ? 'flagged' : 'rejected'}: ${reason}`,
      stage: 'aim',
      checks: [`race:${raceId}`, detail],
    });
  } catch (error) {
    console.error('derby: anti-cheat log failed', error);
  }
}

// ---------------------------------------------------------------------------
// Moving races on: start due lobbies, settle decided races
// ---------------------------------------------------------------------------

/** Start a due public lobby or settle a decided race. True if it moved. */
export async function tickRace(raceId: string, known?: RaceRow | null): Promise<boolean> {
  const race = known ?? (await loadRace(raceId));
  if (!race) return false;
  const now = Date.now();
  if (race.status === 'lobby') {
    if (race.kind === 'public' && num(race.fillAt) !== null && Number(race.fillAt) <= now) {
      return (await startDerbyRace(raceId, null)).ok;
    }
    if (race.kind !== 'public' && now - Number(race.createdAt) > DERBY_LOBBY_MAX_MS) {
      await query(`UPDATE ${RACES} SET status = 'cancelled', updated_at = $2 WHERE id = $1 AND status = 'lobby'`, [raceId, now]);
      broadcast(derbyRaceTopic(raceId), { type: 'cancelled', raceId });
      return true;
    }
    return false;
  }
  if (race.status === 'running') return settleDerbyRace(race);
  return false;
}

/**
 * Settle a running race if every lane is final past its result. Once: the
 * status flip is a compare-and-swap, and places, forfeits, tickets and
 * stats commit with it.
 */
export async function settleDerbyRace(race: RaceRow): Promise<boolean> {
  const cache = await cachedRace(race);
  if (!cache) return false;
  const now = Date.now();
  // Ticks older than the lag and the margin are final: unsent ones were dry.
  cache.model.seal(derbySealTick(now - cache.startAt));
  const result = cache.model.decided();
  if (!result) {
    scheduleCheck(race.id, cache.startAt + firstCrossing(cache.model) + settleDelay);
    return false;
  }
  const finishAt = cache.startAt + result.endT;
  const humans = await withTransaction(async (client) => {
    // Waits for any batch being stored (they hold the row FOR SHARE).
    const locked = (await client.query<{ status: string }>(`SELECT status FROM ${RACES} WHERE id = $1 FOR UPDATE`, [race.id])).rows[0];
    if (!locked || locked.status !== 'running') return null;
    const lanes = await loadLanes(race.id, client);
    // The model must hold every stored batch; if one landed since, judge again.
    for (const lane of lanes) {
      if (lane.kind === 'human' && Number(lane.nextTick) !== cache.model.known[lane.lane]) return 'stale' as const;
    }
    await client.query(
      `UPDATE ${RACES}
          SET status = 'finished', end_t = $2, winner_lane = $3, timed_out = $4, settled_at = $5, updated_at = $5
        WHERE id = $1 AND status = 'running'`,
      [race.id, result.endT, result.winner, result.timedOut, now],
    );
    const humanCount = lanes.filter((l) => l.kind === 'human').length;
    const endTick = Math.ceil(result.endT / DERBY_TICK_MS);
    const out: Array<{ lane: LaneRow; place: number; tickets: number; forfeit: DerbyForfeit | null }> = [];
    for (const lane of lanes) {
      const place = derbyPlaceOf(result, lane.lane);
      let forfeit: DerbyForfeit | null = null;
      if (lane.kind === 'human') {
        if (lane.leftAt !== null) forfeit = 'left';
        else if (derbyTracking(cache.model, lane.lane, endTick).onTarget === 0) forfeit = 'idle';
        else if (finishAt - Number(lane.lastSeenAt) > DERBY_DISCONNECT_FORFEIT_MS) forfeit = 'timeout';
      }
      const tickets = lane.kind === 'human' && !forfeit ? derbyTickets(place, DERBY_LANES) : 0;
      await client.query(`UPDATE ${LANES} SET place = $3, forfeit = $4, tickets = $5 WHERE race_id = $1 AND lane = $2`, [
        race.id,
        lane.lane,
        place,
        forfeit,
        tickets,
      ]);
      if (lane.kind === 'human') out.push({ lane, place, tickets, forfeit });
    }
    // Stats in user-id order, once per race (inside the settle).
    const counted = out.filter((h) => !h.forfeit && h.lane.userId && !isGuestUserId(h.lane.userId));
    counted.sort((a, b) => (a.lane.userId! < b.lane.userId! ? -1 : 1));
    for (const h of counted) {
      const win = h.place === 1;
      await client.query(
        `INSERT INTO derby_stats (od_user_id, user_name, races, wins, podiums, human_wins, best_win_ms, reds, updated_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, 0, $7)
         ON CONFLICT (od_user_id) DO UPDATE SET
           user_name = EXCLUDED.user_name,
           races = derby_stats.races + 1,
           wins = derby_stats.wins + EXCLUDED.wins,
           podiums = derby_stats.podiums + EXCLUDED.podiums,
           human_wins = derby_stats.human_wins + EXCLUDED.human_wins,
           best_win_ms = CASE WHEN EXCLUDED.best_win_ms IS NULL THEN derby_stats.best_win_ms
                              WHEN derby_stats.best_win_ms IS NULL THEN EXCLUDED.best_win_ms
                              ELSE LEAST(derby_stats.best_win_ms, EXCLUDED.best_win_ms) END,
           updated_at = EXCLUDED.updated_at`,
        [
          h.lane.userId,
          h.lane.userName,
          win ? 1 : 0,
          h.place <= 3 ? 1 : 0,
          win && humanCount > 1 ? 1 : 0,
          win && !result.timedOut ? result.endT : null,
          now,
        ],
      );
    }
    return { out, humanCount };
  });
  if (humans === 'stale') {
    runtime().races.delete(race.id);
    scheduleCheck(race.id, Date.now() + 100, true);
    return false;
  }
  if (!humans) return false;

  broadcast(derbyRaceTopic(race.id), { type: 'finished', raceId: race.id, result, serverNow: Date.now() });
  const timer = runtime().timers.get(race.id);
  if (timer) clearTimeout(timer.timer);
  runtime().timers.delete(race.id);
  // The board is fastest wins: one event for a person who won at the wire.
  const winner = humans.out.find((h) => h.place === 1 && !h.forfeit && h.lane.userId && !isGuestUserId(h.lane.userId));
  if (winner && !result.timedOut) {
    await recordScoreEvent({
      gameSlug: 'derby',
      userId: winner.lane.userId!,
      userName: winner.lane.userName,
      score: Math.round(result.endT),
    }).catch((error) => console.error(`derby: board event failed for ${race.id}`, error));
  }
  await payDerbyRace(race.id, result, humans.humanCount);
  void logRaceChecks(race.id, cache, humans.out.map((h) => h.lane), result);
  return true;
}

/** Pay every unpaid human lane of a finished race. Safe to call again. */
export async function payDerbyRace(raceId: string, result: Pick<DerbyResult, 'endT'>, humanCount: number): Promise<void> {
  const lanes = await query<LaneRow>(
    `SELECT ${LANE_COLS} FROM ${LANES}
      WHERE race_id = $1 AND kind = 'human' AND paid_at IS NULL AND forfeit IS NULL AND tickets > 0`,
    [raceId],
  );
  for (const lane of lanes.rows) {
    if (!lane.userId || isGuestUserId(lane.userId)) continue;
    try {
      const context = { gameType: 'derby' as const, place: lane.place ?? DERBY_LANES, field: DERBY_LANES, humans: humanCount };
      const reward = await awardGameRunCredits({
        userId: lane.userId,
        context,
        sourceId: `derby:${raceId}:${lane.userId}`,
        meta: { raceId, place: lane.place, lane: lane.lane },
      });
      const runResult = await recordMatchRunResult({
        matchId: `derby:${raceId}`,
        userId: lane.userId,
        context,
        reward,
        durationMs: result.endT,
      });
      runtime().results.set(`${raceId}:${lane.userId}`, runResult);
      const rt = runtime();
      if (rt.results.size > 1_000) {
        const oldest = rt.results.keys().next().value;
        if (oldest) rt.results.delete(oldest);
      }
      await query(`UPDATE ${LANES} SET paid_at = $3 WHERE race_id = $1 AND lane = $2`, [raceId, lane.lane, Date.now()]);
      broadcast(`user:${lane.userId}`, { type: 'derby_paid', raceId, tickets: reward.awardedTickets });
    } catch (error) {
      console.error(`derby: payout failed for ${raceId} lane ${lane.lane}`, error);
    }
  }
}

/** Mean distance from the target's middle (target radii) a person's stream
 *  may hold over a whole race. The sharpest bot holds about 0.32 and a
 *  perfect script 0; a hand under this is flagged. */
export const DERBY_PERFECT_TRACKING = 0.1;

/** One anti-cheat line per person per race: inhumanly steady tracking is
 *  flagged, everything else passes. */
async function logRaceChecks(raceId: string, cache: CachedRace, lanes: LaneRow[], result: DerbyResult) {
  const endTick = Math.ceil(result.endT / DERBY_TICK_MS);
  for (const lane of lanes) {
    if (!lane.userId) continue;
    const track = derbyTracking(cache.model, lane.lane, endTick);
    const perfect = track.onTarget >= 400 && track.meanOn < DERBY_PERFECT_TRACKING;
    const pinned = track.onTarget >= 400 && track.spreadOn < 0.03;
    const flagged = perfect || pinned;
    try {
      await addAntiCheatLog({
        ts: Date.now(),
        gameType: 'derby',
        userId: lane.userId,
        userName: lane.userName,
        score: lane.place ?? 0,
        result: flagged ? 'flag' : 'pass',
        severity: flagged ? 'flag' : undefined,
        reason: flagged
          ? `Derby race flagged:${perfect ? ` perfect_tracking(mean ${track.meanOn.toFixed(3)})` : ''}${pinned ? ` pinned_aim(spread ${track.spreadOn.toFixed(3)})` : ''}`
          : `Derby race, place ${lane.place ?? '?'} of ${DERBY_LANES}`,
        stage: 'settle',
        checks: [
          `race:${raceId}`,
          `squirting:${track.squirting}`,
          `on_target:${track.onTarget}`,
          `bull:${track.onBull}`,
          `mean_on:${track.meanOn.toFixed(3)}`,
          `spread_on:${track.spreadOn.toFixed(3)}`,
        ],
      });
    } catch (error) {
      console.error('derby: anti-cheat log failed', error);
    }
  }
}

// ---------------------------------------------------------------------------
// The sweeper: races nobody is watching still start, settle and pay
// ---------------------------------------------------------------------------

export async function sweepDerbyRaces(): Promise<{ started: number; settled: number; repaid: number; cancelled: number }> {
  const now = Date.now();
  const counts = { started: 0, settled: 0, repaid: 0, cancelled: 0 };
  // Lobby members who went quiet lose their lane before the gate.
  await query(
    `DELETE FROM ${LANES} l USING ${RACES} r
      WHERE l.race_id = r.id AND r.status = 'lobby' AND l.kind = 'human'
        AND l.od_user_id <> r.host_user_id AND l.last_seen_at < $1`,
    [now - DERBY_LOBBY_TIMEOUT_MS],
  );
  const due = await query<{ id: string }>(
    `SELECT id FROM ${RACES}
      WHERE (status = 'lobby' AND kind = 'public' AND fill_at <= $1)
         OR (status = 'lobby' AND kind <> 'public' AND created_at < $2)
         OR (status = 'running' AND start_at <= $1)
      ORDER BY created_at ASC LIMIT 50`,
    [now, now - DERBY_LOBBY_MAX_MS],
  );
  for (const row of due.rows) {
    const before = await loadRace(row.id);
    if (!before) continue;
    const moved = await tickRace(row.id, before).catch((error) => {
      console.error(`derby: sweep ${row.id} failed`, error);
      return false;
    });
    if (!moved) continue;
    if (before.status === 'running') counts.settled += 1;
    else if (before.kind === 'public') counts.started += 1;
    else counts.cancelled += 1;
  }
  // Payouts that didn't land (a crash between the settle and the award).
  const unpaid = await query<{ raceId: string; endT: number }>(
    `SELECT DISTINCT r.id AS "raceId", r.end_t AS "endT" FROM ${RACES} r
       JOIN ${LANES} l ON l.race_id = r.id
      WHERE r.status = 'finished' AND r.settled_at > $1 AND r.settled_at < $2
        AND l.kind = 'human' AND l.paid_at IS NULL AND l.forfeit IS NULL AND l.tickets > 0
      LIMIT 20`,
    [now - 24 * 60 * 60 * 1000, now - 10_000],
  );
  for (const row of unpaid.rows) {
    const humanCount = Number(
      (await queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${LANES} WHERE race_id = $1 AND kind = 'human'`, [row.raceId]))?.n ?? 1,
    );
    await payDerbyRace(row.raceId, { endT: Number(row.endT) }, humanCount);
    counts.repaid += 1;
  }
  return counts;
}

/** Start the sweeper once per process (the custom server calls this too). */
export function ensureDerbySweeper(): void {
  const rt = runtime();
  if (rt.sweeper) return;
  rt.sweeper = setInterval(() => {
    void sweepDerbyRaces().catch((error) => console.error('derby: sweep failed', error));
  }, 2_000);
  rt.sweeper.unref?.();
}

/** Open races for the lobby: public lobbies filling now. */
export async function listOpenDerbyRaces(): Promise<Array<{ id: string; people: number; fillAt: number | null }>> {
  const now = Date.now();
  const rows = await query<{ id: string; people: string; fillAt: string | null }>(
    `SELECT r.id, count(l.lane) AS people, r.fill_at AS "fillAt"
       FROM ${RACES} r LEFT JOIN ${LANES} l ON l.race_id = r.id AND l.left_at IS NULL
      WHERE r.kind = 'public' AND r.status = 'lobby' AND r.fill_at > $1
      GROUP BY r.id ORDER BY r.created_at ASC LIMIT 10`,
    [now],
  );
  return rows.rows.map((r) => ({ id: r.id, people: Number(r.people), fillAt: num(r.fillAt) }));
}
