// Thin facade for Tetris music public API.
// The runtime manager and track builders live under ./music/* modules.

export { TRACKS, type TrackId } from './music/_tetris-music-score';

import { TetrisMusicManager } from './music/_tetris-music-manager';

export const TetrisMusic = new TetrisMusicManager();
