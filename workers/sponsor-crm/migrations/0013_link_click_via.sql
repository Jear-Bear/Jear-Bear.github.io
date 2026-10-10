-- Where tracked-link clicks came from: /go/<slug>?via=<place>, or a click on
-- the sponsor card on the site (POST /public/click). Counts only, like link_clicks.
CREATE TABLE link_click_via (
  slug TEXT NOT NULL,
  via TEXT NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, via, day)
);
