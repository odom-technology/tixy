'use client';

import { useEffect, useState } from 'react';
import { TournamentCreateModal as SharedTournamentCreateModal } from '@/features/arcade/components/tournaments/create-modal';
import { TIME_FORMAT_PRESETS } from '@/features/arcade/lib/chess/types';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

/**
 * Chess-flavored wrapper around the shared tournament-create modal. Injects
 * the chess-only time-format picker between the format picker and the
 * losers-bracket toggle, and carries `timeFormatId` into the create payload.
 */
// fallow-ignore-next-line duplicate-export
export function TournamentCreateModal({ open, onClose, onCreated }: Props) {
  const [timeFormatId, setTimeFormatId] = useState('blitz');

  // Reset to default whenever the modal is closed so reopening starts clean.
  useEffect(() => {
    if (!open) setTimeFormatId('blitz');
  }, [open]);

  const timeFormatField = (
    <div>
      <label className='mb-1 block text-xs font-medium text-faint'>mode</label>
      <div className='flex gap-1.5'>
        {TIME_FORMAT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type='button'
            onClick={() => setTimeFormatId(preset.id)}
            className={`flex-1 rounded-key border-2 px-3 py-2 text-sm font-semibold shadow-chip transition-[filter] duration-[140ms] hover:brightness-107 ${
              timeFormatId === preset.id
                ? 'border-ink bg-key-face text-key-face-on'
                : 'border-ink bg-raised text-body'
            }`}
          >
            {preset.label.toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <SharedTournamentCreateModal
      open={open}
      onClose={onClose}
      onCreated={onCreated}
      gameType='chess'
      extraFields={timeFormatField}
      extraPayload={{ timeFormatId }}
    />
  );
}
