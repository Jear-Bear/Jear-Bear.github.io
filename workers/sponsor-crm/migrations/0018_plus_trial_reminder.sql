-- When an account was sent the "your free trial ends soon" email (once per account)
ALTER TABLE plus_users ADD COLUMN trial_reminded_at TEXT;
