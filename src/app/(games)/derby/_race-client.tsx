'use client';

/* Derby: the water race. Up to eight lanes squirt at their targets at
   once, and the water on target runs your horse. This is the race's owner
   on the phone: which race is on the stage (a practice race on this
   device, or a server race), the lobby under the cabinet, the network
   (your aim out in batches, everyone's news in), rejoining and the result. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { GameStageNotice, GameStat } from '@/features/arcade/components/shell/game-shell';
import { SignInDialog } from '@/features/arcade/components/shell/sign-in-prompt';
import { useAccountSummary } from '@/features/arcade/components/shell/use-account-summary';
import { useOptionalGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import {
  DERBY_BATCH_MS,
  DERBY_HEARTBEAT_MS,
  DERBY_LANES,
  DERBY_MAX_BATCH_TICKS,
  derbyTickets,
  type DerbyLaneSpec,
  type DerbyResult,
} from '@/features/arcade/lib/derby';

import type { DerbyRaceGame } from './_race-game';
import { ordinalOf } from './_race-game';
import { DerbyLobby } from './_race-lobby';
import { DerbyHttpError, DerbyNet, type DerbyBatchView, type DerbyInvite, type DerbySnapshotView } from './_race-net';
import { DerbyStage, localPracticeRace, type RaceEnd, type RaceView } from './_race-stage';
import { HOUSE_LOOK, derbyLookFromInventory, type DerbyInventoryResponse, type DerbyLook } from './_race-theme';

type Online = {
  raceId: string;
  snap: DerbySnapshotView;
  invite: DerbyInvite | null;
};

const POLL_MS = 3_000;
const RACE_GONE = 'That race is over.';
const RACE_CLOSED = 'The host closed the race.';

export default function DerbyRaceClient() {
  const { account, loaded: accountLoaded } = useAccountSummary();
  const wallet = useOptionalGamesWallet();
  const signedIn = Boolean(account);
  const searchParams = useSearchParams();
  const net = useMemo(() => new DerbyNet(), []);
  const [local, setLocal] = useState<RaceView | null>(null);
  const [online, setOnline] = useState<Online | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [signInFor, setSignInFor] = useState<string | null>(null);
  const [wins, setWins] = useState<number | null>(null);
  const [look, setLook] = useState<DerbyLook>(HOUSE_LOOK);
  const gameRef = useRef<DerbyRaceGame | null>(null);
  /** Your ticks the server has answered for: the next batch starts here. */
  const acked = useRef(0);
  /** An aim batch is on its way. */
  const inflight = useRef(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const myName = account?.username || 'you';

  // ── Taking a server race onto the stage ──

  const adopt = useCallback((snap: DerbySnapshotView, invite: DerbyInvite | null = null) => {
    setLocal(null);
    setError(null);
    setOnline((prev) =>
      prev && prev.raceId === snap.id
        ? { ...prev, snap, invite: invite ?? prev.invite }
        : { raceId: snap.id, snap, invite },
    );
  }, []);

  const refresh = useCallback(async () => {
    const current = onlineRef.current;
    if (!current) return;
    try {
      // Only the news this phone hasn't got yet.
      const game = gameRef.current;
      const race = game?.race ?? null;
      const humans = current.snap.lanes.filter((l) => l.kind === 'human').map((l) => race?.known[l.lane] ?? 0);
      const since = race && humans.length ? Math.min(...humans) : 0;
      const snap = await net.snapshot(current.raceId, since);
      adopt(snap);
      if (game && snap.status !== 'lobby') mergeNews(game, snap);
    } catch (err) {
      if (err instanceof DerbyHttpError && err.status === 404) {
        setOnline(null);
        setError(RACE_GONE);
      }
    }
  }, [adopt, net]);

  // Rejoin on load: the race you are in, a race id or an invite code.
  useEffect(() => {
    if (!accountLoaded || !signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const code = searchParams.get('code');
        const raceParam = searchParams.get('race');
        if (code) {
          const joined = await net.joinCode(code);
          if (!cancelled) adopt(joined.snapshot);
          return;
        }
        const raceId = raceParam ?? (await net.active()).raceId;
        if (!raceId) return;
        const joined = await net.join(raceId);
        if (!cancelled && joined.snapshot.myLane !== null) adopt(joined.snapshot);
      } catch (err) {
        if (!cancelled && err instanceof Error) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountLoaded, signedIn, searchParams, net, adopt]);

  // The equipped skin set, and again when the inventory changes.
  useEffect(() => {
    if (!signedIn) return;
    const load = () =>
      void fetch('/api/store/inventory?gameType=derby', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<DerbyInventoryResponse>) : null))
        .then((body) => setLook(derbyLookFromInventory(body)))
        .catch(() => undefined);
    load();
    window.addEventListener('store-inventory-updated', load);
    return () => window.removeEventListener('store-inventory-updated', load);
  }, [signedIn]);

  // Wins for the strip.
  useEffect(() => {
    if (!signedIn) return;
    void fetch('/api/games/derby/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { wins?: number } | null) => setWins(body?.wins ?? 0))
      .catch(() => undefined);
  }, [signedIn, online?.snap.status]);

  // Pushes, the poll and heartbeats while a server race is open.
  const raceId = online?.raceId ?? null;
  const status = online?.snap.status ?? null;
  useEffect(() => {
    if (!raceId || status === 'finished' || status === 'cancelled') return;
    const off = net.listen(raceId, (event) => {
      const type = event.type;
      if (type === 'aims') {
        const game = gameRef.current;
        if (!game) return;
        if (typeof event.sealed === 'number') game.seal(event.sealed);
        const batch = event.batch as DerbyBatchView;
        if (game.confirm(batch.lane, batch.prev, batch.from, batch.samples) === 'gap') void refresh();
      } else if (type === 'finished') {
        gameRef.current?.serverFinished(event.result as DerbyResult);
        void refresh();
      } else if (type === 'cancelled') {
        setOnline(null);
        setError(RACE_CLOSED);
      } else {
        void refresh();
      }
    });
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const beat = () => void net.heartbeat(raceId).catch(() => undefined);
    beat();
    const heart = window.setInterval(beat, DERBY_HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        beat();
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      window.clearInterval(poll);
      window.clearInterval(heart);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [raceId, status, net, refresh]);

  // A public lobby starts on the server's timer; ask when it is due.
  const fillAt = online?.snap.status === 'lobby' ? online.snap.fillAt : null;
  useEffect(() => {
    if (!fillAt) return;
    const wait = Math.max(0, fillAt - net.clock.serverAt(performance.now())) + 150;
    const timer = window.setTimeout(() => void refresh(), wait);
    return () => window.clearTimeout(timer);
  }, [fillAt, net, refresh]);

  // ── The race on the stage ──

  const inLobby = online?.snap.status === 'lobby';
  const stageRace = useMemo<RaceView | null>(() => {
    if (local) return local;
    if (!online || online.snap.startAt === null || online.snap.status === 'lobby' || online.snap.status === 'cancelled') {
      return null;
    }
    const snap = online.snap;
    const startAt = snap.startAt!;
    const lanes: DerbyLaneSpec[] = snap.lanes.map((l) =>
      l.kind === 'human' ? { lane: l.lane, kind: 'human' } : { lane: l.lane, kind: 'bot', botSkill: l.botSkill ?? 0 },
    );
    const names = Array.from({ length: DERBY_LANES }, (_, lane) => {
      const row = snap.lanes.find((l) => l.lane === lane);
      return row ? (row.lane === snap.myLane ? 'you' : row.name) : `lane ${lane + 1}`;
    });
    return {
      id: snap.id,
      names,
      setup: {
        seed: snap.seed,
        lanes,
        myLane: snap.myLane ?? -1,
        clock: (perf) => net.clock.serverAt(perf) - startAt,
        local: false,
      },
    };
    // The race on the stage changes only when the race id or its start does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, online?.raceId, online?.snap.startAt, inLobby, net]);

  const source = useMemo(
    () => ({
      onMounted: (game: DerbyRaceGame) => {
        gameRef.current = game;
        acked.current = 0;
        inflight.current = false;
        const current = onlineRef.current;
        if (!current || local) return;
        mergeNews(game, current.snap);
        const mine = current.snap.lanes.find((l) => l.lane === current.snap.myLane);
        acked.current = mine?.next ?? 0;
      },
    }),
    [local],
  );

  // Your aim, out to the server in batches: one at a time, each from the
  // last tick the server answered for, so a lost batch is sent again.
  const sending = online && !local && online.snap.status === 'running' && online.snap.myLane !== null ? online.raceId : null;
  useEffect(() => {
    if (!sending) return;
    const send = () => {
      const game = gameRef.current;
      if (!game || inflight.current || game.myLane < 0 || game.finished) return;
      const from = acked.current;
      const to = Math.min(game.sampledTicks, from + DERBY_MAX_BATCH_TICKS);
      if (to <= from) return;
      inflight.current = true;
      const lane = game.myLane;
      void net
        .aims(sending, from, game.mySamples(from, to))
        .then((answer) => {
          if (answer.kept) {
            const { prev, from: keptFrom, n } = answer.kept;
            if (game.confirm(lane, prev, keptFrom, game.mySamples(keptFrom, keptFrom + n)) === 'gap') void refresh();
          }
          game.seal(answer.sealed);
          acked.current = Math.max(acked.current, answer.next);
        })
        .catch((err: unknown) => {
          if (err instanceof DerbyHttpError && typeof err.body.next === 'number') acked.current = Math.max(acked.current, err.body.next);
        })
        .finally(() => {
          inflight.current = false;
        });
    };
    const timer = window.setInterval(send, DERBY_BATCH_MS);
    return () => window.clearInterval(timer);
  }, [sending, net, refresh]);

  // ── Actions ──

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setPending(label);
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The track could not be reached.');
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const practice = useCallback(() => {
    if (!signedIn) {
      setOnline(null);
      setLocal(localPracticeRace(myName));
      return;
    }
    void run('practice', async () => {
      const created = await net.create('practice');
      adopt(created.snapshot);
    });
  }, [signedIn, myName, run, net, adopt]);

  const playNow = useCallback(() => {
    if (!signedIn) return setSignInFor('Sign in to race other players. Your wins and tickets are saved to your account.');
    void run('play', async () => {
      const created = await net.create('public');
      adopt(created.snapshot);
    });
  }, [signedIn, run, net, adopt]);

  const invite = useCallback(() => {
    if (!signedIn) return setSignInFor('Sign in to race your friends. Your wins and tickets are saved to your account.');
    void run('invite', async () => {
      const created = await net.create('invite');
      adopt(created.snapshot, created.invite);
    });
  }, [signedIn, run, net, adopt]);

  const start = useCallback(() => {
    const current = onlineRef.current;
    if (!current) return;
    void run('start', async () => {
      await net.start(current.raceId);
      await refresh();
    });
  }, [run, net, refresh]);

  const leave = useCallback(() => {
    const current = onlineRef.current;
    setLocal(null);
    if (!current) return;
    void run('leave', async () => {
      if (current.snap.status === 'lobby' || current.snap.status === 'running') await net.leave(current.raceId);
      setOnline(null);
    });
  }, [run, net]);

  const rematch = useCallback(() => {
    const current = onlineRef.current;
    if (local || !current) return practice();
    if (current.snap.kind === 'practice') return practice();
    if (current.snap.kind === 'public') return playNow();
    void run('rematch', async () => {
      const next = await net.rematch(current.raceId);
      adopt(next.snapshot, next.invite);
    });
  }, [local, practice, playNow, run, net, adopt]);

  // After the wire: wait for the server's settle (reward, places).
  const renderEnd = useCallback(
    (end: RaceEnd, again: () => void) => {
      const current = onlineRef.current;
      if (local || !current) return localEnd(end, again, leave);
      const snap = current.snap;
      const settled = snap.status === 'finished';
      const mine = snap.lanes.find((l) => l.lane === snap.myLane);
      const place = settled && mine?.place ? mine.place : end.result.order.indexOf(end.myLane) + 1;
      const winnerLane = settled && snap.result ? snap.result.winner : end.result.winner;
      const winner = winnerLane === snap.myLane ? 'you' : (snap.lanes.find((l) => l.lane === winnerLane)?.name ?? `lane ${winnerLane + 1}`);
      const forfeit = mine?.forfeit ?? null;
      const won = place === 1 && !forfeit;
      return (
        <ArcadeRunResult
          title={forfeit ? 'No tickets' : won ? 'You won' : `${ordinalOf(place)} place`}
          tone={won ? 'win' : 'neutral'}
          stats={[
            { label: 'place', value: `${place}/${DERBY_LANES}`, highlight: won },
            { label: 'winner', value: winner },
            { label: 'race', value: `${((settled && snap.result ? snap.result.endT : end.result.endT) / 1000).toFixed(1)}s` },
          ]}
          reward={snap.reward?.reward ?? null}
          achievements={(snap.reward?.achievements ?? []) as never}
          saving={!settled || (!forfeit && (mine?.tickets ?? 0) > 0 && !snap.reward)}
          error={
            forfeit === 'timeout'
              ? 'You were away for over 30 seconds.'
              : forfeit === 'idle'
                ? 'Your water never hit the target.'
                : forfeit === 'left'
                  ? 'You left the race.'
                  : null
          }
          actions={<ArcadeRematchButton onClick={again} />}
          back={{ label: 'lobby', onClick: leave }}
        />
      );
    },
    [local, leave],
  );

  // Keep asking until the server has settled and paid this race.
  const finishedLocally = useRef<string | null>(null);
  useEffect(() => {
    if (!online || online.snap.status !== 'running') return;
    const timer = window.setInterval(() => {
      if (finishedLocally.current === online.raceId) void refresh();
    }, 900);
    return () => window.clearInterval(timer);
  }, [online, refresh]);
  useEffect(() => {
    if (online?.snap.status === 'finished' && online.snap.myLane !== null && !online.snap.reward) {
      const mine = online.snap.lanes.find((l) => l.lane === online.snap.myLane);
      if (mine && !mine.forfeit && (mine.tickets ?? 0) > 0) {
        const timer = window.setTimeout(() => void refresh(), 800);
        return () => window.clearTimeout(timer);
      }
    }
    if (online?.snap.reward) void wallet?.refresh?.();
    return undefined;
  }, [online, refresh, wallet]);

  const lobby = online && online.snap.status === 'lobby' ? online : null;
  // Busy is only the wait for the server to open a race: it also keeps a
  // tap on the stage from starting a practice race meanwhile.
  const busy = pending === 'practice' || pending === 'play' || pending === 'invite' ? 'Opening the race.' : null;

  // While a lobby fills, the line under the stage is the gate's: when it
  // opens, or who starts it. The lanes and buttons are under the cabinet.
  const [, tick] = useState(0);
  const lobbyFillAt = lobby?.snap.fillAt ?? null;
  useEffect(() => {
    if (!lobbyFillAt) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [lobbyFillAt]);
  let lobbyLine: string | null = null;
  if (lobby) {
    const snap = lobby.snap;
    if (snap.kind === 'public') {
      const seconds = snap.fillAt ? Math.max(0, Math.ceil((snap.fillAt - net.clock.serverAt(performance.now())) / 1000)) : null;
      lobbyLine = seconds !== null && seconds > 0 ? `The gate opens in ${seconds}.` : 'The gate is opening.';
    } else if (snap.hostUserId === account?.id) {
      lobbyLine = 'Start when your friends are in.';
    } else {
      const host = snap.lanes.find((l) => l.userId === snap.hostUserId)?.name;
      lobbyLine = host ? `${host} starts the race.` : 'The host starts the race.';
    }
  }

  const notice =
    error && !stageRace && !lobby ? (
      <GameStageNotice
        title={error === RACE_GONE || error === RACE_CLOSED ? 'Race closed' : 'Connection lost'}
        action={<ArcadeButton tone='primary' onClick={() => setError(null)}>back</ArcadeButton>}
      >
        <p>{error}</p>
      </GameStageNotice>
    ) : null;

  return (
    <>
      <DerbyStage
        race={stageRace}
        onStart={stageRace || lobby ? null : practice}
        source={source}
        renderEnd={renderEnd}
        onRematch={rematch}
        busy={busy}
        hint={lobby ? lobbyLine : undefined}
        notice={notice}
        stat={<GameStat value={signedIn ? wins : null} label='wins' />}
        look={look}
        onFinished={(id) => {
          finishedLocally.current = id;
          void refresh();
        }}
        below={
          <DerbyLobby
            signedIn={signedIn}
            accountId={account?.id ?? null}
            online={online}
            racing={Boolean(stageRace)}
            pending={pending}
            error={stageRace || lobby ? error : null}
            onPlayNow={playNow}
            onPractice={practice}
            onInvite={invite}
            onStart={start}
            onLeave={leave}
          />
        }
      />
      <SignInDialog open={signInFor !== null} onClose={() => setSignInFor(null)} reason={signInFor ?? ''} />
    </>
  );
}

/** Fold a snapshot's news into the race on the stage, lane by lane in order. */
function mergeNews(game: DerbyRaceGame, snap: DerbySnapshotView) {
  const batches = [...snap.batches].sort((a, b) => a.lane - b.lane || a.prev - b.prev);
  for (const batch of batches) game.confirm(batch.lane, batch.prev, batch.from, batch.samples);
  game.seal(snap.sealed);
  if (snap.result) game.serverFinished(snap.result);
}

function localEnd(end: RaceEnd, again: () => void, lobby: () => void) {
  const place = end.result.order.indexOf(end.myLane) + 1;
  const won = place === 1;
  return (
    <ArcadeRunResult
      title={won ? 'You won' : `${ordinalOf(place)} place`}
      tone={won ? 'win' : 'neutral'}
      stats={[
        { label: 'place', value: `${place}/${DERBY_LANES}`, highlight: won },
        { label: 'winner', value: end.names[end.result.winner] ?? `lane ${end.result.winner + 1}` },
        { label: 'would pay', value: derbyTickets(place) },
      ]}
      guest
      actions={<ArcadeRematchButton onClick={again} />}
      back={{ label: 'lobby', onClick: lobby }}
    />
  );
}
