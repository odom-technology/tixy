// ─────────────────────────────────────────────────────────────────────────────
// When the floor-built pools take over (tixy rev. 2, PROGRESSION.md "Quests").
//
// The featured game and the arcade tour are the same for every player and
// derive from a pool by index. Changing a pool mid-week would swap this week's
// tour games and today's double-ticket game under players who are mid-run. So
// the floor-built pools start on a Monday at 00:00 UTC, when the tour turns
// over, and the pools before that Monday stay as they were.
//
// Later floor changes work the same way: ship the placement change in a
// deploy on a Monday. Pools filter with isOnFloor() each time they pick, and
// a daily quest lasts one day, so no open quest outlives the change.
//
// Both keys are 'YYYY-MM-DD', so a string compare is a date compare. The tour
// passes its week key (a UTC Monday); the featured game passes the date key.
// ─────────────────────────────────────────────────────────────────────────────

/** First Monday (UTC) on which the featured and tour pools are the floor's. */
export const FLOOR_POOLS_FROM = '2026-10-12';

export const floorPoolsActive = (dateKey: string): boolean => dateKey >= FLOOR_POOLS_FROM;
