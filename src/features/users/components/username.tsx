import type { CSSProperties } from 'react';

import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';

// Renders a username with equipped flair (badge + name color + title) applied
// consistently. Pure presentational — usable from server or client components.
export function Username({
  name,
  flair,
  className = '',
}: {
  name: string;
  flair?: ProfileFlair | null;
  className?: string;
}) {
  const nameStyle: CSSProperties | undefined = flair?.nameGradient
    ? {
        backgroundImage: flair.nameGradient,
        backgroundSize: flair.nameAnimated ? '220% 100%' : undefined,
        color: 'transparent',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        textShadow: flair.nameGlowColor ? `0 0 0.85em ${flair.nameGlowColor}` : undefined,
      }
    : flair?.nameColor
      ? { color: flair.nameColor }
      : undefined;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {flair?.badgeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          aria-hidden
          src={flair.badgeImage}
          alt=''
          className='inline-block h-[1.15em] w-[1.15em] shrink-0 object-contain'
        />
      ) : flair?.badge ? (
        <span aria-hidden className='shrink-0'>
          {flair.badge}
        </span>
      ) : null}
      <span
        className={`truncate ${flair?.nameAnimated ? 'arc-profile-name-animated' : ''}`}
        style={nameStyle}
      >
        {name}
      </span>
      {flair?.title ? (
        <span className='shrink-0 rounded-full border border-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint'>
          {flair.title}
        </span>
      ) : null}
    </span>
  );
}
