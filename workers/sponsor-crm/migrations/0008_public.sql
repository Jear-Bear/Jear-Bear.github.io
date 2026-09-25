-- Sponsor CRM: rate limits for the public endpoints (sponsor-page inquiries).
-- Keys are HMAC hashes of the IP and hour, never the IP itself.
CREATE TABLE public_hits (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
