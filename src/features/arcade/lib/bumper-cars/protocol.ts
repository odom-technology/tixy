/* The bumper cars wire format, both ways, over the /ws/bumper-cars socket.
   JSON, short keys, integers. The page sends its inputs; the server sends
   the world. Pure: the server, the page and the sync test share it. */

import { INPUT_REDUNDANCY, MAX_CARS } from './constants';
import { clampInput } from './sim';

export const BUMPER_WS_PATH = '/ws/bumper-cars';

/** A room's phase. `running` covers the count in, the round and the coast;
 *  the page reads which from the tick. */
export type RoomPhase = 'lobby' | 'running' | 'over' | 'closed';

/** One seat, as everyone sees it. */
export type WireSeat = {
  /** Name. */
  n: string;
  /** p: a player, b: a bot, e: empty. */
  k: 'p' | 'b' | 'e';
  /** Away: the player's connection dropped. */
  a?: 1;
  /** Left the round. */
  l?: 1;
  /** Ready for the next round. */
  r?: 1;
  /** The room's host. */
  h?: 1;
};

export type WireRoom = {
  id: string;
  code: string;
  /** invite or public. */
  v: 'invite' | 'public';
  ph: RoomPhase;
  round: string | null;
  /** Milliseconds until the lobby or the rematch window closes, or null. */
  in: number | null;
  seats: WireSeat[];
};

/** A car on the wire: packCar's seven, then steer, throttle and slip. */
export type WireCar = number[];

/** A scored bump: tick, a, b, a's points, b's points, closing speed in cm/s. */
export type WireBump = [number, number, number, number, number, number];

export type WireStanding = {
  seat: number;
  name: string;
  points: number;
  bumps: number;
  place: number;
  /** finished, forfeit (left), timeout (gone at the end), bot. */
  result: 'finished' | 'forfeit' | 'timeout' | 'bot';
};

export type WireReward = {
  tickets: number;
  wanted: number;
  balanceAfter: number | null;
  score: number;
  account?: unknown;
  achievements?: unknown[];
} | null;

// ── Server to page ───────────────────────────────────────────────────────

export type ServerMessage =
  | { t: 'welcome'; seat: number; room: WireRoom; k: number; c: WireCar[]; p: number[]; b: number[]; act: number[]; serverNow: number }
  | { t: 'room'; room: WireRoom }
  /** A snapshot at tick k. `ib` is how far ahead of the server your newest
   *  input is, in ticks: the page keeps it at about 3. */
  | { t: 's'; k: number; ib: number; c: WireCar[]; p: number[]; b: number[]; e?: WireBump[] }
  | { t: 'start'; round: string; k: number; c: WireCar[] }
  | { t: 'end'; round: string; standings: WireStanding[]; reward: WireReward; settled: boolean }
  | { t: 'pong'; c: number; k: number }
  | { t: 'err'; m: string; fatal?: 1 };

// ── Page to server ───────────────────────────────────────────────────────

export type ClientMessage =
  | { t: 'hello'; ticket: string }
  /** Inputs for ticks k - n + 1 .. k, as steer, throttle pairs, oldest first. */
  | { t: 'in'; k: number; d: number[] }
  | { t: 'ping'; c: number }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'leave' };

export const MAX_CLIENT_MESSAGE_BYTES = 512;
export const MAX_INPUTS_PER_MESSAGE = INPUT_REDUNDANCY + 2;

/** Read a page message. Anything malformed is null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return typeof m.ticket === 'string' && m.ticket.length > 0 && m.ticket.length <= 128 ? { t: 'hello', ticket: m.ticket } : null;
    case 'in': {
      if (typeof m.k !== 'number' || !Number.isInteger(m.k) || m.k < 0 || m.k > 1e7) return null;
      if (!Array.isArray(m.d) || m.d.length === 0 || m.d.length % 2 !== 0 || m.d.length > MAX_INPUTS_PER_MESSAGE * 2) return null;
      const d: number[] = [];
      for (const v of m.d) {
        if (typeof v !== 'number' || !Number.isInteger(v)) return null;
        d.push(clampInput(v));
      }
      return { t: 'in', k: m.k, d };
    }
    case 'ping':
      return typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    case 'start':
    case 'rematch':
    case 'leave':
      return { t: m.t };
    default:
      return null;
  }
}

export function emptySeats(): WireSeat[] {
  return Array.from({ length: MAX_CARS }, () => ({ n: '', k: 'e' as const }));
}
