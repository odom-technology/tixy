'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createGameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { subscribeLive, type LiveEventPayload } from '@/lib/liveEvents';
import type { ArcadeRunAchievement } from '@/features/arcade/lib/run-result';
import {
  DERBY_HORSES,
  type DerbyChatMessage,
  type DerbyEvent,
  type DerbyHorse,
  type DerbyMyBet,
  type DerbyPhase,
  type DerbyPublicRound,
  type DerbyRecentRound,
  type DerbySnapshot,
  type RaceScript,
} from '@/server/arcade/derby/derby-shared';

/**
 * Derby Royale data layer.
 *
 * - Loads the full snapshot from `GET /api/derby/state` on mount.
 * - Subscribes to the shared `derby` realtime topic (and the caller's private
 *   `user:{id}` topic, when known) and folds every {@link DerbyEvent} into local
 *   state.
 * - Derives `countdownMs` from the current phase's
 *   absolute deadline and a server/client clock offset (median of samples), so
 *   the countdown stays honest without trusting the local wall clock.
 * - Resyncs by refetching the snapshot whenever the realtime stream goes quiet
 *   (a dropped/reconnected SSE connection shows up as a heartbeat gap).
 */

export type DerbyConnection = 'connecting' | 'live' | 'reconnecting';

export type DerbyHorseView = DerbyHorse & {
  /** payout multiplier this round */
  m: number;
  /** display win probability this round */
  p: number;
  /** odds ladder slot this round (0 = favorite) */
  slot: number;
  /** credits wagered on this horse this round */
  betTotal: number;
  /** number of bets placed on this horse this round */
  betCount: number;
};

export type DerbyPayoutNotice = {
  payout: number;
  stake: number;
  achievements: ArcadeRunAchievement[];
  roundNumber: number;
  at: number;
};

/** A live wager rolling into the lobby feed (from shared `bet` events). */
export type DerbyFeedItem = {
  id: number;
  name: string;
  horseIdx: number;
  amount: number;
  at: number;
};

/** The settled outcome of the round on screen (from the `results` event). */
export type DerbyResultsNotice = {
  roundId: string;
  winnerIdx: number;
  finishOrder: number[];
  seed: string;
  topWins: { name: string; amount: number; payout: number }[];
  at: number;
};

export type UseDerbyResult = {
  status: DerbyConnection;
  /** true once the first snapshot has loaded */
  ready: boolean;
  round: DerbyPublicRound | null;
  phase: DerbyPhase | null;
  /** roster merged with this round's odds and live bet totals */
  horses: DerbyHorseView[];
  /** ms remaining in the current phase (>= 0) */
  countdownMs: number;
  /** absolute deadline (epoch ms) for the current phase, or null */
  phaseEndsAt: number | null;
  script: RaceScript | null;
  /** when racing starts (epoch ms, server clock) */
  raceStartsAt: number | null;
  /** local timestamp the race script arrived, for a raw "script received" indicator */
  scriptReceivedAt: number | null;
  myBets: DerbyMyBet[];
  chat: DerbyChatMessage[];
  recentRounds: DerbyRecentRound[];
  /** rolling feed of everyone's bets this round (newest first, capped) */
  feed: DerbyFeedItem[];
  /** settled outcome of the round on screen, if announced */
  lastResults: DerbyResultsNotice | null;
  /** latest payout notice for this viewer, if any */
  lastPayout: DerbyPayoutNotice | null;
  /** serverNow - Date.now(), median of recent samples */
  serverOffsetMs: number;
  /** last user-facing error from a bet/chat action */
  error: string | null;
  placeBet: (horseIdx: number, amount: number) => Promise<{ ok: boolean; error?: string }>;
  sendChat: (body: string) => Promise<{ ok: boolean; error?: string }>;
};

const CHAT_KEEP = 60;
/** No derby event (phase heartbeat is 10 s) for this long ⇒ assume the stream dropped. */
const STALE_MS = 25_000;
const RESYNC_COOLDOWN_MS = 8_000;

function phaseDeadline(round: DerbyPublicRound | null): number | null {
  if (!round) return null;
  switch (round.phase) {
    case 'betting':
      return round.bettingEndsAt;
    case 'locked':
      return round.raceStartsAt;
    case 'racing':
      return round.raceEndsAt;
    case 'results':
      return round.resultsEndAt;
    default:
      return null;
  }
}

