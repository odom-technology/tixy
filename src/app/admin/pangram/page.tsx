'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeButton, ArcadeChip, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { Plus, Trash2, Save, X, ChevronUp, ChevronDown, Hexagon, Download } from 'lucide-react';

type Puzzle = { id: string; sortOrder: number; letters: string[]; center: string };

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
// Mirrors the server's dateToSeed so we can flag today's puzzle.
const dateToSeed = (k: string) => {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
};

export default function PangramAdminPage() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [letters, setLetters] = useState<string[]>(['', '', '', '', '', '', '']);
  const [center, setCenter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/pangram', { cache: 'no-store' });
      if (res.ok) setPuzzles((await res.json()).puzzles ?? []);
      else setError('Failed to load puzzles.');
    } catch {
      setError('Failed to load puzzles.');
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const todayIdx = puzzles.length > 0 ? dateToSeed(todayKey()) % puzzles.length : -1;

  const startNew = () => {
    setEditing('new');
    setLetters(['', '', '', '', '', '', '']);
    setCenter('');
    setError(null);
  };
  const startEdit = (p: Puzzle) => {
    setEditing(p.id);
    setLetters([...p.letters, '', '', '', '', '', '', ''].slice(0, 7));
    setCenter(p.center);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const ls = letters.map((l) => l.trim().toLowerCase());
    const c = center.trim().toLowerCase();
    const isNew = editing === 'new';
    try {
      const res = await fetch('/api/admin/pangram', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { letters: ls, center: c } : { id: editing, letters: ls, center: c }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setEditing(null);
        setNotice(`${isNew ? 'Added' : 'Saved'} — ${d?.words ?? '?'} valid words.`);
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
    if (!confirm('Delete this letter set?')) return;
    await fetch(`/api/admin/pangram?id=${id}`, { method: 'DELETE' });
    await load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= puzzles.length) return;
    const reorder = puzzles.map((p, i) => ({
      id: p.id,
      sortOrder: i === idx ? j : i === j ? idx : i,
    }));
    await fetch('/api/admin/pangram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder }),
    });
    await load();
  };

  const seedDefaults = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/pangram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDefaults: true }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      setNotice(`Seeded ${d?.seeded} default letter sets.`);
      await load();
    } else {
      setError(d?.error ?? 'Seed failed.');
    }
    setBusy(false);
  };

  return (
    <AdminPageFrame
      title="Pangram puzzles"
      subtitle="The daily letter-set rotation. When this pool is empty the game uses the in-code defaults."
      actions={
        <>
          <ArcadeButton tone="primary" size="sm" onClick={startNew} disabled={editing !== null}>
            <Plus size={16} /> New set
          </ArcadeButton>
          {puzzles.length === 0 && (
            <ArcadeButton tone="ghost" size="sm" onClick={seedDefaults} disabled={busy}>
              <Download size={16} /> Seed 48 defaults
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
            {loading ? 'Loading…' : `${puzzles.length} set${puzzles.length === 1 ? '' : 's'} in rotation`}
          </ArcadeChip>
        </div>

        {/* Editor form */}
        {editing !== null && (
          <div className="arcade-card space-y-3 p-4">
            <p className="text-sm font-semibold text-strong">
              {editing === 'new' ? 'New letter set' : 'Edit letter set'}
            </p>
            <p className="text-xs text-faint">
              Seven unique letters; pick the required centre. The set must yield a pangram and at least 20 accepted words.
            </p>
            <div className="flex flex-wrap gap-2">
              {letters.map((l, i) => (
                <input
                  key={i}
                  value={l.toUpperCase()}
                  maxLength={1}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^a-zA-Z]/g, '').toLowerCase();
                    setLetters((prev) => prev.map((x, k) => (k === i ? v : x)));
                  }}
                  className="h-12 w-12 rounded-lg border-2 border-ink bg-background text-center text-xl font-bold uppercase text-strong"
                  aria-label={`Letter ${i + 1}`}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-body">
              Centre letter:
              <select
                value={center}
                onChange={(e) => setCenter(e.target.value)}
                className="rounded-lg border-2 border-ink bg-background px-3 py-1.5 font-bold uppercase text-strong"
              >
                <option value="">—</option>
                {letters.filter((l) => l).map((l, i) => (
                  <option key={`${l}-${i}`} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <ArcadeButton tone="primary" size="sm" onClick={save} disabled={busy}>
                <Save size={16} /> {busy ? 'Saving…' : 'Save'}
              </ArcadeButton>
              <ArcadeButton tone="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
                <X size={16} /> Cancel
              </ArcadeButton>
            </div>
          </div>
        )}

        {/* List */}
        <div className="space-y-2">
          {puzzles.map((p, idx) => (
            <div
              key={p.id}
              className="arcade-card-inset flex items-center justify-between gap-3 p-3"
              data-today={idx === todayIdx ? 'true' : undefined}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xs font-mono text-faint">#{idx + 1}</span>
                <div className="flex flex-wrap gap-1">
                  {p.letters.map((l, k) => (
                    <span
                      key={`${l}-${k}`}
                      className="inline-grid h-7 w-7 place-items-center rounded text-sm font-bold uppercase"
                      style={{
                        background: l === p.center ? '#f2a33c' : 'var(--surface-raised, #2a1d14)',
                        color: l === p.center ? '#2a1b06' : 'var(--text-strong, #f6eddc)',
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                {idx === todayIdx && (
                  <span className="rounded bg-prize/20 px-2 py-0.5 text-[10px] font-bold uppercase text-prize-text">
                    Today
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ArcadeButton tone="ghost" size="icon-sm" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up">
                  <ChevronUp size={16} />
                </ArcadeButton>
                <ArcadeButton tone="ghost" size="icon-sm" onClick={() => move(idx, 1)} disabled={idx === puzzles.length - 1} aria-label="Move down">
                  <ChevronDown size={16} />
                </ArcadeButton>
                <ArcadeButton tone="ghost" size="sm" onClick={() => startEdit(p)} disabled={editing !== null}>
                  Edit
                </ArcadeButton>
                <ArcadeButton tone="danger" size="icon-sm" onClick={() => del(p.id)} aria-label="Delete">
                  <Trash2 size={16} />
                </ArcadeButton>
              </div>
            </div>
          ))}
          {!loading && puzzles.length === 0 && (
            <div className="arcade-card-inset flex flex-col items-center gap-2 p-8 text-center">
              <Hexagon size={32} className="text-faint/40" />
              <p className="text-sm text-faint">
                No custom sets — the game uses its 48 in-code defaults. Add sets or seed the defaults to edit them here.
              </p>
            </div>
          )}
        </div>
      </div>
    </AdminPageFrame>
  );
}
