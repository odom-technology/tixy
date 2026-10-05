'use client';

import { useState, useEffect } from 'react';
import { formatDurationMs } from './_helpers';

export function BanTimeLeft({ bannedUntil }: { bannedUntil: number | null }) {
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    if (!bannedUntil) return;
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 5000);
    return () => window.clearInterval(interval);
  }, [bannedUntil]);

  return <>{formatDurationMs(Math.max(0, (bannedUntil ?? nowTs) - nowTs))}</>;
}
