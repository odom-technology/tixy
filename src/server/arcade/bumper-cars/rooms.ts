/* Bumper cars rooms: the server owns every round.

   A room has eight seats. Players join it from the lobby (play now, an invite
   code or a link), bots take the seats nobody fills, and the round runs here
   at a fixed 60 Hz on the shared engine. The page only sends its inputs; the
   server steps the world, decides every bump and the score, and sends a
   snapshot 30 times a second. A player who drops keeps their seat: the car
   idles for 15 s, then a bot minds it (scoring nothing) until they are back.
   At the horn the round is settled once, in the database, and each player is
   paid by the skill curve.

   State lives on globalThis: the socket server (server.ts's bundle) and the
   API routes (Next's bundle) are two copies of this module in one process,
   so everything here is plain objects and closures, never classes. Only
   server.ts starts the loop. */

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { BOT_NAMES, BOT_SKILLS, botInput, createBot, type BotBrain } from '@/features/arcade/lib/bumper-cars/bots';
import {
  COAST_TICKS,
  COUNTDOWN_TICKS,
  DROP_GRACE_TICKS,
  MAX_CARS,
  ROUND_TICKS,
  SNAPSHOT_EVERY,
  TICK_HZ,
} from '@/features/arcade/lib/bumper-cars/constants';
import type { ServerMessage, WireBump, WireCar, WireRoom, WireSeat, WireStanding } from '@/features/arcade/lib/bumper-cars/protocol';
import { createSim, packCar, placesFor, setInputs, stepSim, type CarInput, type SimEvent, type SimState } from '@/features/arcade/lib/bumper-cars/sim';

// ── Timings ──────────────────────────────────────────────────────────────
/** A public room waits this long for players before bots fill it. */
export const PUBLIC_LOBBY_MS = 12_000;
/** An invite room waits for its host this long, then closes. */
export const INVITE_LOBBY_MS = 10 * 60_000;
/** After a round, this long to press rematch. */
export const REMATCH_WINDOW_MS = 20_000;
/** A rematch with everyone ready starts after this beat. */
export const REMATCH_LOBBY_MS = 5_000;
/** A player whose page closes in a lobby keeps the seat this long. */
export const LOBBY_GONE_MS = 10_000;
/** A socket ticket is good for this long, once. */
export const TICKET_TTL_MS = 30_000;
/** Inputs further ahead of the server than this are refused. */
export const MAX_INPUT_LEAD_TICKS = 90;
/** Messages a socket may send in a second, and strikes before it is closed. */
export const MAX_MESSAGES_PER_SECOND = 70;
export const MAX_STRIKES = 12;

const TICK_MS = 1000 / TICK_HZ;
const END_TICK = COUNTDOWN_TICKS + ROUND_TICKS;
const FINAL_TICK = END_TICK + COAST_TICKS;

// ── Types ────────────────────────────────────────────────────────────────

export type BumperConn = {
  id: string;
  userId: string;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  /** Rate limiting. */
  windowStart: number;
  windowCount: number;
  strikes: number;
};

export type BumperSeat = {
  kind: 'human' | 'bot' | 'empty';
  userId: string | null;
  name: string;
  conn: BumperConn | null;
  /** A bot drives bot seats, and a player's car while they're gone. */
  bot: BotBrain | null;
  inputs: Map<number, CarInput>;
  held: CarInput;
  newestInputTick: number;
  /** Sim tick the player's connection dropped, or null. */
  droppedAt: number | null;
  left: boolean;
  ready: boolean;
  lateInputs: number;
  /** When the socket went, outside a round (Date.now ms), or null. */
  goneAt: number | null;
};

export type SettleSeat = {
  seat: number;
  userId: string;
  name: string;
  points: number;
  bumps: number;
  place: number;
  result: 'finished' | 'forfeit' | 'timeout';
};

export type SettleRequest = {
  roundId: string;
  roomId: string;
  code: string;
  seed: number;
  startedAt: number;
  cars: number;
  finalTick: number;
  standings: WireStanding[];
  players: SettleSeat[];
};

export type BumperReward = {
  tickets: number;
  wanted: number;
  balanceAfter: number | null;
  score: number;
  account?: unknown;
  achievements?: unknown[];
};

