'use client';

import { Check, Loader2, MessagesSquare, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePanel,
  ArcadeStat,
} from '@/features/arcade/components/ui/arcade-ui';
import type { LobbyMessageReport } from '@/server/social/messaging';

export function SocialModerationClient() {
  const [reports, setReports] = useState<LobbyMessageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/social-moderation', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        reports?: LobbyMessageReport[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to load reports.');
      setReports(payload.reports ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (reportId: string, action: 'remove' | 'dismiss') => {
    setBusyId(reportId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/social-moderation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to resolve report.');
      setReports((current) => current.filter((report) => report.id !== reportId));
      setNotice(action === 'remove' ? 'Message removed and report resolved.' : 'Report dismissed.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <ArcadeStat
          label='Open reports'
          value={loading ? '—' : reports.length.toLocaleString()}
          sub='tixy Lobby moderation queue'
          tone={reports.length > 0 ? 'danger' : 'prize'}
          icon={MessagesSquare}
          className='min-w-52'
        />
        <ArcadeButton
          type='button'
          size='sm'
          onClick={() => void load()}
          disabled={loading || busyId !== null}
        >
          <RefreshCw size={16} aria-hidden='true' className={loading ? 'motion-safe:animate-spin' : ''} />
          Refresh queue
        </ArcadeButton>
      </div>

      {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}
      {notice ? <div role='status'><ArcadeNotice tone='success'>{notice}</ArcadeNotice></div> : null}

      <ArcadePanel className='overflow-hidden p-0'>
        <ArcadeMarquee tone='info' trailing={<ArcadeChip>{loading ? 'Loading' : `${reports.length} open`}</ArcadeChip>}>
          Report queue
        </ArcadeMarquee>
        {loading ? (
          <div className='flex items-center justify-center gap-2 p-10 text-sm text-faint' role='status'>
            <Loader2 size={18} aria-hidden='true' className='motion-safe:animate-spin' />
            Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <div className='flex flex-col items-center gap-2 px-5 py-12 text-center'>
            <MessagesSquare size={28} aria-hidden='true' className='text-faint' />
            <p className='font-semibold text-strong'>The queue is clear</p>
            <p className='max-w-md text-sm text-faint'>New player reports will appear here for review.</p>
          </div>
        ) : (
          <div className='divide-y divide-soft'>
            {reports.map((report) => (
              <article key={report.id} className='grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_auto]'>
                <div className='min-w-0'>
                  <p className='text-xs font-bold uppercase tracking-wide text-faint'>
                    Reported message · {report.senderName}
                  </p>
                  <blockquote className='mt-3 rounded-key border-l-4 border-danger bg-raised px-4 py-3 text-sm leading-6 text-strong'>
                    {report.content}
                  </blockquote>
                  <p className='mt-3 text-sm text-body'><span className='font-semibold'>Reason:</span> {report.reason}</p>
                </div>
                <div className='flex flex-wrap items-start gap-2 xl:flex-col'>
                  <ArcadeButton size='sm' onClick={() => void resolve(report.id, 'dismiss')} disabled={busyId !== null}>
                    <Check size={14} aria-hidden='true' /> Dismiss
                  </ArcadeButton>
                  <ArcadeButton size='sm' tone='danger' onClick={() => void resolve(report.id, 'remove')} disabled={busyId !== null}>
                    {busyId === report.id ? (
                      <Loader2 size={14} aria-hidden='true' className='motion-safe:animate-spin' />
                    ) : (
                      <Trash2 size={14} aria-hidden='true' />
                    )}
                    Remove message
                  </ArcadeButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </ArcadePanel>
    </div>
  );
}
