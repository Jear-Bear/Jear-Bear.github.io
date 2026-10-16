-- The Crossword+ funnel: how many did each step, per day (UTC). Counts only, no people:
-- visit, solve, offer come from the page (once per browser per day); account, checkout,
-- trial, paid from the Worker.
CREATE TABLE IF NOT EXISTS plus_funnel (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);
