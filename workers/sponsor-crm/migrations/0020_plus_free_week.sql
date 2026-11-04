-- The free week: Crossword+ for 7 days with no card, once per account. New accounts get it
-- on their first sign-in; older ones can start it from the page. When it ends nothing is
-- charged and there's nothing to cancel. NULL: never had one.
ALTER TABLE plus_users ADD COLUMN free_week_until TEXT;
