import { redirect } from 'next/navigation';

import {
  hasActiveAccountSession,
  sanitizeAuthNextPath,
} from '@/server/auth/page-utils';

import { SignInClient } from '../signin/_signin-client';

export const metadata = {
  title: 'Sign up | Arcade',
};

type SignUpPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = sanitizeAuthNextPath(params.next);
  if (await hasActiveAccountSession()) redirect(nextPath);

  return (
    <SignInClient
      initialMode='register'
      nextPath={nextPath}
    />
  );
}
