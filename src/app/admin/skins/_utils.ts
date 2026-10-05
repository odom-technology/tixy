export type ItemGroupMode = 'none' | 'existing' | 'new';

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64);

export const toGameScopedGroupSlug = (groupName: string, gameType: string) =>
  toSlug(`${gameType}-${groupName}`);
