'use client';

import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { trackProductEvent } from '@/features/analytics/product-events';

export function ArcadeTourShare({
  weekKey,
  rank,
}: {
  weekKey: string;
  rank: number | null;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/tour`;
    const text = rank
      ? `I’m #${rank} in tixy Tour for the week of ${weekKey}. Can you beat me?`
      : `This week’s tixy Tour is live. Three games, one combined leaderboard.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'tixy Tour', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
      void trackProductEvent('result_shared', { source: 'arcade_tour' });
    } catch {
      // Cancelled shares do not need an error surface.
    }
  };

  return (
    <ArcadeButton tone='primary' size='sm' onClick={() => void share()}>
      {copied ? <Check size={15} aria-hidden /> : <Share2 size={15} aria-hidden />}
      {copied ? 'Copied' : 'Share tour'}
    </ArcadeButton>
  );
}
