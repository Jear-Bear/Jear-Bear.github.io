-- Sponsor CRM: website traffic from Cloudflare Web Analytics (cookieless,
-- aggregated counts only; no visitor-level data). One row per day and
-- breakdown: dim is total | path | referer | country | device | browser | os.
CREATE TABLE site_traffic (
  day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  dim TEXT NOT NULL,
  key TEXT NOT NULL,             -- '' for the total
  views INTEGER NOT NULL,
  visits INTEGER NOT NULL,
  PRIMARY KEY (day, dim, key)
);
