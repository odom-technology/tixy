'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import {
  ArcadeButton,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  ChevronUp,
  ChevronDown,
  Eye,
  CalendarDays,
  CalendarOff,
  LayoutGrid,
  Star,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────
type ConnectionsGroup = {
  category: string;
  words: [string, string, string, string];
  color: '#f8d74e' | '#7ed66e' | '#6eb4f8' | '#c97ed6';
};

type Puzzle = {
  id: string;
  sortOrder: number;
  groups: ConnectionsGroup[];
  createdAt: number;
  updatedAt: number;
};

const DIFFICULTY_COLORS = [
  { value: '#f8d74e' as const, label: 'Yellow (Easiest)', bg: '#f8d74e' },
  { value: '#7ed66e' as const, label: 'Green', bg: '#7ed66e' },
  { value: '#6eb4f8' as const, label: 'Blue', bg: '#6eb4f8' },
  { value: '#c97ed6' as const, label: 'Purple (Hardest)', bg: '#c97ed6' },
];

const EMPTY_GROUP: ConnectionsGroup = {
  category: '',
  words: ['', '', '', ''],
  color: '#f8d74e',
};

const createEmptyGroups = (): ConnectionsGroup[] => [
  { ...EMPTY_GROUP, color: '#f8d74e' },
  { ...EMPTY_GROUP, color: '#7ed66e' },
  { ...EMPTY_GROUP, color: '#6eb4f8' },
  { ...EMPTY_GROUP, color: '#c97ed6' },
];

// ─── Date helpers for puzzle schedule ───────────────────────────────────────
const EPOCH = new Date(2025, 0, 1);

