'use client';

import { Target } from 'lucide-react';

const POCKET_LABELS = [
  { short: 'TL', name: 'Top-Left' },
  { short: 'TC', name: 'Top-Center' },
  { short: 'TR', name: 'Top-Right' },
  { short: 'BL', name: 'Bottom-Left' },
  { short: 'BC', name: 'Bottom-Center' },
  { short: 'BR', name: 'Bottom-Right' },
];

type PocketSelectorProps = {
  selectedPocket: number | null;
  onSelect: (index: number) => void;
  visible: boolean;
};

export function PocketSelector({ selectedPocket, onSelect, visible }: PocketSelectorProps) {
  if (!visible) return null;

  return (
    <div className='rounded-panel border-2 border-ink bg-raised p-2.5 shadow-chip'>
      <div className='mb-1.5 flex items-center gap-1.5'>
        <Target size={12} className='text-tickets-text' />
        <span className='text-[10px] font-semibold uppercase tracking-wider text-tickets-text'>
          Call pocket
        </span>
      </div>
      <div className='grid grid-cols-3 gap-1'>
        {POCKET_LABELS.map((pocket, idx) => (
          <button
            key={idx}
            type='button'
            onClick={() => onSelect(idx)}
            title={pocket.name}
            className={`rounded-tag px-1.5 py-1 text-[10px] font-bold transition ${
              selectedPocket === idx
                ? 'border border-ink bg-tickets text-tickets-on shadow-chip'
                : 'border border-soft bg-well text-body hover:bg-raised'
            }`}
          >
            {pocket.short}
          </button>
        ))}
      </div>
      {selectedPocket === null && (
        <p className='mt-1 text-[9px] text-faint'>Select a pocket before shooting</p>
      )}
    </div>
  );
}
