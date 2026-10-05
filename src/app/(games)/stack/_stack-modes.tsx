'use client';

import { useCallback, useState } from 'react';

import { GameModes } from '@/features/arcade/components/shell/game-shell';

import StackClient from './_stack-client';
import StackerCabinetClient from './_stacker-cabinet-client';
import { STACK_MODE_OPTIONS, type StackMode } from './_stack-mode';

/* Stacker: the cabinet and endless, one page. The switch sits in the strip
   and is locked while a run is on. Each mode is its own client with its own
   session, score route and stored keys; switching unmounts the other. The
   URL keeps the mode (?mode=endless) so a reload or a shared link opens the
   same one. */
export default function StackModes({ initialMode }: { initialMode: StackMode }) {
  const [mode, setMode] = useState<StackMode>(initialMode);

  const change = useCallback((next: StackMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === 'endless') url.searchParams.set('mode', 'endless');
    else url.searchParams.delete('mode');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const modeSwitch = useCallback(
    (locked: boolean) => (
      <GameModes label='mode' options={STACK_MODE_OPTIONS} value={mode} onChange={change} locked={locked} />
    ),
    [change, mode],
  );

  return mode === 'endless' ? (
    <StackClient modeSwitch={modeSwitch} />
  ) : (
    <StackerCabinetClient modeSwitch={modeSwitch} />
  );
}
