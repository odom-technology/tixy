import type { RefObject } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { TRACKS, type TrackId } from '../_tetris-music';

type TetrisLeftPanelProps = {
  scoreLabelRef: RefObject<HTMLParagraphElement | null>;
  levelLabelRef: RefObject<HTMLParagraphElement | null>;
  linesLabelRef: RefObject<HTMLParagraphElement | null>;
  currentTrack: TrackId;
  onTrackChange: (id: TrackId) => void;
  musicMuted: boolean;
  onToggleMusicMute: () => void;
};

export function TetrisLeftPanel({
  scoreLabelRef,
  levelLabelRef,
  linesLabelRef,
  currentTrack,
  onTrackChange,
  musicMuted,
  onToggleMusicMute,
}: TetrisLeftPanelProps) {
  return (
    <div className='hidden w-28 shrink-0 flex-col gap-3 sm:flex lg:w-32'>
      <div className='flex flex-col gap-2'>
        <div className='tet-stat'>
          <span className='tet-stat-label'>Score</span>
          <span ref={scoreLabelRef} className='tet-stat-value'>0</span>
        </div>
        <div className='tet-stat'>
          <span className='tet-stat-label'>Level</span>
          <span ref={levelLabelRef} className='tet-stat-value'>1</span>
        </div>
        <div className='tet-stat'>
          <span className='tet-stat-label'>Lines</span>
          <span ref={linesLabelRef} className='tet-stat-value' data-accent='prize'>0</span>
        </div>
      </div>
      <div className='tet-panel'>
        <span className='tet-eyebrow'>Music</span>
        <select
          value={currentTrack}
          onChange={(event) => onTrackChange(event.target.value as TrackId)}
          className='w-full arcade-input px-2 py-1 text-xs'
        >
          {TRACKS.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
        <button
          type='button'
          onClick={onToggleMusicMute}
          className='tet-kbd mt-2 h-9 w-9'
          aria-label={musicMuted ? 'Unmute music' : 'Mute music'}
          title={musicMuted ? 'Unmute music' : 'Mute music'}
        >
          {musicMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
      <div className='tet-panel'>
        <span className='tet-eyebrow'>Controls</span>
        <ul className='tet-controls'>
          <li className='tet-control'>
            <span className='tet-kbd-group'>
              <kbd className='tet-kbd'>&larr;</kbd>
              <kbd className='tet-kbd'>&rarr;</kbd>
            </span>
            <span className='tet-control-action'>Move</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'>
              <kbd className='tet-kbd'>&uarr;</kbd>
              <kbd className='tet-kbd'>X</kbd>
            </span>
            <span className='tet-control-action'>Rotate CW</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'><kbd className='tet-kbd'>Z</kbd></span>
            <span className='tet-control-action'>Rotate CCW</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'><kbd className='tet-kbd'>Space</kbd></span>
            <span className='tet-control-action'>Hard drop</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'>
              <kbd className='tet-kbd'>C</kbd>
              <kbd className='tet-kbd'>&#8679;</kbd>
            </span>
            <span className='tet-control-action'>Hold</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'>
              <kbd className='tet-kbd'>P</kbd>
              <kbd className='tet-kbd'>Esc</kbd>
            </span>
            <span className='tet-control-action'>Pause</span>
          </li>
          <li className='tet-control'>
            <span className='tet-kbd-group'><kbd className='tet-kbd'>&darr;</kbd></span>
            <span className='tet-control-action'>Soft drop</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
