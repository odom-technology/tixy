'use client';

import { useEffect, useState } from 'react';

import { fmtAgo } from './format';

/* "12 m ago", kept fresh. The server and the browser render at different
   moments, so the text may differ by a second at hydration; that one text
   node is allowed to. */
export function Ago({ ms, never = 'never', every = 15_000 }: { ms: number | null | undefined; never?: string; every?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every, ms]);
  if (ms == null) return <span>{never}</span>;
  return (
    <time dateTime={new Date(ms).toISOString()} suppressHydrationWarning>
      {fmtAgo(ms, now)}
    </time>
  );
}
