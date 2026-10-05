/* Bumper cars netcode, end to end in one process: the real room loop and
   socket session from the server, eight real `OnlineRound` clients from the
   page, joined by fake sockets with 50 to 150 ms of latency each way and
   jitter, some clients ticking at 30 Hz with frame stalls, one dropping for
   8 s mid-round (its reconnect fails for 4 s) and rejoining. Every client
   drives with a bot reading its own predicted world.

   Passes when every client ends on the server's scoreboard, the round is
   settled once in the database with one ledger row per paid player, and a
   second settle pays nothing. Prints the prediction numbers.

     DATABASE_URL=... npx tsx scripts/bumper-cars-sync-node.ts           (about 100 s) */

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { BOT_SKILLS, botInput, createBot, type BotBrain } from '../src/features/arcade/lib/bumper-cars/bots';
import { COUNTDOWN_TICKS, TICK_HZ } from '../src/features/arcade/lib/bumper-cars/constants';
import { OnlineRound, type SocketLike, type TicketInfo } from '../src/features/arcade/lib/bumper-cars/online';
import type { WireStanding } from '../src/features/arcade/lib/bumper-cars/protocol';
import { BUMPER_WS_PATH } from '../src/features/arcade/lib/bumper-cars/protocol';
import { createAccount } from '../src/server/accounts';
import { query } from '../src/server/db/client';
import { bumperStore, getRoom, issueTicket, quickPlay, wireRoom } from '../src/server/arcade/bumper-cars/rooms';
import { settleRound } from '../src/server/arcade/bumper-cars/persist';
import { createBumperSession, startBumperCarsServer } from '../src/server/arcade/bumper-cars/ws';

const CLIENTS = 8;
const DROPPER = 3;
const fail = (msg: string): never => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};

