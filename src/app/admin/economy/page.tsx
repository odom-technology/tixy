import Link from 'next/link';

import { BarList } from '@/features/admin/ui/bar-list';
import { ColumnChart, FlowChart } from '@/features/admin/ui/charts';
import { DataTable } from '@/features/admin/ui/data-table';
import { fmtFigure, fmtInt, fmtPct, fmtSignedFigure } from '@/features/admin/ui/format';
import { GameName, KpiStat, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Delta, Empty, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getEconomyMetrics } from '@/server/admin/metrics';
import type { LedgerBucket } from '@/server/admin/metrics/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Economy | tixy admin' };

const BUCKET_LABEL: Record<LedgerBucket, string> = {
  game_rewards: 'game rewards',
  daily_claim: 'daily claim',
  quests: 'quests',
  season: 'season tiers',
  levels: 'level milestones',
  achievements: 'achievements',
  monthly_boards: 'monthly boards',
  weekly_boards: 'weekly boards',
  wager_payouts: 'machine payouts',
  admin: 'admin adjustments',
  refunds: 'refunds',
  other_in: 'other',
  counter: 'counter purchases',
  wager_stakes: 'machine stakes',
  continues: 'continues',
  other_out: 'other',
};

export default async function AdminEconomyPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/economy');
  const days = parseDays((await searchParams).days);
  const metrics = await getEconomyMetrics(days).catch((error: Error) => {
    console.error('[admin] economy metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Economy'><Note tone='alert'>The economy metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const { dailyCap, balances, bought, dailySpin } = metrics;
  const capRate = dailyCap.earningDays ? dailyCap.cappedDays / dailyCap.earningDays : null;

  return (
    <AdminPage
      title='Economy'
      sub='Earned tickets in and out, and where they sit.'
      tools={<><WindowTools path='/admin/economy' window={metrics.window} /><Link href='/admin/db/economy?tab=ledger' className='adm-btn'>ledger</Link></>}
    >
      <Stats label='Ticket supply'>
        <KpiStat label='minted' kpi={metrics.minted} tickets good='neither' title='Earned tickets created: rewards, claims, quests, season, levels, boards, machine payouts, refunds, positive admin adjustments.' />
        <KpiStat label='spent' kpi={metrics.spent} tickets good='neither' title='Earned tickets destroyed: counter purchases, machine stakes net of refunds, continues, negative admin adjustments.' />
        <KpiStat label='net' kpi={metrics.net} tickets good='neither' format={fmtSignedFigure} title='Minted minus spent. The change in total wallet balances over the window.' />
        <Stat label='in wallets' value={fmtFigure(metrics.supply)} tickets foot={`${fmtInt(metrics.holders)} holders`} />
        <Stat label='daily cap hit' value={fmtPct(capRate)} foot={`${fmtInt(dailyCap.cappedPlayers)} players hit it`} title={`Player-game-days that reached the ${dailyCap.cap} cap, of days that earned anything.`} />
      </Stats>

      <Panel title='Minted and spent a day' sub='Earned tickets only. Bought tickets have their own panel below.'>
        <FlowChart label='Earned tickets minted and spent by day' days={metrics.daily.map((d) => d.day)} inflow={metrics.daily.map((d) => d.minted)} outflow={metrics.daily.map((d) => d.spent)} />
      </Panel>

      <Grid cols='2'>
        <Panel title='Where tickets come from' sub='Window total, change against the previous window, and player-days (one per player per day).'>
          {metrics.sources.length ? (
            <BarList
              tone='ticket'
              label='Ticket sources'
              items={metrics.sources.map((row) => ({
                key: row.bucket,
                label: BUCKET_LABEL[row.bucket],
                value: row.amount,
                detail: <><Delta value={row.amount} previous={row.previous} good='neither' /> · {fmtInt(row.users)} player-days</>,
              }))}
            />
          ) : <Empty title='No tickets minted in this window.' />}
        </Panel>
        <Panel title='Where tickets go' sub='Machine stakes are net of refunded stakes.'>
          {metrics.sinks.length ? (
            <BarList
              label='Ticket sinks'
              items={metrics.sinks.map((row) => ({
                key: row.bucket,
                label: BUCKET_LABEL[row.bucket],
                value: row.amount,
                detail: <><Delta value={row.amount} previous={row.previous} good='neither' /> · {fmtInt(row.users)} player-days</>,
              }))}
            />
          ) : <Empty title='No tickets spent in this window.' />}
        </Panel>
      </Grid>

      <Grid cols='2'>
        <Panel title='Balances' sub='Earned tickets held by accounts now.'>
          <ColumnChart
            label='Accounts by balance band'
            labels={balances.buckets.map((b) => b.label)}
            values={balances.buckets.map((b) => b.players)}
            xTitle='balance'
            height={150}
          />
          <dl className='adm-dl' style={{ marginTop: 12 }}>
            <dt>median</dt><dd className='num'>{fmtInt(balances.median)}</dd>
            <dt>90th percentile</dt><dd className='num'>{fmtInt(balances.p90)}</dd>
            <dt>99th percentile</dt><dd className='num'>{fmtInt(balances.p99)}</dd>
            <dt>top 1% hold</dt><dd className='num'>{fmtPct(balances.top1Share)} of all tickets</dd>
          </dl>
        </Panel>
        <Panel title='Daily cap' sub={`A player can earn ${fmtInt(dailyCap.cap)} tickets a day per game. Days count once per player and game.`} flush>
          <DataTable
            caption='Daily cap by game'
            columns={[{ label: 'game' }, { label: 'earning days', align: 'right' }, { label: 'at the cap', align: 'right' }, { label: 'rate', align: 'right' }]}
            rows={dailyCap.byGame.map((row) => ({
              key: row.game.key,
              cells: [<GameName key='g' game={row.game} />, fmtInt(row.earningDays), fmtInt(row.cappedDays), fmtPct(row.earningDays ? row.cappedDays / row.earningDays : null)],
              sort: [row.game.title, row.earningDays, row.cappedDays, row.earningDays ? row.cappedDays / row.earningDays : null],
            }))}
            sortBy={2}
            pageSize={25}
            emptyTitle='Nobody earned game rewards in this window.'
          />
        </Panel>
      </Grid>

      <Panel
        title='Daily spin'
        sub={`${fmtInt(dailySpin.spins)} spins paid ${fmtInt(dailySpin.paid)} tickets. The ladder they stand for is ${fmtInt(dailySpin.expected)}.`}
        flush
      >
        <DataTable
          caption='Daily spins by slot'
          columns={[{ label: 'slot', align: 'right' }, { label: 'chance', align: 'right' }, { label: 'spins', align: 'right' }, { label: 'share', align: 'right' }, { label: 'paid', align: 'right' }]}
          rows={dailySpin.bySlot.map((row) => ({
            key: String(row.value),
            cells: [fmtInt(row.value), fmtPct(row.chance), fmtInt(row.spins), fmtPct(dailySpin.spins ? row.spins / dailySpin.spins : null), fmtInt(row.paid)],
            sort: [row.value, row.chance, row.spins, dailySpin.spins ? row.spins / dailySpin.spins : null, row.paid],
          }))}
          sortBy={0}
          pageSize={10}
          emptyTitle='Nobody spun in this window.'
        />
      </Panel>

      <Panel title='Bought tickets' sub='Tickets from Stripe packs and ad rewards. They are spent only at the counter and never on machines.'>
        <Stats label='Bought tickets'>
          <Stat label='from packs' value={fmtFigure(bought.granted)} tickets />
          <Stat label='from ads' value={fmtFigure(bought.adRewards)} tickets />
          <Stat label='spent' value={fmtFigure(bought.spent)} tickets />
          <Stat label='reversed' value={fmtFigure(bought.reversed)} foot='refunds and disputes' />
          <Stat label='in wallets' value={fmtFigure(bought.supply)} tickets />
        </Stats>
      </Panel>
    </AdminPage>
  );
}
