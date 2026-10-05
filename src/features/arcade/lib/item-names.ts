/* A prize's name as players see it. Season 0's items were stored with a
   season tag in the name ("S0 Carbon"); the tag goes at display. Stored ids
   and names never change. */
const SEASON_TAG = /^S\d+\s+/;

export function playerItemName(name: string): string {
  return name.replace(SEASON_TAG, '');
}
