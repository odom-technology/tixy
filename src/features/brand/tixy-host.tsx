/* The host: the stub with two arms and two legs, drawn from the mark.
   PLAN.md: it turns up at the prize counter, on empty screens, and on a
   result that pays tickets. Never on a game stage, in a hero, or on a loading
   spinner. It doesn't talk.

   Each part carries data-host-part (body, eyes, arm-left, arm-right,
   leg-left, leg-right) so a caller can animate it with CSS. Limbs turn at
   their joint: use transform-box: view-box with the origin in the 150 x 170
   viewBox units, as build-mockup.mjs does (arm-left 22px 62px, arm-right
   128px 74px, leg-left 58px 104px, leg-right 88px 106px). The eyes blink
   with transform-box: fill-box and transform-origin: center. */

import type { CSSProperties } from 'react';

import { TixyMarkArt } from './tixy-brand';
import { HOST, HOST_HEIGHT, HOST_WIDTH, TIXY_COLORS } from './tixy-brand-geometry';

export function TixyHost({
  width = 150,
  className,
  style,
  label,
}: {
  /* px; height follows (170 / 150). */
  width?: number;
  className?: string;
  style?: CSSProperties;
  /* Accessible name. Leave it out when the host is decoration. */
  label?: string;
}) {
  const ink = TIXY_COLORS.ink;
  const limb = {
    fill: 'none',
    stroke: ink,
    strokeWidth: HOST.limbWidth,
    strokeLinecap: 'round' as const,
  };
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${HOST_WIDTH} ${HOST_HEIGHT}`}
      width={width}
      height={Math.round(((width * HOST_HEIGHT) / HOST_WIDTH) * 100) / 100}
      overflow='visible'
      className={className}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' })}
    >
      <g data-host-part='leg-left'>
        <path d={HOST.legLeft.d} {...limb} />
        <ellipse cx={HOST.legLeft.foot[0]} cy={HOST.legLeft.foot[1]} rx={HOST.legLeft.foot[2]} ry={HOST.legLeft.foot[3]} fill={ink} />
      </g>
      <g data-host-part='leg-right'>
        <path d={HOST.legRight.d} {...limb} />
        <ellipse cx={HOST.legRight.foot[0]} cy={HOST.legRight.foot[1]} rx={HOST.legRight.foot[2]} ry={HOST.legRight.foot[3]} fill={ink} />
      </g>
      <g data-host-part='arm-left'>
        <path d={HOST.armLeft.d} {...limb} />
        <circle cx={HOST.armLeft.hand[0]} cy={HOST.armLeft.hand[1]} r={HOST.armLeft.hand[2]} fill={ink} />
      </g>
      <g data-host-part='arm-right'>
        <path d={HOST.armRight.d} {...limb} />
        <circle cx={HOST.armRight.hand[0]} cy={HOST.armRight.hand[1]} r={HOST.armRight.hand[2]} fill={ink} />
      </g>
      <g data-host-part='body' transform={HOST.body}>
        <TixyMarkArt eyes={{ 'data-host-part': 'eyes' }} />
      </g>
    </svg>
  );
}
