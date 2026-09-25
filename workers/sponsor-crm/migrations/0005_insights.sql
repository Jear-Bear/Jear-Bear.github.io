-- Sponsor CRM, Phase 4: channel history, creator income and view estimates.
-- All private: this lives only in D1 behind the login.

-- One row per day: channel views and subscriber changes. Views also come
-- from the public stats file; subscriber changes only from the stats Action.
CREATE TABLE channel_daily (
  day TEXT PRIMARY KEY,          -- YYYY-MM-DD
  views INTEGER,
  subs_gained INTEGER,
  subs_lost INTEGER,
  updated_at TEXT NOT NULL
);

-- Monthly creator income the YouTube token can't read (AdSense, affiliates,
-- memberships, other). Paid deals come from payments.
CREATE TABLE income (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,           -- YYYY-MM
  source TEXT NOT NULL CHECK (source IN ('adsense', 'affiliates', 'memberships', 'other')),
  amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (month, source)
);

-- The expected views in a video's first 30 days (for the rate-raise rule),
-- and each upload's views captured once it's 30 days old
ALTER TABLE videos ADD COLUMN view_estimate INTEGER;
ALTER TABLE uploads ADD COLUMN views_30d INTEGER;
ALTER TABLE uploads ADD COLUMN views_30d_on TEXT;