/** A pair of sockets with latency and jitter each way, in order. */
function link(latencyMs: number, jitterMs: number) {
  let up = 0;
  let down = 0;
  const delay = (last: number) => Math.max(last, performance.now() + latencyMs + (Math.random() * 2 - 1) * jitterMs);
  let open = true;
  const client: SocketLike = {
    readyState: 0,
    send: (data) => {
      if (!open) return;
      up = delay(up);
      const at = up;
      setTimeout(() => open && session.onMessage(data, Buffer.byteLength(data)), at - performance.now());
    },
    close: () => shut(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const shut = () => {
    if (!open) return;
    open = false;
    client.readyState = 3;
    setTimeout(() => {
      session.onClose();
      client.onclose?.();
    }, latencyMs);
  };
  const session = createBumperSession({
    send: (data) => {
      if (!open) return;
      down = delay(down);
      setTimeout(() => open && client.onmessage?.({ data }), down - performance.now());
    },
    close: () => shut(),
  });
  setTimeout(() => {
    client.readyState = 1;
    client.onopen?.();
  }, latencyMs);
  return client;
}

async function main() {
  startBumperCarsServer();
  const suffix = crypto.randomBytes(3).toString('hex');
  const users: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < CLIENTS; i += 1) {
    const account = await createAccount({ email: `bc-sync-${suffix}-${i}@example.com`, username: `bcs${suffix}${i}` });
    users.push({ id: account.id, name: account.username ?? `p${i}` });
  }
  // Everyone presses play now within the lobby window: one room.
  const rooms = users.map((u) => quickPlay(u.id, u.name));
  const roomId = rooms[0]!.id;
  if (rooms.some((r) => r.id !== roomId)) fail('play now put the players in different rooms');
  console.log(`room ${roomId}, ${CLIENTS} players, started: ${getRoom(roomId)!.phase}`);

  const latency = users.map((_, i) => 25 + Math.round((i / (CLIENTS - 1)) * 50)); // one way: 50 to 150 ms round trip
  const ticketFor = (i: number): TicketInfo => {
    const room = getRoom(roomId)!;
    const seat = room.seats.findIndex((s) => s.userId === users[i]!.id);
    return { ticket: issueTicket(users[i]!.id, users[i]!.name, roomId), room: wireRoom(room), seat, ws: BUMPER_WS_PATH };
  };
  let outageUntil = 0;
  const ends: Array<{ standings: WireStanding[]; settled: boolean; tickets: number | null } | null> = new Array(CLIENTS).fill(null);
  const clients = users.map((_, i) => {
    const round: OnlineRound = new OnlineRound({
      connect: () => link(latency[i]!, 12),
      first: ticketFor(i),
      ticket: async () => {
        if (i === DROPPER && performance.now() < outageUntil) throw new Error('network down');
        return ticketFor(i);
      },
      onEnd: (end) => {
        ends[i] = { standings: end.standings, settled: end.settled, tickets: end.reward ? end.reward.tickets : null };
      },
    });
    return round;
  });
  const brains: BotBrain[] = clients.map((_, i) => createBot(i, 99 + i, BOT_SKILLS.medium));

  // Clients 5 to 7 are slow phones: 30 Hz with stalls of up to 200 ms.
  const slow = (i: number) => i >= 5;
  let dropped = false;
  let rejoined = false;
  const lastFrame = new Array(CLIENTS).fill(0);
  const stallUntil = new Array(CLIENTS).fill(0);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const now = performance.now();
      clients.forEach((c, i) => {
        if (now < stallUntil[i]) return;
        if (slow(i) && now - lastFrame[i] < 33) return;
        if (slow(i) && Math.random() < 0.01) stallUntil[i] = now + 80 + Math.random() * 120;
        lastFrame[i] = now;
        const state = c.predictedState();
        if (c.isRunning()) {
          const input = botInput(brains[i]!, state as never);
          c.setInput(input.steer, input.throttle);
        }
        c.update(now);
        c.drainEvents();
      });
      const room = getRoom(roomId);
      const tick = room?.sim?.tick ?? 0;
      if (!dropped && tick > COUNTDOWN_TICKS + 30 * TICK_HZ) {
        dropped = true;
        outageUntil = now + 4000;
        console.log(`t=${((now - t0) / 1000).toFixed(1)}s client ${DROPPER} drops`);
        clients[DROPPER]!.dropForTest();
      }
      if (dropped && !rejoined && clients[DROPPER]!.connectionStatus() === 'live' && now > outageUntil) {
        rejoined = true;
        console.log(`t=${((now - t0) / 1000).toFixed(1)}s client ${DROPPER} is back, reconnects ${clients[DROPPER]!.netStats().reconnects}`);
      }
      if (ends.every((e) => e?.settled)) {
        clearInterval(timer);
        resolve();
      }
      if (now - t0 > 150_000) {
        clearInterval(timer);
        fail(`timed out: ends ${JSON.stringify(ends.map((e) => e?.settled ?? null))}`);
      }
    }, 4);
  });

  const room = getRoom(roomId)!;
  const server = room.standings!;
  const key = (s: WireStanding[]) => s.map((x) => `${x.seat}:${x.points}:${x.place}`).join(',');
  console.log('\nserver scoreboard:', server.map((s) => `${s.name} ${s.points}`).join(', '));
  let ok = true;
  clients.forEach((c, i) => {
    const end = ends[i]!;
    const same = key(end.standings) === key(server);
    const pts = c.points();
    const pointsMatch = server.every((s) => pts[s.seat] === s.points);
    const st = c.netStats();
    console.log(
      `client ${i}: rtt ${st.rttMs.toFixed(0)} ms, ${slow(i) ? '30 Hz with stalls' : '250 Hz'}, ` +
        `scoreboard ${same && pointsMatch ? 'same' : 'DIFFERENT'}, tickets ${end.tickets}, snapshots ${st.snapshots}, ` +
        `input lead ${st.ibMean.toFixed(1)} ticks, own car moved by ${st.myMoved} of ${st.snapshots} snapshots ` +
        `(mean ${(st.myMovedMean * 100).toFixed(1)} cm, max ${(st.myMovedMax * 100).toFixed(0)} cm), ` +
        `others ${(st.othersMovedMean * 100).toFixed(1)} cm mean, reconnects ${st.reconnects}`,
    );
    if (!same || !pointsMatch) ok = false;
  });
  if (!ok) fail('a client ended on a different scoreboard');
  if (!rejoined) fail('the dropped client never came back');
  const dropperSeat = room.seats.findIndex((s) => s.userId === users[DROPPER]!.id);
  const dropperResult = server.find((s) => s.seat === dropperSeat)!;
  console.log(`dropped client finished as "${dropperResult.result}" with ${dropperResult.points} points`);
  if (dropperResult.result !== 'finished') fail('the rejoined player did not finish the round');

  // The ledger: one row per player for this round, and a second settle pays nothing.
  const roundId = room.roundId!;
  const ledger = async () =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM currency_ledger WHERE source_id LIKE $1`, [`bumper-cars:${roundId}:%`])).rows[0]!.n);
  const rows = await ledger();
  const status = (await query<{ status: string }>(`SELECT status FROM bumper_car_rounds WHERE id = $1`, [roundId])).rows[0]?.status;
  const paidPlayers = server.filter((s) => s.result !== 'forfeit' && s.result !== 'bot' && s.points > 0).length;
  console.log(`round ${roundId}: status ${status}, ledger rows ${rows} (players with points ${paidPlayers})`);
  if (status !== 'settled') fail('round not settled');
  if (rows !== paidPlayers) fail(`expected ${paidPlayers} ledger rows, found ${rows}`);
  const again = await settleRound({
    roundId,
    roomId,
    code: room.code,
    seed: room.seed,
    startedAt: room.startedAt,
    cars: server.length,
    finalTick: room.sim!.tick,
    standings: server,
    players: server
      .filter((s) => s.result !== 'bot')
      .map((s) => ({ seat: s.seat, userId: room.seats[s.seat]!.userId!, name: s.name, points: s.points, bumps: s.bumps, place: s.place, result: s.result as 'finished' })),
  });
  const rowsAfter = await ledger();
  console.log(`second settle: settled=${again.settled}, ledger rows ${rowsAfter}`);
  if (again.settled || rowsAfter !== rows) fail('a second settle paid');

  for (const c of clients) c.dispose();
  clearInterval(bumperStore().loop!);
  console.log('\nPASS');
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
