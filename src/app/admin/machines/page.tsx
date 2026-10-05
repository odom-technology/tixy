import { TrendChart } from '@/features/admin/ui/charts';
import { DataTable, type Row } from '@/features/admin/ui/data-table';
import { fmtFigure, fmtInt, fmtPct, fmtSigned, fmtSignedFigure, fmtTime } from '@/features/admin/ui/format';
import { GameName, PlayerLink, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Delta, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getMachinesMetrics } from '@/server/admin/metrics';
import type { MachineRow } from '@/server/admin/metrics/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machines | tixy admin' };

const COLUMNS = [
  { label: 'machine' },
  { label: 'rounds', align: 'right' as const },
  { label: 'vs previous', align: 'right' as const },
  { label: 'players', align: 'right' as const },
  { label: 'wagered', align: 'right' as const },
  { label: 'paid', align: 'right' as const },
  { label: 'actual return', align: 'right' as const },
  { label: 'set return', align: 'right' as const },
  { label: 'gap', align: 'right' as const, title: 'Actual minus set, in percentage points' },
  { label: 'z', align: 'right' as const, title: 'How unusual the gap is for this many rounds. Past 3 either way is worth a look.' },
  { label: 'house net', align: 'right' as const },
  { label: 'biggest win', align: 'right' as const },
];

function rows(list: MachineRow[]): Row[] {
  return list.map((row) => {
    const gap = row.actualRtp == null ? null : (row.actualRtp - row.configuredRtp) * 100;
    const odd = row.z != null && Math.abs(row.z) > 3;
    return {
      key: row.game.key,
      search: `${row.game.title} ${row.game.key}`,
      cells: [
        <GameName key='g' game={row.game} />,
        fmtInt(row.rounds),
        <Delta key='d' value={row.rounds} previous={row.previousRounds} />,
        fmtInt(row.players),
        fmtInt(row.wagered),
        fmtInt(row.paid),
        fmtPct(row.actualRtp, 2),
        fmtPct(row.configuredRtp, 2),
        gap == null ? 'n/a' : Math.abs(gap) < 0.005 ? '0.00' : `${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)}`,
        row.z == null ? 'n/a' : Math.abs(row.z) < 0.05 ? '0.0' : `${row.z > 0 ? '+' : '−'}${Math.abs(row.z).toFixed(1)}`,
        fmtSigned(row.houseNet),
        fmtInt(row.biggestWin),
      ],
      sort: [row.game.title, row.rounds, row.previousRounds ? (row.rounds - row.previousRounds) / row.previousRounds : null, row.players, row.wagered, row.paid, row.actualRtp, row.configuredRtp, gap, row.z == null ? null : Math.abs(row.z), row.houseNet, row.biggestWin],
      muted: [7, ...(row.z == null ? [9] : [])],
      alert: odd ? [6, 8, 9] : [],
    };
  });
}

export default async function AdminMachinesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/machines');
  const days = parseDays((await searchParams).days);
  const metrics = await getMachinesMetrics(days).catch((error: Error) => {
    console.error('[admin] machine metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Machines'><Note tone='alert'>The machine metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const { totals } = metrics;
  const odd = [...metrics.floor, ...metrics.offFloor].filter((row) => row.z != null && Math.abs(row.z) > 3);

  return (
    <AdminPage title='Machines' sub='Volume and return to player, against what each machine is set to pay.' tools={<WindowTools path='/admin/machines' window={metrics.window} />}>
      {odd.length ? (
        <Note tone='alert'>
          {odd.map((row) => row.game.title).join(', ')} {odd.length === 1 ? 'is' : 'are'} paying further from the set return than chance explains (|z| over 3). Check the payout table and the RTP verifier.
        </Note>
      ) : null}
      <Stats label='Machines in the window'>
        <Stat label='rounds' value={fmtFigure(totals.rounds)} />
        <Stat label='wagered' value={fmtFigure(totals.wagered)} tickets />
        <Stat label='paid out' value={fmtFigure(totals.paid)} tickets />
        <Stat label='actual return' value={fmtPct(totals.actualRtp, 2)} foot='paid ÷ wagered, all machines' />
        <Stat label='house net' value={fmtSignedFigure(totals.wagered - totals.paid)} tickets foot='wagered minus paid' />
      </Stats>

      <Panel title='Wagered and paid a day'>
        <TrendChart
          label='Tickets wagered and paid by day'
          days={metrics.daily.map((d) => d.day)}
          series={[
            { name: 'wagered', values: metrics.daily.map((d) => d.wagered), tone: 'ticket', area: true },
            { name: 'paid', values: metrics.daily.map((d) => d.paid), tone: 'ink-2' },
          ]}
        />
      </Panel>

      <Panel title='On the floor' sub='Set return is the engine constant, or the documented theoretical return where the edge sits in the pay table. A small machine drifts a lot; read the gap with z.' flush>
        <DataTable caption='Floor machines' columns={COLUMNS} rows={rows(metrics.floor)} paged={false} />
      </Panel>

      <Panel title='Off the floor' flush>
        <DataTable caption='Machines off the floor' columns={COLUMNS} rows={rows(metrics.offFloor)} sortBy={1} emptyTitle='No rounds off the floor in this window.' />
      </Panel>

      <Panel title='Biggest wins' sub='Payout minus wager, the ten largest rounds in the window.' flush>
        <DataTable
          caption='Biggest wins'
          columns={[{ label: 'when' }, { label: 'machine' }, { label: 'player' }, { label: 'wager', align: 'right' }, { label: 'payout', align: 'right' }, { label: 'multiplier', align: 'right' }, { label: 'won', align: 'right' }]}
          rows={metrics.biggestWins.map((win) => ({
            key: win.id,
            cells: [fmtTime(win.at), <GameName key='g' game={win.game} />, <PlayerLink key='p' id={win.userId} name={win.username} />, fmtInt(win.wager), fmtInt(win.payout), `${win.multiplier.toFixed(2)}×`, fmtInt(win.payout - win.wager)],
            sort: [win.at, win.game.title, win.username, win.wager, win.payout, win.multiplier, win.payout - win.wager],
            muted: [0],
          }))}
          paged={false}
          emptyTitle='No winning rounds in this window.'
        />
      </Panel>
    </AdminPage>
  );
}
