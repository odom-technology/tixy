'use client';

import type { ButtonHTMLAttributes } from 'react';
import { Package } from 'lucide-react';

import { ArcadeButton, type ArcadeTone } from '@/features/arcade/components/ui/arcade-ui';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon';

type GameInventoryButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> & {
  label?: string;
  iconSize?: number;
  tone?: ArcadeTone;
  size?: ButtonSize;
};

export function GameInventoryButton({
  label = 'Inventory',
  iconSize = 16,
  tone = 'ghost',
  size = 'sm',
  className,
  ...buttonProps
}: GameInventoryButtonProps) {
  return (
    <ArcadeButton tone={tone} size={size} className={className} {...buttonProps}>
      <Package size={iconSize} aria-hidden />
      <span>{label}</span>
    </ArcadeButton>
  );
}
