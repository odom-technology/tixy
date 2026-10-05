'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';

import {
  ArcadeButton,
  ArcadeField,
  ArcadeInput,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePage,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type RecoverResponse = {
  account?: {
    username?: string | null;
  };
  error?: string;
};

async function readRecoverResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as RecoverResponse;
  if (!response.ok) throw new Error(payload.error || 'Unable to recover account.');
  return payload;
}

export function RecoverClient() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      await readRecoverResponse(
        await fetch('/api/account/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            recoveryCode,
            newPassword,
          }),
        }),
      );
      router.replace('/settings');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message || 'Unable to recover account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ArcadePage narrow>
      <div className='flex min-h-[calc(100vh-5rem)] flex-col justify-center'>
        <Link href='/' className='arcade-kicker mb-6 transition-colors hover:text-strong'>
          tixy
        </Link>
        <ArcadePanel variant='cabinet' className='overflow-hidden'>
          <ArcadeMarquee
            tone='info'
            size='md'
            trailing={<KeyRound aria-hidden size={16} />}
          >
            Recover player card
          </ArcadeMarquee>
          <div className='p-6'>
            <h1 className='sr-only'>Recover player card</h1>
            <p className='text-sm leading-6 text-body'>
              Use a saved recovery code to reopen your account.
            </p>

            <form onSubmit={submit} className='mt-6 space-y-4'>
              <ArcadeField label='Email'>
                <ArcadeInput
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete='email'
                  type='email'
                  required
                />
              </ArcadeField>

              <ArcadeField label='Recovery code'>
                <ArcadeInput
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  autoComplete='one-time-code'
                  mono
                  className='uppercase'
                  placeholder='ABCD-1234-EFGH-5678'
                  required
                />
              </ArcadeField>

              <ArcadeField label='New password'>
                <ArcadeInput
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete='new-password'
                  type='password'
                  minLength={8}
                  required
                />
              </ArcadeField>

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

              {error ? (
                <ArcadeNotice tone='danger'>{error}</ArcadeNotice>
              ) : null}

              <ArcadeButton
                type='submit'
                disabled={busy}
                tone='primary'
                className='w-full'
              >
                {busy ? <ArcadeLoadingDots /> : <KeyRound size={16} />}
                {busy ? 'Working' : 'Reset password'}
              </ArcadeButton>
            </form>

            <div className='mt-5 flex flex-wrap gap-3 text-sm'>
              <Link href='/signin' className='arcade-link'>
                Sign in
              </Link>
              <Link href='/signup' className='arcade-link'>
                Create player card
              </Link>
            </div>
          </div>
        </ArcadePanel>
      </div>
    </ArcadePage>
  );
}
