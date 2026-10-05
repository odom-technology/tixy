'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Trophy,
  Users,
  Plus,
  Play,
  UserPlus,
  UserMinus,
  Shield,
  Crown,
  History,
} from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import type {
  Tournament,
  TournamentParticipant,
} from '@/server/arcade/chess-tournament';
import { resolveTimeFormat } from '@/features/arcade/lib/chess/types';
import { TournamentBracket } from '@/features/arcade/components/tournaments/bracket';
import type {
  TournamentMatch,
  BracketData,
} from '@/features/arcade/components/tournaments/types';
import { TournamentCreateModal } from './_tournament-create-modal';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type WagerPool = { player1Total: number; player2Total: number; totalPool: number };

type TournamentDetailResponse = {
  tournament: Tournament;
  participants: TournamentParticipant[];
  bracket: BracketData | null;
  activeChessMatches: Record<string, string | null>;
  isAdmin: boolean;
  isRegistered: boolean;
  userId: string;
  wagerPools?: Record<string, WagerPool> | null;
  userWagers?: Array<{ id: string; tournamentMatchId: string; backedPlayerId: string; amount: number; payout: number | null; status: string }>;
};

export function TournamentSection() {
  const [, setTournaments] = useState<Tournament[]>([]);
  const [detail, setDetail] = useState<TournamentDetailResponse | null>(null);
  const [listIsAdmin, setListIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [starting, setStarting] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<TournamentMatch | null>(null);
  const [overrideWinnerId, setOverrideWinnerId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/games/chess/tournament/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data: TournamentDetailResponse = await res.json();
      setDetail(data);
    } catch { /* ignore */ }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/games/chess/tournament', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setTournaments(data.tournaments ?? []);
      if (typeof data.isAdmin === 'boolean') setListIsAdmin(data.isAdmin);
      const relevant = (data.tournaments as Tournament[])?.find(
        (t) => t.status === 'registration' || t.status === 'active',
      );
      if (relevant) await loadDetail(relevant.id);
      else setDetail(null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [loadDetail]);

  useEffect(() => {
    void loadList();
    // SSE on `chessTournament` drives real-time updates; poll is only a
    // backstop so bump the interval to cut repeat refetches.
    return startVisiblePolling(loadList, 60_000);
  }, [loadList]);

  useEffect(() => {
    const unsub = subscribeLive(['chessTournament'], () => { void loadList(); });
    return unsub;
  }, [loadList]);

  const handleRegister = async (action: 'register' | 'unregister') => {
    if (!detail) return;
    setRegistering(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/chess/tournament/${detail.tournament.id}/register`,
        { method: action === 'register' ? 'POST' : 'DELETE' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed.');
      await loadDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  };

  const handleStart = async () => {
    if (!detail || !confirm('Start the tournament? Registration closes and the matches begin.')) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/chess/tournament/${detail.tournament.id}/start`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to start.');
      await loadDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const handleOverrideSubmit = async () => {
    if (!detail || !overrideTarget || !overrideWinnerId || !overrideReason.trim()) return;
    setOverriding(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/chess/tournament/${detail.tournament.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentMatchId: overrideTarget.id,
          winnerId: overrideWinnerId,
          reason: overrideReason.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Override failed.');
      setOverrideTarget(null);
      setOverrideWinnerId('');
      setOverrideReason('');
      await loadDetail(detail.tournament.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOverriding(false);
    }
  };

  if (loading) return null;

  const activeTournament = detail?.tournament;
  const isAdmin = detail?.isAdmin ?? listIsAdmin;
  const hasActive = activeTournament && activeTournament.status !== 'completed';
  const hasAnything = hasActive || isAdmin;
  if (!hasAnything) return null;

  const preset = activeTournament ? resolveTimeFormat(activeTournament.timeFormat) : null;

  return (
    <>
      {isAdmin && !hasActive && (
        <section className='flex justify-center'>
          <ArcadeButton
            tone='tickets'
            size='sm'
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            create tournament
          </ArcadeButton>
        </section>
      )}

      {hasActive && activeTournament && detail && (
        <section className='arcade-card p-4 sm:p-5'>
          <div className='mb-3 flex flex-wrap items-start justify-between gap-2'>
            <div>
              <h2 className='flex items-center gap-2 text-base font-semibold text-strong'>
                <Trophy size={16} className='text-tickets-text' />
                {activeTournament.name}
                <span
                  className={`rounded-full border border-ink px-2 py-0.5 text-xs font-semibold ${
                    activeTournament.status === 'registration'
                      ? 'bg-info text-info-on'
                      : 'bg-prize text-prize-on'
                  }`}
                >
                  {activeTournament.status}
                </span>
              </h2>
              <div className='mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint'>
                <span>{activeTournament.format.toLowerCase()}</span>
                {preset && <span>• {preset.label.toLowerCase()}</span>}
                {activeTournament.hasLosersBracket && <span>• double elimination</span>}
                {activeTournament.bettingEnabled && <span className='text-tickets-text'>• betting on</span>}
                <span>• {activeTournament.participantCount} registered</span>
              </div>
            </div>

            {/* Actions */}
            <div className='flex flex-wrap gap-2'>
              {activeTournament.status === 'registration' && !detail.isRegistered && (
                <ArcadeButton
                  tone='success'
                  size='sm'
                  onClick={() => void handleRegister('register')}
                  disabled={registering}
                >
                  <UserPlus size={12} />
                  register
                </ArcadeButton>
              )}
              {activeTournament.status === 'registration' && detail.isRegistered && (
                <ArcadeButton
                  tone='danger'
                  size='sm'
                  onClick={() => void handleRegister('unregister')}
                  disabled={registering}
                >
                  <UserMinus size={12} />
                  unregister
                </ArcadeButton>
              )}
              {isAdmin && activeTournament.status === 'registration' && activeTournament.participantCount >= 2 && (
                <ArcadeButton
                  tone='tickets'
                  size='sm'
                  onClick={handleStart}
                  disabled={starting}
                >
                  {starting ? <ArcadeLoadingDots /> : <Play size={12} />}
                  start
                </ArcadeButton>
              )}
            </div>
          </div>

          {error && (
            <div className='arcade-card-inset mb-2 px-3 py-2 text-xs text-danger-text'>
              {error}
            </div>
          )}

          {/* Participants or bracket */}
          {activeTournament.status === 'registration' ? (
            <div>
              <h3 className='mb-2 flex items-center gap-1.5 text-xs font-semibold text-faint'>
                <Users size={12} />
                participants ({detail.participants.length})
              </h3>
              {detail.participants.length === 0 ? (
                <p className='text-xs text-faint'>No registrations yet.</p>
              ) : (
                <ol className='grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4'>
                  {detail.participants.map((p, i) => (
                    <li key={p.userId} className='arcade-card-inset flex items-center gap-1.5 px-2 py-1 text-xs'>
                      <span className='arcade-num text-faint'>{i + 1}.</span>
                      <span className='truncate'>{p.userName}</span>
                      <span className='arcade-num ml-auto shrink-0 text-[10px] text-faint'>{p.eloAtRegistration}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            detail.bracket && (
              <TournamentBracket
                bracket={detail.bracket}
                gameType='chess'
                activeMatches={detail.activeChessMatches}
                isAdmin={detail.isAdmin}
                onOverride={(m) => {
                  setOverrideTarget(m);
                  setOverrideWinnerId('');
                  setOverrideReason('');
                }}
                wagerPools={detail.wagerPools}
                userId={detail.userId}
                tournamentId={detail.tournament.id}
                bettingEnabled={detail.tournament.bettingEnabled}
                minBet={detail.tournament.minBet}
                maxBet={detail.tournament.maxBet}
                onBetPlaced={() => void loadDetail(detail.tournament.id)}
              />
            )
          )}
        </section>
      )}

      {/* Override modal */}
      {overrideTarget && detail && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
          <div className='arcade-modal max-w-md p-5'>
            <div className='mb-3 flex items-center gap-2'>
              <Shield className='text-tickets-text' size={18} />
              <h3 className='text-base font-semibold'>override result</h3>
            </div>
            <p className='mb-3 text-xs text-faint'>
              Force a result for this tournament match. Any in-progress games will be forfeited on the overridden loser.
            </p>
            <div className='mb-3 space-y-2'>
              <label className='text-xs font-medium text-faint'>winner</label>
              <div className='flex gap-2'>
                {[
                  { id: overrideTarget.player1Id, name: overrideTarget.player1Name },
                  { id: overrideTarget.player2Id, name: overrideTarget.player2Name },
                ].map((p) => (
                  <button
                    key={p.id}
                    type='button'
                    onClick={() => setOverrideWinnerId(p.id ?? '')}
                    className={`flex-1 rounded-key border-2 px-3 py-2 text-sm font-semibold shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 ${
                      overrideWinnerId === p.id
                        ? 'border-ink bg-key-face text-key-face-on'
                        : 'border-ink bg-raised text-body'
                    }`}
                  >
                    {p.name ?? 'to be decided'}
                  </button>
                ))}
              </div>
            </div>
            <label className='mb-1 block text-xs font-medium text-faint'>reason</label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder='Provide a reason for the override'
              className='arcade-input mb-3 px-3 py-2 text-sm'
            />
            <div className='flex gap-2'>
              <ArcadeButton
                tone='ghost'
                size='sm'
                className='flex-1'
                onClick={() => setOverrideTarget(null)}
              >
                cancel
              </ArcadeButton>
              <ArcadeButton
                tone='primary'
                size='sm'
                className='flex-1'
                onClick={() => void handleOverrideSubmit()}
                disabled={overriding || !overrideWinnerId || !overrideReason.trim()}
              >
                {overriding ? <ArcadeLoadingDots /> : 'confirm'}
              </ArcadeButton>
            </div>
          </div>
        </div>
      )}

      <TournamentCreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => void loadList()} />
    </>
  );
}

export function PastTournamentsSection() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/games/chess/tournament', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setTournaments(
        (data.tournaments as Tournament[])?.filter((t) => t.status === 'completed') ?? [],
      );
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading || tournaments.length === 0) return null;
  const visible = expanded ? tournaments : tournaments.slice(0, 3);

  return (
    <section className='arcade-card p-4'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        className='mb-2 flex w-full items-center justify-between text-sm font-semibold text-strong'
      >
        <span className='flex items-center gap-1.5'>
          <History size={14} className='text-faint' />
          past tournaments
        </span>
        <span className='text-xs text-faint'>
          {expanded ? 'collapse' : `show ${tournaments.length}`}
        </span>
      </button>
      <ul className='space-y-1.5'>
        {visible.map((t) => (
          <li
            key={t.id}
            className='arcade-card-inset flex items-center justify-between px-3 py-2 text-sm'
          >
            <div className='min-w-0'>
              <div className='flex items-center gap-1.5 truncate font-medium'>
                <Crown size={12} className='text-tickets-text' />
                {t.name}
              </div>
              <div className='text-[11px] text-faint'>
                winner: {t.winnerName ?? 'none'}
              </div>
            </div>
            <span className='text-xs text-faint'>
              {t.format.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
