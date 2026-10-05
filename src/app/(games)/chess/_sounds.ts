import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type MoveSoundKind =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'promote'
  | 'gameEnd'
  | 'lowTime'
  | 'turn'
  | 'select';

const CUES: Record<MoveSoundKind, string> = {
  move: 'boardMove',
  capture: 'boardCapture',
  check: 'boardCheck',
  castle: 'boardCastle',
  promote: 'boardPromote',
  gameEnd: 'boardGameEnd',
  lowTime: 'boardLowTime',
  turn: 'boardTurn',
  select: 'boardSelect',
};

/** Chess keeps its semantic cue API while sharing tixy's context and mixer. */
export function playMoveSound(kind: MoveSoundKind): void {
  SoundManager.play(CUES[kind], { volume: 0.5 });
}
