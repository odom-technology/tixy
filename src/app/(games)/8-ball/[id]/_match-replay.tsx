'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Pause, Play, RotateCcw, X } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { PoolCanvas, type PoolCosmeticTheme, type PoolReplayOverlay } from './_pool-canvas';
import type { Ball, ShotInput } from '@/features/arcade/lib/pool-physics';

type MatchReplayMove = {
  moveNumber: number;
  playerId: string;
  playerName: string;
  createdAt: number;
  turnDurationMs: number;
  shotInput: ShotInput;
  ballsBefore: Ball[];
  ballsAfter: Ball[];
  pocketedBallIds: number[];
  scratch: boolean;
  firstContactBallId: number | null;
  railContacts: number;
  foulType: string | null;
  totalFrames: number;
};

export type MatchReplayData = {
  matchId: string;
  createdAt: number;
  completedAt: number | null;
  moveCount: number;
  initialBalls: Ball[];
  moves: MatchReplayMove[];
};

type MatchReplayViewerProps = {
  replay: MatchReplayData;
  theme?: PoolCosmeticTheme;
  currentUserId: string;
  replaySaved: boolean;
  saveReplayToken?: number;
  prefetchedVideoBlob?: Blob | null;
  onClose: () => void;
  onSaveReplayError?: (message: string) => void;
  onSaveReplay: () => void;
  onPlayAgain: () => void;
};

type ReplayPlayerSnapshot = {
  playerId: string;
  playerName: string;
  moves: number;
  pocketed: number;
  fouls: number;
  scratches: number;
};

type ReplayStatsSnapshot = {
  players: ReplayPlayerSnapshot[];
  totalPocketed: number;
  totalFouls: number;
  totalScratches: number;
};

const REPLAY_PHYSICS_FRAME_MS = 1000 / 60;
const EXPORT_CAPTURE_FPS = 60;
const EXPORT_VIDEO_BITRATE = 8_000_000;
const EXPORT_MOVE_GAP_MS = 28;
const EXPORT_END_TAIL_MS = 260;
const EXPORT_FINALIZE_TIMEOUT_MS = 10_000;
const EXPORT_TOTAL_TIMEOUT_MS = 300_000;

function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((ball) => ({
    id: ball.id,
    pos: { x: ball.pos.x, y: ball.pos.y },
    vel: { x: ball.vel.x, y: ball.vel.y },
    pocketed: ball.pocketed,
    spinX: ball.spinX,
    spinY: ball.spinY,
  }));
}

