-- Crossword+ accounts. One row per email: people sign in with Google or with
-- a link sent to their email, and a Stripe subscription (or free access
-- given in the Sponsor desk) is tied to that email.
CREATE TABLE plus_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  google_sub TEXT UNIQUE,
  created_at TEXT NOT NULL,
  last_login TEXT,
  session_ver INTEGER NOT NULL DEFAULT 1,      -- bump to sign them out everywhere
  granted INTEGER NOT NULL DEFAULT 0,          -- free access from the Sponsor desk
  grant_note TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,          -- access turned off by hand
  stripe_customer TEXT UNIQUE,
  stripe_subscription TEXT,
  status TEXT,                                 -- Stripe's: active, trialing, past_due, canceled, unpaid...
  plan TEXT,                                   -- month or year
  period_end TEXT
);

-- Email sign-in links (only a hash of each token; they last 20 minutes)
CREATE TABLE plus_logins (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Deck puzzles made per member per day (the limit is 2)
CREATE TABLE plus_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  made INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- What the Sponsor desk's "Connect Stripe" set up, per mode (test or live):
-- price IDs, the portal configuration and the webhook's signing secret.
-- Kept out of the settings table so it never shows up in a desk export.
CREATE TABLE stripe_config (
  mode TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
