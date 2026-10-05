'use client';

import type { ButtonHTMLAttributes } from 'react';
import { Trophy } from 'lucide-react';
import { ArcadeButton, type ArcadeTone } from '@/features/arcade/components/ui/arcade-ui';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon';

type GameLeaderboardButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> & {
  label?: string;
  iconSize?: number;
  tone?: ArcadeTone;
  size?: ButtonSize;
};

export function GameLeaderboardButton({
  label = 'Leaderboard',
  iconSize = 16,
  tone = 'ghost',
  size = 'sm',
  className,
  ...buttonProps
}: GameLeaderboardButtonProps) {
  return (
    <ArcadeButton tone={tone} size={size} className={className} {...buttonProps}>
      <Trophy size={iconSize} />
      <span>{label}</span>
    </ArcadeButton>
  );
}
