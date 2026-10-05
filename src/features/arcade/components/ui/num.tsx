'use client';

import { useSyncExternalStore, type ComponentPropsWithoutRef } from 'react';

/* Num: a number set in the number face. Big Shoulders has proportional
   figures and no tnum feature, so a counting number would jitter as its
   digits change width. Under tixy each digit sits in its own 1ch cell
   instead (globals.css), centred, so the number holds its width while it
   rolls. Under the Midway themes the digits sit in the theme's mono as
   they always did.

   Screen readers get the whole value once, from a visually hidden copy; the
   cells are aria-hidden. (An aria-label on a plain span is ignored by NVDA
   and JAWS, so the value is real text instead.)

   Separators: the server and the first client render print en-US, so
   hydration always matches; after mount the number switches to the
   player's locale. */

import { MINUS, SERVER_LOCALE, formatNum } from './num-format';

export { formatNum } from './num-format';

function browserLocale() {
  return new Intl.NumberFormat().resolvedOptions().locale;
}
const noSubscribe = () => () => {};

/** en-US on the server and while hydrating, then the player's locale. */
export function useNumLocale(): string {
  return useSyncExternalStore(noSubscribe, browserLocale, () => SERVER_LOCALE);
}

export type NumProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  /** A number is formatted; a string (a clock, "7/7") is set as given. */
  value: number | string;
  /** Prefix positive numbers with +. */
  signed?: boolean;
  decimals?: number;
  /** The number a screen reader hears, if not `value`: give a rolling number
   *  its final value. Formatted like `value`. */
  labelValue?: number;
  /** Said after the number: "tickets". */
  labelSuffix?: string;
  /** What a screen reader hears, in full. Overrides the two above. */
  label?: string;
};

export function Num({
  value,
  signed,
  decimals,
  labelValue,
  labelSuffix,
  label,
  className,
  ...props
}: NumProps) {
  const locale = useNumLocale();
  const format = (n: number) => formatNum(n, { signed, decimals, locale });
  const text = typeof value === 'number' ? format(value) : value;
  const heard =
    label ??
    [labelValue != null ? format(labelValue) : text, labelSuffix].filter(Boolean).join(' ');
  return (
    <span {...props} className={className ? `arc-digits ${className}` : 'arc-digits'}>
      <span className='sr-only'>{heard.replace(MINUS, '-')}</span>
      <span aria-hidden='true'>
        {Array.from(text).map((char, index) =>
          char >= '0' && char <= '9' ? (
            <span key={index} data-d=''>
              {char}
            </span>
          ) : (
            char
          ),
        )}
      </span>
    </span>
  );
}
