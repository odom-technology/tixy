'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Clock,
  Eye,
  LogIn,
  Trophy,
  X,
} from 'lucide-react';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { GameStatCard, GameStatGroup } from '@/features/arcade/components/stat-card';
import {
  MultiplayerLobby,
  type LobbyQueueAdapter,
} from '@/features/arcade/components/multiplayer-lobby';
import type { MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import { subscribeLive } from '@/lib/liveEvents';
import type { CheckersMatch } from '@/features/arcade/lib/checkers/types';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type MatchListResponse = {
  userId: string;
  myMatches: CheckersMatch[];
  openMatches: CheckersMatch[];
  liveMatches: Array<CheckersMatch & { spectatorCount: number }>;
};

type UserStats = {
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  kingsMade: number;
} | null;

type UserElo = { eloRating: number; tier: string; tierColor: string; peakElo: number; totalGames: number } | null;

type LeaderRow = {
  userId: string;
  userName: string;
  eloRating: number;
  tier: string;
  tierColor: string;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalGames: number;
  winRate: number;
};

const DEFAULT_STATS = { wins: 0, losses: 0, draws: 0, forfeits: 0, winRate: 0, currentStreak: 0, bestStreak: 0, kingsMade: 0 };
const DEFAULT_ELO = { eloRating: 1200, tier: 'Skilled', tierColor: '#06b6d4', peakElo: 1200, totalGames: 0 };

const BOT_DIFFICULTY_OPTIONS: Array<{ id: 'easy' | 'medium' | 'hard'; label: string; blurb: string }> = [
  { id: 'easy', label: 'Easy', blurb: 'Shallow + casual' },
  { id: 'medium', label: 'Medium', blurb: 'Club level' },
  { id: 'hard', label: 'Hard', blurb: 'Deep search' },
];

export default function CheckersLobbyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<MatchListResponse | null>(null);
  const [stats, setStats] = useState<UserStats>(null);
  const [userElo, setUserElo] = useState<UserElo>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Signed out: the matches request came back 401. Not an error; the lobby
  // shows play, practice and challenge and asks for sign-in in place.
  const [guest, setGuest] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<'red' | 'white' | 'random'>('random');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [clearingRecent, setClearingRecent] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[] | null>(null);
  const autoJoinAttemptedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/checkers/matches', { cache: 'no-store' }),
        fetch('/api/games/checkers/stats', { cache: 'no-store' }),
      ]);
      if (matchRes.status === 401) {
        setGuest(true);
        setData({ userId: '', myMatches: [], openMatches: [], liveMatches: [] });
        return;
      }
      const matchPayload = await matchRes.json();
      if (!matchRes.ok) throw new Error(matchPayload.error || 'Failed to load');
      setGuest(false);
      setData(matchPayload);
      if (statsRes.ok) {
        const statsPayload = await statsRes.json();
        setStats(statsPayload.stats);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUserElo = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/games/checkers/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.player) {
        setUserElo({
          eloRating: payload.player.eloRating,
          tier: payload.player.tier,
          tierColor: payload.player.tierColor,
          peakElo: payload.player.peakElo,
          totalGames: payload.player.totalGames,
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live + poll backstop.
  useEffect(() => {
    const unsub = subscribeLive(['checkersLobby'], () => { void load(); });
    const stopPolling = startVisiblePolling(load, 30_000);
    return () => { unsub(); stopPolling(); };
  }, [load]);

  useEffect(() => {
    if (data?.userId) void loadUserElo(data.userId);
  }, [data?.userId, loadUserElo]);

  // Lazy-load the leaderboard when the modal opens.
  useEffect(() => {
    if (!showLeaderboard || leaderboard !== null) return;
    void (async () => {
      try {
        const res = await fetch('/api/games/checkers/elo-leaderboard', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        setLeaderboard(payload.leaderboard ?? []);
      } catch { /* ignore */ }
    })();
  }, [showLeaderboard, leaderboard]);

  const joinMatch = useCallback(async (matchId: string, inviteCode?: string) => {
    if (joiningId) return;
    setJoiningId(matchId);
    try {
      const res = await fetch('/api/games/checkers/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to join.');
      router.push(`/checkers/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [router, joiningId]);

  // Challenge (code-only): create an open match + invite code and hand the
  // shareable invite back to the lobby's code panel.
  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/checkers/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match.');
    void load();
    return { matchId: payload.match.id, invite: payload.invite };
  }, [selectedColor, load]);

  // Practice-vs-bot start (difficulty chosen inside the shared lobby modal).
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/checkers/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to start bot match.');
    router.push(`/checkers/${payload.match.id}`);
  }, [selectedColor, router]);

  const cancelMatch = useCallback(async (matchId: string) => {
    if (cancellingId) return;
    setCancellingId(matchId);
    try {
      const res = await fetch(`/api/games/checkers/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Failed to cancel.');
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }, [cancellingId, load]);

  const clearRecent = useCallback(async () => {
    if (clearingRecent) return;
    setClearingRecent(true);
    try {
      await fetch('/api/games/checkers/matches/clear-recent', { method: 'POST' });
      void load();
    } finally {
      setClearingRecent(false);
    }
  }, [clearingRecent, load]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/checkers/match/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredColor: selectedColor }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to find a match.');
      void load();
      return { status: payload.status, matchId: payload.matchId };
    },
    poll: async (matchId) => {
      const res = await fetch(`/api/games/checkers/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/checkers/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    },
    lobbyTopic: 'checkersLobby',
  }), [selectedColor, load]);

  // ── Deep links ──────────────────────────────────────────────────────────
  useEffect(() => {
    const joinId = searchParams.get('join');
    if (!joinId || !data || guest) return;
    const key = `join:${joinId}`;
    if (autoJoinAttemptedRef.current === key) return;

    const alreadyIn = data.myMatches.find(
      (m) => m.id === joinId && (m.player1Id === data.userId || m.player2Id === data.userId),
    );
    if (alreadyIn) { router.replace(`/checkers/${joinId}`); return; }

    const joinable = [...data.myMatches, ...data.openMatches].find(
      (m) => m.id === joinId && m.status === 'waiting' && m.player1Id !== data.userId,
    );
    if (joinable && joiningId !== joinId) {
      autoJoinAttemptedRef.current = key;
      void joinMatch(joinId);
    }
  }, [guest, searchParams, data, router, joinMatch, joiningId]);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code || !data || guest) return;
    const key = `code:${code}`;
    if (autoJoinAttemptedRef.current === key) return;
    autoJoinAttemptedRef.current = key;

    void (async () => {
      try {
        const res = await fetch(
          `/api/games/multiplayer/code?gameType=checkers&code=${encodeURIComponent(code)}`,
          { cache: 'no-store' },
        );
        const payload = await res.json();
        if (!res.ok || !payload.invite?.matchId) {
          throw new Error(payload.error || 'Game code is no longer available.');
        }
        const matchId = payload.invite.matchId as string;
        const alreadyIn = data.myMatches.find(
          (m) => m.id === matchId && (m.player1Id === data.userId || m.player2Id === data.userId),
        );
        if (alreadyIn) { router.replace(`/checkers/${matchId}`); return; }
        await joinMatch(matchId, payload.invite.code);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [guest, searchParams, data, router, joinMatch]);

  const displayStats = stats ?? DEFAULT_STATS;
  const displayElo = userElo ?? DEFAULT_ELO;

  const myMatches = data?.myMatches ?? [];
  const openMatches = data?.openMatches ?? [];
  const liveMatches = data?.liveMatches ?? [];
  const myActive = data?.userId
    ? myMatches.filter((m) => m.status === 'active' || (m.status === 'waiting' && m.player1Id === data.userId))
    : [];
  const myRecent = myMatches.filter((m) => m.status === 'completed' || m.status === 'forfeited');

  // ── Slots handed to the shared lobby shell ─────────────────────────────

  const optionsSlot = (
    <div>
      <div className='arcade-kicker mb-1.5 text-xs text-faint'>Your colour</div>
      <div className='grid grid-cols-3 gap-2'>
        {(['red', 'random', 'white'] as const).map((c) => (
          <button
            key={c}
            type='button'
            onClick={() => setSelectedColor(c)}
            className={`rounded-key border-2 px-3 py-2 text-xs font-semibold capitalize transition-[filter] duration-[140ms] hover:brightness-107 ${
              selectedColor === c ? 'border-ink bg-key-face text-key-face-on shadow-chip' : 'border-ink bg-raised text-body shadow-chip'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <p className='mt-1 text-[11px] text-faint'>Red moves first.</p>
    </div>
  );

  const headerActions = (
    <>
      <MuteButton />
      {userElo && (
        <div className='text-xs'>
          <span className='text-faint'>Your Elo</span>{' '}
          <span className='arcade-num font-semibold' style={{ color: userElo.tierColor }}>{userElo.eloRating}</span>{' '}
          <span className='text-faint'>({userElo.tier})</span>
        </div>
      )}
      <ArcadeButton tone='default' size='sm' onClick={() => setShowLeaderboard(true)}>
        <Trophy size={14} />
        Leaderboard
      </ArcadeButton>
    </>
  );

  const statsSlot = (
    <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
      <h2 className='mb-3 flex items-center gap-2 text-base font-semibold text-strong'>
        <Trophy size={16} className='text-tickets-text' />
        Your stats
      </h2>
      <div className='mb-3 flex items-center justify-between rounded-well border border-soft bg-well px-4 py-3'>
        <div>
          <p className='arcade-kicker text-[10px] text-faint'>Elo</p>
          <div className='mt-1 flex items-baseline gap-2'>
            <span className='arcade-num text-3xl font-bold text-strong'>{displayElo.eloRating}</span>
            <span className='text-sm font-bold' style={{ color: displayElo.tierColor }}>{displayElo.tier}</span>
          </div>
        </div>
        <div className='text-right'>
          <p className='arcade-kicker text-[10px] text-faint'>Peak</p>
          <p className='arcade-num mt-1 text-lg font-semibold text-body'>{displayElo.peakElo}</p>
        </div>
      </div>
      <GameStatGroup cols={3}>
        <GameStatCard variant='flat' label='Wins' value={displayStats.wins} accent='text-prize-text' />
        <GameStatCard variant='flat' label='Losses' value={displayStats.losses} accent='text-danger-text' />
        <GameStatCard variant='flat' label='Draws' value={displayStats.draws} accent='text-body' />
        <GameStatCard variant='flat' label='Win rate' value={`${displayStats.winRate}%`} accent='text-tickets-text' />
        <GameStatCard variant='flat' label='Streak' value={displayStats.currentStreak} accent='text-strong' sub={`best ${displayStats.bestStreak}`} />
        <GameStatCard variant='flat' label='Kings' value={displayStats.kingsMade} accent='text-faint' />
      </GameStatGroup>
    </section>
  );

  const openMatchesSlot = (
    <div className='flex flex-col gap-4'>
      {/* My matches */}
      <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
        <h2 className='mb-3 text-base font-semibold text-strong'>Your matches</h2>
        {loading ? (
          <div className='flex items-center justify-center py-6'><ArcadeLoading label='Loading your matches.' /></div>
        ) : myActive.length === 0 ? (
          <p className='text-sm text-faint'>No active matches. Hit Play now to find an opponent.</p>
        ) : (
          <div className='flex flex-col gap-2'>
            {myActive.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                viewerId={data!.userId}
                actionSlot={
                  m.status === 'waiting' && m.player1Id === data!.userId ? (
                    <ArcadeButton tone='danger' size='xs' onClick={() => cancelMatch(m.id)} disabled={cancellingId === m.id}>
                      {cancellingId === m.id ? <ArcadeLoadingDots /> : 'Cancel'}
                    </ArcadeButton>
                  ) : m.status === 'waiting' ? (
                    <ArcadeButton tone='primary' size='xs' onClick={() => joinMatch(m.id)} disabled={joiningId === m.id}>
                      {joiningId === m.id ? <ArcadeLoadingDots /> : <><LogIn size={12} /> Join</>}
                    </ArcadeButton>
                  ) : (
                    <ArcadeLinkButton href={`/checkers/${m.id}`} tone='primary' size='xs'>Open</ArcadeLinkButton>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Open matches */}
      {openMatches.length > 0 && (
        <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
          <h2 className='mb-3 text-base font-semibold text-strong'>Open matches</h2>
          <div className='flex flex-col gap-2'>
            {openMatches.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                viewerId={data!.userId}
                actionSlot={
                  <ArcadeButton tone='primary' size='xs' onClick={() => joinMatch(m.id)} disabled={joiningId === m.id}>
                    {joiningId === m.id ? <ArcadeLoadingDots /> : <><LogIn size={12} /> Join</>}
                  </ArcadeButton>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Live matches */}
      {liveMatches.length > 0 && (
        <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
          <h2 className='mb-3 flex items-center gap-2 text-base font-semibold text-strong'>
            <Eye size={16} className='text-faint' />
            Live now
          </h2>
          <div className='flex flex-col gap-2'>
            {liveMatches.slice(0, 5).map((m) => (
              <div key={m.id} className='flex items-center justify-between gap-2 border-b border-soft px-3 py-2 last:border-b-0'>
                <div className='min-w-0 text-sm'>
                  <span className='font-medium'>{m.player1Name}</span>
                  <span className='text-faint'> vs </span>
                  <span className='font-medium'>{m.player2Name ?? '?'}</span>
                  <span className='ml-2 text-[11px] text-faint'>{m.moveCount} moves</span>
                </div>
                <ArcadeLinkButton href={`/checkers/${m.id}`} tone='default' size='xs'>
                  <Eye size={12} /> Watch
                </ArcadeLinkButton>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent */}
      {myRecent.length > 0 && (
        <section className='rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet'>
          <div className='mb-3 flex items-center justify-between'>
            <h2 className='text-base font-semibold text-strong'>Recent</h2>
            <ArcadeButton tone='ghost' size='xs' onClick={clearRecent} disabled={clearingRecent}>
              {clearingRecent ? <ArcadeLoadingDots /> : 'Clear'}
            </ArcadeButton>
          </div>
          <div className='flex flex-col gap-2'>
            {myRecent.slice(0, 8).map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                viewerId={data!.userId}
                actionSlot={<ArcadeLinkButton href={`/checkers/${m.id}`} tone='default' size='xs'>Review</ArcadeLinkButton>}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const rules = (
    <ul className='space-y-1.5'>
      <li>Move diagonally forward one square. Kings move both directions.</li>
      <li><span className='font-semibold text-strong'>Captures are mandatory</span> — if you can jump, you must.</li>
      <li>Multi-jumps chain in one turn: click each landing square.</li>
      <li>Reach the far row to crown a king.</li>
      <li>No legal move left? You lose. Red moves first.</li>
    </ul>
  );

  return (
    <GamesShell
      headerProps={{
        title: 'Checkers',
        subtitle: 'Ranked draughts vs friends or bots. Mandatory captures, multi-jumps, kings.',
      }}
    >
      <MultiplayerLobby
        gameType='checkers'
        gameName='Checkers'
        accent='primary'
        queue={queueAdapter}
        onOpenMatch={(id) => router.push(`/checkers/${id}`)}
        challenge={{
          mode: 'code-only',
          gameType: 'checkers',
          onCreateCodeInvite: createCodeInvite,
          onJoinByCode: joinMatch,
        }}
        bot={{
          difficulties: BOT_DIFFICULTY_OPTIONS.map((d) => ({
            id: d.id,
            label: d.label,
            sublabel: d.blurb,
          })),
          defaultDifficulty: 'medium',
          onStart: startBotMatch,
          note: (
            <>
              No timer — play at your own pace. You are{' '}
              <span className='font-mono text-strong'>{selectedColor}</span>.
            </>
          ),
        }}
        optionsSlot={optionsSlot}
        headerActions={headerActions}
        statsSlot={statsSlot}
        openMatchesSlot={openMatchesSlot}
        rules={rules}
        error={error}
        onDismissError={() => setError(null)}
        guest={guest}
      />

      {/* Leaderboard modal */}
      {showLeaderboard && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
          <div className='arcade-modal max-h-[80vh] w-full max-w-lg overflow-hidden p-5'>
            <div className='mb-3 flex items-center justify-between'>
              <h3 className='text-base font-semibold'>Ranked leaderboard</h3>
              <ArcadeButton tone='ghost' size='icon-sm' onClick={() => setShowLeaderboard(false)} aria-label='Close'><X size={16} /></ArcadeButton>
            </div>
            <div className='max-h-[60vh] overflow-y-auto'>
              {leaderboard === null ? (
                <div className='flex items-center justify-center py-8'><ArcadeLoading label='Loading the leaderboard.' /></div>
              ) : leaderboard.length === 0 ? (
                <p className='py-6 text-center text-sm text-faint'>No ranked games yet. Be the first.</p>
              ) : (
                <div className='flex flex-col gap-1'>
                  {leaderboard.map((row, i) => (
                    <div key={row.userId} className='arcade-card-inset flex items-center justify-between gap-3 px-3 py-2 text-sm'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='arcade-num w-6 shrink-0 text-faint'>#{i + 1}</span>
                        <span className='truncate font-medium'>{row.userName}</span>
                        <span className='shrink-0 text-[10px]' style={{ color: row.tierColor }}>{row.tier}</span>
                      </div>
                      <div className='flex shrink-0 items-center gap-3 text-xs text-faint'>
                        <span className='arcade-num'>{row.totalWins}W-{row.totalLosses}L</span>
                        <span className='arcade-num font-bold text-strong'>{row.eloRating}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </GamesShell>
  );
}

function MatchRow({
  match,
  viewerId,
  actionSlot,
}: {
  match: CheckersMatch;
  viewerId: string;
  actionSlot: React.ReactNode;
}) {
  const opponentName = match.player1Id === viewerId ? match.player2Name : match.player1Name;
  const isCompleted = match.status === 'completed' || match.status === 'forfeited';
  const won = match.winnerId === viewerId;
  const drawn = match.result === '1/2-1/2';
  const statusBadge = isCompleted
    ? (drawn ? 'Draw' : won ? 'Won' : 'Lost')
    : match.status === 'waiting' ? 'Waiting'
    : match.currentTurn === viewerId ? 'Your turn'
    : 'Opponent';

  return (
    <div className='flex items-center justify-between gap-2 border-b border-soft px-3 py-2 last:border-b-0'>
      <div className='min-w-0'>
        <div className='flex items-center gap-1.5 truncate text-sm'>
          <span className='font-medium'>{opponentName ?? '(waiting)'}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isCompleted
                ? (drawn ? 'border border-soft bg-raised text-body' : won ? 'border border-ink bg-prize text-prize-on' : 'border border-ink bg-danger text-danger-on')
                : match.status === 'waiting'
                ? 'border border-ink bg-tickets text-tickets-on'
                : match.currentTurn === viewerId
                ? 'border border-ink bg-prize text-prize-on'
                : 'border border-soft bg-raised text-body'
            }`}
          >
            {statusBadge}
          </span>
        </div>
        <div className='mt-0.5 flex items-center gap-2 text-[11px] text-faint'>
          <Clock size={10} />
          <span>{match.moveCount} moves</span>
        </div>
      </div>
      {actionSlot}
    </div>
  );
}