function getPuzzleDateForIndex(
  puzzleIndex: number,
  totalPuzzles: number,
): string | null {
  if (totalPuzzles === 0) return null;
  const cursor = new Date(EPOCH);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + (puzzleIndex % totalPuzzles));

  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateGroups(groups: ConnectionsGroup[]): string | null {
  if (groups.length !== 4) return 'Must have exactly 4 groups.';
  const allWords = new Set<string>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (!g.category.trim()) return `Group ${i + 1}: category is empty.`;
    for (let j = 0; j < g.words.length; j++) {
      const w = g.words[j]!.trim();
      if (!w) return `Group ${i + 1}: word ${j + 1} is empty.`;
      const key = w.toLowerCase();
      if (allWords.has(key)) return `Duplicate word: "${w}"`;
      allWords.add(key);
    }
  }
  if (allWords.size !== 16)
    return `Need 16 unique words, found ${allWords.size}.`;
  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function AdminConnectionsPage() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor state
  const [editingPuzzle, setEditingPuzzle] = useState<Puzzle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editorGroups, setEditorGroups] =
    useState<ConnectionsGroup[]>(createEmptyGroups());
  const [editorError, setEditorError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Blackout dates state
  const [blackouts, setBlackouts] = useState<
    Array<{
      date: string;
      reason: string;
      createdBy: string;
      createdAt: number;
    }>
  >([]);
  const [holidays, setHolidays] = useState<
    Array<{ date: string; name: string }>
  >([]);
  const [newBlackoutDate, setNewBlackoutDate] = useState('');
  const [newBlackoutReason, setNewBlackoutReason] = useState('');
  const [blackoutError, setBlackoutError] = useState<string | null>(null);

  // ─── Fetch puzzles ────────────────────────────────────────────────────
  const fetchPuzzles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/connections', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to load puzzles');
        return;
      }
      const data = await res.json();
      setPuzzles(data.puzzles as Puzzle[]);
    } catch {
      setError('Failed to load puzzles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPuzzles();
  }, [fetchPuzzles]);

  // ─── Fetch blackout dates ─────────────────────────────────────────────
  const fetchBlackouts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/connections/blackout', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setBlackouts(data.blackouts ?? []);
      setHolidays(data.holidays ?? []);
    } catch {
      /* silently fail */
    }
  }, []);

  useEffect(() => {
    void fetchBlackouts();
  }, [fetchBlackouts]);

  const handleAddBlackout = async () => {
    if (!newBlackoutDate || !newBlackoutReason.trim()) {
      setBlackoutError('Date and reason are required.');
      return;
    }
    setBlackoutError(null);
    try {
      const res = await fetch('/api/admin/connections/blackout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newBlackoutDate,
          reason: newBlackoutReason.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setBlackoutError(data.error || 'Failed to add blackout date');
        return;
      }
      setNewBlackoutDate('');
      setNewBlackoutReason('');
      await fetchBlackouts();
    } catch {
      setBlackoutError('Failed to add blackout date');
    }
  };

  const handleRemoveBlackout = async (date: string) => {
    try {
      const res = await fetch(`/api/admin/connections/blackout?date=${date}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setBlackoutError(data.error || 'Failed to remove blackout date');
        return;
      }
      await fetchBlackouts();
    } catch {
      setBlackoutError('Failed to remove blackout date');
    }
  };

  // ─── CRUD operations ─────────────────────────────────────────────────
  const handleCreate = () => {
    setEditingPuzzle(null);
    setIsCreating(true);
    setEditorGroups(createEmptyGroups());
    setEditorError(null);
    setShowPreview(false);
  };

  const handleEdit = (puzzle: Puzzle) => {
    setEditingPuzzle(puzzle);
    setIsCreating(false);
    setEditorGroups(
      puzzle.groups.map((g) => ({
        ...g,
        words: [...g.words] as [string, string, string, string],
      })),
    );
    setEditorError(null);
    setShowPreview(false);
  };

  const handleCancel = () => {
    setEditingPuzzle(null);
    setIsCreating(false);
    setEditorError(null);
    setShowPreview(false);
  };

  const handleSave = async () => {
    const validationError = validateGroups(editorGroups);
    if (validationError) {
      setEditorError(validationError);
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (isCreating) {
        const res = await fetch('/api/admin/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: editorGroups }),
        });
        if (!res.ok) {
          const data = await res.json();
          setEditorError(data.error || 'Failed to create puzzle');
          return;
        }
      } else if (editingPuzzle) {
        const res = await fetch('/api/admin/connections', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingPuzzle.id, groups: editorGroups }),
        });
        if (!res.ok) {
          const data = await res.json();
          setEditorError(data.error || 'Failed to update puzzle');
          return;
        }
      }

      handleCancel();
      await fetchPuzzles();
    } catch {
      setEditorError('Failed to save puzzle');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this puzzle? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/admin/connections?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete puzzle');
        return;
      }
      await fetchPuzzles();
    } catch {
      setError('Failed to delete puzzle');
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const reorder = puzzles.map((p, i) => {
      if (i === index) return { id: p.id, sortOrder: i - 1 };
      if (i === index - 1) return { id: p.id, sortOrder: i + 1 };
      return { id: p.id, sortOrder: i };
    });

    try {
      const res = await fetch('/api/admin/connections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to reorder puzzles');
        return;
      }
      await fetchPuzzles();
    } catch {
      setError('Failed to reorder puzzles');
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index >= puzzles.length - 1) return;
    const reorder = puzzles.map((p, i) => {
      if (i === index) return { id: p.id, sortOrder: i + 1 };
      if (i === index + 1) return { id: p.id, sortOrder: i - 1 };
      return { id: p.id, sortOrder: i };
    });

    try {
      const res = await fetch('/api/admin/connections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to reorder puzzles');
        return;
      }
      await fetchPuzzles();
    } catch {
      setError('Failed to reorder puzzles');
    }
  };

  // ─── Editor group update ──────────────────────────────────────────────
  const updateGroup = (groupIndex: number, field: string, value: string) => {
    setEditorGroups((prev) => {
      const next = prev.map((g) => ({
        ...g,
        words: [...g.words] as [string, string, string, string],
      }));
      if (field === 'category') {
        next[groupIndex]!.category = value;
      } else if (field === 'color') {
        next[groupIndex]!.color = value as ConnectionsGroup['color'];
      }
      return next;
    });
  };

  const updateWord = (groupIndex: number, wordIndex: number, value: string) => {
    setEditorGroups((prev) => {
      const next = prev.map((g) => ({
        ...g,
        words: [...g.words] as [string, string, string, string],
      }));
      next[groupIndex]!.words[wordIndex] = value;
      return next;
    });
  };

  const isEditing = isCreating || editingPuzzle !== null;

  if (loading) {
    return (
      <AdminPageFrame title='Connections Puzzle Editor'>
        <div className='flex items-center justify-center py-20'>
          <div className='h-8 w-8 animate-spin rounded-full border-2 border-faint border-t-primary' />
        </div>
      </AdminPageFrame>
    );
  }

  return (
    <AdminPageFrame
      title='Connections Puzzle Editor'
      subtitle={`${puzzles.length} puzzle${puzzles.length !== 1 ? 's' : ''} in rotation`}
      actions={
        !isEditing ? (
          <ArcadeButton
            type='button'
            onClick={handleCreate}
            tone='primary'
          >
            <Plus size={16} />
            New Puzzle
          </ArcadeButton>
        ) : undefined
      }
      contentClassName='space-y-6'
    >

      {error && (
        <div className='flex flex-wrap items-center gap-2'>
          <ArcadeNotice tone='danger' className='flex-1'>
            {error}
          </ArcadeNotice>
          <ArcadeButton
            type='button'
            onClick={() => setError(null)}
            tone='danger'
            size='sm'
          >
            Dismiss
          </ArcadeButton>
        </div>
      )}

      {/* ── Editor Form ────────────────────────────────────────────────── */}
      {isEditing && (
        <div className='arcade-card space-y-6 p-6'>
          <div className='flex items-center justify-between'>
            <h2 className='text-lg font-semibold text-strong'>
              {isCreating
                ? 'Create New Puzzle'
                : `Edit Puzzle #${(editingPuzzle?.sortOrder ?? 0) + 1}`}
            </h2>
            <div className='flex items-center gap-2'>
              <ArcadeButton
                type='button'
                onClick={() => setShowPreview(!showPreview)}
                size='sm'
              >
                <Eye size={14} />
                {showPreview ? 'Hide Preview' : 'Preview'}
              </ArcadeButton>
              <ArcadeButton
                type='button'
                onClick={handleCancel}
                size='sm'
              >
                <X size={14} />
                Cancel
              </ArcadeButton>
            </div>
          </div>

          {/* Group editors */}
          <div className='space-y-4'>
            {editorGroups.map((group, gi) => (
              <div
                key={gi}
                className='arcade-card-inset space-y-3 p-4'
                style={{ borderLeftWidth: 4, borderLeftColor: group.color }}
              >
                <div className='flex items-center gap-3'>
                  <span className='text-xs font-bold text-faint uppercase tracking-wider'>
                    Group {gi + 1}
                  </span>
                  <select
                    value={group.color}
                    onChange={(e) => updateGroup(gi, 'color', e.target.value)}
                    className='arcade-input w-auto px-2 py-1 text-xs'
                    style={{ color: group.color }}
                  >
                    {DIFFICULTY_COLORS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type='text'
                  value={group.category}
                  onChange={(e) => updateGroup(gi, 'category', e.target.value)}
                  placeholder='Category name'
                  className='arcade-input px-3 py-2 text-sm font-semibold placeholder:text-faint'
                />
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                  {group.words.map((word, wi) => (
                    <input
                      key={wi}
                      type='text'
                      value={word}
                      onChange={(e) => updateWord(gi, wi, e.target.value)}
                      placeholder={`Word ${wi + 1}`}
                      className='arcade-input px-3 py-2 text-sm placeholder:text-faint'
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Preview */}
          {showPreview && (
            <div className='arcade-card-inset border-dashed p-4 space-y-3'>
              <h3 className='text-sm font-semibold text-faint'>
                Preview
              </h3>
              <div className='space-y-2'>
                {editorGroups.map((group, i) => (
                  <div
                    key={i}
                    className='rounded-lg px-4 py-3 text-center'
                    style={{ backgroundColor: group.color }}
                  >
                    <p className='font-bold text-sm text-slate-900 uppercase tracking-wide'>
                      {group.category || '(no category)'}
                    </p>
                    <p className='text-xs text-slate-800 mt-0.5'>
                      {group.words.filter((w) => w).join(', ') || '(no words)'}
                    </p>
                  </div>
                ))}
              </div>
              <div className='grid grid-cols-4 gap-2'>
                {editorGroups
                  .flatMap((g) => g.words)
                  .map((word, i) => (
                    <div
                      key={i}
                      className='rounded-lg border border-soft bg-well px-2 py-3 text-center text-xs font-semibold text-strong'
                    >
                      {word || '-'}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {editorError && <ArcadeNotice tone='danger'>{editorError}</ArcadeNotice>}

          <div className='flex justify-end'>
            <ArcadeButton
              type='button'
              onClick={handleSave}
              disabled={saving}
              tone='primary'
            >
              <Save size={16} />
              {saving
                ? 'Saving...'
                : isCreating
                  ? 'Create Puzzle'
                  : 'Save Changes'}
            </ArcadeButton>
          </div>
        </div>
      )}

      {/* ── Puzzle List ────────────────────────────────────────────────── */}
      {!isEditing && (
        <div className='space-y-3'>
          {puzzles.length === 0 && (
            <div className='arcade-card-inset border-dashed px-6 py-12 text-center'>
              <LayoutGrid
                size={40}
                className='mx-auto text-faint/40 mb-3'
              />
              <p className='text-sm text-faint'>
                No puzzles yet. Create your first puzzle to get started.
              </p>
            </div>
          )}

          {puzzles.map((puzzle, index) => {
            const scheduledDate = getPuzzleDateForIndex(
              puzzle.sortOrder,
              puzzles.length,
            );
            return (
              <div
                key={puzzle.id}
                className='arcade-card p-4 transition hover:border-primary/30'
              >
                <div className='flex items-start gap-3'>
                  {/* Reorder buttons */}
                  <div className='flex flex-col gap-1 pt-1'>
                    <ArcadeButton
                      type='button'
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      tone='ghost'
                      size='icon-xs'
                      aria-label='Move up'
                    >
                      <ChevronUp size={16} />
                    </ArcadeButton>
                    <ArcadeButton
                      type='button'
                      onClick={() => handleMoveDown(index)}
                      disabled={index >= puzzles.length - 1}
                      tone='ghost'
                      size='icon-xs'
                      aria-label='Move down'
                    >
                      <ChevronDown size={16} />
                    </ArcadeButton>
                  </div>

                  {/* Puzzle info */}
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 flex-wrap'>
                      <span className='text-sm font-bold text-strong'>
                        #{puzzle.sortOrder + 1}
                      </span>
                      {scheduledDate && (
                        <span className='inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-xs text-faint'>
                          <CalendarDays size={11} />
                          {scheduledDate}
                        </span>
                      )}
                    </div>
                    <div className='mt-2 flex flex-wrap gap-1.5'>
                      {puzzle.groups.map((group, gi) => (
                        <span
                          key={gi}
                          className='inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold text-slate-900'
                          style={{ backgroundColor: group.color }}
                        >
                          {group.category}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className='flex items-center gap-1'>
                    <ArcadeButton
                      type='button'
                      onClick={() => handleEdit(puzzle)}
                      size='icon-sm'
                      aria-label='Edit puzzle'
                    >
                      <Pencil size={16} />
                    </ArcadeButton>
                    <ArcadeButton
                      type='button'
                      onClick={() => handleDelete(puzzle.id)}
                      tone='danger'
                      size='icon-sm'
                      aria-label='Delete puzzle'
                    >
                      <Trash2 size={16} />
                    </ArcadeButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Blackout Dates ──────────────────────────────────────────────── */}
      {!isEditing && (
        <div className='arcade-card space-y-5 p-6'>
          <div>
            <h2 className='text-lg font-semibold text-strong flex items-center gap-2'>
              <CalendarOff size={20} className='text-red-400' />
              Off Days &amp; Blackout Dates
            </h2>
            <p className='mt-1 text-sm text-faint'>
              Days marked here skip the puzzle and preserve everyone&apos;s
              streak. Federal holidays are automatic.
            </p>
          </div>

          {/* Add new blackout */}
          <div className='flex flex-col gap-2 sm:flex-row sm:items-end'>
            <div className='flex-1'>
              <label className='block text-xs font-medium text-faint mb-1'>
                Date
              </label>
              <input
                type='date'
                value={newBlackoutDate}
                onChange={(e) => setNewBlackoutDate(e.target.value)}
                className='arcade-input px-3 py-2 text-sm'
              />
            </div>
            <div className='flex-[2]'>
              <label className='block text-xs font-medium text-faint mb-1'>
                Reason
              </label>
              <input
                type='text'
                value={newBlackoutReason}
                onChange={(e) => setNewBlackoutReason(e.target.value)}
                placeholder='e.g., Training day, Down day, DONSA'
                className='arcade-input px-3 py-2 text-sm placeholder:text-faint'
              />
            </div>
            <ArcadeButton
              type='button'
              onClick={handleAddBlackout}
              tone='danger'
            >
              <Plus size={14} />
              Add
            </ArcadeButton>
          </div>

          {blackoutError && (
            <ArcadeNotice tone='danger'>{blackoutError}</ArcadeNotice>
          )}

          {/* Admin blackout dates list */}
          {blackouts.length > 0 && (
            <div className='space-y-1.5'>
              <p className='text-xs font-semibold text-faint uppercase tracking-wider'>
                Custom Off Days
              </p>
              {blackouts.map((b) => (
                <div
                  key={b.date}
                  className='flex items-center justify-between rounded-lg border border-danger/20 bg-danger/5 px-3 py-2'
                >
                  <div className='flex items-center gap-3'>
                    <CalendarOff size={14} className='text-red-400' />
                    <span className='text-sm font-medium text-strong'>
                      {b.date}
                    </span>
                    <span className='text-sm text-faint'>
                      {b.reason}
                    </span>
                  </div>
                  <ArcadeButton
                    type='button'
                    onClick={() => handleRemoveBlackout(b.date)}
                    tone='danger'
                    size='icon-sm'
                    aria-label={`Remove blackout for ${b.date}`}
                  >
                    <Trash2 size={14} />
                  </ArcadeButton>
                </div>
              ))}
            </div>
          )}

          {/* Federal holidays (read-only) */}
          {holidays.length > 0 && (
            <div className='space-y-1.5'>
              <p className='text-xs font-semibold text-faint uppercase tracking-wider'>
                Federal Holidays (automatic)
              </p>
              <div className='grid gap-1 sm:grid-cols-2'>
                {holidays
                  .filter(
                    (h) => h.date >= new Date().toISOString().slice(0, 10),
                  )
                  .slice(0, 20)
                  .map((h) => (
                    <div
                      key={h.date}
                      className='flex items-center gap-2 rounded-lg border border-soft bg-raised px-3 py-1.5'
                    >
                      <Star size={12} className='text-tickets-text' />
                      <span className='text-xs font-medium text-strong'>
                        {h.date}
                      </span>
                      <span className='text-xs text-faint'>
                        {h.name}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminPageFrame>
  );
}
