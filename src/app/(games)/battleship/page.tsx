'use client';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  Eye,
  History,
  LogIn,
  Ship,
  Trophy,
} from 'lucide-react';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { GameStatCard, GameStatGroup } from '@/features/arcade/components/stat-card';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  MultiplayerLobby,
  type LobbyQueueAdapter,
} from '@/features/arcade/components/multiplayer-lobby';
import type { MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import { subscribeLive } from '@/lib/liveEvents';
import type { PublicMatch } from '@/features/arcade/lib/battleship';
import { GameLeaderboard, RANKED_AND_BOT_MODES } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

const BATTLESHIP_GAME_TYPE = 'battleship' as const;

type LiveMatch = PublicMatch & { spectatorCount: number };

type MatchListResponse = {
  userId: string;
  myMatches: PublicMatch[];
  openMatches: PublicMatch[];
  liveMatches?: LiveMatch[];
  error?: string;
};

type UserStats = {
  wins: number;
  losses: number;
  forfeits: number;
  winRate: number;
  accuracy: number;
  currentStreak: number;
  bestStreak: number;
} | null;

type UserElo = {
  eloRating: number;
  tier: string;
  tierColor: string;
  peakElo: number;
  totalGames: number;
} | null;

const DEFAULT_USER_ELO: NonNullable<UserElo> = {
  eloRating: 1200,
  tier: 'Skilled',
  tierColor: '#06b6d4',
  peakElo: 1200,
  totalGames: 0,
};

const DEFAULT_USER_STATS: NonNullable<UserStats> = {
  wins: 0,
  losses: 0,
  forfeits: 0,
  winRate: 0,
  accuracy: 0,
  currentStreak: 0,
  bestStreak: 0,
};

// Bot difficulty labels shown in the shared lobby's Practice modal. Keep in sync
// with the difficulties the /match/bot route accepts (easy | medium | hard).
const BOT_DIFFICULTY_OPTIONS: Array<{ id: 'easy' | 'medium' | 'hard'; label: string; note: string }> = [
  { id: 'easy', label: 'Easy', note: 'Random fire' },
  { id: 'medium', label: 'Medium', note: 'Hunts hits' },
  { id: 'hard', label: 'Hard', note: 'Parity + sink' },
];

export default function BattleshipLobbyPage() {
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
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [clearingRecent, setClearingRecent] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const autoJoinAttemptedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/battleship/matches', { cache: 'no-store' }),
        fetch('/api/games/battleship/stats', { cache: 'no-store' }),
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
      const res = await fetch(`/api/games/battleship/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
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
  useEffect(() => { if (data?.userId) void loadUserElo(data.userId); }, [data?.userId, loadUserElo]);

  useEffect(() => {
    const unsub = subscribeLive(['battleshipLobby'], () => { void load(); });
    const stopPolling = startVisiblePolling(load, 30_000);
    return () => { unsub(); stopPolling(); };
  }, [load]);

  const joinMatch = useCallback(async (matchId: string, inviteCode?: string) => {
    if (joiningId) return;
    setJoiningId(matchId);
    try {
      const res = await fetch('/api/games/battleship/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to join.');
      router.push(`/battleship/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [router, joiningId]);

  // Challenge action (code-only): mint an invite link/code to share with anyone.
  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/battleship/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match.');
    void load();
    return {
      matchId: payload.match.id,
      openHref: `/battleship/${payload.match.id}`,
      invite: payload.invite ?? undefined,
    };
  }, [load]);

  // Auto-join from deep link `?join=<matchId>`.
  useEffect(() => {
    const joinId = searchParams.get('join');
    if (!joinId || !data || guest) return;
    const attemptKey = `join:${joinId}`;
    if (autoJoinAttemptedRef.current === attemptKey) return;
    const alreadyIn = data.myMatches.find(
      (m) => m.id === joinId && (m.player1Id === data.userId || m.player2Id === data.userId),
    );
    if (alreadyIn) {
      router.replace(`/battleship/${joinId}`);
      return;
    }
    const joinable = [...data.myMatches, ...data.openMatches].find(
      (m) => m.id === joinId && m.status === 'waiting' && m.player1Id !== data.userId,
    );
    if (joinable && joiningId !== joinId) {
      autoJoinAttemptedRef.current = attemptKey;
      void joinMatch(joinId);
    }
  }, [guest, searchParams, data, router, joinMatch, joiningId]);

  // Auto-join from shared code links `?code=<gameCode>`.
  useEffect(() => {
    const code = searchParams.get('code');
    if (!code || !data || guest) return;
    const attemptKey = `code:${code}`;
    if (autoJoinAttemptedRef.current === attemptKey) return;
    autoJoinAttemptedRef.current = attemptKey;

    void (async () => {
      try {
        const res = await fetch(
          `/api/games/multiplayer/code?gameType=battleship&code=${encodeURIComponent(code)}`,
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
        if (alreadyIn) {
          router.replace(`/battleship/${matchId}`);
          return;
        }
        await joinMatch(matchId, payload.invite.code);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [guest, searchParams, data, router, joinMatch]);

  const cancelMatch = useCallback(async (matchId: string) => {
    if (cancellingId) return;
    setCancellingId(matchId);
    try {
      const res = await fetch(`/api/games/battleship/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }, [load, cancellingId]);

  const clearRecent = useCallback(async () => {
    if (clearingRecent) return;
    setClearingRecent(true);
    try {
      await fetch('/api/games/battleship/matches/clear-recent', { method: 'POST' });
      void load();
    } finally {
      setClearingRecent(false);
    }
  }, [clearingRecent, load]);

  // Practice-vs-bot start (difficulty chosen inside the shared lobby modal).
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/battleship/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to start bot match.');
    router.push(`/battleship/${payload.match.id}`);
  }, [router]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/battleship/match/queue', { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to find a match.');
      void load();
      return { status: payload.status, matchId: payload.matchId };
    },
    poll: async (matchId) => {
      const res = await fetch(`/api/games/battleship/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/battleship/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    },
    lobbyTopic: 'battleshipLobby',
  }), [load]);

  const myMatches = data?.myMatches ?? [];
  const openMatches = data?.openMatches ?? [];
  const liveMatches = data?.liveMatches ?? [];

  const myActive = data?.userId
    ? myMatches.filter((m) => {
        if (m.status === 'active') return true;
        if (m.status === 'waiting' && m.player1Id === data.userId) return true;
        return false;
      })
    : [];
  const myRecent = myMatches.filter((m) => m.status === 'completed' || m.status === 'forfeited');
  const hasRecentFinished = myRecent.length > 0;
  const RECENT_COLLAPSE_THRESHOLD = 3;
  const recentIsAccordion = myRecent.length >= RECENT_COLLAPSE_THRESHOLD;
  const recentVisible = !recentIsAccordion || recentOpen;

  if (loading) {
    return (
      <GamesShell headerProps={{ icon: <Ship size={18} />, title: renameGameNamesInText('Battleship'), subtitle: 'Loading…' }}>
        <div className="flex items-center justify-center py-20">
          <ArcadeLoading label='Loading the lobby.' />
        </div>
      </GamesShell>
    );
  }

  // ── Slots handed to the shared lobby shell ─────────────────────────────

  const rules = (
    <div className="space-y-2">
      <p>
        Standard fleet: <span className="font-semibold text-strong">Carrier (5)</span>,{' '}
        <span className="font-semibold text-strong">Battleship (4)</span>,{' '}
        <span className="font-semibold text-strong">Cruiser (3)</span>,{' '}
        <span className="font-semibold text-strong">Submarine (3)</span>,{' '}
        <span className="font-semibold text-strong">Destroyer (2)</span>.
      </p>
      <p>
        Untimed. Both captains privately place their fleet, then alternate firing one
        shot per turn at the enemy grid. A hit stays your neighbour&apos;s problem —
        turns strictly alternate (no bonus shot on a hit). Sink every enemy ship to win.
      </p>
    </div>
  );

  const headerActions = (
    <>
      <MuteButton />
      {userElo && (
        <div className="text-xs">
          <span className="text-faint">Your Elo</span>{' '}
          <span className="arcade-num font-semibold text-info-text">{userElo.eloRating}</span>{' '}
          <span className="text-faint">({userElo.tier})</span>
        </div>
      )}
      <GameLeaderboardButton
        onClick={() => setShowLeaderboard(true)}
        className="max-sm:px-3 max-sm:py-1.5 max-sm:text-xs"
      />
    </>
  );

  const statsSlot = (() => {
    const displayElo = userElo ?? DEFAULT_USER_ELO;
    const displayStats = stats ?? DEFAULT_USER_STATS;
    return (
      <section className="rounded-cabinet border-2 border-ink bg-panel p-4 shadow-cabinet">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-strong">
          <Trophy size={16} className="text-tickets-text" />
          Your stats
        </h2>
        <div className="mb-3 flex items-center justify-between rounded-well border border-soft bg-well px-4 py-3">
          <div>
            <p className="arcade-kicker text-[10px] text-faint">Elo</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="arcade-num text-3xl font-bold text-strong">{displayElo.eloRating}</span>
              <span className="text-sm font-bold text-info-text">{displayElo.tier}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="arcade-kicker text-[10px] text-faint">Peak</p>
            <p className="arcade-num mt-1 text-lg font-semibold text-body">{displayElo.peakElo}</p>
          </div>
        </div>
        <GameStatGroup cols={3}>
          <GameStatCard variant="flat" label="Wins" value={displayStats.wins} accent="text-prize-text" />
          <GameStatCard variant="flat" label="Losses" value={displayStats.losses} accent="text-danger-text" />
          <GameStatCard variant="flat" label="Win rate" value={`${displayStats.winRate}%`} accent="text-tickets-text" />
          <GameStatCard variant="flat" label="Accuracy" value={`${displayStats.accuracy}%`} accent="text-info-text" />
          <GameStatCard variant="flat" label="Streak" value={displayStats.currentStreak} accent="text-strong" sub={`best ${displayStats.bestStreak}`} />
          <GameStatCard variant="flat" label="Forfeits" value={displayStats.forfeits} accent="text-faint" />
        </GameStatGroup>
      </section>
    );
  })();

  const openMatchesSlot = (
    <div className="divide-y divide-soft overflow-hidden rounded-cabinet border-2 border-ink bg-panel shadow-cabinet">
      {myActive.length > 0 && (
        <div className="px-4 py-3">
          <p className="arcade-kicker mb-2">Your matches</p>
          <div className="space-y-1.5">
            {myActive.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                viewerId={data!.userId}
                actionSlot={
                  m.status === 'waiting' ? (
                    m.player1Id === data!.userId ? (
                      <ArcadeButton tone="ghost" size="sm" onClick={() => cancelMatch(m.id)} disabled={cancellingId === m.id}>
                        Cancel
                      </ArcadeButton>
                    ) : (
                      <ArcadeButton tone="success" size="sm" onClick={() => joinMatch(m.id)} disabled={joiningId === m.id}>
                        {joiningId === m.id ? <ArcadeLoadingDots /> : <LogIn size={10} />}
                        Join
                      </ArcadeButton>
                    )
                  ) : (
                    <Link
                      href={`/battleship/${m.id}`}
                      className="inline-flex items-center gap-1.5 rounded-key border-2 border-ink bg-tickets px-3 py-1 text-xs font-bold text-tickets-on shadow-chip transition-[filter] duration-[140ms] hover:brightness-107"
                    >
                      Open
                    </Link>
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      {hasRecentFinished && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            {recentIsAccordion ? (
              <button type="button" onClick={() => setRecentOpen((v) => !v)} className="flex items-center gap-2" aria-expanded={recentOpen}>
                <History size={14} className="text-faint" />
                <p className="arcade-kicker">
                  Recent matches
                  <span className="ml-2 normal-case text-[11px] font-normal tracking-normal text-faint">({myRecent.length})</span>
                </p>
                <ChevronDown size={14} className={`text-faint transition-transform ${recentOpen ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <p className="flex items-center gap-2 arcade-kicker">
                <History size={14} className="text-faint" />
                Recent matches
                <span className="ml-1 normal-case text-[11px] font-normal tracking-normal text-faint">({myRecent.length})</span>
              </p>
            )}
            <ArcadeButton tone="ghost" size="xs" onClick={clearRecent} disabled={clearingRecent}>
              {clearingRecent ? 'Clearing…' : 'Clear recent'}
            </ArcadeButton>
          </div>
          {recentVisible && (
            <div className="mt-2 max-h-[28rem] space-y-1.5 overflow-y-auto">
              {myRecent.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  viewerId={data!.userId}
                  actionSlot={
                    <Link
                      href={`/battleship/${m.id}`}
                      className="inline-flex items-center gap-1.5 rounded-key border-2 border-ink bg-tickets px-3 py-1 text-xs font-bold text-tickets-on shadow-chip transition-[filter] duration-[140ms] hover:brightness-107"
                    >
                      Review
                    </Link>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-3">
        <p className="arcade-kicker mb-2">Open matches</p>
        {openMatches.length === 0 ? (
          <div className="py-3 text-center text-xs text-faint">No open matches.</div>
        ) : (
          <div className="space-y-1.5">
            {openMatches.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                viewerId={data!.userId}
                actionSlot={
                  <ArcadeButton tone="success" size="sm" onClick={() => joinMatch(m.id)} disabled={joiningId === m.id}>
                    {joiningId === m.id ? <ArcadeLoadingDots /> : <LogIn size={10} />}
                    Join
                  </ArcadeButton>
                }
              />
            ))}
          </div>
        )}
      </div>

      {liveMatches.length > 0 && (
        <div className="px-4 py-3">
          <p className="arcade-kicker mb-2 flex items-center gap-2">
            <Eye size={14} className="text-faint" />
            Live
            <span className="ml-0.5 inline-flex h-2 w-2 rounded-full bg-prize motion-safe:animate-pulse" />
          </p>
          <div className="divide-y divide-soft">
            {liveMatches.slice(0, 5).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    <span className="font-medium">{m.player1Name}</span>
                    <span className="mx-1 text-faint">vs</span>
                    <span className="font-medium">{m.player2Name}</span>
                  </div>
                  <div className="text-[11px] text-faint">
                    {m.phase === 'placement' ? 'placing fleets' : `shot ${m.moveCount}`}
                    {m.spectatorCount > 0 && <> • <Eye size={9} className="inline" /> {m.spectatorCount}</>}
                  </div>
                </div>
                <ArcadeLinkButton href={`/battleship/${m.id}`} tone="primary" size="xs">
                  <Eye size={10} /> Watch
                </ArcadeLinkButton>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <GamesShell
      headerProps={{
        icon: <Ship size={18} />,
        title: renameGameNamesInText('Battleship'),
        subtitle: 'Place your fleet. Hunt theirs. Ranked against players or bots.',
      }}
    >
      <MultiplayerLobby
        gameType={BATTLESHIP_GAME_TYPE}
        gameName={renameGameNamesInText('Battleship')}
        accent="info"
        queue={queueAdapter}
        onOpenMatch={(id) => router.push(`/battleship/${id}`)}
        challenge={{
          mode: 'code-only',
          gameType: BATTLESHIP_GAME_TYPE,
          onCreateCodeInvite: createCodeInvite,
          onJoinByCode: (targetId, inviteCode) => joinMatch(targetId, inviteCode),
        }}
        bot={{
          difficulties: BOT_DIFFICULTY_OPTIONS.map((d) => ({
            id: d.id,
            label: d.label,
            sublabel: d.note,
          })),
          defaultDifficulty: 'medium',
          onStart: startBotMatch,
          note: 'Untimed — place your fleet, then take aim. The bot places instantly.',
        }}
        rules={rules}
        headerActions={headerActions}
        statsSlot={statsSlot}
        openMatchesSlot={openMatchesSlot}
        error={error}
        onDismissError={() => setError(null)}
        guest={guest}
      />

      <GameLeaderboardModal open={showLeaderboard} onOpenChange={setShowLeaderboard} title='battleship board'>
        <GameLeaderboard gameType='battleship' modes={RANKED_AND_BOT_MODES} />
      </GameLeaderboardModal>
    </GamesShell>
  );
}

function MatchRow({
  match,
  viewerId,
  actionSlot,
}: {
  match: PublicMatch;
  viewerId: string;
  actionSlot: React.ReactNode;
}) {
  const opponentName = match.player1Id === viewerId ? match.player2Name : match.player1Name;
  const isCompleted = match.status === 'completed' || match.status === 'forfeited';
  const won = match.winnerId === viewerId;
  const isPlacement = match.status === 'active' && match.phase === 'placement';
  const statusBadge = isCompleted
    ? (won ? 'Won' : 'Lost')
    : match.status === 'waiting' ? 'Waiting'
    : isPlacement ? 'Placing'
    : match.currentTurn === viewerId ? 'Your turn'
    : 'Opponent';

  return (
    <div className="flex items-center justify-between gap-2 border-b border-soft px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-sm">
          <span className="font-medium">{opponentName ?? '(waiting)'}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isCompleted
                ? (won ? 'border border-ink bg-prize text-prize-on' : 'border border-ink bg-danger text-danger-on')
                : match.status === 'waiting'
                ? 'border border-ink bg-tickets text-tickets-on'
                : isPlacement
                ? 'border border-soft bg-raised text-body'
                : match.currentTurn === viewerId
                ? 'border border-ink bg-prize text-prize-on'
                : 'border border-soft bg-raised text-body'
            }`}
          >
            {statusBadge}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span>{match.moveCount} shots</span>
          {isCompleted && match.winReason ? <span>• by {formatWinReason(match.winReason)}</span> : null}
        </div>
      </div>
      {actionSlot}
    </div>
  );
}

function formatWinReason(reason: NonNullable<PublicMatch['winReason']>): string {
  switch (reason) {
    case 'fleet_destroyed': return 'sinking';
    case 'resignation': return 'resignation';
    case 'forfeit': return 'forfeit';
    default: return reason;
  }
}
