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

-- Teams: every hero is a community team. A player joins one and everything they play earns
-- team points for the week (levels, stars, Endless, daily challenge, World Boss).
CREATE TABLE IF NOT EXISTS team_members (
  user_id       INTEGER PRIMARY KEY,
  team          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  joined_at     INTEGER NOT NULL,
  switched_week INTEGER NOT NULL      -- week of the last join; one switch per week
);
CREATE INDEX IF NOT EXISTS idx_team_members ON team_members (team);
CREATE TABLE IF NOT EXISTS team_points (
  week    INTEGER NOT NULL,           -- weeks since epoch, starting Monday 00:00 UTC
  user_id INTEGER NOT NULL,
  team    TEXT    NOT NULL,           -- points stay with the team they were earned for
  points  INTEGER NOT NULL,
  PRIMARY KEY (week, user_id, team)
);
CREATE INDEX IF NOT EXISTS idx_team_points ON team_points (week, team);
CREATE TABLE IF NOT EXISTS team_day (   -- daily cap per player
  day     INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  points  INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
);

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

-- Player cards: what the game reports about each player's progress, shown when someone taps them
-- on a leaderboard to compare. pid is an opaque public id (the Telegram id is never exposed).
CREATE TABLE IF NOT EXISTS profiles (
  user_id    INTEGER PRIMARY KEY,
  pid        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  hero       TEXT    NOT NULL DEFAULT 'volya',
  lvl        INTEGER NOT NULL DEFAULT 0,   -- levels cleared
  stars      INTEGER NOT NULL DEFAULT 0,
  data       TEXT    NOT NULL,             -- JSON: combo, kills, bosses, heroes, hlv, games
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_lvl ON profiles (lvl DESC, stars DESC);
