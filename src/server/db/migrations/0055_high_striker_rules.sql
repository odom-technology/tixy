-- High striker rules version 2 (five swings, raising targets): the new rules
-- get their own board, never a rescale. `rules` is 1 for every row that exists
-- (last season's bests, never rewritten) and 2 for runs saved under the new
-- rules. `best_strength` is the highest gauge strength of any swing, for the
-- pennant on the tower.
--
-- A player now has one row per rules version, so the unique index on the user
-- alone is replaced by one on (user, rules). The new index is weaker than the
-- old one, so every existing row satisfies it and nothing is rewritten.
ALTER TABLE high_striker_scores ADD COLUMN IF NOT EXISTS rules INTEGER NOT NULL DEFAULT 1;
ALTER TABLE high_striker_scores ADD COLUMN IF NOT EXISTS best_strength DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_high_striker_scores_user_rules ON high_striker_scores(od_user_id, rules);
DROP INDEX IF EXISTS uniq_high_striker_scores_user;
CREATE INDEX IF NOT EXISTS idx_high_striker_scores_rules_score ON high_striker_scores(rules, score DESC);
