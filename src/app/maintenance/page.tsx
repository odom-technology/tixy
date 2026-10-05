import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ArcadeLinkButton,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';

import {
  ACCOUNT_SESSION_COOKIE,
  getIdentityForSessionToken,
} from '@/server/accounts';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
} from '@/server/site-settings';

export const dynamic = 'force-dynamic';

async function getCurrentIdentity() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
    return sessionToken ? getIdentityForSessionToken(sessionToken) : null;
  } catch {
    return null;
  }
}

function formatDateTime(timestamp: number | null) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export default async function MaintenancePage() {
  const [identity, maintenanceSetting] = await Promise.all([
    getCurrentIdentity(),
    getMaintenanceModeSettings(),
  ]);
  const status = getMaintenanceModeStatusForRoles({
    config: maintenanceSetting.config,
    roles: identity?.roles,
  });

  if (status.phase === 'off') {
    redirect('/');
  }

  const startsAt = formatDateTime(maintenanceSetting.config.startAt);
  const endsAt = formatDateTime(maintenanceSetting.config.endAt);

  return (
    <main className='flex min-h-screen items-center justify-center bg-background px-6 py-12'>
      <ArcadePanel variant='cabinet' className='w-full max-w-2xl p-8 text-center sm:p-12'>
        <p className='arcade-kicker'>tixy.lol</p>
        <h1 className='arcade-display mt-5 text-2xl text-strong uppercase sm:text-3xl'>
          The Arcade is temporarily closed.
        </h1>
        <p className='mx-auto mt-5 max-w-xl text-base text-body sm:text-lg'>
          Please check back when maintenance is complete.
        </p>
        <p className='mx-auto mt-5 max-w-xl text-base whitespace-pre-wrap text-body sm:text-lg'>
          {maintenanceSetting.config.message}
        </p>
        {startsAt || endsAt ? (
          <dl className='mx-auto mt-8 grid max-w-xl gap-3 text-left text-sm text-body sm:grid-cols-2'>
            {startsAt ? (
              <div className='inset-shadow-well rounded-well border-2 border-ink bg-well p-4'>
                <dt className='arcade-kicker text-xs'>Start</dt>
                <dd className='arcade-num mt-1'>{startsAt}</dd>
              </div>
            ) : null}
            {endsAt ? (
              <div className='inset-shadow-well rounded-well border-2 border-ink bg-well p-4'>
                <dt className='arcade-kicker text-xs'>Estimated completion</dt>
                <dd className='arcade-num mt-1'>{endsAt}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <ArcadeLinkButton href='/contact' tone='primary' size='sm'>
            Contact support
          </ArcadeLinkButton>
          {status.canBypass ? (
            <>
              <ArcadeLinkButton href='/' tone='primary' size='sm'>
                Open floor
              </ArcadeLinkButton>
              <ArcadeLinkButton href='/admin/site-settings' tone='default' size='sm'>
                Site settings
              </ArcadeLinkButton>
            </>
          ) : (
            <ArcadeLinkButton href='/signin?next=/admin/site-settings' tone='default' size='sm'>
              Admin sign in
            </ArcadeLinkButton>
          )}
        </div>
      </ArcadePanel>
    </main>
  );
}