export type SettleOutcome = {
  settled: boolean;
  rewards: Map<string, BumperReward>;
};

export type BumperRoom = {
  id: string;
  code: string;
  visibility: 'invite' | 'public';
  hostUserId: string;
  createdAt: number;
  phase: 'lobby' | 'running' | 'over' | 'closed';
  /** When the lobby or the rematch window closes (Date.now ms), or null to wait for the host. */
  deadline: number | null;
  seats: BumperSeat[];
  roundId: string | null;
  seed: number;
  sim: SimState | null;
  startPerf: number;
  startedAt: number;
  pendingBumps: WireBump[];
  standings: WireStanding[] | null;
  /** Each player's reward once the round is settled. */
  rewards: Map<string, BumperReward>;
  settling: boolean;
  settled: boolean;
  rounds: number;
};

type Ticket = { userId: string; name: string; roomId: string; exp: number };

type BumperStore = {
  rooms: Map<string, BumperRoom>;
  byCode: Map<string, string>;
  tickets: Map<string, Ticket>;
  loop: ReturnType<typeof setInterval> | null;
  /** Wired by server.ts: writes a round to the database and pays it. */
  persist: {
    start: (room: BumperRoom) => Promise<void>;
    settle: (req: SettleRequest) => Promise<SettleOutcome>;
    log: (userId: string, reason: string) => void;
  } | null;
};

const KEY = '__bumperCarsStore__';

export function bumperStore(): BumperStore {
  const g = globalThis as unknown as Record<string, BumperStore | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { rooms: new Map(), byCode: new Map(), tickets: new Map(), loop: null, persist: null };
    g[KEY] = s;
  }
  return s;
}

export class BumperRoomError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ── Seats and rooms ──────────────────────────────────────────────────────

function emptySeat(): BumperSeat {
  return {
    kind: 'empty',
    userId: null,
    name: '',
    conn: null,
    bot: null,
    inputs: new Map(),
    held: { steer: 0, throttle: 0 },
    newestInputTick: -1,
    droppedAt: null,
    left: false,
    ready: false,
    lateInputs: 0,
    goneAt: null,
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(store: BumperStore): string {
  for (;;) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!store.byCode.has(code)) return code;
  }
}

function humans(room: BumperRoom): BumperSeat[] {
  return room.seats.filter((s) => s.kind === 'human');
}

function seatOf(room: BumperRoom, userId: string): number {
  return room.seats.findIndex((s) => s.kind === 'human' && s.userId === userId);
}

function createRoom(visibility: 'invite' | 'public', hostUserId: string): BumperRoom {
  const store = bumperStore();
  const room: BumperRoom = {
    id: crypto.randomUUID(),
    code: newCode(store),
    visibility,
    hostUserId,
    createdAt: Date.now(),
    phase: 'lobby',
    deadline: visibility === 'public' ? Date.now() + PUBLIC_LOBBY_MS : Date.now() + INVITE_LOBBY_MS,
    seats: Array.from({ length: MAX_CARS }, emptySeat),
    roundId: null,
    seed: 0,
    sim: null,
    startPerf: 0,
    startedAt: 0,
    pendingBumps: [],
    standings: null,
    rewards: new Map(),
    settling: false,
    settled: false,
    rounds: 0,
  };
  store.rooms.set(room.id, room);
  store.byCode.set(room.code, room.id);
  return room;
}

/** Seat order fills round the rink, so the first cars in are spread out. */
function takeSeat(room: BumperRoom, userId: string, name: string): number {
  const i = room.seats.findIndex((s) => s.kind === 'empty');
  if (i < 0) throw new BumperRoomError('This round is full.', 409);
  const seat = emptySeat();
  seat.kind = 'human';
  seat.userId = userId;
  seat.name = name.slice(0, 24) || 'Player';
  seat.ready = true;
  room.seats[i] = seat;
  return i;
}

/** The room a player already sits in and can go back to, if any. */
export function findPlayerRoom(userId: string): BumperRoom | null {
  for (const room of bumperStore().rooms.values()) {
    if (room.phase === 'closed') continue;
    const i = seatOf(room, userId);
    if (i < 0) continue;
    const seat = room.seats[i]!;
    if (seat.left) continue;
    return room;
  }
  return null;
}

