'use client';

import { useState } from 'react';
import { Shield, ChevronDown, ChevronUp, Check, Copy } from 'lucide-react';

import { useIsTixyTheme } from '@/features/arcade/lib/use-arcade-theme';
import {
  usePublishWagerFairness,
  useReceiptCarriesFairness,
} from '@/features/arcade/lib/wager-fairness-store';

/* The "Provably fair" badge. Under tixy the receipt prints the proof as one
   line (ArcadeWagerResultPlate), so the badge hides while a receipt is up.
   Kept for the other themes and for games that show no receipt yet. */
type ArcadeProvablyFairProps = {
  seedHash: string | null;
  revealedSeed: number | null;
};

export function ArcadeProvablyFair({
  seedHash,
  revealedSeed,
}: ArcadeProvablyFairProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const tixy = useIsTixyTheme();
  const onReceipt = useReceiptCarriesFairness();
  usePublishWagerFairness(seedHash, revealedSeed);

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (!seedHash) return null;
  if (tixy && onReceipt) return null;

  return (
    <div className='rounded-well border-2 border-ink bg-well inset-shadow-well'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='flex w-full items-center justify-between px-3 py-2'
      >
        <span className='arcade-kicker flex items-center gap-1.5'>
          <Shield size={12} className='text-info-text' aria-hidden />
          Provably fair
        </span>
        {open ? (
          <ChevronUp size={12} className='text-faint' />
        ) : (
          <ChevronDown size={12} className='text-faint' />
        )}
      </button>

      {open && (
        <div className='space-y-2 border-t border-soft px-3 py-2.5'>
          <div>
            <p className='arcade-kicker mb-1'>Seed hash (SHA-256)</p>
            <button
              type='button'
              onClick={() => copyToClipboard(seedHash, 'hash')}
              className='flex w-full items-center gap-1.5 rounded-tag border border-soft bg-raised px-2 py-1 font-mono text-xs text-body transition-[filter] hover:brightness-110'
            >
              <span className='min-w-0 flex-1 truncate'>{seedHash}</span>
              {copied === 'hash' ? <Check size={10} className='shrink-0 text-prize-text' /> : <Copy size={10} className='shrink-0' />}
            </button>
          </div>

          {revealedSeed != null ? (
            <div>
              <p className='arcade-kicker mb-1'>Revealed seed</p>
              <button
                type='button'
                onClick={() => copyToClipboard(String(revealedSeed), 'seed')}
                className='flex w-full items-center gap-1.5 rounded-tag border border-soft bg-raised px-2 py-1 font-mono text-xs text-body transition-[filter] hover:brightness-110'
              >
                <span className='min-w-0 flex-1 truncate arcade-num'>{revealedSeed}</span>
                {copied === 'seed' ? <Check size={10} className='shrink-0 text-prize-text' /> : <Copy size={10} className='shrink-0' />}
              </button>
              <p className='mt-1 text-xs text-faint'>
                Verify: SHA256(<span className='arcade-num'>{revealedSeed}</span>) should equal the hash above.
              </p>
            </div>
          ) : (
            <p className='text-xs text-faint'>
              The seed reveals after the round ends.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
