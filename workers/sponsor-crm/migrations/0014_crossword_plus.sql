-- Crossword+ members, before payments exist: Jared hands out keys from the
-- Sponsor desk (testers, founding members). Only a hash of each key is kept.
-- When logins and payments arrive, a member row gets tied to an account.
CREATE TABLE plus_members (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used TEXT
);
-- Deck puzzles made per member per day (the limit is 2)
CREATE TABLE plus_usage (
  member_id TEXT NOT NULL,
  day TEXT NOT NULL,
  made INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, day)
);
