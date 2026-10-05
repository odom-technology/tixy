import { ColumnChart, TrendChart } from '@/features/admin/ui/charts';
import { DataTable } from '@/features/admin/ui/data-table';
import { fmtInt, fmtPct } from '@/features/admin/ui/format';
import { KpiStat, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Empty, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getProgressionMetrics } from '@/server/admin/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progression | tixy admin' };

const KIND_LABEL: Record<string, string> = {
  play_any: 'play any game',
  play_game: 'play a game',
  earn_tickets: 'earn tickets',
  score_game: 'score in a game',
  win_game: 'win a game',
};

export default async function AdminProgressionPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/progression');
  const days = parseDays((await searchParams).days);
  const metrics = await getProgressionMetrics(days).catch((error: Error) => {
    console.error('[admin] progression metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Progression'><Note tone='alert'>The progression metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const { quests, season, achievements } = metrics;
  const daily = quests.daily;
  const totalLevelled = metrics.levelBands.reduce((sum, band) => sum + band.players, 0);
  const questRows = [
    { key: 'daily', label: 'daily', ...quests.daily },
    { key: 'weekly', label: 'weekly', ...quests.weekly },
    { key: 'season', label: season ? `season (${season.name})` : 'season', ...quests.season },
  ];

  return (
    <AdminPage title='Progression' sub='Levels, the season card, quests and achievements.' tools={<WindowTools path='/admin/progression' window={metrics.window} />}>
      <Stats label='Progression'>
        <Stat label='median level' value={fmtInt(metrics.medianLevel)} foot={`${fmtInt(totalLevelled)} players with XP`} />
        <Stat label='daily quests done' value={fmtPct(daily.assigned ? daily.completed / daily.assigned : null)} foot={`${fmtInt(daily.completed)} of ${fmtInt(daily.assigned)}`} />
        <Stat label='done and claimed' value={fmtPct(daily.completed ? daily.claimed / daily.completed : null)} foot={`${fmtInt(daily.claimed)} claimed`} />
        <Stat label='rerolled' value={fmtPct(quests.rerolls.playerDays ? quests.rerolls.rerollDays / quests.rerolls.playerDays : null)} foot={`${fmtInt(quests.rerolls.rerolls)} rerolls on ${fmtInt(quests.rerolls.playerDays)} quest days`} />
        <KpiStat label='achievements earned' kpi={achievements.unlocked} />
        <Stat label='season premium' value={season ? fmtInt(season.premium) : 'n/a'} foot={season ? season.name : 'No season running'} />
      </Stats>

      <Grid cols='2'>
        <Panel title='Levels' sub='Every player with account XP, by the level that XP reaches.'>
          {metrics.levels.length ? (
            <>
              <ColumnChart label='Players by level' labels={metrics.levels.map((l) => String(l.level))} values={metrics.levels.map((l) => l.players)} xTitle='level' height={150} />
              <dl className='adm-dl' style={{ marginTop: 10 }}>
                {metrics.levelBands.map((band) => (
                  <div key={band.label} style={{ display: 'contents' }}>
                    <dt>level {band.label}</dt>
                    <dd className='num'>{fmtInt(band.players)} ({fmtPct(totalLevelled ? band.players / totalLevelled : null)})</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : <Empty title='Nobody has account XP yet.' />}
        </Panel>
        <Panel title={season ? `Season card: ${season.name}` : 'Season card'} sub={season ? `Players with season XP, by the tier it reaches, of ${season.tiers}.` : undefined}>
          {season && season.distribution.length ? (
            <ColumnChart label='Players by season tier' labels={season.distribution.map((t) => String(t.tier))} values={season.distribution.map((t) => t.players)} xTitle='tier' height={150} />
          ) : (
            <Empty title={season ? 'Nobody has season XP yet.' : 'No season is running.'} />
          )}
        </Panel>
      </Grid>

      <Grid cols='2'>
        <Panel title='Quests' sub='Daily quests assigned in the window, weekly quests created in it, and the current season’s quests.' flush>
          <DataTable
            caption='Quest completion'
            columns={[{ label: 'quests' }, { label: 'assigned', align: 'right' }, { label: 'done', align: 'right' }, { label: 'done rate', align: 'right' }, { label: 'claimed', align: 'right' }, { label: 'claim rate', align: 'right' }]}
            rows={questRows.map((row) => ({
              key: row.key,
              cells: [row.label, fmtInt(row.assigned), fmtInt(row.completed), fmtPct(row.assigned ? row.completed / row.assigned : null), fmtInt(row.claimed), fmtPct(row.completed ? row.claimed / row.completed : null)],
            }))}
            paged={false}
          />
          <div style={{ height: 8 }} />
          <DataTable
            caption='Daily quests by kind'
            columns={[{ label: 'daily kind' }, { label: 'assigned', align: 'right' }, { label: 'done', align: 'right' }, { label: 'done rate', align: 'right' }]}
            rows={quests.byKind.map((row) => ({
              key: row.kind,
              cells: [KIND_LABEL[row.kind] ?? row.kind.replaceAll('_', ' '), fmtInt(row.assigned), fmtInt(row.completed), fmtPct(row.assigned ? row.completed / row.assigned : null)],
              sort: [row.kind, row.assigned, row.completed, row.assigned ? row.completed / row.assigned : null],
            }))}
            sortBy={3}
            sortDir='asc'
            paged={false}
            emptyTitle='No daily quests in this window.'
          />
        </Panel>
        <Panel title='Achievements' sub='Unlocks a day, and the most held.'>
          <TrendChart label='Achievements unlocked by day' days={achievements.daily.map((d) => d.day)} series={[{ name: 'unlocked', values: achievements.daily.map((d) => d.value), tone: 'ink-2' }]} height={130} />
          <div style={{ margin: '10px -16px 0' }}>
            <DataTable
              caption='Most held achievements'
              columns={[{ label: 'achievement' }, { label: 'holders', align: 'right' }, { label: 'in window', align: 'right' }]}
              rows={achievements.top.map((row) => ({
                key: row.id,
                cells: [<span key='n' title={row.id}>{row.name}</span>, fmtInt(row.holders), fmtInt(row.unlockedInWindow)],
                sort: [row.name, row.holders, row.unlockedInWindow],
              }))}
              paged={false}
              emptyTitle='No achievements earned yet.'
            />
          </div>
        </Panel>
      </Grid>
    </AdminPage>
  );
}
