'use client';

import { renameGameNamesInText, renamedPath } from '@/features/arcade/lib/game-renames';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Copy,
  Crosshair,
  Eye,
  Flag,
  RotateCw,
  Shuffle,
  Ship,
  Trash2,
  Users,
} from 'lucide-react';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import {
  FLEET,
  SHIP_SIZES,
  SHIP_LABELS,
  shipCellsFromStart,
  isFleetLegal,
  accuracyOf,
  type PublicMatch,
  type Orientation,
  type ShipType,
  type ShipPlacement,
} from '@/features/arcade/lib/battleship';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { FiringGrid, FleetGrid, PlacementGrid } from '../_board';
import { PostgameOverlay } from '../_postgame-overlay';
import { BattleshipPlayerCard } from '../_player-card';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { playMoveSound } from '../_sounds';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type MatchResponse = {
  match: PublicMatch;
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

// ---------------------------------------------------------------------------
// Client-side random fleet (mirrors the server's randomFleet for the "Random"
// button — the SERVER still re-validates whatever we submit).
// ---------------------------------------------------------------------------
function randomFleetLocal(): Record<ShipType, number[]> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const occupied = new Set<number>();
    const out = {} as Record<ShipType, number[]>;
    let ok = true;
    for (const ship of FLEET) {
      let placed: number[] | null = null;
      for (let t = 0; t < 100 && !placed; t++) {
        const orientation: Orientation = Math.random() < 0.5 ? 'h' : 'v';
        const start = Math.floor(Math.random() * 100);
        const cells = shipCellsFromStart(start, ship.size, orientation);
        if (!cells || cells.some((c) => occupied.has(c))) continue;
        placed = cells;
      }
      if (!placed) { ok = false; break; }
      for (const c of placed) occupied.add(c);
      out[ship.id] = placed;
    }
    if (ok) return out;
  }
  // extremely unlikely; return empty
  return {} as Record<ShipType, number[]>;
}

