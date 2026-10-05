/** Stacker's two modes. Cabinet is the 15-row machine that pays tickets at
 *  rows 11 and 15; endless is the original stack, scored by height. */
export type StackMode = 'cabinet' | 'endless';

export const STACK_MODE_OPTIONS: readonly { value: StackMode; label: string }[] = [
  { value: 'cabinet', label: 'cabinet' },
  { value: 'endless', label: 'endless' },
];

/** The mode a URL opens in. `?mode=endless` opens endless, and so does a
 *  score challenge link: every stack challenge so far is an endless height.
 *  Everything else opens the cabinet. */
export function stackModeFromParams(params: Record<string, string | string[] | undefined>): StackMode {
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  if (mode === 'endless') return 'endless';
  if (mode === 'cabinet') return 'cabinet';
  return params.scoreChallenge ? 'endless' : 'cabinet';
}
