-- Sponsor CRM: deal term dates, invoices, and tracked sponsor links.

-- Dates from the contract, shown on the calendar
ALTER TABLE deals ADD COLUMN script_due TEXT;
ALTER TABLE deals ADD COLUMN draft_due TEXT;
ALTER TABLE deals ADD COLUMN exclusivity_until TEXT;
ALTER TABLE deals ADD COLUMN usage_until TEXT;

-- Invoices are payments with a number and the printed details
ALTER TABLE payments ADD COLUMN invoice_no TEXT;
ALTER TABLE payments ADD COLUMN invoice TEXT;      -- JSON: bill_to, lines, due, terms
CREATE UNIQUE INDEX payments_invoice_no ON payments (invoice_no) WHERE invoice_no IS NOT NULL;

-- Tracked links: jareddesu.com/go/<slug> redirects to the sponsor and counts clicks
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  deal_id TEXT REFERENCES deals (id),
  company_id TEXT REFERENCES companies (id),
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Click counts only (no IPs, no personal data)
CREATE TABLE link_clicks (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
