-- Which Stripe mode (test or live) an account's customer and subscription belong to.
-- Everything so far was made in test mode.
ALTER TABLE plus_users ADD COLUMN stripe_mode TEXT;
UPDATE plus_users SET stripe_mode = 'test' WHERE stripe_customer IS NOT NULL;
