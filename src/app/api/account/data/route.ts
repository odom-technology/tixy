import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  deleteAccountData,
  getAccountData,
  listAccountData,
  saveAccountData,
} from '@/server/accounts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get('key')?.trim();
  try {
    if (key) {
      return NextResponse.json({ item: await getAccountData(identity.userId, key) });
    }
    return NextResponse.json({ items: await listAccountData(identity.userId) });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to load account data.' },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { key?: string; value?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.key?.trim()) {
    return NextResponse.json({ error: 'key is required.' }, { status: 400 });
  }

  try {
    const item = await saveAccountData({
      userId: identity.userId,
      key: body.key,
      value: body.value ?? null,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to save account data.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get('key')?.trim();
  if (!key) {
    return NextResponse.json({ error: 'key is required.' }, { status: 400 });
  }

  try {
    await deleteAccountData(identity.userId, key);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to delete account data.' },
      { status: 400 },
    );
  }
}
