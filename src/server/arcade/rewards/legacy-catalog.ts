/* The shop reset (docs/design/tixy-rebrand/ROADMAP.md, "Decided": shop reset).
   Every item seeded before the prize counter is off sale: the older catalog
   seeds still refresh names and art on deploy, but they write `active =
   false`, and with `active = store_items.active AND excluded.active` that
   holds on every deploy. Owners keep what they bought and can still equip
   it. The counter's own catalog is scripts/seed-counter.ts.

   To sell an old design again, redraw it as a counter prize; an admin
   "Push To Store" on an old seeded item lasts until the next deploy. */
export const LEGACY_SEEDS_ON_SALE = false;
