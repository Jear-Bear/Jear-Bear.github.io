-- My deck: one free deck puzzle per account, ever (it was one a day). deck_free_at is when
-- the account made its first deck puzzle, as a member or not; after that, deck puzzles are
-- for members. Accounts that have already made one (a use counted in the last few days, or
-- a deck puzzle in their synced progress) have had theirs.
ALTER TABLE plus_users ADD COLUMN deck_free_at TEXT;
UPDATE plus_users SET deck_free_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (SELECT user_id FROM plus_deck_uses)
     OR id IN (SELECT user_id FROM plus_saves WHERE json_valid(data) AND json_type(data, '$.made') = 'array' AND json_array_length(data, '$.made') > 0);
-- The per-day counts aren't used any more
DELETE FROM plus_deck_uses;