export function useDerby(userId?: string | null): UseDerbyResult {
  const [round, setRound] = useState<DerbyPublicRound | null>(null);
  const [script, setScript] = useState<RaceScript | null>(null);
  const [scriptReceivedAt, setScriptReceivedAt] = useState<number | null>(null);
  const [myBets, setMyBets] = useState<DerbyMyBet[]>([]);
  const [chat, setChat] = useState<DerbyChatMessage[]>([]);
  const [recentRounds, setRecentRounds] = useState<DerbyRecentRound[]>([]);
  const [status, setStatus] = useState<DerbyConnection>('connecting');
  const [feed, setFeed] = useState<DerbyFeedItem[]>([]);
  const [lastResults, setLastResults] = useState<DerbyResultsNotice | null>(null);
  const [lastPayout, setLastPayout] = useState<DerbyPayoutNotice | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Refs so the (stable) realtime handler can read current values without
  // re-subscribing on every state change.
  const roundRef = useRef<DerbyPublicRound | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const myBetsRef = useRef<DerbyMyBet[]>([]);
  const scriptRef = useRef<RaceScript | null>(null);
  const offsetSamplesRef = useRef<number[]>([]);
  const lastEventAtRef = useRef<number>(Date.now());
  const lastFetchAtRef = useRef<number>(0);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    myBetsRef.current = myBets;
  }, [myBets]);

  useEffect(() => {
    scriptRef.current = script;
  }, [script]);

  const recordServerNow = useCallback((serverNow: unknown) => {
    if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
    const samples = offsetSamplesRef.current;
    samples.push(serverNow - Date.now());
    if (samples.length > 3) samples.shift();
    const sorted = [...samples].sort((a, b) => a - b);
    setServerOffsetMs(sorted[Math.floor(sorted.length / 2)]);
  }, []);

  const applySnapshot = useCallback(
    (snap: DerbySnapshot) => {
      recordServerNow(snap.serverNow);
      setRound(snap.round);
      roundIdRef.current = snap.round?.id ?? null;
      setScript(snap.script ?? null);
      setScriptReceivedAt(snap.script ? Date.now() : null);
      setMyBets(snap.myBets ?? []);
      setChat(snap.chat ?? []);
      setRecentRounds(snap.recentRounds ?? []);
      lastEventAtRef.current = Date.now();
      setStatus('live');
      setReady(true);
    },
    [recordServerNow],
  );

  const refetchState = useCallback(async () => {
    lastFetchAtRef.current = Date.now();
    try {
      const res = await fetch('/api/derby/state', { cache: 'no-store' });
      if (!res.ok) return;
      const snap = (await res.json()) as DerbySnapshot;
      applySnapshot(snap);
    } catch {
      // Leave status as-is; the staleness loop retries.
    }
  }, [applySnapshot]);

  // Initial load.
  useEffect(() => {
    void refetchState();
  }, [refetchState]);

  // Realtime subscription. Re-subscribes only when the private topic changes.
  useEffect(() => {
    const topics = ['derby'];
    if (userId) topics.push(`user:${userId}`);

    const handle = (payload: LiveEventPayload) => {
      lastEventAtRef.current = Date.now();

      const topic = payload.topic;
      if (typeof topic === 'string' && topic.startsWith('user:')) {
        if (payload.type === 'derby_payout') {
          setLastPayout({
            payout: Number(payload.payout) || 0,
            stake: Number(payload.stake) || 0,
            achievements: Array.isArray(payload.achievements)
              ? (payload.achievements as ArcadeRunAchievement[])
              : [],
            roundNumber: Number(payload.roundNumber) || 0,
            at: Date.now(),
          });
        }
        return;
      }

      setStatus('live');
      const evt = payload as unknown as DerbyEvent;
      switch (evt.type) {
        case 'phase': {
          recordServerNow(evt.serverNow);
          const r = evt.round;
          setRound(r);
          // Entered racing but never got the script event (e.g. joined during
          // 'locked' on a flaky stream) → pull it from the snapshot.
          if (
            r.phase === 'racing' &&
            !scriptRef.current &&
            Date.now() - lastFetchAtRef.current > 2_000
          ) {
            void refetchState();
          }
          if (r.id !== roundIdRef.current) {
            // New round: clear per-round state.
            roundIdRef.current = r.id;
            setScript(null);
            setScriptReceivedAt(null);
            setMyBets([]);
            setFeed([]);
          } else if (r.phase === 'betting') {
            setScript(null);
            setScriptReceivedAt(null);
          }
          break;
        }
        case 'script': {
          recordServerNow(evt.serverNow);
          if (roundRef.current && roundRef.current.id !== evt.roundId) break;
          setScript(evt.script);
          setScriptReceivedAt(Date.now());
          break;
        }
        case 'bet': {
          setFeed((prev) =>
            [
              {
                id: (prev[0]?.id ?? 0) + 1,
                name: evt.name,
                horseIdx: evt.horseIdx,
                amount: evt.amount,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 14),
          );
          setRound((prev) =>
            prev && prev.id === evt.roundId
              ? {
                  ...prev,
                  betTotals: evt.betTotals,
                  betCounts: evt.betCounts,
                  totalWagered: evt.betTotals.reduce((a, b) => a + b, 0),
                }
              : prev,
          );
          break;
        }
        case 'chat': {
          const msg = evt.msg;
          setChat((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-CHAT_KEEP),
          );
          break;
        }
        case 'results': {
          recordServerNow(evt.serverNow);
          setLastResults({
            roundId: evt.roundId,
            winnerIdx: evt.winnerIdx,
            finishOrder: evt.finishOrder,
            seed: evt.seed,
            topWins: evt.topWins ?? [],
            at: Date.now(),
          });
          // Reflect the settled winner locally; pull real settled payouts from
          // a fresh snapshot.
          void refetchState();
          // Fallback payout notice when we have no private user topic to listen
          // on: approximate from our own bets against the announced winner.
          if (!userId) {
            const winners = myBetsRef.current.filter((b) => b.horseIdx === evt.winnerIdx);
            if (winners.length > 0) {
              const payout = winners.reduce(
                (sum, b) => sum + Math.round(b.amount * b.multiplier),
                0,
              );
              setLastPayout({
                payout,
                stake: myBetsRef.current.reduce((sum, bet) => sum + bet.amount, 0),
                achievements: [],
                roundNumber: roundRef.current?.roundNumber ?? 0,
                at: Date.now(),
              });
            }
          }
          break;
        }
        case 'sync': {
          recordServerNow(evt.serverNow);
          if (roundRef.current?.id !== evt.roundId) {
            // Missed a transition (or reconnected into a new round): resync.
            void refetchState();
            break;
          }
          // Racing without a script means we missed the one script event —
          // the heartbeat keeps the stream "fresh", so refetch explicitly.
          if (
            evt.phase === 'racing' &&
            !scriptRef.current &&
            Date.now() - lastFetchAtRef.current > RESYNC_COOLDOWN_MS
          ) {
            void refetchState();
          }
          setRound((prev) =>
            prev && prev.id === evt.roundId
              ? {
                  ...prev,
                  phase: evt.phase,
                  bettingEndsAt: evt.bettingEndsAt,
                  raceStartsAt: evt.raceStartsAt,
                  raceEndsAt: evt.raceEndsAt,
                  resultsEndAt: evt.resultsEndAt,
                  betTotals: evt.betTotals,
                  totalWagered: evt.betTotals.reduce((a, b) => a + b, 0),
                }
              : prev,
          );
          break;
        }
        default:
          break;
      }
    };

    const unsubscribe = subscribeLive(topics, handle);
    return unsubscribe;
  }, [userId, recordServerNow, refetchState]);

  // The UI only displays whole seconds, so avoid rerendering the entire Derby
  // client at display refresh rate. The deadline remains absolute/server-adjusted.
  useEffect(() => {
    let lastUpdateAt = 0;
    const frameLoop = createGameFrameLoop({
      simulate: () => true,
      render: (_alpha, info) => {
        if (info.nowMs - lastUpdateAt < 100) return;
        lastUpdateAt = info.nowMs;
        setNow(Date.now());
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, []);

  // Staleness watchdog → resync on a dropped/reconnected stream.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastEventAtRef.current <= STALE_MS) return;
      setStatus((s) => (s === 'live' ? 'reconnecting' : s));
      if (Date.now() - lastFetchAtRef.current > RESYNC_COOLDOWN_MS) {
        void refetchState();
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [refetchState]);

  const placeBet = useCallback(async (horseIdx: number, amount: number) => {
    const current = roundRef.current;
    if (!current) return { ok: false, error: 'Round not ready.' };
    try {
      const res = await fetch('/api/derby/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: current.id, horseIdx, amount }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Bet failed.';
        setError(message);
        return { ok: false, error: message };
      }
      setError(null);
      const m = roundRef.current?.odds.m[horseIdx] ?? 0;
      setMyBets((prev) => {
        const exists = prev.some((b) => b.horseIdx === horseIdx);
        const bet: DerbyMyBet = { horseIdx, amount, multiplier: m, payout: null };
        return exists
          ? prev.map((b) => (b.horseIdx === horseIdx ? bet : b))
          : [...prev, bet];
      });
      return { ok: true };
    } catch {
      const message = 'Network error.';
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const sendChat = useCallback(async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'Message is empty.' };
    try {
      const res = await fetch('/api/derby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        msg?: DerbyChatMessage;
      };
      if (!res.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Could not send.';
        return { ok: false, error: message };
      }
      if (data.msg && typeof data.msg.id === 'number') {
        const msg = data.msg;
        setChat((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-CHAT_KEEP),
        );
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error.' };
    }
  }, []);

  const horses = useMemo<DerbyHorseView[]>(() => {
    return DERBY_HORSES.map((horse) => ({
      ...horse,
      m: round?.odds.m[horse.idx] ?? 0,
      p: round?.odds.p[horse.idx] ?? 0,
      slot: round?.odds.slot[horse.idx] ?? horse.idx,
      betTotal: round?.betTotals[horse.idx] ?? 0,
      betCount: round?.betCounts[horse.idx] ?? 0,
    }));
  }, [round]);

  const phaseEndsAt = phaseDeadline(round);
  const countdownMs =
    phaseEndsAt == null ? 0 : Math.max(0, phaseEndsAt - (now + serverOffsetMs));

  return {
    status,
    ready,
    round,
    phase: round?.phase ?? null,
    horses,
    countdownMs,
    phaseEndsAt,
    script,
    raceStartsAt: round?.raceStartsAt ?? null,
    scriptReceivedAt,
    myBets,
    chat,
    recentRounds,
    feed,
    lastResults,
    lastPayout,
    serverOffsetMs,
    error,
    placeBet,
    sendChat,
  };
}