export function getRoom(id: string): BumperRoom | null {
  return bumperStore().rooms.get(id) ?? null;
}

export function getRoomByCode(code: string): BumperRoom | null {
  const id = bumperStore().byCode.get(code.trim().toUpperCase());
  return id ? getRoom(id) : null;
}

export function issueTicket(userId: string, name: string, roomId: string): string {
  const store = bumperStore();
  const now = Date.now();
  for (const [t, v] of store.tickets) if (v.exp < now) store.tickets.delete(t);
  const ticket = crypto.randomBytes(24).toString('base64url');
  store.tickets.set(ticket, { userId, name, roomId, exp: now + TICKET_TTL_MS });
  return ticket;
}

export function redeemTicket(ticket: string): Ticket | null {
  const store = bumperStore();
  const t = store.tickets.get(ticket);
  if (!t) return null;
  store.tickets.delete(ticket);
  return t.exp >= Date.now() ? t : null;
}

/** Play now: the room you're in, else an open public lobby, else a new one. */
export function quickPlay(userId: string, name: string): BumperRoom {
  const mine = findPlayerRoom(userId);
  if (mine) return mine;
  let best: BumperRoom | null = null;
  for (const room of bumperStore().rooms.values()) {
    if (room.visibility !== 'public' || room.phase !== 'lobby') continue;
    if (!room.seats.some((s) => s.kind === 'empty')) continue;
    // Room left before the lobby closes, so a joiner isn't dropped straight in.
    if (room.deadline !== null && room.deadline - Date.now() < 2_500) continue;
    if (!best || humans(room).length > humans(best).length) best = room;
  }
  const room = best ?? createRoom('public', userId);
  takeSeat(room, userId, name);
  if (room.seats.every((s) => s.kind === 'human')) startRound(room);
  else broadcastRoom(room);
  return room;
}

export function createInviteRoom(userId: string, name: string): BumperRoom {
  const mine = findPlayerRoom(userId);
  if (mine) {
    if (mine.phase === 'running') throw new BumperRoomError('Finish your round first.', 409);
    leaveRoom(mine, userId);
  }
  const room = createRoom('invite', userId);
  takeSeat(room, userId, name);
  return room;
}

/** Join a room by its id or code: from an invite link or a typed code. */
export function joinRoom(target: BumperRoom | null, userId: string, name: string): BumperRoom {
  if (!target || target.phase === 'closed') throw new BumperRoomError('That round has closed.', 404);
  if (seatOf(target, userId) >= 0) return target;
  if (target.phase === 'running') throw new BumperRoomError('That round has started. Join the next one when it ends.', 409);
  const mine = findPlayerRoom(userId);
  if (mine && mine.id !== target.id) {
    if (mine.phase === 'running') throw new BumperRoomError('Finish your round first.', 409);
    leaveRoom(mine, userId);
  }
  takeSeat(target, userId, name);
  if (target.seats.every((s) => s.kind === 'human') && target.phase === 'lobby') startRound(target);
  else broadcastRoom(target);
  return target;
}

/** Leave: from a lobby the seat frees; mid-round it is a forfeit and a bot drives on. */
export function leaveRoom(room: BumperRoom, userId: string): void {
  const i = seatOf(room, userId);
  if (i < 0) return;
  const seat = room.seats[i]!;
  if (room.phase === 'running') {
    seat.left = true;
    seat.conn?.close(1000, 'left');
    seat.conn = null;
    if (!seat.bot) seat.bot = createBot(i, room.seed, BOT_SKILLS.medium);
  } else {
    seat.conn?.close(1000, 'left');
    room.seats[i] = emptySeat();
    if (room.hostUserId === userId) {
      const next = room.seats.find((s) => s.kind === 'human');
      if (next?.userId) room.hostUserId = next.userId;
    }
    if (humans(room).length === 0) closeRoom(room);
  }
  broadcastRoom(room);
}

export function hostStart(room: BumperRoom, userId: string): void {
  if (room.phase !== 'lobby') return;
  if (room.hostUserId !== userId) throw new BumperRoomError('Only the host can start.', 403);
  startRound(room);
}

