'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';

import {
  StoreCatalogTable,
  type StoreCatalogTableGroup,
  type StoreCatalogTableItem,
  type StoreCatalogTableSelection,
} from './store-catalog-table';

type AdminCatalogPanelProps<
  Item extends StoreCatalogTableItem,
  Group extends StoreCatalogTableGroup,
> = {
  title?: string;
  loading: boolean;
  items: Item[];
  groups: Group[];
  allowedGameTypes?: string[];
  inStoreItemIds?: Set<string>;
  actions?: ReactNode;
  selection?: StoreCatalogTableSelection;
  rowActions?: (item: Item) => ReactNode;
  onVisibleItemsChange?: (visibleItems: Item[]) => void;
  defaultCollapsed?: boolean;
  presentation?: 'default' | 'console';
  busy?: boolean;
  className?: string;
};

export function AdminCatalogPanel<
  Item extends StoreCatalogTableItem = StoreCatalogTableItem,
  Group extends StoreCatalogTableGroup = StoreCatalogTableGroup,
>({
  title = 'Item Catalog',
  loading,
  items,
  groups,
  allowedGameTypes,
  inStoreItemIds,
  actions,
  selection,
  rowActions,
  onVisibleItemsChange,
  defaultCollapsed = false,
  presentation = 'default',
  busy = false,
  className,
}: AdminCatalogPanelProps<Item, Group>) {
  const scopedItems = useMemo(() => {
    if (!allowedGameTypes || allowedGameTypes.length === 0) {
      return items;
    }

    const allowed = new Set(allowedGameTypes);
    return items.filter((item) => allowed.has(item.gameType));
  }, [allowedGameTypes, items]);

  return (
    <StoreCatalogTable
      title={title}
      loading={loading}
      items={scopedItems}
      groups={groups}
      inStoreItemIds={inStoreItemIds}
      actions={actions}
      selection={selection}
      rowActions={rowActions}
      onVisibleItemsChange={onVisibleItemsChange}
      defaultCollapsed={defaultCollapsed}
      presentation={presentation}
      busy={busy}
      className={className}
    />
  );
}
