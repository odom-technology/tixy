'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Flag, HandshakeIcon, Users, Eye } from 'lucide-react';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import type { CheckersMatch, CheckersColor } from '@/features/arcade/lib/checkers/types';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { CheckersBoard } from '../_board';
import {
  DEFAULT_CHECKERS_THEME,
  buildCheckersTheme,
  type CheckersCosmeticTheme,
} from '../_checkers-theme';
import { PostgameOverlay } from '../_postgame-overlay';
import { CheckersPlayerCard, countPiecesForColor } from '../_player-card';
import { usePlayerCards } from '@/features/users/use-player-cards';
import {
  playMoveSound,
  type MoveSoundKind,
} from '../_sounds';
import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

type MatchResponse = {
  match: CheckersMatch;
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

type EloInfo = { rating: number; tier: string; tierColor: string };

export default function CheckersMatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = (params?.id as string) ?? '';
  const [data, setData] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionPending, setActionPending] = useState<null | 'resign' | 'draw-offer' | 'draw-accept' | 'draw-decline' | 'cancel'>(null);
  const [opponentElo, setOpponentElo] = useState<EloInfo | null>(null);
  const [myElo, setMyElo] = useState<EloInfo | null>(null);
  const [accountXp, setAccountXp] = useState<AccountXpReward | null>(null);
  const [runResult, setRunResult] = useState<ArcadeRunResultSnapshot | null>(null);
  const [checkersTheme, setCheckersTheme] = useState<CheckersCosmeticTheme>(DEFAULT_CHECKERS_THEME);
  const lastSoundPlyRef = useRef<number>(-1);
  const lastGameEndSoundRef = useRef<string | null>(null);
  const soundInitializedRef = useRef<boolean>(false);
  const turnSoundTimeoutRef = useRef<number | null>(null);
  const loadEpochRef = useRef(0);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnStartRef = useRef(false);

  // Load equipped Checkers cosmetics (pieces / board). Empty loadout falls back
  // to the default Midway look; failures are non-fatal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=checkers', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        if (!cancelled) setCheckersTheme(buildCheckersTheme(payload));
      } catch { /* defaults apply */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    try {
      const res = await fetch(`/api/games/checkers/match/${matchId}`, { cache: 'no-store' });
      if (epoch !== loadEpochRef.current) return;
      const payload = await res.json();
      // Account-XP burst is served (and consumed) once by the match route, so
      // capture it before the epoch guard — a superseded load still saw it and
      // dropping it here would lose the burst. Sticky: a later null won't clear.
      if (payload?.accountXp) setAccountXp(payload.accountXp);
      if (payload?.runResult) setRunResult(payload.runResult);
      if (epoch !== loadEpochRef.current) return;
      if (!res.ok) {
        setError(payload.error || 'Failed to load match.');
        return;
      }
      setData(payload);
      setError(null);
    } catch (err) {
      if (epoch !== loadEpochRef.current) return;
      setError((err as Error).message);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    void load();
  }, [matchId, load]);

  // Live updates via the (dormant) SSE seam + a slow polling backstop.
  const matchStatus = data?.match?.status;
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeLive(['checkersMatch'], (payload) => {
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
    const loadElo = async (userId: string | null | undefined, setter: (v: EloInfo | null) => void) => {
      if (!userId || userId.startsWith('bot:')) { setter(null); return; }
      try {
        const res = await fetch(`/api/games/checkers/elo-leaderboard?userId=${userId}`, { cache: 'no-store' });
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
  const myColor: CheckersColor | null = useMemo(() => {
    if (!match || !data) return null;
    if (match.redId === data.userId) return 'red';
    if (match.whiteId === data.userId) return 'white';
    return null;
  }, [match, data]);

  // Move + game-end sounds.
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
      const notation = match.lastMove ?? '';
      const kind: MoveSoundKind = notation.includes('x') ? 'capture' : 'move';
      playMoveSound(kind);
      const isActive = match.status === 'active';
      const movedByOpponent = data && match.currentTurn === data.userId;
      if (isActive && movedByOpponent) {
        if (turnSoundTimeoutRef.current !== null) window.clearTimeout(turnSoundTimeoutRef.current);
        turnSoundTimeoutRef.current = window.setTimeout(() => {
          turnSoundTimeoutRef.current = null;
          playMoveSound('turn');
        }, 240);
      }
    }
    const isOver = match.status === 'completed' || match.status === 'forfeited';
    if (isOver && lastGameEndSoundRef.current !== match.id) {
      lastGameEndSoundRef.current = match.id;
      playMoveSound('gameEnd');
    }
  }, [match?.ply, match?.status, match?.id, match?.lastMove, match, data]);

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
    if (!match || match.status !== 'active') return;
    const el = boardContainerRef.current;
    if (!el) return;
    scrolledOnStartRef.current = true;
    const rafId = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
    return () => { window.cancelAnimationFrame(rafId); };
  }, [match?.status, match]);

  const isMyTurn = Boolean(match && match.status === 'active' && data && match.currentTurn === data.userId);

  const submitMove = useCallback(async (notation: string) => {
    if (!matchId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/checkers/match/${matchId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move: notation }),
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
      const res = await fetch(`/api/games/checkers/match/${matchId}/${endpoint}`, { method: 'POST' });
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
      <GamesShell headerProps={{ title: 'Checkers match', subtitle: 'Error' }}>
        <div className='arcade-card-inset p-6 text-sm text-danger-text'>{error}</div>
      </GamesShell>
    );
  }

  if (!data || !match) {
    return (
      <GamesShell headerProps={{ title: 'Checkers match', subtitle: 'Loading…' }}>
        <div className='flex items-center justify-center py-20'>
          <ArcadeLoading label='Loading the match.' />
        </div>
      </GamesShell>
    );
  }

  const isGameOver = match.status === 'completed' || match.status === 'forfeited';
  const drawOfferedByOpponent = match.drawOfferedBy && match.drawOfferedBy !== data.userId;
  const drawOfferedByMe = match.drawOfferedBy === data.userId;
  const orientation: CheckersColor = myColor ?? 'red';

  const opponentId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
  const opponentIsBot = Boolean(opponentId?.startsWith('bot:'));
  const _opponentBotTier = opponentIsBot ? (opponentId!.replace('bot:', '') as 'easy' | 'medium' | 'hard') : null;

  // Card layout: bottom = the viewer's colour (or red for spectators).
  const redName = (match.redId === match.player1Id ? match.player1Name : match.player2Name) ?? 'Red';
  const whiteName = (match.whiteId === match.player1Id ? match.player1Name : match.player2Name) ?? 'White';
  const redCounts = countPiecesForColor(match.board, 'red');
  const whiteCounts = countPiecesForColor(match.board, 'white');

  const topColor: CheckersColor = orientation === 'red' ? 'white' : 'red';
  const bottomColor: CheckersColor = orientation === 'red' ? 'red' : 'white';
  const topIsRed = topColor === 'red';
  const topName = topIsRed ? redName : whiteName;
  const bottomName = topIsRed ? whiteName : redName;
  const topCounts = topIsRed ? redCounts : whiteCounts;
  const bottomCounts = topIsRed ? whiteCounts : redCounts;
  const topId = topColor === 'red' ? match.redId : match.whiteId;
  const bottomId = bottomColor === 'red' ? match.redId : match.whiteId;
  const topIsMe = topId === data.userId;
  const topEloInfo = topIsMe ? myElo : opponentElo;
  const bottomEloInfo = topIsMe ? opponentElo : myElo;
  const topIsTurn = match.status === 'active' && match.currentTurn === topId;
  const bottomIsTurn = match.status === 'active' && match.currentTurn === bottomId;
  const botTierFor = (pid: string | null): 'easy' | 'medium' | 'hard' | null => {
    if (!pid || !pid.startsWith('bot:')) return null;
    const t = pid.replace('bot:', '');
    return t === 'easy' || t === 'medium' || t === 'hard' ? t : null;
  };
  // Resolve each seat's profile cosmetics + avatar.
  const topCardCosmetics = topId ? playerCards[topId] : undefined;
  const bottomCardCosmetics = bottomId ? playerCards[bottomId] : undefined;

  return (
    <GamesShell headerProps={{ title: 'Checkers', subtitle: match.status }}>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <Link href='/checkers' className='inline-flex items-center gap-1.5 text-sm text-faint hover:text-strong'>
          <ArrowLeft size={14} />
          Lobby
        </Link>
        <div className='flex items-center gap-2 text-xs text-faint'>
          {data.isSpectator && (
            <span className='inline-flex items-center gap-1 rounded-tag border border-soft bg-raised px-2 py-0.5 text-faint shadow-chip'>
              <Eye size={10} /> Spectating
            </span>
          )}
          {data.spectatorCount > 0 && (
            <span className='arcade-num inline-flex items-center gap-1 rounded-tag border border-soft bg-raised px-2 py-0.5 shadow-chip'>
              <Eye size={10} /> {data.spectatorCount}
            </span>
          )}
          <MuteButton />
        </div>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_320px]'>
        <div className='flex flex-col gap-3'>
          <CheckersPlayerCard
            name={topName}
            avatarUrl={topCardCosmetics?.avatarUrl}
            color={topColor}
            isActive={Boolean(topIsTurn)}
            pieceCount={topCounts.pieces}
            kingCount={topCounts.kings}
            eloRating={topEloInfo?.rating}
            eloTier={topEloInfo?.tier}
            eloTierColor={topEloInfo?.tierColor}
            flair={topCardCosmetics?.flair}
            side='left'
            botTier={botTierFor(topId)}
          />

          <div ref={boardContainerRef} className='relative flex justify-center'>
            <CheckersBoard
              board={match.board}
              orientation={orientation}
              myColor={myColor}
              isMyTurn={isMyTurn}
              lastMove={match.lastMove}
              onMove={submitMove}
              submitting={submitting}
              interactive={match.status === 'active'}
              dim={isGameOver}
              theme={checkersTheme}
            />
            {isGameOver && (
              <PostgameOverlay
                match={match}
                isMe={data.userId}
                isSpectator={data.isSpectator}
                myElo={eloDeltaFor(data.eloChange, data.userId)}
                opponentElo={eloDeltaFor(
                  data.eloChange,
                  data.match.player1Id === data.userId ? data.match.player2Id : data.match.player1Id,
                )}
                accountXp={accountXp}
                runResult={runResult}
                onLobby={() => router.push('/checkers')}
                canRematch={Boolean(match.player2Id && !match.player2Id.startsWith('bot:') && myColor)}
                onRematch={async () => {
                  if (!match.player2Id) return;
                  const oppId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
                  if (!oppId || oppId.startsWith('bot:')) return;
                  // No direct-challenge route in v1 → start a fresh open match.
                  try {
                    const res = await fetch('/api/games/checkers/match', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ preferredColor: myColor === 'red' ? 'white' : 'red' }),
                    });
                    const payload = await res.json();
                    if (!res.ok) { setError(payload.error || 'Failed to start rematch.'); return; }
                    router.push(`/checkers/${payload.match.id}`);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            )}
          </div>

          <CheckersPlayerCard
            name={bottomName}
            avatarUrl={bottomCardCosmetics?.avatarUrl}
            color={bottomColor}
            isActive={Boolean(bottomIsTurn)}
            pieceCount={bottomCounts.pieces}
            kingCount={bottomCounts.kings}
            eloRating={bottomEloInfo?.rating}
            eloTier={bottomEloInfo?.tier}
            eloTierColor={bottomEloInfo?.tierColor}
            flair={bottomCardCosmetics?.flair}
            side='left'
            botTier={botTierFor(bottomId)}
          />

          <div className='flex flex-wrap gap-2'>
            {match.status === 'waiting' && match.player1Id === data.userId && (
              <ArcadeButton tone='default' size='sm' onClick={() => action('cancel', 'cancel')} disabled={!!actionPending}>
                Cancel match
              </ArcadeButton>
            )}
            {match.status === 'active' && myColor && (
              <>
                {drawOfferedByOpponent ? (
                  <>
                    <ArcadeButton tone='success' size='sm' onClick={() => action('draw-accept', 'draw-accept')} disabled={!!actionPending}>
                      Accept draw
                    </ArcadeButton>
                    <ArcadeButton tone='default' size='sm' onClick={() => action('draw-decline', 'draw-decline')} disabled={!!actionPending}>
                      Decline
                    </ArcadeButton>
                  </>
                ) : (
                  <ArcadeButton
                    tone='default'
                    size='sm'
                    onClick={() => action('draw-offer', 'draw-offer')}
                    disabled={!!actionPending || !!drawOfferedByMe || Boolean(opponentIsBot)}
                  >
                    <HandshakeIcon size={14} />
                    {drawOfferedByMe ? 'Draw offered' : 'Offer draw'}
                  </ArcadeButton>
                )}
                <ArcadeButton
                  tone='danger'
                  size='sm'
                  onClick={() => { if (confirm('Resign this match?')) action('resign', 'resign'); }}
                  disabled={!!actionPending}
                >
                  <Flag size={14} />
                  Resign
                </ArcadeButton>
              </>
            )}
          </div>
          {error && <div className='arcade-card-inset px-3 py-2 text-sm text-danger-text'>{error}</div>}
        </div>

        {/* Side panel */}
        <div className='flex flex-col gap-4'>
          {match.status === 'waiting' && (
            <div className='arcade-card p-4 text-sm'>
              <div className='mb-1 flex items-center gap-2 text-faint'>
                <Users size={14} />
                Waiting for opponent…
              </div>
              <div className='text-xs text-faint'>Share the lobby link or wait for someone to join.</div>
            </div>
          )}
          <div className='arcade-card p-4 text-sm'>
            <div className='arcade-kicker mb-2 text-xs text-faint'>How to play</div>
            <ul className='space-y-1.5 text-xs text-body'>
              <li>Move diagonally forward one square. Kings move both directions.</li>
              <li><span className='font-semibold text-strong'>Captures are mandatory</span> — if you can jump, you must.</li>
              <li>Multi-jumps chain in one turn: click each landing square.</li>
              <li>Reach the far row to crown a king.</li>
              <li>No legal move left? You lose.</li>
            </ul>
          </div>
        </div>
      </div>
    </GamesShell>
  );
}

function eloDeltaFor(eloChange: MatchResponse['eloChange'], userId: string | null) {
  if (!eloChange || !userId) return null;
  if (eloChange.playerA.id === userId) return { ...eloChange.playerA };
  if (eloChange.playerB.id === userId) return { ...eloChange.playerB };
  return null;
}
