-- Stacker endless rules version 2 (time-based drops, a speed curve, fast rows
-- from 30 and narrower blocks from 60): the new rules get their own board,
-- never a rescale. `rules` is 1 for every row that exists (last season's
-- bests, never rewritten) and 2 for runs saved under the new rules.
--
-- A player now has one row per rules version, so the unique index on the user
-- alone is replaced by one on (user, rules). The new index is weaker than the
-- old one, so every existing row satisfies it and nothing is rewritten.
ALTER TABLE stack_scores ADD COLUMN IF NOT EXISTS rules INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stack_scores_user_rules ON stack_scores(od_user_id, rules);
DROP INDEX IF EXISTS uniq_stack_scores_user;
CREATE INDEX IF NOT EXISTS idx_stack_scores_rules_score ON stack_scores(rules, score DESC);
