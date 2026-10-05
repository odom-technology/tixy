'use client';

/* Word grid, drawn with the game's own stylesheet and theme vars
   (_word-grid-midway.css, _word-grid-theme.ts): three graded guesses and a
   word being typed, the way the board looks halfway through a day. */

import { useMemo } from 'react';

import {
  DEFAULT_WORD_GRID_THEME,
  applyWordGridSkinSet,
  wordGridSkinAttrs,
  wordGridThemeToCssVars,
} from '@/app/(games)/word-grid/_word-grid-theme';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import '@/app/(games)/word-grid/_word-grid-midway.css';

import type { LiveProps } from './types';

type TileState = 'correct' | 'present' | 'absent' | 'filled' | 'empty';

/* c correct, p present, a absent, f typed. */
const ROWS: Array<[string, string]> = [
  ['plant', 'cpaac'],
  ['tilts', 'pcpaa'],
  ['patio', 'cappp'],
  ['pi', 'ff'],
  ['', ''],
  ['', ''],
];
const STATE: Record<string, TileState> = { c: 'correct', p: 'present', a: 'absent', f: 'filled' };

export default function WordGridLive({ skin }: LiveProps) {
  const theme = useMemo(
    () => (skin ? applyWordGridSkinSet(skin as SkinSet<'word-grid'>) : DEFAULT_WORD_GRID_THEME),
    [skin],
  );
  return (
    <div className='word-grid-root pp-fill'>
      <div className='wg-frame' style={wordGridThemeToCssVars(theme)} {...wordGridSkinAttrs(theme)}>
        <div className='wg-board'>
          {ROWS.map(([word, marks], r) => (
            <div key={r} className='wg-row'>
              {Array.from({ length: 5 }, (_, i) => {
                const state = STATE[marks[i] ?? ''] ?? 'empty';
                const graded = state === 'correct' || state === 'present' || state === 'absent';
                return (
                  <div
                    key={i}
                    className={`wg-tile${graded ? ` wg-${state}` : ''}${state === 'filled' ? ' wg-filled' : ''}`}
                    data-state={state}
                  >
                    <span className='wg-tile-face'>{word[i] ?? ''}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
