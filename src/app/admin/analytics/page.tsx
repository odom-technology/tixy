import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { BarList } from '@/features/admin/ui/bar-list';
import { TrendChart } from '@/features/admin/ui/charts';
import { DataTable } from '@/features/admin/ui/data-table';
import { fmtFigure, fmtInt, fmtPct } from '@/features/admin/ui/format';
import { parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Empty, Grid, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { WindowTabs } from '@/features/admin/ui/window-tabs';
import { requireAdminPage } from '@/server/admin/guard';
import { getProductFunnelAnalytics } from '@/server/analytics/product-analytics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Funnel | tixy admin' };

const EVENT_LABELS: Record<string, string> = {
  landing_view: 'opened the site',
  game_started: 'started a game',
  game_completed: 'finished a game',
  auth_nudge_shown: 'saw the save prompt',
  auth_nudge_clicked: 'clicked the save prompt',
  signup_success: 'signed up',
  result_shared: 'shared a result',
  challenge_opened: 'opened a challenge',
};

const GAME_NAMES = new Map(ARCADE_GAMES.map((game) => [game.slug, game.title]));
const DAY_MS = 86_400_000;

/* Odom's first-party funnel (migrations 0043, 0045, 0048). Counts are browser
   sessions; no account ids leave the server. */
export default async function AdminFunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/analytics');
  const days = parseDays((await searchParams).days);
  const analytics = await getProductFunnelAnalytics(days);
  const starts = analytics.totals.game_started.sessions;
  const completions = analytics.totals.game_completed.sessions;
  const shares = analytics.totals.result_shared.sessions;
  const challengeOpens = analytics.totals.challenge_opened.sessions;
  const { d1, d7 } = analytics.retention;

  const byDay = new Map<string, { starts: number; completions: number }>();
  for (const row of analytics.daily) {
    if (row.event !== 'game_started' && row.event !== 'game_completed') continue;
    const entry = byDay.get(row.day) ?? { starts: 0, completions: 0 };
    if (row.event === 'game_started') entry.starts = row.sessions;
    else entry.completions = row.sessions;
    byDay.set(row.day, entry);
  }
  const from = new Date(analytics.from);
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const today = new Date();
  const last = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayList = Array.from({ length: Math.floor((last - first) / DAY_MS) + 1 }, (_, i) => new Date(first + i * DAY_MS).toISOString().slice(0, 10));

  return (
    <AdminPage
      title='Funnel'
      sub='From opening the site to signing up, in browser sessions. No account ids leave the server.'
      tools={<WindowTabs path='/admin/analytics' days={analytics.days} />}
    >
      <Stats label='Funnel headline'>
        <Stat label='started a game' value={fmtFigure(starts)} foot='sessions' />
        <Stat label='finished a game' value={fmtFigure(completions)} foot={`${fmtPct(starts ? completions / starts : null)} of starts`} />
        <Stat label='day 1 back' value={fmtPct(d1.rate == null ? null : d1.rate / 100)} foot={`${fmtInt(d1.retained)} of ${fmtInt(d1.eligible)} players`} />
        <Stat label='day 7 back' value={fmtPct(d7.rate == null ? null : d7.rate / 100)} foot={`${fmtInt(d7.retained)} of ${fmtInt(d7.eligible)} players`} />
        <Stat label='challenge yield' value={fmtPct(shares ? challengeOpens / shares : null)} foot={`${fmtInt(challengeOpens)} opens from ${fmtInt(shares)} sharing sessions`} />
      </Stats>

      <Panel title='Starts and finishes a day' sub='Distinct sessions per UTC day. The first and last days are partial.'>
        <TrendChart
          label='Game starts and finishes by day'
          days={dayList}
          series={[
            { name: 'started', values: dayList.map((day) => byDay.get(day)?.starts ?? 0), tone: 'ink', area: true },
            { name: 'finished', values: dayList.map((day) => byDay.get(day)?.completions ?? 0), tone: 'series-2' },
          ]}
          empty={<Empty title='No starts or finishes in this window.'>The browser sends these when a game starts and ends.</Empty>}
        />
      </Panel>

      <Grid cols='2'>
        <Panel title='Activation, in order' sub='Each step happened after the one before it, in the same browser session.'>
          <BarList
            label='Activation funnel'
            items={analytics.funnel.map((step, index) => ({
              key: step.event,
              label: `${index + 1}. ${EVENT_LABELS[step.event] ?? step.event}`,
              value: step.sessions,
              detail: index === 0 ? undefined : `${fmtPct(step.rateFromPrevious == null ? null : step.rateFromPrevious / 100)} of the step before`,
            }))}
          />
        </Panel>
        <Panel title='Sources' sub='Sessions that arrived with a source, by what they did.' flush>
          <DataTable
            caption='Sources'
            columns={[{ label: 'source' }, { label: 'did' }, { label: 'sessions', align: 'right' }]}
            rows={analytics.sources.map((entry) => ({
              key: `${entry.source}:${entry.event}`,
              cells: [entry.source.replaceAll('_', ' '), EVENT_LABELS[entry.event] ?? entry.event, fmtInt(entry.sessions)],
              sort: [entry.source, entry.event, entry.sessions],
            }))}
            sortBy={2}
            pageSize={25}
            emptyTitle='No sessions arrived with a source in this window.'
          />
        </Panel>
      </Grid>

      <Panel title='Finish rate by game' sub='Sessions that started a game, and how many of them finished it.' flush>
        <DataTable
          caption='Finish rate by game'
          filter='filter games'
          columns={[{ label: 'game' }, { label: 'started', align: 'right' }, { label: 'finished', align: 'right' }, { label: 'rate', align: 'right' }]}
          rows={analytics.games.map((game) => ({
            key: game.gameSlug,
            search: `${GAME_NAMES.get(game.gameSlug) ?? ''} ${game.gameSlug}`,
            cells: [GAME_NAMES.get(game.gameSlug) ?? game.gameSlug, fmtInt(game.starts), fmtInt(game.completions), fmtPct(game.completionRate == null ? null : game.completionRate / 100)],
            sort: [GAME_NAMES.get(game.gameSlug) ?? game.gameSlug, game.starts, game.completions, game.completionRate],
          }))}
          sortBy={1}
          emptyTitle='No games started in this window.'
        />
      </Panel>
    </AdminPage>
  );
}
