/* Number formats for the console. Whole numbers get thousands separators,
   rates one decimal, money its currency. Compact notation only where space
   is tight (chart axes, tiles over 100,000). */

const wholeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A zero never prints with a sign. A negated sum over nothing is -0, and a
    tiny negative rounds to "-0", "-0.0%" or "-$0.00"; all of them are zero.
    Every formatter here passes its output through this. */
export function noNegativeZero(text: string): string {
  return text.replace(/^[-−](?=[^1-9]*$)/, '');
}

const whole = { format: (value: number) => noNegativeZero(wholeFormat.format(value)) };
const compact = { format: (value: number) => noNegativeZero(compactFormat.format(value)) };

export function fmtInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return whole.format(Math.round(value));
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return Math.abs(value) < 10_000 ? whole.format(Math.round(value)) : compact.format(value);
}

/** A figure for a stat tile: full below 100,000, compact above. */
export function fmtFigure(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return Math.abs(value) < 100_000 ? whole.format(Math.round(value)) : compact.format(value);
}

/** Signed, compact above 100,000, for headline tiles. */
export function fmtSignedFigure(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const text = fmtFigure(Math.abs(value));
  // The sign follows what is printed: -0.4 prints as 0, so it gets none.
  return text === '0' ? '0' : value > 0 ? `+${text}` : `−${text}`;
}

export function fmtSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const text = whole.format(Math.abs(Math.round(value)));
  return text === '0' ? '0' : value > 0 ? `+${text}` : `−${text}`;
}

/** A ratio (0.123) as a percent. One decimal under 10%, none above 99.5%. */
export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'n/a';
  return noNegativeZero(`${(ratio * 100).toFixed(digits)}%`);
}

export function fmtMoney(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null || !Number.isFinite(cents)) return 'n/a';
  try {
    return noNegativeZero(new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100));
  } catch {
    return noNegativeZero(`${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`);
  }
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} m ${rest} s` : `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} m`;
}

export function fmtHours(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const hours = ms / 3_600_000;
  return noNegativeZero(hours < 10 ? `${hours.toFixed(1)} h` : `${whole.format(Math.round(hours))} h`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-03' -> '3 Oct'. */
export function fmtDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  if (!m || !d) return day;
  return `${d} ${MONTHS[m - 1]}`;
}

/** ms -> '3 Oct, 14:05' in UTC; the console works in UTC throughout. */
export function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const date = new Date(ms);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${hh}:${mm}`;
}

export function fmtDate(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** How long ago, short: '40 s', '12 m', '3 h', '5 d'. */
export function fmtAgo(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** Change against a baseline as a ratio, or null when there is no baseline. */
export function change(value: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null;
  return (value - previous) / previous;
}
