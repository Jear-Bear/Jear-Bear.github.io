-- Crossword+ waitlist: people who asked for one email when it launches.
-- Lives only in D1 (never in the repo). token is a random id for the
-- one-click "take me off the list" link.
CREATE TABLE crossword_waitlist (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  wants TEXT NOT NULL DEFAULT '[]',
  lang TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);
