import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { connectionsBlackoutDates } from '@/server/db/schema';
import { withAdmin } from '@/server/admin/guard';
import {
  invalidateBlackoutCache,
  getFederalHolidays,
} from '@/server/arcade/connections-calendar';

// GET — list all blackout dates + upcoming holidays
export const GET = withAdmin(async () => {
  try {
    const blackouts = await db
      .select()
      .from(connectionsBlackoutDates)
      .orderBy(asc(connectionsBlackoutDates.date));

    // Include federal holidays for current and next year
    const now = new Date();
    const thisYear = now.getFullYear();
    const holidays = [
      ...getFederalHolidays(thisYear).entries(),
      ...getFederalHolidays(thisYear + 1).entries(),
    ].map(([date, name]) => ({ date, name }));

    return NextResponse.json({ blackouts, holidays });
  } catch (error) {
    console.error('Failed to fetch blackout dates:', error);
    return NextResponse.json({ error: 'Failed to fetch blackout dates' }, { status: 500 });
  }
});

// POST — add a blackout date
export const POST = withAdmin(async (request, { identity }) => {
  try {
    const body = await request.json();
    const { date, reason } = body as { date?: string; reason?: string };

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format (YYYY-MM-DD).' }, { status: 400 });
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ error: 'Reason is required.' }, { status: 400 });
    }

    const now = Date.now();
    const userName = identity.name || identity.email || 'admin';

    await db.insert(connectionsBlackoutDates).values({
      date,
      reason: reason.trim(),
      createdBy: userName,
      createdAt: now,
    }).onConflictDoUpdate({
      target: connectionsBlackoutDates.date,
      set: {
        reason: reason.trim(),
        createdBy: userName,
        createdAt: now,
      },
    });

    invalidateBlackoutCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to add blackout date:', error);
    return NextResponse.json({ error: 'Failed to add blackout date' }, { status: 500 });
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { date?: unknown; reason?: unknown };
    return {
      action: 'puzzle.connections.blackout.create',
      targetType: 'puzzle',
      targetId: typeof input.date === 'string' ? input.date : null,
      reason: typeof input.reason === 'string' ? input.reason : null,
      details: { game: 'connections', date: input.date },
    };
  },
});

// DELETE — remove a blackout date
export const DELETE = withAdmin(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    }

    await db
      .delete(connectionsBlackoutDates)
      .where(eq(connectionsBlackoutDates.date, date));

    invalidateBlackoutCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to remove blackout date:', error);
    return NextResponse.json({ error: 'Failed to remove blackout date' }, { status: 500 });
  }
}, {
  audit: ({ searchParams }) => ({
    action: 'puzzle.connections.blackout.delete',
    targetType: 'puzzle',
    targetId: searchParams.get('date'),
    details: { game: 'connections', date: searchParams.get('date') },
  }),
});
