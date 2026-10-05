import Link from 'next/link';

/* The page's one filter row: the time window. It is a link per window, so the
   window lives in the URL and a reload or a shared link keeps it. */

export function WindowTabs({ path, days, options = [7, 30, 90], extra = '' }: { path: string; days: number; options?: number[]; extra?: string }) {
  return (
    <nav className='adm-seg' aria-label='Time window'>
      {options.map((option) => (
        <Link key={option} href={`${path}?days=${option}${extra}`} aria-current={option === days ? 'page' : undefined} scroll={false}>
          {option} days
        </Link>
      ))}
    </nav>
  );
}
