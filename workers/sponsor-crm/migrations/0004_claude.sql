-- Sponsor CRM: what Claude writes through the connector (Phase 3).
-- Everything here waits for review; nothing Claude writes changes a deal,
-- a price or a date until it's passed in the app.

-- Proposed changes with their evidence
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- stage_change | amounts | dates | next_action | new_contact | new_company_deal
  company_id TEXT,
  deal_id TEXT,
  proposed TEXT NOT NULL,        -- JSON of proposed values (validated per kind)
  evidence TEXT,                 -- JSON { email_date, subject, quote, gmail_link, message_id }
  reason TEXT,
  confidence TEXT,               -- low | medium | high
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | passed | dismissed
  applied TEXT,                  -- JSON of the values actually applied
  dismiss_reason TEXT,
  dedupe_key TEXT UNIQUE,        -- same proposal twice is ignored
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX proposals_status ON proposals (status, created_at);

CREATE TABLE video_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  why TEXT,
  source TEXT,                   -- performance | sponsor_conversations | both
  evidence TEXT,                 -- JSON list of short strings
  status TEXT NOT NULL DEFAULT 'new',       -- new | kept | dismissed
  video_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE insights (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- weekly | note
  week_of TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX insights_created ON insights (created_at);
