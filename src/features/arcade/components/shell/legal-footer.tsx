'use client';

import Link from 'next/link';

const FOOTER_LINKS = [
  { href: '/developers', label: 'Build for Tixy' },
  { href: '/legal', label: 'Privacy & Terms' },
  { href: '/feedback', label: 'Feedback' },
];

export function LegalFooter() {
  return (
    <footer data-legal-footer className='border-t border-soft bg-background px-3 py-5 text-xs text-faint sm:px-4 lg:px-6'>
      <div className='mx-auto flex w-full max-w-[100rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p>
          An{' '}
          <a
            href='https://odomtech.com'
            className='rounded-sm underline underline-offset-2 transition-colors hover:bg-raised hover:text-strong focus-visible:bg-raised focus-visible:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
          >
            ODOM Tech
          </a>{' '}
          product
        </p>
        <nav aria-label='Site links and support' className='flex flex-wrap items-center gap-3'>
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className='font-semibold transition-colors hover:text-strong'
            >
              {link.label}
            </Link>
          ))}
          <a
            href='https://buymeacoffee.com/andrewodom18'
            className='inline-flex min-h-11 items-center justify-center rounded-lg border border-soft bg-raised px-3 py-2 font-semibold text-strong transition-colors hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
          >
            Support the dev
          </a>
        </nav>
      </div>
    </footer>
  );
}
