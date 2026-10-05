import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type MoveSoundKind =
  | 'place'
  | 'fire'
  | 'hit'
  | 'miss'
  | 'sunk'
  | 'win'
  | 'lose'
  | 'turn'
  | 'select';

const CUES: Record<MoveSoundKind, string> = {
  place: 'battleshipPlace',
  fire: 'battleshipFire',
  hit: 'battleshipHit',
  miss: 'battleshipMiss',
  sunk: 'battleshipSunk',
  win: 'battleshipWin',
  lose: 'battleshipLose',
  turn: 'boardTurn',
  select: 'boardHoverSelect',
};

/** Battleship keeps its semantic cue API while sharing Arcade's context and mixer. */
export function playMoveSound(kind: MoveSoundKind): void {
  SoundManager.play(CUES[kind], { volume: 0.5 });
}
