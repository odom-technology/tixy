import { checkGameSessionResume, GameUnavailableError } from '@/server/arcade/game-availability';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RawData, WebSocket, WebSocketServer } from 'ws';
import { recordGameEvent } from '../game-events';
import {
  getActiveSessionFromToken,
  recordGameAction,
} from '../game-session';

type WsClientState = {
  ready: boolean;
  sessionId: string;
  odUserId: string;
  gameType: string;
  rttMs: number;
  minRttMs: number;
  rttSamples: number[];
  lastPingId?: string;
  lastPingSentAt?: number;
  rtRound: number;
  rtGreenAt?: number;
  rtGreenPerf?: number;
  rtRoundId?: string;
  rtTimer?: ReturnType<typeof setTimeout> | null;
  msgWindowStartMs: number;
  msgWindowCount: number;
  totalMessages: number;
  abuseStrikes: number;
  lastFlappyFlapTs?: number;
  lastFlappyFlapClientT?: number;
  lastFlappyPipeTs?: number;
  lastFlappyPipeClientT?: number;
  lastSnakeFoodTs?: number;
  lastSnakeFoodClientT?: number;
  lastStackDropTs?: number;
  lastStackDropClientT?: number;
  lastSequenceTapTs?: number;
  lastSequenceTapClientT?: number;
  lastBreakoutBrickTs?: number;
  lastBreakoutBrickClientT?: number;
  lastBreakoutLevelTs?: number;
  lastBreakoutLevelClientT?: number;
  lastSeq?: number;
  closed?: boolean;
};

type WsMessage =
  | { type: 'hello'; token: string; seq?: number }
  | { type: 'event'; eventType: string; data?: unknown; seq?: number }
  | { type: 'typing_key'; key: string; seq?: number }
  | { type: 'rt_ready'; seq?: number }
  | { type: 'rt_click'; roundId?: string; reactionMs?: number; seq?: number }
  | { type: 'pong'; id: string };

type WsResponse =
  | { type: 'hello_ack' }
  | { type: 'error'; error: string }
  | { type: 'ping'; id: string }
  | { type: 'rt_green'; round: number; roundId: string; serverTs: number };

const PING_INTERVAL_MS = 10000;
const PING_TIMEOUT_MS = 15000;
const MAX_MESSAGES_PER_SECOND = 80;
const MAX_MESSAGES_PER_SESSION = 20000;
const MAX_ABUSE_STRIKES = 8;
const MIN_FLAPPY_FLAP_INTERVAL_MS = 35;
const MIN_FLAPPY_PIPE_INTERVAL_MS = 500;
// At max tick rate (15/s = 66ms/tick), server-side timestamps of
// consecutive food events can land within 60ms due to network jitter.
// Lowered from 60→40 to prevent silent event drops that cause
// authoritative food count < actual food collected → false rejections.
const MIN_SNAKE_FOOD_INTERVAL_MS = 40;
const MIN_STACK_DROP_INTERVAL_MS = 110;
const MIN_SEQUENCE_TAP_INTERVAL_MS = 70;
const MIN_BREAKOUT_BRICK_INTERVAL_MS = 45;
const MIN_BREAKOUT_LEVEL_INTERVAL_MS = 1000;
const HELLO_TIMEOUT_MS = 5000;
const MAX_WS_MESSAGE_BYTES = 8 * 1024;
const MAX_HELLO_TOKEN_LENGTH = 2048;
const MAX_EVENT_TYPE_LENGTH = 32;
const MAX_EVENT_PAYLOAD_BYTES = 1024;
const MAX_REACTION_RTT_ADJUST_MS = 80;
const MAX_RTT_SAMPLES = 12;

const readClientEventTime = (data: unknown): number | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const clientT = (data as { t?: unknown }).t;
  if (
    typeof clientT !== 'number' ||
    !Number.isFinite(clientT) ||
    clientT < 0
  ) {
    return undefined;
  }
  return clientT;
};

const isEventIntervalSuspicious = (params: {
  minIntervalMs: number;
  nowTs: number;
  lastServerTs?: number;
  clientT?: number;
  lastClientT?: number;
}): boolean => {
  const {
    minIntervalMs,
    nowTs,
    lastServerTs,
    clientT,
    lastClientT,
  } = params;

  if (clientT !== undefined && lastClientT !== undefined) {
    return clientT - lastClientT < minIntervalMs;
  }
  if (lastServerTs !== undefined) {
    return nowTs - lastServerTs < minIntervalMs;
  }
  return false;
};

