import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { db, withTransaction } from '@/server/db/client';
import { connectionsPuzzles } from '@/server/db/schema';
import { responseJson, withAdmin } from '@/server/admin/guard';

type ConnectionsGroup = {
  category: string;
  words: [string, string, string, string];
  color: '#f8d74e' | '#7ed66e' | '#6eb4f8' | '#c97ed6';
};

const VALID_COLORS = new Set(['#f8d74e', '#7ed66e', '#6eb4f8', '#c97ed6']);

function validateGroups(groups: unknown): groups is ConnectionsGroup[] {
  if (!Array.isArray(groups) || groups.length !== 4) return false;
  const allWords = new Set<string>();
  for (const g of groups) {
    if (!g || typeof g !== 'object') return false;
    const group = g as Record<string, unknown>;
    if (typeof group.category !== 'string' || !group.category.trim()) return false;
    if (!VALID_COLORS.has(group.color as string)) return false;
    if (!Array.isArray(group.words) || group.words.length !== 4) return false;
    for (const w of group.words) {
      if (typeof w !== 'string' || !w.trim()) return false;
      if (allWords.has(w.trim().toLowerCase())) return false;
      allWords.add(w.trim().toLowerCase());
    }
  }
  return allWords.size === 16;
}

// GET — list all puzzles ordered by sort_order
export const GET = withAdmin(async () => {
  try {
    const puzzles = await db
      .select()
      .from(connectionsPuzzles)
      .orderBy(asc(connectionsPuzzles.sortOrder));

    const result = puzzles.map((p) => ({
      id: p.id,
      sortOrder: p.sortOrder,
      groups: JSON.parse(p.groupsJson) as ConnectionsGroup[],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json({ puzzles: result });
  } catch (error) {
    console.error('Failed to fetch puzzles:', error);
    return NextResponse.json({ error: 'Failed to fetch puzzles' }, { status: 500 });
  }
});

// POST — create a new puzzle
export const POST = withAdmin(async (request) => {
  try {
    const body = await request.json();
    const { groups } = body as { groups: unknown };

    if (!validateGroups(groups)) {
      return NextResponse.json(
        { error: 'Invalid puzzle data. Need 4 groups with 4 unique words each (16 total).' },
        { status: 400 },
      );
    }

    const lastPuzzle = await db
      .select({ sortOrder: connectionsPuzzles.sortOrder })
      .from(connectionsPuzzles)
      .orderBy(asc(connectionsPuzzles.sortOrder));

    const nextSortOrder = lastPuzzle.length > 0
      ? Math.max(...lastPuzzle.map((p) => p.sortOrder)) + 1
      : 0;

    const now = Date.now();
    const id = crypto.randomUUID();

    await db.insert(connectionsPuzzles).values({
      id,
      sortOrder: nextSortOrder,
      groupsJson: JSON.stringify(groups),
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      puzzle: {
        id,
        sortOrder: nextSortOrder,
        groups,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    console.error('Failed to create puzzle:', error);
    return NextResponse.json({ error: 'Failed to create puzzle' }, { status: 500 });
  }
}, {
  audit: async ({ response }) => {
    const created = (await responseJson(response)).puzzle as { id?: unknown } | undefined;
    return {
      action: 'puzzle.connections.create',
      targetType: 'puzzle',
      targetId: typeof created?.id === 'string' ? created.id : null,
      details: { game: 'connections' },
    };
  },
});

// PUT — update a puzzle or reorder
export const PUT = withAdmin(async (request) => {
  try {
    const body = await request.json();
    const { id, groups, reorder } = body as {
      id?: string;
      groups?: unknown;
      reorder?: { id: string; sortOrder: number }[];
    };

    // Bulk reorder
    if (Array.isArray(reorder)) {
      for (const item of reorder) {
        if (typeof item.id !== 'string' || typeof item.sortOrder !== 'number') {
          return NextResponse.json({ error: 'Invalid reorder data' }, { status: 400 });
        }
      }

      // Use a transaction with a two-pass approach to avoid unique constraint
      // collisions: first shift all affected rows to temporary high values,
      // then set the final sort orders.
      const now = Date.now();
      const offset = 1_000_000;
      const updateSortOrderSql =
        'UPDATE connections_puzzles SET sort_order = $1, updated_at = $2 WHERE id = $3';
      await withTransaction(async (client) => {
        for (const item of reorder) {
          await client.query(updateSortOrderSql, [
            item.sortOrder + offset,
            now,
            item.id,
          ]);
        }
        for (const item of reorder) {
          await client.query(updateSortOrderSql, [item.sortOrder, now, item.id]);
        }
      });

      return NextResponse.json({ success: true });
    }

    // Single puzzle update
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing puzzle id' }, { status: 400 });
    }

    if (!validateGroups(groups)) {
      return NextResponse.json(
        { error: 'Invalid puzzle data. Need 4 groups with 4 unique words each (16 total).' },
        { status: 400 },
      );
    }

    const now = Date.now();
    await db
      .update(connectionsPuzzles)
      .set({ groupsJson: JSON.stringify(groups), updatedAt: now })
      .where(eq(connectionsPuzzles.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update puzzle:', error);
    return NextResponse.json({ error: 'Failed to update puzzle' }, { status: 500 });
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { id?: unknown; reorder?: unknown };
    const reorder = Array.isArray(input.reorder);
    return {
      action: reorder ? 'puzzle.connections.reorder' : 'puzzle.connections.update',
      targetType: 'puzzle',
      targetId: reorder ? 'connections' : typeof input.id === 'string' ? input.id : null,
      details: { game: 'connections', count: reorder ? (input.reorder as unknown[]).length : undefined },
    };
  },
});

// DELETE — remove a puzzle
export const DELETE = withAdmin(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing puzzle id' }, { status: 400 });
    }

    await db.delete(connectionsPuzzles).where(eq(connectionsPuzzles.id, id));

    // Re-compact sort orders
    const remaining = await db
      .select()
      .from(connectionsPuzzles)
      .orderBy(asc(connectionsPuzzles.sortOrder));

    const now = Date.now();
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.sortOrder !== i) {
        await db
          .update(connectionsPuzzles)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(connectionsPuzzles.id, remaining[i]!.id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete puzzle:', error);
    return NextResponse.json({ error: 'Failed to delete puzzle' }, { status: 500 });
  }
}, {
  audit: ({ searchParams }) => ({
    action: 'puzzle.connections.delete',
    targetType: 'puzzle',
    targetId: searchParams.get('id'),
    details: { game: 'connections' },
  }),
});
