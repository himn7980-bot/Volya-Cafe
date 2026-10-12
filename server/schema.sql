-- One row per Telegram player: their best run.
CREATE TABLE IF NOT EXISTS scores (
  user_id    INTEGER PRIMARY KEY,   -- Telegram user id (from verified initData)
  name       TEXT    NOT NULL,      -- first + last name from Telegram
  username   TEXT,
  lang       TEXT,
  best       INTEGER NOT NULL DEFAULT 0,
  wave       INTEGER NOT NULL DEFAULT 0,
  kills      INTEGER NOT NULL DEFAULT 0,
  games      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  best_at    INTEGER                -- when the best score was set (earlier wins ties)
);
CREATE INDEX IF NOT EXISTS idx_scores_best ON scores (best DESC, best_at ASC);
