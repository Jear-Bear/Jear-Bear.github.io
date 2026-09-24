-- Sponsor CRM: the channel's YouTube uploads, cached from the YouTube Data
-- API so they can be linked to video slots and deals. Public data.
CREATE TABLE uploads (
  youtube_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_at TEXT,
  thumbnail TEXT,
  duration_s INTEGER,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  privacy TEXT,
  fetched_at TEXT NOT NULL
);
CREATE INDEX uploads_published ON uploads (published_at);
