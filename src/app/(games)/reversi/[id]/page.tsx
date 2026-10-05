'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CircleDot,
  Copy,
  Flag,
  Users,
  Eye,
} from 'lucide-react';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { countDiscs } from '@/features/arcade/lib/reversi';
import { type ReversiMatch, type Color } from '@/features/arcade/lib/reversi/types';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { ReversiBoard } from '../_board';
import { PostgameOverlay } from '../_postgame-overlay';
import { ReversiPlayerCard } from '../_player-card';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { playMoveSound } from '../_sounds';
import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

type MoveRow = {
  ply: number;
  moveNumber: number;
  cell: number;
  boardAfter: string;
  playerId: string;
  moveDurationMs: number | null;
  createdAt: number;
};

type MatchResponse = {
  match: ReversiMatch;
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

const FILE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const cellLabel = (cell: number) => `${FILE_LETTERS[cell % 8] ?? '?'}${Math.floor(cell / 8) + 1}`;

export default function ReversiMatchPage() {
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
  const [shareCopied, setShareCopied] = useState(false);
  const lastSoundPlyRef = useRef<number>(-1);
  const lastGameEndSoundRef = useRef<string | null>(null);
  const soundInitializedRef = useRef<boolean>(false);
  const turnSoundTimeoutRef = useRef<number | null>(null);
  const loadEpochRef = useRef(0);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnStartRef = useRef(false);

  const load = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    try {
      const [matchRes, movesRes] = await Promise.all([
        fetch(`/api/games/reversi/match/${matchId}`, { cache: 'no-store' }),
        fetch(`/api/games/reversi/match/${matchId}/moves`, { cache: 'no-store' }),
      ]);
      if (epoch !== loadEpochRef.current) return;
      const matchPayload = await matchRes.json();
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

  // Live updates via SSE seam + a slow polling backstop. 15s active / 60s done.
  const matchStatus = data?.match?.status;
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeLive(['reversiMatch'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void load();
    });
    const isFinished = matchStatus === 'completed' || matchStatus === 'forfeited';
    const pollMs = isFinished ? 60_000 : 15_000;
    const stopPolling = startVisiblePolling(load, pollMs);
    return () => { unsub(); stopPolling(); };
  }, [matchId, load, matchStatus]);

  // Load Elo info for both players (for the player cards).
  useEffect(() => {
    let cancelled = false;
    const loadElo = async (userId: string | null | undefined, setter: (v: { rating: number; tier: string; tierColor: string } | null) => void) => {
      if (!userId || userId.startsWith('bot:')) { setter(null); return; }
      try {
        const res = await fetch(`/api/games/reversi/elo-leaderboard?userId=${userId}`, { cache: 'no-store' });
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
  const playerCards = usePlayerCards(
    [match?.player1Id, match?.player2Id].filter(
      (id): id is string => !!id && !id.startsWith('bot:'),
    ),
  );
  const myColor: Color | null = useMemo(() => {
    if (!match || !data) return null;
    if (match.blackId === data.userId) return 'black';
    if (match.whiteId === data.userId) return 'white';
    return null;
  }, [match, data]);

  // Play a place + flip sound on each new ply; a single win/end sound on done.
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
      playMoveSound('place');
      window.setTimeout(() => playMoveSound('flip'), 90);
      const isActive = match.status === 'active';
      const movedByOpponent = data && match.currentTurn === data.userId;
      if (isActive && movedByOpponent) {
        if (turnSoundTimeoutRef.current !== null) window.clearTimeout(turnSoundTimeoutRef.current);
        turnSoundTimeoutRef.current = window.setTimeout(() => {
          turnSoundTimeoutRef.current = null;
          playMoveSound('turn');
        }, 320);
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

  // Scroll the board into view on first active render.
  useEffect(() => {
    scrolledOnStartRef.current = false;
    setAccountXp(null);
    setRunResult(null);
  }, [matchId]);
  useEffect(() => {
    if (scrolledOnStartRef.current) return;
    if (!match) return;
    if (match.status !== 'active') return;
    const el = boardContainerRef.current;
    if (!el) return;
    scrolledOnStartRef.current = true;
    let rafId = 0;
    rafId = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
    return () => { window.cancelAnimationFrame(rafId); };
  }, [match?.status, match]);

  const isMyTurn = Boolean(
    match && match.status === 'active' && data && match.currentTurn === data.userId,
  );

  const submitMove = useCallback(async (cell: number) => {
    if (!matchId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/reversi/match/${matchId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cell }),
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
      const res = await fetch(`/api/games/reversi/match/${matchId}/${endpoint}`, { method: 'POST' });
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

  const copyShareLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/reversi?join=${matchId}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch {
      setError('Clipboard access is unavailable.');
    }
  }, [matchId]);

  if (error && !data) {
    return (
      <GamesShell headerProps={{ icon: <CircleDot size={18} />, title: 'Reversi match', subtitle: 'Error' }}>
        <div className="arcade-card-inset p-6 text-sm text-danger-text">{error}</div>
      </GamesShell>
    );
  }

  if (!data || !match) {
    return (
      <GamesShell headerProps={{ icon: <CircleDot size={18} />, title: 'Reversi match', subtitle: 'Loading…' }}>
        <div className="flex items-center justify-center py-20">
          <ArcadeLoading label='Loading the match.' />
        </div>
      </GamesShell>
    );
  }

  const isGameOver = match.status === 'completed' || match.status === 'forfeited';
  const lastMove = match.lastMove !== null ? Number(match.lastMove) : null;
  const discs = countDiscs(match.board);

  // Player cards: opponent on top, me on bottom (spectators see black on top).
  const opponentId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
  const meIsBlack = match.blackId === data.userId;
  const topColor: Color = data.isSpectator ? 'black' : meIsBlack ? 'white' : 'black';
  const bottomColor: Color = topColor === 'black' ? 'white' : 'black';
  const nameForColor = (color: Color): string => {
    const id = color === 'black' ? match.blackId : match.whiteId;
    if (!id) return color === 'black' ? 'Black' : 'White';
    return id === match.player1Id ? match.player1Name : (match.player2Name ?? (color === 'black' ? 'Black' : 'White'));
  };
  const idForColor = (color: Color) => (color === 'black' ? match.blackId : match.whiteId);
  const botTierForId = (id: string | null): 'easy' | 'medium' | 'hard' | null => {
    if (!id || !id.startsWith('bot:')) return null;
    const tier = id.replace('bot:reversi-', '').replace('bot:', '');
    return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
  };
  const topId = idForColor(topColor);
  const bottomId = idForColor(bottomColor);
  const topIsMe = topId === data.userId;
  const topEloInfo = topIsMe ? myElo : opponentElo;
  const bottomEloInfo = topIsMe ? opponentElo : myElo;
  const topActive = match.status === 'active' && match.currentTurn === topId;
  const bottomActive = match.status === 'active' && match.currentTurn === bottomId;
  const topCardCosmetics = topId ? playerCards[topId] : undefined;
  const bottomCardCosmetics = bottomId ? playerCards[bottomId] : undefined;
  const discFor = (color: Color) => (color === 'black' ? discs.black : discs.white);

  return (
    <GamesShell
      headerProps={{
        icon: <CircleDot size={18} />,
        title: 'Reversi',
        subtitle: `${match.status}`,
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/reversi" className="inline-flex items-center gap-1.5 text-sm text-faint hover:text-strong">
          <ArrowLeft size={14} />
          Lobby
        </Link>
        <div className="flex items-center gap-2 text-xs text-faint">
          {data.isSpectator && (
            <span className="inline-flex items-center gap-1 rounded-tag border border-soft bg-raised px-2 py-0.5 text-faint shadow-chip">
              <Eye size={10} /> Spectating
            </span>
          )}
          {data.spectatorCount > 0 && (
            <span className="arcade-num inline-flex items-center gap-1 rounded-tag border border-soft bg-raised px-2 py-0.5 shadow-chip">
              <Eye size={10} /> {data.spectatorCount}
            </span>
          )}
          <MuteButton />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="flex flex-col items-center gap-3">
          {/* Opponent card */}
          <div className="w-full" style={{ maxWidth: 'min(92vw, 640px)' }}>
            <ReversiPlayerCard
              name={nameForColor(topColor)}
              avatarUrl={topCardCosmetics?.avatarUrl}
              color={topColor}
              isActive={topActive}
              discCount={discFor(topColor)}
              eloRating={topEloInfo?.rating}
              eloTier={topEloInfo?.tier}
              eloTierColor={topEloInfo?.tierColor}
              flair={topCardCosmetics?.flair}
              botTier={botTierForId(topId)}
            />
          </div>

          {/* Board */}
          <div ref={boardContainerRef} className="relative flex w-full justify-center">
            <ReversiBoard
              board={match.board}
              myColor={myColor}
              isMyTurn={isMyTurn}
              lastMove={lastMove}
              onMove={submitMove}
              submitting={submitting}
              interactive={match.status === 'active'}
              dim={isGameOver}
            />
            {isGameOver && (
              <PostgameOverlay
                match={match}
                isMe={data.userId}
                isSpectator={data.isSpectator}
                myElo={eloDeltaFor(data.eloChange, data.userId)}
                opponentElo={eloDeltaFor(data.eloChange, opponentId)}
                accountXp={accountXp}
                runResult={runResult}
                onLobby={() => router.push('/reversi')}
                canRematch={Boolean(match.player2Id && !match.player2Id.startsWith('bot:') && myColor)}
                onRematch={async () => {
                  if (!match.player2Id) return;
                  const oppId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
                  if (!oppId || oppId.startsWith('bot:')) return;
                  try {
                    const res = await fetch('/api/games/reversi/match', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        preferredColor: myColor === 'black' ? 'white' : myColor === 'white' ? 'black' : 'random',
                      }),
                    });
                    const payload = await res.json();
                    if (!res.ok) {
                      setError(payload.error || 'Failed to start rematch.');
                      return;
                    }
                    router.push(`/reversi/${payload.match.id}`);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            )}
          </div>

          {/* Me card */}
          <div className="w-full" style={{ maxWidth: 'min(92vw, 640px)' }}>
            <ReversiPlayerCard
              name={nameForColor(bottomColor)}
              avatarUrl={bottomCardCosmetics?.avatarUrl}
              color={bottomColor}
              isActive={bottomActive}
              discCount={discFor(bottomColor)}
              eloRating={bottomEloInfo?.rating}
              eloTier={bottomEloInfo?.tier}
              eloTierColor={bottomEloInfo?.tierColor}
              flair={bottomCardCosmetics?.flair}
              botTier={botTierForId(bottomId)}
            />
          </div>

          {/* Action row */}
          <div className="flex w-full flex-wrap justify-center gap-2" style={{ maxWidth: 'min(92vw, 640px)' }}>
            {match.status === 'waiting' && match.player1Id === data.userId && (
              <ArcadeButton
                tone="default"
                size="sm"
                onClick={() => action('cancel', 'cancel')}
                disabled={!!actionPending}
              >
                Cancel match
              </ArcadeButton>
            )}
            {match.status === 'active' && myColor && (
              <ArcadeButton
                tone="danger"
                size="sm"
                onClick={() => {
                  if (confirm('Resign this match?')) action('resign', 'resign');
                }}
                disabled={!!actionPending}
              >
                <Flag size={14} />
                Resign
              </ArcadeButton>
            )}
          </div>
          {error && (
            <div className="arcade-card-inset w-full px-3 py-2 text-sm text-danger-text" style={{ maxWidth: 'min(92vw, 640px)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-4">
          {match.status === 'waiting' && (
            <div className="arcade-card p-4 text-sm">
              <div className="mb-1 flex items-center gap-2 text-faint">
                <Users size={14} />
                Waiting for opponent…
              </div>
              <div className="mb-3 text-xs text-faint">Share this link — whoever opens it joins your match.</div>
              <ArcadeButton tone="default" size="sm" className="w-full" onClick={copyShareLink}>
                {shareCopied ? <Check size={14} /> : <Copy size={14} />}
                {shareCopied ? 'Copied' : 'Copy invite link'}
              </ArcadeButton>
            </div>
          )}
          <div>
            <div className="arcade-kicker mb-1 flex items-center justify-between text-xs text-faint">
              <span>Moves</span>
              <span className="arcade-num">{moves.length}</span>
            </div>
            <div className="arcade-card-inset max-h-[28rem] overflow-y-auto p-2">
              {moves.length === 0 ? (
                <div className="py-6 text-center text-xs text-faint">No moves yet.</div>
              ) : (
                <ol className="space-y-1">
                  {moves.map((m) => {
                    const isBlack = m.playerId === match.blackId;
                    return (
                      <li key={m.ply} className="flex items-center gap-2 text-xs">
                        <span className="arcade-num w-6 text-faint">{m.moveNumber}.</span>
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-ink"
                          style={{
                            background: isBlack
                              ? 'radial-gradient(circle at 50% 34%, #4a4e58, #1b1d22 62%, #050608 100%)'
                              : 'radial-gradient(circle at 50% 34%, #ffffff, #f3eee2 64%, #c9c0ab 100%)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                          }}
                          aria-hidden
                        />
                        <span className="text-body">{cellLabel(m.cell)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </GamesShell>
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
