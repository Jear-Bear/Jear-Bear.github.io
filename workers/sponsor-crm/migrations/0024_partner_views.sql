-- Views of the sponsor cards on the site (scripts/partner.js): a card at least half on screen
-- for a second, once per card per page load. Counts only, like link_click_via, so the
-- Sponsor desk can show a click-through rate per place.
CREATE TABLE IF NOT EXISTS partner_views (
  slug TEXT NOT NULL,
  via TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, via, day)
);
