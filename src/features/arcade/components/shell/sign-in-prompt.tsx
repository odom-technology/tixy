'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { setAuthAttributionSource } from '@/features/analytics/product-events';
import { ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';

import './game-shell.css';

/* Signed-out players can play. Sign-in comes up when there is something to
   save, in place: a quiet line where a list or stats would be, or a dialog
   when a guest presses something the server only does for accounts. Never
   a wall, never red. See docs/design/tixy-rebrand/SHELL.md. */

const SOURCE = 'game_shell';

function useSignInHrefs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useMemo(() => {
    const query = searchParams.toString();
    const next = encodeURIComponent(query ? `${pathname}?${query}` : pathname);
    return {
      signIn: `/signin?next=${next}`,
      register: `/signin?mode=register&next=${next}`,
    };
  }, [pathname, searchParams]);
}

/** "Sign in to {action}." with "Sign in" as the link. `action` is lowercase
 *  and has no full stop: `see your stats`, `see open matches`. */
export function SignInLine({ action, className }: { action: string; className?: string }) {
  const { signIn } = useSignInHrefs();
  return (
    <p className={['arc-signin-line', className].filter(Boolean).join(' ')}>
      <Link href={signIn} onClick={() => setAuthAttributionSource(SOURCE)}>
        Sign in
      </Link>{' '}
      to {action}.
    </p>
  );
}

/** Asks a guest to sign in after they pressed something that saves. `reason`
 *  is one or two sentences: "Sign in to play chess. Your games and rating
 *  are saved to your account." */
export function SignInDialog({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason: string;
}) {
  const { signIn, register } = useSignInHrefs();
  return (
    <ArcadeDialog open={open} onClose={onClose} title='sign in'>
      <p className='arc-signin-reason'>{reason}</p>
      <div className='arc-signin-actions'>
        <ArcadeLinkButton href={signIn} tone='primary' onClick={() => setAuthAttributionSource(SOURCE)}>
          sign in
        </ArcadeLinkButton>
        <ArcadeLinkButton href={register} tone='default' onClick={() => setAuthAttributionSource(SOURCE)}>
          create account
        </ArcadeLinkButton>
      </div>
    </ArcadeDialog>
  );
}
