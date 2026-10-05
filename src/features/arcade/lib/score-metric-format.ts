// ---------------------------------------------------------------------------
// Single source of truth for how a score-based leaderboard metric is rendered.
//
// PURE module — no DB, no server-only imports — so it can be imported from both
// client components (the windowed leaderboard board) and server code (the window
// API, which echoes the format hint back so any consumer formats identically).
// This kills the old client/server format drift where the server config declared
// a `ms` formatter that the client re-implemented and let diverge (minesweeper
// silently rendered raw milliseconds).
// ---------------------------------------------------------------------------

export type MetricFormat =
  | 'number' // integer score, thousands-separated (default)
  | 'ms' // small millisecond value shown as "123 ms" (reaction-time)
  | 'duration'; // longer time shown as m:ss (sudoku / minesweeper solve time)

// Games whose ranked metric is NOT a plain number. Everything not listed here
// formats as 'number'.
const METRIC_FORMAT_BY_GAME: Record<string, MetricFormat> = {
  'reaction-time': 'ms',
  sudoku: 'duration',
  minesweeper: 'duration',
  'punch-card': 'duration',
  derby: 'duration',
};

export function metricFormatFor(slug: string): MetricFormat {
  return METRIC_FORMAT_BY_GAME[slug] ?? 'number';
}

/** Format a raw numeric leaderboard value for display, per game. */
export function formatMetricValue(slug: string, value: number): string {
  switch (metricFormatFor(slug)) {
    case 'ms':
      return `${Math.round(value).toLocaleString()} ms`;
    case 'duration': {
      const totalSeconds = Math.max(0, Math.floor(value / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    case 'number':
    default:
      return Number(value).toLocaleString();
  }
}
