'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  CircleDot,
  Eye,
  History,
  LogIn,
  Trophy,
} from 'lucide-react';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { GameStatCard, GameStatGroup } from '@/features/arcade/components/stat-card';
import type { MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import {
  MultiplayerLobby,
  type LobbyQueueAdapter,
} from '@/features/arcade/components/multiplayer-lobby';
import { subscribeLive } from '@/lib/liveEvents';
import type { ReversiMatch } from '@/features/arcade/lib/reversi/types';
import { GameLeaderboard, RANKED_AND_BOT_MODES } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type LiveMatch = ReversiMatch & { spectatorCount: number };

type MatchListResponse = {
  userId: string;
  myMatches: ReversiMatch[];
  openMatches: ReversiMatch[];
  liveMatches?: LiveMatch[];
  error?: string;
};

type UserStats = {
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  winRate: number;
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

// Client-side defaults for the zero-state stats card — must match STARTING_ELO
// and the corresponding tier row in reversi-elo.ts.
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
  draws: 0,
  forfeits: 0,
  winRate: 0,
  currentStreak: 0,
  bestStreak: 0,
};

const BOT_DIFFICULTY_OPTIONS: Array<{
  id: 'easy' | 'medium' | 'hard';
  label: string;
  note: string;
}> = [
  { id: 'easy',   label: 'Easy',   note: 'Loose play' },
  { id: 'medium', label: 'Medium', note: 'Solid tactics' },
  { id: 'hard',   label: 'Hard',   note: 'Deep search' },
];

export default function ReversiLobbyPage() {
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
  const [selectedColor, setSelectedColor] = useState<'black' | 'white' | 'random'>('random');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [clearingRecent, setClearingRecent] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const autoJoinAttemptedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/reversi/matches', { cache: 'no-store' }),
        fetch('/api/games/reversi/stats', { cache: 'no-store' }),
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
      const res = await fetch(`/api/games/reversi/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (data?.userId) void loadUserElo(data.userId);
  }, [data?.userId, loadUserElo]);

  // Live updates. SSE on `reversiLobby` is the primary signal; the polling
  // interval is a safety net for missed broadcasts, so it runs infrequently.
  useEffect(() => {
    const unsub = subscribeLive(['reversiLobby'], () => { void load(); });
    const stopPolling = startVisiblePolling(load, 30_000);
    return () => { unsub(); stopPolling(); };
  }, [load]);

  const joinMatch = useCallback(async (matchId: string, inviteCode?: string) => {
    if (joiningId) return;
    setJoiningId(matchId);
    try {
      const res = await fetch('/api/games/reversi/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to join.');
      router.push(`/reversi/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [router, joiningId]);

  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/reversi/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match.');
    void load();
    return {
      matchId: payload.match.id,
      openHref: `/reversi/${payload.match.id}`,
      invite: payload.invite ?? undefined,
    };
  }, [selectedColor, load]);

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
      router.replace(`/reversi/${joinId}`);
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
          `/api/games/multiplayer/code?gameType=reversi&code=${encodeURIComponent(code)}`,
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
          router.replace(`/reversi/${matchId}`);
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
      const res = await fetch(`/api/games/reversi/match/${matchId}/cancel`, { method: 'POST' });
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
      await fetch('/api/games/reversi/matches/clear-recent', { method: 'POST' });
      void load();
    } finally {
      setClearingRecent(false);
    }
  }, [clearingRecent, load]);

  // Practice-vs-bot start (difficulty chosen inside the shared lobby modal).
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/reversi/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to start bot match.');
    router.push(`/reversi/${payload.match.id}`);
  }, [selectedColor, router]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/reversi/match/queue', {
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
      const res = await fetch(`/api/games/reversi/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/reversi/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    },
    lobbyTopic: 'reversiLobby',
  }), [selectedColor, load]);

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
  const myRecent = myMatches.filter(
    (m) => m.status === 'completed' || m.status === 'forfeited',
  );
  const hasRecentFinished = myRecent.length > 0;
  const RECENT_COLLAPSE_THRESHOLD = 3;
  const recentIsAccordion = myRecent.length >= RECENT_COLLAPSE_THRESHOLD;
  const recentVisible = !recentIsAccordion || recentOpen;

  if (loading) {
    return (
      <GamesShell headerProps={{ icon: <CircleDot size={18} />, title: 'Reversi', subtitle: 'Loading…' }}>
        <div className="flex items-center justify-center py-20">
          <ArcadeLoading label='Loading the lobby.' />
        </div>
      </GamesShell>
    );
  }

  // ── Slots handed to the shared lobby shell ─────────────────────────────

  const optionsSlot = (
    <div>
      <div className="arcade-kicker mb-1.5 text-xs text-faint">Your disc</div>
      <div className="flex gap-1.5">
        {([
          { id: 'random', label: 'Random' },
          { id: 'black', label: 'Black' },
          { id: 'white', label: 'White' },
        ] as const).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setSelectedColor(o.id)}
            className={`flex-1 rounded-key border-2 px-3 py-2 text-sm font-semibold transition-[filter] duration-[140ms] hover:brightness-107 ${
              selectedColor === o.id
                ? 'border-ink bg-key-face text-key-face-on shadow-chip'
                : 'border-ink bg-raised text-body shadow-chip'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-faint">Black always moves first.</p>
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
      <ArcadeButton
        tone="default"
        size="sm"
        onClick={() => setShowLeaderboard(true)}
        className="max-sm:px-3 max-sm:py-1.5 max-sm:text-xs"
      >
        <Trophy size={14} />
        Leaderboards
      </ArcadeButton>
    </>
  );

  const rules = (
    <div className="space-y-1.5">
      <p>
        Place a disc so it <strong className="text-strong">flanks</strong> a straight line of your
        opponent&apos;s discs between your new disc and another of yours — every disc in between
        flips to your color.
      </p>
      <p>
        Every move must flip at least one disc. If you have no legal move your turn is skipped.
        When neither player can move the game ends and whoever holds the{' '}
        <strong className="text-strong">most discs</strong> wins.
      </p>
    </div>
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
          <GameStatCard variant="flat" label="Wins"     value={displayStats.wins}            accent="text-prize-text" />
          <GameStatCard variant="flat" label="Losses"   value={displayStats.losses}          accent="text-danger-text" />
          <GameStatCard variant="flat" label="Draws"    value={displayStats.draws}           accent="text-body" />
          <GameStatCard variant="flat" label="Win rate" value={`${displayStats.winRate}%`}   accent="text-tickets-text" />
          <GameStatCard variant="flat" label="Streak"   value={displayStats.currentStreak}   accent="text-strong" sub={`best ${displayStats.bestStreak}`} />
          <GameStatCard variant="flat" label="Forfeits" value={displayStats.forfeits}        accent="text-faint" />
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
                      <ArcadeButton
                        tone="ghost"
                        size="sm"
                        onClick={() => cancelMatch(m.id)}
                        disabled={cancellingId === m.id}
                      >
                        Cancel
                      </ArcadeButton>
                    ) : (
                      <ArcadeButton
                        tone="success"
                        size="sm"
                        onClick={() => joinMatch(m.id)}
                        disabled={joiningId === m.id}
                      >
                        {joiningId === m.id ? <ArcadeLoadingDots /> : <LogIn size={10} />}
                        Join
                      </ArcadeButton>
                    )
                  ) : (
                    <Link
                      href={`/reversi/${m.id}`}
                      className="rounded-key border-2 border-ink bg-tickets px-3 py-1 text-xs font-bold text-tickets-on shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 inline-flex items-center gap-1.5"
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
              <button
                type="button"
                onClick={() => setRecentOpen((v) => !v)}
                className="flex items-center gap-2"
                aria-expanded={recentOpen}
              >
                <History size={14} className="text-faint" />
                <p className="arcade-kicker">
                  Recent matches
                  <span className="ml-2 normal-case text-[11px] font-normal tracking-normal text-faint">
                    ({myRecent.length})
                  </span>
                </p>
                <ChevronDown
                  size={14}
                  className={`text-faint transition-transform ${recentOpen ? 'rotate-180' : ''}`}
                />
              </button>
            ) : (
              <p className="flex items-center gap-2 arcade-kicker">
                <History size={14} className="text-faint" />
                Recent matches
                <span className="ml-1 normal-case text-[11px] font-normal tracking-normal text-faint">
                  ({myRecent.length})
                </span>
              </p>
            )}
            <ArcadeButton
              tone="ghost"
              size="xs"
              onClick={clearRecent}
              disabled={clearingRecent}
            >
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
                      href={`/reversi/${m.id}`}
                      className="rounded-key border-2 border-ink bg-tickets px-3 py-1 text-xs font-bold text-tickets-on shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 inline-flex items-center gap-1.5"
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
                  <ArcadeButton
                    tone="success"
                    size="sm"
                    onClick={() => joinMatch(m.id)}
                    disabled={joiningId === m.id}
                  >
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
                    move {m.moveCount}
                    {m.spectatorCount > 0 && <> • <Eye size={9} className="inline" /> {m.spectatorCount}</>}
                  </div>
                </div>
                <ArcadeLinkButton href={`/reversi/${m.id}`} tone="primary" size="xs">
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
        icon: <CircleDot size={18} />,
        title: 'Reversi',
        subtitle: 'Flank to flip. Outscore your opponent. Ranked against bots or friends.',
      }}
    >
      <MultiplayerLobby
        gameType="reversi"
        gameName="Reversi"
        accent="tickets"
        queue={queueAdapter}
        onOpenMatch={(id) => router.push(`/reversi/${id}`)}
        challenge={{
          mode: 'code-only',
          gameType: 'reversi',
          onCreateCodeInvite: createCodeInvite,
          onJoinByCode: joinMatch,
        }}
        bot={{
          difficulties: BOT_DIFFICULTY_OPTIONS.map((d) => ({
            id: d.id,
            label: d.label,
            sublabel: d.note,
          })),
          defaultDifficulty: 'medium',
          onStart: startBotMatch,
          note: (
            <>
              No timer — play at your own pace. Your disc:{' '}
              <span className="font-mono text-strong">{selectedColor}</span>.
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

      <GameLeaderboardModal open={showLeaderboard} onOpenChange={setShowLeaderboard} title='reversi board'>
        <GameLeaderboard gameType='reversi' modes={RANKED_AND_BOT_MODES} />
      </GameLeaderboardModal>
    </GamesShell>
  );
}

function MatchRow({
  match,
  viewerId,
  actionSlot,
}: {
  match: ReversiMatch;
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
    <div className="flex items-center justify-between gap-2 border-b border-soft px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-sm">
          <span className="font-medium">{opponentName ?? '(waiting)'}</span>
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
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span>{match.moveCount} moves</span>
          {isCompleted && match.winReason ? (
            <span>• by {formatWinReason(match.winReason)}</span>
          ) : null}
        </div>
      </div>
      {actionSlot}
    </div>
  );
}

function formatWinReason(reason: NonNullable<ReversiMatch['winReason']>): string {
  switch (reason) {
    case 'disc_majority': return 'most discs';
    case 'resignation': return 'resignation';
    case 'draw_full_board': return 'even board';
    case 'forfeit': return 'forfeit';
    default: return reason;
  }
}