export function markRematch(room: BumperRoom, userId: string): void {
  const i = seatOf(room, userId);
  if (i < 0 || room.phase !== 'over') return;
  room.seats[i]!.ready = true;
  const all = humans(room).filter((s) => !s.left);
  if (all.length > 0 && all.every((s) => s.ready)) room.deadline = Math.min(room.deadline ?? Infinity, Date.now() + 1_000);
  broadcastRoom(room);
}

function closeRoom(room: BumperRoom): void {
  const store = bumperStore();
  room.phase = 'closed';
  for (const seat of room.seats) seat.conn?.close(1000, 'closed');
  store.rooms.delete(room.id);
  store.byCode.delete(room.code);
}

// ── Wire ─────────────────────────────────────────────────────────────────

export function wireRoom(room: BumperRoom): WireRoom {
  const seats: WireSeat[] = room.seats.map((s) => {
    if (s.kind === 'empty') return { n: '', k: 'e' };
    const w: WireSeat = { n: s.name, k: s.kind === 'human' ? 'p' : 'b' };
    if (s.kind === 'human') {
      if (!s.conn && room.phase !== 'over') w.a = 1;
      if (s.left) w.l = 1;
      if (s.ready && room.phase === 'over') w.r = 1;
      if (s.userId === room.hostUserId) w.h = 1;
    }
    return w;
  });
  return {
    id: room.id,
    code: room.code,
    v: room.visibility,
    ph: room.phase,
    round: room.roundId,
    in: room.deadline === null ? null : Math.max(0, room.deadline - Date.now()),
    seats,
  };
}

function wireCars(sim: SimState): WireCar[] {
  return sim.cars.map((c) => [...packCar(c), c.steer, c.throttle, c.slip]);
}

function sendTo(seat: BumperSeat, msg: ServerMessage | string): void {
  if (!seat.conn) return;
  try {
    seat.conn.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  } catch {
    /* a dead socket is cleaned up by its close handler */
  }
}

export function broadcastRoom(room: BumperRoom): void {
  const msg = JSON.stringify({ t: 'room', room: wireRoom(room) } satisfies ServerMessage);
  for (const seat of room.seats) sendTo(seat, msg);
}

function welcomeFor(room: BumperRoom, seat: number): ServerMessage {
  const sim = room.sim;
  return {
    t: 'welcome',
    seat,
    room: wireRoom(room),
    k: sim?.tick ?? 0,
    c: sim ? wireCars(sim) : [],
    p: sim ? sim.points.slice() : new Array(MAX_CARS).fill(0),
    b: sim ? sim.bumps.slice() : new Array(MAX_CARS).fill(0),
    act: room.seats.map((s) => (s.kind === 'empty' ? 0 : 1)),
    serverNow: Date.now(),
  };
}

// ── Connections ──────────────────────────────────────────────────────────

/** A socket has said hello with a good ticket: sit it in its seat. */
export function attachConn(room: BumperRoom, conn: BumperConn): number {
  const i = seatOf(room, conn.userId);
  if (i < 0) throw new BumperRoomError('You are not in this round.', 403);
  const seat = room.seats[i]!;
  if (seat.left) throw new BumperRoomError('You left this round.', 409);
  if (seat.conn && seat.conn.id !== conn.id) seat.conn.close(4000, 'replaced');
  seat.conn = conn;
  seat.goneAt = null;
  // Back in time: the bot hands the wheel back and the score counts again.
  if (seat.droppedAt !== null) {
    seat.droppedAt = null;
    seat.bot = null;
    seat.inputs.clear();
    seat.held = { steer: 0, throttle: 0 };
    seat.newestInputTick = -1;
  }
  sendTo(seat, welcomeFor(room, i));
  if (room.phase === 'over' && room.standings) {
    const reward = seat.userId ? room.rewards.get(seat.userId) ?? null : null;
    sendTo(seat, { t: 'end', round: room.roundId ?? '', standings: room.standings, reward, settled: room.settled });
  }
  broadcastRoom(room);
  return i;
}

