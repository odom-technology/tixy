'use client';

import { useState, useEffect, useCallback } from 'react';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import {
  Trophy,
  Users,
  Plus,
  Play,
  UserPlus,
  UserMinus,
  Shield,
  Crown,
  ChevronDown,
  ChevronUp,
  History,
  Eye,
  Trash2,
} from 'lucide-react';
import type {
  Tournament,
  TournamentParticipant,
  TournamentMatch,
  BracketData,
} from '@/server/arcade/pool-tournament';
import { TournamentBracket } from '@/features/arcade/components/tournaments/bracket';
import { TournamentCreateModal } from './_tournament-create-modal';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type TournamentDetailResponse = {
  tournament: Tournament;
  participants: TournamentParticipant[];
  bracket: BracketData | null;
  activePoolMatches: Record<string, string | null>;
  isAdmin: boolean;
  isRegistered: boolean;
  userId: string;
  wagerPools?: Record<
    string,
    { player1Total: number; player2Total: number; totalPool: number }
  > | null;
  userWagers?: Array<{
    id: string;
    tournamentMatchId: string;
    backedPlayerId: string;
    amount: number;
    payout: number | null;
    status: string;
  }>;
};

export function TournamentSection() {
  const [, setTournaments] = useState<Tournament[]>([]);
  const [detail, setDetail] = useState<TournamentDetailResponse | null>(null);
  const [listIsAdmin, setListIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<TournamentMatch | null>(
    null,
  );
  const [overrideWinnerId, setOverrideWinnerId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadTournaments = useCallback(async () => {
    try {
      const res = await fetch('/api/games/8-ball/tournament', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setTournaments(data.tournaments ?? []);
      if (typeof data.isAdmin === 'boolean') setListIsAdmin(data.isAdmin);

      // Auto-load the most relevant tournament (registration or active)
      const relevant = (data.tournaments as Tournament[])?.find(
        (t) => t.status === 'registration' || t.status === 'active',
      );
      if (relevant) {
        await loadTournamentDetail(relevant.id);
      } else {
        setDetail(null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTournamentDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/games/8-ball/tournament/${id}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data: TournamentDetailResponse = await res.json();
      setDetail(data);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    void loadTournaments();
    // SSE on `poolTournament` drives real-time updates; poll is only a
    // backstop so bump the interval to cut repeat refetches.
    return startVisiblePolling(loadTournaments, 60_000);
  }, [loadTournaments]);

  // Listen for SSE tournament updates (registration, start, etc.)
  useEffect(() => {
    const unsubscribe = subscribeLive(['poolTournament'], () => {
      void loadTournaments();
    });
    return unsubscribe;
  }, [loadTournaments]);

  const handleRegister = async (action: 'register' | 'unregister') => {
    if (!detail) return;
    setRegistering(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/8-ball/tournament/${detail.tournament.id}/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed.');
      await loadTournamentDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  };

  const handleStart = async () => {
    if (
      !detail ||
      !confirm(
        'Start the tournament? Registration will close and matches will begin.',
      )
    )
      return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/8-ball/tournament/${detail.tournament.id}/start`,
        { method: 'POST' },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to start.');
      await loadTournamentDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const handleCancelTournament = async () => {
    if (!detail) return;
    const status = detail.tournament.status;
    const message =
      status === 'active'
        ? 'Cancel this tournament? All in-progress matches will be abandoned and wagers refunded. This cannot be undone.'
        : 'Delete this tournament? All registrations will be removed. This cannot be undone.';
    if (!confirm(message)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/8-ball/tournament/${detail.tournament.id}?action=delete`,
        { method: 'DELETE' },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to cancel.');
      await loadTournaments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleOverrideSubmit = async () => {
    if (
      !detail ||
      !overrideTarget ||
      !overrideWinnerId ||
      !overrideReason.trim()
    )
      return;
    setOverriding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/8-ball/tournament/${detail.tournament.id}/override`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentMatchId: overrideTarget.id,
            winnerId: overrideWinnerId,
            reason: overrideReason.trim(),
          }),
        },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Override failed.');
      setOverrideTarget(null);
      setOverrideWinnerId('');
      setOverrideReason('');
      await loadTournamentDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOverriding(false);
    }
  };

  const handleOverrideOpen = (match: TournamentMatch) => {
    setOverrideTarget(match);
    setOverrideWinnerId('');
    setOverrideReason('');
  };

  if (loading) return null;

  const activeTournament = detail?.tournament;
  const isAdmin = detail?.isAdmin ?? listIsAdmin;
  const hasActiveTournament =
    activeTournament && activeTournament.status !== 'completed';
  const hasAnything = hasActiveTournament || isAdmin;

  // Nothing to render at all
  if (!hasAnything) return null;

  return (
    <>
      {/* Admin: Create Tournament Button */}
      {isAdmin && !hasActiveTournament && (
        <section className='flex justify-center'>
          <ArcadeButton
            tone='tickets'
            size='sm'
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} />
            Create tournament
          </ArcadeButton>
        </section>
      )}

      {/* Active/Registration Tournament */}
      {hasActiveTournament && detail && (
        <section className='arcade-card p-4 sm:p-5'>
          {/* Header */}
          <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
            <div className='flex items-center gap-2'>
              <Trophy size={18} className='text-tickets-text' />
              <div>
                <h2 className='text-base font-semibold text-strong'>
                  {activeTournament.name}
                </h2>
                <p className='text-xs text-faint'>
                  {activeTournament.format.toUpperCase()} &middot;{' '}
                  {activeTournament.hasLosersBracket
                    ? 'Double elimination'
                    : 'Single elimination'}{' '}
                  &middot; {activeTournament.participantCount} player
                  {activeTournament.participantCount !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              {activeTournament.status === 'registration' && (
                <span className='rounded-full border border-ink bg-prize px-3 py-1 text-[11px] font-bold text-prize-on shadow-chip'>
                  Registration open
                </span>
              )}
              {activeTournament.status === 'active' && (
                <span className='rounded-full border border-soft bg-raised px-3 py-1 text-[11px] font-medium text-body shadow-chip'>
                  In progress
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className='mb-3 rounded-well border border-soft bg-well px-3 py-2 text-xs text-danger-text'>
              {error}
            </div>
          )}

          {/* Registration Phase */}
          {activeTournament.status === 'registration' && (
            <div className='space-y-3'>
              {/* Participant List */}
              <div className='rounded-well border border-soft bg-well p-3'>
                <h3 className='mb-2 flex items-center gap-1.5 text-xs font-semibold text-faint'>
                  <Users size={12} />
                  Registered players
                </h3>
                {detail.participants.length === 0 ? (
                  <p className='text-xs text-faint'>
                    No players yet.
                  </p>
                ) : (
                  <div className='space-y-1'>
                    {detail.participants.map((p) => (
                      <div
                        key={p.userId}
                        className='flex items-center justify-between rounded-tag px-2 py-1.5 text-xs'
                      >
                        <span className='truncate font-medium text-strong'>
                          {p.userName}
                        </span>
                        <span className='arcade-num shrink-0 text-faint'>
                          {p.eloAtRegistration} Elo
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Register / Unregister */}
              <div className='flex flex-wrap gap-2'>
                {detail.isRegistered ? (
                  <ArcadeButton
                    tone='default'
                    size='sm'
                    onClick={() => void handleRegister('unregister')}
                    disabled={registering}
                  >
                    {registering ? (
                      <ArcadeLoadingDots />
                    ) : (
                      <UserMinus size={14} />
                    )}
                    Leave
                  </ArcadeButton>
                ) : (
                  <ArcadeButton
                    tone='primary'
                    size='sm'
                    onClick={() => void handleRegister('register')}
                    disabled={registering}
                  >
                    {registering ? (
                      <ArcadeLoadingDots />
                    ) : (
                      <UserPlus size={14} />
                    )}
                    Register
                  </ArcadeButton>
                )}

                {/* Admin: Start Tournament */}
                {isAdmin && detail.participants.length >= 2 && (
                  <ArcadeButton
                    tone='success'
                    size='sm'
                    onClick={() => void handleStart()}
                    disabled={starting}
                  >
                    {starting ? (
                      <ArcadeLoadingDots />
                    ) : (
                      <Play size={14} />
                    )}
                    Start
                  </ArcadeButton>
                )}

                {/* Admin: Cancel Tournament */}
                {isAdmin && (
                  <ArcadeButton
                    tone='danger'
                    size='sm'
                    onClick={() => void handleCancelTournament()}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ArcadeLoadingDots />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Cancel
                  </ArcadeButton>
                )}
              </div>
            </div>
          )}

          {/* Active Phase — Bracket */}
          {activeTournament.status === 'active' && detail.bracket && (
            <div className='space-y-3'>
              {/* Participants summary */}
              <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
                <Users size={12} />
                {detail.participants.length} players &middot;{' '}
                {
                  detail.participants.filter(
                    (p) => p.eliminatedInRound === null,
                  ).length
                }{' '}
                remaining
              </div>

              {/* Start Round button for betting-enabled tournaments */}
              {detail.tournament.bettingEnabled &&
                isAdmin &&
                detail.tournament.status === 'active' &&
                detail.bracket &&
                (() => {
                  // Find the lowest round with pending matches that have both players assigned
                  const allBracketMatches = [
                    ...detail.bracket.winners.flat(),
                    ...detail.bracket.losers.flat(),
                    ...detail.bracket.grandFinal,
                  ];
                  const pendingReadyRounds = allBracketMatches
                    .filter(
                      (m) =>
                        m.status === 'pending' &&
                        m.player1Id &&
                        m.player2Id &&
                        !m.isBye,
                    )
                    .map((m) => m.round);
                  const nextRound =
                    pendingReadyRounds.length > 0
                      ? Math.min(...pendingReadyRounds)
                      : null;
                  if (!nextRound) return null;
                  return (
                    <div className='mb-3 flex items-center gap-3'>
                      <ArcadeButton
                        tone='tickets'
                        size='sm'
                        onClick={async () => {
                          try {
                            const res = await fetch(
                              `/api/games/8-ball/tournament/${detail.tournament.id}/start-round`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ round: nextRound }),
                              },
                            );
                            const data = await res.json();
                            if (!res.ok)
                              throw new Error(data.error || 'Failed');
                            await loadTournamentDetail(detail.tournament.id);
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                      >
                        Start round <span className='arcade-num'>{nextRound}</span>
                      </ArcadeButton>
                      <span className='text-[11px] text-faint'>
                        Betting is open — start the round to close betting and
                        begin matches
                      </span>
                    </div>
                  );
                })()}

              {/* Bracket visualization */}
              <TournamentBracket
                bracket={detail.bracket}
                gameType='8-ball'
                activeMatches={detail.activePoolMatches}
                isAdmin={isAdmin}
                onOverride={handleOverrideOpen}
                wagerPools={detail.wagerPools}
                userId={detail.userId}
                tournamentId={detail.tournament.id}
                bettingEnabled={detail.tournament.bettingEnabled}
                minBet={detail.tournament.minBet}
                maxBet={detail.tournament.maxBet}
                onBetPlaced={() =>
                  void loadTournamentDetail(detail.tournament.id)
                }
              />

              {/* Admin: End / Cancel Tournament */}
              {isAdmin && (
                <div className='mt-3 flex flex-wrap justify-end gap-2'>
                  <ArcadeButton
                    tone='danger'
                    size='sm'
                    onClick={() => void handleCancelTournament()}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ArcadeLoadingDots />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Cancel tournament
                  </ArcadeButton>
                  <ArcadeButton
                    tone='tickets'
                    size='sm'
                    onClick={async () => {
                      if (
                        !confirm(
                          'End this tournament? The last match winner will be declared champion.',
                        )
                      )
                        return;
                      try {
                        const res = await fetch(
                          `/api/games/8-ball/tournament/${detail.tournament.id}`,
                          { method: 'DELETE' },
                        );
                        const data = await res.json();
                        if (!res.ok)
                          throw new Error(
                            data.error || 'Failed to end tournament.',
                          );
                        await loadTournaments();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    End tournament
                  </ArcadeButton>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Override Modal */}
      {overrideTarget && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4'>
          <div className='arcade-modal mx-4 max-w-sm p-5'>
            <h3 className='mb-3 flex items-center gap-2 text-sm font-semibold text-strong'>
              <Shield size={14} className='text-tickets-text' />
              Override match result
            </h3>
            <p className='mb-3 text-xs text-faint'>
              {overrideTarget.player1Name ?? 'P1'} vs{' '}
              {overrideTarget.player2Name ?? 'P2'}
            </p>

            <div className='space-y-3'>
              <div>
                <label className='mb-1 block text-xs font-medium text-faint'>
                  Winner
                </label>
                <div className='flex gap-2'>
                  {overrideTarget.player1Id && (
                    <button
                      type='button'
                      onClick={() =>
                        setOverrideWinnerId(overrideTarget.player1Id!)
                      }
                      className={`flex-1 rounded-key border-2 px-3 py-2 text-xs font-semibold shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 ${
                        overrideWinnerId === overrideTarget.player1Id
                          ? 'border-ink bg-key-face text-key-face-on'
                          : 'border-ink bg-raised text-body'
                      }`}
                    >
                      {overrideTarget.player1Name}
                    </button>
                  )}
                  {overrideTarget.player2Id && (
                    <button
                      type='button'
                      onClick={() =>
                        setOverrideWinnerId(overrideTarget.player2Id!)
                      }
                      className={`flex-1 rounded-key border-2 px-3 py-2 text-xs font-semibold shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 ${
                        overrideWinnerId === overrideTarget.player2Id
                          ? 'border-ink bg-key-face text-key-face-on'
                          : 'border-ink bg-raised text-body'
                      }`}
                    >
                      {overrideTarget.player2Name}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor='override-reason'
                  className='mb-1 block text-xs font-medium text-faint'
                >
                  Reason
                </label>
                <input
                  id='override-reason'
                  type='text'
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder='e.g. Player disconnected'
                  className='arcade-input w-full px-3 py-2 text-xs'
                />
              </div>

              <div className='flex gap-2'>
                <ArcadeButton
                  tone='ghost'
                  size='sm'
                  className='flex-1'
                  onClick={() => setOverrideTarget(null)}
                >
                  Cancel
                </ArcadeButton>
                <ArcadeButton
                  tone='tickets'
                  size='sm'
                  className='flex-1'
                  onClick={() => void handleOverrideSubmit()}
                  disabled={
                    overriding || !overrideWinnerId || !overrideReason.trim()
                  }
                >
                  {overriding ? (
                    <ArcadeLoadingDots />
                  ) : (
                    'Confirm'
                  )}
                </ArcadeButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <TournamentCreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void loadTournaments()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Past Tournaments — rendered separately at the bottom of the dashboard
// ---------------------------------------------------------------------------

export function PastTournamentsSection() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [viewingPastId, setViewingPastId] = useState<string | null>(null);
  const [pastDetail, setPastDetail] = useState<TournamentDetailResponse | null>(
    null,
  );
  const [pastDetailLoading, setPastDetailLoading] = useState(false);

  const loadTournaments = useCallback(async () => {
    try {
      const res = await fetch('/api/games/8-ball/tournament', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setTournaments(
        (data.tournaments as Tournament[])?.filter(
          (t) => t.status === 'completed',
        ) ?? [],
      );
      if (typeof data.isAdmin === 'boolean') setIsAdmin(data.isAdmin);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPastDetail = async (id: string) => {
    setPastDetailLoading(true);
    setViewingPastId(id);
    try {
      const res = await fetch(`/api/games/8-ball/tournament/${id}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data: TournamentDetailResponse = await res.json();
      setPastDetail(data);
    } catch {
      // silent
    } finally {
      setPastDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadTournaments();
  }, [loadTournaments]);

  useEffect(() => {
    return subscribeLive(['poolTournament'], () => {
      void loadTournaments();
    });
  }, [loadTournaments]);

  if (loading || tournaments.length === 0) return null;

  return (
    <section className='arcade-card p-4 sm:p-5'>
      <button
        type='button'
        onClick={() => {
          setShowPast(!showPast);
          if (showPast) {
            setViewingPastId(null);
            setPastDetail(null);
          }
        }}
        className='flex w-full items-center justify-between'
      >
        <h2 className='flex items-center gap-2 text-base font-semibold text-strong'>
          <History size={16} className='text-faint' />
          Past tournaments
          <span className='arcade-num text-xs font-normal text-faint'>
            ({tournaments.length})
          </span>
        </h2>
        {showPast ? (
          <ChevronUp size={16} className='text-faint' />
        ) : (
          <ChevronDown size={16} className='text-faint' />
        )}
      </button>

      {showPast && (
        <div className='mt-3 space-y-2'>
          {tournaments.map((t) => (
            <div key={t.id}>
              <button
                type='button'
                onClick={() => {
                  if (viewingPastId === t.id) {
                    setViewingPastId(null);
                    setPastDetail(null);
                  } else {
                    void loadPastDetail(t.id);
                  }
                }}
                className='flex w-full items-center justify-between rounded-well border border-soft bg-well px-4 py-3 transition hover:bg-raised'
              >
                <div className='flex items-center gap-3 text-left'>
                  <Trophy size={14} className='shrink-0 text-tickets-text' />
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium text-strong'>
                      {t.name}
                    </p>
                    <p className='text-[11px] text-faint'>
                      {t.format.toUpperCase()} &middot;{' '}
                      {t.hasLosersBracket ? 'Double elim' : 'Single elim'}{' '}
                      &middot; {t.participantCount} players
                    </p>
                  </div>
                </div>
                <div className='flex items-center gap-3'>
                  <div className='text-right'>
                    <div className='flex items-center gap-1 text-xs font-semibold text-tickets-text'>
                      <Crown size={10} />
                      {t.winnerName ?? 'N/A'}
                    </div>
                    <p className='text-[10px] text-faint'>
                      {t.completedAt
                        ? new Date(t.completedAt).toLocaleDateString()
                        : ''}
                    </p>
                  </div>
                  {viewingPastId === t.id ? (
                    <ChevronUp
                      size={14}
                      className='shrink-0 text-faint'
                    />
                  ) : (
                    <Eye size={14} className='shrink-0 text-faint' />
                  )}
                </div>
              </button>
              {isAdmin && viewingPastId === t.id && (
                <div className='mt-1 flex justify-end px-1'>
                  <ArcadeButton
                    tone='danger'
                    size='xs'
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        !confirm(
                          `Delete tournament "${t.name}"? This cannot be undone.`,
                        )
                      )
                        return;
                      try {
                        const res = await fetch(
                          `/api/games/8-ball/tournament/${t.id}?action=delete`,
                          { method: 'DELETE' },
                        );
                        const data = await res.json();
                        if (!res.ok)
                          throw new Error(data.error || 'Failed to delete.');
                        setViewingPastId(null);
                        setPastDetail(null);
                        await loadTournaments();
                      } catch {
                        // silent
                      }
                    }}
                  >
                    <Trash2 size={11} />
                    Delete
                  </ArcadeButton>
                </div>
              )}

              {viewingPastId === t.id && (
                <div className='mt-2 rounded-well border border-soft bg-well p-3'>
                  {pastDetailLoading ? (
                    <div className='flex items-center justify-center py-6'>
                      <ArcadeLoading label='Loading the bracket.' />
                    </div>
                  ) : pastDetail?.bracket ? (
                    <div className='space-y-3'>
                      <div className='flex flex-wrap items-center gap-4'>
                        {pastDetail.participants
                          .filter(
                            (p) => p.placement !== null && p.placement <= 3,
                          )
                          .sort(
                            (a, b) => (a.placement ?? 99) - (b.placement ?? 99),
                          )
                          .map((p) => (
                            <div
                              key={p.userId}
                              className='flex items-center gap-1.5 text-xs'
                            >
                              <span
                                className={`arcade-num font-bold ${
                                  p.placement === 1
                                    ? 'text-tickets-text'
                                    : p.placement === 2
                                      ? 'text-body'
                                      : 'text-faint'
                                }`}
                              >
                                #{p.placement}
                              </span>
                              <span className='font-medium text-strong'>
                                {p.userName}
                              </span>
                              <span className='arcade-num text-faint'>
                                ({p.eloAtRegistration})
                              </span>
                            </div>
                          ))}
                      </div>
                      <TournamentBracket
                        bracket={pastDetail.bracket}
                        gameType='8-ball'
                        activeMatches={{}}
                        isAdmin={false}
                        onOverride={() => {}}
                      />
                    </div>
                  ) : (
                    <p className='py-4 text-center text-xs text-faint'>
                      No bracket data available.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
