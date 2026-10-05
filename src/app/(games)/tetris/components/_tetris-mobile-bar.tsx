import type { RefObject } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { TRACKS, type TrackId } from '../_tetris-music';
import type { TetrisGameState } from './_tetris-playfield';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

type TetrisMobileBarProps = {
  mobileLabelRef: RefObject<HTMLSpanElement | null>;
  currentTrack: TrackId;
  onTrackChange: (id: TrackId) => void;
  musicMuted: boolean;
  onToggleMusicMute: () => void;
  onMoveLeft: () => void;
  onRotate: () => void;
  onMoveRight: () => void;
  onSoftDrop: () => void;
  onHardDrop: () => void;
  onHold: () => void;
  onPauseToggle: () => void;
  gameState: TetrisGameState;
};

export function TetrisMobileBar({
  mobileLabelRef,
  currentTrack,
  onTrackChange,
  musicMuted,
  onToggleMusicMute,
  onMoveLeft,
  onRotate,
  onMoveRight,
  onSoftDrop,
  onHardDrop,
  onHold,
  onPauseToggle,
  gameState,
}: TetrisMobileBarProps) {
  const canControlPiece = gameState === 'playing';
  const canPauseToggle = gameState === 'playing' || gameState === 'paused';

  const actionBtnClass = 'tet-key';

  return (
    <div className='z-30 w-full sm:hidden'>
      <div className='tet-panel space-y-2'>
        <div className='flex items-center gap-1.5'>
          <span
            ref={mobileLabelRef}
            className='min-w-0 flex-1 truncate text-xs text-body tabular-nums'
            style={{ fontFamily: 'var(--font-mono-arcade)' }}
          >
            0 | Lv1 | 0L
          </span>
          <select
            value={currentTrack}
            onChange={(event) => onTrackChange(event.target.value as TrackId)}
            className='max-w-28 arcade-input px-2 py-1.5 text-xs'
          >
            {TRACKS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
          <ArcadeButton
            tone='ghost'
            size='icon-sm'
            onClick={onToggleMusicMute}
            className='touch-manipulation'
            aria-label={musicMuted ? 'Unmute music' : 'Mute music'}
            title={musicMuted ? 'Unmute music' : 'Mute music'}
          >
            {musicMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </ArcadeButton>
        </div>

        <div className='grid grid-cols-4 gap-1.5'>
          <button type='button' onClick={onMoveLeft} className={actionBtnClass} disabled={!canControlPiece}>
            Left
          </button>
          <button type='button' onClick={onRotate} className={actionBtnClass} disabled={!canControlPiece}>
            Rotate
          </button>
          <button type='button' onClick={onMoveRight} className={actionBtnClass} disabled={!canControlPiece}>
            Right
          </button>
          <button type='button' onClick={onHardDrop} className={actionBtnClass} disabled={!canControlPiece}>
            Hard
          </button>
        </div>

        <div className='grid grid-cols-3 gap-1.5'>
          <button type='button' onClick={onHold} className={actionBtnClass} disabled={!canControlPiece}>
            Hold
          </button>
          <button type='button' onClick={onSoftDrop} className={actionBtnClass} disabled={!canControlPiece}>
            Soft
          </button>
          <button
            type='button'
            onClick={onPauseToggle}
            className={actionBtnClass}
            disabled={!canPauseToggle}
          >
            {gameState === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
    </div>
  );
}
