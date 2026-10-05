'use client';

import type { Dispatch, SetStateAction } from 'react';
import type {
  ItemDraft,
  Metadata,
  SkinGroup,
  StoreRarity,
} from './_types';
import type { ItemGroupMode } from './_utils';

export function ItemCoreForm({
  itemDraft,
  setItemDraft,
  metadata,
  liveCreditsPricePreview,
}: {
  itemDraft: ItemDraft;
  setItemDraft: Dispatch<SetStateAction<ItemDraft>>;
  metadata: Metadata;
  liveCreditsPricePreview: number;
}) {
  return (
    <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
      <label className='text-sm space-y-1'>
        <span>Name</span>
        <input
          className='w-full rounded-lg border border-soft bg-background px-3 py-2'
          value={itemDraft.name}
          onChange={(e) =>
            setItemDraft((prev) => ({ ...prev, name: e.target.value }))
          }
        />
        <p className='text-[11px] font-mono text-faint'>
          Item ID: {itemDraft.id || 'Auto-generated from Name + Game'}
        </p>
      </label>
      <label className='text-sm space-y-1'>
        <span>Game</span>
        <select
          className='w-full rounded-lg border border-soft bg-background px-3 py-2'
          value={itemDraft.gameType}
          onChange={(e) =>
            setItemDraft((prev) => ({
              ...prev,
              gameType: e.target.value,
              slots: [],
            }))
          }
        >
          {metadata.gameTypes.map((gt) => (
            <option key={gt} value={gt}>
              {gt}
            </option>
          ))}
        </select>
      </label>
      <label className='text-sm space-y-1'>
        <span>Rarity</span>
        <select
          className='w-full rounded-lg border border-soft bg-background px-3 py-2'
          value={itemDraft.rarity}
          onChange={(e) =>
            setItemDraft((prev) => ({
              ...prev,
              rarity: e.target.value as StoreRarity,
            }))
          }
        >
          {metadata.rarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className='text-sm space-y-1'>
        <span>Currency</span>
        <div className='w-full rounded-lg border border-soft bg-raised px-3 py-2 text-sm text-strong'>
          Tickets
        </div>
      </label>
      <div className='rounded-lg border border-soft bg-raised p-3 text-sm text-strong'>
        <span className='block text-xs text-faint'>Live price preview</span>
        <strong className='mt-1 block text-lg'>{liveCreditsPricePreview} Tickets</strong>
        <span className='block text-xs text-faint'>Calculated from slot, rarity, theme, and effects.</span>
      </div>
      <label className='flex items-center gap-2 text-sm'>
        <input
          type='checkbox'
          checked={itemDraft.active}
          onChange={(e) =>
            setItemDraft((prev) => ({
              ...prev,
              active: e.target.checked,
            }))
          }
        />
        <span>Active in store pool</span>
      </label>
    </div>
  );
}

export function ItemGroupingForm({
  itemGroupMode,
  setItemGroupMode,
  linkedGroupsForDraft,
  groupSearchQuery,
  setGroupSearchQuery,
  selectedExistingGroupId,
  setSelectedExistingGroupId,
  existingGroupOptions,
  removeFromSelectedGroup,
  setRemoveFromSelectedGroup,
  newGroupName,
  setNewGroupName,
  newGroupSlugPreview,
}: {
  itemGroupMode: ItemGroupMode;
  setItemGroupMode: Dispatch<SetStateAction<ItemGroupMode>>;
  linkedGroupsForDraft: SkinGroup[];
  groupSearchQuery: string;
  setGroupSearchQuery: Dispatch<SetStateAction<string>>;
  selectedExistingGroupId: string;
  setSelectedExistingGroupId: Dispatch<SetStateAction<string>>;
  existingGroupOptions: SkinGroup[];
  removeFromSelectedGroup: boolean;
  setRemoveFromSelectedGroup: Dispatch<SetStateAction<boolean>>;
  newGroupName: string;
  setNewGroupName: Dispatch<SetStateAction<string>>;
  newGroupSlugPreview: string;
}) {
  return (
    <div className='space-y-4'>
      <label className='block max-w-sm space-y-1 text-sm'>
        <span>Group action</span>
        <select
          className='w-full rounded-lg border border-soft bg-background px-3 py-2'
          value={itemGroupMode}
          onChange={(event) => setItemGroupMode(event.target.value as ItemGroupMode)}
        >
          <option value='none'>No group change</option>
          <option value='existing'>Add to or remove from a group</option>
          <option value='new'>Create a new group</option>
        </select>
      </label>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-medium'>Current grouping</p>
        {linkedGroupsForDraft.length > 0 ? (
          <p className='text-xs text-faint'>
            Existing: {linkedGroupsForDraft.map((group) => group.name).join(', ')}
          </p>
        ) : (
          <p className='text-xs text-faint'>No group linked yet.</p>
        )}
      </div>
      {itemGroupMode === 'existing' ? (
        <div className='grid gap-3 md:grid-cols-2'>
          <label className='text-sm space-y-1'>
            <span>Find Group</span>
            <input
              className='w-full rounded-lg border border-soft bg-background px-3 py-2'
              value={groupSearchQuery}
              onChange={(e) => setGroupSearchQuery(e.target.value)}
              placeholder='Search name or key...'
            />
          </label>
          <label className='text-sm space-y-1'>
            <span>Existing Group</span>
            <select
              className='w-full rounded-lg border border-soft bg-background px-3 py-2'
              value={selectedExistingGroupId}
              onChange={(e) => setSelectedExistingGroupId(e.target.value)}
              disabled={existingGroupOptions.length === 0}
            >
              {existingGroupOptions.length === 0 ? (
                <option value=''>No matching groups</option>
              ) : null}
              {existingGroupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                  {group.gameType ? ` (${group.gameType})` : ' (all games)'}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center gap-2 text-sm pt-6 md:col-span-2'>
            <input
              type='checkbox'
              checked={removeFromSelectedGroup}
              onChange={(e) => setRemoveFromSelectedGroup(e.target.checked)}
            />
            <span>Remove item from selected group instead of adding it</span>
          </label>
        </div>
      ) : null}
      {itemGroupMode === 'new' ? (
        <div className='grid gap-3 md:grid-cols-2'>
          <label className='text-sm space-y-1'>
            <span>New Group Name</span>
            <input
              className='w-full rounded-lg border border-soft bg-background px-3 py-2'
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder='Example: Neon Set'
            />
          </label>
          <label className='text-sm space-y-1'>
            <span>Group Key (auto)</span>
            <div className='w-full rounded-lg border border-soft bg-raised px-3 py-2 text-sm font-mono text-strong'>
              {newGroupSlugPreview}
            </div>
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function ItemSlotSelector({
  itemDraft,
  setItemDraft,
  availableSlots,
}: {
  itemDraft: ItemDraft;
  setItemDraft: Dispatch<SetStateAction<ItemDraft>>;
  availableSlots: string[];
}) {
  return (
    <div className='space-y-2'>
      <label className='text-sm space-y-1'>
        <span className='font-medium'>Slot</span>
        <select
          className='w-full rounded-lg border border-soft bg-background px-3 py-2'
          value={itemDraft.slots[0] ?? ''}
          onChange={(e) =>
            setItemDraft((prev) => ({
              ...prev,
              slots: e.target.value ? [e.target.value] : [],
            }))
          }
          disabled={availableSlots.length === 0}
        >
          {availableSlots.length === 0 ? (
            <option value=''>No slots available</option>
          ) : null}
          {availableSlots.map((slot) => (
            <option key={slot} value={slot}>
              {slot}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
