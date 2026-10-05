/* The bumper cars socket, on /ws/bumper-cars. A page says hello with a
   one-use ticket from the room route, which names the player and the room;
   after that it sends inputs, pings, and start, rematch or leave. Every
   message is size-checked, parsed strictly and rate limited; a socket that
   keeps misbehaving is closed and logged to anti_cheat_logs.

   A separate WebSocketServer from the session socket on /ws, so nothing here
   touches the other games' messages. Derby's realtime work may want the same
   shape; this file is named for bumper cars so the two can be merged later. */

import crypto from 'node:crypto';
import type { RawData, WebSocket, WebSocketServer } from 'ws';

import { parseClientMessage, type ServerMessage } from '@/features/arcade/lib/bumper-cars/protocol';
import {
  attachConn,
  BumperRoomError,
  detachConn,
  getRoom,
  hostStart,
  leaveRoom,
  markRematch,
  MAX_MESSAGES_PER_SECOND,
  receiveInputs,
  redeemTicket,
  startBumperCarsLoop,
  strike,
  type BumperConn,
} from './rooms';

const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 2_000;
const DEAD_AFTER_MS = 6_000;

/** One socket's session, independent of the transport: ws.ts wires a real
 *  WebSocket to it, and the sync test wires a delayed fake. */
export function createBumperSession(transport: {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}): { onMessage: (text: string, bytes: number) => void; onClose: () => void; helloTimer: ReturnType<typeof setTimeout> } {
  let conn: BumperConn | null = null;
  let roomId: string | null = null;
  const reply = (msg: ServerMessage) => {
    try {
      transport.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  };
  const helloTimer = setTimeout(() => {
    if (!conn) {
      reply({ t: 'err', m: 'Say hello first.', fatal: 1 });
      transport.close(4001, 'no hello');
    }
  }, HELLO_TIMEOUT_MS);

  const onMessage = (text: string, bytes: number) => {
    if (bytes > 1024) {
      if (conn) strike(conn, 'oversized message');
      else transport.close(4002, 'bad message');
      return;
    }
    const msg = parseClientMessage(text);
    if (!msg) {
      if (conn) strike(conn, 'malformed message');
      return;
    }

    if (!conn) {
      if (msg.t !== 'hello') {
        transport.close(4001, 'no hello');
        return;
      }
      const ticket = redeemTicket(msg.ticket);
      const room = ticket ? getRoom(ticket.roomId) : null;
      if (!ticket || !room) {
        reply({ t: 'err', m: 'That round has closed.', fatal: 1 });
        transport.close(4003, 'bad ticket');
        return;
      }
      clearTimeout(helloTimer);
      const c: BumperConn = {
        id: crypto.randomUUID(),
        userId: ticket.userId,
        send: (data) => transport.send(data),
        close: (code, reason) => transport.close(code, reason),
        windowStart: Date.now(),
        windowCount: 0,
        strikes: 0,
      };
      try {
        attachConn(room, c);
      } catch (error) {
        reply({ t: 'err', m: error instanceof BumperRoomError ? error.message : 'Could not join.', fatal: 1 });
        transport.close(4004, 'cannot join');
        return;
      }
      conn = c;
      roomId = room.id;
      return;
    }

    // Rate limit: a page sends 30 input messages and a ping a second.
    const now = Date.now();
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount += 1;
    if (conn.windowCount > MAX_MESSAGES_PER_SECOND) {
      strike(conn, `over ${MAX_MESSAGES_PER_SECOND} messages a second`);
      return;
    }

    const room = roomId ? getRoom(roomId) : null;
    if (!room) {
      reply({ t: 'err', m: 'That round has closed.', fatal: 1 });
      transport.close(1000, 'closed');
      return;
    }
    try {
      switch (msg.t) {
        case 'in':
          receiveInputs(room, conn, msg.k, msg.d);
          break;
        case 'ping':
          reply({ t: 'pong', c: msg.c, k: room.sim?.tick ?? 0 });
          break;
        case 'start':
          hostStart(room, conn.userId);
          break;
        case 'rematch':
          markRematch(room, conn.userId);
          break;
        case 'leave':
          leaveRoom(room, conn.userId);
          break;
        case 'hello':
          strike(conn, 'second hello');
          break;
      }
    } catch (error) {
      reply({ t: 'err', m: error instanceof BumperRoomError ? error.message : 'Something went wrong.' });
    }
  };

  const onClose = () => {
    clearTimeout(helloTimer);
    if (conn && roomId) {
      const room = getRoom(roomId);
      if (room) detachConn(room, conn);
    }
  };

  return { onMessage, onClose, helloTimer };
}

export function attachBumperCarsWs(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    let lastPong = Date.now();
    const session = createBumperSession({
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    });
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > DEAD_AFTER_MS) {
        ws.terminate();
        return;
      }
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, HEARTBEAT_MS);
    ws.on('pong', () => {
      lastPong = Date.now();
    });
    ws.on('message', (raw: RawData, isBinary: boolean) => {
      lastPong = Date.now();
      const bytes = Array.isArray(raw) ? raw.reduce((n, b) => n + b.length, 0) : raw instanceof ArrayBuffer ? raw.byteLength : raw.length;
      if (isBinary) {
        session.onMessage('', 4096);
        return;
      }
      const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');
      session.onMessage(text, bytes);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      session.onClose();
    });
    ws.on('error', () => {
      /* the close handler cleans up */
    });
  });
}

/** Boot: void rounds a previous server left live, then start the room loop.
 *  The database side loads lazily: it reaches the wallet, which reaches
 *  Next's request storage, and server.ts runs before Next has set that up. */
export function startBumperCarsServer(): void {
  void import('./persist')
    .then(({ logBumperCheat, settleRound, voidStaleRounds, writeRoundStart }) => {
      startBumperCarsLoop({ start: writeRoundStart, settle: settleRound, log: logBumperCheat });
      // A round lasts under two minutes. Anything live and older than ten was
      // left by a server that stopped; a younger one may belong to another.
      return voidStaleRounds(Date.now() - 10 * 60_000).then((n) => {
        if (n > 0) console.log(`[bumper-cars] voided ${n} round(s) left live by the last server`);
      });
    })
    .catch((error) => console.error('[bumper-cars] could not start the room loop', error));
}