export function detachConn(room: BumperRoom, conn: BumperConn): void {
  const i = seatOf(room, conn.userId);
  if (i < 0) return;
  const seat = room.seats[i]!;
  if (seat.conn?.id !== conn.id) return;
  seat.conn = null;
  if (room.phase === 'running' && room.sim) seat.droppedAt = room.sim.tick;
  else {
    seat.droppedAt = null;
    seat.goneAt = Date.now();
  }
  broadcastRoom(room);
}

/** Strike a misbehaving socket; enough strikes close it and log it. */
export function strike(conn: BumperConn, reason: string): void {
  conn.strikes += 1;
  if (conn.strikes === MAX_STRIKES) {
    bumperStore().persist?.log(conn.userId, reason);
    conn.close(4008, 'too many bad messages');
  }
}

/** Inputs for ticks k - n + 1 .. k. */
export function receiveInputs(room: BumperRoom, conn: BumperConn, k: number, pairs: readonly number[]): void {
  const i = seatOf(room, conn.userId);
  if (i < 0 || room.phase !== 'running' || !room.sim) return;
  const seat = room.seats[i]!;
  if (seat.conn?.id !== conn.id || seat.left) return;
  const now = room.sim.tick;
  const n = pairs.length / 2;
  if (k > now + MAX_INPUT_LEAD_TICKS) {
    strike(conn, `inputs ${k - now} ticks ahead`);
    return;
  }
  for (let j = 0; j < n; j += 1) {
    const tick = k - n + 1 + j;
    const input = { steer: pairs[j * 2]!, throttle: pairs[j * 2 + 1]! };
    if (tick < now) {
      // Too late for its tick. If it's the newest we have, drive with it.
      if (tick > seat.newestInputTick) {
        seat.held = input;
        seat.lateInputs += 1;
      }
    } else if (!seat.inputs.has(tick)) {
      seat.inputs.set(tick, input);
    }
    if (tick > seat.newestInputTick) seat.newestInputTick = tick;
  }
}

// ── The round ────────────────────────────────────────────────────────────

function fillBots(room: BumperRoom): void {
  const used = new Set(room.seats.filter((s) => s.kind !== 'empty').map((s) => s.name));
  const names = BOT_NAMES.filter((n) => !used.has(n));
  const skills: Array<keyof typeof BOT_SKILLS> = ['medium', 'hard', 'easy', 'medium', 'medium', 'hard', 'easy', 'medium'];
  room.seats.forEach((seat, i) => {
    if (seat.kind !== 'empty' && seat.kind !== 'bot') return;
    const s = emptySeat();
    s.kind = 'bot';
    s.name = names[i % names.length] ?? `Car ${i + 1}`;
    s.bot = createBot(i, room.seed, BOT_SKILLS[skills[i]!]!);
    room.seats[i] = s;
  });
}

export function startRound(room: BumperRoom): void {
  if (room.phase === 'running') return;
  room.seed = crypto.randomBytes(4).readUInt32BE(0);
  room.roundId = crypto.randomUUID();
  room.rounds += 1;
  // Seats nobody readied for a rematch go.
  room.seats.forEach((s, i) => {
    if (s.kind === 'human' && (!s.ready || s.left)) {
      s.conn?.close(1000, 'not ready');
      room.seats[i] = emptySeat();
    }
    if (room.seats[i]!.kind === 'bot') room.seats[i] = emptySeat();
  });
  if (humans(room).length === 0) {
    closeRoom(room);
    return;
  }
  fillBots(room);
  for (const s of room.seats) {
    s.ready = false;
    s.inputs.clear();
    s.newestInputTick = -1;
    s.held = { steer: 0, throttle: 0 };
    s.droppedAt = s.kind === 'human' && !s.conn ? 0 : null;
    s.lateInputs = 0;
  }
  room.sim = createSim(room.seats.map(() => true));
  room.phase = 'running';
  room.deadline = null;
  room.startPerf = performance.now();
  room.startedAt = Date.now();
  room.pendingBumps = [];
  room.standings = null;
  room.rewards = new Map();
  room.settling = false;
  room.settled = false;
  const persist = bumperStore().persist;
  if (persist) void persist.start(room).catch((error) => console.error('[bumper-cars] round start write failed', error));
  const start = JSON.stringify({ t: 'start', round: room.roundId, k: 0, c: wireCars(room.sim) } satisfies ServerMessage);
  for (const seat of room.seats) sendTo(seat, start);
  broadcastRoom(room);
}

