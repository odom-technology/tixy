'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Crown,
  Flag,
  HandshakeIcon,
  Eye,
} from 'lucide-react';
import {
  GameShell,
  GameStage,
  GameStat,
  type GameHowTo,
} from '@/features/arcade/components/shell/game-shell';
import { ArcadeButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import { useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { useInGamePresence } from '@/features/social/presence/presence-client';
import {
  resolveTimeFormat,
  type ChessMatch,
  type ChessColor,
} from '@/features/arcade/lib/chess/types';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import { ChessBoard } from '../_chess-board';
import { MatchClock } from '../_match-clock';
import { MoveList } from '../_move-list';
import { MatchChat } from '../_match-chat';
import { PostgameResult } from '../_postgame-overlay';
import { ReplayControls } from '../_replay-controls';
import { EvalBar } from '../_eval-bar';
import { STARTING_FEN } from '@/features/arcade/lib/chess/types';
import {
  playMoveSound,
  type MoveSoundKind,
} from '../_sounds';
import {
  ChessPlayerCard,
  computeCapturedPieces,
  DEFAULT_PLAYERCARD_THEME,
  type PlayercardTheme,
} from '../_player-card';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { isPlayercardAnimation } from '@/features/arcade/lib/pool-playercard-theme';
import {
  DEFAULT_CHESS_THEME,
  composeChessTheme,
  type ChessTheme,
} from '@/features/arcade/lib/chess/theme';
import { resolveBaseChessTheme, MIDWAY_PIECE_STROKE } from '../_midway-theme';
import { chessSkinLook, type ChessSkinLook } from '../_chess-skin';
import { findEquippedSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

// The ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HOW_TO: GameHowTo = {
  lines: [
    'Tap a piece, then a square, or drag it there.',
    'Checkmate wins, and so does their clock running out.',
    'Move during their turn and it plays the moment it is yours.',
  ],
};

type MoveRow = {
  ply: number;
  moveNumber: number;
  uci: string;
  san: string;
  fenAfter: string;
  playerId: string;
  clockRemainingMs: number;
  moveDurationMs: number;
  evalCentipawns: number | null;
  analysisBestMoveUci: string | null;
  createdAt: number;
};

/** Classification of a played move based on centipawn loss vs. the best move. */
type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null;

type MatchResponse = {
  match: ChessMatch;
  userId: string;
  liveClock: { whiteMs: number; blackMs: number; asOf: number };
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

export default function ChessMatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = (params?.id as string) ?? '';
  useInGamePresence('chess');
  const [data, setData] = useState<MatchResponse | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [accountXp, setAccountXp] = useState<AccountXpReward | null>(null);
  const [runResult, setRunResult] = useState<ArcadeRunResultSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionPending, setActionPending] = useState<null | 'resign' | 'draw-offer' | 'draw-accept' | 'draw-decline' | 'cancel'>(null);
  const [playercardTheme, setPlayercardTheme] = useState<PlayercardTheme | undefined>(undefined);
  const [chessTheme, setChessTheme] = useState<ChessTheme>(DEFAULT_CHESS_THEME);
  // An equipped skin set (SKINS.md) replaces the board, the pieces and the
  // sound tint together; without one the older per-slot cosmetics apply.
  const [chessSkin, setChessSkin] = useState<ChessSkinLook | null>(null);
  const skinSound = chessSkin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const [opponentElo, setOpponentElo] = useState<{ rating: number; tier: string; tierColor: string } | null>(null);
  const [myElo, setMyElo] = useState<{ rating: number; tier: string; tierColor: string } | null>(null);
  const lastSoundPlyRef = useRef<number>(-1);
  const lastGameEndSoundRef = useRef<string | null>(null);
  const soundInitializedRef = useRef<boolean>(false);
  const turnSoundTimeoutRef = useRef<number | null>(null);
  const loadEpochRef = useRef(0);
  const [lastMoveWasCapture, setLastMoveWasCapture] = useState(false);
  // Replay state — set to a ply number to view a historical position of a
  // finished match. null = live / final position.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{
    running: boolean;
    analyzedPlies: number;
  } | null>(null);
  // Rematch invite received from the opponent after this game ended. Surfaces
  // a banner in the postgame overlay so the invited player doesn't have to
  // leave for the lobby to see it.
  const [pendingRematch, setPendingRematch] = useState<{
    matchId: string;
    senderName: string;
  } | null>(null);
  // A challenge from the opponent that is not a plain rematch (a wager, or
  // another time format). It is never one-tap: the lobby shows the stake.
  const [incomingChallenge, setIncomingChallenge] = useState<{ senderName: string } | null>(null);
  // What a screen reader hears when a move is played.
  const [announcement, setAnnouncement] = useState('');
  // White-POV centipawn eval of the starting position. Returned by the
  // moves endpoint once any analysis has run on the process; used as the
  // "prev" baseline for the first move's accuracy/quality calc and for
  // the ply-0 eval bar. Null means we haven't seen a baseline yet — the
  // UI falls back to 0.
  const [baselineCp, setBaselineCp] = useState<number | null>(null);
  // The board's wrapper: the feel kit shakes it when a piece is taken.
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const { trigger } = useGameFeedback({ stage: boardContainerRef });
  // The result can be hidden to look at the final position (review, Escape).
  const [resultDismissed, setResultDismissed] = useState(false);

  const load = useCallback(async () => {
    // Guard against overlapping requests: if a newer load() finishes first,
    // drop any older in-flight response so stale state can't clobber fresh.
    const epoch = ++loadEpochRef.current;
    try {
      const [matchRes, movesRes] = await Promise.all([
        fetch(`/api/games/chess/match/${matchId}`, { cache: 'no-store' }),
        fetch(`/api/games/chess/match/${matchId}/moves`, { cache: 'no-store' }),
      ]);
      if (epoch !== loadEpochRef.current) return;
      const matchPayload = await matchRes.json();
      // Account-XP burst is served (and consumed) once by the match route, so
      // capture it before the epoch guard — a superseded load still saw it and
      // dropping it here would lose the burst. Sticky: a later null won't clear.
      if (matchPayload?.accountXp) setAccountXp(matchPayload.accountXp);
      if (matchPayload?.runResult) setRunResult(matchPayload.runResult);
      if (epoch !== loadEpochRef.current) return;
      if (!matchRes.ok) {
        setError(matchPayload.error || 'Failed to load match.');
        return;
      }
      setData(matchPayload);
      setError(null);
      if (movesRes.ok) {
        const movesPayload = await movesRes.json();
        if (epoch !== loadEpochRef.current) return;
        setMoves(movesPayload.moves ?? []);
        if (typeof movesPayload.baselineCp === 'number') {
          setBaselineCp(movesPayload.baselineCp);
        }
      }
    } catch (err) {
      if (epoch !== loadEpochRef.current) return;
      setError((err as Error).message);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    void load();
  }, [matchId, load]);

  // Live updates via SSE + a slow polling backstop. Subscribe to the global
  // `chessMatch` channel (per-match channels aren't forwarded by the SSE
  // route). The handler refetches this specific match; broadcasts for other
  // matches cause a harmless extra fetch. SSE is the primary signal, so the
  // poll runs infrequently to avoid stacking refetches on top of realtime —
  // 15s active / 60s finished.
  const matchStatus = data?.match?.status;
  useEffect(() => {
    if (!matchId) return;
    // Filter by matchId so every open chess tab doesn't refetch on another
    // player's move. The `chessMatch` channel is global, but broadcasts
    // always carry the match's own id in the payload.
    const unsub = subscribeLive(['chessMatch'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void load();
    });
    const isFinished = matchStatus === 'completed' || matchStatus === 'forfeited';
    const pollMs = isFinished ? 60_000 : 15_000;
    const stopPolling = startVisiblePolling(load, pollMs);
    return () => { unsub(); stopPolling(); };
  }, [matchId, load, matchStatus]);

  // Load chess cosmetics: pieces, board, clock themes.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=chess', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        const equipped = payload?.equipped ?? [];
        const skinSet = findEquippedSkinSet(equipped, 'chess');
        const t: Record<string, unknown> = {};
        for (const e of equipped) {
          if (e?.item?.assetRef) Object.assign(t, e.item.assetRef);
        }
        if (!cancelled) {
          setChessSkin(skinSet ? chessSkinLook(skinSet) : null);
          setChessTheme(composeChessTheme(t));
        }
      } catch { /* defaults apply */ }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Load cosmetics: reuse equipped 8-Ball playercard so purchases carry over.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=8-ball', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        const equipped = payload?.equipped ?? [];
        const t: Record<string, unknown> = {};
        for (const e of equipped) {
          if (e?.item?.assetRef) Object.assign(t, e.item.assetRef);
        }
        const hasPlayercardCosmetics = [
          'cardBg', 'cardAnimation', 'cardBorder', 'nameColor', 'eloColor',
          'animationPrimaryColor', 'animationSecondaryColor',
        ].some((k) => t[k] !== undefined);
        if (hasPlayercardCosmetics && !cancelled) {
          setPlayercardTheme({
            cardBg: (t.cardBg as string) ?? DEFAULT_PLAYERCARD_THEME.cardBg,
            cardAnimation: isPlayercardAnimation(t.cardAnimation) ? t.cardAnimation : DEFAULT_PLAYERCARD_THEME.cardAnimation,
            cardBorder: (t.cardBorder as string) ?? DEFAULT_PLAYERCARD_THEME.cardBorder,
            nameColor: (t.nameColor as string) ?? DEFAULT_PLAYERCARD_THEME.nameColor,
            eloColor: (t.eloColor as string) ?? DEFAULT_PLAYERCARD_THEME.eloColor,
            animationPrimaryColor: (t.animationPrimaryColor as string) ?? DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
            animationSecondaryColor: (t.animationSecondaryColor as string) ?? DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
          });
        }
      } catch { /* cosmetics optional */ }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Load ELO info for both players (for the player cards)
  useEffect(() => {
    let cancelled = false;
    const loadElo = async (userId: string | null | undefined, setter: (v: { rating: number; tier: string; tierColor: string } | null) => void) => {
      if (!userId || userId.startsWith('bot:')) { setter(null); return; }
      try {
        const res = await fetch(`/api/games/chess/elo-leaderboard?userId=${userId}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = await res.json();
        if (payload.player) {
          setter({ rating: payload.player.eloRating, tier: payload.player.tier, tierColor: payload.player.tierColor });
        } else {
          setter(null);
        }
      } catch { /* ignore */ }
    };
    if (data?.match && data.userId) {
      const opponentId = data.match.player1Id === data.userId ? data.match.player2Id : data.match.player1Id;
      void loadElo(data.userId, setMyElo);
      void loadElo(opponentId, setOpponentElo);
    }
    return () => { cancelled = true; };
    // ELO only needs refetching when the pairing changes — depending on the
    // whole match object would refetch on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.match?.player1Id, data?.match?.player2Id, data?.userId]);

  const match = data?.match ?? null;
  // Equipped profile cosmetics (background/frame/badge/name color/title) for
  // both seats, so each chess player card shows the player's full namecard.
  // Bots have no real userId and fall back to the plain themed card.
  const playerCards = usePlayerCards(
    [match?.player1Id, match?.player2Id].filter(
      (id): id is string => !!id && !id.startsWith('bot:'),
    ),
  );
  const myColor: ChessColor | null = useMemo(() => {
    if (!match || !data) return null;
    if (match.whiteId === data.userId) return 'white';
    if (match.blackId === data.userId) return 'black';
    return null;
  }, [match, data]);

  // Play move sounds on each new ply; play a single game-end sound when the
  // match transitions to completed/forfeited. Skips the very first frame so
  // navigating into a mid-game match doesn't replay the last move's sound.
  // Also fires a subtle "turn" cue when it becomes your turn and tracks
  // whether the last move was a capture (for the board flash effect).
  useEffect(() => {
    if (!match) return;
    if (!soundInitializedRef.current) {
      soundInitializedRef.current = true;
      lastSoundPlyRef.current = match.ply;
      setLastMoveWasCapture((match.lastMoveSan ?? '').includes('x'));
      if (match.status === 'completed' || match.status === 'forfeited') {
        lastGameEndSoundRef.current = match.id;
      }
      return;
    }
    if (match.ply > lastSoundPlyRef.current) {
      lastSoundPlyRef.current = match.ply;
      const san = match.lastMoveSan ?? '';
      const kind = classifyMoveSound(san);
      playMoveSound(kind);
      // The cabinet's own cues play above; the feel kit adds the haptic tick
      // and, on a capture, a small shake of the board.
      if (kind === 'capture') {
        trigger('capture', { sound: false, motion: false, haptic: true, shake: 0.3 });
      } else {
        trigger('move', { sound: false, motion: false, haptic: true });
      }
      setLastMoveWasCapture(san.includes('x'));
      if (san && data) {
        const opponentNow =
          (match.player1Id === data.userId ? match.player2Name : match.player1Name) ?? 'Opponent';
        // The turn has passed to the other side, so if it is mine now they moved.
        setAnnouncement(
          match.currentTurn === data.userId ? `${opponentNow} played ${san}` : `You played ${san}`,
        );
      }
      // Follow-up "your turn" cue if the move was played by the opponent and
      // it's now our turn. Offset so it doesn't overlap the landing sound.
      // Stored in a ref so rapid effect re-runs don't stack scheduled cues.
      const isActive = match.status === 'active';
      const movedByOpponent = data && match.currentTurn === data.userId;
      if (isActive && movedByOpponent && kind !== 'check' && kind !== 'gameEnd') {
        if (turnSoundTimeoutRef.current !== null) {
          window.clearTimeout(turnSoundTimeoutRef.current);
        }
        turnSoundTimeoutRef.current = window.setTimeout(() => {
          turnSoundTimeoutRef.current = null;
          playMoveSound('turn');
        }, 240);
      }
    }
    const isOver = match.status === 'completed' || match.status === 'forfeited';
    if (isOver && lastGameEndSoundRef.current !== match.id) {
      lastGameEndSoundRef.current = match.id;
      playMoveSound('gameEnd');
    }
  }, [match?.ply, match?.status, match?.id, match?.lastMoveSan, match, data, trigger]);

  // Clear any pending turn-sound timeout on unmount.
  useEffect(() => () => {
    if (turnSoundTimeoutRef.current !== null) {
      window.clearTimeout(turnSoundTimeoutRef.current);
      turnSoundTimeoutRef.current = null;
    }
  }, []);

  // A rematch (new matchId on the same mounted component) starts clean.
  useEffect(() => {
    setAccountXp(null);
    setRunResult(null);
    setResultDismissed(false);
    setReviewPly(null);
    setPendingRematch(null);
    setIncomingChallenge(null);
  }, [matchId]);

  // Listen for incoming rematch invites from the opponent. The challenge
  // route broadcasts `chessChallenge:challenge_sent` when any invited match
  // is created; we only surface it here if the invite is for me and came
  // from this match's opponent so unrelated challenges don't trigger the
  // postgame rematch banner.
  useEffect(() => {
    if (!data || !match) return;
    if (match.status !== 'completed' && match.status !== 'forfeited') return;
    const opponentId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
    if (!opponentId || opponentId.startsWith('bot:')) return;
    const unsub = subscribeLive(['chessChallenge'], (payload) => {
      if (!payload || payload.type !== 'challenge_sent') return;
      if (payload.invitedUserId !== data.userId) return;
      if (payload.senderId !== opponentId) return;
      if (typeof payload.matchId !== 'string') return;
      const senderName = typeof payload.senderName === 'string' ? payload.senderName : 'Opponent';
      // One-tap accept joins the match, and joining holds any stake. So only
      // a challenge with no wager and the same time format is a rematch.
      const noWager = !payload.wagerAmount;
      const sameFormat = payload.timeFormatId === match.timeFormat;
      if (noWager && sameFormat) {
        setPendingRematch({ matchId: payload.matchId, senderName });
        setIncomingChallenge(null);
      } else {
        setIncomingChallenge({ senderName });
      }
    });
    return unsub;
  }, [data, match]);

  // Subscribe to analysis-progress events so the UI reflects evals as they
  // land. Global `chessAnalysis` channel; filtered to this match's id so
  // another player's analysis run doesn't cause this tab to refetch.
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeLive(['chessAnalysis'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void (async () => {
        try {
          const res = await fetch(`/api/games/chess/match/${matchId}/moves`, { cache: 'no-store' });
          if (!res.ok) return;
          const json = await res.json();
          const refreshed: MoveRow[] = json.moves ?? [];
          setMoves(refreshed);
          const analyzed = refreshed.filter((m) => m.evalCentipawns !== null).length;
          setAnalysisProgress((prev) => prev ? { ...prev, analyzedPlies: analyzed } : prev);
        } catch { /* ignore */ }
      })();
    });
    return unsub;
  }, [matchId]);

  const startAnalysis = useCallback(async () => {
    if (!matchId) return;
    setAnalysisProgress({ running: true, analyzedPlies: moves.filter((m) => m.evalCentipawns !== null).length });
    try {
      const res = await fetch(`/api/games/chess/match/${matchId}/analyze`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Failed to start analysis.');
        setAnalysisProgress(null);
      }
    } catch (err) {
      setError((err as Error).message);
      setAnalysisProgress(null);
    }
  }, [matchId, moves]);

  // When the server signals the analysis run has completed (progress reaches
  // total plies), clear the "running" indicator.
  useEffect(() => {
    if (!analysisProgress || !analysisProgress.running) return;
    if (moves.length > 0 && analysisProgress.analyzedPlies >= moves.length) {
      setAnalysisProgress({ running: false, analyzedPlies: moves.length });
    }
  }, [analysisProgress, moves.length]);

  const isMyTurn = Boolean(
    match && match.status === 'active' && data && match.currentTurn === data.userId,
  );

  const submitMove = useCallback(async (uci: string) => {
    if (!matchId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/games/chess/match/${matchId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uci }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error || 'Move rejected.');
        // Refetch to re-sync state even on error
        void load();
        return;
      }
      setData((prev) => (prev ? { ...prev, match: payload.match, eloChange: payload.eloChange ?? prev.eloChange } : prev));
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [matchId, submitting, load]);

  const action = useCallback(async (endpoint: string, action: typeof actionPending) => {
    if (!matchId || actionPending) return;
    setActionPending(action);
    try {
      const res = await fetch(`/api/games/chess/match/${matchId}/${endpoint}`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || 'Action failed.');
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionPending(null);
    }
  }, [matchId, actionPending, load]);

  const orientation: ChessColor = myColor ?? 'white';

  // Resolve the effective board/piece look: equipped skins win; otherwise the
  // Midway base look is substituted. Piece outline strokes follow the same
  // rule so the base set gets warm-espresso outlines and skins keep theirs.
  const resolvedLook = useMemo(
    () => (chessSkin ? { board: chessSkin.board, pieces: chessSkin.pieces, isBasePieces: false } : resolveBaseChessTheme(chessTheme)),
    [chessTheme, chessSkin],
  );
  const pieceStrokeWhite = chessSkin
    ? chessSkin.strokeWhite
    : resolvedLook.isBasePieces ? MIDWAY_PIECE_STROKE.white : '#0f172a';
  const pieceStrokeBlack = chessSkin
    ? chessSkin.strokeBlack
    : resolvedLook.isBasePieces ? MIDWAY_PIECE_STROKE.black : '#f8fafc';

  const topMs = orientation === 'white' ? data?.liveClock.blackMs : data?.liveClock.whiteMs;
  const bottomMs = orientation === 'white' ? data?.liveClock.whiteMs : data?.liveClock.blackMs;
  const topIsTurn = match?.status === 'active' && match.currentTurn === (orientation === 'white' ? match.blackId : match.whiteId);
  const bottomIsTurn = match?.status === 'active' && match.currentTurn === (orientation === 'white' ? match.whiteId : match.blackId);
  // The clock doesn't actually start running until both players have completed
  // their opening move, so suppress the visible countdown during the first
  // full move even though it's still that player's turn.
  const clockRunning = (match?.ply ?? 0) >= 2;
  const topClockTicking = Boolean(topIsTurn) && clockRunning;
  const bottomClockTicking = Boolean(bottomIsTurn) && clockRunning;

  const clockSyncAt = data?.liveClock.asOf ?? Date.now();
  const preset = match ? resolveTimeFormat(match.timeFormat) : null;

  if (error && !data) {
    return (
      <GameShell game='chess' backHref='/chess' howTo={HOW_TO} below={
        <div className='arcade-card-inset p-6 text-sm text-danger-text'>{error}</div>
      } />
    );
  }

  if (!data || !match) {
    return (
      <GameShell
        game='chess'
        backHref='/chess'
        howTo={HOW_TO}
        below={
          <div className='flex items-center justify-center py-20'>
            <ArcadeLoading label='Loading the match.' />
          </div>
        }
      />
    );
  }

  const isGameOver = match.status === 'completed' || match.status === 'forfeited';
  const drawOfferedByOpponent = match.drawOfferedBy && match.drawOfferedBy !== data.userId;
  const drawOfferedByMe = match.drawOfferedBy === data.userId;

  // You see your own equipped player card; everyone else gets the plain row.
  // Bot matches are untimed: hide the clocks entirely.
  const isBotMatch = match.player1Id.startsWith('bot:')
    || Boolean(match.player2Id?.startsWith('bot:'));
  const myTheme = playercardTheme;

  const captured = computeCapturedPieces(match.fen);
  const whiteCard = {
    name: (match.whiteId === match.player1Id ? match.player1Name : match.player2Name) ?? 'White',
    captured: captured.whiteCaptured,
    advantage: captured.whiteMaterialAdvantage,
  };
  const blackCard = {
    name: (match.blackId === match.player1Id ? match.player1Name : match.player2Name) ?? 'Black',
    captured: captured.blackCaptured,
    advantage: captured.blackMaterialAdvantage,
  };
  const topIsWhite = orientation === 'black';
  const topCard = topIsWhite ? whiteCard : blackCard;
  const bottomCard = topIsWhite ? blackCard : whiteCard;
  const topColor: ChessColor = topIsWhite ? 'white' : 'black';
  const bottomColor: ChessColor = topIsWhite ? 'black' : 'white';
  const topId = topColor === 'white' ? match.whiteId : match.blackId;
  const topIsMe = topId === data.userId;
  const topThemeResolved = topIsMe ? myTheme : undefined;
  const bottomThemeResolved = topIsMe ? undefined : myTheme;
  const topEloInfo = topIsMe ? myElo : opponentElo;
  const bottomEloInfo = topIsMe ? opponentElo : myElo;
  const botTierForPlayer = (pid: string | null): 'easy' | 'medium' | 'hard' | null => {
    if (!pid || !pid.startsWith('bot:')) return null;
    const tier = pid.replace('bot:', '');
    return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
  };
  const bottomId = bottomColor === 'white' ? match.whiteId : match.blackId;
  const bottomIsMe = bottomId === data.userId;
  // Resolve each seat's profile cosmetics (background/frame/badge/name/title).
  const topCardCosmetics = topId ? playerCards[topId] : undefined;
  const bottomCardCosmetics = bottomId ? playerCards[bottomId] : undefined;

  // ── Replay state resolution ─────────────────────────────────────────────
  // Only let users scrub back when the game is over. Live games always show
  // the current FEN and move so in-progress play isn't disrupted.
  const canReplay = isGameOver && moves.length > 0;
  const effectiveReviewPly = canReplay ? reviewPly : null;
  const atFinal = effectiveReviewPly === null || effectiveReviewPly >= moves.length;
  const displayFen =
    effectiveReviewPly === null || atFinal
      ? match.fen
      : effectiveReviewPly === 0
        ? STARTING_FEN
        : moves[effectiveReviewPly - 1]?.fenAfter ?? match.fen;
  const displayLastMoveUci =
    effectiveReviewPly === null || atFinal
      ? match.lastMoveUci
      : effectiveReviewPly === 0
        ? null
        : moves[effectiveReviewPly - 1]?.uci ?? null;

  // Per-ply annotation, only populated once analysis evals exist. The loss
  // is computed from WHITE-POV centipawns on each side's turn; thresholds are
  // standard lichess-style bands.
  const annotations: Record<number, { quality: MoveQuality; loss: number | null }> = {};
  const analyzedCount = moves.filter((m) => m.evalCentipawns !== null).length;
  if (analyzedCount > 0) {
    for (let i = 0; i < moves.length; i++) {
      const curr = moves[i].evalCentipawns;
      if (curr === null || curr === undefined) {
        annotations[moves[i].ply] = { quality: null, loss: null };
        continue;
      }
      const prev = i === 0 ? (baselineCp ?? 0) : (moves[i - 1].evalCentipawns ?? curr);
      const isWhite = (moves[i].ply - 1) % 2 === 0;
      const loss = isWhite ? prev - curr : curr - prev;
      const clamped = Math.max(0, loss);
      let quality: MoveQuality = null;
      if (clamped >= 250) quality = 'blunder';
      else if (clamped >= 100) quality = 'mistake';
      else if (clamped >= 40) quality = 'inaccuracy';
      else if (clamped >= 10) quality = 'good';
      else quality = 'best';
      annotations[moves[i].ply] = { quality, loss: clamped };
    }
  }

  // Lichess-style accuracy: win% loss per move, then averaged per player.
  const accuracyByColor: { white: number | null; black: number | null } =
    analyzedCount > 0 ? computeAccuracy(moves, baselineCp) : { white: null, black: null };

  // Eval to display: the eval AFTER the current review ply. null until
  // analysis has run. At ply 0, use 0 (even) as a baseline so the bar doesn't
  // jump on the very first scrub.
  const displayEvalCp: number | null = (() => {
    if (analyzedCount === 0) return null;
    const idx = (effectiveReviewPly ?? moves.length) - 1;
    if (idx < 0) return baselineCp ?? 0;
    return moves[idx]?.evalCentipawns ?? null;
  })();

  // "Best move at the position currently displayed": show an arrow from
  // source to destination so the user sees what Stockfish would have preferred here.
  const arrowUci: string | null = (() => {
    const ply = effectiveReviewPly ?? null;
    if (ply === null) return null;
    if (ply === 0) return moves[0]?.analysisBestMoveUci ?? null;
    // When reviewing a ply, the "next move Stockfish would make" lives on
    // the NEXT row's analysisBestMoveUci (which we write at analysis time).
    return moves[ply]?.analysisBestMoveUci ?? null;
  })();

  const opponentName =
    (match.player1Id === data.userId ? match.player2Name : match.player1Name) ?? 'your opponent';
  // The line under the board: whose move it is. A spectator sees the
  // seats, so nothing.
  const statusLine =
    match.status === 'waiting'
      ? 'No one has joined yet.'
      : match.status !== 'active' || data.isSpectator
        ? null
        : isMyTurn
          ? 'Your move.'
          : `${opponentName}'s move.`;

  // The result, drawn over the stage. Review hides it to look at the board.
  const end =
    isGameOver && !resultDismissed ? (
      <PostgameResult
        match={match}
        isMe={data.userId}
        isSpectator={data.isSpectator}
        myElo={eloDeltaFor(data.eloChange, data.userId)}
        accuracy={myColor ? accuracyByColor[myColor] : null}
        accountXp={accountXp}
        runResult={runResult}
        pendingRematch={pendingRematch}
        incomingChallenge={incomingChallenge}
        onAcceptPendingRematch={pendingRematch
          ? async () => {
              // The rematch is an invited match: join it, as the lobby's
              // accept does, then go to it.
              try {
                const res = await fetch('/api/games/chess/match/join', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ matchId: pendingRematch.matchId }),
                });
                if (!res.ok) {
                  // Most likely they started another game first.
                  setError('They started another game.');
                  setPendingRematch(null);
                  return;
                }
                router.push(`/chess/${pendingRematch.matchId}`);
              } catch (err) {
                setError((err as Error).message);
              }
            }
          : undefined}
        onLobby={() => router.push('/chess')}
        onDismiss={() => setResultDismissed(true)}
        canRematch={Boolean(match.player2Id && myColor)}
        onRematch={async () => {
          if (!match.player2Id) return;
          const oppId = match.player1Id === data.userId ? match.player2Id : match.player1Id;
          if (!oppId) return;
          const preferredColor =
            myColor === 'white' ? 'black' : myColor === 'black' ? 'white' : 'random';
          try {
            // A bot has no account to challenge: start a fresh practice game
            // at the same level instead.
            const res = oppId.startsWith('bot:')
              ? await fetch('/api/games/chess/match/bot', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    difficulty: oppId.replace('bot:', ''),
                    timeFormatId: match.timeFormat,
                    preferredColor,
                  }),
                })
              : await fetch('/api/games/chess/challenge', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    targetUserId: oppId,
                    timeFormatId: match.timeFormat,
                    preferredColor,
                  }),
                });
            const payload = await res.json();
            if (!res.ok) {
              setError(payload.error || 'Failed to send rematch.');
              return;
            }
            router.push(`/chess/${payload.matchId ?? payload.match?.id}`);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    ) : null;

  // Draw, resign and cancel sit under the screen, inside the cabinet; once the result is hidden, so does the way back to it.
  const showActions =
    (match.status === 'waiting' && match.player1Id === data.userId) ||
    (match.status === 'active' && Boolean(myColor)) ||
    (isGameOver && resultDismissed);
  // The same buttons sit under the screen and, on a phone on its side, beside the
  // board (the chess-actions CSS shows one and hides the other).
  const actionButtons = (
    <>
      {match.status === 'waiting' && match.player1Id === data.userId && (
        <ArcadeButton
          tone='default'
          size='sm'
          onClick={() => action('cancel', 'cancel')}
          disabled={!!actionPending}
        >
          cancel match
        </ArcadeButton>
      )}
      {match.status === 'active' && myColor && (
        <>
          {drawOfferedByOpponent ? (
            <>
              <ArcadeButton
                tone='primary'
                size='sm'
                onClick={() => action('draw-accept', 'draw-accept')}
                disabled={!!actionPending}
              >
                accept draw
              </ArcadeButton>
              <ArcadeButton
                tone='default'
                size='sm'
                onClick={() => action('draw-decline', 'draw-decline')}
                disabled={!!actionPending}
              >
                decline
              </ArcadeButton>
            </>
          ) : (
            <ArcadeButton
              tone='default'
              size='sm'
              onClick={() => action('draw-offer', 'draw-offer')}
              disabled={!!actionPending || !!drawOfferedByMe}
            >
              <HandshakeIcon size={14} />
              {drawOfferedByMe ? 'draw offered' : 'offer draw'}
            </ArcadeButton>
          )}
          <ArcadeButton
            tone='danger'
            size='sm'
            onClick={() => {
              if (confirm('Resign this match?')) action('resign', 'resign');
            }}
            disabled={!!actionPending}
          >
            <Flag size={14} />
            resign
          </ArcadeButton>
        </>
      )}
      {isGameOver && resultDismissed && (
        <ArcadeButton tone='primary' size='sm' onClick={() => setResultDismissed(false)}>
          result
        </ArcadeButton>
      )}
    </>
  );
  const controls = showActions ? (
    <div data-surface='ink' className='chess-actions chess-actions-controls flex flex-wrap justify-center gap-2 pb-1'>
      {actionButtons}
    </div>
  ) : undefined;

  const seat = (position: 'top' | 'bottom') => {
    const top = position === 'top';
    const card = top ? topCard : bottomCard;
    const color = top ? topColor : bottomColor;
    const isMe = top ? topIsMe : bottomIsMe;
    const ms = top ? topMs : bottomMs;
    const ticking = top ? topClockTicking : bottomClockTicking;
    const id = top ? topId : bottomId;
    const cosmetics = top ? topCardCosmetics : bottomCardCosmetics;
    const eloInfo = top ? topEloInfo : bottomEloInfo;
    return (
      <div className='chess-seat'>
        <ChessPlayerCard
          name={card.name}
          avatarUrl={cosmetics?.avatarUrl}
          color={color}
          isActive={Boolean(top ? topIsTurn : bottomIsTurn)}
          isMe={isMe}
          capturedPieces={card.captured}
          materialAdvantage={card.advantage}
          piecesTheme={resolvedLook.pieces}
          pieceStrokeWhite={pieceStrokeWhite}
          pieceStrokeBlack={pieceStrokeBlack}
          pieceShape={chessSkin?.shape}
          eloRating={eloInfo?.rating}
          eloTier={eloInfo?.tier}
          eloTierColor={eloInfo?.tierColor}
          theme={top ? topThemeResolved : bottomThemeResolved}
          flair={cosmetics?.flair}
          side='left'
          botTier={botTierForPlayer(id)}
        />
        {!isBotMatch && (
          <MatchClock
            label=''
            remainingAtSyncMs={ms ?? 0}
            lastSyncAt={clockSyncAt}
            ticking={ticking}
            tickWhenLow={isMe}
          />
        )}
      </div>
    );
  };

  return (
    <GameShell
      game='chess'
      backHref='/chess'
      stat={<GameStat value={data.isSpectator ? null : (myElo?.rating ?? null)} label='rating' />}
      howTo={HOW_TO}
      below={
        <>
          <p className='flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-muted'>
            {preset && <span>{preset.label.toLowerCase()}</span>}
            {data.isSpectator && <span>you are watching</span>}
            {data.spectatorCount > 0 && (
              <span className='inline-flex items-center gap-1'>
                <Eye size={14} strokeLinecap='square' aria-hidden /> <Num value={data.spectatorCount} /> watching
              </span>
            )}
            {match.wagerAmount ? (
              <span className='font-bold text-strong'>
                <Num value={match.wagerAmount} /> tickets each
              </span>
            ) : null}
            {match.tournamentMatchId && <span>tournament</span>}
          </p>
          {error && (
            <div className='arcade-card-inset px-3 py-2 text-sm text-danger-text'>{error}</div>
          )}
          <div className='grid gap-4 lg:grid-cols-2'>
            <div className='flex flex-col gap-4'>
              {canReplay && (
                <div className='flex flex-col gap-2'>
                  <ReplayControls
                    totalPly={moves.length}
                    currentPly={effectiveReviewPly ?? moves.length}
                    onSeek={(ply) => {
                      setReviewPly(ply >= moves.length ? null : ply);
                    }}
                  />
                  <AnalyzeStrip
                    analyzedCount={analyzedCount}
                    totalCount={moves.length}
                    running={Boolean(analysisProgress?.running)}
                    onStart={startAnalysis}
                  />
                </div>
              )}
              {moves.length > 0 ? (
              <div>
                <div className='mb-1 flex min-h-11 items-center justify-between text-[1.0625rem] font-extrabold text-strong'>
                  <h2>moves</h2>
                  {canReplay && effectiveReviewPly !== null && !atFinal && (
                    <ArcadeButton tone='tickets' size='xs' onClick={() => setReviewPly(null)}>
                      jump to end
                    </ArcadeButton>
                  )}
                </div>
                <MoveList
                  sans={moves.map((m) => m.san)}
                  annotations={moves.map((m) => annotations[m.ply]?.quality ?? null)}
                  currentPly={effectiveReviewPly ?? moves.length}
                  onJumpToPly={canReplay ? (ply) => setReviewPly(ply === moves.length ? null : ply) : undefined}
                  pgnMeta={{
                    whiteName: match.whiteId === match.player1Id ? match.player1Name : match.player2Name,
                    blackName: match.blackId === match.player1Id ? match.player1Name : match.player2Name,
                    result: match.result,
                    timeControl: `${Math.round(match.initialTimeMs / 1000)}+${Math.round(match.incrementMs / 1000)}`,
                    date: new Date(match.createdAt).toISOString().slice(0, 10),
                  }}
                />
              </div>
              ) : null}
            </div>
            {match.player2Id && (
              <MatchChat
                matchId={match.id}
                userId={data.userId}
                disabled={match.player2Id.startsWith('bot:')}
              />
            )}
          </div>
        </>
      }
    >
      {/* A match has no first input to wait for, so the stage stays in
          `ready` with the turn line as its hint. `playing` would also lock
          text selection on the page, and the chat is under it. */}
      <div role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </div>
      <GameStage
        phase={isGameOver && !resultDismissed ? 'over' : 'ready'}
        hint={statusLine ?? undefined}
        end={end}
        controls={controls}
      >
        <div className='chess-arcade chess-stage'>
          <div
            className='chess-stage-inner'
            style={analyzedCount > 0 ? ({ ['--chess-eval-w' as string]: '2.25rem' }) : undefined}
          >
          {seat('top')}
          <div ref={boardContainerRef} className='chess-stage-board'>
            {analyzedCount > 0 && <EvalBar cp={displayEvalCp} orientation={orientation} />}
            <ChessBoard
              fen={displayFen}
              orientation={orientation}
              myColor={myColor}
              isMyTurn={isMyTurn}
              lastMoveUci={displayLastMoveUci}
              onMove={submitMove}
              submitting={submitting}
              boardTheme={resolvedLook.board}
              piecesTheme={resolvedLook.pieces}
              pieceStrokeWhite={pieceStrokeWhite}
              pieceStrokeBlack={pieceStrokeBlack}
              skin={chessSkin}
              interactive={match.status === 'active' && effectiveReviewPly === null}
              dim={isGameOver && atFinal && !resultDismissed}
              lastMoveWasCapture={lastMoveWasCapture}
              bestMoveArrowUci={effectiveReviewPly !== null ? arrowUci : null}
              lastMoveQuality={
                // chess.com-style quality badge on the destination of the
                // current review ply. Only surfaced while scrubbing back
                // through a finished game: live play shouldn't flash
                // "blunder" on the user's own move.
                effectiveReviewPly !== null
                  ? annotations[effectiveReviewPly]?.quality ?? null
                  : null
              }
            />
          </div>
          {seat('bottom')}
          {showActions && (
            <div data-surface='ink' className='chess-actions chess-actions-stage'>
              {actionButtons}
            </div>
          )}
          </div>
        </div>
      </GameStage>
    </GameShell>
  );
}

