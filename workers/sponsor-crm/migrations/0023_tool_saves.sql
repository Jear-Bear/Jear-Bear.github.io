-- Progress synced between a signed-in person's devices for the other games (Kana Wordle:
-- its daily games and stats). The crossword keeps plus_saves.
CREATE TABLE IF NOT EXISTS tool_saves (
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game)
);
