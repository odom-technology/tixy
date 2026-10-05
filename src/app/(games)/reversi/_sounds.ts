import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type MoveSoundKind = 'place' | 'flip' | 'win' | 'turn' | 'select';

const CUES: Record<MoveSoundKind, string> = {
  place: 'reversiPlace',
  flip: 'reversiFlip',
  win: 'boardWin',
  turn: 'boardTurn',
  select: 'boardHoverSelect',
};

/** Reversi keeps its semantic cue API while sharing tixy's context and mixer. */
export function playMoveSound(kind: MoveSoundKind): void {
  SoundManager.play(CUES[kind], { volume: 0.5 });
}