/** Extract the per-player ELO delta from the match response's eloChange. */
function eloDeltaFor(
  eloChange: MatchResponse['eloChange'],
  userId: string | null,
) {
  if (!eloChange || !userId) return null;
  if (eloChange.playerA.id === userId) {
    return { ...eloChange.playerA };
  }
  if (eloChange.playerB.id === userId) {
    return { ...eloChange.playerB };
  }
  return null;
}

function classifyMoveSound(san: string): MoveSoundKind {
  if (!san) return 'move';
  if (san === 'O-O' || san === 'O-O-O') return 'castle';
  if (san.includes('#')) return 'gameEnd';
  if (san.includes('+')) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.includes('x')) return 'capture';
  return 'move';
}

/** Lichess-derived win% and accuracy helpers. */
function winPercentFromCp(cp: number): number {
  // Returns 0–100 from white's perspective.
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function moveAccuracy(winBefore: number, winAfter: number, moverIsWhite: boolean): number {
  const loss = moverIsWhite
    ? Math.max(0, winBefore - winAfter)
    : Math.max(0, (100 - winBefore) - (100 - winAfter));
  const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function computeAccuracy(
  moves: MoveRow[],
  baselineCp: number | null,
): { white: number | null; black: number | null } {
  const whiteAcc: number[] = [];
  const blackAcc: number[] = [];
  for (let i = 0; i < moves.length; i++) {
    const curr = moves[i].evalCentipawns;
    if (curr === null || curr === undefined) continue;
    const prev = i === 0
      ? (baselineCp ?? 0)
      : (moves[i - 1].evalCentipawns ?? 0);
    const isWhite = (moves[i].ply - 1) % 2 === 0;
    const acc = moveAccuracy(winPercentFromCp(prev), winPercentFromCp(curr), isWhite);
    (isWhite ? whiteAcc : blackAcc).push(acc);
  }
  const avg = (arr: number[]) => (arr.length === 0 ? null : Math.round(arr.reduce((s, v) => s + v, 0) / arr.length));
  return { white: avg(whiteAcc), black: avg(blackAcc) };
}

function AnalyzeStrip({
  analyzedCount,
  totalCount,
  running,
  onStart,
}: {
  analyzedCount: number;
  totalCount: number;
  running: boolean;
  onStart: () => void;
}) {
  const complete = analyzedCount >= totalCount && totalCount > 0;
  const percent = totalCount > 0 ? Math.round((analyzedCount / totalCount) * 100) : 0;

  if (!running && !complete) {
    return (
      <ArcadeButton
        tone='default'
        size='sm'
        onClick={onStart}
      >
        <Crown size={12} />
        analyze
      </ArcadeButton>
    );
  }

  return (
    <div className='rounded-panel border-2 border-ink bg-panel p-2 shadow-chip'>
      <div className='mb-1 flex items-center justify-between text-xs text-faint'>
        <span>{running ? 'analyzing' : 'analysis done'}</span>
        <span className='arcade-num'>{analyzedCount}/{totalCount}</span>
      </div>
      <div className='h-1.5 overflow-hidden rounded-full border border-ink bg-well'>
        <div
          className='h-full bg-tickets transition-all'
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
