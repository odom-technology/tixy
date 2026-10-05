import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type MoveSoundKind =
  | 'move'
  | 'capture'
  | 'king'
  | 'gameEnd'
  | 'turn'
  | 'select';

const CUES: Record<MoveSoundKind, string> = {
  move: 'boardMove',
  capture: 'boardJump',
  king: 'boardPromote',
  gameEnd: 'boardGameEnd',
  turn: 'boardTurn',
  select: 'boardSelect',
};

/** Checkers keeps its semantic cue API while sharing tixy's context and mixer. */
export function playMoveSound(kind: MoveSoundKind): void {
  SoundManager.play(CUES[kind], { volume: 0.5 });
}
