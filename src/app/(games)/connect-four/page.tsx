'use client';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArcadeButton, ArcadeLinkButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from '@/features/arcade/components/shell/game-shell';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import {
  LobbyChoice,
  LobbyRecord,
  LobbyRow,
  LobbySection,
  MultiplayerLobby,
  type LobbyQueueAdapter,
  type LobbyRowState,
} from '@/features/arcade/components/multiplayer-lobby';
import { type MultiplayerInviteResult } from '@/features/arcade/components/multiplayer-setup-panel';
import { subscribeLive } from '@/lib/liveEvents';
import type { ConnectFourMatch } from '@/features/arcade/lib/connect-four/types';
import { GameLeaderboard, RANKED_AND_BOT_MODES } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type LiveMatch = ConnectFourMatch & { spectatorCount: number };

// The ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HOW_TO: GameHowTo = {
  lines: [
    'Play now pairs you with the next player waiting.',
    'Practice plays a bot and leaves your rating alone.',
    'Challenge makes a link to send a friend.',
  ],
};

type MatchListResponse = {
  userId: string;
  myMatches: ConnectFourMatch[];
  openMatches: ConnectFourMatch[];
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
  foursGiven: number;
} | null;

type UserElo = {
  eloRating: number;
  tier: string;
  tierColor: string;
  peakElo: number;
  totalGames: number;
} | null;

// Client-side defaults for the zero-state stats card — must match STARTING_ELO
// and the corresponding tier row in connect-four-elo.ts. Hardcoded so we don't
// pull server code into the lobby bundle.
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
  foursGiven: 0,
};

const BOT_DIFFICULTY_OPTIONS: Array<{
  id: 'easy' | 'medium' | 'hard';
  label: string;
}> = [
  { id: 'easy',   label: 'easy' },
  { id: 'medium', label: 'medium' },
  { id: 'hard',   label: 'hard' },
];

