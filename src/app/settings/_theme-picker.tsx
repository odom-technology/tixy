'use client';

import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';

import {
  ARCADE_THEMES,
  type ArcadeThemeDefinition,
  type ArcadeThemeId,
} from '@/features/arcade/lib/arcade-themes';

import './theme-picker.css';

/* The theme picker: one card per theme, each with a small live preview
   drawn from that theme's own tokens (the ground, a cabinet with its
   screen, a row, a ticket stub and the primary button), so every card
   shows its theme whatever theme is on. A radio group: arrow keys move
   between cards, and choosing one applies and saves it at once. */

type PreviewStyle = CSSProperties & Record<`--thp-${string}`, string>;

function previewStyle(theme: ArcadeThemeDefinition): PreviewStyle {
  const t = theme.tokens;
  return {
    '--thp-paper': t.paper,
    '--thp-paper-2': t['paper-2'],
    '--thp-paper-3': t['paper-3'],
    '--thp-ink': t.ink,
    '--thp-ink-2': t['ink-2'],
    '--thp-ticket': t.ticket,
    '--thp-on-ticket': t['on-ticket'],
    '--thp-red': t.red,
    '--thp-cabinet': t.cabinet,
    colorScheme: theme.colorScheme,
  };
}

function ThemePreview({ theme }: { theme: ArcadeThemeDefinition }) {
  return (
    <span className='thp-preview' style={previewStyle(theme)} aria-hidden>
      <span className='thp-cabinet'>
        <span className='thp-screen'>
          <svg viewBox='0 0 64 40' className='thp-game'>
            <path d='M10 28h16v-10h14' fill='none' stroke='#f4ebdc' strokeWidth='4' strokeLinecap='square' />
            <circle cx='50' cy='18' r='3.5' fill='#b83627' />
          </svg>
        </span>
      </span>
      <span className='thp-side'>
        <span className='thp-row'>
          <span className='thp-dot' />
          your turn
        </span>
        <span className='thp-stub'>120</span>
        <span className='thp-button'>play</span>
      </span>
    </span>
  );
}

export function ThemePicker({
  value,
  onChange,
  saving,
}: {
  value: ArcadeThemeId;
  onChange: (id: ArcadeThemeId) => void;
  saving: boolean;
}) {
  return (
    <fieldset className='thp' aria-busy={saving || undefined}>
      <legend className='thp-legend'>theme</legend>
      <div className='thp-grid'>
        {ARCADE_THEMES.map((theme) => {
          const selected = value === theme.id;
          return (
            <label key={theme.id} className='thp-card' data-selected={selected || undefined}>
              <input
                type='radio'
                name='arcadeTheme'
                value={theme.id}
                checked={selected}
                onChange={() => onChange(theme.id)}
                className='thp-input'
              />
              <ThemePreview theme={theme} />
              <span className='thp-meta'>
                <span className='thp-label'>{theme.label}</span>
                {selected ? <Check aria-hidden size={18} strokeWidth={2.5} strokeLinecap='square' className='thp-check' /> : null}
              </span>
              <span className='thp-desc'>{theme.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
