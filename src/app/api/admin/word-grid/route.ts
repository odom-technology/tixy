import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { wordGridPuzzles } from '@/server/db/schema';
import { responseJson, withAdmin } from '@/server/admin/guard';
import { isValidGuess, WORD_GRID_ANSWERS } from '@/server/arcade/word-grid';
import { invalidateDailyPuzzlePools } from '@/server/arcade/daily-puzzle-pool';

export const dynamic = 'force-dynamic';

function normalizeAnswer(raw: unknown): { ok: boolean; error?: string; answer?: string } {
  const a = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(a)) return { ok: false, error: 'Answer must be 5 letters (a–z).' };
  if (!isValidGuess(a)) return { ok: false, error: `"${a.toUpperCase()}" is not in the word list.` };
  return { ok: true, answer: a };
}

async function nextSortOrder(): Promise<number> {
  const rows = await db.select({ sortOrder: wordGridPuzzles.sortOrder }).from(wordGridPuzzles);
  return rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0;
}

export const GET = withAdmin(async () => {
  const rows = await db.select().from(wordGridPuzzles).orderBy(asc(wordGridPuzzles.sortOrder));
  return NextResponse.json({
    puzzles: rows.map((p) => ({ id: p.id, sortOrder: p.sortOrder, answer: p.answer })),
  });
});

export const POST = withAdmin(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { seedDefaults?: boolean; answer?: unknown };

  if (body.seedDefaults) {
    const existing = await db.select({ id: wordGridPuzzles.id }).from(wordGridPuzzles);
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Pool already has answers — clear it first.' }, { status: 400 });
    }
    let i = 0;
    for (const answer of WORD_GRID_ANSWERS) {
      await db.insert(wordGridPuzzles).values({ id: crypto.randomUUID(), sortOrder: i, answer });
      i += 1;
    }
    invalidateDailyPuzzlePools();
    return NextResponse.json({ success: true, seeded: WORD_GRID_ANSWERS.length });
  }

  const v = normalizeAnswer(body.answer);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const id = crypto.randomUUID();
  await db.insert(wordGridPuzzles).values({ id, sortOrder: await nextSortOrder(), answer: v.answer! });
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true, id });
}, {
  audit: async ({ body, response }) => {
    const input = (body ?? {}) as { seedDefaults?: unknown };
    if (input.seedDefaults) {
      return { action: 'puzzle.word-grid.seed', targetType: 'puzzle', targetId: 'word-grid', details: { game: 'word-grid' } };
    }
    const created = await responseJson(response);
    return {
      action: 'puzzle.word-grid.create',
      targetType: 'puzzle',
      targetId: typeof created.id === 'string' ? created.id : null,
      details: { game: 'word-grid' },
    };
  },
});

export const PUT = withAdmin(async (request) => {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    answer?: unknown;
    reorder?: { id: string; sortOrder: number }[];
  };

  if (Array.isArray(body.reorder)) {
    for (const item of body.reorder) {
      if (typeof item.id !== 'string' || typeof item.sortOrder !== 'number') {
        return NextResponse.json({ error: 'Invalid reorder data' }, { status: 400 });
      }
    }
    for (const item of body.reorder) {
      await db.update(wordGridPuzzles).set({ sortOrder: item.sortOrder + 1_000_000 }).where(eq(wordGridPuzzles.id, item.id));
    }
    for (const item of body.reorder) {
      await db.update(wordGridPuzzles).set({ sortOrder: item.sortOrder }).where(eq(wordGridPuzzles.id, item.id));
    }
    invalidateDailyPuzzlePools();
    return NextResponse.json({ success: true });
  }

  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const v = normalizeAnswer(body.answer);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  await db.update(wordGridPuzzles).set({ answer: v.answer! }).where(eq(wordGridPuzzles.id, body.id));
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true });
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { id?: unknown; reorder?: unknown };
    const reorder = Array.isArray(input.reorder);
    return {
      action: reorder ? 'puzzle.word-grid.reorder' : 'puzzle.word-grid.update',
      targetType: 'puzzle',
      targetId: reorder ? 'word-grid' : typeof input.id === 'string' ? input.id : null,
      details: { game: 'word-grid', count: reorder ? (input.reorder as unknown[]).length : undefined },
    };
  },
});

export const DELETE = withAdmin(async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await db.delete(wordGridPuzzles).where(eq(wordGridPuzzles.id, id));
  const remaining = await db.select().from(wordGridPuzzles).orderBy(asc(wordGridPuzzles.sortOrder));
  for (let i = 0; i < remaining.length; i += 1) {
    if (remaining[i]!.sortOrder !== i) {
      await db.update(wordGridPuzzles).set({ sortOrder: i }).where(eq(wordGridPuzzles.id, remaining[i]!.id));
    }
  }
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true });
}, {
  audit: ({ searchParams }) => ({
    action: 'puzzle.word-grid.delete',
    targetType: 'puzzle',
    targetId: searchParams.get('id'),
    details: { game: 'word-grid' },
  }),
});
