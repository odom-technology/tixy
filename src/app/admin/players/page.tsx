import { TrendChart } from '@/features/admin/ui/charts';
import { fmtDay, fmtFigure, fmtInt, fmtPct } from '@/features/admin/ui/format';
import { KpiStat, WindowTools, heat, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Empty, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getPlayersMetrics } from '@/server/admin/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Players | tixy admin' };

function rate(part: { eligible: number; retained: number }) {
  return part.eligible ? part.retained / part.eligible : null;
}

export default async function AdminPlayersPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/players');
  const days = parseDays((await searchParams).days);
  const metrics = await getPlayersMetrics(days).catch((error: Error) => {
    console.error('[admin] players metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Players'><Note tone='alert'>The player metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const dayList = metrics.daily.map((d) => d.day);
  const guests = metrics.daily.reduce((sum, d) => sum + d.guests, 0);
  const accounts = metrics.daily.reduce((sum, d) => sum + d.accounts, 0);
  const signups = metrics.signups.reduce((sum, d) => sum + d.value, 0);

  return (
    <AdminPage title='Players' sub='Who plays, who is new and who comes back.' tools={<WindowTools path='/admin/players' window={metrics.window} />}>
      <Stats label='Active players'>
        <KpiStat label='players a day' kpi={metrics.dau} title='Mean of daily distinct players over the complete days in the window.' />
        <KpiStat label='weekly players' kpi={metrics.wau} />
        <KpiStat label='monthly players' kpi={metrics.mau} />
        <Stat label='stickiness' value={fmtPct(metrics.stickiness)} foot='players yesterday ÷ monthly' />
        <Stat label='day 1 back' value={fmtPct(rate(metrics.retention.d1))} foot={`${fmtInt(metrics.retention.d1.retained)} of ${fmtInt(metrics.retention.d1.eligible)} signups`} />
        <Stat label='day 7 back' value={fmtPct(rate(metrics.retention.d7))} foot={`${fmtInt(metrics.retention.d7.retained)} of ${fmtInt(metrics.retention.d7.eligible)} signups`} />
        <Stat label='day 30 back' value={fmtPct(rate(metrics.retention.d30))} foot={metrics.retention.d30.eligible ? `${fmtInt(metrics.retention.d30.retained)} of ${fmtInt(metrics.retention.d30.eligible)} signups` : 'No signup in this window is 30 days old'} />
      </Stats>

      <Panel title='New and returning' sub='A new player is one whose first recorded day is that day. Everyone else active that day is returning.'>
        <TrendChart
          label='Active, new and returning players by day'
          days={dayList}
          series={[
            { name: 'returning', values: metrics.daily.map((d) => d.returning), tone: 'ink', area: true },
            { name: 'new', values: metrics.daily.map((d) => d.newPlayers), tone: 'series-2' },
          ]}
        />
      </Panel>

      <Panel
        title='Retention by signup week'
        sub='Accounts grouped by the UTC week they signed up. Day N is the share active on exactly that day after signup; week N, the share active at least once that week. Blank cells have not happened yet.'
        flush
      >
        {metrics.cohorts.length ? (
          <div className='adm-table-wrap'>
            <table className='adm-table'>
              <caption className='adm-visually-hidden'>Retention by signup week</caption>
              <thead>
                <tr>
                  <th scope='col'>signup week</th>
                  <th scope='col' data-align='right'>accounts</th>
                  <th scope='col' data-align='right'>day 1</th>
                  <th scope='col' data-align='right'>day 7</th>
                  <th scope='col' data-align='right'>day 30</th>
                  {Array.from({ length: 8 }, (_, i) => <th key={i} scope='col' data-align='right'>week {i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {metrics.cohorts.map((cohort) => (
                  <tr key={cohort.week}>
                    <td>{fmtDay(cohort.week)}</td>
                    <td data-align='right'>{fmtInt(cohort.size)}</td>
                    {[cohort.d1, cohort.d7, cohort.d30, ...cohort.weeks].map((value, index) => (
                      <td key={index} data-align='right' style={cohort.size ? heat(value) : undefined}>
                        {value == null || !cohort.size ? '' : fmtPct(value, 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title='No signups in the last 12 weeks.'>Cohorts start the week the first account signs up.</Empty>
        )}
      </Panel>

      <Grid cols='2'>
        <Panel title='Signups a day' sub={`${fmtInt(signups)} accounts created in the window.`}>
          <TrendChart label='Signups by day' days={metrics.signups.map((d) => d.day)} series={[{ name: 'signups', values: metrics.signups.map((d) => d.value), tone: 'ink-2' }]} height={150} />
        </Panel>
        <Panel title='Accounts and guests' sub='Player-days in the window, split by whether the player had an account.'>
          <Stats label='Accounts and guests'>
            <Stat label='account days' value={fmtFigure(accounts)} foot={fmtPct(accounts + guests ? accounts / (accounts + guests) : null)} />
            <Stat label='guest days' value={fmtFigure(guests)} foot={fmtPct(accounts + guests ? guests / (accounts + guests) : null)} />
          </Stats>
          <TrendChart
            label='Accounts and guests by day'
            days={dayList}
            height={120}
            series={[
              { name: 'accounts', values: metrics.daily.map((d) => d.accounts), tone: 'ink' },
              { name: 'guests', values: metrics.daily.map((d) => d.guests), tone: 'series-2' },
            ]}
          />
        </Panel>
      </Grid>
    </AdminPage>
  );
}
