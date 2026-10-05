-- Minesweeper cosmetic slots were registered as tiles/mines but the theme
-- reader (buildMinesweeperTheme) has always consumed board/numbers — the
-- registry was fixed in code (GAME_SLOTS.minesweeper) as part of the wave-d
-- cosmetics expansion. This migration normalizes any pre-existing rows that
-- were authored under the old names (e.g. via the admin skin-studio, which
-- offered exactly the registry's slots), so no item is stranded failing equip
-- slot-validation and no equipped row silently drops out of a loadout.
-- Idempotent: rows already on the new names (or no rows at all) are no-ops.

UPDATE store_items
   SET slots_json = replace(replace(slots_json, '"tiles"', '"board"'), '"mines"', '"numbers"')
 WHERE game_type = 'minesweeper'
   AND (slots_json LIKE '%"tiles"%' OR slots_json LIKE '%"mines"%');

UPDATE user_equipped_items
   SET slot = CASE slot WHEN 'tiles' THEN 'board' WHEN 'mines' THEN 'numbers' ELSE slot END
 WHERE game_type = 'minesweeper'
   AND slot IN ('tiles', 'mines');
