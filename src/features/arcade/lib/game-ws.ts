type WsMessage =
  | { type: 'hello'; token: string }
  | { type: 'event'; eventType: string; data?: unknown; seq: number }
  | { type: 'typing_key'; key: string; seq: number }
  | { type: 'rt_ready'; seq: number }
  | { type: 'rt_click'; roundId: string; reactionMs?: number; seq: number }
  | { type: 'pong'; id: string };

type WsResponse =
  | { type: 'hello_ack' }
  | { type: 'error'; error: string }
  | { type: 'ping'; id: string }
  | { type: 'rt_green'; round: number; roundId: string; serverTs: number };

export type GameWsHandle = {
  sendEvent: (eventType: string, data?: unknown) => void;
  sendTypingKey: (key: string) => void;
  requestReactionRound: () => void;
  sendReactionClick: (roundId: string, reactionMs?: number) => void;
  close: () => void;
  onMessage: (handler: (msg: WsResponse) => void) => void;
  onDisconnect: (handler: (reason: string) => void) => void;
  onReconnect: (handler: () => void) => void;
  isReady: () => boolean;
};

const getWsUrl = () => {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
};

export const connectGameWs = (token: string): Promise<GameWsHandle> => {
  return new Promise((resolve, reject) => {
    const url = getWsUrl();
    if (!url) {
      reject(new Error('WebSocket unavailable'));
      return;
    }

    let ready = false;
    let settled = false;
    let closedManually = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    const reconnectDelaysMs = [250, 500, 1000, 2000, 4000];
    const outboundQueue: WsMessage[] = [];
    const MAX_QUEUE = 512;
    let outboundSeq = 0;
    let messageHandler: ((msg: WsResponse) => void) | null = null;
    let disconnectHandler: ((reason: string) => void) | null = null;
    let reconnectHandler: (() => void) | null = null;
    const connectTimeout = window.setTimeout(() => {
      if (settled) return;
      closedManually = true;
      ready = false;
      ws?.close();
      settleReject('WebSocket connection timed out');
    }, 1500);
    const nextSeq = () => {
      outboundSeq += 1;
      return outboundSeq;
    };

    const queueMessage = (msg: WsMessage) => {
      if (outboundQueue.length >= MAX_QUEUE) {
        outboundQueue.shift();
      }
      outboundQueue.push(msg);
    };

    const sendImmediate = (msg: WsMessage) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    };

    const flushQueue = () => {
      if (!ready) return;
      while (outboundQueue.length > 0) {
        const msg = outboundQueue.shift();
        if (!msg) break;
        if (!sendImmediate(msg)) {
          queueMessage(msg);
          break;
        }
      }
    };

    const send = (msg: WsMessage) => {
      if (!ready) {
        queueMessage(msg);
        return;
      }
      if (!sendImmediate(msg)) {
        queueMessage(msg);
      }
    };

    const settleResolve = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(connectTimeout);
        resolve(handle);
      }
    };

    const settleReject = (reason: string) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(connectTimeout);
        reject(new Error(reason));
      }
    };

    const scheduleReconnect = () => {
      if (closedManually) return;
      if (reconnectAttempt >= reconnectDelaysMs.length) {
        disconnectHandler?.('Connection to game server was lost.');
        return;
      }
      const delay = reconnectDelaysMs[reconnectAttempt];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        createSocket(true);
      }, delay);
    };

    const createSocket = (isReconnect = false) => {
      ws = new WebSocket(url);
      ready = false;

      ws.addEventListener('open', () => {
        if (!sendImmediate({ type: 'hello', token })) {
          settleReject('WebSocket connection failed');
        }
      });

      ws.addEventListener('message', (event) => {
        let msg: WsResponse;
        try {
          msg = JSON.parse(event.data as string) as WsResponse;
        } catch {
          return;
        }
        if (msg.type === 'hello_ack') {
          const wasReconnect = settled && isReconnect;
          ready = true;
          reconnectAttempt = 0;
          flushQueue();
          if (wasReconnect) {
            reconnectHandler?.();
          } else {
            settleResolve();
          }
          return;
        }
        if (msg.type === 'ping') {
          sendImmediate({ type: 'pong', id: msg.id });
          return;
        }
        if (msg.type === 'error') {
          if (!settled) {
            settleReject(msg.error);
            return;
          }
          disconnectHandler?.(msg.error);
          return;
        }
        messageHandler?.(msg);
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          settleReject('WebSocket connection failed');
          return;
        }
        // Allow close handler to schedule reconnect after runtime errors.
      });

      ws.addEventListener('close', () => {
        ready = false;
        if (closedManually) return;
        if (!settled) {
          settleReject('WebSocket closed');
          return;
        }
        scheduleReconnect();
      });
    };

    const handle: GameWsHandle = {
      sendEvent: (eventType, data) => {
        send({ type: 'event', eventType, data, seq: nextSeq() });
      },
      sendTypingKey: (key) => {
        send({ type: 'typing_key', key, seq: nextSeq() });
      },
      requestReactionRound: () => {
        send({ type: 'rt_ready', seq: nextSeq() });
      },
      sendReactionClick: (roundId, reactionMs) => {
        send({
          type: 'rt_click',
          roundId,
          reactionMs,
          seq: nextSeq(),
        });
      },
      close: () => {
        closedManually = true;
        ready = false;
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        ws?.close();
      },
      onMessage: (handler) => {
        messageHandler = handler;
      },
      onDisconnect: (handler) => {
        disconnectHandler = handler;
      },
      onReconnect: (handler) => {
        reconnectHandler = handler;
      },
      isReady: () => ready,
    };

    createSocket();
  });
};
