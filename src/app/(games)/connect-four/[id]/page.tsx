'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Flag,
  Eye,
} from 'lucide-react';
import {
  GameShell,
  GameStage,
  GameStat,
  type GameHowTo,
} from '@/features/arcade/components/shell/game-shell';
import { ArcadeButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { type ConnectFourMatch, type Color } from '@/features/arcade/lib/connect-four/types';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { ConnectFourBoard } from '../_board';
import {
  DEFAULT_CONNECT_FOUR_THEME,
  buildConnectFourTheme,
  connectFourDiscGradient,
  type ConnectFourCosmeticTheme,
} from '../_connect-four-theme';
import { PostgameResult } from '../_postgame-overlay';
import { endedAt, fetchMatch, findOffer, type RematchOffer } from '../_rematch';
import { ConnectFourPlayerCard } from '../_player-card';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { playMoveSound } from '../_sounds';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  gameFromMatch,
  parseSeriesParam,
  scoreSeries,
  seriesHref,
  parseFromParam,
  useSeriesGames,
  type SeriesGame,
} from '../_series';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

// The ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HOW_TO: GameHowTo = {
  lines: [
    'Slide along the columns and let go to drop your chip.',
    'Four in a row wins, across, down or on a diagonal.',
    'A rematch plays on as a best of three.',
  ],
};

type MoveRow = {
  ply: number;
  moveNumber: number;
  column: number;
  boardAfter: string;
  playerId: string;
  moveDurationMs: number | null;
  createdAt: number;
};

type MatchResponse = {
  match: ConnectFourMatch;
  userId: string;
  isSpectator: boolean;
  spectatorCount: number;
  eloChange?: {
    outcome: 'win_a' | 'win_b' | 'draw';
    playerA: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
    playerB: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
  };
  accountXp?: AccountXpReward | null;
  runResult?: ArcadeRunResultSnapshot | null;
};

