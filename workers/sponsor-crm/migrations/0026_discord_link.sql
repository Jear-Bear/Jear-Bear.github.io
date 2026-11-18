-- Discord account linking (discord.js). Only three things from Discord are kept, on the
-- account's leaderboard profile: its ID (already a column, unused until now), its username
-- and its avatar hash. Unlinking or deleting the account clears them at once.
-- One Discord account per site account, and the other way round (the unique index).
ALTER TABLE board_profiles ADD COLUMN discord_username TEXT;
ALTER TABLE board_profiles ADD COLUMN discord_avatar TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS board_profiles_discord ON board_profiles (discord_id) WHERE discord_id IS NOT NULL;

-- A Discord sign-in or link in progress (the OAuth2 state): only a hash of it, for 10 minutes.
-- user_id: the account being linked (mode 'link'); null for a sign-in.
CREATE TABLE IF NOT EXISTS discord_states (
  state_hash TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  user_id TEXT,
  redirect_uri TEXT NOT NULL,
  back TEXT,
  expires_at INTEGER NOT NULL
);

-- Who finished today's Kana Wordle inside the Discord Activity, per voice channel, so the
-- players in that channel can see it. Only the Discord ID and the result (no name, no
-- avatar, no kana); deleted after two days, or at once from the Activity ("Forget me") or
-- when that Discord account is unlinked.
CREATE TABLE IF NOT EXISTS activity_finishes (
  channel_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  day TEXT NOT NULL,
  guesses INTEGER NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL,
  pattern TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (channel_id, puzzle_id, discord_id)
);
CREATE INDEX IF NOT EXISTS activity_finishes_day ON activity_finishes (day);
CREATE INDEX IF NOT EXISTS activity_finishes_user ON activity_finishes (discord_id);