type SessionGuard = {
  ws: WebSocket;
  odUserId: string;
  gameType: string;
  establishedAt: number;
  lastSeq: number;
};

const activeSessionGuards = new Map<string, SessionGuard>();

const safeSend = (ws: WebSocket, message: WsResponse) => {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // ignore send errors
  }
};

export const attachGameWs = (wss: WebSocketServer) => {
  wss.on('connection', (ws: WebSocket) => {
    let state: WsClientState | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let helloTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (state) return;
      safeSend(ws, { type: 'error', error: 'Hello timeout' });
      close();
    }, HELLO_TIMEOUT_MS);

    const close = () => {
      if (state?.closed) return;
      if (state) {
        state.closed = true;
        if (state.rtTimer) clearTimeout(state.rtTimer);
      }
      if (pingInterval) clearInterval(pingInterval);
      if (helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const startPings = () => {
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (!state || state.closed) return;
        const id = crypto.randomUUID();
        state.lastPingId = id;
        state.lastPingSentAt = Date.now();
        safeSend(ws, { type: 'ping', id });
        setTimeout(() => {
          if (!state || state.closed) return;
          if (state.lastPingId === id) {
            // ping timed out; keep connection but stop RTT updates
            state.lastPingId = undefined;
          }
        }, PING_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
    };

    ws.on('message', async (raw: RawData) => {
      const rawBytes = Array.isArray(raw)
        ? raw.reduce((sum, chunk) => sum + chunk.length, 0)
        : raw instanceof ArrayBuffer
          ? raw.byteLength
          : raw.length;
      if (rawBytes > MAX_WS_MESSAGE_BYTES) {
        safeSend(ws, { type: 'error', error: 'Message too large' });
        close();
        return;
      }

      const rawText = Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf8')
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString('utf8')
          : raw.toString('utf8');

      let msg: WsMessage;
      try {
        msg = JSON.parse(rawText) as WsMessage;
      } catch {
        safeSend(ws, { type: 'error', error: 'Invalid JSON' });
        return;
      }

      if (!state) {
        if (msg.type !== 'hello' || !msg.token) {
          safeSend(ws, { type: 'error', error: 'Missing hello' });
          close();
          return;
        }
        if (
          typeof msg.token !== 'string' ||
          msg.token.length > MAX_HELLO_TOKEN_LENGTH
        ) {
          safeSend(ws, { type: 'error', error: 'Invalid token' });
          close();
          return;
        }
        const result = await getActiveSessionFromToken(msg.token);
        if (!result.valid || !result.session) {
          safeSend(ws, { type: 'error', error: result.error || 'Invalid token' });
          close();
          return;
        }
        try {
          await checkGameSessionResume(result.session.game_type, result.session.started_at);
        } catch (error) {
          if (!(error instanceof GameUnavailableError)) {
            console.error('Failed to check game availability:', error);
          }
          safeSend(ws, {
            type: 'error',
            error: error instanceof GameUnavailableError
              ? error.message
              : 'Game availability could not be checked. Please try again.',
          });
          close();
          return;
        }
        const sessionId = result.session.id;
        const existingGuard = activeSessionGuards.get(sessionId);
        if (existingGuard && existingGuard.ws !== ws) {
          try {
            existingGuard.ws.close();
          } catch {
            // ignore close errors on stale sockets
          }
        }
        activeSessionGuards.set(sessionId, {
          ws,
          odUserId: result.session.od_user_id,
          gameType: result.session.game_type,
          establishedAt: Date.now(),
          lastSeq: -1,
        });
        state = {
          ready: true,
          sessionId,
          odUserId: result.session.od_user_id,
          gameType: result.session.game_type,
          rttMs: 0,
          minRttMs: 0,
          rttSamples: [],
          rtRound: 0,
          rtTimer: null,
          msgWindowStartMs: Date.now(),
          msgWindowCount: 0,
          totalMessages: 0,
          abuseStrikes: 0,
        };
        if (helloTimer) {
          clearTimeout(helloTimer);
          helloTimer = null;
        }
        safeSend(ws, { type: 'hello_ack' });
        startPings();
        return;
      }

      if (msg.type === 'pong' && state.lastPingId === msg.id) {
        const now = Date.now();
        const sentAt = state.lastPingSentAt ?? now;
        const rtt = Math.max(0, now - sentAt);
        state.rttMs = rtt;
        state.rttSamples.push(rtt);
        if (state.rttSamples.length > MAX_RTT_SAMPLES) {
          state.rttSamples.splice(0, state.rttSamples.length - MAX_RTT_SAMPLES);
        }
        state.minRttMs =
          state.rttSamples.length > 0 ? Math.min(...state.rttSamples) : rtt;
        state.lastPingId = undefined;
        return;
      }

      if (!state.ready) return;

      // Sequence validation blocks replay/reorder of WS actions.
      if (
        msg.type !== 'pong' &&
        msg.type !== 'hello' &&
        (msg.type === 'event' ||
          msg.type === 'typing_key' ||
          msg.type === 'rt_ready' ||
          msg.type === 'rt_click')
      ) {
        const seq = msg.seq;
        const guard = activeSessionGuards.get(state.sessionId);
        if (!guard || guard.ws !== ws) {
          safeSend(ws, { type: 'error', error: 'Stale session connection' });
          close();
          return;
        }
        if (!Number.isInteger(seq)) {
          state.abuseStrikes += 1;
          if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
            safeSend(ws, { type: 'error', error: 'Invalid message sequence' });
            close();
          }
          return;
        }
        const seqNum = seq as number;
        if (seqNum <= guard.lastSeq) {
          state.abuseStrikes += 1;
          if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
            safeSend(ws, { type: 'error', error: 'Invalid message sequence' });
            close();
          }
          return;
        }
        guard.lastSeq = seqNum;
        state.lastSeq = seqNum;
      }

      // Basic anti-abuse rate limiting for WS messages.
      const nowMs = Date.now();
      if (nowMs - state.msgWindowStartMs >= 1000) {
        state.msgWindowStartMs = nowMs;
        state.msgWindowCount = 0;
      }
      state.msgWindowCount += 1;
      state.totalMessages += 1;
      if (
        state.msgWindowCount > MAX_MESSAGES_PER_SECOND ||
        state.totalMessages > MAX_MESSAGES_PER_SESSION
      ) {
        safeSend(ws, { type: 'error', error: 'Rate limit exceeded' });
        close();
        return;
      }

      if (msg.type === 'event') {
        if (
          typeof msg.eventType !== 'string' ||
          msg.eventType.length === 0 ||
          msg.eventType.length > MAX_EVENT_TYPE_LENGTH
        ) {
          return;
        }
        if (msg.data !== undefined) {
          const encoded = JSON.stringify(msg.data);
          if (Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
            safeSend(ws, { type: 'error', error: 'Event payload too large' });
            close();
            return;
          }
        }
        const ts = Date.now();
        if (state.gameType === 'snake' && msg.eventType === 'direction') {
          const msgData = msg.data as { dir?: unknown; t?: unknown } | undefined;
          const dir = msgData?.dir;
          if (
            dir !== 'UP' &&
            dir !== 'DOWN' &&
            dir !== 'LEFT' &&
            dir !== 'RIGHT'
          ) {
            return;
          }
          const clientT =
            typeof msgData?.t === 'number' &&
            Number.isFinite(msgData.t) &&
            msgData.t >= 0
              ? msgData.t
              : undefined;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'direction',
            ts,
            data: {
              dir,
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { direction: 1 },
          });
          return;
        }
        if (state.gameType === 'snake' && msg.eventType === 'food') {
          const msgData = msg.data as
            | { t?: unknown; x?: unknown; y?: unknown }
            | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_SNAKE_FOOD_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastSnakeFoodTs,
              clientT,
              lastClientT: state.lastSnakeFoodClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          state.lastSnakeFoodTs = ts;
          state.lastSnakeFoodClientT = clientT;
          const x =
            typeof msgData?.x === 'number' &&
            Number.isInteger(msgData.x) &&
            msgData.x >= 0 &&
            msgData.x < 18
              ? msgData.x
              : undefined;
          const y =
            typeof msgData?.y === 'number' &&
            Number.isInteger(msgData.y) &&
            msgData.y >= 0 &&
            msgData.y < 18
              ? msgData.y
              : undefined;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'food',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
              ...(x !== undefined ? { x } : {}),
              ...(y !== undefined ? { y } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { food: 1 },
          });
          return;
        }
        if (state.gameType === 'flappy-bird' && msg.eventType === 'flap') {
          const msgData = msg.data as { t?: unknown } | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_FLAPPY_FLAP_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastFlappyFlapTs,
              clientT,
              lastClientT: state.lastFlappyFlapClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          state.lastFlappyFlapTs = ts;
          state.lastFlappyFlapClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'flap',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { flap: 1 },
          });
          return;
        }
        if (state.gameType === 'flappy-bird' && msg.eventType === 'pipe') {
          const msgData = msg.data as { t?: unknown } | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_FLAPPY_PIPE_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastFlappyPipeTs,
              clientT,
              lastClientT: state.lastFlappyPipeClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          state.lastFlappyPipeTs = ts;
          state.lastFlappyPipeClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'pipe',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { pipe: 1 },
          });
          return;
        }
        if (state.gameType === 'stack' && msg.eventType === 'drop') {
          const msgData = msg.data as { t?: unknown } | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_STACK_DROP_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastStackDropTs,
              clientT,
              lastClientT: state.lastStackDropClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          state.lastStackDropTs = ts;
          state.lastStackDropClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'drop',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { drop: 1 },
          });
          return;
        }
        if (state.gameType === 'sequence' && msg.eventType === 'tap') {
          const msgData = msg.data as
            | { t?: unknown; round?: unknown; index?: unknown; pad?: unknown }
            | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_SEQUENCE_TAP_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastSequenceTapTs,
              clientT,
              lastClientT: state.lastSequenceTapClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          const pad =
            typeof msgData?.pad === 'number' &&
            Number.isInteger(msgData.pad) &&
            msgData.pad >= 0 &&
            msgData.pad < 4
              ? msgData.pad
              : undefined;
          const round =
            typeof msgData?.round === 'number' &&
            Number.isInteger(msgData.round) &&
            msgData.round >= 1
              ? msgData.round
              : undefined;
          const index =
            typeof msgData?.index === 'number' &&
            Number.isInteger(msgData.index) &&
            msgData.index >= 0
              ? msgData.index
              : undefined;
          if (pad === undefined || round === undefined || index === undefined) {
            return;
          }
          state.lastSequenceTapTs = ts;
          state.lastSequenceTapClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'tap',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
              round,
              index,
              pad,
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { tap: 1 },
          });
          return;
        }
        if (state.gameType === 'breakout' && msg.eventType === 'brick') {
          const msgData = msg.data as { t?: unknown; points?: unknown } | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_BREAKOUT_BRICK_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastBreakoutBrickTs,
              clientT,
              lastClientT: state.lastBreakoutBrickClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          const points =
            typeof msgData?.points === 'number' &&
            Number.isInteger(msgData.points) &&
            msgData.points > 0 &&
            msgData.points <= 1000
              ? msgData.points
              : undefined;
          if (points === undefined) {
            return;
          }
          state.lastBreakoutBrickTs = ts;
          state.lastBreakoutBrickClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'brick',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
              points,
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { brick: 1 },
          });
          return;
        }
        if (state.gameType === 'breakout' && msg.eventType === 'level') {
          const msgData = msg.data as { t?: unknown; level?: unknown } | undefined;
          const clientT = readClientEventTime(msgData);
          if (
            isEventIntervalSuspicious({
              minIntervalMs: MIN_BREAKOUT_LEVEL_INTERVAL_MS,
              nowTs: ts,
              lastServerTs: state.lastBreakoutLevelTs,
              clientT,
              lastClientT: state.lastBreakoutLevelClientT,
            })
          ) {
            state.abuseStrikes += 1;
            if (state.abuseStrikes >= MAX_ABUSE_STRIKES) {
              safeSend(ws, { type: 'error', error: 'Suspicious event stream' });
              close();
            }
            return;
          }
          const level =
            typeof msgData?.level === 'number' &&
            Number.isInteger(msgData.level) &&
            msgData.level >= 1 &&
            msgData.level <= 1000
              ? msgData.level
              : undefined;
          if (level === undefined) {
            return;
          }
          state.lastBreakoutLevelTs = ts;
          state.lastBreakoutLevelClientT = clientT;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'level',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
              level,
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { level: 1 },
          });
          return;
        }
        if (
          state.gameType === 'typing-test' &&
          msg.eventType === 'typing_prev_word'
        ) {
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'typing_prev_word',
            ts,
            data: { seq: msg.seq },
          });
          return;
        }
        if (
          state.gameType === 'tetris' &&
          msg.eventType === 'piece_lock'
        ) {
          const msgData = msg.data as { t?: unknown } | undefined;
          const clientT =
            typeof msgData?.t === 'number' &&
            Number.isFinite(msgData.t) &&
            msgData.t >= 0
              ? msgData.t
              : undefined;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'piece_lock',
            ts,
            data: {
              seq: msg.seq,
              ...(clientT !== undefined ? { clientT } : {}),
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            actionCounts: { piece_lock: 1 },
          });
          return;
        }
        return;
      }

      if (msg.type === 'typing_key' && state.gameType === 'typing-test') {
        if (typeof msg.key !== 'string' || msg.key.length !== 1) return;
        const ts = Date.now();
        recordGameEvent({
          sessionId: state.sessionId,
          odUserId: state.odUserId,
          gameType: state.gameType,
          eventType: 'key',
          ts,
          data: { key: msg.key, seq: msg.seq },
        });
        recordGameAction(state.sessionId, state.odUserId, {
          actionCounts: { key: 1 },
        });
        return;
      }

      if (state.gameType === 'reaction-time') {
        if (msg.type === 'rt_ready') {
          if (state.rtTimer) return;
          const delay = 1000 + Math.random() * 3000;
          state.rtTimer = setTimeout(() => {
            if (!state || state.closed) return;
            const greenTs = Date.now();
            const greenPerf = performance.now();
            const roundId = crypto.randomUUID();
            state.rtGreenAt = greenTs;
            state.rtGreenPerf = greenPerf;
            state.rtRound += 1;
            state.rtRoundId = roundId;
            recordGameEvent({
              sessionId: state.sessionId,
              odUserId: state.odUserId,
              gameType: state.gameType,
              eventType: 'rt_green',
              ts: greenTs,
              data: { round: state.rtRound, roundId },
            });
            safeSend(ws, {
              type: 'rt_green',
              round: state.rtRound,
              roundId,
              serverTs: greenTs,
            });
            state.rtTimer = null;
          }, delay);
          return;
        }
        if (msg.type === 'rt_click') {
          const clickTs = Date.now();
          const clickPerf = performance.now();
          const greenTs = state.rtGreenAt;
          const greenPerf = state.rtGreenPerf;
          const roundId = state.rtRoundId;
          const clientReactionMs =
            typeof msg.reactionMs === 'number' && Number.isFinite(msg.reactionMs)
              ? Math.max(0, Math.round(msg.reactionMs * 100) / 100)
              : null;
          if (
            !greenTs ||
            !greenPerf ||
            !roundId ||
            msg.roundId !== roundId
          ) {
            recordGameEvent({
              sessionId: state.sessionId,
              odUserId: state.odUserId,
              gameType: state.gameType,
              eventType: 'rt_click',
              ts: clickTs,
              data: {
                round: state.rtRound,
                roundId: msg.roundId ?? null,
                expectedRoundId: roundId ?? null,
                greenTs: null,
                clickTs,
                clientReactionMs,
              },
            });
            return;
          }
          const rawServerMs = Math.max(0, clickPerf - greenPerf);
          const stableRttMs =
            state.minRttMs > 0
              ? state.minRttMs
              : state.rttMs > 0
                ? state.rttMs
                : 0;
          const rttAdjust = Math.min(
            MAX_REACTION_RTT_ADJUST_MS,
            Math.max(0, stableRttMs / 2),
          );
          const reactionMsRaw = Math.max(0, rawServerMs - rttAdjust);
          const serverReactionMs = Math.round(reactionMsRaw * 100) / 100;
          const reactionMs = clientReactionMs ?? serverReactionMs;
          recordGameEvent({
            sessionId: state.sessionId,
            odUserId: state.odUserId,
            gameType: state.gameType,
            eventType: 'rt_click',
            ts: clickTs,
            data: {
              round: state.rtRound,
              roundId,
              greenTs,
              clickTs,
              reactionMs,
              clientReactionMs,
              serverReactionMs,
              rawServerMs,
              rttAdjustMs: rttAdjust,
              stableRttMs,
            },
          });
          recordGameAction(state.sessionId, state.odUserId, {
            reactionTime: reactionMs,
          });
          state.rtGreenAt = undefined;
          state.rtGreenPerf = undefined;
          state.rtRoundId = undefined;
          return;
        }
      }
    });

    ws.on('close', () => {
      if (state?.sessionId) {
        const guard = activeSessionGuards.get(state.sessionId);
        if (guard?.ws === ws) {
          activeSessionGuards.delete(state.sessionId);
        }
      }
      close();
    });
  });
};
