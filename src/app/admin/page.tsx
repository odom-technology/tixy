import Link from 'next/link';

import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { BarList } from '@/features/admin/ui/bar-list';
import { TrendChart } from '@/features/admin/ui/charts';
import { fmtFigure, fmtMoney, fmtPct } from '@/features/admin/ui/format';
import { KpiStat, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Empty, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { SITE_SECTIONS } from '@/lib/site-availability';
import { requireAdminPage } from '@/server/admin/guard';
import { getOverviewMetrics } from '@/server/admin/metrics';
import { listFeedback } from '@/server/feedback';
import { getMaintenanceModeSettings, getMaintenanceModeStatusForRoles, getWarningBannerSettings, getSiteAvailabilitySettings } from '@/server/site-settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview | tixy admin' };

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const identity = await requireAdminPage('/admin');
  const days = parseDays((await searchParams).days);
  const [metrics, feedback, banner, maintenance, availability] = await Promise.all([
    getOverviewMetrics(days).catch((error: Error) => {
      console.error('[admin] overview metrics failed', error.message);
      return null;
    }),
    listFeedback({ status: 'open', category: 'all', limit: 200 }).catch(() => null),
    getWarningBannerSettings().catch(() => null),
    getMaintenanceModeSettings().catch(() => null),
    getSiteAvailabilitySettings().catch(() => null),
  ]);
  const mode = maintenance ? getMaintenanceModeStatusForRoles({ config: maintenance.config, roles: identity.roles }) : null;
  const config = availability?.config;
  const closed = config ? SITE_SECTIONS.filter(({ id }) => !config.sections[id]) : [];
  const paused = config?.disabledGames.length ?? 0;
  const siteIssues = [
    mode?.isActive ? `maintenance is ${mode.phase}` : null,
    closed.length ? `${closed.map(({ label }) => label.toLowerCase()).join(', ')} closed` : null,
    config && !config.registrationEnabled ? 'registration closed' : null,
    paused ? `${paused} game${paused === 1 ? '' : 's'} paused` : null,
    banner?.config.enabled ? 'banner showing' : null,
  ].filter(Boolean);

  if (!metrics) {
    return (
      <AdminPage title='Overview'>
        <Note tone='alert'>The metrics did not load. The server log has the error; reload to retry.</Note>
      </AdminPage>
    );
  }

  const usd = metrics.revenue.find((entry) => entry.currency === 'usd') ?? metrics.revenue[0];
  const dayList = metrics.activeSeries.map((point) => point.day);

  return (
    <AdminPage title='Overview' sub={`The last ${metrics.window.days} days, against the ${metrics.window.days} before.`} tools={<WindowTools path='/admin' window={metrics.window} />}>
      {siteIssues.length ? (
        <Note tone='alert'>
          <span>Site: {siteIssues.join('; ')}.</span>
          <Link href='/admin/site-settings' style={{ marginLeft: 'auto', textDecoration: 'underline' }}>site settings</Link>
        </Note>
      ) : null}

      <Stats label='Headline numbers'>
        <Stat label='players today' value={fmtFigure(metrics.dauToday)} foot={<span>{fmtFigure(metrics.dauYesterday)} yesterday</span>} title='Distinct accounts and guests with a recorded run, round or match today (UTC).' />
        <KpiStat label='weekly players' kpi={metrics.wau} title='Distinct players over the last 7 days.' />
        <KpiStat label='monthly players' kpi={metrics.mau} title='Distinct players over the last 30 days.' />
        <KpiStat label='new players' kpi={metrics.newPlayers} title='Players whose first recorded day falls in the window.' />
        <KpiStat label='runs' kpi={metrics.runs} />
        <KpiStat label='tickets minted' kpi={metrics.ticketsMinted} tickets good='neither' />
        {usd && (usd.cents.value > 0 || (usd.cents.previous ?? 0) > 0) ? <KpiStat label='pack revenue' kpi={usd.cents} format={(cents) => fmtMoney(cents, usd.currency)} /> : <Stat label='pack revenue' value='none' foot='No pack purchases recorded' />}
        <KpiStat label='flagged runs' kpi={metrics.flags} good='down' title='Anti-cheat flags and rejects.' />
      </Stats>

      <Grid cols='2-1'>
        <Panel title='Players a day' sub='Distinct accounts and guests with a recorded run, round or match, by UTC day.'>
          <TrendChart label='Players a day' days={dayList} series={[{ name: 'players', values: metrics.activeSeries.map((p) => p.value), tone: 'ink', area: true }]} />
        </Panel>
        <Panel title='Top games' sub='By runs in the window.' tools={<Link href={`/admin/games?days=${days}`} className='adm-btn' data-size='sm'>all games</Link>}>
          {metrics.topGames.length ? (
            <BarList
              label='Top games by runs'
              items={metrics.topGames.map((row) => ({ key: row.game.key, label: row.game.title, value: row.runs, detail: fmtPct(row.share) }))}
            />
          ) : (
            <Empty title='No runs in this window.'>Runs, machine rounds and finished matches fill this list.</Empty>
          )}
        </Panel>
      </Grid>

      <Grid cols='2-1'>
        <Panel title='Runs a day' sub='Finished scored runs, machine rounds and completed matches.'>
          <TrendChart label='Runs a day' days={dayList} series={[{ name: 'runs', values: metrics.runsSeries.map((p) => p.value), tone: 'ink-2' }]} />
        </Panel>
        <Panel title='Right now'>
          <dl className='adm-dl'>
            <dt>online</dt>
            <dd><Link href='/admin/live' style={{ textDecoration: 'underline' }}>{fmtFigure(metrics.onlineNow)} players</Link></dd>
            <dt>tickets spent</dt>
            <dd>{fmtFigure(metrics.ticketsSpent.value)} in the window</dd>
            <dt>open feedback</dt>
            <dd>{feedback ? <Link href='/admin/feedback' style={{ textDecoration: 'underline' }}>{feedback.length >= 200 ? '200 or more' : feedback.length} reports</Link> : 'did not load'}</dd>
            <dt>games playable</dt>
            <dd>{config ? `${config.sections.games ? ARCADE_GAMES.length - paused : 0} of ${ARCADE_GAMES.length}` : 'n/a'}</dd>
            <dt>registration</dt>
            <dd>{config ? (config.registrationEnabled ? 'open' : 'closed') : 'n/a'}</dd>
            <dt>ticket packs</dt>
            <dd>{config ? (config.ticketBundlesEnabled ? 'shown in the store' : 'hidden') : 'n/a'}</dd>
          </dl>
        </Panel>
      </Grid>
    </AdminPage>
  );
}
