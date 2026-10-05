'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeButton, ArcadeChip, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { Plus, Trash2, Save, X, ChevronUp, ChevronDown, Type, Download, Search } from 'lucide-react';

type Puzzle = { id: string; sortOrder: number; answer: string };

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const dateToSeed = (k: string) => {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
};

const RENDER_CAP = 200;

export default function WordGridAdminPage() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [answer, setAnswer] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/word-grid', { cache: 'no-store' });
      if (res.ok) setPuzzles((await res.json()).puzzles ?? []);
      else setError('Failed to load answers.');
    } catch {
      setError('Failed to load answers.');
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const todayIdx = puzzles.length > 0 ? dateToSeed(todayKey()) % puzzles.length : -1;

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? puzzles.filter((p) => p.answer.includes(f)) : puzzles;
    return list;
  }, [puzzles, filter]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const a = answer.trim().toLowerCase();
    const isNew = editing === 'new';
    try {
      const res = await fetch('/api/admin/word-grid', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { answer: a } : { id: editing, answer: a }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setEditing(null);
        setAnswer('');
        setNotice(isNew ? 'Answer added.' : 'Answer saved.');
        await load();
      } else {
        setError(d?.error ?? 'Save failed.');
      }
    } catch {
      setError('Save failed.');
    }
    setBusy(false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this answer?')) return;
    await fetch(`/api/admin/word-grid?id=${id}`, { method: 'DELETE' });
    await load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= puzzles.length) return;
    const reorder = puzzles.map((p, i) => ({
      id: p.id,
      sortOrder: i === idx ? j : i === j ? idx : i,
    }));
    await fetch('/api/admin/word-grid', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder }),
    });
    await load();
  };

  const seedDefaults = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/word-grid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDefaults: true }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      setNotice(`Seeded ${d?.seeded} default answers.`);
      await load();
    } else {
      setError(d?.error ?? 'Seed failed.');
    }
    setBusy(false);
  };

  const canReorder = !filter.trim();

  return (
    <AdminPageFrame
      title="Word Grid puzzles"
      subtitle="The daily 5-letter answer rotation. When this pool is empty the game uses the in-code defaults."
      actions={
        <>
          <ArcadeButton
            tone="primary"
            size="sm"
            onClick={() => {
              setEditing('new');
              setAnswer('');
              setError(null);
            }}
            disabled={editing !== null}
          >
            <Plus size={16} /> New answer
          </ArcadeButton>
          {puzzles.length === 0 && (
            <ArcadeButton tone="ghost" size="sm" onClick={seedDefaults} disabled={busy}>
              <Download size={16} /> Seed defaults
            </ArcadeButton>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <ArcadeNotice tone="danger">{error}</ArcadeNotice>}
        {notice && <ArcadeNotice tone="success">{notice}</ArcadeNotice>}

        <div className="flex flex-wrap items-center gap-2">
          <ArcadeChip tone="info">
            {loading ? 'Loading…' : `${puzzles.length} answer${puzzles.length === 1 ? '' : 's'} in rotation`}
          </ArcadeChip>
        </div>

        {editing !== null && (
          <div className="arcade-card flex flex-wrap items-end gap-3 p-4">
            <label className="text-sm text-body">
              <span className="mb-1 block text-xs text-faint">5-letter answer (must be a real word)</span>
              <input
                value={answer.toUpperCase()}
                maxLength={5}
                autoFocus
                onChange={(e) => setAnswer(e.target.value.replace(/[^a-zA-Z]/g, '').toLowerCase())}
                onKeyDown={(e) => e.key === 'Enter' && answer.length === 5 && void save()}
                className="h-12 w-44 rounded-lg border-2 border-ink bg-background px-3 text-center text-2xl font-bold uppercase tracking-[0.3em] text-strong"
              />
            </label>
            <ArcadeButton tone="primary" size="sm" onClick={save} disabled={busy || answer.length !== 5}>
              <Save size={16} /> {busy ? 'Saving…' : 'Save'}
            </ArcadeButton>
            <ArcadeButton tone="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              <X size={16} /> Cancel
            </ArcadeButton>
          </div>
        )}

        {puzzles.length > 12 && (
          <label className="block max-w-xs space-y-2 text-sm font-semibold text-body">
            <span>Filter answers</span>
            <span className="arc-input-wrap">
              <span className="arc-input-icon">
                <Search size={16} aria-hidden />
              </span>
              <input
                className="arc-input"
                data-hasicon="true"
                placeholder="Search the rotation…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </span>
          </label>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.slice(0, RENDER_CAP).map((p) => {
            const idx = p.sortOrder;
            return (
              <div
                key={p.id}
                className="arcade-card-inset flex items-center justify-between gap-2 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs font-mono text-faint">#{idx + 1}</span>
                  <span className="font-mono text-lg font-bold uppercase tracking-widest text-strong">
                    {p.answer}
                  </span>
                  {idx === todayIdx && (
                    <span className="rounded bg-prize/20 px-2 py-0.5 text-[10px] font-bold uppercase text-prize-text">
                      Today
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canReorder && (
                    <>
                      <ArcadeButton tone="ghost" size="icon-sm" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up">
                        <ChevronUp size={15} />
                      </ArcadeButton>
                      <ArcadeButton tone="ghost" size="icon-sm" onClick={() => move(idx, 1)} disabled={idx === puzzles.length - 1} aria-label="Move down">
                        <ChevronDown size={15} />
                      </ArcadeButton>
                    </>
                  )}
                  <ArcadeButton tone="danger" size="icon-sm" onClick={() => del(p.id)} aria-label="Delete">
                    <Trash2 size={15} />
                  </ArcadeButton>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length > RENDER_CAP && (
          <p className="text-center text-xs text-faint">
            Showing first {RENDER_CAP} of {filtered.length} — use the filter to narrow.
          </p>
        )}
        {!loading && puzzles.length === 0 && (
          <div className="arcade-card-inset flex flex-col items-center gap-2 p-8 text-center">
            <Type size={32} className="text-faint/40" />
            <p className="text-sm text-faint">
              No custom answers — the game uses its in-code default list. Add answers or seed the defaults to edit them here.
            </p>
          </div>
        )}
      </div>
    </AdminPageFrame>
  );
}
