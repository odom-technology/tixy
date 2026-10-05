import Link from 'next/link';
import { getPathRestriction } from '@/lib/site-availability';
import { getSiteAvailabilitySettings } from '@/server/site-settings';
import { ArcadePanel } from '@/features/arcade/components/ui/arcade-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Temporarily unavailable | tixy', robots: { index: false, follow: true } };

export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const params = await searchParams;
  const { config } = await getSiteAvailabilitySettings();
  const restriction = getPathRestriction(config, params.path ?? '');
  return (
    <div className='page-shell mx-auto max-w-2xl px-5 py-16'>
      <ArcadePanel className='p-6 sm:p-10'>
        <p className='arcade-kicker'>Temporarily unavailable</p>
        <h1 className='arcade-display mt-3 text-2xl uppercase'>{restriction?.label ?? 'This section'} is taking a break</h1>
        <p className='mt-4 text-body'>{config.message}</p>
        <Link href='/' className='arcade-link mt-6 inline-block'>Back to tixy</Link>
      </ArcadePanel>
    </div>
  );
}
