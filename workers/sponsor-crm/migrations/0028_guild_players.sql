-- /leaderboard's "This server" (commands.js): which Discord servers a player has been seen in,
-- by playing an Activity there or running /leaderboard there. A Discord app without a bot can't
-- list a server's members, so this is how it knows. Only the server and Discord IDs; it only
-- matters for players who turned the leaderboard on. Unlinking Discord, "Remove my results"
-- in an Activity, or deleting the account deletes their rows.
CREATE TABLE IF NOT EXISTS guild_players (
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, discord_id)
);
CREATE INDEX IF NOT EXISTS guild_players_user ON guild_players (discord_id);
