import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { pangramPuzzles } from '@/server/db/schema';
import { responseJson, withAdmin } from '@/server/admin/guard';
import {
  PANGRAM_SETS,
  validatePangramSet,
  type PangramSet,
} from '@/server/arcade/pangram';
import { invalidateDailyPuzzlePools } from '@/server/arcade/daily-puzzle-pool';

export const dynamic = 'force-dynamic';

type PangramInput = { letters: string[]; center: string };

/** Validate + normalize a letter set through the same quality gate as the
 * runtime DB loader, so saved hives cannot break the daily rotation. */
function normalizeSet(
  raw: unknown,
): { ok: boolean; error?: string; set?: PangramSet; words?: number } {
  const validation = validatePangramSet(raw);
  if (!validation.ok) return validation;
  return {
    ok: true,
    set: validation.set,
    words: validation.solutions.words.length,
  };
}

async function nextSortOrder(): Promise<number> {
  const rows = await db.select({ sortOrder: pangramPuzzles.sortOrder }).from(pangramPuzzles);
  return rows.length > 0 ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0;
}

export const GET = withAdmin(async () => {
  const rows = await db.select().from(pangramPuzzles).orderBy(asc(pangramPuzzles.sortOrder));
  const puzzles = rows.map((p) => {
    let letters: string[] = [];
    try {
      letters = JSON.parse(p.lettersJson) as string[];
    } catch {
      /* skip */
    }
    return { id: p.id, sortOrder: p.sortOrder, letters, center: p.center };
  });
  return NextResponse.json({ puzzles });
});

export const POST = withAdmin(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { seedDefaults?: boolean } & PangramInput;

  // Seed the in-code defaults into the DB (one-click populate for the editor).
  if (body.seedDefaults) {
    const existing = await db.select({ id: pangramPuzzles.id }).from(pangramPuzzles);
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Pool already has puzzles — clear it first.' }, { status: 400 });
    }
    let i = 0;
    for (const set of PANGRAM_SETS) {
      await db.insert(pangramPuzzles).values({
        id: crypto.randomUUID(),
        sortOrder: i,
        lettersJson: JSON.stringify(set.letters),
        center: set.center,
      });
      i += 1;
    }
    invalidateDailyPuzzlePools();
    return NextResponse.json({ success: true, seeded: PANGRAM_SETS.length });
  }

  const v = normalizeSet(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const id = crypto.randomUUID();
  await db.insert(pangramPuzzles).values({
    id,
    sortOrder: await nextSortOrder(),
    lettersJson: JSON.stringify(v.set!.letters),
    center: v.set!.center,
  });
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true, id, words: v.words });
}, {
  audit: async ({ body, response }) => {
    const input = (body ?? {}) as { seedDefaults?: unknown };
    if (input.seedDefaults) {
      return { action: 'puzzle.pangram.seed', targetType: 'puzzle', targetId: 'pangram', details: { game: 'pangram' } };
    }
    const created = await responseJson(response);
    return {
      action: 'puzzle.pangram.create',
      targetType: 'puzzle',
      targetId: typeof created.id === 'string' ? created.id : null,
      details: { game: 'pangram' },
    };
  },
});

export const PUT = withAdmin(async (request) => {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    reorder?: { id: string; sortOrder: number }[];
  } & PangramInput;

  if (Array.isArray(body.reorder)) {
    const now = body.reorder;
    for (const item of now) {
      if (typeof item.id !== 'string' || typeof item.sortOrder !== 'number') {
        return NextResponse.json({ error: 'Invalid reorder data' }, { status: 400 });
      }
    }
    // Two-pass shift to dodge the unique-ish ordering collisions.
    for (const item of now) {
      await db.update(pangramPuzzles).set({ sortOrder: item.sortOrder + 1_000_000 }).where(eq(pangramPuzzles.id, item.id));
    }
    for (const item of now) {
      await db.update(pangramPuzzles).set({ sortOrder: item.sortOrder }).where(eq(pangramPuzzles.id, item.id));
    }
    invalidateDailyPuzzlePools();
    return NextResponse.json({ success: true });
  }

  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const v = normalizeSet(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  await db
    .update(pangramPuzzles)
    .set({ lettersJson: JSON.stringify(v.set!.letters), center: v.set!.center })
    .where(eq(pangramPuzzles.id, body.id));
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true, words: v.words });
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { id?: unknown; reorder?: unknown };
    const reorder = Array.isArray(input.reorder);
    return {
      action: reorder ? 'puzzle.pangram.reorder' : 'puzzle.pangram.update',
      targetType: 'puzzle',
      targetId: reorder ? 'pangram' : typeof input.id === 'string' ? input.id : null,
      details: { game: 'pangram', count: reorder ? (input.reorder as unknown[]).length : undefined },
    };
  },
});

export const DELETE = withAdmin(async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await db.delete(pangramPuzzles).where(eq(pangramPuzzles.id, id));
  // Re-compact sort orders.
  const remaining = await db.select().from(pangramPuzzles).orderBy(asc(pangramPuzzles.sortOrder));
  for (let i = 0; i < remaining.length; i += 1) {
    if (remaining[i]!.sortOrder !== i) {
      await db.update(pangramPuzzles).set({ sortOrder: i }).where(eq(pangramPuzzles.id, remaining[i]!.id));
    }
  }
  invalidateDailyPuzzlePools();
  return NextResponse.json({ success: true });
}, {
  audit: ({ searchParams }) => ({
    action: 'puzzle.pangram.delete',
    targetType: 'puzzle',
    targetId: searchParams.get('id'),
    details: { game: 'pangram' },
  }),
});
