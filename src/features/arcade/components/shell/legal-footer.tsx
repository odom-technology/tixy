'use client';

import Link from 'next/link';

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/contact', label: 'Contact' },
  { href: '/feedback', label: 'Feedback' },
];

export function LegalFooter() {
  return (
    <footer className='border-t border-soft bg-background px-3 py-5 text-xs text-faint sm:px-4 lg:px-6'>
      <div className='mx-auto flex w-full max-w-[100rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p>An ODOM Tech product</p>
        <nav aria-label='Legal and support' className='flex flex-wrap items-center gap-3'>
          {LEGAL_LINKS.map((link) => (
            link.href === '/privacy' ? (
              <a
                key={link.href}
                href={link.href}
                className='font-semibold transition-colors hover:text-strong'
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className='font-semibold transition-colors hover:text-strong'
              >
                {link.label}
              </Link>
            )
          ))}
          <a
            href='https://github.com/odom-technology/tixy'
            className='font-semibold transition-colors hover:text-strong'
          >
            Source
          </a>
        </nav>
      </div>
    </footer>
  );
}
