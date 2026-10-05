'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  consumeAuthAttributionSource,
  trackProductEvent,
} from '@/features/analytics/product-events';
import {
  ArcadeButton,
  ArcadeField,
  ArcadeInput,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePage,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';
import { useSiteAvailability } from '@/features/arcade/components/shell/site-availability-context';

type SignInClientProps = {
  initialMode: 'signin' | 'register';
  nextPath: string;
};

type AccountResponse = {
  account?: {
    username?: string | null;
  };
  error?: string;
};

async function readAccountResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as AccountResponse;
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

export function SignInClient({
  initialMode,
  nextPath,
}: SignInClientProps) {
  const availability = useSiteAvailability();
  const registrationEnabled = availability.registrationEnabled;
  const router = useRouter();
  const [selectedMode, setMode] = useState<'signin' | 'register'>(initialMode);
  const mode = registrationEnabled ? selectedMode : 'signin';
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === 'signin') {
        await readAccountResponse(
          await fetch('/api/account/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailOrUsername, password }),
          }),
        );
      } else {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        await readAccountResponse(
          await fetch('/api/account/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password,
              username,
            }),
          }),
        );
      }
      void trackProductEvent(
        mode === 'signin' ? 'signin_success' : 'signup_success',
        { source: consumeAuthAttributionSource() ?? 'auth_page' },
      );
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Unable to continue.');
    } finally {
      setBusy(false);
    }
  };

  const continueAsGuest = async () => {
    setError(null);
    setGuestBusy(true);
    try {
      const response = await fetch('/api/account/guest', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as AccountResponse;
        throw new Error(payload.error || 'Unable to continue as guest.');
      }
      router.replace(nextPath || '/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Unable to continue as guest.');
    } finally {
      setGuestBusy(false);
    }
  };

  return (
    <ArcadePage narrow>
      <div className='flex min-h-[calc(100vh-5rem)] flex-col justify-center'>
        <Link href='/' className='arcade-kicker mb-6 transition-colors hover:text-strong'>
          tixy
        </Link>
        <ArcadePanel variant='cabinet' className='overflow-hidden'>
          <ArcadeMarquee tone='primary' size='md'>
            {mode === 'signin' ? 'Enter tixy' : 'New player card'}
          </ArcadeMarquee>
          <div className='p-6'>
            <h1 className='sr-only'>
              {mode === 'signin' ? 'Enter tixy' : 'Create player card'}
            </h1>
            {!registrationEnabled ? (
              <ArcadeNotice className='mb-4'>
                New account registration is temporarily unavailable. {availability.message}
              </ArcadeNotice>
            ) : null}
            <div className={`grid gap-2 ${registrationEnabled ? 'grid-cols-2' : ''}`}>
              <ArcadeButton
                size='sm'
                tone={mode === 'signin' ? 'primary' : 'ghost'}
                pressed={mode === 'signin'}
                onClick={() => setMode('signin')}
              >
                Sign in
              </ArcadeButton>
              {registrationEnabled ? (
                <ArcadeButton
                  size='sm'
                  tone={mode === 'register' ? 'primary' : 'ghost'}
                  pressed={mode === 'register'}
                  onClick={() => setMode('register')}
                >
                  New card
                </ArcadeButton>
              ) : null}
            </div>

            {mode === 'signin' ? (
              <div className='mt-4 text-sm text-faint'>
                <Link href='/recover' className='arcade-link'>
                  Recover player card
                </Link>
              </div>
            ) : null}

            <form onSubmit={submit} className='mt-6 space-y-4'>
              {mode === 'signin' ? (
                <ArcadeField label='Email or username'>
                  <ArcadeInput
                    value={emailOrUsername}
                    onChange={(event) => setEmailOrUsername(event.target.value)}
                    autoComplete='username'
                    required
                  />
                </ArcadeField>
              ) : (
                <>
                  <ArcadeField label='Email'>
                    <ArcadeInput
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete='email'
                      type='email'
                      required
                    />
                  </ArcadeField>
                  <ArcadeField label='Username'>
                    <ArcadeInput
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete='username'
                      required
                    />
                  </ArcadeField>
                </>
              )}

              <ArcadeField label='Password'>
                <ArcadeInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  type='password'
                  minLength={8}
                  required
                />
              </ArcadeField>

              {mode === 'register' ? (
                <ArcadeField label='Confirm password'>
                  <ArcadeInput
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete='new-password'
                    type='password'
                    minLength={8}
                    required
                  />
                </ArcadeField>
              ) : null}

              {error ? (
                <ArcadeNotice tone='danger'>{error}</ArcadeNotice>
              ) : null}

              <ArcadeButton
                type='submit'
                disabled={busy || guestBusy}
                tone='primary'
                className='w-full'
              >
                {busy ? 'Working' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </ArcadeButton>
            </form>
            <ArcadeButton
              type='button'
              disabled={busy || guestBusy}
              tone='ghost'
              className='mt-3 w-full'
              onClick={() => void continueAsGuest()}
            >
              {guestBusy ? 'Opening...' : 'Continue as guest'}
            </ArcadeButton>
          </div>
        </ArcadePanel>
      </div>
    </ArcadePage>
  );
}
