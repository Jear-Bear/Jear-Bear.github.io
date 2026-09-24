-- Sponsor CRM: core tables (Phase 1). Schema only: no data ever lives in
-- the repo. Dates are 'YYYY-MM-DD', timestamps ISO 8601 UTC, money in dollars.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  fit TEXT,
  website TEXT,
  contact_method TEXT,
  form_url TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX companies_name ON companies (name COLLATE NOCASE);

CREATE TABLE company_domains (
  domain TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id)
);
CREATE INDEX company_domains_company ON company_domains (company_id);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  name TEXT,
  email TEXT,
  role TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX contacts_company ON contacts (company_id);
CREATE INDEX contacts_email ON contacts (email);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publish_date TEXT,
  format TEXT,
  sponsor_status TEXT,
  youtube_id TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  contact_id TEXT REFERENCES contacts (id),
  source TEXT,
  package TEXT,
  video_id TEXT REFERENCES videos (id),
  slot_note TEXT,
  stage TEXT NOT NULL,
  pitched_on TEXT,
  replied_on TEXT,
  quoted REAL,
  final REAL,
  publish_date TEXT,
  deliverables TEXT,
  usage_rights TEXT,
  exclusivity TEXT,
  next_action TEXT,
  next_action_date TEXT,
  lost_reason TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX deals_company ON deals (company_id);
CREATE INDEX deals_stage ON deals (stage);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals (id),
  amount REAL NOT NULL,
  invoiced_on TEXT,
  paid_on TEXT,
  method TEXT,
  fees REAL,
  net REAL,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX payments_deal ON payments (deal_id);

CREATE TABLE rate_card (
  id TEXT PRIMARY KEY,
  package TEXT NOT NULL,
  standard REAL,
  floor REAL,
  included TEXT,
  notes TEXT,
  sort INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Timeline per company and deal. Email rows hold metadata only (Phase 3):
-- no bodies, a snippet under 300 characters, idempotent by Gmail message ID.
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies (id),
  deal_id TEXT REFERENCES deals (id),
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT,
  body TEXT,
  source TEXT NOT NULL DEFAULT 'me',       -- me | system | claude
  direction TEXT,                          -- email: in | out
  email_from TEXT,
  email_to TEXT,
  email_cc TEXT,
  subject TEXT,
  snippet TEXT,
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  gmail_link TEXT,
  claude_note TEXT,                        -- Claude's note on the email (Phase 3)
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX activities_company ON activities (company_id, occurred_at);
CREATE INDEX activities_deal ON activities (deal_id, occurred_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Login throttling: per-IP keys ('ip:…') and one global key
CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  lockouts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
