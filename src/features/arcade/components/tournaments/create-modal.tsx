'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { TOURNAMENT_GAME_CONFIG, type TournamentGameKey } from './config';
import {
  ArcadeButton,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeSwitch } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type ExtraPayload = Record<string, unknown>;

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  gameType: TournamentGameKey;
  /** Optional slot between the format picker and losers-bracket toggle — chess uses this for the time-format picker. */
  extraFields?: ReactNode;
  /** Extra fields to merge into the create payload (e.g. chess's `timeFormatId`). */
  extraPayload?: ExtraPayload;
  /** Reset hook so `extraFields`' owning component can zero its state when the modal closes after a successful create. */
  onReset?: () => void;
};

/**
 * Create-tournament modal shared between chess and 8-ball. Visual accents,
 * bet defaults, and API endpoint come from the shared config; chess injects
 * its time-format picker through `extraFields`.
 */
// fallow-ignore-next-line duplicate-export
export function TournamentCreateModal({
  open,
  onClose,
  onCreated,
  gameType,
  extraFields,
  extraPayload,
  onReset,
}: Props) {
  const cfg = TOURNAMENT_GAME_CONFIG[gameType];
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'bo1' | 'bo3'>('bo1');
  const [hasLosersBracket, setHasLosersBracket] = useState(false);
  const [bettingEnabled, setBettingEnabled] = useState(false);
  const [minBet, setMinBet] = useState(cfg.defaultMinBet);
  const [maxBet, setMaxBet] = useState(cfg.defaultMaxBet);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state when the modal closes so a second open starts clean.
  useEffect(() => {
    if (open) return;
    setName('');
    setFormat('bo1');
    setHasLosersBracket(false);
    setBettingEnabled(false);
    setMinBet(cfg.defaultMinBet);
    setMaxBet(cfg.defaultMaxBet);
    setError(null);
  }, [open, cfg.defaultMinBet, cfg.defaultMaxBet]);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Tournament name is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(cfg.apiBasePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          format,
          hasLosersBracket,
          bettingEnabled,
          ...(bettingEnabled && { minBet, maxBet }),
          ...(extraPayload ?? {}),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to create tournament.');
      onCreated();
      onClose();
      onReset?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4'>
      <div className='arcade-modal mx-4 max-w-md overflow-y-auto p-6'>
        <ArcadeButton
          type='button'
          onClick={onClose}
          size='icon-sm'
          className='absolute right-4 top-4'
          aria-label='Close tournament creator'
        >
          <X size={18} />
        </ArcadeButton>

        <h2 className='mb-4 text-lg font-semibold text-strong'>
          Create {cfg.createLabel}
        </h2>

        <div className='space-y-4'>
          <div>
            <label
              htmlFor='tournament-name'
              className='mb-1 block text-xs font-medium text-faint'
            >
              Tournament name
            </label>
            <input
              id='tournament-name'
              type='text'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder={cfg.namePlaceholder}
              className='arcade-input px-3 py-2 text-sm placeholder:text-faint'
            />
          </div>

          <div>
            <label className='mb-1 block text-xs font-medium text-faint'>
              Match format
            </label>
            <div className='flex gap-2'>
              {(
                [
                  { id: 'bo1' as const, label: 'Best of 1' },
                  { id: 'bo3' as const, label: 'Best of 3' },
                ]
              ).map((o) => (
                <ArcadeButton
                  key={o.id}
                  type='button'
                  onClick={() => setFormat(o.id)}
                  tone={format === o.id ? 'primary' : 'default'}
                  className='flex-1'
                >
                  {o.label}
                </ArcadeButton>
              ))}
            </div>
          </div>

          {extraFields}

          <div className='arcade-card-inset flex items-center justify-between px-3 py-2.5'>
            <div>
              <p className='text-sm font-medium text-strong'>Losers bracket</p>
              <p className='text-[11px] text-faint'>
                Double elimination — players get a second chance
              </p>
            </div>
            <ArcadeSwitch
              checked={hasLosersBracket}
              onChange={setHasLosersBracket}
              label='Losers bracket'
            />
          </div>

          <div className='arcade-card-inset flex items-center justify-between px-3 py-2.5'>
            <div>
              <p className='text-sm font-medium text-strong'>Spectator betting</p>
              <p className='text-[11px] text-faint'>
                Allow spectators to wager tickets on match outcomes
              </p>
            </div>
            <ArcadeSwitch
              checked={bettingEnabled}
              onChange={setBettingEnabled}
              label='Spectator betting'
            />
          </div>

          {bettingEnabled && (
            <div className='flex gap-3'>
              <div className='flex-1'>
                <label
                  htmlFor='min-bet'
                  className='mb-1 block text-xs font-medium text-faint'
                >
                  Min bet
                </label>
                <input
                  id='min-bet'
                  type='number'
                  min={cfg.defaultMinBet}
                  max={maxBet}
                  step={cfg.wagerIncrement}
                  value={minBet}
                  onChange={(e) =>
                    setMinBet(
                      Math.max(
                        cfg.defaultMinBet,
                        Math.trunc(Number(e.target.value) || cfg.defaultMinBet),
                      ),
                    )
                  }
                  className='arcade-input arcade-num px-3 py-2 text-sm'
                />
              </div>
              <div className='flex-1'>
                <label
                  htmlFor='max-bet'
                  className='mb-1 block text-xs font-medium text-faint'
                >
                  Max bet
                </label>
                <input
                  id='max-bet'
                  type='number'
                  min={minBet}
                  step={cfg.wagerIncrement}
                  value={maxBet}
                  onChange={(e) =>
                    setMaxBet(
                      Math.max(
                        minBet,
                        Math.trunc(Number(e.target.value) || cfg.defaultMaxBet),
                      ),
                    )
                  }
                  className='arcade-input arcade-num px-3 py-2 text-sm'
                />
              </div>
            </div>
          )}

          {error ? (
            <ArcadeNotice tone='danger'>
              {error}
            </ArcadeNotice>
          ) : null}

          <ArcadeButton
            type='button'
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim()}
            tone='primary'
            className='w-full'
          >
            {creating ? (
              <ArcadeLoadingDots />
            ) : (
              'Create'
            )}
          </ArcadeButton>
        </div>
      </div>
    </div>
  );
}
