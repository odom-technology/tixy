'use client';

import type { AssetField, AssetFieldType } from './_types';

export function AssetFieldsEditor({
  assetFields,
  setAssetFields,
}: {
  assetFields: AssetField[];
  setAssetFields: React.Dispatch<React.SetStateAction<AssetField[]>>;
}) {
  return (
    <div className='space-y-2 rounded-md border border-soft bg-raised p-3'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-medium'>Asset Controls</p>
        <button
          type='button'
          className='rounded border border-soft px-2 py-1 text-xs'
          onClick={() =>
            setAssetFields((prev) => [
              ...prev,
              {
                id: `asset-field-${Date.now()}`,
                key: '',
                type: 'text',
                value: '',
              },
            ])
          }
        >
          Add Field
        </button>
      </div>
      {assetFields.length === 0 ? (
        <p className='text-xs text-faint'>
          No asset fields yet. Add fields using color pickers/dropdowns.
        </p>
      ) : (
        <div className='space-y-2'>
          {assetFields.map((field) => (
            <div
              key={field.id}
              className='grid gap-2 rounded border border-soft p-2 xl:grid-cols-5'
            >
              <input
                className='rounded border border-soft bg-background px-2 py-1 text-xs'
                placeholder='key'
                value={field.key}
                onChange={(e) =>
                  setAssetFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id
                        ? { ...item, key: e.target.value }
                        : item,
                    ),
                  )
                }
              />
              <select
                className='rounded border border-soft bg-background px-2 py-1 text-xs'
                value={field.type}
                onChange={(e) =>
                  setAssetFields((prev) =>
                    prev.map((item) =>
                      item.id === field.id
                        ? {
                            ...item,
                            type: e.target.value as AssetFieldType,
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value='text'>text</option>
                <option value='color'>color</option>
                <option value='boolean'>boolean</option>
                <option value='number'>number</option>
              </select>
              {field.type === 'color' ? (
                <input
                  type='color'
                  className='h-8 rounded border border-soft bg-background p-1'
                  value={String(field.value || '#ffffff')}
                  onChange={(e) =>
                    setAssetFields((prev) =>
                      prev.map((item) =>
                        item.id === field.id
                          ? { ...item, value: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              ) : field.type === 'boolean' ? (
                <select
                  className='rounded border border-soft bg-background px-2 py-1 text-xs'
                  value={field.value === true ? 'true' : 'false'}
                  onChange={(e) =>
                    setAssetFields((prev) =>
                      prev.map((item) =>
                        item.id === field.id
                          ? { ...item, value: e.target.value === 'true' }
                          : item,
                      ),
                    )
                  }
                >
                  <option value='false'>false</option>
                  <option value='true'>true</option>
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className='rounded border border-soft bg-background px-2 py-1 text-xs'
                  value={String(field.value ?? '')}
                  onChange={(e) =>
                    setAssetFields((prev) =>
                      prev.map((item) =>
                        item.id === field.id
                          ? {
                              ...item,
                              value:
                                field.type === 'number'
                                  ? Number(e.target.value || 0)
                                  : e.target.value,
                            }
                          : item,
                      ),
                    )
                  }
                />
              )}
              <button
                type='button'
                className='rounded border border-red-400/40 px-2 py-1 text-xs text-red-200'
                onClick={() =>
                  setAssetFields((prev) =>
                    prev.filter((item) => item.id !== field.id),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