export default function ConnectFourMatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = (params?.id as string) ?? '';
  const [data, setData] = useState<MatchResponse | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [accountXp, setAccountXp] = useState<AccountXpReward | null>(null);
  const [runResult, setRunResult] = useState<ArcadeRunResultSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionPending, setActionPending] = useState<null | 'resign' | 'cancel'>(null);
  const [opponentElo, setOpponentElo] = useState<{ rating: number; tier: string; tierColor: string } | null>(null);
  const [myElo, setMyElo] = useState<{ rating: number; tier: string; tierColor: string } | null>(null);
  const lastSoundPlyRef = useRef<number>(-1);
  const lastGameEndSoundRef = useRef<string | null>(null);
  const soundInitializedRef = useRef<boolean>(false);
  const turnSoundTimeoutRef = useRef<number | null>(null);
  const loadEpochRef = useRef(0);
  const [c4Theme, setC4Theme] = useState<ConnectFourCosmeticTheme>(DEFAULT_CONNECT_FOUR_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = c4Theme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const searchParams = useSearchParams();
  const priorIds = useMemo(() => parseSeriesParam(searchParams.get('series')), [searchParams]);
  // The result can be hidden to look at the final rack (review, Escape).
  const [resultDismissed, setResultDismissed] = useState(false);
  // A rematch the opponent already made, found among the open matches.
  const [pendingRematch, setPendingRematch] = useState<RematchOffer | null>(null);
  // The game this one is a rematch of, if it came through rematch.
  const fromId = useMemo(() => parseFromParam(searchParams.get('from')), [searchParams]);
  // What a screen reader hears when a chip drops.
  const [announcement, setAnnouncement] = useState('');

  // Load equipped Connect Four cosmetics (discs / board / background). Empty
  // loadout falls back to the default Midway look; failures are non-fatal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=connect-four', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        if (!cancelled) setC4Theme(buildConnectFourTheme(payload));
      } catch { /* defaults apply */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    try {
      const [matchRes, movesRes] = await Promise.all([
        fetch(`/api/games/connect-four/match/${matchId}`, { cache: 'no-store' }),
        fetch(`/api/games/connect-four/match/${matchId}/moves`, { cache: 'no-store' }),
      ]);
      if (epoch !== loadEpochRef.current) return;
      const matchPayload = await matchRes.json();
      // Account-XP burst is served (and consumed) once by the match route, so
      // capture it before the epoch guard — a superseded load still saw it and
      // dropping it here would lose the burst. Sticky: a later null won't clear.
      if (matchPayload?.accountXp) setAccountXp(matchPayload.accountXp);
      if (matchPayload?.runResult) setRunResult(matchPayload.runResult);
      if (epoch !== loadEpochRef.current) return;
      if (!matchRes.ok) {
        setError(matchPayload.error || 'Failed to load match.');
        return;
      }
      setData(matchPayload);
      setError(null);
      if (movesRes.ok) {
        const movesPayload = await movesRes.json();
        if (epoch !== loadEpochRef.current) return;
        setMoves(movesPayload.moves ?? []);
      }
    } catch (err) {
      if (epoch !== loadEpochRef.current) return;
      setError((err as Error).message);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    void load();
  }, [matchId, load]);

  // Live updates via SSE seam + a slow polling backstop. Subscribe to the
  // global `connectFourMatch` channel (per-match channels aren't forwarded by
  // the SSE route, and broadcast() is a no-op today, so polling is the real
  // mechanism). 15s active / 60s finished.
  const matchStatus = data?.match?.status;
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeLive(['connectFourMatch'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void load();
    });
    const isFinished = matchStatus === 'completed' || matchStatus === 'forfeited';
    // A match waiting for its second player is checked sooner: that is the
    // wait after a rematch is made.
    const pollMs = isFinished ? 60_000 : matchStatus === 'waiting' ? 4_000 : 15_000;
    const stopPolling = startVisiblePolling(load, pollMs);
    return () => { unsub(); stopPolling(); };
  }, [matchId, load, matchStatus]);

  // Load Elo info for both players (for the player cards).
  useEffect(() => {
    let cancelled = false;
    const loadElo = async (userId: string | null | undefined, setter: (v: { rating: number; tier: string; tierColor: string } | null) => void) => {
      if (!userId || userId.startsWith('bot:')) { setter(null); return; }
      try {
        const res = await fetch(`/api/games/connect-four/elo-leaderboard?userId=${userId}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        if (payload.player) {
          setter({ rating: payload.player.eloRating, tier: payload.player.tier, tierColor: payload.player.tierColor });
        } else {
          setter(null);
        }
      } catch { /* ignore */ }
    };
    if (data?.match && data.userId) {
      const opponentId = data.match.player1Id === data.userId ? data.match.player2Id : data.match.player1Id;
      void loadElo(data.userId, setMyElo);
      void loadElo(opponentId, setOpponentElo);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.match?.player1Id, data?.match?.player2Id, data?.userId]);

  const match = data?.match ?? null;
  // Equipped profile cosmetics (background/frame/badge/name color/title) for
  // both seats. Bots have no real userId and fall back to the plain card.
  const playerCards = usePlayerCards(
    [match?.player1Id, match?.player2Id].filter(
      (id): id is string => !!id && !id.startsWith('bot:'),
    ),
  );
  const myColor: Color | null = useMemo(() => {
    if (!match || !data) return null;
    if (match.redId === data.userId) return 'red';
    if (match.yellowId === data.userId) return 'yellow';
    return null;
  }, [match, data]);

  // Play a drop sound on each new ply; a single win/end sound on completion.
  useEffect(() => {
    if (!match) return;
    if (!soundInitializedRef.current) {
      soundInitializedRef.current = true;
      lastSoundPlyRef.current = match.ply;
      if (match.status === 'completed' || match.status === 'forfeited') {
        lastGameEndSoundRef.current = match.id;
      }
      return;
    }
    if (match.ply > lastSoundPlyRef.current) {
      lastSoundPlyRef.current = match.ply;
      // The drop's clack plays from the board, timed to the landing.
      if (match.lastMove !== null && data) {
        const col = Number(match.lastMove) + 1;
        const opp =
          (match.player1Id === data.userId ? match.player2Name : match.player1Name) ?? 'Opponent';
        setAnnouncement(
          match.currentTurn === data.userId ? `${opp} played column ${col}` : `You played column ${col}`,
        );
      }
      const isActive = match.status === 'active';
      const movedByOpponent = data && match.currentTurn === data.userId;
      if (isActive && movedByOpponent) {
        if (turnSoundTimeoutRef.current !== null) window.clearTimeout(turnSoundTimeoutRef.current);
        turnSoundTimeoutRef.current = window.setTimeout(() => {
          turnSoundTimeoutRef.current = null;
          playMoveSound('turn');
        }, 260);
      }
    }
    const isOver = match.status === 'completed' || match.status === 'forfeited';
    if (isOver && lastGameEndSoundRef.current !== match.id) {
      lastGameEndSoundRef.current = match.id;
      playMoveSound('win');
    }
  }, [match?.ply, match?.status, match?.id, match, data]);

  useEffect(() => () => {
    if (turnSoundTimeoutRef.current !== null) {
      window.clearTimeout(turnSoundTimeoutRef.current);
      turnSoundTimeoutRef.current = null;
    }
  }, []);

  // A rematch (new matchId on the same mounted component) starts clean.
  useEffect(() => {
    setAccountXp(null);
    setRunResult(null);
    setResultDismissed(false);
    setPendingRematch(null);
  }, [matchId]);

  // After a game against a person, look for the rematch they made: a waiting
  // match from them, made after this game ended. The lobby topic names each
  // new match, and each is read by id, so a busy lobby can't hide an offer;
  // the poll over the open list is the backstop for a missed event.
  const finishedOpponentId =
    match && data && !data.isSpectator && (match.status === 'completed' || match.status === 'forfeited')
      ? (match.player1Id === data.userId ? match.player2Id : match.player1Id)
      : null;
  const finishedMatchId = match?.id ?? null;
  const finishedAt = match ? endedAt(match) : 0;
  useEffect(() => {
    if (!finishedOpponentId || !finishedMatchId || finishedOpponentId.startsWith('bot:')) return;
    let cancelled = false;
    const poll = async () => {
      const offer = await findOffer(finishedOpponentId, finishedAt, finishedMatchId);
      if (!cancelled) setPendingRematch(offer);
    };
    void poll();
    // Every lobby event (a match made, joined, cancelled) is a reason to look.
    const unsub = subscribeLive(['connectFourLobby'], () => { void poll(); });
    const stopPolling = startVisiblePolling(poll, 8_000);
    return () => { cancelled = true; unsub(); stopPolling(); };
  }, [finishedOpponentId, finishedMatchId, finishedAt]);

  // Both players can press rematch at once and make a match each. The waiting
  // page looks for the opponent's offer too; the match with the larger id is
  // given up (cancelled) and its owner joins the other, so exactly one stays.
  const waitingFrom = match && data && match.status === 'waiting' && match.player1Id === data.userId ? fromId : null;
  const waitingMatchId = match?.id ?? null;
  const waitingSeries = priorIds.join(',');
  useEffect(() => {
    if (!waitingFrom || !waitingMatchId || !data) return;
    const myId = data.userId;
    let cancelled = false;
    let switching = false;
    const lookForOffer = async () => {
      if (cancelled || switching) return;
      const previous = await fetchMatch(waitingFrom);
      if (!previous) return;
      const opponentId = previous.player1Id === myId ? previous.player2Id : previous.player1Id;
      if (!opponentId || opponentId.startsWith('bot:')) return;
      const offer = await findOffer(opponentId, endedAt(previous), waitingMatchId);
      if (!offer || cancelled || switching) return;
      // The smaller id stays; the larger one yields.
      if (waitingMatchId < offer.matchId) return;
      switching = true;
      try {
        await fetch(`/api/games/connect-four/match/${waitingMatchId}/cancel`, { method: 'POST' });
        const res = await fetch('/api/games/connect-four/match/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: offer.matchId }),
        });
        if (res.ok) {
          router.push(seriesHref(offer.matchId, waitingSeries ? waitingSeries.split(',') : [], waitingFrom));
          return;
        }
        setError('They started another game.');
      } catch {
        /* the next event or poll tries again */
      }
      switching = false;
    };
    void lookForOffer();
    const unsub = subscribeLive(['connectFourLobby'], () => { void lookForOffer(); });
    const stop = startVisiblePolling(() => lookForOffer(), 4_000);
    return () => { cancelled = true; unsub(); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingFrom, waitingMatchId, data?.userId, waitingSeries]);

  // The best-of-three score: the earlier games from the link, plus this one
  // once it is over. Only between two people.
  const seriesPlayers = useMemo<readonly [string, string | null] | null>(
    () => (match ? [match.player1Id, match.player2Id] : null),
    [match],
  );
  const priorGames = useSeriesGames(priorIds, seriesPlayers);

  const isMyTurn = Boolean(
    match && match.status === 'active' && data && match.currentTurn === data.userId,
  );

  const submitMove = useCallback(async (column: number) => {
    if (!matchId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/connect-four/match/${matchId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error || 'Move rejected.');
        void load();
        return;
      }
      setData((prev) => (prev ? { ...prev, match: payload.match, eloChange: payload.eloChange ?? prev.eloChange } : prev));
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [matchId, submitting, load]);

  const action = useCallback(async (endpoint: string, act: typeof actionPending) => {
    if (!matchId || actionPending) return;
    setActionPending(act);
    try {
      const res = await fetch(`/api/games/connect-four/match/${matchId}/${endpoint}`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Action failed.');
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  }, [matchId, actionPending, load]);

  if (error && !data) {
    return (
      <GameShell game='connect-four' backHref='/connect-four' howTo={HOW_TO} below={
        <div className='arcade-card-inset p-6 text-sm text-danger-text'>{error}</div>
      } />
    );
  }

  if (!data || !match) {
    return (
      <GameShell
        game='connect-four'
        backHref='/connect-four'
        howTo={HOW_TO}
        below={
          <div className='flex items-center justify-center py-20'>
            <ArcadeLoading label='Loading the match.' />
          </div>
        }
      />
    );
  }

  const isGameOver = match.status === 'completed' || match.status === 'forfeited';
  const lastMove = match.lastMove !== null ? Number(match.lastMove) : null;

  // Player rows: opponent on top, me on bottom (spectators see red on top).
  const opponentId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
  const meIsRed = match.redId === data.userId;
  const topColor: Color = data.isSpectator ? 'red' : meIsRed ? 'yellow' : 'red';
  const bottomColor: Color = topColor === 'red' ? 'yellow' : 'red';
  const nameForColor = (color: Color): string => {
    const id = color === 'red' ? match.redId : match.yellowId;
    if (!id) return color === 'red' ? 'Red' : 'Yellow';
    return id === match.player1Id ? match.player1Name : (match.player2Name ?? (color === 'red' ? 'Red' : 'Yellow'));
  };
  const idForColor = (color: Color) => (color === 'red' ? match.redId : match.yellowId);
  const botTierForId = (id: string | null): 'easy' | 'medium' | 'hard' | null => {
    if (!id || !id.startsWith('bot:')) return null;
    const tier = id.replace('bot:', '');
    return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
  };
  const topId = idForColor(topColor);
  const bottomId = idForColor(bottomColor);
  const topIsMe = topId === data.userId;
  const topEloInfo = topIsMe ? myElo : opponentElo;
  const bottomEloInfo = topIsMe ? opponentElo : myElo;
  const topActive = match.status === 'active' && match.currentTurn === topId;
  const bottomActive = match.status === 'active' && match.currentTurn === bottomId;
  // Resolve each seat's profile cosmetics + avatar.
  const topCardCosmetics = topId ? playerCards[topId] : undefined;
  const bottomCardCosmetics = bottomId ? playerCards[bottomId] : undefined;

  // ── Best of three: between two people, never against a bot ─────────────
  const opponentIsBot = Boolean(opponentId?.startsWith('bot:'));
  const seriesOn = !data.isSpectator && Boolean(opponentId) && !opponentIsBot;
  const thisGame: SeriesGame[] =
    isGameOver && !priorGames.some((g) => g.id === match.id) ? [gameFromMatch(match)] : [];
  const seriesGames = seriesOn ? [...priorGames, ...thisGame] : [];
  const series =
    seriesOn && opponentId && seriesGames.length > 0
      ? scoreSeries(seriesGames, data.userId, opponentId)
      : null;
  const winsFor = (id: string | null) =>
    series && id ? (id === data.userId ? series.me : series.them) : null;

  const opponentName =
    (match.player1Id === data.userId ? match.player2Name : match.player1Name) ?? 'your opponent';
  // The line under the board: whose move it is. A spectator sees the
  // seats, so nothing.
  const statusLine =
    match.status === 'waiting'
      ? 'No one has joined yet.'
      : match.status !== 'active' || data.isSpectator
        ? null
        : isMyTurn
          ? 'Your move.'
          : `${opponentName}'s move.`;

  // The next game: a plain match once a series is settled, otherwise the
  // same query carries the games played so far.
  const nextGameIds = series && !series.over ? seriesGames.map((g) => g.id) : [];
  const startNextGame = async () => {
    if (!match.player2Id || !opponentId) return;
    try {
      // The opponent already made the rematch, or has by now: join it. Look
      // once more before creating, so two players pressing together don't
      // each make a match when one is already there.
      const offer = opponentIsBot
        ? null
        : (pendingRematch ?? (await findOffer(opponentId, endedAt(match), match.id)));
      if (offer) {
        const res = await fetch('/api/games/connect-four/match/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: offer.matchId }),
        });
        if (!res.ok) {
          // Most likely someone else took it, or they started another game.
          setError('They started another game.');
          setPendingRematch(null);
          return;
        }
        router.push(seriesHref(offer.matchId, nextGameIds, match.id));
        return;
      }
      const preferredColor = myColor === 'red' ? 'yellow' : myColor === 'yellow' ? 'red' : 'random';
      // A bot has no account to wait for the rematch: start a fresh practice
      // game at the same level instead.
      if (opponentIsBot) {
        const res = await fetch('/api/games/connect-four/match/bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: opponentId.replace('bot:', ''), preferredColor }),
        });
        const payload = await res.json();
        if (!res.ok) {
          setError(payload.error || 'Failed to start the rematch.');
          return;
        }
        router.push(`/connect-four/${payload.match.id}`);
        return;
      }
      // v1 has no direct-challenge endpoint and the create route takes no
      // invited user; create a fresh open match and go to it. The opponent
      // finds it from their result and accepts.
      const res = await fetch('/api/games/connect-four/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredColor }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error || 'Failed to start the rematch.');
        return;
      }
      router.push(seriesHref(payload.match.id, nextGameIds, match.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // The result, drawn over the stage. Review hides it to look at the rack.
  const end =
    isGameOver && !resultDismissed ? (
      <PostgameResult
        match={match}
        isMe={data.userId}
        isSpectator={data.isSpectator}
        myElo={eloDeltaFor(data.eloChange, data.userId)}
        accountXp={accountXp}
        runResult={runResult}
        series={series}
        pendingRematch={pendingRematch}
        onAcceptPendingRematch={startNextGame}
        onLobby={() => router.push('/connect-four')}
        onDismiss={() => setResultDismissed(true)}
        canRematch={Boolean(match.player2Id && myColor)}
        onRematch={startNextGame}
      />
    ) : null;

  // Resign and cancel sit under the screen, inside the cabinet; once the
  // result is hidden, so does the way back to it.
  const showControls =
    (match.status === 'waiting' && match.player1Id === data.userId) ||
    (match.status === 'active' && Boolean(myColor)) ||
    (isGameOver && resultDismissed);
  // The same buttons sit under the screen and, on a phone on its side, beside the
  // board (the c4-actions CSS shows one and hides the other).
  const actionButtons = (
    <>
      {match.status === 'waiting' && match.player1Id === data.userId && (
        <ArcadeButton
          tone='default'
          size='sm'
          onClick={() => action('cancel', 'cancel')}
          disabled={!!actionPending}
        >
          cancel match
        </ArcadeButton>
      )}
      {match.status === 'active' && myColor && (
        <ArcadeButton
          tone='danger'
          size='sm'
          onClick={() => {
            if (confirm('Resign this match?')) action('resign', 'resign');
          }}
          disabled={!!actionPending}
        >
          <Flag size={14} />
          resign
        </ArcadeButton>
      )}
      {isGameOver && resultDismissed && (
        <ArcadeButton tone='primary' size='sm' onClick={() => setResultDismissed(false)}>
          result
        </ArcadeButton>
      )}
    </>
  );
  const controls = showControls ? (
    <div data-surface='ink' className='c4-actions c4-actions-controls flex flex-wrap justify-center gap-2 pb-1'>
      {actionButtons}
    </div>
  ) : undefined;

  return (
    <GameShell
      game='connect-four'
      backHref='/connect-four'
      stat={<GameStat value={series ? `${series.me}-${series.them}` : null} label='series' />}
      howTo={HOW_TO}
      below={
        <>
          {data.isSpectator || data.spectatorCount > 0 || (series && !series.over) ? (
            <p className='flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-muted'>
              {data.isSpectator && <span>you are watching</span>}
              {data.spectatorCount > 0 && (
                <span className='inline-flex items-center gap-1'>
                  <Eye size={14} strokeLinecap='square' aria-hidden /> <Num value={data.spectatorCount} /> watching
                </span>
              )}
              {series && !series.over && (
                <span>
                  best of three, game <Num value={series.played + 1} />
                </span>
              )}
            </p>
          ) : null}
          {error && (
            <div className='arcade-card-inset px-3 py-2 text-sm text-danger-text'>{error}</div>
          )}
          {moves.length > 0 ? (
            <section className='max-w-xl'>
              <h2 className='mb-1 flex min-h-11 items-center gap-2 text-[1.0625rem] font-extrabold text-strong'>
                moves <Num value={moves.length} className='text-muted' />
              </h2>
              <div className='arcade-card-inset max-h-[28rem] overflow-y-auto p-2'>
                <ol className='space-y-1'>
                  {moves.map((m) => {
                    const isRed = (m.ply - 1) % 2 === 0;
                    return (
                      <li key={m.ply} className='flex items-center gap-2 text-[0.9375rem]'>
                        <span className='arcade-num w-7 text-muted'>{m.moveNumber}.</span>
                        <span
                          className='inline-block h-3.5 w-3.5 rounded-full'
                          style={{
                            background: c4Theme.skin
                              ? (isRed === ((myColor ?? 'red') === 'red') ? c4Theme.skin.you : c4Theme.skin.them).fill
                              : connectFourDiscGradient(c4Theme, isRed ? 'red' : 'yellow'),
                            boxShadow: c4Theme.skin
                              ? `0 0 0 1px ${(isRed === ((myColor ?? 'red') === 'red') ? c4Theme.skin.you : c4Theme.skin.them).edge}`
                              : 'inset 0 1px 0 rgba(255,255,255,0.3)',
                          }}
                          aria-hidden
                        />
                        <span className='text-body'>column {m.column + 1}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </section>
          ) : null}
        </>
      }
    >
      {/* A match has no first input to wait for, so the stage stays in
          `ready` with the turn line as its hint. */}
      <div role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </div>
      <GameStage
        phase={isGameOver && !resultDismissed ? 'over' : 'ready'}
        hint={statusLine ?? undefined}
        end={end}
        controls={controls}
      >
        <div className='c4-stage'>
          <div className='c4-stage-inner'>
            <div className='c4-seat'>
              <ConnectFourPlayerCard
                name={nameForColor(topColor)}
                avatarUrl={topCardCosmetics?.avatarUrl}
                color={topColor}
                skin={c4Theme.skin}
                chipSide={topColor === (myColor ?? 'red') ? 'you' : 'them'}
                isActive={topActive}
                isMe={topIsMe}
                eloRating={topEloInfo?.rating}
                eloTier={topEloInfo?.tier}
                flair={topCardCosmetics?.flair}
                botTier={botTierForId(topId)}
                seriesWins={winsFor(topId)}
              />
            </div>
            <div className='relative flex w-full justify-center'>
              <ConnectFourBoard
                board={match.board}
                myColor={myColor}
                isMyTurn={isMyTurn}
                lastMove={lastMove}
                onMove={submitMove}
                submitting={submitting}
                interactive={match.status === 'active'}
                dim={isGameOver && !resultDismissed}
                theme={c4Theme}
              />
            </div>
            <div className='c4-seat'>
              <ConnectFourPlayerCard
                name={nameForColor(bottomColor)}
                avatarUrl={bottomCardCosmetics?.avatarUrl}
                color={bottomColor}
                skin={c4Theme.skin}
                chipSide={bottomColor === (myColor ?? 'red') ? 'you' : 'them'}
                isActive={bottomActive}
                isMe={!topIsMe && !data.isSpectator}
                eloRating={bottomEloInfo?.rating}
                eloTier={bottomEloInfo?.tier}
                flair={bottomCardCosmetics?.flair}
                botTier={botTierForId(bottomId)}
                seriesWins={winsFor(bottomId)}
              />
            </div>
            {showControls && (
              <div data-surface='ink' className='c4-actions c4-actions-stage'>
                {actionButtons}
              </div>
            )}
          </div>
        </div>
      </GameStage>
    </GameShell>
  );
}

function eloDeltaFor(
  eloChange: MatchResponse['eloChange'],
  userId: string | null,
) {
  if (!eloChange || !userId) return null;
  if (eloChange.playerA.id === userId) return { ...eloChange.playerA };
  if (eloChange.playerB.id === userId) return { ...eloChange.playerB };
  return null;
}
