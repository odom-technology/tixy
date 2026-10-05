import Link from 'next/link';

import { ColumnChart } from '@/features/admin/ui/charts';
import { DataTable } from '@/features/admin/ui/data-table';
import { fmtDay, fmtInt, fmtMoney, fmtPct } from '@/features/admin/ui/format';
import { KpiStat, WindowTools, parseDays } from '@/features/admin/ui/metric-ui';
import { AdminPage, Empty, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { requireAdminPage } from '@/server/admin/guard';
import { getCounterMetrics } from '@/server/admin/metrics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Counter | tixy admin' };

export default async function AdminCounterPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage('/admin/counter');
  const days = parseDays((await searchParams).days);
  const metrics = await getCounterMetrics(days).catch((error: Error) => {
    console.error('[admin] counter metrics failed', error.message);
    return null;
  });
  if (!metrics) {
    return <AdminPage title='Counter'><Note tone='alert'>The counter metrics did not load. Reload to retry.</Note></AdminPage>;
  }
  const usd = metrics.revenue.find((entry) => entry.currency === 'usd') ?? metrics.revenue[0];
  const currency = usd?.currency ?? 'usd';
  const { conversion, checkoutFunnel: funnel } = metrics;

  // Packs only show what the Stripe webhook recorded; nothing here calls Stripe.
  const packsRecorded = metrics.packs.length > 0 || funnel.started > 0 || (usd?.cents.previous ?? 0) > 0;

  return (
    <AdminPage
      title='Counter'
      sub='What players buy at the counter, and any ticket packs recorded.'
      tools={<><WindowTools path='/admin/counter' window={metrics.window} /><Link href='/admin/skins' className='adm-btn'>catalog</Link></>}
    >
      <Stats label='Counter'>
        <KpiStat label='items bought' kpi={metrics.purchases} />
        <KpiStat label='buyers' kpi={metrics.buyers} />
        <KpiStat label='tickets spent' kpi={metrics.ticketsSpent} tickets good='neither' />
        <Stat
          label='bought an item'
          value={fmtPct(conversion.activeAccounts ? conversion.itemBuyers / conversion.activeAccounts : null)}
          foot={`${fmtInt(conversion.itemBuyers)} of ${fmtInt(conversion.activeAccounts)} active accounts`}
        />
        {packsRecorded && usd ? <KpiStat label='pack revenue' kpi={usd.cents} format={(cents) => fmtMoney(cents, currency)} /> : <Stat label='pack revenue' value='none' foot='No pack purchases recorded' />}
        {packsRecorded ? <KpiStat label='paying players' kpi={metrics.payers} /> : null}
      </Stats>

      <Panel title='Items' sub='Counter purchases in the window, from both ticket kinds. Owners counts every holder, however they got it.' flush>
        <DataTable
          caption='Counter items'
          filter='filter items'
          columns={[
            { label: 'item' },
            { label: 'kind' },
            { label: 'price', align: 'right' },
            { label: 'on sale' },
            { label: 'bought', align: 'right' },
            { label: 'tickets', align: 'right' },
            { label: 'owners', align: 'right' },
          ]}
          rows={metrics.items.map((item) => ({
            key: item.itemId,
            search: `${item.name} ${item.itemId} ${item.kind}`,
            cells: [
              <span key='n' title={item.itemId}>{item.name}</span>,
              item.kind,
              fmtInt(item.price),
              item.active ? 'yes' : 'no',
              fmtInt(item.purchases),
              fmtInt(item.tickets),
              fmtInt(item.owners),
            ],
            sort: [item.name, item.kind, item.price, item.active ? 1 : 0, item.purchases, item.tickets, item.owners],
            muted: [1, ...(item.active ? [] : [3])],
          }))}
          sortBy={4}
          emptyTitle='Nothing bought at the counter in this window.'
        />
      </Panel>

      {packsRecorded ? (
        <Panel title='Ticket packs' sub='Fulfilled checkouts in the window, as the app recorded them. Nothing here calls Stripe.' flush>
          <DataTable
            caption='Ticket packs'
            columns={[{ label: 'pack' }, { label: 'sold', align: 'right' }, { label: 'tickets', align: 'right' }, { label: 'revenue', align: 'right' }, { label: 'refunded', align: 'right' }]}
            rows={metrics.packs.map((pack) => ({
              key: `${pack.packId}:${pack.currency}`,
              cells: [pack.packId, fmtInt(pack.purchases), fmtInt(pack.tickets), fmtMoney(pack.cents, pack.currency), fmtInt(pack.refunds)],
              sort: [pack.packId, pack.purchases, pack.tickets, pack.cents, pack.refunds],
              alert: pack.refunds ? [4] : [],
            }))}
            sortBy={3}
            paged={false}
            emptyTitle='No packs sold in this window.'
          />
          <div style={{ padding: '12px 16px 0', display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, color: 'var(--adm-ink-3)', fontSize: 12 }}>
              {fmtInt(funnel.started)} checkouts started: {fmtInt(funnel.fulfilled)} fulfilled, {fmtInt(funnel.failed)} failed, {fmtInt(funnel.expired)} expired, {fmtInt(funnel.reversed)} reversed. {fmtInt(conversion.firstTimePackBuyers)} first-time payers.
            </p>
            <ColumnChart
              label='Pack revenue by day'
              labels={metrics.dailyRevenue.map((d) => fmtDay(d.day))}
              values={metrics.dailyRevenue.map((d) => d.value / 100)}
              seriesName='revenue'
              xTitle='day'
              format='money'
              currency={currency}
              height={130}
            />
          </div>
        </Panel>
      ) : (
        <Panel title='Ticket packs'>
          <Empty title='No ticket pack purchases are recorded.'>Pack revenue, payers and checkouts appear here once the app records a purchase. Nothing here calls Stripe.</Empty>
        </Panel>
      )}
    </AdminPage>
  );
}
