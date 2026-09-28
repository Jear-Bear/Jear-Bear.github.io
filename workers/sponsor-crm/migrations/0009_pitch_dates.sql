-- One-time fix: deals at a pitched stage with no pitch date (set from the
-- stage dropdown or a passed proposal) get the date they moved to Pitched,
-- from the timeline, or else the day the deal was created. New stage
-- changes fill the date in automatically.
UPDATE deals SET pitched_on = COALESCE(
  (SELECT substr(MIN(a.occurred_at), 1, 10) FROM activities a WHERE a.deal_id = deals.id AND a.title LIKE '%→ Pitched%'),
  substr(created_at, 1, 10)
)
WHERE pitched_on IS NULL AND archived = 0 AND stage IN ('Pitched', 'Follow-up 1 sent', 'Follow-up 2 sent');
