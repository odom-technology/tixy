-- The shop reset (docs/design/tixy-rebrand/ROADMAP.md, "Decided"). Every item
-- on sale before the prize counter goes off sale, once. Nothing is deleted:
-- owners keep their items, and equipped items stay equipped. The counter's
-- prizes (ids starting counter-, and the art kit's frame-, namecard-, medal-
-- and stub- rows other workstreams seed) are seeded after this by
-- scripts/seed-counter.ts, and the older seeds now write active = false
-- (src/server/arcade/rewards/legacy-catalog.ts), so this holds.
UPDATE store_items
   SET active = FALSE
 WHERE active
   AND id NOT LIKE 'counter-%'
   AND id NOT LIKE 'frame-%'
   AND id NOT LIKE 'namecard-%'
   AND id NOT LIKE 'medal-%'
   AND id NOT LIKE 'stub-%';
