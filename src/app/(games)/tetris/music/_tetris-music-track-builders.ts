import type { TrackData, TrackId } from './_tetris-music-score';
import { ambientTrack } from './tracks/_tetris-ambient-track';
import { chiptuneTrack } from './tracks/_tetris-chiptune-track';
import { classicTrack } from './tracks/_tetris-classic-track';
import { edmBassTrack } from './tracks/_tetris-edm-track';
import { orchestralTrack } from './tracks/_tetris-orchestral-track';
import { synthwaveTrack } from './tracks/_tetris-synthwave-track';

export function buildTrackData(trackId: TrackId): TrackData | null {
  switch (trackId) {
    case 'classic':
      return classicTrack();
    case 'synthwave':
      return synthwaveTrack();
    case 'chiptune':
      return chiptuneTrack();
    case 'ambient':
      return ambientTrack();
    case 'orchestral':
      return orchestralTrack();
    case 'edm-bass':
      return edmBassTrack();
    default:
      return null;
  }
}