export function MatchReplayViewer({
  replay,
  theme,
  currentUserId,
  replaySaved,
  saveReplayToken = 0,
  prefetchedVideoBlob = null,
  onClose,
  onSaveReplayError,
  onSaveReplay,
  onPlayAgain,
}: MatchReplayViewerProps) {
  const replayCanvasHostRef = useRef<HTMLDivElement>(null);
  const saveTokenHandledRef = useRef(0);
  const moveCompleteResolverRef = useRef<(() => void) | null>(null);
  const moveCompleteTimeoutRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [tableBalls, setTableBalls] = useState<Ball[]>(() => cloneBalls(replay.initialBalls));
  const [animShot, setAnimShot] = useState<ShotInput | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportMoveIndex, setExportMoveIndex] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const isAnimatingRef = useRef(false);
  const pendingMoveIndexRef = useRef<number | null>(null);

  const currentMove = useMemo(
    () => (cursor > 0 ? replay.moves[cursor - 1] : null),
    [cursor, replay.moves],
  );
  const exportAnimationSpeed = useMemo(() => {
    if (!isExportingVideo) return 1;
    const moveCount = replay.moves.length;
    if (moveCount >= 70) return 1.35;
    if (moveCount >= 45) return 1.25;
    if (moveCount >= 24) return 1.15;
    return 1.05;
  }, [isExportingVideo, replay.moves.length]);
  const exportStatsByMove = useMemo<ReplayStatsSnapshot[]>(() => {
    const playerOrder: string[] = [];
    const playerNames = new Map<string, string>();
    for (const move of replay.moves) {
      if (!playerNames.has(move.playerId)) {
        playerNames.set(move.playerId, move.playerName || 'Player');
        playerOrder.push(move.playerId);
      }
    }

    const running = new Map<string, ReplayPlayerSnapshot>();
    for (const playerId of playerOrder) {
      running.set(playerId, {
        playerId,
        playerName: playerNames.get(playerId) ?? 'Player',
        moves: 0,
        pocketed: 0,
        fouls: 0,
        scratches: 0,
      });
    }

    const makeSnapshot = (): ReplayStatsSnapshot => {
      const players = playerOrder.map((playerId) => {
        const stats = running.get(playerId);
        return stats
          ? { ...stats }
          : {
              playerId,
              playerName: playerNames.get(playerId) ?? 'Player',
              moves: 0,
              pocketed: 0,
              fouls: 0,
              scratches: 0,
            };
      });
      let totalPocketed = 0;
      let totalFouls = 0;
      let totalScratches = 0;
      for (const stats of players) {
        totalPocketed += stats.pocketed;
        totalFouls += stats.fouls;
        totalScratches += stats.scratches;
      }
      return { players, totalPocketed, totalFouls, totalScratches };
    };

    const snapshots: ReplayStatsSnapshot[] = [makeSnapshot()];
    for (const move of replay.moves) {
      if (!running.has(move.playerId)) {
        playerNames.set(move.playerId, move.playerName || 'Player');
        playerOrder.push(move.playerId);
        running.set(move.playerId, {
          playerId: move.playerId,
          playerName: move.playerName || 'Player',
          moves: 0,
          pocketed: 0,
          fouls: 0,
          scratches: 0,
        });
      }
      const stats = running.get(move.playerId);
      if (stats) {
        stats.moves += 1;
        stats.pocketed += move.pocketedBallIds.length;
        if (move.foulType) stats.fouls += 1;
        if (move.scratch) stats.scratches += 1;
      }
      snapshots.push(makeSnapshot());
    }
    return snapshots;
  }, [replay.moves]);
  const exportCanvasOverlay = useMemo<PoolReplayOverlay | null>(() => {
    if (!isExportingVideo) return null;

    const totalMoves = replay.moves.length;
    const activeMoveNumber = totalMoves > 0
      ? Math.min(totalMoves, Math.max(1, exportMoveIndex || 1))
      : 0;
    const activeMove = activeMoveNumber > 0
      ? replay.moves[activeMoveNumber - 1]
      : null;
    const completedMoves = totalMoves === 0
      ? 0
      : isAnimating
        ? Math.max(0, activeMoveNumber - 1)
        : activeMoveNumber;
    const snapshot = exportStatsByMove[
      Math.max(0, Math.min(exportStatsByMove.length - 1, completedMoves))
    ] ?? {
      players: [],
      totalPocketed: 0,
      totalFouls: 0,
      totalScratches: 0,
    };

    const pocketedText = activeMove
      ? activeMove.pocketedBallIds.length > 0
        ? activeMove.pocketedBallIds.join(', ')
        : 'none'
      : '-';
    const shotPower = activeMove ? activeMove.shotInput.power : null;
    const shotSpin = activeMove
      ? {
          x: activeMove.shotInput.spinX ?? 0,
          y: activeMove.shotInput.spinY ?? 0,
        }
      : null;

    const topLeftLines = [
      '8-BALL MATCH REPLAY',
      totalMoves > 0 ? `Move ${activeMoveNumber}/${totalMoves}` : 'Move 0/0',
      activeMove ? `Shooter: ${activeMove.playerName}` : 'Shooter: -',
      activeMove && shotPower !== null ? `Power: ${Math.round(Math.max(0, Math.min(1, shotPower)) * 100)}%` : 'Power: -',
      shotSpin ? `Spin: ${shotSpin.x.toFixed(2)}, ${shotSpin.y.toFixed(2)}` : 'Spin: -',
      activeMove ? `Pocketed: ${pocketedText}` : 'Pocketed: -',
      activeMove
        ? `Foul: ${activeMove.foulType ?? 'none'}${activeMove.scratch ? ' (scratch)' : ''}`
        : 'Foul: -',
      activeMove
        ? `First Contact: ${activeMove.firstContactBallId ?? 'none'} | Rails: ${activeMove.railContacts}`
        : '',
    ].filter(Boolean);

    const topRightLines = [
      'MATCH STATS',
      `Completed Moves: ${completedMoves}/${totalMoves}`,
      `Total Pocketed: ${snapshot.totalPocketed}`,
      `Total Fouls: ${snapshot.totalFouls}`,
      `Total Scratches: ${snapshot.totalScratches}`,
      ...snapshot.players.map(
        (stats) =>
          `${stats.playerName}: M${stats.moves} P${stats.pocketed} F${stats.fouls}`,
      ),
    ];

    return {
      topLeftLines,
      topRightLines,
      powerRatio: shotPower,
      spin: shotSpin,
    };
  }, [exportMoveIndex, exportStatsByMove, isAnimating, isExportingVideo, replay.moves]);

  const stopPlayback = useCallback(() => {
    setAutoPlay(false);
    pendingMoveIndexRef.current = null;
    setAnimShot(null);
    setIsAnimating(false);
    isAnimatingRef.current = false;
    moveCompleteResolverRef.current = null;
    if (moveCompleteTimeoutRef.current !== null) {
      window.clearTimeout(moveCompleteTimeoutRef.current);
      moveCompleteTimeoutRef.current = null;
    }
  }, []);

  const jumpToState = useCallback((stateIndex: number) => {
    const clamped = Math.max(0, Math.min(replay.moves.length, stateIndex));
    stopPlayback();
    setCursor(clamped);
    if (clamped === 0) {
      setTableBalls(cloneBalls(replay.initialBalls));
      return;
    }
    setTableBalls(cloneBalls(replay.moves[clamped - 1].ballsAfter));
  }, [replay.initialBalls, replay.moves, stopPlayback]);

  const playMove = useCallback((moveIndex: number): boolean => {
    if (moveIndex < 1 || moveIndex > replay.moves.length) return false;
    if (isAnimatingRef.current) return false;
    const move = replay.moves[moveIndex - 1];
    pendingMoveIndexRef.current = moveIndex;
    setTableBalls(cloneBalls(move.ballsBefore));
    setAnimShot({
      angle: move.shotInput.angle,
      power: move.shotInput.power,
      cuePosition: move.shotInput.cuePosition,
      spinX: move.shotInput.spinX ?? 0,
      spinY: move.shotInput.spinY ?? 0,
    });
    setIsAnimating(true);
    isAnimatingRef.current = true;
    return true;
  }, [replay.moves]);

  const handlePlayPause = useCallback(() => {
    if (isAnimating) {
      stopPlayback();
      return;
    }

    if (autoPlay) {
      setAutoPlay(false);
      return;
    }

    if (cursor >= replay.moves.length) {
      jumpToState(0);
      setAutoPlay(true);
      window.setTimeout(() => {
        playMove(1);
      }, 80);
      return;
    }

    setAutoPlay(true);
    playMove(cursor + 1);
  }, [autoPlay, cursor, isAnimating, jumpToState, playMove, replay.moves.length, stopPlayback]);

  const handlePlayCurrentMove = useCallback(() => {
    if (cursor <= 0 || cursor > replay.moves.length) return;
    setAutoPlay(false);
    playMove(cursor);
  }, [cursor, playMove, replay.moves.length]);

  const handleAnimationEnd = useCallback((finalBalls: Ball[]) => {
    const completedMoveIndex = pendingMoveIndexRef.current;
    pendingMoveIndexRef.current = null;
    setAnimShot(null);
    setIsAnimating(false);
    isAnimatingRef.current = false;

    if (completedMoveIndex === null) {
      setTableBalls(cloneBalls(finalBalls));
      return;
    }

    const completedMove = replay.moves[completedMoveIndex - 1];
    if (completedMove) {
      setTableBalls(cloneBalls(completedMove.ballsAfter));
      setCursor(completedMoveIndex);
    } else {
      setTableBalls(cloneBalls(finalBalls));
    }

    if (moveCompleteTimeoutRef.current !== null) {
      window.clearTimeout(moveCompleteTimeoutRef.current);
      moveCompleteTimeoutRef.current = null;
    }
    const resolveMove = moveCompleteResolverRef.current;
    moveCompleteResolverRef.current = null;
    resolveMove?.();

    if (autoPlay && completedMoveIndex < replay.moves.length) {
      window.setTimeout(() => playMove(completedMoveIndex + 1), 120);
      return;
    }

    if (autoPlay && completedMoveIndex >= replay.moves.length) {
      setAutoPlay(false);
    }
  }, [autoPlay, playMove, replay.moves]);

  const waitForNextFrame = useCallback(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      }),
    [],
  );

  const waitMs = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      }),
    [],
  );

  const playMoveAndWait = useCallback(
    (moveIndex: number, timeoutMs = 20000) =>
      new Promise<void>((resolve, reject) => {
        if (moveCompleteTimeoutRef.current !== null) {
          window.clearTimeout(moveCompleteTimeoutRef.current);
          moveCompleteTimeoutRef.current = null;
        }
        moveCompleteResolverRef.current = () => {
          moveCompleteResolverRef.current = null;
          if (moveCompleteTimeoutRef.current !== null) {
            window.clearTimeout(moveCompleteTimeoutRef.current);
            moveCompleteTimeoutRef.current = null;
          }
          resolve();
        };
        moveCompleteTimeoutRef.current = window.setTimeout(() => {
          moveCompleteTimeoutRef.current = null;
          moveCompleteResolverRef.current = null;
          reject(new Error(`Timed out while rendering move ${moveIndex}.`));
        }, timeoutMs);
        const started = playMove(moveIndex);
        if (!started) {
          if (moveCompleteTimeoutRef.current !== null) {
            window.clearTimeout(moveCompleteTimeoutRef.current);
            moveCompleteTimeoutRef.current = null;
          }
          moveCompleteResolverRef.current = null;
          reject(new Error('Replay animation is busy. Please try again.'));
        }
      }),
    [playMove],
  );

  const downloadReplayBlob = useCallback(
    (blob: Blob) => {
      const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `8ball-replay-${replay.matchId}-${date}.webm`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },
    [replay.matchId],
  );

  const handleExportVideo = useCallback(async () => {
    if (isExportingVideo) return;
    if (typeof window === 'undefined') return;

    setExportError(null);
    setAutoPlay(false);
    setIsExportingVideo(true);

    let stream: MediaStream | null = null;
    try {
      if (prefetchedVideoBlob && prefetchedVideoBlob.size > 0) {
        downloadReplayBlob(prefetchedVideoBlob);
        onSaveReplay();
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('This browser does not support replay video export.');
      }

      const canvas = replayCanvasHostRef.current?.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Replay canvas is not ready yet. Try again in a second.');
      }
      if (typeof canvas.captureStream !== 'function') {
        throw new Error('Replay video export is not supported on this browser.');
      }

      const mimeCandidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      const mimeType =
        mimeCandidates.find((candidate) =>
          MediaRecorder.isTypeSupported(candidate),
        ) ?? 'video/webm';

      stopPlayback();
      jumpToState(0);
      await waitForNextFrame();
      await waitForNextFrame();

      stream = canvas.captureStream(EXPORT_CAPTURE_FPS);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: EXPORT_VIDEO_BITRATE,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const recordingDone = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = (event: Event) => {
          const errorEvent = event as Event & { error?: DOMException };
          reject(errorEvent.error ?? new Error('Video recording failed.'));
        };
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }));
        };
      });

      recorder.start(120);
      const exportDeadline = performance.now() + EXPORT_TOTAL_TIMEOUT_MS;
      if (replay.moves.length === 0) {
        setExportMoveIndex(0);
        await waitMs(700);
      } else {
        let skippedMoves = 0;
        for (let moveIndex = 1; moveIndex <= replay.moves.length; moveIndex++) {
          if (performance.now() >= exportDeadline) {
            throw new Error('Replay video export timed out. Please try again.');
          }
          setExportMoveIndex(moveIndex);
          const move = replay.moves[moveIndex - 1];
          const expectedMoveMs =
            (Math.max(1, move?.totalFrames || 1) * REPLAY_PHYSICS_FRAME_MS + 120)
            / Math.max(0.75, exportAnimationSpeed);
          const moveTimeoutMs = Math.max(
            4_000,
            Math.min(35_000, Math.ceil(expectedMoveMs * 2.8)),
          );
          try {
            await playMoveAndWait(moveIndex, moveTimeoutMs);
          } catch {
            // Preserve export completion even if one animation frame chain hangs.
            skippedMoves += 1;
            jumpToState(moveIndex);
            await waitForNextFrame();
          }
          await waitMs(EXPORT_MOVE_GAP_MS);
        }
        setExportMoveIndex(replay.moves.length);
        await waitMs(skippedMoves > 0 ? 80 : EXPORT_END_TAIL_MS);
      }

      if (recorder.state !== 'inactive') {
        recorder.requestData();
        recorder.stop();
      }
      const blob = await Promise.race([
        recordingDone,
        new Promise<Blob>((_, reject) => {
          window.setTimeout(
            () => reject(new Error('Timed out finalizing replay video.')),
            EXPORT_FINALIZE_TIMEOUT_MS,
          );
        }),
      ]);
      if (blob.size === 0) {
        throw new Error('Replay video export produced an empty file.');
      }

      downloadReplayBlob(blob);
      onSaveReplay();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to export replay video.';
      setExportError(message);
      onSaveReplayError?.(message);
    } finally {
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      setExportMoveIndex(0);
      setIsExportingVideo(false);
    }
  }, [
    isExportingVideo,
    jumpToState,
    onSaveReplay,
    onSaveReplayError,
    playMoveAndWait,
    prefetchedVideoBlob,
    replay.moves,
    stopPlayback,
    downloadReplayBlob,
    exportAnimationSpeed,
    waitForNextFrame,
    waitMs,
  ]);

  useEffect(() => {
    if (!saveReplayToken) return;
    if (saveReplayToken === saveTokenHandledRef.current) return;
    saveTokenHandledRef.current = saveReplayToken;
    void handleExportVideo();
  }, [handleExportVideo, saveReplayToken]);

  useEffect(
    () => () => {
      if (moveCompleteTimeoutRef.current !== null) {
        window.clearTimeout(moveCompleteTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    isAnimatingRef.current = isAnimating;
  }, [isAnimating]);

  return (
    <div
      ref={replayCanvasHostRef}
      className='w-full max-w-5xl rounded-cabinet border-2 border-ink bg-panel p-4 shadow-modal sm:p-5'
    >
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div>
          <p className='text-xs font-medium uppercase tracking-wide text-faint'>Match Replay</p>
          <p className='text-sm font-semibold text-strong'>
            {cursor === 0
              ? `Rack Start · 0/${replay.moves.length}`
              : `Move ${cursor}/${replay.moves.length} · ${currentMove?.playerName ?? 'Player'}`}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <ArcadeButton
            tone='ghost'
            size='sm'
            onClick={handleExportVideo}
            disabled={isExportingVideo}
          >
            <Download size={14} />
            {isExportingVideo
              ? 'Rendering Video...'
              : replaySaved
                ? 'Video Saved'
                : 'Save Replay Video'}
          </ArcadeButton>
          <ArcadeButton
            tone='ghost'
            size='sm'
            onClick={onClose}
            disabled={isExportingVideo}
          >
            <X size={14} />
            Close
          </ArcadeButton>
        </div>
      </div>

      <PoolCanvas
        balls={tableBalls}
        theme={theme}
        animateShot={animShot}
        animationSpeed={isExportingVideo ? exportAnimationSpeed : 1}
        muteAnimationSound={isExportingVideo}
        replayOverlay={exportCanvasOverlay}
        onAnimationEnd={handleAnimationEnd}
      />

      <div className='mt-3 space-y-3'>
        <input
          type='range'
          min={0}
          max={replay.moves.length}
          value={cursor}
          onChange={(event) => jumpToState(Number(event.target.value))}
          className='w-full accent-[var(--enamel-prize)]'
        />

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={() => jumpToState(cursor - 1)}
              disabled={isAnimating || cursor <= 0}
            >
              <ChevronLeft size={14} />
              Prev
            </ArcadeButton>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={() => jumpToState(cursor + 1)}
              disabled={isAnimating || cursor >= replay.moves.length}
            >
              Next
              <ChevronRight size={14} />
            </ArcadeButton>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={handlePlayCurrentMove}
              disabled={isAnimating || cursor <= 0}
            >
              <RotateCcw size={14} />
              Replay Move
            </ArcadeButton>
          </div>

          <div className='flex items-center gap-2'>
            <ArcadeButton
              tone='success'
              size='sm'
              onClick={handlePlayPause}
              disabled={replay.moves.length === 0 || isExportingVideo}
            >
              {isAnimating || autoPlay ? <Pause size={14} /> : <Play size={14} />}
              {isAnimating || autoPlay ? 'Pause' : (cursor >= replay.moves.length ? 'Play All' : 'Play')}
            </ArcadeButton>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={onPlayAgain}
              disabled={isExportingVideo}
            >
              Play Again
            </ArcadeButton>
          </div>
        </div>

        {exportError && (
          <p className='text-[11px] text-tickets-text'>{exportError}</p>
        )}
        {isExportingVideo && replay.moves.length > 0 && (
          <p className='text-[11px] text-body'>
            Rendering move {Math.min(replay.moves.length, Math.max(1, exportMoveIndex))}/{replay.moves.length}
          </p>
        )}

        {currentMove && (
          <p className='text-[11px] text-body'>
            Move {currentMove.moveNumber} by {currentMove.playerId === currentUserId ? 'you' : currentMove.playerName}
            {currentMove.foulType ? ` · foul: ${currentMove.foulType}` : ''}
            {currentMove.pocketedBallIds.length > 0 ? ` · pocketed: ${currentMove.pocketedBallIds.join(', ')}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
