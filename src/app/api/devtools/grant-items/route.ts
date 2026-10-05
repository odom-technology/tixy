import { NextResponse } from 'next/server';
import { withAdmin } from '@/server/admin/guard';
import { query, queryOne } from '@/server/db/client';
import { grantStoreItem } from '@/server/arcade/rewards';

/**
 * POST /api/dev/grant-items
 *
 * Grants all store items (or filtered by gameType) to the current user.
 * Admin-only. For dev/testing — allows testing cosmetics without purchasing.
 *
 * Body: { gameType?: string }
 */
export const POST = withAdmin(async (request, { identity }) => {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production.' }, { status: 403 });
  }

  let body: { gameType?: string } = {};
  try {
    body = await request.json();
  } catch { /* empty body is fine */ }

  const whereClause = body.gameType
    ? 'WHERE game_type = $1'
    : '';
  const params = body.gameType ? [body.gameType] : [];

  const items = (
    await query<{ id: string; name: string; game_type: string; rarity: string }>(
      `SELECT id, name, game_type, rarity FROM store_items ${whereClause} ORDER BY game_type, rarity`,
      params,
    )
  ).rows;

  let granted = 0;
  let skipped = 0;
  const results: Array<{ id: string; name: string; status: string }> = [];

  for (const item of items) {
    const hasOwnership = await queryOne(
      'SELECT 1 FROM user_owned_items WHERE user_id = $1 AND item_id = $2 LIMIT 1',
      [identity.userId, item.id],
    );
    if (hasOwnership) {
      skipped++;
      results.push({ id: item.id, name: item.name, status: 'already_owned' });
      continue;
    }

    try {
      await grantStoreItem({
        itemId: item.id,
        userId: identity.userId,
        grantToAll: false,
        actorUserId: identity.userId,
      });
      granted++;
      results.push({ id: item.id, name: item.name, status: 'granted' });
    } catch {
      results.push({ id: item.id, name: item.name, status: 'failed' });
    }
  }

  return NextResponse.json({
    granted,
    skipped,
    total: items.length,
    gameType: body.gameType ?? 'all',
    results,
  });
}, {
  audit: ({ body, identity }) => ({
    action: 'dev.grant_items',
    targetType: 'user',
    targetId: identity.userId,
    details: { game: (body as { gameType?: unknown } | null)?.gameType },
  }),
});
