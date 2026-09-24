-- Sponsor CRM: calendar and tasks (Phase 2). Schema only.
-- Times are wall-clock times in the owner's time zone (America/Chicago):
-- 'YYYY-MM-DD' for all-day items, 'YYYY-MM-DDTHH:MM' for timed ones.

-- A recurring series. Occurrences are computed; edits to one occurrence are
-- stored as a cal_items row with series_id + original_date (an exception).
CREATE TABLE cal_series (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- task | event | deliverable | milestone
  kind TEXT,                           -- meeting | call | filming | editing | publishing | other
  title TEXT NOT NULL,
  notes TEXT,
  dtstart TEXT NOT NULL,               -- first occurrence date
  start_time TEXT,                     -- 'HH:MM', null = all-day
  duration_min INTEGER,
  freq TEXT NOT NULL,                  -- daily | weekly | monthly
  interval INTEGER NOT NULL DEFAULT 1,
  byday TEXT,                          -- weekly: 'MO,WE'
  until TEXT,                          -- last possible date, inclusive
  status TEXT NOT NULL DEFAULT 'active',   -- active | cancelled
  source TEXT NOT NULL DEFAULT 'me',       -- plan | me | claude
  counts_hours INTEGER NOT NULL DEFAULT 1,
  company_id TEXT, deal_id TEXT, video_id TEXT,
  checklist TEXT,                      -- JSON [{ text, done }]
  plan_key TEXT UNIQUE,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cal_items (
  id TEXT PRIMARY KEY,
  series_id TEXT REFERENCES cal_series (id),
  original_date TEXT,                  -- for exceptions: the occurrence it replaces
  type TEXT NOT NULL,
  kind TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  start TEXT NOT NULL,
  end TEXT,
  all_day INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_started',  -- not_started | in_progress | done | skipped | cancelled
  source TEXT NOT NULL DEFAULT 'me',
  suggested INTEGER NOT NULL DEFAULT 0,        -- Claude suggestion awaiting accept/dismiss
  suggestion_reason TEXT,
  counts_hours INTEGER NOT NULL DEFAULT 1,
  company_id TEXT, deal_id TEXT, video_id TEXT,
  checklist TEXT,
  plan_key TEXT UNIQUE,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (series_id, original_date)
);
CREATE INDEX cal_items_start ON cal_items (start);
