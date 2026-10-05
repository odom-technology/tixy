-- The deploy seeds no longer overwrite the price of an item that already
-- exists, so an admin's price survives a deploy. Two items are inserted by
-- 0021 at 500 tickets before seed-cosmetics first runs, and that seed used to
-- reprice them to 450 and 750 on every deploy. Give a brand new database the
-- same prices it got before.
--
-- This only runs while the catalog holds nothing but the six 0021 rows, which
-- is true on a fresh database and never on one a deploy has seeded. On
-- production it changes nothing.
UPDATE store_items
SET price = CASE id
  WHEN 'profile-namecolor-emerald' THEN 450
  WHEN 'profile-namecolor-gold' THEN 750
END
WHERE id IN ('profile-namecolor-emerald', 'profile-namecolor-gold')
  AND price = 500
  AND NOT EXISTS (
    SELECT 1 FROM store_items
    WHERE id NOT IN (
      'profile-namecolor-gold',
      'profile-namecolor-emerald',
      'profile-frame-gold',
      'profile-badge-crown',
      'profile-badge-connector',
      'profile-title-strategist'
    )
  );
