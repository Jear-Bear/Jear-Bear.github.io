-- Sponsor CRM: pitching. Which pitch style each deal used (for pitch
-- performance), and requests for Claude to draft a pitch or recap in Gmail.
ALTER TABLE deals ADD COLUMN pitch_style TEXT;

CREATE TABLE draft_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pitch', 'recap', 'follow_up')),
  deal_id TEXT NOT NULL REFERENCES deals (id),
  notes TEXT,                         -- what you want in it
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  result TEXT,                        -- Claude's note (e.g. "Draft saved: subject …")
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX draft_requests_status ON draft_requests (status);
