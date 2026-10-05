-- High striker rules 3, the endless tower (docs/design/tixy-rebrand/HIGH_STRIKER.md).
--
-- Hunter asked for high striker's achievements to be reset with the new rules.
-- This removes every player's progress on the two old series, once (the
-- migration runner records it in arcade_schema_migrations), and nothing else:
--
--  * user_achievements: the rows for Strongman (high-striker-score-1 to -5)
--    and Bell Ringer (high-striker-bell-ringer-1 to -5). Both series stay in
--    the registry, retired, so their ids still resolve; with no holders they
--    are shown to no one.
--  * achievement_unlock_counts: the same ids' global tallies.
--  * user_stats: the two stats those series read, high-striker.best (rules 1)
--    and high-striker.best_five (rules 2). The new series read
--    high-striker.endless_depth and high-striker.endless_streak, which start
--    empty. high-striker.games (the play count) is kept.
--
-- Nothing is clawed back. The XP each tier paid went to user_account_xp and
-- the account level when it was earned; this touches neither, nor any
-- wallet, ledger or ticket row, nor global.achievements_unlocked (Achiever's
-- count). No tier of either series granted a cosmetic. Score rows are kept:
-- high_striker_scores keeps rules 1 and 2 bests under their own `rules`.
-- A profile that pinned one of these ids just stops showing it (pins that are
-- no longer earned are skipped when a profile is read).
DELETE FROM user_achievements
 WHERE achievement_id IN (
   'high-striker-score-1', 'high-striker-score-2', 'high-striker-score-3', 'high-striker-score-4', 'high-striker-score-5',
   'high-striker-bell-ringer-1', 'high-striker-bell-ringer-2', 'high-striker-bell-ringer-3', 'high-striker-bell-ringer-4', 'high-striker-bell-ringer-5'
 );

DELETE FROM achievement_unlock_counts
 WHERE achievement_id IN (
   'high-striker-score-1', 'high-striker-score-2', 'high-striker-score-3', 'high-striker-score-4', 'high-striker-score-5',
   'high-striker-bell-ringer-1', 'high-striker-bell-ringer-2', 'high-striker-bell-ringer-3', 'high-striker-bell-ringer-4', 'high-striker-bell-ringer-5'
 );

DELETE FROM user_stats
 WHERE stat_key IN ('high-striker.best', 'high-striker.best_five');
