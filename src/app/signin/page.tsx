import { redirect } from 'next/navigation';

import {
  getFirstSearchParam,
  hasActiveAccountSession,
  sanitizeAuthNextPath,
} from '@/server/auth/page-utils';

import { SignInClient } from './_signin-client';

export const metadata = {
  title: 'Sign in | Arcade',
};

type SignInPageProps = {
  searchParams?: Promise<{
    mode?: string | string[];
    next?: string | string[];
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = sanitizeAuthNextPath(params.next);
  if (await hasActiveAccountSession()) redirect(nextPath);

  const mode =
    getFirstSearchParam(params.mode) === 'register'
      ? 'register'
      : 'signin';
  return (
    <SignInClient
      initialMode={mode}
      nextPath={nextPath}
    />
  );
}
