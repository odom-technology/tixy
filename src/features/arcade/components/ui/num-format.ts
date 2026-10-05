/* Number formatting for Num. Kept out of num.tsx (a client module) so
   server code can call it too. en-US unless a locale is passed: a fixed
   locale is what the server and the first client render agree on. */

export const MINUS = '−';
export const SERVER_LOCALE = 'en-US';
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, decimals: number) {
  const key = `${locale}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(key, f);
  }
  return f;
}

/** Thousands separators, a real minus, and a plus when `signed`. */
export function formatNum(
  value: number,
  {
    signed = false,
    decimals = 0,
    locale = SERVER_LOCALE,
  }: { signed?: boolean; decimals?: number; locale?: string } = {},
): string {
  if (!Number.isFinite(value)) return '0';
  const f = formatter(locale, decimals);
  const body = f.format(Math.abs(value));
  if (value < 0 && body !== f.format(0)) return `${MINUS}${body}`;
  if (signed && value > 0) return `+${body}`;
  return body;
}
