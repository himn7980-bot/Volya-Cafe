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

-- Team war: each player's best Endless run per week, credited to the hero they played.
CREATE TABLE IF NOT EXISTS team_scores (
  week    INTEGER NOT NULL,           -- weeks since epoch, starting Monday 00:00 UTC
  user_id INTEGER NOT NULL,
  hero    TEXT    NOT NULL,
  best    INTEGER NOT NULL,
  PRIMARY KEY (week, user_id, hero)
);
CREATE INDEX IF NOT EXISTS idx_team_week ON team_scores (week, hero);

-- Daily challenge board: best score per player per day.
CREATE TABLE IF NOT EXISTS daily_scores (
  day        INTEGER NOT NULL,        -- days since epoch
  user_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  hero       TEXT,
  best       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_best ON daily_scores (day, best DESC);

-- Telegram Stars purchases recorded by the bot webhook; the game claims them once.
CREATE TABLE IF NOT EXISTS purchases (
  charge_id  TEXT PRIMARY KEY,        -- telegram_payment_charge_id
  user_id    INTEGER NOT NULL,
  product    TEXT    NOT NULL,
  stars      INTEGER NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases (user_id, claimed);
