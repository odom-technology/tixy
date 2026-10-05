'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArcadeButton, ArcadeLinkButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from '@/features/arcade/components/shell/game-shell';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameLeaderboard, RANKED_AND_BOT_MODES } from '@/features/arcade/components/game-leaderboard';
import {
  MultiplayerSetupPanel,
  type MultiplayerInviteResult,
} from '@/features/arcade/components/multiplayer-setup-panel';
import {
  LobbyChoice,
  LobbyRecord,
  LobbyRow,
  LobbySection,
  MultiplayerLobby,
  type LobbyQueueAdapter,
  type LobbyRowState,
} from '@/features/arcade/components/multiplayer-lobby';
import { subscribeLive } from '@/lib/liveEvents';
import {
  TIME_FORMAT_PRESETS,
  resolveTimeFormat,
  type ChessMatch,
} from '@/features/arcade/lib/chess/types';
import {
  CHESS_CHALLENGE_MAX_WAGER,
  CHESS_WAGER_INCREMENT,
  CHESS_WAGER_MIN,
} from '@/server/arcade/chess-wager-constants';
import { TournamentSection, PastTournamentsSection } from './_tournament-section';
import { EloChart, type EloChartPoint } from './_elo-chart';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type LiveMatch = ChessMatch & { spectatorCount: number };

// The ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HOW_TO: GameHowTo = {
  lines: [
    'Play now pairs you with the next player at your clock.',
    'Practice plays a bot and leaves your rating alone.',
    'Challenge sends a game to a friend, or a link to anyone.',
  ],
};

type MatchListResponse = {
  userId: string;
  myMatches: ChessMatch[];
  openMatches: ChessMatch[];
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
  checkmatesGiven: number;
  timeouts: number;
} | null;

type UserElo = {
  eloRating: number;
  tier: string;
  tierColor: string;
  peakElo: number;
  totalGames: number;
} | null;

// Client-side defaults for the zero-state stats card — these must match
// `STARTING_ELO` and the corresponding tier row in `src/server/arcade/chess-elo.ts`.
// Hardcoded so we don't pull server code into the lobby bundle.
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
  checkmatesGiven: 0,
  timeouts: 0,
};

// Bot difficulty labels + approximate chess.com rapid ratings. These are
// estimates (engine strength varies with position complexity), but accurate
// enough for players choosing an opponent. Keep in sync with
// BOT_CHESSCOM_ELO_ESTIMATE in `src/server/arcade/chess-bot.ts`.
const BOT_DIFFICULTY_OPTIONS: Array<{
  id: 'easy' | 'medium' | 'hard';
  label: string;
  eloEstimate: number;
}> = [
  { id: 'easy',   label: 'easy',   eloEstimate: 800 },
  { id: 'medium', label: 'medium', eloEstimate: 1700 },
  { id: 'hard',   label: 'hard',   eloEstimate: 2400 },
];


