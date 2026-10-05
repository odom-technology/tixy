import { redirect } from 'next/navigation';

import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeMarquee, ArcadePanel, ArcadeStat } from '@/features/arcade/components/ui/arcade-ui';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { ACHIEVEMENTS } from '@/server/arcade/achievements/registry';
import { query, queryOne } from '@/server/db/client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Achievements | Admin',
};

export default async function AdminAchievementsPage() {
  let identity;
  try {
    identity = await requireIdentity();
  } catch {
    redirect('/signin?next=/admin/achievements');
  }
  if (!(await checkRole('admin', identity))) redirect('/');

  const [countRows, totalRow] = await Promise.all([
    query<{ achievement_id: string; count: string }>(
      `SELECT achievement_id, count FROM achievement_unlock_counts`,
    ),
    queryOne<{ c: string }>(`SELECT COUNT(*)::int AS c FROM user_account_xp`),
  ]);
  const counts = new Map(countRows.rows.map((r) => [r.achievement_id, Number(r.count)]));
  const totalPlayers = Math.max(1, Number(totalRow?.c ?? 1));

  const rows = ACHIEVEMENTS.map((a) => {
    const count = counts.get(a.id) ?? 0;
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      tier: a.tier,
      rarity: a.rarity,
      xp: a.xp,
      hidden: a.hidden,
      cosmeticId: a.cosmeticId,
      count,
      rate: ((count / totalPlayers) * 100).toFixed(1),
    };
  });
  const unlocks = rows.reduce((total, row) => total + row.count, 0);
  const hiddenCount = rows.filter((row) => row.hidden).length;

  return (
    <AdminPageFrame
      title='Achievements'
      subtitle='Review the achievement catalog and global unlock rates. Definitions are managed in the code registry.'
      contentClassName='space-y-5'
    >
      <section className='grid gap-3 sm:grid-cols-3'>
        <ArcadeStat label='Achievements' value={rows.length.toLocaleString()} sub={`${hiddenCount} secret`} tone='primary' />
        <ArcadeStat label='Total unlocks' value={unlocks.toLocaleString()} sub='Across all accounts' tone='prize' />
        <ArcadeStat label='Accounts' value={totalPlayers.toLocaleString()} sub='Used for unlock rates' tone='info' />
      </section>
      <ArcadePanel variant='panel' className='overflow-hidden p-0'>
        <ArcadeMarquee tone='cream'>Achievement catalog</ArcadeMarquee>
        <div className='overflow-x-auto'>
        <table className='w-full min-w-[48rem] text-left text-sm'>
          <caption className='sr-only'>Achievements and their global unlock rates</caption>
          <thead className='border-b-2 border-soft bg-raised text-xs uppercase text-faint'>
            <tr>
              <th scope='col' className='p-3'>Name</th>
              <th scope='col' className='p-3'>Category</th>
              <th scope='col' className='p-3'>Tier</th>
              <th scope='col' className='p-3'>Rarity</th>
              <th scope='col' className='p-3 text-right'>XP</th>
              <th scope='col' className='p-3'>Cosmetic</th>
              <th scope='col' className='p-3 text-right'>Unlocks</th>
              <th scope='col' className='p-3 text-right'>Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className='border-b border-soft/70 last:border-0 hover:bg-raised/50'>
                <td className='p-3 font-semibold text-strong'>
                  {r.name}
                  {r.hidden ? <span className='ml-1 text-[10px] text-purple-300'>secret</span> : null}
                </td>
                <td className='p-3 text-body'>{r.category}</td>
                <td className='p-3 text-faint'>{r.tier || '—'}</td>
                <td className='p-3 text-faint'>{r.rarity}</td>
                <td className='arcade-num p-3 text-right text-tickets-text'>{r.xp.toLocaleString()}</td>
                <td className='p-3 text-faint'>{r.cosmeticId ?? '—'}</td>
                <td className='arcade-num p-3 text-right text-strong'>{r.count.toLocaleString()}</td>
                <td className='arcade-num p-3 text-right text-faint'>{r.rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </ArcadePanel>
    </AdminPageFrame>
  );
}
