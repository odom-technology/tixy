import { getGamePlacement } from '@/features/arcade/components/arcade-game-registry';
import { Meter } from '@/features/admin/ui/bar-list';
import { Spark } from '@/features/admin/ui/charts';
import { DataTable, type Row } from '@/features/admin/ui/data-table';
import { fmtDuration, fmtFigure, fmtHours, fmtInt, fmtPct } from '@/features/admin/ui/format';
import { GROUP_LABEL, GameName, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Delta, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getGamesMetrics } from '@/server/admin/metrics';
import type { GameRow } from '@/server/admin/metrics/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Games | tixy admin' };

const COLUMNS = [
  { label: 'game' },
  { label: 'group', title: 'Floor group, or where an off-floor game sits' },
  { label: 'runs', align: 'right' as const },
  { label: 'trend', sortable: false },
  { label: 'vs previous', align: 'right' as const },
  { label: 'share of runs', align: 'right' as const },
  { label: 'players', align: 'right' as const },
  { label: 'starts', align: 'right' as const, title: 'Browser sessions that started the game' },
  { label: 'finished', align: 'right' as const, title: 'Finishes ÷ starts' },
  { label: 'average run', align: 'right' as const },
  { label: 'play time', align: 'right' as const },
];

const STATUS_LABEL: Record<string, string> = { reserve: 'reserve', retired: 'retired', merged: 'merged', later: 'later' };

function rows(list: GameRow[]): Row[] {
  const maxShare = Math.max(0.0001, ...list.map((row) => row.shareOfRuns));
  return list.map((row) => ({
    key: row.game.key,
    search: `${row.game.title} ${row.game.key} ${row.game.slug ?? ''}`,
    cells: [
      <GameName key='g' game={row.game} />,
      row.game.group ? GROUP_LABEL[row.game.group] ?? row.game.group : STATUS_LABEL[(row.game.slug && getGamePlacement(row.game.slug)?.status) || ''] ?? 'unlisted',
      fmtInt(row.runs),
      <Spark key='s' values={row.runsSeries} />,
      <Delta key='d' value={row.runs} previous={row.previousRuns} />,
      <span key='sh' style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{fmtPct(row.shareOfRuns)} <Meter ratio={row.shareOfRuns / maxShare} /></span>,
      fmtInt(row.players),
      fmtInt(row.starts),
      fmtPct(row.finishRate),
      row.avgRunMs == null ? 'n/a' : fmtDuration(row.avgRunMs),
      row.playMs ? fmtHours(row.playMs) : 'n/a',
    ],
    sort: [
      row.game.title,
      row.game.group ?? 'zz',
      row.runs,
      null,
      row.previousRuns ? (row.runs - row.previousRuns) / row.previousRuns : null,
      row.shareOfRuns,
      row.players,
      row.starts,
      row.finishRate,
      row.avgRunMs,
      row.playMs,
    ],
    muted: [1, ...(row.avgRunMs == null ? [9] : []), ...(row.playMs ? [] : [10])],
  }));
}

export default async function AdminGamesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/games');
  const days = parseDays((await searchParams).days);
  const metrics = await getGamesMetrics(days).catch((error: Error) => {
    console.error('[admin] games metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Games'><Note tone='alert'>The game metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const { totals } = metrics;
  const floorRuns = metrics.floor.reduce((sum, row) => sum + row.runs, 0);

  return (
    <AdminPage title='Games' sub='Plays per game, floor first.' tools={<WindowTools path='/admin/games' window={metrics.window} />}>
      <Stats label='Play in the window'>
        <Stat label='runs' value={fmtFigure(totals.runs)} foot={`${fmtPct(totals.runs ? floorRuns / totals.runs : null)} on the floor`} />
        <Stat label='players' value={fmtFigure(totals.players)} />
        <Stat label='play time' value={fmtHours(totals.playMs)} foot='from games that record time' />
        <Stat label='starts' value={fmtFigure(totals.starts)} foot='browser sessions' />
        <Stat label='finished' value={fmtPct(totals.starts ? totals.finishes / totals.starts : null)} foot={`${fmtInt(totals.finishes)} of ${fmtInt(totals.starts)} starts`} />
      </Stats>

      <Panel
        title='On the floor'
        sub='Runs are what the server recorded: finished scored runs, machine rounds, completed matches. Starts and finishes come from the browser, one per session per day. Machines record no run time.'
        flush
      >
        <DataTable caption='Floor games' columns={COLUMNS} rows={rows(metrics.floor)} paged={false} filter='filter games' />
      </Panel>

      <Panel title='Off the floor' sub='Reserve, retired and merged games that still saw play.' flush>
        <DataTable caption='Games off the floor' columns={COLUMNS} rows={rows(metrics.offFloor)} sortBy={2} pageSize={25} filter='filter games' emptyTitle='No play off the floor in this window.' />
      </Panel>
    </AdminPage>
  );
}
