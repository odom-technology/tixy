import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type MoveSoundKind = 'drop' | 'win' | 'turn' | 'select';

const CUES: Record<MoveSoundKind, string> = {
  drop: 'connectFourDrop',
  win: 'boardWin',
  turn: 'boardTurn',
  select: 'boardHoverSelect',
};

/** Connect Four keeps its semantic cue API while sharing tixy's context and mixer. */
export function playMoveSound(kind: MoveSoundKind, volume = 0.5): void {
  SoundManager.play(CUES[kind], { volume });
}
