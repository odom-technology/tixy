import { query } from '@/server/db/client';

type ItemLike = {
  id: string;
  setLabels?: string[];
  setStats?: Array<{ label: string; totalItems: number }>;
};

type StateLike = {
  rotation: Array<{ item: ItemLike }>;
  ownedItems: Array<{ item: ItemLike }>;
  equipped: Array<{ item: ItemLike }>;
};

type InventoryLike = {
  ownedItems: Array<{ item: ItemLike }>;
  equipped: Array<{ item: ItemLike }>;
};

type SkinGroupRow = {
  id: string;
  name: string;
  active: boolean | number | string;
  item_id: string | null;
};

const normalizeBoolean = (value: boolean | number | string) =>
  value === true || value === 1 || value === '1' || value === 'true';

const buildItemSetLabelsMap = async () => {
  const map = new Map<string, Map<string, string>>();
  const totalsMap = new Map<string, Map<string, { label: string; totalItems: number }>>();
  const rows = (
    await query<SkinGroupRow>(
      `SELECT g.id, g.name, g.active, gi.item_id
       FROM skin_groups g
       LEFT JOIN skin_group_items gi ON gi.group_id = g.id
       ORDER BY g.name ASC, gi.sort_order ASC, gi.item_id ASC`,
    )
  ).rows;
  const itemIdsByGroup = new Map<string, string[]>();
  const nameByGroup = new Map<string, string>();
  const activeByGroup = new Map<string, boolean>();
  for (const row of rows) {
    nameByGroup.set(row.id, row.name);
    activeByGroup.set(row.id, normalizeBoolean(row.active));
    if (!row.item_id) continue;
    const itemIds = itemIdsByGroup.get(row.id) ?? [];
    itemIds.push(row.item_id);
    itemIdsByGroup.set(row.id, itemIds);
  }

  for (const [groupId, groupName] of nameByGroup) {
    if (!activeByGroup.get(groupId)) continue;
    const normalizedLabel = groupName.trim();
    if (!normalizedLabel) continue;
    const labelKey = normalizedLabel.toLowerCase();
    const itemIds = itemIdsByGroup.get(groupId) ?? [];
    for (const itemId of itemIds) {
      const current = map.get(itemId) ?? new Map<string, string>();
      current.set(labelKey, normalizedLabel);
      map.set(itemId, current);

      const totals = totalsMap.get(itemId) ?? new Map<string, { label: string; totalItems: number }>();
      totals.set(labelKey, {
        label: normalizedLabel,
        totalItems: itemIds.length,
      });
      totalsMap.set(itemId, totals);
    }
  }
  const flattened = new Map<
    string,
    { labels: string[]; stats: Array<{ label: string; totalItems: number }> }
  >();
  for (const [itemId, labelMap] of map) {
    const statsMap = totalsMap.get(itemId) ?? new Map();
    flattened.set(
      itemId,
      {
        labels: Array.from(labelMap.values()).sort((a, b) => a.localeCompare(b)),
        stats: Array.from(statsMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
      },
    );
  }
  return flattened;
};

const attachSetLabelsToItem = (
  item: ItemLike,
  map: Map<
    string,
    { labels: string[]; stats: Array<{ label: string; totalItems: number }> }
  >,
) => {
  const setMeta = map.get(item.id);
  return {
    ...item,
    setLabels: [...(setMeta?.labels ?? [])],
    setStats: [...(setMeta?.stats ?? [])],
  };
};

export const attachSetLabelsToStoreState = async <T extends StateLike>(state: T): Promise<T> => {
  const labelsByItemId = await buildItemSetLabelsMap();

  return {
    ...state,
    rotation: state.rotation.map((entry) => ({
      ...entry,
      item: attachSetLabelsToItem(entry.item, labelsByItemId),
    })),
    ownedItems: state.ownedItems.map((entry) => ({
      ...entry,
      item: attachSetLabelsToItem(entry.item, labelsByItemId),
    })),
    equipped: state.equipped.map((entry) => ({
      ...entry,
      item: attachSetLabelsToItem(entry.item, labelsByItemId),
    })),
  };
};

export const attachSetLabelsToInventoryState = async <T extends InventoryLike>(
  state: T,
): Promise<T> => {
  const labelsByItemId = await buildItemSetLabelsMap();

  return {
    ...state,
    ownedItems: state.ownedItems.map((entry) => ({
      ...entry,
      item: attachSetLabelsToItem(entry.item, labelsByItemId),
    })),
    equipped: state.equipped.map((entry) => ({
      ...entry,
      item: attachSetLabelsToItem(entry.item, labelsByItemId),
    })),
  };
};
