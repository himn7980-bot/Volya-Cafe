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

-- Players seen by the game or the bot; can_write = 1 when they allowed messages (/start or the in-game prompt).
CREATE TABLE IF NOT EXISTS users (
  user_id     INTEGER PRIMARY KEY,
  name        TEXT,
  lang        TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  can_write   INTEGER NOT NULL DEFAULT 0,
  last_remind INTEGER,
  refs        INTEGER NOT NULL DEFAULT 0   -- friends who joined through this player's link
);
CREATE INDEX IF NOT EXISTS idx_users_remind ON users (can_write, last_seen);

-- One row per invited player (an invite only counts once).
CREATE TABLE IF NOT EXISTS referrals (
  invitee    INTEGER PRIMARY KEY,
  inviter    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Weekend World Boss: total damage per player per week, and when the boss fell.
CREATE TABLE IF NOT EXISTS raid_hits (
  week       INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  damage     INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, user_id)
);
CREATE TABLE IF NOT EXISTS raid_state (
  week        INTEGER PRIMARY KEY,
  defeated_at INTEGER
);