function seatInput(room: BumperRoom, i: number, sim: SimState): CarInput {
  const seat = room.seats[i]!;
  const car = sim.cars[i]!;
  if (seat.kind === 'bot') {
    car.counts = true;
    return botInput(seat.bot!, sim);
  }
  if (seat.kind !== 'human') return { steer: 0, throttle: 0 };
  // Gone for good, or gone past the grace: a bot minds the car, for nothing.
  const away = seat.droppedAt !== null && sim.tick - seat.droppedAt > DROP_GRACE_TICKS;
  if (seat.left || away) {
    car.counts = false;
    if (!seat.bot) seat.bot = createBot(i, room.seed ^ 0x5eed, BOT_SKILLS.easy);
    return botInput(seat.bot, sim);
  }
  car.counts = true;
  if (seat.droppedAt !== null) return { steer: 0, throttle: 0 };
  const now = sim.tick;
  const input = seat.inputs.get(now);
  if (input) {
    seat.held = input;
    seat.inputs.delete(now);
  }
  if (seat.inputs.size > 0 && (now & 63) === 0) {
    for (const t of seat.inputs.keys()) if (t < now) seat.inputs.delete(t);
  }
  return seat.held;
}

const stepEvents: SimEvent[] = [];
const stepInputs: CarInput[] = new Array(MAX_CARS);

function stepRoom(room: BumperRoom): void {
  const sim = room.sim!;
  sim.powered = sim.tick >= COUNTDOWN_TICKS && sim.tick < END_TICK;
  for (let i = 0; i < MAX_CARS; i += 1) stepInputs[i] = seatInput(room, i, sim);
  setInputs(sim, stepInputs);
  stepEvents.length = 0;
  stepSim(sim, stepEvents);
  for (const e of stepEvents) {
    if (e.type === 'bump' && (e.pa > 0 || e.pb > 0)) {
      room.pendingBumps.push([e.tick, e.a, e.b, e.pa, e.pb, Math.round(e.speed * 100)]);
    }
  }
  if (sim.tick % SNAPSHOT_EVERY === 0) sendSnapshot(room);
  if (sim.tick === FINAL_TICK) endRound(room);
}

function sendSnapshot(room: BumperRoom): void {
  const sim = room.sim!;
  const common =
    `"k":${sim.tick},"c":${JSON.stringify(wireCars(sim))},"p":${JSON.stringify(sim.points)},"b":${JSON.stringify(sim.bumps)}` +
    (room.pendingBumps.length > 0 ? `,"e":${JSON.stringify(room.pendingBumps)}` : '');
  room.pendingBumps = [];
  for (const seat of room.seats) {
    if (!seat.conn) continue;
    const ib = seat.newestInputTick < 0 ? 0 : seat.newestInputTick - sim.tick;
    sendTo(seat, `{"t":"s","ib":${ib},${common}}`);
  }
}

export function standingsFor(room: BumperRoom): WireStanding[] {
  const sim = room.sim!;
  const present = room.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'empty').map(({ i }) => i);
  const places = placesFor(sim.points, present);
  return present
    .map((i) => {
      const seat = room.seats[i]!;
      const result: WireStanding['result'] =
        seat.kind === 'bot' ? 'bot' : seat.left ? 'forfeit' : seat.conn ? 'finished' : 'timeout';
      return { seat: i, name: seat.name, points: sim.points[i]!, bumps: sim.bumps[i]!, place: places.get(i)!, result };
    })
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
}

function endRound(room: BumperRoom): void {
  const sim = room.sim!;
  const standings = standingsFor(room);
  room.standings = standings;
  room.phase = 'over';
  room.deadline = Date.now() + REMATCH_WINDOW_MS;
  for (const s of room.seats) s.ready = false;
  // Tell everyone the result now; payouts follow when the ledger has them.
  for (const seat of room.seats) {
    sendTo(seat, { t: 'end', round: room.roundId!, standings, reward: null, settled: false });
  }
  broadcastRoom(room);
  void settleRoom(room, sim.tick);
}

