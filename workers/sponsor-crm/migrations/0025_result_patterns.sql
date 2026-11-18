-- The daily post's picture (board-image.js): each Kana Wordle result's colors, one row per
-- guess ("c" right spot, "p" elsewhere in the word, "n" one dakuten off, "a" not in it),
-- rows joined with "|". Colors only: never the kana.
ALTER TABLE game_results ADD COLUMN pattern TEXT;

-- The post goes out as text first; its picture is then added by editing that message, so a
-- failed picture never holds up the post. message_id: Discord's ID for the post;
-- picture_at: when the picture was added (null: not yet, the next cron run tries again).
ALTER TABLE discord_posts ADD COLUMN message_id TEXT;
ALTER TABLE discord_posts ADD COLUMN picture_at TEXT;
