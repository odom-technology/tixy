'use client';

import { ShieldCheck, UserRoundCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ArcadeButton, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { useSocial } from '@/features/social/social-provider';
import type { SocialPerson } from '@/features/social/social-types';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

export function SocialSafetyPanel() {
  const { refresh } = useSocial();
  const [blocked, setBlocked] = useState<SocialPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/social/moderation', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { blocked?: SocialPerson[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load blocked players.');
      setBlocked(payload.blocked ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const unblock = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const response = await fetch('/api/social/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unblock', targetUserId: userId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to unblock this player.');
      setBlocked((current) => current.filter((player) => player.userId !== userId));
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className='arcade-card mx-auto max-w-3xl p-5'>
      <div className='flex items-start gap-3'>
        <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-prize text-prize-on shadow-chip'><ShieldCheck size={19} /></span>
        <div><h2 className='text-lg font-bold text-strong'>Blocked players</h2><p className='mt-1 text-sm leading-6 text-faint'>Blocked players cannot message or send friend requests, and their posts are hidden from your Arcade Lobby.</p></div>
      </div>
      {error ? <ArcadeNotice tone='danger' className='mt-4'>{error}</ArcadeNotice> : null}
      <div className='mt-5 space-y-2'>
        {loading ? <div className='flex justify-center p-6 text-sm text-faint'><ArcadeLoading label='Loading your blocked list.' /></div>
          : blocked.length === 0 ? <div className='rounded-key border border-dashed border-soft p-8 text-center text-sm text-faint'><ShieldCheck size={24} className='mx-auto mb-2' />You have not blocked anyone.</div>
            : blocked.map((player) => <div key={player.userId} className='flex items-center gap-3 rounded-key border border-soft bg-raised p-3'><ProfileAvatar name={player.name} imageUrl={player.imageUrl} size='md' /><span className='min-w-0 flex-1 truncate text-sm font-bold text-strong'>{player.name}</span><ArcadeButton size='sm' disabled={busyId === player.userId} onClick={() => void unblock(player.userId)}>{busyId === player.userId ? <ArcadeLoadingDots /> : <UserRoundCheck size={14} />} Unblock</ArcadeButton></div>)}
      </div>
    </section>
  );
}
