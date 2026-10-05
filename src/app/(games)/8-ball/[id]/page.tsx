'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import {
  GameShell,
  GameStage,
  GameStageNotice,
  GameStat,
  type GameHint,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import { useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import {
  GamesWalletProvider,
  useOptionalGamesWallet,
} from '@/features/arcade/components/shell/games-wallet-provider';
import { subscribeLive } from '@/lib/liveEvents';
import { Num } from '@/features/arcade/components/ui/num';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { useInGamePresence } from '@/features/social/presence/presence-client';
import { simulatePreview, isValidCuePlacement, TABLE_WIDTH, TABLE_HEIGHT, CUSHION_WIDTH, BALL_RADIUS, BALL_DIAMETER, HEAD_STRING_X, FOOT_SPOT, type Ball, type Vec2, type ShotInput } from '@/features/arcade/lib/pool-physics';
import type { PoolMatch } from '@/server/arcade/pool-match';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { PoolCanvas, type CueThemeOverride, type PoolFeelEvent } from './_pool-canvas';
import { PoolHud } from './_pool-hud';
import { PoolControls } from './_pool-controls';
import { PoolResult } from './_pool-result';
import { POOL_HOW_TO } from '../_pool-shell';

/** Hardcoded bot cue skins — no store items needed, these render in-game only. */
const BOT_CUE_THEMES: Record<string, CueThemeOverride> = {
  easy: {
    cueColor: '#8b6e4e',
    cueTipColor: '#3d2b1f',
    cueGlow: false,
    cueGlowColor: '#ffffff',
  },
  medium: {
    cueColor: '#1e40af',
    cueTipColor: '#1e3a5f',
    cueGlow: true,
    cueGlowColor: '#60a5fa',
  },
  hard: {
    cueColor: '#b91c1c',
    cueTipColor: '#450a0a',
    cueGlow: true,
    cueGlowColor: '#ef4444',
  },
};
import { MatchChat } from './_match-chat';
import { MatchReplayViewer, type MatchReplayData } from './_match-replay';
import {
  BOT_AIM_PREVIEW_MS,
  BOT_AIM_SETUP_MS,
  BOT_PLACEMENT_STEPS,
  BOT_PLACEMENT_STEP_MS,
  BOT_PLACEMENT_SETTLE_MS,
  FOUL_OVERLAY_MS,
  PLAYER_SWITCH_DELAY_MS,
  STATUS_BANNER_DEFAULT_MS,
  AIM_SMOOTH_ALPHA,
  MAX_PULL_DIST,
  POWER_DRAG_EXPONENT,
  MIN_FIRE_POWER,
  TARGET_LINE_LENGTH,
  CUE_DEFLECTION_LENGTH,
} from './_pool-ui-constants';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { findEquippedSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { PocketSelector } from './_pocket-selector';
import { MatchSwitcher } from './_match-switcher';
import { fetchPlayerCards, type ClientPlayerCard } from '@/features/users/use-player-cards';

// Fetch helpers
type MatchFetchResult = {
  match: PoolMatch;
  userId: string;
  lastOpponentShot?: { angle: number; power: number; cuePosition: { x: number; y: number } | null; spinX?: number; spinY?: number } | null;
  ballsBeforeLastShot?: unknown[] | null;
  canRemind?: boolean;
  turnTimeRemainingMs?: number | null;
  eloChange?: {
    winner: { before: number; after: number; change: number; tier: string; tierColor: string };
    loser: { before: number; after: number; change: number; tier: string; tierColor: string };
  };
  isSpectator?: boolean;
  spectatorCount?: number;
  accountXp?: AccountXpReward | null;
  runResult?: ArcadeRunResultSnapshot | null;
  guest?: boolean;
  /** The viewer's own shots, on a finished match. */
  myShots?: number;
  /** Name, avatar and equipped flair for each player. Sent when asked for with `?cards=1`. */
  playerCards?: Record<string, ClientPlayerCard>;
};

type MatchReplayFetchResult = {
  replayAvailable: boolean;
  reason?: string;
  replay?: MatchReplayData;
  error?: string;
};

async function fetchMatch(id: string, withCards = false): Promise<MatchFetchResult | null> {
  const res = await fetch(`/api/games/8-ball/match/${id}${withCards ? '?cards=1' : ''}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.match ? data as MatchFetchResult : null;
}

async function fetchReplay(matchId: string): Promise<MatchReplayFetchResult | null> {
  const res = await fetch(`/api/games/8-ball/match/${matchId}/replay`, { cache: 'no-store' });
  if (!res.ok) {
    try {
      return await res.json() as MatchReplayFetchResult;
    } catch {
      return null;
    }
  }
  return await res.json() as MatchReplayFetchResult;
}

async function submitShot(
  matchId: string,
  angle: number,
  power: number,
  cuePosition: Vec2 | null,
  shotSpinX = 0,
  shotSpinY = 0,
  calledPocket?: number | null,
) {
  const payload: Record<string, unknown> = { angle, power, cuePosition, spinX: shotSpinX, spinY: shotSpinY };
  if (calledPocket != null) payload.calledPocket = calledPocket;
  const res = await fetch(`/api/games/8-ball/match/${matchId}/shot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function submitForfeit(matchId: string) {
  const res = await fetch(`/api/games/8-ball/match/${matchId}/forfeit`, {
    method: 'POST',
  });
  return res.json();
}

type AimPhase = 'idle' | 'aiming' | 'powering';

type AimState = {
  phase: AimPhase;
  /** Angle from cue ball to cursor (radians). */
  angle: number;
  /** Shot power 0-1. */
  power: number;
  /** Canvas position where the drag started (for power calculation). */
  dragStart: Vec2 | null;
};

type StatusBanner = {
  id: number;
  text: string;
  tone: 'neutral' | 'good' | 'foul';
};

const BOT_SHOOTER_ID = '__bot__';
/** A break this hard or harder gets the hit-stop and the shake. */
const HARD_BREAK_POWER = 0.6;
/** Touch: a press this close to the cue ball (table units, about four ball
 *  widths) pulls back to shoot; further away, the drag aims. */
const TOUCH_PULL_ZONE = 125;

const SHOT_HINT: GameHint = {
  touch: 'Drag to aim, pull the cue ball to shoot.',
  pointer: 'Click, then drag back to shoot.',
};
const PLACE_HINT: GameHint = {
  touch: 'Tap to place the cue ball.',
  pointer: 'Click to place the cue ball.',
};
const POWER_HINT: GameHint = {
  touch: 'Let go to shoot.',
  pointer: 'Let go to shoot. Right-click cancels.',
};

const BOT_FOULS: Record<string, string> = {
  scratch: 'Their scratch. Ball in hand.',
  wrong_first: 'Their foul: wrong ball first. Ball in hand.',
  no_rail: 'Their foul: no rail. Ball in hand.',
  no_contact: 'Their foul: no ball hit. Ball in hand.',
  illegal_break: 'Illegal break. The other player breaks a new rack.',
};
const PLAYER_FOULS: Record<string, string> = {
  scratch: 'Foul: scratch.',
  wrong_first: 'Foul: wrong ball first.',
  no_rail: 'Foul: no ball reached a rail.',
  no_contact: 'Foul: no ball hit.',
  illegal_break: 'Foul: illegal break. 4 balls must reach a rail.',
};
const LIVE_REPLAY_CAPTURE_FPS = 60;
const LIVE_REPLAY_VIDEO_BITRATE = 8_000_000;

/** Extract the bot cue theme from a match's player2 ID, or null for human opponents. */
function getBotCueTheme(match: PoolMatch | null): CueThemeOverride | null {
  const p2 = match?.player2Id;
  if (!p2 || !p2.startsWith('bot:')) return null;
  const diff = p2.replace('bot:', '');
  return BOT_CUE_THEMES[diff] ?? null;
}

/**
 * Smoothly interpolate between two angles via the shortest arc.
 * Handles the ±PI wraparound correctly.
 */
function lerpAngle(from: number, to: number, alpha: number): number {
  let diff = to - from;
  // Normalize diff to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return from + diff * alpha;
}


export default function PoolGamePage() {
  return (
    <GamesWalletProvider>
      <PoolGameScreen />
    </GamesWalletProvider>
  );
}

function PoolGameScreen() {
  const params = useParams();
  const router = useRouter();
  const matchId = params.id as string;
  useInGamePresence('8-ball');
  const touchDevice = useIsTouchDevice();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();
  const [stageSize, setStageSize] = useState<GameStageSize | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Balls potted in the shot on screen, before the server's state lands, so
  // a ball drops out of your row with its thud.
  const [livePotted, setLivePotted] = useState<number[]>([]);
  const [lastPower, setLastPower] = useState(0);
  // The balance in the strip comes from the page's wallet provider. It is
  // loaded again once the match pays, so the strip rolls up by the payout.
  const wallet = useOptionalGamesWallet();
  const refreshWallet = wallet?.refresh;
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const [rematchFrom, setRematchFrom] = useState<{ matchId: string; name: string; wager: number } | null>(null);
  // A rematch that holds tickets is pressed twice: once to see the stake.
  const [stakeConfirm, setStakeConfirm] = useState(false);
  // Player matches: rematch goes through the challenge route, which needs
  // the two players to be friends. null until known.
  const [friendsWithOpponent, setFriendsWithOpponent] = useState<boolean | null>(null);
  const [friendRequest, setFriendRequest] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [forfeitAsk, setForfeitAsk] = useState(false);
  const [myShots, setMyShots] = useState<number | null>(null);
  const winFeltRef = useRef<string | null>(null);
  const touchModeRef = useRef<'aim' | 'pull' | null>(null);

  const [match, setMatch] = useState<PoolMatch | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animShot, setAnimShot] = useState<ShotInput | null>(null);
  const [foulMessage, setFoulMessage] = useState<string | null>(null);
  const [eloChange, setEloChange] = useState<{
    winner: { before: number; after: number; change: number; tier: string; tierColor: string };
    loser: { before: number; after: number; change: number; tier: string; tierColor: string };
  } | null>(null);
  const [botRecord, setBotRecord] = useState<{
    humanTurns: number;
    previousBest: number | null;
    isNewRecord: boolean;
    isWorldRecord: boolean;
  } | null>(null);
  const [matchReward, setMatchReward] = useState<{
    awardedCredits: number;
    earnedTodayTotal: number;
    capRemaining: number;
    account?: AccountXpReward | null;
  } | null>(null);
  const [accountXp, setAccountXp] = useState<AccountXpReward | null>(null);
  const [runResult, setRunResult] = useState<ArcadeRunResultSnapshot | null>(null);
  const [replayData, setReplayData] = useState<MatchReplayData | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replaySaved, setReplaySaved] = useState(false);
  const [replaySaveToken, setReplaySaveToken] = useState(0);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [liveReplayVideoBlob, setLiveReplayVideoBlob] = useState<Blob | null>(null);
  // Spectator state
  const [isSpectator, setIsSpectator] = useState(false);
  const [spectatorCount, setSpectatorCount] = useState(0);
  // Async PvP state
  const [canRemind, setCanRemind] = useState(false);
  const [turnTimeRemainingMs, setTurnTimeRemainingMs] = useState<number | null>(null);
  const [reminderSending, setReminderSending] = useState(false);
  const botTurnTriggeredRef = useRef(false);
  // Refs for desync prevention — closures in setInterval capture stale state,
  // so we use refs for values the poll effect needs to read in real time.
  const isAnimatingRef = useRef(false);
  const matchMoveCountRef = useRef(0);
  // Player info (avatars, Elo) for player cards
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [playerElo, setPlayerElo] = useState<Record<string, { rating: number; tier: string; tierColor: string; rank: number | null }>>({});
  const fetchedPlayerIdsRef = useRef(new Set<string>());
  // Equipped frames and the rest of each player's namecard, for the HUD.
  const [playerCards, setPlayerCards] = useState<Record<string, ClientPlayerCard>>({});
  // Pool cosmetic theme
  const [poolTheme, setPoolTheme] = useState<import('./_pool-canvas').PoolCosmeticTheme | undefined>(undefined);
  // A skin set's sound tint lasts while the table is open.
  useEffect(() => () => SoundManager.setTint('house'), []);
  // Bot aiming preview — shows cue stick + aim line before bot shoots
  const [botAim, setBotAim] = useState<{ angle: number; power: number; cuePos: Vec2; cueTheme?: CueThemeOverride } | null>(null);
  const [activeShotCueTheme, setActiveShotCueTheme] = useState<CueThemeOverride | null>(null);
  // Override balls for chained animations (bot shots). Bypasses React state timing.
  const [animBallsOverride, setAnimBallsOverride] = useState<Ball[] | null>(null);
  // Bot ball-in-hand placement preview — shows the cue ball "thinking" at different positions
  const [botPlacementPreview, setBotPlacementPreview] = useState<Vec2 | null>(null);
  const pendingBotShotsRef = useRef<Array<{ angle: number; power: number; cuePosition: Vec2 | null; spinX?: number; spinY?: number }>>([]);
  const timeoutIdsRef = useRef<number[]>([]);
  const bannerIdRef = useRef(0);
  const activeShotShooterRef = useRef<string | null>(null);
  const pendingFoulMessageRef = useRef<string | null>(null);
  const matchCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const liveReplayRecorderRef = useRef<MediaRecorder | null>(null);
  const liveReplayStreamRef = useRef<MediaStream | null>(null);
  const liveReplayChunksRef = useRef<BlobPart[]>([]);
  const liveReplaySessionRef = useRef(0);
  const [statusBanner, setStatusBanner] = useState<StatusBanner | null>(null);

  // Spin (english) — persists across aim/power phases, resets each turn
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const handleSpinChange = useCallback((x: number, y: number) => { setSpinX(x); setSpinY(y); }, []);

  // Hardcore mode: called pocket (0-5, null = not yet called)
  const [calledPocket, setCalledPocket] = useState<number | null>(null);

  const showMatchChat = Boolean(
    userId &&
    match?.player2Id &&
    !match.player2Id.startsWith('bot:'),
  );

  // Unified aiming state
  const [aim, setAim] = useState<AimState>({
    phase: 'idle',
    angle: 0,
    power: 0,
    dragStart: null,
  });
  // Ball-in-hand placement
  const [placingCue, setPlacingCue] = useState(false);
  const [cueDropPos, setCueDropPos] = useState<Vec2 | null>(null);
  // Track cursor position for ball-in-hand preview
  const [cursorTablePos, setCursorTablePos] = useState<Vec2 | null>(null);

  // Holds the server's post-shot match state until animation finishes.
  // IMPORTANT: do NOT sync this from `match` on every render — that would
  // clobber the server response before handleAnimationEnd reads it.
  const pendingMatchRef = useRef<PoolMatch | null>(null);

  const queueTimeout = useCallback((fn: () => void, delayMs: number) => {
    const id = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((value) => value !== id);
      fn();
    }, delayMs);
    timeoutIdsRef.current.push(id);
    return id;
  }, []);

  const showStatusBanner = useCallback((
    text: string,
    tone: StatusBanner['tone'] = 'neutral',
    durationMs = STATUS_BANNER_DEFAULT_MS,
  ) => {
    const id = ++bannerIdRef.current;
    setStatusBanner({ id, text, tone });
    queueTimeout(() => {
      setStatusBanner((current) => (current?.id === id ? null : current));
    }, durationMs);
  }, [queueTimeout]);

  const ensureReplayData = useCallback(async (): Promise<MatchReplayData | null> => {
    if (replayData) return replayData;

    setReplayLoading(true);
    setReplayError(null);
    try {
      const replayResult = await fetchReplay(matchId);
      if (!replayResult) {
        setReplayError('Failed to load replay.');
        return null;
      }
      if (replayResult.error) {
        setReplayError(replayResult.error);
        return null;
      }
      if (!replayResult.replayAvailable || !replayResult.replay) {
        setReplayError(replayResult.reason ?? 'Replay is unavailable for this match.');
        return null;
      }

      setReplayData(replayResult.replay);
      return replayResult.replay;
    } finally {
      setReplayLoading(false);
    }
  }, [matchId, replayData]);

  const handleOpenReplay = useCallback(async () => {
    const replay = await ensureReplayData();
    if (!replay) return;
    setReplayError(null);
    setReplayOpen(true);
  }, [ensureReplayData]);

  const handleReplayVideoSaved = useCallback(() => {
    setReplaySaved(true);
    setReplayError(null);
    showStatusBanner('Replay saved to this device.', 'good', 1600);
  }, [showStatusBanner]);

  const handleReplayVideoError = useCallback((message: string) => {
    setReplayError(message);
    showStatusBanner('The replay could not be saved.', 'foul', 1700);
  }, [showStatusBanner]);

  const handleLobby = useCallback(() => {
    // Replays are ephemeral unless explicitly exported by the player.
    if (!replaySaved) {
      setReplayData(null);
      setReplayOpen(false);
      setLiveReplayVideoBlob(null);
    }
    setReplayLoading(false);
    setReplayError(null);
    router.push('/8-ball');
  }, [replaySaved, router]);

  useEffect(() => {
    setReplayData(null);
    setReplayOpen(false);
    setReplayLoading(false);
    setReplaySaved(false);
    setReplaySaveToken(0);
    setReplayError(null);
    setLiveReplayVideoBlob(null);
    setAccountXp(null);
    setRunResult(null);
    setRematchBusy(false);
    setRematchError(null);
    setRematchFrom(null);
    setStakeConfirm(false);
    setFriendsWithOpponent(null);
    setFriendRequest('idle');
    setForfeitAsk(false);
    setMyShots(null);
    setLivePotted([]);

    liveReplaySessionRef.current += 1;
    const recorder = liveReplayRecorderRef.current;
    if (recorder) {
      try {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Ignore recorder shutdown errors.
      }
    }
    liveReplayRecorderRef.current = null;

    const stream = liveReplayStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    liveReplayStreamRef.current = null;
    liveReplayChunksRef.current = [];
  }, [matchId]);

  useEffect(() => () => {
    for (const id of timeoutIdsRef.current) {
      window.clearTimeout(id);
    }
    timeoutIdsRef.current = [];

    liveReplaySessionRef.current += 1;
    const recorder = liveReplayRecorderRef.current;
    if (recorder) {
      try {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Ignore recorder shutdown errors.
      }
    }
    liveReplayRecorderRef.current = null;

    const stream = liveReplayStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    liveReplayStreamRef.current = null;
    liveReplayChunksRef.current = [];
  }, []);

  // Block gestures during gameplay
  const isGameOver = match?.phase === 'game_over' || match?.status === 'completed' || match?.status === 'forfeited';
  const isWaitingForOpponent = match?.status === 'waiting';
  const isMyTurn = match?.currentTurn === userId && !isAnimating && !isGameOver && !isWaitingForOpponent;

  const ensureLiveReplayRecorder = useCallback((): MediaRecorder | null => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null;
    if (liveReplayRecorderRef.current) return liveReplayRecorderRef.current;

    const canvas = matchCanvasHostRef.current?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    if (typeof canvas.captureStream !== 'function') return null;

    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType =
      mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      ?? 'video/webm';

    const stream = canvas.captureStream(LIVE_REPLAY_CAPTURE_FPS);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: LIVE_REPLAY_VIDEO_BITRATE,
    });

    const sessionId = ++liveReplaySessionRef.current;
    liveReplayChunksRef.current = [];
    setLiveReplayVideoBlob(null);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) liveReplayChunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      // Fall back to post-match renderer when live capture fails.
      liveReplayChunksRef.current = [];
    };
    recorder.onstop = () => {
      if (sessionId !== liveReplaySessionRef.current) return;

      const blob = new Blob(liveReplayChunksRef.current, { type: mimeType });
      liveReplayChunksRef.current = [];

      const liveStream = liveReplayStreamRef.current;
      if (liveStream) {
        for (const track of liveStream.getTracks()) track.stop();
      }
      liveReplayStreamRef.current = null;
      liveReplayRecorderRef.current = null;

      if (blob.size > 0) setLiveReplayVideoBlob(blob);
    };

    recorder.start(220);
    liveReplayStreamRef.current = stream;
    liveReplayRecorderRef.current = recorder;
    return recorder;
  }, []);

  useEffect(() => {
    if (!match || match.status !== 'active' || isGameOver) return;
    if (isAnimating) {
      const recorder = ensureLiveReplayRecorder();
      if (recorder?.state === 'paused') {
        try {
          recorder.resume();
        } catch {
          // Recorder may already be resuming/stopped.
        }
      }
      return;
    }

    const recorder = liveReplayRecorderRef.current;
    if (recorder?.state === 'recording') {
      try {
        recorder.pause();
      } catch {
        // Recorder may already be paused/stopped.
      }
    }
  }, [ensureLiveReplayRecorder, isAnimating, isGameOver, match]);

  useEffect(() => {
    if (!isGameOver) return;
    const recorder = liveReplayRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      if (recorder.state === 'paused') recorder.resume();
      recorder.requestData();
      recorder.stop();
    } catch {
      // Ignore stop errors; viewer export fallback remains available.
    }
  }, [isGameOver]);

  // Compute player's available ball IDs for highlighting
  const myGroup = match && userId
    ? (match.player1Id === userId ? match.player1Group : match.player2Group)
    : null;
  const myBallIds = myGroup && match && isMyTurn
    ? match.balls
        .filter((b) => !b.pocketed && (
          (myGroup === 'solids' && b.id >= 1 && b.id <= 7) ||
          (myGroup === 'stripes' && b.id >= 9 && b.id <= 15)
        ))
        .map((b) => b.id)
    : undefined;

  // Load match (critical) in parallel with user + cosmetics (optional).
  // Match fetch is independent — a /api/users/me or cosmetics failure
  // should never block gameplay.
  useEffect(() => {
    let cancelled = false;

    // Critical path: fetch match immediately.
    // The match response includes the authenticated userId, so we don't
    // depend on /api/users/me for gameplay to work.
    const loadMatch = async () => {
      try {
        const result = await fetchMatch(matchId, true);
        if (!cancelled) {
          if (result) {
            if (result.playerCards) setPlayerCards(result.playerCards);
            // If the opponent moved while we were away and we have pre-shot balls,
            // set the initial match with pre-shot balls so the canvas never flashes
            // the post-shot state before the replay animation starts.
            const hasReplay = result.lastOpponentShot && result.ballsBeforeLastShot
              && result.match.status === 'active';
            setMatch(hasReplay
              ? { ...result.match, balls: result.ballsBeforeLastShot as Ball[] }
              : result.match,
            );
            setUserId(result.userId);
            setIsGuest(result.guest === true);
            if (typeof result.myShots === 'number') setMyShots(result.myShots);
            setIsSpectator(result.isSpectator ?? false);
            setSpectatorCount(result.spectatorCount ?? 0);
            setCanRemind(result.canRemind ?? false);
            setTurnTimeRemainingMs(result.turnTimeRemainingMs ?? null);
            if (result.eloChange) setEloChange(result.eloChange);
            if (result.accountXp) setAccountXp(result.accountXp);
            if (result.runResult) setRunResult(result.runResult);

            // Fetch avatars for both players
            const playerIds = [result.match.player1Id, result.match.player2Id].filter((id): id is string => !!id && !id.startsWith('bot:'));
            for (const pid of playerIds) fetchedPlayerIdsRef.current.add(pid);
            if (playerIds.length > 0) {
              fetch('/api/users/avatars', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: playerIds }),
              }).then(r => r.ok ? r.json() : null).then(d => {
                if (d?.avatars && !cancelled) setPlayerAvatars(d.avatars);
              }).catch(() => {});
            }
            // Fetch Elo for both players
            for (const pid of playerIds) {
              fetch(`/api/games/8-ball/elo-leaderboard?userId=${pid}`, { cache: 'no-store' })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                  if (d?.player && !cancelled) {
                    setPlayerElo(prev => ({ ...prev, [pid]: { rating: d.player.eloRating, tier: d.player.tier, tierColor: d.player.tierColor, rank: d.player.rank ?? null } }));
                  }
                }).catch(() => {});
            }

            // If the opponent moved since we last visited, replay their shot.
            // We need both the shot input AND the pre-shot balls to animate correctly.
            if (hasReplay) {
              // Match was already set with pre-shot balls above.
              pendingMatchRef.current = result.match; // post-shot state applied after animation
              showStatusBanner('Their last shot.', 'neutral', 1500);
              setTimeout(() => {
                if (cancelled) return;
                setAnimShot({
                  angle: result.lastOpponentShot!.angle,
                  power: result.lastOpponentShot!.power,
                  cuePosition: result.lastOpponentShot!.cuePosition,
                  spinX: result.lastOpponentShot!.spinX ?? 0,
                  spinY: result.lastOpponentShot!.spinY ?? 0,
                });
                setIsAnimating(true);
              }, 400);
            } else if (result.lastOpponentShot && result.match.currentTurn === result.userId) {
              // No pre-shot balls available — just show a banner
              showStatusBanner('Your shot.', 'good', 2000);
            }

            // If it's the bot's turn (e.g., bot breaks), auto-trigger and animate.
            // Skip if we're already replaying an opponent shot to avoid conflicting animations.
            if (!hasReplay && result.match.currentTurn.startsWith('bot:') && result.match.status === 'active' && !botTurnTriggeredRef.current) {
              botTurnTriggeredRef.current = true;
              setTimeout(async () => {
                if (cancelled) return;
                try {
                  showStatusBanner('Their shot.', 'neutral', 2000);
                  const botRes = await fetch(`/api/games/8-ball/match/${matchId}/bot-turn`, { method: 'POST' });
                  if (!botRes.ok) return;
                  const botData = await botRes.json();
                  // The bot's shot ended the game: keep the player's payout.
                  if (botData.reward) setMatchReward(botData.reward);
                  if (botData.reward?.account) setAccountXp(botData.reward.account);
                  if (botData.runResult) setRunResult(botData.runResult);
                  if (botData.botRecord) setBotRecord(botData.botRecord);
                  if (botData.botShotInputs?.length > 0 && !cancelled) {
                    pendingBotShotsRef.current = botData.botShotInputs;
                    if (botData.lastBotEvaluation?.foul && !botData.lastBotEvaluation?.winnerId) {
                      pendingFoulMessageRef.current = BOT_FOULS[botData.lastBotEvaluation.foul] ?? 'Their foul. Ball in hand.';
                    }
                    pendingMatchRef.current = botData.match;
                    // Start animating the first bot shot
                    const first = pendingBotShotsRef.current.shift()!;
                    activeShotShooterRef.current = BOT_SHOOTER_ID;
                    setActiveShotCueTheme(getBotCueTheme(result.match));
                    setAnimShot({
                      angle: first.angle,
                      power: first.power,
                      cuePosition: first.cuePosition,
                      spinX: first.spinX ?? 0,
                      spinY: first.spinY ?? 0,
                    });
                    setIsAnimating(true);
                  } else if (botData.match) {
                    setMatch(botData.match);
                  }
                } catch { /* bot trigger failed — page will show current state */ }
              }, 500); // brief delay so the table renders first
            }
          } else {
            setError('This match is not here any more.');
          }
        }
      } catch {
        if (!cancelled) setError('The match could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Cosmetics: always load YOUR equipped skins. Table, ball, and playercard
    // skins are purely client-side (you always see your own). The cue stick is
    // the only cosmetic the opponent can see — handled via CueThemeOverride.
    const loadCosmetics = async () => {
      try {
        const cosRes = await fetch('/api/store/inventory?gameType=8-ball', { cache: 'no-store' });
        if (!cosRes.ok || cancelled) return;
        const cosData = await cosRes.json();
        const equipped = cosData?.equipped ?? [];
        const t: Record<string, unknown> = {};
        for (const e of equipped) {
          if (e?.item?.assetRef) Object.assign(t, e.item.assetRef);
        }

        // Always apply the theme — even if empty (uses defaults), so the
        // canvas never renders with undefined theme then snaps to cosmetics.
        const { DEFAULT_POOL_THEME } = await import('./_pool-canvas');
        // A skin set (SKINS.md) fills table, balls and cue at once.
        const skinSet = findEquippedSkinSet(equipped, '8-ball');
        if (skinSet) {
          const p = skinSet.palette;
          const suits = [p.ball1, p.ball2, p.ball3, p.ball4, p.ball5, p.ball6, p.ball7];
          const skinBalls: Record<number, string> = {};
          suits.forEach((colour, i) => {
            if (colour) {
              skinBalls[i + 1] = colour;
              skinBalls[i + 9] = colour;
            }
          });
          if (cancelled) return;
          setPoolTheme({
            feltColor: p.felt,
            feltDark: p.feltDark,
            railColor: p.rail,
            railBorder: p.railEdge,
            pocketColor: p.pocket,
            cueColor: p.cue,
            cueTipColor: p.cueTip,
            cueGlow: false,
            cueGlowColor: DEFAULT_POOL_THEME.cueGlowColor,
            ...(Object.keys(skinBalls).length > 0 ? { ballColors: skinBalls } : {}),
            skin: { material: skinSet.material, finish: skinSet.shape, sight: p.sight, railEdge: p.railEdge },
          });
          SoundManager.setTint(skinSet.sound);
          return;
        }
        SoundManager.setTint('house');
        const BALL_COLOR_MAP: [string, number[]][] = [
          ['ballYellow', [1, 9]], ['ballBlue', [2, 10]], ['ballRed', [3, 11]],
          ['ballPurple', [4, 12]], ['ballOrange', [5, 13]], ['ballGreen', [6, 14]],
          ['ballMaroon', [7, 15]],
        ];
        const ballColors: Record<number, string> = {};
        for (const [key, ids] of BALL_COLOR_MAP) {
          if (typeof t[key] === 'string') {
            for (const id of ids) ballColors[id] = t[key] as string;
          }
        }
        if (cancelled) return;
        setPoolTheme({
          feltColor: (t.feltColor as string) ?? DEFAULT_POOL_THEME.feltColor,
          feltDark: (t.feltDark as string) ?? DEFAULT_POOL_THEME.feltDark,
          railColor: (t.railColor as string) ?? DEFAULT_POOL_THEME.railColor,
          railBorder: (t.railBorder as string) ?? DEFAULT_POOL_THEME.railBorder,
          pocketColor: (t.pocketColor as string) ?? DEFAULT_POOL_THEME.pocketColor,
          cueColor: (t.cueColor as string) ?? DEFAULT_POOL_THEME.cueColor,
          cueTipColor: (t.cueTipColor as string) ?? DEFAULT_POOL_THEME.cueTipColor,
          cueGlow: (t.cueGlow as boolean) ?? DEFAULT_POOL_THEME.cueGlow,
          cueGlowColor: (t.cueGlowColor as string) ?? DEFAULT_POOL_THEME.cueGlowColor,
          ...(Object.keys(ballColors).length > 0 ? { ballColors } : {}),
        });
      } catch { /* cosmetics are optional — defaults apply */ }
    };

    // Fire both in parallel — match is critical, cosmetics are optional
    void loadMatch();
    void loadCosmetics();

    return () => { cancelled = true; };
  }, [matchId, showStatusBanner]);

  // Poll for updates when it's opponent's turn.
  // Keep refs in sync with state so the poll interval reads fresh values
  // without needing to recreate the interval on every state change.
  useEffect(() => { isAnimatingRef.current = isAnimating; }, [isAnimating]);
  useEffect(() => { matchMoveCountRef.current = match?.moveCount ?? 0; }, [match?.moveCount]);

  // Shared handler for processing a fetched match result (used by poll + SSE).
  // Replays shots, detects joins, extracts Elo. Returns true if it triggered animation.
  const handleFetchedResult = useCallback((result: MatchFetchResult) => {
    // End-of-game account-XP burst (served once by the match route; the
    // non-shooter picks it up here on the poll that reveals game over).
    // Captured BEFORE the animation guard: the GET route consumes it
    // server-side, so dropping it here would lose the burst entirely.
    if (result.accountXp) setAccountXp(result.accountXp);
    if (result.runResult) setRunResult(result.runResult);
    if (typeof result.myShots === 'number') setMyShots(result.myShots);

    // Guard: never update during animation
    if (isAnimatingRef.current) return;

    // Always update spectator count
    setSpectatorCount(result.spectatorCount ?? 0);

    // Fetch avatar + Elo for any player we haven't loaded yet (e.g., player 2 just joined)
    const newPlayerIds = [result.match.player1Id, result.match.player2Id]
      .filter((id): id is string => !!id && !id.startsWith('bot:') && !fetchedPlayerIdsRef.current.has(id));
    if (newPlayerIds.length > 0) {
      for (const pid of newPlayerIds) fetchedPlayerIdsRef.current.add(pid);
      // A player who just joined: their card, from the same lookup the match load uses.
      void fetchPlayerCards(newPlayerIds).then((cards) => setPlayerCards((prev) => ({ ...prev, ...cards })));
      fetch('/api/users/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: newPlayerIds }),
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d?.avatars) setPlayerAvatars((prev) => ({ ...prev, ...d.avatars }));
      }).catch(() => {});
      for (const pid of newPlayerIds) {
        fetch(`/api/games/8-ball/elo-leaderboard?userId=${pid}`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d?.player) {
              setPlayerElo((prev) => ({ ...prev, [pid]: { rating: d.player.eloRating, tier: d.player.tier, tierColor: d.player.tierColor, rank: d.player.rank ?? null } }));
            }
          }).catch(() => {});
      }
    }

    // Detect opponent join (waiting → active transition)
    if (result.match.status === 'active' && result.match.moveCount === 0 && matchMoveCountRef.current === 0) {
      // Status may have changed from 'waiting' — just update match state
      setMatch(result.match);
      setCanRemind(result.canRemind ?? false);
      setTurnTimeRemainingMs(result.turnTimeRemainingMs ?? null);
      return;
    }

    // Detect game-over (forfeit, completion) even when moveCount hasn't changed
    const isNowOver = result.match.status === 'completed' || result.match.status === 'forfeited';
    const moveChanged = result.match.moveCount !== matchMoveCountRef.current;

    if (moveChanged || isNowOver) {
      setCanRemind(result.canRemind ?? false);
      setTurnTimeRemainingMs(result.turnTimeRemainingMs ?? null);

      // Replay the shot animation — for spectators, every shot is replayed.
      if (moveChanged && result.lastOpponentShot && result.ballsBeforeLastShot) {
        showStatusBanner('Their shot.', 'neutral', 800);
        isAnimatingRef.current = true;
        setAnimBallsOverride(result.ballsBeforeLastShot as Ball[]);
        setAnimShot({
          angle: result.lastOpponentShot.angle,
          power: result.lastOpponentShot.power,
          cuePosition: result.lastOpponentShot.cuePosition,
          spinX: result.lastOpponentShot.spinX ?? 0,
          spinY: result.lastOpponentShot.spinY ?? 0,
        });
        setIsAnimating(true);
        pendingMatchRef.current = result.match;
      } else {
        setMatch(result.match);
      }

      // Extract Elo change for game-over screen (ensures the loser sees it too)
      if (result.eloChange) setEloChange(result.eloChange);
    }
  }, [showStatusBanner]);

  // Poll for match updates (opponent moves, joins, forfeits).
  // Runs whenever the match is active and it's NOT our turn, OR when waiting for opponent.
  // Uses refs to avoid stale-state desync in the interval closure.
  useEffect(() => {
    if (!match || !userId) return;
    if (match.phase === 'game_over' || match.status === 'completed' || match.status === 'forfeited') return;
    // Poll when: waiting for opponent to join, it's opponent's turn, or spectating
    const shouldPoll = isSpectator || match.status === 'waiting' || match.currentTurn !== userId;
    if (!shouldPoll) return;

    const poll = async () => {
      if (isAnimatingRef.current) return;
      const result = await fetchMatch(matchId);
      if (!result) return;
      if (isAnimatingRef.current) return;
      handleFetchedResult(result);
    };

    return startVisiblePolling(poll, 3000);
    // Poll restarts only when phase/turn/status change; depending on the
    // whole match object would reset the interval after every poll result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, userId, match?.phase, match?.currentTurn, match?.status, isSpectator, handleFetchedResult]);

  // SSE: subscribe to live events for this match for instant updates.
  // Triggers an immediate fetch on any event (shot, join, forfeit) to bypass poll delay.
  // The server dual-fires to `pool:${matchId}` (not currently forwarded by
  // the SSE stream route) AND the global `poolMatch` channel — we subscribe
  // to the latter and filter by matchId so spectators see the 8-ball sink
  // + post-game result instantly instead of waiting on the 3s poll.
  useEffect(() => {
    if (!matchId || !userId) return;

    const handler = async (payload: Record<string, unknown> | undefined) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      if (isAnimatingRef.current) return;
      const result = await fetchMatch(matchId);
      if (!result) return;
      if (isAnimatingRef.current) return;
      handleFetchedResult(result);
    };
    const unsubscribe = subscribeLive([`pool:${matchId}`, 'poolMatch'], handler);

    return unsubscribe;
  }, [matchId, userId, handleFetchedResult]);

  useEffect(() => {
    const shouldPlaceCue = Boolean(
      match
      && userId
      && !isAnimating
      && match.currentTurn === userId
      && match.foulState?.ballInHand
      && cueDropPos === null,
    );
    setPlacingCue(shouldPlaceCue);
  }, [cueDropPos, isAnimating, match, userId]);

  // Helper: get cue ball position
  const getCuePos = useCallback((): Vec2 | null => {
    if (!match) return null;
    if (cueDropPos) return cueDropPos;
    const cue = match.balls.find((b) => b.id === 0 && !b.pocketed);
    return cue?.pos ?? null;
  }, [match, cueDropPos]);

  // Hardcore mode: hide computed aim guides (ghost ball, aim path, target/deflection lines)
  const isHardcoreMatch = match?.hardcoreMode === true;

  // Compute aim visuals — player aim OR bot aiming preview
  const showPlayerAim = (aim.phase === 'aiming' || aim.phase === 'powering') && isMyTurn && !placingCue;
  // Use a fixed preview power so the guide geometry stays stable when
  // entering/exiting power mode. No jump at the aim→power transition.
  const previewPower = 0.50;
  const hasPreviewSpin = Math.abs(spinX) > 0.05 || Math.abs(spinY) > 0.05;
  const aimPreview = showPlayerAim && match
    ? (() => {
        const cuePos = getCuePos();
        if (!cuePos) return null;
        return simulatePreview(match.balls, {
          angle: aim.angle,
          power: previewPower,
          cuePosition: cueDropPos,
          spinX,
          spinY,
        });
      })()
    : null;

  const aimLine = botAim
    ? {
        start: botAim.cuePos,
        end: {
          x: botAim.cuePos.x + Math.cos(botAim.angle) * 300,
          y: botAim.cuePos.y + Math.sin(botAim.angle) * 300,
        },
      }
    : null;

  const aimPath = isHardcoreMatch ? null : (aimPreview?.cuePath?.length ? aimPreview.cuePath : null);
  const guideEmphasis = showPlayerAim && match
    ? (() => {
        const objectBalls = match.balls.filter((ball) => ball.id !== 0 && !ball.pocketed);
        const openingClusterCount = objectBalls.filter((ball) => {
          const dx = ball.pos.x - FOOT_SPOT.x;
          const dy = ball.pos.y - FOOT_SPOT.y;
          return dx * dx + dy * dy <= 170 * 170;
        }).length;
        const firstContactBall = aimPreview?.firstContactBallId
          ? match.balls.find((ball) => ball.id === aimPreview.firstContactBallId && !ball.pocketed) ?? null
          : null;
        const nearbyTargetCount = firstContactBall
          ? objectBalls.filter((ball) => {
              if (ball.id === firstContactBall.id) return false;
              const dx = ball.pos.x - firstContactBall.pos.x;
              const dy = ball.pos.y - firstContactBall.pos.y;
              return dx * dx + dy * dy <= 110 * 110;
            }).length
          : 0;

        let emphasis = 1;
        if (match.phase === 'break') {
          emphasis = 0.42;
        } else if (match.phase === 'open_table' && openingClusterCount >= 8) {
          emphasis = 0.58;
        }

        if (nearbyTargetCount >= 4) {
          emphasis = Math.min(emphasis, 0.56);
        } else if (nearbyTargetCount >= 2) {
          emphasis = Math.min(emphasis, 0.72);
        }

        return emphasis;
      })()
    : 1;

  const cueStickData = (showPlayerAim || botAim) && match
    ? (() => {
      if (botAim) return {
        angle: botAim.angle,
        power: botAim.power,
        cuePos: botAim.cuePos,
        cueColor: botAim.cueTheme?.cueColor,
        cueTipColor: botAim.cueTheme?.cueTipColor,
        cueGlow: botAim.cueTheme?.cueGlow,
        cueGlowColor: botAim.cueTheme?.cueGlowColor,
      };
        const cuePos = getCuePos();
        if (!cuePos) return null;
        return { angle: aim.angle, power: aim.power, cuePos };
      })()
    : null;

  const ghostBall = isHardcoreMatch ? null : (showPlayerAim ? aimPreview?.firstContactPos ?? null : null);
  // Cue deflection line: shows the predicted cue ball direction after contact.
  // This is essential for position play — the core competitive skill axis.
  const cueDeflectionLine = isHardcoreMatch ? null : (showPlayerAim && !hasPreviewSpin && aimPreview?.firstContactPos && aimPreview.cueDeflection
    ? {
        start: aimPreview.firstContactPos,
        end: {
          x: aimPreview.firstContactPos.x + aimPreview.cueDeflection.x * (CUE_DEFLECTION_LENGTH * (0.45 + guideEmphasis * 0.55)),
          y: aimPreview.firstContactPos.y + aimPreview.cueDeflection.y * (CUE_DEFLECTION_LENGTH * (0.45 + guideEmphasis * 0.55)),
        },
      }
    : null);
  // Target line: shows the predicted direction of the object ball after contact.
  // Kept short to provide a directional hint without revealing the exact
  // pocket outcome — forces the player to develop angle estimation skill.
  // Research: Miniclip shortens guidelines at higher tiers for the same reason.
  const targetLine = isHardcoreMatch ? null : (showPlayerAim && aimPreview?.firstContactBallId && aimPreview.targetDirection && match
    ? (() => {
        const targetBall = match.balls.find((ball) => ball.id === aimPreview.firstContactBallId && !ball.pocketed);
        if (!targetBall) return null;
        const targetGuideLength = TARGET_LINE_LENGTH * (0.45 + guideEmphasis * 0.55);
        return {
          start: targetBall.pos,
          end: {
            x: targetBall.pos.x + aimPreview.targetDirection.x * targetGuideLength,
            y: targetBall.pos.y + aimPreview.targetDirection.y * targetGuideLength,
          },
        };
      })()
    : null);

  // ── Controls ──────────────────────────────────────────────────────
  // Idle: mouse move → aim line follows cursor (phase = 'aiming')
  // Click: → phase = 'powering', drag backward to set power
  // Release: → fire shot if power > 5%, else cancel

  const handleCanvasInteraction = useCallback(
    (pos: Vec2, pointerType?: string) => {
      if (!match || !userId || match.currentTurn !== userId || isAnimating || match.status === 'waiting') return;
      // Every input answers this frame: a click and, on phones, a tap.
      trigger('press', { haptic: true });

      // Ball-in-hand: click to place cue ball (validated against balls, pockets, bounds)
      if (placingCue) {
        const behindHeadString = match.foulState?.behindHeadString ?? false;
        if (isValidCuePlacement(pos, match.balls, { behindHeadString })) {
          setCueDropPos(pos);
          setPlacingCue(false);
        }
        // Invalid click — do nothing (ghost ball shows red via canvas)
        return;
      }

      // Touch has no hover to aim with. A press near the cue ball pulls back
      // along the current aim; a press anywhere else aims, and the drag
      // turns the cue. Letting go after aiming shoots nothing.
      if (pointerType === 'touch') {
        const cuePos = getCuePos();
        // Near the cue ball, and nearer to it than to any other ball: a
        // press on a ball you want to hit aims at it instead.
        const toCue = cuePos ? Math.hypot(pos.x - cuePos.x, pos.y - cuePos.y) : Infinity;
        const toBall = match.balls.reduce(
          (best, b) => (b.id === 0 || b.pocketed ? best : Math.min(best, Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y))),
          Infinity,
        );
        const near = toCue <= TOUCH_PULL_ZONE && toCue < toBall;
        if (!near && cuePos) {
          touchModeRef.current = 'aim';
          setAim((prev) => ({
            ...prev,
            phase: 'aiming',
            angle: Math.atan2(pos.y - cuePos.y, pos.x - cuePos.x),
            power: 0,
            dragStart: null,
          }));
          return;
        }
        touchModeRef.current = 'pull';
        setAim((prev) => ({
          phase: 'powering',
          angle: prev.phase === 'idle' ? 0 : prev.angle,
          power: 0,
          dragStart: pos,
        }));
        return;
      }

      // Start powering — lock the CURRENT smoothed aim angle (what the player sees),
      // not the raw click position angle. This prevents a jarring angle jump
      // at the moment of commitment, preserving the aim the player lined up.
      setAim((prev) => ({
        phase: 'powering',
        angle: prev.phase === 'aiming' ? prev.angle : Math.atan2(pos.y - (getCuePos()?.y ?? pos.y), pos.x - (getCuePos()?.x ?? pos.x)),
        power: 0,
        dragStart: pos,
      }));
    },
    [match, userId, isAnimating, placingCue, getCuePos, trigger],
  );

  // Touch: show the cue and the aim line as soon as it is your shot, so
  // there is something to pull back.
  useEffect(() => {
    if (!touchDevice || !isMyTurn || placingCue || isSpectator) return;
    setAim((prev) => (prev.phase === 'idle' ? { ...prev, phase: 'aiming', angle: 0, power: 0 } : prev));
  }, [touchDevice, isMyTurn, placingCue, isSpectator]);

  const handleCanvasMove = useCallback(
    (pos: Vec2) => {
      if (!match || isAnimating || match.status === 'waiting') return;

      // Always track cursor for ball-in-hand preview
      setCursorTablePos(pos);

      const cuePos = getCuePos();
      if (!cuePos) return;

      if (aim.phase === 'powering' && aim.dragStart) {
        // Angle is LOCKED — measure power as backward pull distance along
        // the aim direction (projection onto the reverse-aim vector).
        // This means only the backward component of the drag counts,
        // not diagonal movement.
        const aimDirX = -Math.cos(aim.angle); // reverse of aim direction
        const aimDirY = -Math.sin(aim.angle);
        const dragDx = pos.x - aim.dragStart.x;
        const dragDy = pos.y - aim.dragStart.y;
        // Project drag vector onto reverse-aim direction
        const pullDist = Math.max(0, dragDx * aimDirX + dragDy * aimDirY);
        // Non-linear power curve: more drag range at low power for precision.
        const rawNorm = Math.min(1, pullDist / MAX_PULL_DIST);
        const power = Math.pow(rawNorm, POWER_DRAG_EXPONENT);

        setAim((prev) => ({ ...prev, power }));
      } else if (!placingCue && userId && match.currentTurn === userId && touchModeRef.current !== 'pull') {
        const dx = pos.x - cuePos.x;
        const dy = pos.y - cuePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Dead zone: when the pointer is within 25px of the cue ball,
        // freeze the angle to the last stable value. This prevents the
        // wild angle swings that make close-up aiming feel twitchy.
        if (dist < 25) {
          // Keep current angle, just ensure we're in aiming phase
          setAim((prev) => prev.phase === 'aiming' ? prev : { ...prev, phase: 'aiming', power: 0 });
          return;
        }

        const rawAngle = Math.atan2(dy, dx);

        // Continuous distance-based smoothing falloff:
        // At 25px (dead zone edge): alpha ≈ 0.15 (heavy smoothing)
        // At 120px: alpha ≈ full AIM_SMOOTH_ALPHA
        // Smooth ramp avoids an abrupt sensitivity change at any radius.
        const t = Math.min(1, (dist - 25) / 95); // 0 at 25px, 1 at 120px
        const distAlpha = AIM_SMOOTH_ALPHA * (0.25 + 0.75 * t);

        setAim((prev) => {
          const smoothedAngle = prev.phase === 'aiming'
            ? lerpAngle(prev.angle, rawAngle, distAlpha)
            : rawAngle;
          if (prev.phase === 'aiming' && Math.abs(smoothedAngle - prev.angle) < 0.0005) return prev;
          return { ...prev, phase: 'aiming', angle: smoothedAngle, power: 0 };
        });
      }
    },
    // aim.angle is read through the setAim(prev) updater; depending on it
    // would recreate this pointer handler on every smoothing frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aim.phase, aim.dragStart, match, getCuePos, isAnimating, placingCue, userId],
  );

  // Right-click or Escape to cancel shot
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (aim.phase === 'powering') {
        e.preventDefault();
        setAim((prev) => ({ ...prev, phase: 'aiming', power: 0, dragStart: null }));
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aim.phase === 'powering') {
        setAim((prev) => ({ ...prev, phase: 'aiming', power: 0, dragStart: null }));
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [aim.phase]);

  const handleCanvasRelease = useCallback(async () => {
    touchModeRef.current = null;
    if (aim.phase !== 'powering' || !match || isAnimating || match.status === 'waiting') return;

    if (aim.power < MIN_FIRE_POWER) {
      // Too weak — cancel, go back to free aim
      setAim((prev) => ({ ...prev, phase: 'aiming', power: 0, dragStart: null }));
      return;
    }

    // Capture shot params before clearing state

    const shotAngle = aim.angle;
    const shotPower = aim.power;
    setLastPower(shotPower);
    const shotCuePos = cueDropPos;
    const shotSpinX = spinX;
    const shotSpinY = spinY;
    setAim({ phase: 'idle', angle: 0, power: 0, dragStart: null });
    setSpinX(0);
    setSpinY(0);

    // Start animation IMMEDIATELY — don't wait for the server round-trip.
    // Physics is deterministic: client and server produce the same result.
    // The server response arrives during animation and is applied when it ends.
    activeShotShooterRef.current = userId;
    setActiveShotCueTheme(null); // Player's own shot uses global theme
    setAnimBallsOverride(null); // Clear any leftover override from previous bot chain
    isAnimatingRef.current = true; // Sync ref immediately for poll guard
    setAnimShot({ angle: shotAngle, power: shotPower, cuePosition: shotCuePos, spinX: shotSpinX, spinY: shotSpinY });
    setIsAnimating(true);

    // Submit to server in the background
    try {
      const result = await submitShot(matchId, shotAngle, shotPower, shotCuePos, shotSpinX, shotSpinY, isHardcoreMatch ? calledPocket : undefined);
      // Reset called pocket after each shot
      if (isHardcoreMatch) setCalledPocket(null);

      if (result.error) {
        // Server rejected — re-fetch match state so animation can finish
        // and handleAnimationEnd gets the correct state.
        const freshResult = await fetchMatch(matchId);
        if (freshResult) pendingMatchRef.current = freshResult.match;
        // Show error as a temporary banner, not a fatal error
        showStatusBanner(result.error, 'foul', 1500);
        return;
      }

      // Queue foul feedback until the balls stop.
      if (result.evaluation?.foul) {
        pendingFoulMessageRef.current = PLAYER_FOULS[result.evaluation.foul] ?? 'Foul.';
      } else {
        pendingFoulMessageRef.current = null;
      }

      // Bot shot inputs for client-side animation (sent from server)
      if (result.botShotInputs && Array.isArray(result.botShotInputs)) {
        pendingBotShotsRef.current = result.botShotInputs as Array<{
          angle: number;
          power: number;
          cuePosition: Vec2 | null;
          spinX?: number;
          spinY?: number;
        }>;
      }

      // If the last bot shot was a foul (and human's shot wasn't), queue
      // feedback for when bot animations finish and it's the human's turn.
      if (result.lastBotEvaluation?.foul && !result.lastBotEvaluation?.winnerId && !pendingFoulMessageRef.current) {
        pendingFoulMessageRef.current = BOT_FOULS[result.lastBotEvaluation.foul] ?? 'Their foul. Ball in hand.';
      }

      // Capture Elo / bot record / reward data from server
      if (result.eloChange) setEloChange(result.eloChange);
      if (result.botRecord) setBotRecord(result.botRecord);
      if (result.reward) setMatchReward(result.reward);
      // Shooter's own end-of-game account-XP burst comes back on the shot.
      if (result.reward?.account) setAccountXp(result.reward.account);
      if (result.runResult) setRunResult(result.runResult);

      // Store the server's authoritative final state
      if (result.match) {
        pendingMatchRef.current = result.match;
      }
    } catch {
      showStatusBanner('The shot did not reach the server.', 'foul', 1500);
    }
    // calledPocket/isHardcoreMatch are fixed for the duration of a shot;
    // the submit closure deliberately snapshots them when the shot begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim, match, matchId, isAnimating, cueDropPos, spinX, spinY, userId, showStatusBanner]);

  // Cancel handler for interrupted pointer (pointercancel) — reset aim without firing
  const handleCanvasCancel = useCallback(() => {
    touchModeRef.current = null;
    setAim((prev) => prev.phase === 'powering'
      ? { ...prev, phase: 'aiming', power: 0, dragStart: null }
      : prev,
    );
  }, []);

  const handleAnimationEnd = useCallback((finalBalls: Ball[]) => {
    setAnimShot(null);
    setActiveShotCueTheme(null);
    setBotAim(null);
    setBotPlacementPreview(null);

    // 8-ball re-spot: if the 8-ball was pocketed (break shot rule), visually
    // place it back on the foot spot immediately. This must run regardless of
    // whether bot shots are pending — without it the client shows a missing
    // 8-ball until the server state arrives.
    const eightPocketed = finalBalls.find((b) => b.id === 8)?.pocketed;
    let reconciledBalls = finalBalls;
    if (eightPocketed) {
      reconciledBalls = finalBalls.map((b) => {
        if (b.id === 8 && b.pocketed) {
          const occupied = finalBalls.some(
            (o) => o.id !== 8 && !o.pocketed &&
              Math.sqrt((o.pos.x - FOOT_SPOT.x) ** 2 + (o.pos.y - FOOT_SPOT.y) ** 2) < BALL_DIAMETER + 1,
          );
          const spotX = occupied ? FOOT_SPOT.x + BALL_DIAMETER : FOOT_SPOT.x;
          return { ...b, pos: { x: spotX, y: FOOT_SPOT.y }, pocketed: false, vel: { x: 0, y: 0 } };
        }
        return b;
      });
    }

    const pendingBot = pendingBotShotsRef.current;
    if (pendingBot.length > 0) {
      const nextBotInput = pendingBot.shift()!;
      // Reconcile client ball state with what the server expects.
      // For the STATIC RENDER between shots (while bot "thinks"), we keep the
      // cue ball pocketed if the bot has ball-in-hand — the placement preview
      // shows a pulsing ghost cue instead. The cue is only un-pocketed and
      // placed right before the animation starts (in setAnimShot).
      const needsCuePlace = nextBotInput.cuePosition != null;
      const ballsForRender = reconciledBalls;

      // For the static render, DON'T un-pocket the cue yet (placement preview handles it).
      setAnimBallsOverride(ballsForRender);
      setMatch((prev) => prev ? { ...prev, balls: ballsForRender } : prev);

      // Build the FULL ball state with cue placed — used later when setAnimShot fires.
      // This is what the canvas animation will use as its starting balls.
      const ballsForAnim = needsCuePlace
        ? ballsForRender.map((b) =>
            b.id === 0
              ? { ...b, pos: { x: nextBotInput.cuePosition!.x, y: nextBotInput.cuePosition!.y }, pocketed: false, vel: { x: 0, y: 0 } }
              : b,
          )
        : ballsForRender;

      // Show the human's foul banner before bot takes over (if any)
      const humanFoul = pendingFoulMessageRef.current;
      if (humanFoul) {
        pendingFoulMessageRef.current = null;
        SoundManager.play('foul');
        showStatusBanner(humanFoul, 'foul', FOUL_OVERLAY_MS);
      }

      const cueBall = ballsForAnim.find((b) => b.id === 0 && !b.pocketed);
      const hasBallInHand = nextBotInput.cuePosition !== null;

      // Helper: start the aim preview + shot after placement is done
      const pickValidPlacementPreview = (behindHeadString: boolean, finalPos: Vec2): Vec2 => {
        const minX = CUSHION_WIDTH + BALL_RADIUS + 20;
        const maxX = behindHeadString ? HEAD_STRING_X - 20 : TABLE_WIDTH * 0.5;
        const minY = CUSHION_WIDTH + BALL_RADIUS + 30;
        const maxY = TABLE_HEIGHT - CUSHION_WIDTH - BALL_RADIUS - 30;

        for (let attempt = 0; attempt < 12; attempt++) {
          const candidate = {
            x: minX + Math.random() * (maxX - minX),
            y: minY + Math.random() * (maxY - minY),
          };
          if (isValidCuePlacement(candidate, ballsForRender, { behindHeadString })) {
            return candidate;
          }
        }

        return finalPos;
      };

      const startBotAimAndShoot = (startDelay: number) => {
        const cuePos = nextBotInput.cuePosition ?? cueBall?.pos ?? { x: 400, y: 400 };
        const botCue = getBotCueTheme(match);
        if (!hasBallInHand) showStatusBanner('Their shot.', 'neutral', BOT_AIM_PREVIEW_MS);
        queueTimeout(() => {
          setBotPlacementPreview(null);
          setBotAim({ angle: nextBotInput.angle, power: nextBotInput.power, cuePos, cueTheme: botCue ?? undefined });
        }, startDelay + BOT_AIM_SETUP_MS);
        queueTimeout(() => {
          setBotAim(null);
          activeShotShooterRef.current = BOT_SHOOTER_ID;
          setActiveShotCueTheme(botCue);
          // Switch to full ball state with cue placed right before animation.
          // During the placement preview, the override kept the cue pocketed
          // so only the ghost preview was visible (no double cue ball).
          setAnimBallsOverride(ballsForAnim);
          setAnimShot({
            angle: nextBotInput.angle,
            power: nextBotInput.power,
            cuePosition: nextBotInput.cuePosition,
            spinX: nextBotInput.spinX ?? 0,
            spinY: nextBotInput.spinY ?? 0,
          });
        }, startDelay + BOT_AIM_PREVIEW_MS);
      };

      if (hasBallInHand) {
        // Bot "thinks" about where to place the cue ball — show it scanning
        // a few positions before settling on its chosen spot.
        showStatusBanner('Their shot.', 'neutral',
          BOT_PLACEMENT_STEPS * BOT_PLACEMENT_STEP_MS + BOT_PLACEMENT_SETTLE_MS);
        const finalPos = nextBotInput.cuePosition!;
        const behindHeadString = finalPos.x <= HEAD_STRING_X + 20;

        for (let step = 0; step < BOT_PLACEMENT_STEPS; step++) {
          queueTimeout(() => {
            setBotPlacementPreview(pickValidPlacementPreview(behindHeadString, finalPos));
          }, step * BOT_PLACEMENT_STEP_MS);
        }
        // Settle on the actual position
        const settleTime = BOT_PLACEMENT_STEPS * BOT_PLACEMENT_STEP_MS;
        queueTimeout(() => {
          setBotPlacementPreview(finalPos);
        }, settleTime);
        // Then start aiming after a brief pause
        startBotAimAndShoot(settleTime + BOT_PLACEMENT_SETTLE_MS);
      } else {
        startBotAimAndShoot(0);
      }
      return;
    }

    // Clear the ball override — we're done chaining, back to React state.
    // Apply reconciled balls (with 8-ball respotted if needed) while waiting
    // for the server's authoritative state.
    setAnimBallsOverride(null);
    if (eightPocketed) {
      setMatch((prev) => prev ? { ...prev, balls: reconciledBalls } : prev);
    }

    const finalMatch = pendingMatchRef.current;
    if (finalMatch) {
      setMatch({ ...finalMatch });
      setLivePotted([]);
      pendingMatchRef.current = null;
    }

    const foulText = pendingFoulMessageRef.current;
    pendingFoulMessageRef.current = null;
    setCueDropPos(null);

    if (foulText) {
      SoundManager.play('foul');
      setFoulMessage(foulText);
      showStatusBanner(foulText, 'foul', FOUL_OVERLAY_MS);
      queueTimeout(() => setFoulMessage((current) => (current === foulText ? null : current)), FOUL_OVERLAY_MS);
    } else {
      setFoulMessage(null);
    }

    if (!finalMatch) {
      // Server response hasn't arrived yet (animation was faster than network).
      // Wait briefly then re-invoke handleAnimationEnd with the same finalBalls
      // so all post-animation logic (bot shots, fouls, turn transitions) runs.
      let waited = 0;
      const waitForServer = () => {
        if (pendingMatchRef.current || pendingBotShotsRef.current.length > 0) {
          handleAnimationEnd(finalBalls);
        } else if (waited < 5000) {
          waited += 50;
          queueTimeout(waitForServer, 50);
        } else {
          // Gave up waiting — re-fetch match state and unlock the UI
          setAnimBallsOverride(null);
          setIsAnimating(false);
          fetchMatch(matchId).then((r) => { if (r) setMatch(r.match); });
        }
      };
      queueTimeout(waitForServer, 50);
      return;
    }

    if (finalMatch.phase === 'game_over') {
      if (!isSpectator) {
        SoundManager.play(finalMatch.winnerId === userId ? 'win' : 'lose');
        // The win pattern, once per match.
        if (finalMatch.winnerId === userId && winFeltRef.current !== finalMatch.id) {
          winFeltRef.current = finalMatch.id;
          trigger('round-win', { sound: false, motion: false, haptic: true });
        }
      }
      setIsAnimating(false);
      return;
    }

    if (finalMatch.foulState?.ballInHand && finalMatch.currentTurn === userId) {
      // Short pause so the player reads the foul banner, then let them place
      queueTimeout(() => {
        setIsAnimating(false);
        setPlacingCue(true);
      }, Math.min(FOUL_OVERLAY_MS, 400));
      return;
    }

    if (foulText) {
      setIsAnimating(false);
      return;
    }

    const shotStayedWithSameSide = activeShotShooterRef.current === userId && finalMatch.currentTurn === userId;
    if (shotStayedWithSameSide) {
      // Brief pause so the player registers the pot before aiming resumes
      queueTimeout(() => setIsAnimating(false), 100);
      return;
    }

    if (finalMatch.currentTurn === userId) {
      showStatusBanner('Your shot.', 'good', PLAYER_SWITCH_DELAY_MS);
      queueTimeout(() => {
        setIsAnimating(false);
      }, PLAYER_SWITCH_DELAY_MS);
      return;
    }

    setIsAnimating(false);
    // Only show "Opponent turn" for human opponents; bots act immediately so
    // the banner would just flash and vanish — distracting rather than helpful.
    if (finalMatch && !finalMatch.currentTurn.startsWith('bot:')) {
      showStatusBanner('Their shot.', 'neutral', PLAYER_SWITCH_DELAY_MS);
    }
    // Reads the post-shot match via pendingMatchRef; depending on `match`
    // would re-run this resolution handler mid-animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueTimeout, showStatusBanner, userId, matchId, isSpectator, trigger]);

  const handleForfeit = useCallback(async () => {
    if (!match) return;
    setMenuOpen(false);
    setForfeitAsk(false);
    try {
      const result = await submitForfeit(matchId);
      if (result.match) setMatch(result.match);
      if (result.eloChange) setEloChange(result.eloChange);
    } catch {
      showStatusBanner('The forfeit did not go through.', 'foul', 1500);
    }
  }, [match, matchId, showStatusBanner]);

  const handleCancel = useCallback(async () => {
    if (!match || match.status !== 'waiting') return;
    try {
      const res = await fetch(`/api/games/8-ball/match/${matchId}/cancel`, { method: 'POST' });
      if (res.ok) {
        router.push('/8-ball');
      } else {
        showStatusBanner('The table could not be closed.', 'foul', 1500);
      }
    } catch {
      showStatusBanner('The table could not be closed.', 'foul', 1500);
    }
  }, [match, matchId, router, showStatusBanner]);


  // ── Feel: presentation only. The canvas reports what the precomputed
  // frames already show; nothing here reaches the shot or the server.
  const onFeelEvent = useCallback((event: PoolFeelEvent) => {
    if (event.type === 'impact') {
      // The single biggest impact: a hard break. Hit-stop and a 2 to 4 px
      // shake; both are off under reduced motion.
      if (event.isBreak && event.power >= HARD_BREAK_POWER) {
        trigger('impact', {
          sound: false,
          motion: false,
          hitStop: true,
          shake: event.power,
        });
      }
      return;
    }
    if (event.type === 'pot') {
      if (event.ballId === 0) return;
      setLivePotted((prev) => (prev.includes(event.ballId) ? prev : [...prev, event.ballId]));
      // A tick for one of your balls going down on your shot. Before the
      // groups are set, any ball but the 8 counts.
      if (activeShotShooterRef.current === userId && event.ballId !== 8) {
        const group = match && userId
          ? (match.player1Id === userId ? match.player1Group : match.player2Group)
          : null;
        const yours = !group
          || (group === 'solids' ? event.ballId < 8 : event.ballId > 8);
        if (yours) trigger('collect', { sound: false, motion: false, haptic: true });
      }
    }
  }, [trigger, userId, match]);

  const canvasFeel = useMemo(
    () => ({ hitStop: hitStopClock, shakeOffset, onEvent: onFeelEvent }),
    [hitStopClock, shakeOffset, onFeelEvent],
  );

  const fitTable = useCallback((size: GameStageSize) => setStageSize(size), []);

  const paid = runResult?.reward?.awardedCredits ?? matchReward?.awardedCredits ?? null;
  useEffect(() => {
    if (!isGameOver || paid == null || isGuest) return;
    void refreshWallet?.();
  }, [isGameOver, paid, isGuest, refreshWallet]);

  const opponentId = match && userId
    ? (match.player1Id === userId ? match.player2Id : match.player1Id)
    : null;
  const isBotMatch = Boolean(match?.player2Id?.startsWith('bot:'));
  const isHumanMatch = Boolean(match?.player2Id && !isBotMatch);

  // The result counts your own shots; a match that ended on this page asks
  // the server once for them.
  useEffect(() => {
    if (!isGameOver || isAnimating || isSpectator || myShots != null) return;
    let cancelled = false;
    void fetchMatch(matchId).then((result) => {
      if (cancelled || !result) return;
      if (typeof result.myShots === 'number') setMyShots(result.myShots);
      // A payout waiting for this player (the other player's shot ended it).
      if (result.runResult) setRunResult(result.runResult);
      if (result.accountXp) setAccountXp(result.accountXp);
    });
    return () => { cancelled = true; };
  }, [isGameOver, isAnimating, isSpectator, myShots, matchId]);

  // Rematch for a player match is a challenge, and challenges go to friends.
  useEffect(() => {
    if (!isGameOver || !isHumanMatch || isSpectator || isGuest || !opponentId) return;
    let cancelled = false;
    void fetch('/api/friends', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { friends?: Array<{ userId: string }>; outgoing?: Array<{ userId: string }> } | null) => {
        if (cancelled || !data) return;
        setFriendsWithOpponent(Boolean(data.friends?.some((f) => f.userId === opponentId)));
        if (data.outgoing?.some((f) => f.userId === opponentId)) setFriendRequest('sent');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isGameOver, isHumanMatch, isSpectator, isGuest, opponentId]);

  const handleAddFriend = useCallback(async () => {
    if (!opponentId || friendRequest !== 'idle') return;
    trigger('press', { haptic: true });
    setFriendRequest('sending');
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: opponentId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'The friend request did not go through.');
      setFriendRequest('sent');
    } catch (err) {
      setRematchError((err as Error).message);
      setFriendRequest('idle');
    }
  }, [opponentId, friendRequest, trigger]);

  // After a human match, watch for the other player's rematch request, so
  // rematch joins their table instead of opening a second one.
  useEffect(() => {
    if (!isGameOver || !isHumanMatch || isSpectator || !opponentId || !userId || !match) return;
    const endedAt = match.completedAt ?? match.updatedAt;
    let active = true;
    const check = async () => {
      try {
        const res = await fetch('/api/games/8-ball/matches', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { myMatches?: PoolMatch[] };
        const asked = (data.myMatches ?? [])
          .filter((m) =>
            m.status === 'waiting'
            && m.player1Id === opponentId
            && m.invitedUserId === userId
            && m.createdAt >= endedAt - 1000)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (active) {
          setRematchFrom(asked
            ? { matchId: asked.id, name: asked.player1Name, wager: asked.wagerAmount ?? 0 }
            : null);
        }
      } catch { /* the next check tries again */ }
    };
    void check();
    const unsub = subscribeLive(['poolLobby'], () => { void check(); });
    const stop = startVisiblePolling(check, 5000);
    return () => { active = false; unsub(); stop(); };
  }, [isGameOver, isHumanMatch, isSpectator, opponentId, userId, match]);

  const handleRematch = useCallback(async () => {
    if (!match || !userId || rematchBusy) return;
    trigger('press', { haptic: true });
    setRematchBusy(true);
    setRematchError(null);
    try {
      if (isBotMatch) {
        // Practice: the same bot, a fresh rack.
        const res = await fetch('/api/games/8-ball/match/bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: match.player2Id!.replace('bot:', '') }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.match?.id) throw new Error(payload.error || 'The table could not be racked.');
        router.push(`/8-ball/${payload.match.id}`);
        return;
      }
      if (!opponentId) return;
      const join = async (id: string) => {
        const res = await fetch('/api/games/8-ball/match/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: id }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'That rematch is closed.');
        router.push(`/8-ball/${id}`);
      };
      // They asked first: join their table. A table with a stake holds
      // tickets on join, so the first press only shows the stake.
      if (rematchFrom) {
        if (rematchFrom.wager > 0 && !stakeConfirm) {
          setStakeConfirm(true);
          setRematchBusy(false);
          return;
        }
        await join(rematchFrom.matchId);
        return;
      }
      // The existing challenge flow, to the same player. No wager is carried
      // over: a stake is something each player puts up again on purpose.
      // If they challenged us in the same moment, the route answers with
      // their table (`inviteFromTarget`) and we join it.
      const res = await fetch('/api/games/8-ball/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: opponentId, ...(match.hardcoreMode && { hardcoreMode: true }) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof payload.matchId === 'string') {
          router.push(`/8-ball/${payload.matchId}`);
          return;
        }
        throw new Error(payload.error || 'The rematch could not be sent.');
      }
      if (payload.inviteFromTarget) {
        await join(payload.matchId as string);
        return;
      }
      router.push(`/8-ball/${payload.matchId as string}`);
    } catch (err) {
      setRematchError((err as Error).message);
      setRematchBusy(false);
    }
  }, [match, userId, rematchBusy, trigger, isBotMatch, opponentId, rematchFrom, stakeConfirm, router]);

  const handleRemind = useCallback(async () => {
    trigger('press', { haptic: true });
    setReminderSending(true);
    try {
      const res = await fetch(`/api/games/8-ball/match/${matchId}/remind`, { method: 'POST' });
      const data = await res.json();
      if (data.sent) {
        setCanRemind(false);
        showStatusBanner('Nudge sent.', 'good', 1500);
      } else {
        showStatusBanner(data.error || 'The nudge did not go through.', 'foul', 1500);
      }
    } catch {
      showStatusBanner('The nudge did not go through.', 'foul', 1500);
    } finally {
      setReminderSending(false);
    }
  }, [matchId, showStatusBanner, trigger]);

  // The power bar as a second way to shoot: it keeps the aim and sets only
  // the power, so a close shot doesn't need a pull on a 10 px cue ball.
  const powerDrag = useMemo(() => ({
    start: () => setAim((prev) => (prev.phase === 'idle' ? prev : { ...prev, phase: 'powering', power: 0, dragStart: null })),
    set: (power: number) => setAim((prev) => (prev.phase === 'powering' ? { ...prev, power } : prev)),
    end: () => { void handleCanvasRelease(); },
    cancel: () => handleCanvasCancel(),
  }), [handleCanvasRelease, handleCanvasCancel]);
  const canPowerDrag = isMyTurn && !placingCue && !isSpectator && aim.phase !== 'idle';

  const myRating = userId ? (playerElo[userId]?.rating ?? null) : null;
  const stat = !isGuest && !isBotMatch ? <GameStat value={myRating} label='rating' /> : null;

  if (loading || error || !match) {
    return (
      <GameShell game='8-ball' howTo={POOL_HOW_TO} backHref='/8-ball' className='pool-midway'>
        <GameStage
          phase={error ? 'over' : 'ready'}
          busy={error ? null : 'Racking the table.'}
          end={error ? (
            <GameStageNotice
              title='Table closed'
              action={<ArcadeLinkButton href='/8-ball' tone='primary'>lobby</ArcadeLinkButton>}
            >
              <p>{error ?? 'This match is not here any more.'}</p>
            </GameStageNotice>
          ) : null}
        >
          <div className='pool-table' />
        </GameStage>
      </GameShell>
    );
  }

  const phase: GamePhase = isGameOver ? 'over' : isAnimating ? 'playing' : 'ready';
  const hint: GameHint | undefined = !isSpectator && isMyTurn
    ? placingCue ? PLACE_HINT : aim.phase === 'powering' ? POWER_HINT : SHOT_HINT
    : undefined;
  const opponentName = (match.player1Id === userId ? match.player2Name : match.player1Name) ?? 'your opponent';
  const shownPower = aim.phase === 'powering' ? aim.power : lastPower;

  // The row under the table when the shot isn't yours: whose it is, and
  // nudge for a person. A spectator sees the count watching.
  let note: React.ReactNode = null;
  if (isSpectator) {
    note = (
      <span>
        <Num value={Math.max(1, spectatorCount)} /> watching.
      </span>
    );
  } else if (isWaitingForOpponent) {
    note = (
      <span className='flex items-center justify-between gap-3'>
        <span>No one has joined yet.</span>
        <ArcadeButton size='sm' onClick={() => { trigger('press', { haptic: true }); void handleCancel(); }}>close</ArcadeButton>
      </span>
    );
  } else if (!isGameOver && !isMyTurn && !isAnimating) {
    const shooter = opponentName.replace(/ \(bot\)$/i, '');
    note = match.currentTurn.startsWith('bot:') || !isHumanMatch ? (
      <span>{shooter}&apos;s shot.</span>
    ) : (
      <span className='flex items-center justify-between gap-3'>
        <span>{shooter}&apos;s shot.</span>
        <ArcadeButton size='sm' disabled={!canRemind || reminderSending} onClick={() => void handleRemind()}>
          {canRemind ? 'nudge' : 'nudged'}
        </ArcadeButton>
      </span>
    );
  }

  const hudBalls = livePotted.length > 0
    ? match.balls.map((b) => (livePotted.includes(b.id) ? { ...b, pocketed: true } : b))
    : match.balls;

  const end = isGameOver ? (
    replayOpen && replayData ? (
      <MatchReplayViewer
        replay={replayData}
        theme={poolTheme}
        currentUserId={userId ?? ''}
        replaySaved={replaySaved}
        saveReplayToken={replaySaveToken}
        prefetchedVideoBlob={liveReplayVideoBlob}
        onClose={() => setReplayOpen(false)}
        onSaveReplayError={handleReplayVideoError}
        onSaveReplay={handleReplayVideoSaved}
        onPlayAgain={() => void handleRematch()}
      />
    ) : isAnimating ? null : (
      <PoolResult
        match={match}
        userId={userId ?? ''}
        isSpectator={isSpectator}
        guest={isGuest}
        eloChange={eloChange}
        botRecord={botRecord}
        matchReward={matchReward}
        accountXp={accountXp}
        runResult={runResult}
        rematchFrom={rematchFrom ? { name: rematchFrom.name, wager: rematchFrom.wager } : null}
        stakeConfirm={stakeConfirm}
        myShots={myShots}
        rematch={isBotMatch || rematchFrom || friendsWithOpponent ? 'rematch' : friendsWithOpponent === false ? 'add-friend' : 'unknown'}
        friendRequest={friendRequest}
        onAddFriend={() => void handleAddFriend()}
        rematchBusy={rematchBusy}
        rematchError={rematchError}
        onRematch={() => void handleRematch()}
        onLobby={handleLobby}
        onReplay={isSpectator || isGuest ? undefined : () => void handleOpenReplay()}
        replayBusy={replayLoading}
        replayError={replayError}
      />
    )
  ) : null;

  const hud = { ...match, balls: hudBalls };

  return (
    <GameShell
      game='8-ball'
      stat={stat}
      howTo={POOL_HOW_TO}
      backHref='/8-ball'
      className='pool-midway'
      below={
        showMatchChat || (userId && !isSpectator && !isGuest) ? (
          <>
            {showMatchChat ? (
              <MatchChat
                matchId={matchId}
                userId={userId!}
                player1Id={match.player1Id}
                player2Id={match.player2Id!}
              />
            ) : null}
            {userId && !isSpectator && !isGuest ? (
              <MatchSwitcher currentMatchId={matchId} userId={userId} inline />
            ) : null}
          </>
        ) : undefined
      }
    >
      <PoolHud
        match={hud}
        userId={userId}
        isSpectator={isSpectator}
        isAnimating={isAnimating}
        placingCue={placingCue}
        avatars={playerAvatars}
        cards={playerCards}
        turnTimeRemainingMs={turnTimeRemainingMs}
      />
      <GameStage
        phase={phase}
        hint={hint}
        onSize={fitTable}
        end={end}
        controls={isGameOver ? null : (
          <PoolControls
            note={note}
            spinX={spinX}
            spinY={spinY}
            onSpin={handleSpinChange}
            spinEnabled={isMyTurn && aim.phase !== 'powering'}
            power={shownPower}
            onPress={() => trigger('press', { haptic: true })}
            onMenu={isSpectator ? undefined : () => setMenuOpen(true)}
            powerDrag={canPowerDrag ? powerDrag : null}
            extra={isHardcoreMatch && match.phase !== 'break' && isMyTurn ? (
              <PocketSelector selectedPocket={calledPocket} onSelect={setCalledPocket} visible />
            ) : null}
          />
        )}
      >
        <div ref={matchCanvasHostRef} className='pool-table'>
          <PoolCanvas
            theme={poolTheme}
            fitBox={stageSize ? { width: stageSize.width - 8, height: stageSize.height - 8 } : null}
            feel={canvasFeel}
            canvasClassName='block'
            balls={cueDropPos
              ? match.balls.map((b) =>
                  b.id === 0
                    ? { ...b, pos: { x: cueDropPos.x, y: cueDropPos.y }, pocketed: false, vel: { x: 0, y: 0 } }
                    : b,
                )
              : match.balls}
            animateShot={animShot}
            animBallsOverride={animBallsOverride}
            animShotCueTheme={activeShotCueTheme}
            onAnimationEnd={handleAnimationEnd}
            aimGuideEmphasis={guideEmphasis}
            aimLine={aimLine}
            aimPath={aimPath}
            ghostBall={ghostBall}
            targetLine={targetLine}
            cueStick={cueStickData}
            spinIndicator={showPlayerAim ? { x: spinX, y: spinY } : null}
            cueDeflectionLine={cueDeflectionLine}
            ballInHandPreview={placingCue ? cursorTablePos : botPlacementPreview}
            ballInHandValid={
              placingCue && cursorTablePos
                ? isValidCuePlacement(cursorTablePos, match.balls, {
                    behindHeadString: match.foulState?.behindHeadString ?? false,
                  })
                : true /* bot placement + no preview = valid */
            }
            ballInHandRestrictedToHeadString={placingCue && (match.foulState?.behindHeadString ?? false)}
            highlightBallIds={myBallIds}
            onCanvasInteraction={handleCanvasInteraction}
            onCanvasMove={handleCanvasMove}
            onCanvasRelease={handleCanvasRelease}
            onCanvasCancel={handleCanvasCancel}
          />
        </div>
        {statusBanner && !isGameOver ? (
          <div key={statusBanner.id} className='pool-banner' data-tone={statusBanner.tone} role='status'>
            {statusBanner.text}
          </div>
        ) : null}
        {foulMessage && !statusBanner && !isGameOver ? (
          <div className='pool-banner' data-tone='foul' role='status'>{foulMessage}</div>
        ) : null}
      </GameStage>

      <ArcadeDialog open={menuOpen} onClose={() => { setMenuOpen(false); setForfeitAsk(false); }} title='table menu' maxWidth={384}>
        <div className='pool-menu'>
          {forfeitAsk ? (
            <section>
              <h3>forfeit this match?</h3>
              <p>
                It counts as a loss
                {match.wagerAmount
                  ? match.moveCount < 4
                    ? <>, and both stakes of <Num value={match.wagerAmount} /> tickets go back</>
                    : <>, and your <Num value={match.wagerAmount} /> tickets on the table go to {opponentName}</>
                  : null}.
              </p>
              <div className='pool-menu-row mt-3'>
                <ArcadeButton onClick={() => setForfeitAsk(false)}>keep playing</ArcadeButton>
                <ArcadeButton tone='danger' onClick={() => void handleForfeit()}>forfeit</ArcadeButton>
              </div>
            </section>
          ) : null}
          {match.wagerAmount ? (
            <p><Num value={match.wagerAmount} /> tickets on this table.</p>
          ) : null}
          {isHardcoreMatch ? <p>Hardcore: no aim lines, and you call the pocket for the 8.</p> : null}
          <div className='pool-menu-row'>
            <ArcadeLinkButton href='/8-ball' size='md'>lobby</ArcadeLinkButton>
            {isWaitingForOpponent ? (
              <ArcadeButton tone='danger' onClick={() => { setMenuOpen(false); void handleCancel(); }}>close table</ArcadeButton>
            ) : !isGameOver && !isGuest && !forfeitAsk ? (
              <ArcadeButton tone='danger' onClick={() => { trigger('press', { haptic: true }); setForfeitAsk(true); }}>forfeit</ArcadeButton>
            ) : null}
          </div>
        </div>
      </ArcadeDialog>
    </GameShell>
  );
}
