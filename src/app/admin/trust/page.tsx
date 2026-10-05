import { TrendChart } from '@/features/admin/ui/charts';
import { DataTable } from '@/features/admin/ui/data-table';
import { fmtAgo, fmtFigure, fmtInt, fmtPct, fmtTime } from '@/features/admin/ui/format';
import { GameName, KpiStat, PlayerLink, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getTrustMetrics } from '@/server/admin/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trust | tixy admin' };

const RULE_LABEL: Record<string, string> = {
  'signin:id': 'sign-in, per account',
  'signin:ip': 'sign-in, per address',
  'register:ip': 'sign-up, per address',
  'recover:id': 'password reset, per account',
  'recover:ip': 'password reset, per address',
  'read:home-live': 'home live reads',
  'read:admin': 'admin console',
};

export default async function AdminTrustPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/trust');
  const days = parseDays((await searchParams).days);
  const metrics = await getTrustMetrics(days).catch((error: Error) => {
    console.error('[admin] trust metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Trust'><Note tone='alert'>The trust metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const rateHits = metrics.rateLimits.rules.reduce((sum, rule) => sum + rule.hits, 0);
  const checked = metrics.passes.value + metrics.flags.value + metrics.rejects.value;

  return (
    <AdminPage title='Trust' sub='Anti-cheat results, bans and rate limits.' tools={<WindowTools path='/admin/trust' window={metrics.window} />}>
      <Stats label='Trust'>
        <KpiStat label='flagged runs' kpi={metrics.flags} good='down' title='Runs the anti-cheat let through but marked for review.' />
        <KpiStat label='rejected runs' kpi={metrics.rejects} good='down' title='Runs the anti-cheat refused. No tickets paid.' />
        <Stat label='reject rate' value={metrics.passes.value ? fmtPct(metrics.rejects.value / checked, 2) : 'n/a'} foot={metrics.passes.value ? `of ${fmtFigure(checked)} checked runs` : 'Passes are not logged here'} />
        <Stat label='game bans' value={fmtInt(metrics.bans.activeGameBans)} foot={`${fmtInt(metrics.bans.issuedInWindow)} issued in the window`} />
        <Stat label='suspended accounts' value={fmtInt(metrics.bans.suspendedAccounts)} />
        <Stat label='rate limited' value={fmtFigure(rateHits)} foot={`since ${fmtTime(metrics.rateLimits.since)} UTC`} />
      </Stats>

      <Note>
        The server keeps {metrics.logRetentionDays} days of anti-cheat log; older days come from the nightly rollup, so counts reach back further than the list of runs.
        {metrics.passes.value ? '' : ' Passing runs are only logged when ANTI_CHEAT_LOG_PASSES is on, so there is no reject rate.'}
      </Note>

      <Panel title='Flags and rejects a day'>
        <TrendChart
          label='Flagged and rejected runs by day'
          days={metrics.daily.map((d) => d.day)}
          series={[
            { name: 'rejected', values: metrics.daily.map((d) => d.reject), tone: 'red' },
            { name: 'flagged', values: metrics.daily.map((d) => d.flag), tone: 'ink-2' },
          ]}
          height={160}
        />
      </Panel>

      <Panel title='By game' flush>
        <DataTable
          caption='Anti-cheat results by game'
          columns={[{ label: 'game' }, { label: 'flagged', align: 'right' }, { label: 'rejected', align: 'right' }, { label: 'passed', align: 'right' }, { label: 'players', align: 'right' }]}
          rows={metrics.byGame.map((row) => ({
            key: row.game.key,
            cells: [<GameName key='g' game={row.game} />, fmtInt(row.flag), fmtInt(row.reject), fmtInt(row.pass), fmtInt(row.players)],
            sort: [row.game.title, row.flag, row.reject, row.pass, row.players],
            alert: row.reject ? [2] : [],
          }))}
          sortBy={2}
          pageSize={25}
          emptyTitle='No anti-cheat results in this window.'
        />
      </Panel>

      <Panel title='Latest flags and rejects' sub={`Newest first, from the last ${metrics.logRetentionDays} days.`} flush>
        <DataTable
          caption='Latest flags and rejects'
          filter='filter by game, player or reason'
          columns={[{ label: 'when' }, { label: 'game' }, { label: 'player' }, { label: 'result' }, { label: 'reason' }, { label: 'score', align: 'right' }]}
          rows={metrics.recent.map((row) => ({
            key: row.id,
            search: `${row.game.title} ${row.username ?? ''} ${row.reason ?? ''} ${row.result}`,
            cells: [fmtTime(row.at), <GameName key='g' game={row.game} />, <PlayerLink key='p' id={row.userId} name={row.username} />, row.result === 'reject' ? 'rejected' : 'flagged', row.reason ?? 'n/a', fmtInt(row.score)],
            sort: [row.at, row.game.title, row.username, row.result, row.reason, row.score],
            alert: row.result === 'reject' ? [3] : [],
            muted: [0],
            wrap: [4],
          }))}
          sortBy={0}
          emptyTitle='No flags or rejects in the log.'
        />
      </Panel>

      <Grid cols='2'>
        <Panel title='Recent game bans' flush>
          <DataTable
            caption='Recent game bans'
            columns={[{ label: 'player' }, { label: 'banned' }, { label: 'until' }, { label: 'reason' }]}
            rows={metrics.bans.recent.map((ban) => ({
              key: `${ban.userId}:${ban.bannedAt}`,
              cells: [
                <PlayerLink key='p' id={ban.userId} name={ban.username} />,
                fmtAgo(ban.bannedAt),
                ban.indefinite ? 'indefinite' : ban.until ? (ban.until > Date.now() ? fmtTime(ban.until) : 'ended') : 'n/a',
                ban.reason ?? 'n/a',
              ],
              sort: [ban.username, ban.bannedAt, ban.indefinite ? Number.MAX_SAFE_INTEGER : ban.until, ban.reason],
              muted: [1],
              wrap: [3],
            }))}
            paged={false}
            emptyTitle='No game bans.'
          />
        </Panel>
        <Panel title='Rate limits' sub={`Requests refused since the server started at ${fmtTime(metrics.rateLimits.since)} UTC. Counted in memory, so a restart clears them.`} flush>
          <DataTable
            caption='Rate limit hits'
            columns={[{ label: 'limit' }, { label: 'refused', align: 'right' }]}
            rows={metrics.rateLimits.rules.map((rule) => ({
              key: rule.rule,
              cells: [RULE_LABEL[rule.rule] ?? rule.rule, fmtInt(rule.hits)],
              sort: [rule.rule, rule.hits],
            }))}
            sortBy={1}
            paged={false}
            emptyTitle='Nothing rate limited since the server started.'
          />
        </Panel>
      </Grid>
    </AdminPage>
  );
}
