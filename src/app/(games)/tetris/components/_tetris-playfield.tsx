import type { RefObject, TouchEventHandler } from 'react';
import { COLS, ROWS } from '../_tetris-config';
import type { GameOverData } from '../_tetris-engine';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import {
  ArcadeGameplayCallouts,
  type ArcadeGameplayCallout,
} from '@/features/arcade/components/gameplay/arcade-game-hud';
import type { ArcadeRunAchievement, ArcadeRunReward } from '@/features/arcade/lib/run-result';

export type TetrisGameState = 'idle' | 'playing' | 'paused' | 'gameover';

type TetrisPlayfieldProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  gameState: TetrisGameState;
  playfieldGlowClass: string;
  onTouchStart: TouchEventHandler<HTMLDivElement>;
  onTouchEnd: TouchEventHandler<HTMLDivElement>;
  onStartGame: () => void;
  isStartingSession: boolean;
  startError: string | null;
  gameOverData: GameOverData | null;
  isSubmitting: boolean;
  submitError: string | null;
  reward: ArcadeRunReward | null;
  achievements: ArcadeRunAchievement[];
  isGuestRun: boolean;
  onShowLeaderboard: () => void;
  gameplayCallouts: ArcadeGameplayCallout[];
  formatTime: (ms: number) => string;
};

export function TetrisPlayfield({
  canvasRef,
  gameState,
  playfieldGlowClass,
  onTouchStart,
  onTouchEnd,
  onStartGame,
  isStartingSession,
  startError,
  gameOverData,
  isSubmitting,
  submitError,
  reward,
  achievements,
  isGuestRun,
  onShowLeaderboard,
  gameplayCallouts,
  formatTime,
}: TetrisPlayfieldProps) {
  return (
    <div
      className={`arcade-game-stage relative mx-auto flex w-full max-w-full items-center justify-center p-2 transition-all duration-300 ${playfieldGlowClass}`}
      style={{
        width: 'min(100%, clamp(14rem, 72vw, 26rem))',
        maxWidth: '100%',
        maxHeight: 'min(82vh, calc(100dvh - 14.5rem))',
        aspectRatio: `${COLS} / ${ROWS}`,
        touchAction: 'none',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <canvas ref={canvasRef} className='h-full w-full rounded-lg' style={{ imageRendering: 'pixelated' }} />

      {gameState === 'idle' && (
        <div className='tet-overlay'>
          <h2 className='tet-overlay-title mb-2 text-2xl sm:text-3xl'>TETRIS</h2>
          {startError && (
            <p className='mt-1 max-w-xs text-xs text-[var(--enamel-primary-text)] sm:text-sm'>
              {startError}
            </p>
          )}
          <ArcadeButton
            tone='primary'
            size='md'
            onClick={onStartGame}
            disabled={isStartingSession}
            className='mt-3'
          >
            {isStartingSession ? 'Starting...' : 'Start Run'}
          </ArcadeButton>
        </div>
      )}
      {gameState === 'paused' && (
        <div className='tet-overlay'>
          <span className='tet-plate mb-1' data-tone='tickets'>Session Paused</span>
          <h2 className='tet-overlay-title mb-2 text-xl sm:text-2xl' data-tone='paused'>PAUSED</h2>
          <p className='tet-overlay-sub'>Press Escape or P to resume.</p>
        </div>
      )}
      {gameState === 'gameover' && (
        <div className='tet-overlay'>
          <span className='tet-plate mb-1' data-tone='danger'>Run Complete</span>
          <h2 className='tet-overlay-title mb-2 text-xl sm:text-2xl' data-tone='gameover'>GAME OVER</h2>
          {gameOverData && (
            <div className='mb-3 space-y-1 text-center'>
              <p className='tet-final-score'>{gameOverData.score.toLocaleString()} pts</p>
              <p className='tet-overlay-sub'>
                Level {gameOverData.level} | {gameOverData.lines} lines | {formatTime(gameOverData.durationMs)}
              </p>
              {gameOverData.stats.tetrises > 0 && (
                <p className='text-xs text-faint'>
                  {gameOverData.stats.tetrises} Tetrises | {gameOverData.stats.tSpins} T-Spins
                </p>
              )}
            </div>
          )}
          <ArcadeRunRewards
            reward={reward}
            achievements={achievements}
            saving={isSubmitting}
            error={submitError}
            guest={isGuestRun}
            className='mb-2 max-h-[40dvh] max-w-xs overflow-y-auto px-1'
          />
          <div className='flex gap-3'>
            <ArcadeButton tone='primary' size='sm' onClick={onStartGame}>
              Play Again
            </ArcadeButton>
            <GameLeaderboardButton onClick={onShowLeaderboard} />
          </div>
        </div>
      )}
      {gameState === 'playing' ? (
        <ArcadeGameplayCallouts items={gameplayCallouts} />
      ) : null}
    </div>
  );
}
