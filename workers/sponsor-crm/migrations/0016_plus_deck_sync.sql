-- My deck: one free puzzle a day per signed-in account (members: unlimited)
CREATE TABLE IF NOT EXISTS plus_deck_uses (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
-- Progress synced between a signed-in person's devices (solves, times, deck puzzles)
CREATE TABLE IF NOT EXISTS plus_saves (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
