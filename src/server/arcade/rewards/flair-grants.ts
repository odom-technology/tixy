// Grant a profile flair item via the "earned" path (acquired_source='reward').
// Returns true only on a NEW grant, and announces it (activity + notification).
import { query, queryOne } from '@/server/db/client';
import { playerItemName } from '@/features/arcade/lib/item-names';
import { recordActivityEvent } from '@/server/services/activity-events';
import { createNotification } from '@/server/services/notifications';

export async function grantEarnedFlair(userId: string, itemId: string): Promise<boolean> {
  const item = await queryOne<{ name: string }>(
    `SELECT name FROM store_items WHERE id = $1 AND game_type = 'profile'`,
    [itemId],
  );
  if (!item) return false;

  const result = await query(
    `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
     VALUES ($1, $2, $3, 'reward')
     ON CONFLICT (user_id, item_id) DO NOTHING`,
    [userId, itemId, Date.now()],
  );
  const granted = (result.rowCount ?? 0) > 0;
  if (granted) {
    void recordActivityEvent({ userId, type: 'achievement', payload: { title: playerItemName(item.name) } });
    void createNotification({
      userId,
      type: 'achievement',
      title: 'Flair unlocked',
      body: `You earned ${playerItemName(item.name)}. Equip it from your inventory.`,
      href: '/inventory',
      preferenceKey: 'game_notifications',
    });
  }
  return granted;
}
