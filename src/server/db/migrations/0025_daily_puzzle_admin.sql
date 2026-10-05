-- Admin-editable pools for the daily word games. When a table has rows, the
-- game serves its puzzles from here (cycled by puzzle-day index); when empty it
-- falls back to the curated in-code defaults. Mirrors connections_puzzles.

CREATE TABLE IF NOT EXISTS pangram_puzzles (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  letters_json TEXT NOT NULL,
  center TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pangram_puzzles_sort_order
  ON pangram_puzzles(sort_order);

CREATE TABLE IF NOT EXISTS word_grid_puzzles (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  answer TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_word_grid_puzzles_sort_order
  ON word_grid_puzzles(sort_order);