export default function ChessLobbyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<MatchListResponse | null>(null);
  const [stats, setStats] = useState<UserStats>(null);
  const [userElo, setUserElo] = useState<UserElo>(null);
  const [eloHistory, setEloHistory] = useState<EloChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Signed out: the matches request came back 401. Not an error; the lobby
  // shows play, practice and challenge and asks for sign-in in place.
  const [guest, setGuest] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState('blitz');
  const [selectedColor, setSelectedColor] = useState<'white' | 'black' | 'random'>('random');
  // Practice starts in one tap at this level; the level is picked in the options.
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [showInventory, setShowInventory] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [challengeWager, setChallengeWager] = useState(0);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [clearingRecent, setClearingRecent] = useState(false);
  const autoJoinAttemptedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/chess/matches', { cache: 'no-store' }),
        fetch('/api/games/chess/stats', { cache: 'no-store' }),
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
      const res = await fetch(`/api/games/chess/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
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

  // Pull the caller's ELO timeline for graphing. Endpoint is auth-gated, so
  // kick off once we know the user has loaded (any userId; the route derives
  // its answer from the session, not the query string).
  useEffect(() => {
    if (!data?.userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/games/chess/elo-history', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as { points?: EloChartPoint[] };
        if (!cancelled) setEloHistory(payload.points ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [data?.userId]);

  // Live updates. SSE on `chessLobby` is the primary signal; the polling
  // interval is a safety net for missed broadcasts, not the main mechanism,
  // so it runs infrequently to avoid stacking refetches on top of realtime.
  useEffect(() => {
    const unsub = subscribeLive(['chessLobby'], () => { void load(); });
    const stopPolling = startVisiblePolling(load, 30_000);
    return () => { unsub(); stopPolling(); };
  }, [load]);

  const joinMatch = useCallback(async (matchId: string, inviteCode?: string) => {
    if (joiningId) return;
    setJoiningId(matchId);
    try {
      const res = await fetch('/api/games/chess/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to join.');
      router.push(`/chess/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [router, joiningId]);

  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/chess/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeFormatId: selectedFormat,
        preferredColor: selectedColor,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match.');
    void load();
    return {
      matchId: payload.match.id,
      invite: payload.invite,
    };
  }, [selectedFormat, selectedColor, load]);

  const inviteFriend = useCallback(async (targetUserId: string): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/chess/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId,
        wagerAmount: challengeWager > 0 ? challengeWager : undefined,
        timeFormatId: selectedFormat,
        preferredColor: selectedColor,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to send challenge.');
    router.push(`/chess/${payload.matchId}`);
    return { matchId: payload.matchId };
  }, [challengeWager, selectedFormat, selectedColor, router]);

  // Auto-join from deep link `?join=<matchId>`
  useEffect(() => {
    const joinId = searchParams.get('join');
    if (!joinId || !data || guest) return;
    const attemptKey = `join:${joinId}`;
    if (autoJoinAttemptedRef.current === attemptKey) return;
    const alreadyIn = data.myMatches.find(
      (m) => m.id === joinId && (m.player1Id === data.userId || m.player2Id === data.userId),
    );
    if (alreadyIn) {
      router.replace(`/chess/${joinId}`);
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
          `/api/games/multiplayer/code?gameType=chess&code=${encodeURIComponent(code)}`,
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
          router.replace(`/chess/${matchId}`);
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
      const res = await fetch(`/api/games/chess/match/${matchId}/cancel`, { method: 'POST' });
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

  const declineChallenge = useCallback(async (matchId: string) => {
    if (decliningId) return;
    setDecliningId(matchId);
    try {
      const res = await fetch(`/api/games/chess/match/${matchId}/decline`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to decline.');
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDecliningId(null);
    }
  }, [load, decliningId]);

  const clearRecent = useCallback(async () => {
    if (clearingRecent) return;
    setClearingRecent(true);
    try {
      await fetch('/api/games/chess/matches/clear-recent', { method: 'POST' });
      void load();
    } finally {
      setClearingRecent(false);
    }
  }, [clearingRecent, load]);

  // Practice-vs-bot start: one tap at the level picked in the options.
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/chess/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty,
        timeFormatId: selectedFormat,
        preferredColor: selectedColor,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to start bot match.');
    router.push(`/chess/${payload.match.id}`);
  }, [selectedFormat, selectedColor, router]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/chess/match/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeFormatId: selectedFormat, preferredColor: selectedColor }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to find a match.');
      void load();
      return { status: payload.status, matchId: payload.matchId };
    },
    poll: async (matchId) => {
      const res = await fetch(`/api/games/chess/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/chess/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void load();
    },
    lobbyTopic: 'chessLobby',
  }), [selectedFormat, selectedColor, load]);

  const myMatches = data?.myMatches ?? [];
  const openMatches = data?.openMatches ?? [];
  const liveMatches = data?.liveMatches ?? [];

  // Matches where I was invited and haven't joined yet — render as top banner.
  const incomingChallenges = data?.userId
    ? myMatches.filter(
        (m) =>
          m.status === 'waiting'
          && m.invitedUserId === data.userId
          && m.player1Id !== data.userId,
      )
    : [];

  // Split my matches into the actively-in-progress set (including my own
  // pending invites) and the recently-finished set. Recent matches collapse
  // into a History panel once there are 3+ so the lobby doesn't grow
  // unbounded for heavy players — mirrors the 8-ball pool pattern.
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

  // Your rating in the strip, once it has loaded. Nothing until then, and
  // nothing for a player with no rating yet: never a placeholder.
  const stat = <GameStat value={userElo?.eloRating ?? null} label='rating' />;

  if (loading) {
    return (
      <GameShell
        game='chess'
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
        label='clock'
        value={selectedFormat}
        onChange={setSelectedFormat}
        options={TIME_FORMAT_PRESETS.map((preset) => {
          const minutes = Math.round(preset.initialTimeMs / 60_000);
          const seconds = Math.round(preset.incrementMs / 1000);
          return {
            id: preset.id,
            label: preset.label.toLowerCase(),
            num: <Num value={`${minutes}+${seconds}`} />,
            ariaLabel: `${preset.label.toLowerCase()}, ${minutes} minutes plus ${seconds} ${seconds === 1 ? 'second' : 'seconds'} a move`,
          };
        })}
      />
      <LobbyChoice
        label='colour'
        value={selectedColor}
        onChange={setSelectedColor}
        options={[
          { id: 'random', label: 'random' },
          { id: 'white', label: 'white' },
          { id: 'black', label: 'black' },
        ]}
      />
      <LobbyChoice
        label='practice'
        value={botDifficulty}
        onChange={setBotDifficulty}
        options={BOT_DIFFICULTY_OPTIONS.map((d) => ({
          id: d.id,
          label: d.label,
          num: <Num value={String(d.eloEstimate)} />,
          ariaLabel: `${d.label} bot, rated about ${d.eloEstimate}`,
        }))}
      />
    </>
  );

  const bannersSlot = incomingChallenges.length > 0 ? (
    <>
      {incomingChallenges.map((m) => {
        const preset = resolveTimeFormat(m.timeFormat);
        return (
          <div key={m.id} className='ml-banner' role='status'>
            <p>
              <strong>{m.player1Name} challenged you</strong>
              <small>
                {preset.label.toLowerCase()}
                {m.wagerAmount ? <>, <Num value={m.wagerAmount} /> tickets each</> : null}, {timeAgo(m.createdAt)}
              </small>
            </p>
            <span className='ml-banner-actions'>
              <ArcadeButton
                tone='primary'
                onClick={() => joinMatch(m.id)}
                disabled={joiningId === m.id || decliningId === m.id}
              >
                {joiningId === m.id ? <ArcadeLoadingDots /> : null}
                accept
              </ArcadeButton>
              <ArcadeButton
                onClick={() => declineChallenge(m.id)}
                disabled={joiningId === m.id || decliningId === m.id}
              >
                decline
              </ArcadeButton>
            </span>
          </div>
        );
      })}
    </>
  ) : null;

  // Sound and the rating moved into the shell's strip.
  const headerActions = (
    <>
      <GameLeaderboardButton label='leaderboard' onClick={() => setShowLeaderboard(true)} />
      <GameInventoryButton label='inventory' onClick={() => setShowInventory(true)} />
    </>
  );

  const challengePanel = (
    <MultiplayerSetupPanel
      gameType='chess'
      gameName='Chess'
      onInviteFriend={inviteFriend}
      onCreateCodeInvite={createCodeInvite}
      onJoinMatch={joinMatch}
      inviteSettings={
        <label className='ml-choice'>
          <span className='ml-choice-label'>tickets each</span>
          <input
            type='number'
            min={0}
            max={CHESS_CHALLENGE_MAX_WAGER}
            step={CHESS_WAGER_INCREMENT}
            value={challengeWager}
            onChange={(event) => {
              const n = Math.trunc(Number(event.target.value) || 0);
              if (n === 0) {
                setChallengeWager(0);
                return;
              }
              setChallengeWager(Math.max(CHESS_WAGER_MIN, Math.min(CHESS_CHALLENGE_MAX_WAGER, n)));
            }}
            className='arcade-input arcade-num px-3'
          />
        </label>
      }
    />
  );

  const statsSlot = (() => {
    const displayElo = userElo ?? DEFAULT_USER_ELO;
    const s = stats ?? DEFAULT_USER_STATS;
    const facts: React.ReactNode[] = [];
    if (s.wins + s.losses + s.draws > 0) facts.push(<><Num value={s.winRate} />% won</>);
    if (s.bestStreak > 1) facts.push(<>best streak <Num value={s.bestStreak} /></>);
    if (s.checkmatesGiven > 0) {
      facts.push(<><Num value={s.checkmatesGiven} /> {s.checkmatesGiven === 1 ? 'checkmate' : 'checkmates'}</>);
    }
    return (
      <LobbyRecord
        rating={displayElo.eloRating}
        peak={displayElo.peakElo}
        wins={s.wins}
        losses={s.losses}
        draws={s.draws}
        facts={facts.length > 0 ? <>{joinFacts(facts)}.</> : null}
      >
        {eloHistory.length >= 2 ? (
          <div className='ml-chart'>
            <EloChart points={eloHistory} />
          </div>
        ) : null}
      </LobbyRecord>
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
                  href={m.status === 'waiting' ? undefined : `/chess/${m.id}`}
                  actionSlot={
                    m.status === 'waiting' ? (
                      <ArcadeButton size='sm' onClick={() => cancelMatch(m.id)} disabled={cancellingId === m.id}>
                        cancel
                      </ArcadeButton>
                    ) : (
                      <ArcadeLinkButton href={`/chess/${m.id}`} size='sm'>
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
                      {resolveTimeFormat(m.timeFormat).label.toLowerCase()}, move <Num value={m.moveCount} />
                      {m.spectatorCount > 0 ? <>, <Num value={m.spectatorCount} /> watching</> : null}
                    </>
                  }
                  action={
                    <ArcadeLinkButton href={`/chess/${m.id}`} size='sm'>
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
                  href={`/chess/${m.id}`}
                  actionSlot={
                    <ArcadeLinkButton href={`/chess/${m.id}`} size='sm'>
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
      game='chess'
      stat={stat}
      howTo={HOW_TO}
      below={
        <>
          {/* Puzzles is blitz tactics, which keeps its own page. */}
          <nav aria-label='chess' className='ml-tabs'>
            <span aria-current='page'>play</span>
            <Link href='/blitz-tactics'>puzzles</Link>
          </nav>

          <MultiplayerLobby
            gameType='chess'
            gameName='Chess'
            accent='primary'
            queue={queueAdapter}
            onOpenMatch={(id) => router.push(`/chess/${id}`)}
            challenge={{ mode: 'friends', panel: challengePanel }}
            bot={{
              difficulties: BOT_DIFFICULTY_OPTIONS.map((d) => ({
                id: d.id,
                label: d.label,
                sublabel: `~${d.eloEstimate} elo`,
              })),
              defaultDifficulty: botDifficulty,
              onStart: startBotMatch,
              oneTap: true,
            }}
            optionsSlot={optionsSlot}
            bannersSlot={bannersSlot}
            headerActions={headerActions}
            statsSlot={statsSlot}
            openMatchesSlot={openMatchesSlot}
            extrasSlot={
              <>
                <TournamentSection />
                <PastTournamentsSection />
              </>
            }
            error={error}
            onDismissError={() => setError(null)}
            guest={guest}
          />

          <GameInventoryModal
            open={showInventory}
            onOpenChange={setShowInventory}
            gameType='chess'
            title='chess inventory'
            description='Pick skins for pieces, board, and clock. Player cards are shared with 8-ball: equip one here and it applies in both games.'
            extraSlots={[
              { gameType: '8-ball', slot: 'playercard', label: 'Player card' },
            ]}
          />

          <GameLeaderboardModal
            open={showLeaderboard}
            onOpenChange={setShowLeaderboard}
            title='chess leaderboards'
            description='Ranked elo and bot speed-run records.'
          >
            <GameLeaderboard gameType='chess' modes={RANKED_AND_BOT_MODES} />
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
  match: ChessMatch;
  viewerId: string;
  href?: string;
  actionSlot: React.ReactNode;
}) {
  const preset = resolveTimeFormat(match.timeFormat);
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
        <>
          {preset.label.toLowerCase()}
          {match.moveCount > 0 ? <>, <Num value={match.moveCount} /> {match.moveCount === 1 ? 'move' : 'moves'}</> : null}
          {isCompleted && match.winReason ? <>, {formatWinReason(match.winReason)}</> : null}
          {match.wagerAmount ? <>, <Num value={match.wagerAmount} /> tickets</> : null}
        </>
      }
      action={actionSlot}
    />
  );
}

/** "62% won, best streak 4, 12 checkmates" */
function joinFacts(parts: React.ReactNode[]): React.ReactNode {
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 ? ', ' : null}
      {part}
    </span>
  ));
}

/** Human-readable label for a chess `WinReason` used in the match list. */
function formatWinReason(reason: NonNullable<ChessMatch['winReason']>): string {
  switch (reason) {
    case 'checkmate': return 'checkmate';
    case 'resignation': return 'resignation';
    case 'timeout': return 'timeout';
    case 'draw_agreement': return 'agreed';
    case 'stalemate': return 'stalemate';
    case 'threefold': return 'repetition';
    case 'fifty_move': return '50-move rule';
    case 'insufficient_material': return 'no mating material';
    case 'forfeit': return 'forfeit';
    default: return reason;
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} d ago`;
}