export default function BattleshipMatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = (params?.id as string) ?? '';

  const [data, setData] = useState<MatchResponse | null>(null);
  const [accountXp, setAccountXp] = useState<AccountXpReward | null>(null);
  const [runResult, setRunResult] = useState<ArcadeRunResultSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionPending, setActionPending] = useState<null | 'resign' | 'cancel' | 'place'>(null);
  const [opponentElo, setOpponentElo] = useState<EloInfo | null>(null);
  const [myElo, setMyElo] = useState<EloInfo | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Placement state.
  const [placed, setPlaced] = useState<Partial<Record<ShipType, number[]>>>({});
  const [selectedShip, setSelectedShip] = useState<ShipType>('carrier');
  const [orientation, setOrientation] = useState<Orientation>('h');
  const [hoverCell, setHoverCell] = useState<number | null>(null);

  const loadEpochRef = useRef(0);
  const myShotsLenRef = useRef(0);
  const incomingLenRef = useRef(0);
  const gameEndRef = useRef<string | null>(null);
  const soundInitRef = useRef(false);

  const load = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    try {
      const res = await fetch(`/api/games/battleship/match/${matchId}`, { cache: 'no-store' });
      if (epoch !== loadEpochRef.current) return;
      const payload = await res.json();
      if (payload?.accountXp) setAccountXp(payload.accountXp);
      if (payload?.runResult) setRunResult(payload.runResult);
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

  useEffect(() => { if (matchId) void load(); }, [matchId, load]);

  // Reset placement scratch + xp burst when switching matches.
  useEffect(() => {
    setPlaced({});
    setSelectedShip('carrier');
    setOrientation('h');
    setAccountXp(null);
    setRunResult(null);
    soundInitRef.current = false;
  }, [matchId]);

  // Live updates via SSE seam + polling backstop.
  const matchStatus = data?.match?.status;
  const matchPhase = data?.match?.phase;
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeLive(['battleshipMatch'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void load();
    });
    const isFinished = matchStatus === 'completed' || matchStatus === 'forfeited';
    const pollMs = isFinished ? 60_000 : matchPhase === 'placement' ? 5_000 : 4_000;
    const stopPolling = startVisiblePolling(load, pollMs);
    return () => { unsub(); stopPolling(); };
  }, [matchId, load, matchStatus, matchPhase]);

  // Elo info for both players.
  useEffect(() => {
    let cancelled = false;
    const loadElo = async (userId: string | null | undefined, setter: (v: EloInfo | null) => void) => {
      if (!userId || userId.startsWith('bot:')) { setter(null); return; }
      try {
        const res = await fetch(`/api/games/battleship/elo-leaderboard?userId=${userId}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        if (payload.player) setter({ rating: payload.player.eloRating, tier: payload.player.tier, tierColor: payload.player.tierColor });
        else setter(null);
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
    [match?.player1Id, match?.player2Id].filter((id): id is string => !!id && !id.startsWith('bot:')),
  );

  // Sound reactions to shot streams.
  useEffect(() => {
    if (!match) return;
    if (!soundInitRef.current) {
      soundInitRef.current = true;
      myShotsLenRef.current = match.myShots.length;
      incomingLenRef.current = match.incomingShots.length;
      if (match.status === 'completed' || match.status === 'forfeited') gameEndRef.current = match.id;
      return;
    }
    if (match.myShots.length > myShotsLenRef.current) {
      myShotsLenRef.current = match.myShots.length;
      const last = match.myShots[match.myShots.length - 1];
      playMoveSound(last.outcome === 'sunk' ? 'sunk' : last.outcome === 'hit' ? 'hit' : 'miss');
    }
    if (match.incomingShots.length > incomingLenRef.current) {
      incomingLenRef.current = match.incomingShots.length;
      const last = match.incomingShots[match.incomingShots.length - 1];
      playMoveSound(last.outcome === 'sunk' ? 'sunk' : last.outcome === 'hit' ? 'hit' : 'miss');
      if (match.status === 'active' && match.currentTurn === data?.userId) {
        window.setTimeout(() => playMoveSound('turn'), 260);
      }
    }
    const isOver = match.status === 'completed' || match.status === 'forfeited';
    if (isOver && gameEndRef.current !== match.id) {
      gameEndRef.current = match.id;
      const iLost = !data?.isSpectator && match.winnerId != null && match.winnerId !== data?.userId;
      playMoveSound(iLost ? 'lose' : 'win');
    }
  }, [match, data?.userId, data?.isSpectator]);

  // --- Placement helpers ---
  const placedCells = useMemo(() => {
    const set = new Set<number>();
    for (const cells of Object.values(placed)) for (const c of cells ?? []) set.add(c);
    return set;
  }, [placed]);

  const ghostCells = useMemo(() => {
    if (hoverCell === null) return null;
    return shipCellsFromStart(hoverCell, SHIP_SIZES[selectedShip], orientation);
  }, [hoverCell, selectedShip, orientation]);

  const ghostValid = useMemo(() => {
    if (!ghostCells) return false;
    // valid if in-bounds (shipCellsFromStart returns null otherwise) and no
    // overlap with OTHER placed ships.
    for (const [id, cells] of Object.entries(placed)) {
      if (id === selectedShip) continue;
      for (const c of cells ?? []) if (ghostCells.includes(c)) return false;
    }
    return true;
  }, [ghostCells, placed, selectedShip]);

  const placeSelected = useCallback((cell: number) => {
    const cells = shipCellsFromStart(cell, SHIP_SIZES[selectedShip], orientation);
    if (!cells) return;
    for (const [id, existing] of Object.entries(placed)) {
      if (id === selectedShip) continue;
      for (const c of existing ?? []) if (cells.includes(c)) return; // overlap
    }
    setPlaced((prev) => ({ ...prev, [selectedShip]: cells }));
    playMoveSound('place');
    // Advance to the next unplaced ship.
    const next = FLEET.find((s) => s.id !== selectedShip && !placed[s.id]);
    if (next) setSelectedShip(next.id);
  }, [selectedShip, orientation, placed]);

  const randomize = useCallback(() => {
    const fleet = randomFleetLocal();
    setPlaced(fleet);
    playMoveSound('place');
  }, []);

  const resetPlacement = useCallback(() => {
    setPlaced({});
    setSelectedShip('carrier');
  }, []);

  const fleetReady = useMemo(() => {
    if (FLEET.some((s) => !placed[s.id])) return false;
    const ships: ShipPlacement[] = FLEET.map((s) => ({ id: s.id, cells: placed[s.id] ?? [] }));
    return isFleetLegal(ships);
  }, [placed]);

  const submitPlacement = useCallback(async () => {
    if (!matchId || actionPending || !fleetReady) return;
    setActionPending('place');
    try {
      const ships: ShipPlacement[] = FLEET.map((s) => ({ id: s.id, cells: placed[s.id] ?? [] }));
      const res = await fetch(`/api/games/battleship/match/${matchId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ships }),
      });
      const payload = await res.json();
      if (!res.ok) { setError(payload.error || 'Placement rejected.'); return; }
      setData((prev) => (prev ? { ...prev, match: payload.match } : prev));
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  }, [matchId, actionPending, fleetReady, placed, load]);

  const fire = useCallback(async (cell: number) => {
    if (!matchId || submitting) return;
    setSubmitting(true);
    playMoveSound('fire');
    try {
      const res = await fetch(`/api/games/battleship/match/${matchId}/shot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cell }),
      });
      const payload = await res.json();
      if (!res.ok) { setError(payload.error || 'Shot rejected.'); void load(); return; }
      setData((prev) => (prev ? { ...prev, match: payload.match } : prev));
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [matchId, submitting, load]);

  const action = useCallback(async (endpoint: string, act: 'resign' | 'cancel') => {
    if (!matchId || actionPending) return;
    setActionPending(act);
    try {
      const res = await fetch(`/api/games/battleship/match/${matchId}/${endpoint}`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Action failed.');
      }
      if (endpoint === 'cancel' && res.ok) { router.push('/battleship'); return; }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  }, [matchId, actionPending, load, router]);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${renamedPath('/battleship')}?join=${matchId}`);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch {
      setError('Clipboard access is unavailable.');
    }
  }, [matchId]);

  if (error && !data) {
    return (
      <GamesShell headerProps={{ icon: <Ship size={18} />, title: renameGameNamesInText('Battleship match'), subtitle: 'Error' }}>
        <div className="arcade-card-inset p-6 text-sm text-danger-text">{error}</div>
      </GamesShell>
    );
  }
  if (!data || !match) {
    return (
      <GamesShell headerProps={{ icon: <Ship size={18} />, title: renameGameNamesInText('Battleship match'), subtitle: 'Loading…' }}>
        <div className="flex items-center justify-center py-20">
          <ArcadeLoading label='Loading the match.' />
        </div>
      </GamesShell>
    );
  }

  const isGameOver = match.status === 'completed' || match.status === 'forfeited';
  const isPlayer = !data.isSpectator && (match.player1Id === data.userId || match.player2Id === data.userId);
  const opponentId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
  const myReady = match.viewerRole === 'player1' ? match.player1Ready : match.viewerRole === 'player2' ? match.player2Ready : false;
  const oppReady = match.viewerRole === 'player1' ? match.player2Ready : match.viewerRole === 'player2' ? match.player1Ready : false;
  const isMyTurn = match.status === 'active' && match.phase === 'active' && match.currentTurn === data.userId;
  const lastCell = match.lastMove !== null ? Number(match.lastMove) : null;

  const isPlacementPhase = match.status === 'active' && match.phase === 'placement';
  const showPlacementUI = isPlayer && isPlacementPhase && !myReady;

  // Stats per perspective.
  const meStats = { fleetRemaining: match.myFleetRemaining, accuracy: accuracyOf(match.myShots) };
  const oppStats = { fleetRemaining: match.oppFleetRemaining, accuracy: accuracyOf(match.incomingShots) };

  // Card layout: opponent on top, me on bottom; spectator sees player1 / player2.
  const topId = data.isSpectator ? match.player1Id : opponentId;
  const bottomId = data.isSpectator ? match.player2Id : data.userId;
  const nameForId = (id: string | null) => {
    if (!id) return 'Player';
    return id === match.player1Id ? match.player1Name : (match.player2Name ?? 'Player');
  };
  const botTierForId = (id: string | null): 'easy' | 'medium' | 'hard' | null => {
    if (!id || !id.startsWith('bot:')) return null;
    const tier = id.replace('bot:battleship-', '').replace('bot:', '');
    return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
  };
  const topIsMePerspective = data.isSpectator; // spectator: top=player1=me-fields
  const topStats = topIsMePerspective ? meStats : oppStats;
  const bottomStats = topIsMePerspective ? oppStats : meStats;
  const topEloInfo = topId === data.userId ? myElo : opponentElo;
  const bottomEloInfo = bottomId === data.userId ? myElo : opponentElo;
  const topReady = topId === match.player1Id ? match.player1Ready : match.player2Ready;
  const bottomReady = bottomId === match.player1Id ? match.player1Ready : match.player2Ready;
  const topActive = match.phase === 'active' && match.status === 'active' && match.currentTurn === topId;
  const bottomActive = match.phase === 'active' && match.status === 'active' && match.currentTurn === bottomId;

  return (
    <GamesShell headerProps={{ icon: <Ship size={18} />, title: renameGameNamesInText('Battleship'), subtitle: `${match.status}` }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/battleship" className="inline-flex items-center gap-1.5 text-sm text-faint hover:text-strong">
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

      {/* Waiting for opponent */}
      {match.status === 'waiting' && (
        <div className="mx-auto max-w-md">
          <div className="arcade-card p-5 text-sm">
            <div className="mb-1 flex items-center gap-2 text-faint">
              <Users size={14} /> Waiting for an opponent…
            </div>
            <div className="mb-3 text-xs text-faint">Share this link — whoever opens it joins your match.</div>
            <ArcadeButton tone="default" size="sm" className="mb-2 w-full" onClick={copyShareLink}>
              {shareCopied ? <Check size={14} /> : <Copy size={14} />}
              {shareCopied ? 'Copied' : 'Copy invite link'}
            </ArcadeButton>
            {match.player1Id === data.userId && (
              <ArcadeButton tone="ghost" size="sm" className="w-full" onClick={() => action('cancel', 'cancel')} disabled={!!actionPending}>
                Cancel match
              </ArcadeButton>
            )}
          </div>
        </div>
      )}

      {/* Placement phase — your fleet (group centered as a unit) */}
      {showPlacementUI && (
        <div className="mx-auto grid w-full max-w-[760px] justify-center gap-4 lg:grid-cols-[minmax(0,460px)_260px] lg:items-start">
          <div className="flex flex-col items-center gap-3">
            <div className="arcade-card-inset w-full px-3 py-2 text-center text-sm text-body" style={{ maxWidth: 'min(92vw, 460px)' }}>
              Place your fleet. Click a cell to drop the selected ship; rotate to change heading.
            </div>
            <PlacementGrid
              placedCells={placedCells}
              ghostCells={ghostCells}
              ghostValid={ghostValid}
              onCellEnter={setHoverCell}
              onCellLeave={() => setHoverCell(null)}
              onCellClick={placeSelected}
            />
            <div className="flex w-full flex-wrap items-center justify-center gap-2" style={{ maxWidth: 'min(92vw, 460px)' }}>
              <ArcadeButton tone="default" size="sm" onClick={() => setOrientation((o) => (o === 'h' ? 'v' : 'h'))}>
                <RotateCw size={14} /> {orientation === 'h' ? 'Horizontal' : 'Vertical'}
              </ArcadeButton>
              <ArcadeButton tone="default" size="sm" onClick={randomize}>
                <Shuffle size={14} /> Random
              </ArcadeButton>
              <ArcadeButton tone="ghost" size="sm" onClick={resetPlacement}>
                <Trash2 size={14} /> Reset
              </ArcadeButton>
              <ArcadeButton tone="primary" size="sm" onClick={submitPlacement} disabled={!fleetReady || actionPending === 'place'}>
                {actionPending === 'place' ? <ArcadeLoadingDots /> : <Check size={14} />}
                Ready up
              </ArcadeButton>
            </div>
            {error && (
              <div className="arcade-card-inset w-full px-3 py-2 text-sm text-danger-text" style={{ maxWidth: 'min(92vw, 460px)' }}>{error}</div>
            )}
          </div>

          {/* Fleet roster */}
          <div className="flex flex-col gap-3">
            <div className="arcade-card p-3">
              <p className="arcade-kicker mb-2 text-xs text-faint">Fleet</p>
              <ul className="space-y-1.5">
                {FLEET.map((s) => {
                  const isPlaced = !!placed[s.id];
                  const isSelected = selectedShip === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedShip(s.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-key border-2 px-3 py-1.5 text-sm transition-[filter] duration-[140ms] hover:brightness-107 ${
                          isSelected ? 'border-ink bg-key-face text-key-face-on shadow-chip' : 'border-ink bg-raised text-body shadow-chip'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block rounded-[2px]"
                            style={{
                              width: `${s.size * 8}px`,
                              height: '10px',
                              background: 'linear-gradient(180deg, #828d97, #59636e 60%, #2a3138)',
                            }}
                          />
                          {SHIP_LABELS[s.id]}
                        </span>
                        <span className="text-xs text-faint">{isPlaced ? <Check size={13} className="text-tickets-text" /> : `${s.size}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="arcade-card-inset p-3 text-xs text-faint">
              {oppReady ? 'Your opponent is ready and waiting.' : 'Your opponent is still placing their fleet.'}
            </div>
          </div>
        </div>
      )}

      {/* Placed, waiting for opponent to place */}
      {isPlayer && isPlacementPhase && myReady && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3">
          <div className="arcade-card-inset w-full px-3 py-2 text-center text-sm text-body">
            Fleet locked in. {oppReady ? 'Starting the battle…' : 'Waiting for your opponent to place their fleet.'}
          </div>
          <FleetGrid board={match.myBoard} incomingShots={match.incomingShots} sunkShips={match.mySunkShips} />
        </div>
      )}

      {/* Battle phase (and post-game reveal) */}
      {(match.status === 'active' && match.phase === 'active') || isGameOver ? (
        <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-4">
          {/* Turn banner — who fires next */}
          {!isGameOver && (
            <div
              className={`flex w-full max-w-[480px] items-center justify-center gap-2 rounded-key border-2 border-ink px-4 py-2 text-sm font-semibold shadow-chip ${
                data.isSpectator
                  ? 'bg-raised text-body'
                  : isMyTurn
                    ? 'bg-key-face text-key-face-on'
                    : 'bg-raised text-faint'
              }`}
            >
              {data.isSpectator ? (
                <>
                  <Crosshair size={15} />
                  {`${nameForId(match.currentTurn)} to fire`}
                </>
              ) : isMyTurn ? (
                <>
                  <Crosshair size={15} /> Your shot — fire at the enemy
                </>
              ) : (
                <>
                  <ArcadeLoadingDots /> Waiting for opponent.
                </>
              )}
            </div>
          )}

          {/* Opponent / top card */}
          <div className="w-full max-w-[480px]">
            <BattleshipPlayerCard
              name={nameForId(topId)}
              avatarUrl={topId && !topId.startsWith('bot:') ? playerCards[topId]?.avatarUrl : undefined}
              isActive={topActive}
              sideLabel={data.isSpectator ? 'Player 1' : 'Opponent'}
              fleetRemaining={topStats.fleetRemaining}
              accuracy={topStats.accuracy}
              eloRating={topEloInfo?.rating}
              eloTier={topEloInfo?.tier}
              eloTierColor={topEloInfo?.tierColor}
              flair={topId && !topId.startsWith('bot:') ? playerCards[topId]?.flair : null}
              botTier={botTierForId(topId)}
              placementPhase={false}
              ready={topReady}
            />
          </div>

          {/* Main battle row: large enemy board + secondary fleet/status column */}
          <div className="flex w-full flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
            {/* PRIMARY — Enemy waters (fire here). At game over this is the revealed enemy fleet. */}
            <div className="flex w-full max-w-[480px] flex-col items-center gap-1.5 lg:w-[480px]">
              <p className="text-center text-[11px] uppercase tracking-wider text-faint">
                {data.isSpectator ? `${nameForId(match.player1Id)}'s shots` : isGameOver ? 'Enemy fleet' : 'Enemy waters'}
              </p>
              {isGameOver && !data.isSpectator ? (
                <FleetGrid
                  board={match.revealedBoards?.[match.viewerRole === 'player1' ? 'player2Board' : 'player1Board'] ?? null}
                  incomingShots={match.myShots}
                  sunkShips={match.oppSunkShips}
                  maxWidth="min(92vw, 480px)"
                />
              ) : (
                <FiringGrid
                  shots={match.myShots}
                  sunkShips={match.oppSunkShips}
                  interactive={isMyTurn && !submitting}
                  onFire={fire}
                  lastCell={!data.isSpectator ? lastCell : null}
                  dim={isGameOver}
                  maxWidth="min(92vw, 480px)"
                />
              )}
            </div>

            {/* SECONDARY — your smaller fleet board + battle status + sunk list */}
            <div className="flex w-full max-w-[320px] flex-col gap-3 lg:w-[300px]">
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-center text-[11px] uppercase tracking-wider text-faint">
                  {data.isSpectator ? `${nameForId(match.player2Id)}'s shots` : 'Your fleet'}
                </p>
                {data.isSpectator && !isGameOver ? (
                  <FiringGrid
                    shots={match.incomingShots}
                    sunkShips={match.mySunkShips}
                    interactive={false}
                    onFire={() => {}}
                    lastCell={null}
                    maxWidth="min(80vw, 300px)"
                  />
                ) : data.isSpectator && isGameOver ? (
                  <FleetGrid
                    board={match.revealedBoards?.player2Board ?? null}
                    incomingShots={match.incomingShots}
                    sunkShips={match.mySunkShips}
                    maxWidth="min(80vw, 300px)"
                  />
                ) : (
                  <FleetGrid
                    board={match.myBoard ?? match.revealedBoards?.[match.viewerRole === 'player1' ? 'player1Board' : 'player2Board'] ?? null}
                    incomingShots={match.incomingShots}
                    sunkShips={match.mySunkShips}
                    maxWidth="min(80vw, 300px)"
                  />
                )}
              </div>

              <div className="arcade-card p-3">
                <p className="arcade-kicker mb-2 text-xs text-faint">Battle status</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-faint">Enemy cells left</span>
                    <span className="arcade-num font-semibold text-danger-text">{match.oppFleetRemaining}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-faint">Your cells left</span>
                    <span className="arcade-num font-semibold text-info-text">{match.myFleetRemaining}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-faint">Your shots</span>
                    <span className="arcade-num">{match.myShots.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-faint">Your accuracy</span>
                    <span className="arcade-num">{accuracyOf(match.myShots)}%</span>
                  </div>
                </div>
              </div>

              {match.oppSunkShips.length > 0 && (
                <div className="arcade-card p-3">
                  <p className="arcade-kicker mb-2 text-xs text-faint">Enemy ships sunk</p>
                  <ul className="space-y-1 text-sm text-body">
                    {match.oppSunkShips.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <Check size={13} className="text-tickets-text" /> {SHIP_LABELS[s.id]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Bottom card (you / player2) */}
          <div className="w-full max-w-[480px]">
            <BattleshipPlayerCard
              name={nameForId(bottomId)}
              avatarUrl={bottomId && !bottomId.startsWith('bot:') ? playerCards[bottomId]?.avatarUrl : undefined}
              isActive={bottomActive}
              sideLabel={data.isSpectator ? 'Player 2' : 'You'}
              fleetRemaining={bottomStats.fleetRemaining}
              accuracy={bottomStats.accuracy}
              eloRating={bottomEloInfo?.rating}
              eloTier={bottomEloInfo?.tier}
              eloTierColor={bottomEloInfo?.tierColor}
              flair={bottomId && !bottomId.startsWith('bot:') ? playerCards[bottomId]?.flair : null}
              botTier={botTierForId(bottomId)}
              placementPhase={false}
              ready={bottomReady}
            />
          </div>

          {/* Actions */}
          {match.status === 'active' && isPlayer && (
            <div className="flex w-full max-w-[480px] flex-wrap justify-center gap-2">
              <ArcadeButton
                tone="danger"
                size="sm"
                onClick={() => { if (confirm('Resign this match?')) action('resign', 'resign'); }}
                disabled={!!actionPending}
              >
                <Flag size={14} /> Resign
              </ArcadeButton>
            </div>
          )}
          {error && (
            <div className="arcade-card-inset w-full max-w-[480px] px-3 py-2 text-sm text-danger-text">{error}</div>
          )}

          {isGameOver && (
            <PostgameOverlay
              match={match}
              isMe={data.userId}
              isSpectator={data.isSpectator}
              myElo={eloDeltaFor(data.eloChange, data.userId)}
              opponentElo={eloDeltaFor(data.eloChange, opponentId)}
              accountXp={accountXp}
              runResult={runResult}
              onLobby={() => router.push('/battleship')}
              canRematch={Boolean(isPlayer && match.player2Id && !match.player2Id.startsWith('bot:'))}
              onRematch={async () => {
                try {
                  const res = await fetch('/api/games/battleship/match', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  });
                  const payload = await res.json();
                  if (!res.ok) { setError(payload.error || 'Failed to start rematch.'); return; }
                  router.push(`/battleship/${payload.match.id}`);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          )}
        </div>
      ) : null}
    </GamesShell>
  );
}

function eloDeltaFor(eloChange: MatchResponse['eloChange'], userId: string | null) {
  if (!eloChange || !userId) return null;
  if (eloChange.playerA.id === userId) return { ...eloChange.playerA };
  if (eloChange.playerB.id === userId) return { ...eloChange.playerB };
  return null;
}
