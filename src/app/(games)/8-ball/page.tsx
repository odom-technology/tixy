'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GameLeaderboard, RANKED_AND_BOT_MODES } from '@/features/arcade/components/game-leaderboard';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import {
  MultiplayerSetupPanel,
  type MultiplayerInviteResult,
} from '@/features/arcade/components/multiplayer-setup-panel';
import {
  LobbyChoice,
  LobbySignInRequired,
  MultiplayerLobby,
  type LobbyQueueAdapter,
} from '@/features/arcade/components/multiplayer-lobby';
import {
  GameShell,
  GameStage,
  GameStat,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import { SignInLine } from '@/features/arcade/components/shell/sign-in-prompt';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { Num } from '@/features/arcade/components/ui/num';
import { useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { createBreakRack } from '@/features/arcade/lib/pool-physics';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import type { PoolMatch } from '@/server/arcade/pool-match';
import { POOL_WAGER_INCREMENT } from '@/server/arcade/pool-wager-constants';
import { TournamentSection, PastTournamentsSection } from './_tournament-section';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { PoolCanvas } from './[id]/_pool-canvas';
import { POOL_HOW_TO, PRACTICE_LEVELS, usePracticeLevel, type PracticeLevel } from './_pool-shell';

/** What a practice win pays at each level, as POOL_HOW_TO says. */
const PRACTICE_PAY: Record<PracticeLevel, number> = { easy: 30, medium: 50, hard: 72 };

type UserStats = {
  wins: number;
  losses: number;
  forfeits: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  totalShots: number;
  totalBallsPocketed: number;
  accuracy: number;
} | null;

type UserElo = {
  eloRating: number;
  tier: string;
  tierColor: string;
  peakElo: number;
  totalGames: number;
} | null;

type LiveMatch = PoolMatch & { spectatorCount: number };

type MatchListResponse = {
  userId: string;
  myMatches: PoolMatch[];
  openMatches: PoolMatch[];
  liveMatches?: LiveMatch[];
  error?: string;
};

type ChallengeUser = {
  userId: string;
  name: string;
  email: string;
  imageUrl: string | null;
};

export default function EightBallLobbyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<MatchListResponse | null>(null);
  const [stats, setStats] = useState<UserStats>(null);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed out: the matches request came back 401. Not an error; the lobby
  // shows play, practice and challenge and asks for sign-in in place.
  const [guest, setGuest] = useState(false);
  const [challengeUsers, setChallengeUsers] = useState<ChallengeUser[]>([]);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeWager, setChallengeWager] = useState(0);
  const [challengeHardcore, setChallengeHardcore] = useState(false);
  // A forfeit from the list asks first, in the shell's dialog.
  const [forfeitTarget, setForfeitTarget] = useState<PoolMatch | null>(null);
  const [practiceLevel, setPracticeLevel] = usePracticeLevel();
  const { trigger } = useGameFeedback();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userElo, setUserElo] = useState<UserElo>(null);
  const [eloHistoryMap, setEloHistoryMap] = useState<Map<string, number>>(new Map());
  const [clearingRecent, setClearingRecent] = useState(false);
  const autoCodeJoinAttemptedRef = useRef<string | null>(null);

  const loadMatches = useCallback(async () => {
    try {
      const [matchRes, statsRes] = await Promise.all([
        fetch('/api/games/8-ball/matches', { cache: 'no-store' }),
        fetch('/api/games/8-ball/stats', { cache: 'no-store' }),
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
      if (currentUserId === null && typeof matchPayload.userId === 'string') {
        setCurrentUserId(matchPayload.userId);
      }
      if (statsRes.ok) {
        const statsPayload = await statsRes.json();
        setStats(statsPayload.stats);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  const loadUserElo = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/games/8-ball/elo-leaderboard?userId=${uid}`, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        if (d.player) {
          setUserElo({ eloRating: d.player.eloRating, tier: d.player.tier, tierColor: d.player.tierColor, peakElo: d.player.peakElo, totalGames: d.player.totalGames });
        }
        if (d.history) {
          const map = new Map<string, number>();
          for (const h of d.history) map.set(h.matchId, h.eloChange);
          setEloHistoryMap(map);
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetch('/api/users/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.userId) {
          setCurrentUserId(d.userId);
          void loadUserElo(d.userId);
        }
      })
      .catch(() => {});
  }, [loadUserElo]);

  useEffect(() => {
    let cancelled = false;
    const loadChallengeUsers = async () => {
      setChallengeLoading(true);
      try {
        const response = await fetch('/api/games/8-ball/challenge-users', { cache: 'no-store' });
        // Signed out: no one to challenge yet. Not an error.
        if (response.status === 401) return;
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to load user list');
        if (!cancelled) setChallengeUsers(payload.users ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setChallengeLoading(false);
      }
    };
    void loadChallengeUsers();
    return () => { cancelled = true; };
  }, []);

  // Live lobby updates (poolLobby SSE) + a slow safety-net poll.
  useEffect(() => {
    void loadMatches();
    const unsub = subscribeLive(['poolLobby'], () => { void loadMatches(); });
    const stopPolling = startVisiblePolling(loadMatches, 15_000);
    return () => { unsub(); stopPolling(); };
  }, [loadMatches]);

  const joinFromNotification = searchParams.get('join');

  const challengeUserNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of challengeUsers) map.set(entry.userId, entry.name);
    return map;
  }, [challengeUsers]);

  const handleJoin = useCallback(async (matchId: string, inviteCode?: string) => {
    setJoiningId(matchId);
    setError(null);
    try {
      const res = await fetch('/api/games/8-ball/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, ...(inviteCode && { inviteCode }) }),
      });
      const payload = await res.json();
      if (!res.ok) {
        const message = payload?.error || 'Failed to join';
        const staleRequest =
          res.status === 404 ||
          res.status === 409 ||
          message.toLowerCase().includes('not found') ||
          message.toLowerCase().includes('not open') ||
          message.toLowerCase().includes('claimed');
        if (staleRequest) {
          setError('That challenge is closed.');
          router.replace('/8-ball', { scroll: false });
          void loadMatches();
          return;
        }
        throw new Error(message);
      }
      router.push(`/8-ball/${matchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }, [loadMatches, router]);

  const handleDeclineInvite = async (matchId: string) => {
    setDecliningId(matchId);
    setError(null);
    try {
      const res = await fetch(`/api/games/8-ball/match/${matchId}/cancel`, { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || 'Unable to decline challenge';
        const staleRequest = res.status === 404 || message.toLowerCase().includes('not found');
        if (staleRequest) {
          setError('That challenge is already closed.');
          router.replace('/8-ball', { scroll: false });
          void loadMatches();
          return;
        }
        throw new Error(message);
      }
      router.replace('/8-ball', { scroll: false });
      void loadMatches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDecliningId(null);
    }
  };

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code || !data || guest) return;
    const attemptKey = code.trim().toUpperCase();
    if (autoCodeJoinAttemptedRef.current === attemptKey) return;
    autoCodeJoinAttemptedRef.current = attemptKey;

    void (async () => {
      try {
        const res = await fetch(
          `/api/games/multiplayer/code?gameType=8-ball&code=${encodeURIComponent(code)}`,
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
          router.replace(`/8-ball/${matchId}`);
          return;
        }
        await handleJoin(matchId, payload.invite.code);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [guest, searchParams, data, router, handleJoin]);

  // Practice in one tap, at the level from the table menu (medium until the
  // player picks one). Guests may practice when the server allows it; a 401
  // means it doesn't, and the lobby asks them to sign in.
  const startBotMatch = useCallback(async (difficulty: string) => {
    const res = await fetch('/api/games/8-ball/match/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    });
    if (res.status === 401) throw new LobbySignInRequired();
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.match?.id) throw new Error(payload.error || 'The table could not be racked.');
    router.push(`/8-ball/${payload.match.id}`);
  }, [router]);

  const createCodeInvite = useCallback(async (): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/8-ball/match', { method: 'POST' });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to create match');
    void loadMatches();
    return { matchId: payload.match.id, invite: payload.invite };
  }, [loadMatches]);

  const inviteFriend = useCallback(async (targetUserId: string): Promise<MultiplayerInviteResult> => {
    const res = await fetch('/api/games/8-ball/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId,
        ...(challengeWager > 0 && { wagerAmount: challengeWager }),
        ...(challengeHardcore && { hardcoreMode: true }),
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to send challenge');
    // They had already challenged you, with the same stake and rules: the
    // route hands back their table, and you join it.
    if (payload.inviteFromTarget) {
      await handleJoin(payload.matchId);
      return { matchId: payload.matchId };
    }
    router.push(`/8-ball/${payload.matchId}`);
    return { matchId: payload.matchId };
  }, [challengeWager, challengeHardcore, router, handleJoin]);

  // Shared quick-match adapter — wires PLAY to the transactional queue endpoint.
  const queueAdapter: LobbyQueueAdapter = useMemo(() => ({
    start: async () => {
      const res = await fetch('/api/games/8-ball/match/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to find a match.');
      void loadMatches();
      return { status: payload.status, matchId: payload.matchId };
    },
    poll: async (matchId) => {
      const res = await fetch(`/api/games/8-ball/match/${matchId}`, { cache: 'no-store' });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'waiting';
      const payload = await res.json().catch(() => null);
      const status = payload?.match?.status;
      if (status === 'active') return 'active';
      if (status === 'waiting') return 'waiting';
      return 'gone';
    },
    cancel: async (matchId) => {
      const res = await fetch(`/api/games/8-ball/match/${matchId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to cancel.');
      }
      void loadMatches();
    },
    lobbyTopic: 'poolLobby',
  }), [loadMatches]);

  const handleCancelMatch = async (matchId: string) => {
    setActionId(matchId);
    try {
      await fetch(`/api/games/8-ball/match/${matchId}/cancel`, { method: 'POST' });
      void loadMatches();
    } catch {
      setError('The table could not be closed.');
    } finally {
      setActionId(null);
    }
  };

  const handleForfeitMatch = async (matchId: string) => {
    setForfeitTarget(null);
    setActionId(matchId);
    try {
      await fetch(`/api/games/8-ball/match/${matchId}/forfeit`, { method: 'POST' });
      void loadMatches();
    } catch {
      setError('The forfeit did not go through.');
    } finally {
      setActionId(null);
    }
  };

  const handleClearRecentMatches = async () => {
    if (myRecent.length === 0 || clearingRecent) return;
    if (!confirm('Delete your finished 8-ball games from this list? This cannot be undone.')) return;

    setClearingRecent(true);
    setError(null);
    try {
      const response = await fetch('/api/games/8-ball/matches/clear-recent', { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to clear recent matches');
      void loadMatches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearingRecent(false);
    }
  };

  const incomingChallenges =
    currentUserId === null
      ? []
      : (data?.myMatches.filter(
          (m) =>
            m.status === 'waiting' &&
            m.player2Id === null &&
            m.invitedUserId === currentUserId &&
            m.player1Id !== currentUserId,
        ) ?? []);
  const notificationChallenge = joinFromNotification
    ? incomingChallenges.find((challenge) => challenge.id === joinFromNotification)
    : null;
  const myActive =
    currentUserId === null
      ? []
      : (data?.myMatches.filter(
          (m) => m.status === 'active' || (m.status === 'waiting' && m.player1Id === currentUserId),
        ) ?? []);
  const myRecent = data?.myMatches.filter(
    (m) => m.status === 'completed' || m.status === 'forfeited',
  ).slice(0, 20) ?? [];
  const open = data?.openMatches ?? [];
  const liveMatches = data?.liveMatches ?? [];

  const challengePanel = (
    <MultiplayerSetupPanel
      gameType='8-ball'
      gameName='8-ball'
      onInviteFriend={inviteFriend}
      onCreateCodeInvite={createCodeInvite}
      onJoinMatch={handleJoin}
      disabled={challengeLoading}
      inviteSettings={
        <div className='flex flex-wrap items-center gap-4'>
          <label className='flex items-center gap-2 text-xs text-faint'>
            <span className='font-medium'>wager</span>
            <input
              type='number'
              min={0}
              step={POOL_WAGER_INCREMENT}
              value={challengeWager || ''}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                setChallengeWager(Math.max(0, Math.trunc(Number.isFinite(parsed) ? parsed : 0)));
              }}
              placeholder='0'
              className='arcade-input arcade-num w-28 px-2 py-1.5 text-sm'
            />
            <span>tickets</span>
          </label>
          <label className='flex cursor-pointer items-center gap-2 text-xs text-faint'>
            <input
              type='checkbox'
              checked={challengeHardcore}
              onChange={(e) => setChallengeHardcore(e.target.checked)}
              className='h-4 w-4 rounded border-soft accent-[var(--enamel-danger)]'
            />
            <span className='font-medium text-danger-text'>hardcore</span>
          </label>
        </div>
      }
    />
  );


  // ── The racked table ────────────────────────────────────────────────
  const rack = useMemo(() => createBreakRack(), []);
  const rackCue = useMemo(() => {
    const cue = rack.find((b) => b.id === 0);
    return cue ? { angle: 0, power: 0.35, cuePos: cue.pos } : null;
  }, [rack]);
  const [stageSize, setStageSize] = useState<GameStageSize | null>(null);
  const fitTable = useCallback((size: GameStageSize) => setStageSize(size), []);

  const stat = <GameStat value={guest ? null : (userElo?.eloRating ?? null)} label='rating' />;
  const invite = notificationChallenge ?? incomingChallenges[0] ?? null;
  const restIncoming = invite ? incomingChallenges.filter((c) => c.id !== invite.id) : incomingChallenges;
  const closedInvite = Boolean(joinFromNotification && !notificationChallenge && !loading && !guest && data);
  // The line under the rail says only what the rail can't: a guest can
  // still practice, and how many tables are open now.
  const hint = guest
    ? 'Practice needs no account.'
    : open.length > 0
      ? `${open.length} ${open.length === 1 ? 'table' : 'tables'} open.`
      : undefined;

  return (
    <MultiplayerLobby
      gameType='8-ball'
      gameName='8-ball'
      accent='primary'
      queue={queueAdapter}
      onOpenMatch={(id) => router.push(`/8-ball/${id}`)}
      challenge={{ mode: 'friends', panel: challengePanel }}
      bot={{
        difficulties: PRACTICE_LEVELS.map((id) => ({ id, label: id })),
        defaultDifficulty: practiceLevel,
        onStart: startBotMatch,
        oneTap: true,
        guests: true,
      }}
      error={error}
      onDismissError={() => setError(null)}
      guest={guest}
      layout={(lobby) => (
        <GameShell
          game='8-ball'
          stat={stat}
          howTo={POOL_HOW_TO}
          className='pool-midway'
          below={
            <PoolLobbyBelow
              guest={lobby.guest}
              error={lobby.error}
              onDismissError={lobby.dismissError}
              sections={{
                incoming: restIncoming,
                active: myActive,
                open,
                live: liveMatches,
                recent: myRecent,
              }}
              currentUserId={currentUserId ?? data?.userId ?? null}
              challengeUserNameById={challengeUserNameById}
              eloHistoryMap={eloHistoryMap}
              stats={stats}
              userElo={userElo}
              joiningId={joiningId}
              decliningId={decliningId}
              actionId={actionId}
              clearingRecent={clearingRecent}
              onJoin={(id) => void handleJoin(id)}
              onDecline={(id) => void handleDeclineInvite(id)}
              onCancel={(id) => void handleCancelMatch(id)}
              onForfeit={(id) => setForfeitTarget(myActive.find((m) => m.id === id) ?? null)}
              onClearRecent={() => void handleClearRecentMatches()}
              onLeaderboard={() => setShowLeaderboard(true)}
              onInventory={() => setShowInventory(true)}
              practiceLevel={practiceLevel}
              onPracticeLevel={(level) => { trigger('press', { haptic: true }); setPracticeLevel(level); }}
            />
          }
        >
          <GameStage
            phase='ready'
            hint={hint}
            onSize={fitTable}
            controls={
              <div className='pool-rail' data-surface='ink'>
                {lobby.play.queued ? (
                  <div className='pool-rail-queue'>{lobby.play.queueCard}</div>
                ) : (
                  <ArcadeButton
                    tone='primary'
                    size='lg'
                    disabled={lobby.play.busy}
                    onClick={() => { trigger('press', { haptic: true }); lobby.play.onPress(); }}
                  >
                    play now
                  </ArcadeButton>
                )}
                {lobby.play.queued ? null : (
                  <>
                    <ArcadeButton
                      size='lg'
                      onClick={() => { trigger('press', { haptic: true }); lobby.challenge.onPress(); }}
                    >
                      challenge
                    </ArcadeButton>
                    {lobby.practice ? (
                      <ArcadeButton
                        size='lg'
                        disabled={lobby.practice.busy}
                        aria-label={`practice against the ${practiceLevel} bot`}
                        onClick={() => { trigger('press', { haptic: true }); lobby.practice?.onPress(); }}
                      >
                        {lobby.practice.busy ? 'racking' : 'practice'}
                      </ArcadeButton>
                    ) : null}
                  </>
                )}
              </div>
            }
          >
            <div className='pool-table'>
              <PoolCanvas
                balls={rack}
                cueStick={rackCue}
                fitBox={stageSize ? { width: stageSize.width - 8, height: stageSize.height - 8 } : null}
                canvasClassName='block'
              />
            </div>
            {invite ? (
              <div className='pool-invite' role='status'>
                <p>
                  <strong>{invite.player1Name} wants a game</strong>
                  <small>
                    {timeAgo(invite.createdAt)}
                    {invite.wagerAmount ? <>, <Num value={invite.wagerAmount} /> tickets each</> : null}
                    {invite.hardcoreMode ? ', hardcore' : null}
                  </small>
                </p>
                <span className='pool-invite-actions'>
                  <ArcadeButton
                    tone='primary'
                    size='sm'
                    disabled={joiningId === invite.id || decliningId === invite.id}
                    onClick={() => { trigger('press', { haptic: true }); void handleJoin(invite.id); }}
                  >
                    accept
                  </ArcadeButton>
                  <ArcadeButton
                    size='sm'
                    disabled={joiningId === invite.id || decliningId === invite.id}
                    onClick={() => { trigger('press', { haptic: true }); void handleDeclineInvite(invite.id); }}
                  >
                    decline
                  </ArcadeButton>
                </span>
              </div>
            ) : closedInvite ? (
              <div className='pool-invite' role='status'>
                <p><strong>That challenge is closed.</strong></p>
                <span className='pool-invite-actions'>
                  <ArcadeButton size='sm' onClick={() => router.replace('/8-ball', { scroll: false })}>ok</ArcadeButton>
                </span>
              </div>
            ) : null}
          </GameStage>

          {lobby.dialogs}

          <ArcadeDialog open={forfeitTarget != null} onClose={() => setForfeitTarget(null)} title='forfeit this match?' maxWidth={384}>
            {forfeitTarget ? (
              <div className='pool-menu'>
                <p>
                  It counts as a loss
                  {forfeitTarget.wagerAmount
                    ? forfeitTarget.moveCount < 4
                      ? <>, and both stakes of <Num value={forfeitTarget.wagerAmount} /> tickets go back</>
                      : <>, and your <Num value={forfeitTarget.wagerAmount} /> tickets on the table go to the other player</>
                    : null}.
                </p>
                <div className='pool-menu-row'>
                  <ArcadeButton onClick={() => setForfeitTarget(null)}>keep playing</ArcadeButton>
                  <ArcadeButton tone='danger' onClick={() => void handleForfeitMatch(forfeitTarget.id)}>forfeit</ArcadeButton>
                </div>
              </div>
            ) : null}
          </ArcadeDialog>

          <GameLeaderboardModal
            open={showLeaderboard}
            onOpenChange={setShowLeaderboard}
            title='8-ball leaderboards'
            description='Ranked rating and the fastest wins against each bot.'
          >
            <GameLeaderboard gameType='8-ball' modes={RANKED_AND_BOT_MODES} />
          </GameLeaderboardModal>

          <GameInventoryModal
            open={showInventory}
            onOpenChange={setShowInventory}
            gameType='8-ball'
            title='8-ball skins'
            description='Cue, table, balls and player card.'
          />
        </GameShell>
      )}
    />
  );
}

// ── Under the cabinet: quiet lists ────────────────────────────────────

type BelowProps = {
  guest: boolean;
  error: string | null;
  onDismissError: () => void;
  sections: {
    incoming: PoolMatch[];
    active: PoolMatch[];
    open: PoolMatch[];
    live: LiveMatch[];
    recent: PoolMatch[];
  };
  currentUserId: string | null;
  challengeUserNameById: Map<string, string>;
  eloHistoryMap: Map<string, number>;
  stats: UserStats;
  userElo: UserElo;
  joiningId: string | null;
  decliningId: string | null;
  actionId: string | null;
  clearingRecent: boolean;
  onJoin: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
  onForfeit: (id: string) => void;
  onClearRecent: () => void;
  onLeaderboard: () => void;
  onInventory: () => void;
  practiceLevel: PracticeLevel;
  onPracticeLevel: (level: PracticeLevel) => void;
};

function PoolLobbyBelow({
  guest,
  error,
  onDismissError,
  sections,
  currentUserId,
  challengeUserNameById,
  eloHistoryMap,
  stats,
  userElo,
  joiningId,
  decliningId,
  actionId,
  clearingRecent,
  onJoin,
  onDecline,
  onCancel,
  onForfeit,
  onClearRecent,
  onLeaderboard,
  onInventory,
  practiceLevel,
  onPracticeLevel,
}: BelowProps) {
  const [recentOpen, setRecentOpen] = useState(false);
  const { incoming, active, open, live, recent } = sections;
  const opponentOf = (m: PoolMatch) => {
    if (m.status === 'waiting' || !m.player2Name) {
      const invited = m.invitedUserId ? challengeUserNameById.get(m.invitedUserId) : null;
      return invited ? `waiting for ${invited}` : 'waiting for a player';
    }
    const name = currentUserId !== null && m.player1Id === currentUserId ? m.player2Name : m.player1Name;
    return (name ?? 'a player').replace(/ \(bot\)$/i, '');
  };

  const played = (stats?.wins ?? 0) + (stats?.losses ?? 0);
  const rating = userElo?.eloRating ?? 1200;

  return (
    <div className='pool-below'>
      {/* Practice's level, under the rail: practice starts at it in one tap. */}
      <section className='pool-section'>
        <h2>practice</h2>
        <div className='pool-practice'>
          <LobbyChoice
            label='level'
            value={practiceLevel}
            onChange={onPracticeLevel}
            options={PRACTICE_LEVELS.map((level) => ({ id: level, label: level, ariaLabel: `${level} bot` }))}
          />
          {guest ? null : (
            <p>
              A win on {practiceLevel} pays <Num value={PRACTICE_PAY[practiceLevel]} /> tickets.
            </p>
          )}
        </div>
      </section>

      {error ? (
        <p className='pool-wide flex items-center justify-between gap-3 rounded-panel bg-panel px-4 py-3 text-sm text-body' role='alert'>
          <span>{error}</span>
          <ArcadeButton size='sm' onClick={onDismissError}>ok</ArcadeButton>
        </p>
      ) : null}

      {guest ? (
        <SignInLine className='pool-wide' action='keep your games, rating and tickets' />
      ) : (
        <>
          {incoming.length > 0 ? (
            <section className='pool-section'>
              <h2>challenges</h2>
              <ul className='pool-list'>
                {incoming.map((c) => (
                  <li key={c.id}>
                    <span className='pool-list-main'>
                      <strong>{c.player1Name}</strong>
                      <small>
                        {timeAgo(c.createdAt)}
                        {c.wagerAmount ? <>, <Num value={c.wagerAmount} /> tickets each</> : null}
                        {c.hardcoreMode ? ', hardcore' : null}
                      </small>
                    </span>
                    <ArcadeButton tone='primary' size='sm' disabled={joiningId === c.id || decliningId === c.id} onClick={() => onJoin(c.id)}>accept</ArcadeButton>
                    <ArcadeButton size='sm' disabled={joiningId === c.id || decliningId === c.id} onClick={() => onDecline(c.id)}>decline</ArcadeButton>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {active.length > 0 ? (
            <section className='pool-section'>
              <h2>your tables</h2>
              <ul className='pool-list'>
                {active.map((m) => {
                  const waiting = m.status === 'waiting';
                  const myShot = !waiting && m.currentTurn === currentUserId;
                  return (
                    <li key={m.id}>
                      <Link href={`/8-ball/${m.id}`} className='pool-list-main'>
                        <strong>{waiting ? opponentOf(m) : `vs ${opponentOf(m)}`}</strong>
                        <small data-turn={myShot || undefined}>
                          {waiting ? 'open table' : myShot ? 'your shot' : 'their shot'}
                          {!waiting ? <>, shot <Num value={m.moveCount + 1} /></> : null}
                        </small>
                      </Link>
                      <ArcadeButton
                        size='sm'
                        disabled={actionId === m.id}
                        onClick={() => (waiting ? onCancel(m.id) : onForfeit(m.id))}
                      >
                        {waiting ? 'close' : 'forfeit'}
                      </ArcadeButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {open.length > 0 ? (
            <section className='pool-section'>
              <h2>open tables</h2>
              <ul className='pool-list'>
                {open.map((m) => (
                  <li key={m.id}>
                    <span className='pool-list-main'>
                      <strong>{m.player1Name}</strong>
                      <small>{timeAgo(m.createdAt)}</small>
                    </span>
                    <ArcadeButton size='sm' disabled={joiningId === m.id} onClick={() => onJoin(m.id)}>join</ArcadeButton>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className='pool-section'>
            <h2>your record</h2>
            <ul className='pool-list'>
              <li>
                <span className='pool-list-main'>
                  <strong>
                    <Num value={rating} /> rating
                  </strong>
                  <small>
                    {played === 0 ? (
                      <>No rated games yet. Everyone starts at <Num value={1200} />.</>
                    ) : (
                      <>best <Num value={Math.max(rating, userElo?.peakElo ?? rating)} /></>
                    )}
                  </small>
                </span>
              </li>
              {played > 0 ? (
                <li>
                  <span className='pool-list-main'>
                    <strong>
                      <Num value={stats?.wins ?? 0} /> {stats?.wins === 1 ? 'win' : 'wins'}, <Num value={stats?.losses ?? 0} /> {stats?.losses === 1 ? 'loss' : 'losses'}
                    </strong>
                    <small>
                      <Num value={stats?.winRate ?? 0} />% won, <Num value={stats?.totalBallsPocketed ?? 0} /> balls sunk
                      {(stats?.bestStreak ?? 0) > 1 ? <>, best streak <Num value={stats?.bestStreak ?? 0} /></> : null}
                    </small>
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        </>
      )}

      {live.length > 0 ? (
        <section className='pool-section'>
          <h2>live</h2>
          <ul className='pool-list'>
            {live.slice(0, 5).map((m) => (
              <li key={m.id}>
                <span className='pool-list-main'>
                  <strong>{m.player1Name} vs {m.player2Name ?? 'a player'}</strong>
                  <small>
                    shot <Num value={m.moveCount + 1} />
                    {m.spectatorCount > 0 ? <>, <Num value={m.spectatorCount} /> watching</> : null}
                    {m.tournamentMatchId ? ', tournament' : null}
                  </small>
                </span>
                <ArcadeLinkButton href={`/8-ball/${m.id}`} size='sm'>watch</ArcadeLinkButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!guest && recent.length > 0 ? (
        <section className='pool-section'>
          <h2>
            <button type='button' onClick={() => setRecentOpen((v) => !v)} aria-expanded={recentOpen}>
              recent games <Num value={recent.length} />
            </button>
          </h2>
          {recentOpen ? (
            <>
              <ul className='pool-list'>
                {recent.map((m) => {
                  const won = m.winnerId === currentUserId;
                  const isBot = m.player1Id.startsWith('bot:') || (m.player2Id?.startsWith('bot:') ?? false);
                  const change = eloHistoryMap.get(m.id);
                  const them = (currentUserId !== null && m.player1Id === currentUserId ? (m.player2Name ?? 'a player') : m.player1Name).replace(/ \(bot\)$/i, '');
                  return (
                    <li key={m.id}>
                      <Link href={`/8-ball/${m.id}`} className='pool-list-main'>
                        <strong>{won ? 'won' : m.winnerId ? 'lost' : 'no result'} vs {them}</strong>
                        <small>
                          {isBot ? 'practice' : 'ranked'}
                          {m.winReason === 'forfeit' ? ', forfeit' : null}, <Num value={m.moveCount} /> shots
                          {change !== undefined ? <>, <Num value={change} signed /> rating</> : null}
                        </small>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className='mt-2'>
                <ArcadeButton size='sm' disabled={clearingRecent} onClick={onClearRecent}>
                  {clearingRecent ? 'clearing' : 'clear recent'}
                </ArcadeButton>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className='pool-wide space-y-3'>
        <TournamentSection />
        <PastTournamentsSection />
      </div>

      <div className='pool-wide flex flex-wrap items-center justify-center gap-2'>
        <GameLeaderboardButton onClick={onLeaderboard} label='leaderboard' />
        <GameInventoryButton onClick={onInventory} label='skins' />
      </div>
    </div>
  );
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