/** Settle once. The database refuses a second settle of the same round, and
 *  tickets are keyed by round and player, so a retry can't pay twice. */
export async function settleRoom(room: BumperRoom, finalTick: number): Promise<void> {
  if (room.settling || room.settled || !room.standings || !room.roundId) return;
  room.settling = true;
  const persist = bumperStore().persist;
  const players: SettleSeat[] = [];
  for (const st of room.standings) {
    const seat = room.seats[st.seat]!;
    if (seat.kind !== 'human' || !seat.userId || st.result === 'bot') continue;
    players.push({ seat: st.seat, userId: seat.userId, name: seat.name, points: st.points, bumps: st.bumps, place: st.place, result: st.result });
  }
  const req: SettleRequest = {
    roundId: room.roundId,
    roomId: room.id,
    code: room.code,
    seed: room.seed,
    startedAt: room.startedAt,
    cars: room.standings.length,
    finalTick,
    standings: room.standings,
    players,
  };
  try {
    const out = persist ? await persist.settle(req) : { settled: false, rewards: new Map() };
    room.rewards = out.rewards;
    room.settled = true;
  } catch (error) {
    console.error('[bumper-cars] settle failed', room.roundId, error);
    room.settling = false;
    return;
  }
  room.settling = false;
  for (const seat of room.seats) {
    if (seat.kind !== 'human' || !seat.userId) continue;
    sendTo(seat, { t: 'end', round: room.roundId, standings: room.standings, reward: room.rewards.get(seat.userId) ?? null, settled: true });
  }
}

/** The phase read fresh, past TypeScript's narrowing: a call can close a room. */
function isClosed(room: BumperRoom): boolean {
  return room.phase === 'closed';
}

// ── The loop ─────────────────────────────────────────────────────────────

function tickRooms(): void {
  const now = Date.now();
  const perf = performance.now();
  for (const room of bumperStore().rooms.values()) {
    if (room.phase === 'running' && room.sim) {
      const due = Math.floor((perf - room.startPerf) / TICK_MS);
      let steps = 0;
      while (room.phase === 'running' && room.sim.tick < due && steps < 12) {
        stepRoom(room);
        steps += 1;
      }
      // A stall longer than 200 ms: shift the clock rather than fast-forward.
      if (room.phase === 'running' && room.sim.tick < due) room.startPerf = perf - room.sim.tick * TICK_MS;
    } else if (room.phase === 'lobby') {
      // A player who closed the page in the lobby gives the seat back.
      for (const seat of room.seats) {
        if (seat.kind === 'human' && !seat.conn && seat.goneAt !== null && now - seat.goneAt > LOBBY_GONE_MS && seat.userId) {
          leaveRoom(room, seat.userId);
          if (isClosed(room)) break;
        }
      }
      if (isClosed(room)) continue;
      if (room.deadline !== null && now >= room.deadline) {
        if (room.visibility === 'invite' && room.rounds === 0) closeRoom(room);
        else startRound(room);
      }
    } else if (room.phase === 'over') {
      if (!room.settled && !room.settling && room.standings) void settleRoom(room, room.sim?.tick ?? FINAL_TICK);
      if (room.deadline !== null && now >= room.deadline) {
        const ready = humans(room).filter((s) => s.ready && !s.left);
        if (ready.length === 0) closeRoom(room);
        else {
          room.phase = 'lobby';
          room.deadline = now + REMATCH_LOBBY_MS;
          room.seats.forEach((s, i) => {
            if (s.kind === 'human' && !s.ready) {
              s.conn?.close(1000, 'not ready');
              room.seats[i] = emptySeat();
            }
          });
          broadcastRoom(room);
        }
      }
    }
  }
}

/** Start the room loop. server.ts calls this once; it's idempotent. */
export function startBumperCarsLoop(persist: NonNullable<BumperStore['persist']>): void {
  const store = bumperStore();
  store.persist = persist;
  if (store.loop) return;
  store.loop = setInterval(tickRooms, 4);
  store.loop.unref?.();
}

/** For tests: step a running room to a tick without waiting. */
export function debugAdvance(room: BumperRoom, ticks: number): void {
  for (let i = 0; i < ticks && room.phase === 'running'; i += 1) stepRoom(room);
}
