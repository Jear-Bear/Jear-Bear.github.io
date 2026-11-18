-- The Discord leaderboard (board.js). Opt-in, per account, shared by every game.
CREATE TABLE IF NOT EXISTS board_profiles (
  user_id TEXT PRIMARY KEY REFERENCES plus_users(id),
  nickname TEXT NOT NULL,
  opt_in INTEGER NOT NULL DEFAULT 0,
  discord_id TEXT,                     -- not used yet
  updated_at TEXT NOT NULL
);

-- One finished game per account per puzzle; the first result sent is the one that counts.
-- day: the puzzle's date. points: what the game's rules gave it (board.js), plus the
-- podium bonus once the daily post went out.
CREATE TABLE IF NOT EXISTS game_results (
  game TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seconds INTEGER,
  guesses INTEGER,
  hints INTEGER,
  revealed INTEGER,
  checked INTEGER,
  won INTEGER NOT NULL DEFAULT 1,
  solved_at TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, puzzle_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_results_day ON game_results (game, day);

-- Each daily post, so it's never sent twice (kind: 'daily')
CREATE TABLE IF NOT EXISTS discord_posts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  PRIMARY KEY (day, kind)
);