export default function ConnectFourLobbyPage() {
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
  const [selectedColor, setSelectedColor] = useState<'red' | 'yellow' | 'random'>('random');
  // Practice starts in one tap at this level; the level is picked in the options.
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [clearingRecent, setClearingRecent] = useState(false);
  const autoJoinAttemptedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/connect-four/matches', { cache: 'no-store' }),
        fetch('/api/games/connect-four/stats', { cache: 'no-store' }),
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
      const res = await fetch(`/api/games/connect-four/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
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

  // Live updates. SSE on `connectFourLobby` is the primary signal (the realtime
  // allowlist now forwards it — broadcasts are live); the 30s interval is only a
  // safety-net backstop for a missed push, so it runs infrequently.
  useEffect(() => {
    const unsub = subscribeLive(['connectFourLobby'], () => { void load(); });
    const stopPolling = startVisiblePolling(load, 30_000);
    return () => { unsub(); stopPolling(); };
  }, [load]);

  const joinMatch = useCallback(async (matchId: string, inviteCode?: string) => {
    if (joiningId) return;
    setJoiningId(matchId);
    try {
      const res = await fetch('/api/games/connect-four/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to join.');
      router.push(`/connect-four/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [router, joiningId]);

  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/connect-four/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match.');
    void load();
    return {
      matchId: payload.match.id,
      openHref: `/connect-four/${payload.match.id}`,
      invite: payload.invite,
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
      router.replace(`/connect-four/${joinId}`);
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
          `/api/games/multiplayer/code?gameType=connect-four&code=${encodeURIComponent(code)}`,
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
          router.replace(`/connect-four/${matchId}`);
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
      const res = await fetch(`/api/games/connect-four/match/${matchId}/cancel`, { method: 'POST' });
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
      await fetch('/api/games/connect-four/matches/clear-recent', { method: 'POST' });
      void load();
    } finally {
      setClearingRecent(false);
    }
  }, [clearingRecent, load]);

  // Practice-vs-bot start: one tap at the level picked in the options.
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/connect-four/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, preferredColor: selectedColor }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to start bot match.');
    router.push(`/connect-four/${payload.match.id}`);
  }, [selectedColor, router]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/connect-four/match/queue', {
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
      const res = await fetch(`/api/games/connect-four/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/connect-four/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    },
    lobbyTopic: 'connectFourLobby',
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

  // Your rating in the strip, once it has loaded. Nothing until then.
  const stat = <GameStat value={userElo?.eloRating ?? null} label='rating' />;

  if (loading) {
    return (
      <GameShell
        game='connect-four'
        howTo={HOW_TO}
        below={
          <div className='flex items-center justify-center py-20'>
            <ArcadeLoading label='Loading the lobby.' />
          </div>
        }
      />
    );
  }

  // ── Slots handed to the shared lobby shell ─────────────────────────────

  const optionsSlot = (
    <>
      <LobbyChoice
        label='disc'
        value={selectedColor}
        onChange={setSelectedColor}
        options={[
          { id: 'random', label: 'random' },
          { id: 'red', label: 'red' },
          { id: 'yellow', label: 'yellow' },
        ]}
        note='Red drops first.'
      />
      <LobbyChoice
        label='practice'
        value={botDifficulty}
        onChange={setBotDifficulty}
        options={BOT_DIFFICULTY_OPTIONS.map((d) => ({ id: d.id, label: d.label, ariaLabel: `${d.label} bot` }))}
      />
    </>
  );

  // Sound and the rating moved into the shell's strip.
  const headerActions = <GameLeaderboardButton label='leaderboard' onClick={() => setShowLeaderboard(true)} />;

  const statsSlot = (() => {
    const displayElo = userElo ?? DEFAULT_USER_ELO;
    const s = stats ?? DEFAULT_USER_STATS;
    const facts: React.ReactNode[] = [];
    if (s.wins + s.losses + s.draws > 0) facts.push(<><Num value={s.winRate} />% won</>);
    if (s.bestStreak > 1) facts.push(<>best streak <Num value={s.bestStreak} /></>);
    return (
      <LobbyRecord
        rating={displayElo.eloRating}
        peak={displayElo.peakElo}
        wins={s.wins}
        losses={s.losses}
        draws={s.draws}
        facts={facts.length > 0 ? <>{joinFacts(facts)}.</> : null}
      />
    );
  })();

  const hasGames = myActive.length + openMatches.length + liveMatches.length + myRecent.length > 0;
  const openMatchesSlot = (
    <section className='ml-panel' aria-label='games'>
      {!hasGames ? (
        <p className='ml-empty'>No open games right now.</p>
      ) : (
        <>
          {myActive.length > 0 ? (
            <LobbySection title='your games'>
              {myActive.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  viewerId={data!.userId}
                  href={m.status === 'waiting' ? undefined : `/connect-four/${m.id}`}
                  actionSlot={
                    m.status === 'waiting' ? (
                      <ArcadeButton size='sm' onClick={() => cancelMatch(m.id)} disabled={cancellingId === m.id}>
                        cancel
                      </ArcadeButton>
                    ) : (
                      <ArcadeLinkButton href={`/connect-four/${m.id}`} size='sm'>
                        open
                      </ArcadeLinkButton>
                    )
                  }
                />
              ))}
            </LobbySection>
          ) : null}

          {openMatches.length > 0 ? (
            <LobbySection title='open games'>
              {openMatches.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  viewerId={data!.userId}
                  actionSlot={
                    <ArcadeButton size='sm' onClick={() => joinMatch(m.id)} disabled={joiningId === m.id}>
                      {joiningId === m.id ? <ArcadeLoadingDots /> : null}
                      join
                    </ArcadeButton>
                  }
                />
              ))}
            </LobbySection>
          ) : (
            <section className='ml-section'>
              <p className='ml-empty'>No open games right now.</p>
            </section>
          )}

          {liveMatches.length > 0 ? (
            <LobbySection title='live'>
              {liveMatches.slice(0, 5).map((m) => (
                <LobbyRow
                  key={m.id}
                  name={`${m.player1Name} vs ${m.player2Name ?? 'a player'}`}
                  meta={
                    <>
                      move <Num value={m.moveCount} />
                      {m.spectatorCount > 0 ? <>, <Num value={m.spectatorCount} /> watching</> : null}
                    </>
                  }
                  action={
                    <ArcadeLinkButton href={`/connect-four/${m.id}`} size='sm'>
                      watch
                    </ArcadeLinkButton>
                  }
                />
              ))}
            </LobbySection>
          ) : null}

          {hasRecentFinished ? (
            <LobbySection
              title='recent'
              count={myRecent.length}
              collapsible={recentIsAccordion}
              scroll
              action={
                <ArcadeButton tone='ghost' size='sm' onClick={clearRecent} disabled={clearingRecent}>
                  {clearingRecent ? 'clearing' : 'clear'}
                </ArcadeButton>
              }
            >
              {myRecent.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  viewerId={data!.userId}
                  href={`/connect-four/${m.id}`}
                  actionSlot={
                    <ArcadeLinkButton href={`/connect-four/${m.id}`} size='sm'>
                      review
                    </ArcadeLinkButton>
                  }
                />
              ))}
            </LobbySection>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <GameShell
      game="connect-four"
      stat={stat}
      howTo={HOW_TO}
      below={
        <>
          <MultiplayerLobby
            gameType="connect-four"
            gameName={renameGameNamesInText('Connect Four')}
            accent="primary"
            queue={queueAdapter}
            onOpenMatch={(id) => router.push(`/connect-four/${id}`)}
            challenge={{
              mode: 'code-only',
              gameType: 'connect-four',
              onCreateCodeInvite: createCodeInvite,
              onJoinByCode: joinMatch,
            }}
            bot={{
              difficulties: BOT_DIFFICULTY_OPTIONS.map((d) => ({ id: d.id, label: d.label })),
              defaultDifficulty: botDifficulty,
              onStart: startBotMatch,
              oneTap: true,
            }}
            optionsSlot={optionsSlot}
            headerActions={headerActions}
            statsSlot={statsSlot}
            openMatchesSlot={openMatchesSlot}
            error={error}
            onDismissError={() => setError(null)}
            guest={guest}
          />

          <GameLeaderboardModal open={showLeaderboard} onOpenChange={setShowLeaderboard} title='connect four board'>
            <GameLeaderboard gameType='connect-four' modes={RANKED_AND_BOT_MODES} />
          </GameLeaderboardModal>
        </>
      }
    />
  );
}

function MatchRow({
  match,
  viewerId,
  href,
  actionSlot,
}: {
  match: ConnectFourMatch;
  viewerId: string;
  href?: string;
  actionSlot: React.ReactNode;
}) {
  const opponentName = match.player1Id === viewerId ? match.player2Name : match.player1Name;
  const isCompleted = match.status === 'completed' || match.status === 'forfeited';
  const won = match.winnerId === viewerId;
  const drawn = match.result === '1/2-1/2';
  const state: LobbyRowState = isCompleted
    ? drawn
      ? { text: 'draw' }
      : won
        ? { text: 'won', tone: 'won' }
        : { text: 'lost', tone: 'lost' }
    : match.status === 'waiting'
      ? { text: 'open' }
      : match.currentTurn === viewerId
        ? { text: 'your move', tone: 'turn' }
        : { text: 'their move' };

  return (
    <LobbyRow
      name={opponentName ?? 'no one yet'}
      state={state}
      href={href}
      meta={
        match.moveCount > 0 || (isCompleted && match.winReason) ? (
          <>
            {match.moveCount > 0 ? <><Num value={match.moveCount} /> {match.moveCount === 1 ? 'move' : 'moves'}</> : null}
            {match.moveCount > 0 && isCompleted && match.winReason ? ', ' : null}
            {isCompleted && match.winReason ? formatWinReason(match.winReason) : null}
          </>
        ) : null
      }
      action={actionSlot}
    />
  );
}

/** "62% won, best streak 4" */
function joinFacts(parts: React.ReactNode[]): React.ReactNode {
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 ? ', ' : null}
      {part}
    </span>
  ));
}

function formatWinReason(reason: NonNullable<ConnectFourMatch['winReason']>): string {
  switch (reason) {
    case 'four_in_a_row': return 'four in a row';
    case 'resignation': return 'resignation';
    case 'draw_full_board': return 'full board';
    case 'forfeit': return 'forfeit';
    default: return reason;
  }
}
