-- When the one welcome email went out (a new paying member, or free access
-- given in the Sponsor desk). Set before sending, so it's never sent twice.
ALTER TABLE plus_users ADD COLUMN welcomed_at TEXT;
