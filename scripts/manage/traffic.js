// traffic.js — website traffic numbers, shared by the app (Traffic tab) and
// the Worker (Claude's get_site_traffic). Pure functions; the data comes from
// Cloudflare Web Analytics (cookieless page views and visits, aggregated).

export const DIMS = ['path', 'referer', 'country', 'device', 'browser', 'os'];
export const DIM_LABELS = {
  path: 'Pages', referer: 'Where visitors come from', country: 'Countries', device: 'Devices', browser: 'Browsers', os: 'Operating systems',
};

// Friendly names for the site's pages
const PAGES = {
  '/': 'Home',
  '/about/': 'About',
  '/blog/': 'Blog',
  '/contact/': 'Contact',
  '/projects/': 'Projects',
  '/sponsor/': 'Sponsor (old link)',
  '/sponsorships/': 'Sponsorships (media kit)',
  '/sponsorships/dashboard/': 'Partner dashboard',
  '/tools/': 'Tools',
  '/tools/kana/': 'Kana Trainer',
  '/tools/kanji/': 'Kanji Trainer',
  '/tools/nandoku/': 'Nandoku Trainer',
  '/tools/pitch/': 'Pitch Accent',
  '/tools/jis/': 'JIS Keyboard',
};

export function normalizePath(p) {
  let s = String(p || '/').split(/[?#]/)[0] || '/';
  s = s.replace(/\/index\.html$/, '/');
  if (!s.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(s)) s += '/';
  return s;
}
export const pageName = (p) => PAGES[normalizePath(p)] || normalizePath(p);

export function sectionOf(p) {
  const s = normalizePath(p);
  if (s === '/') return 'Home';
  if (s.startsWith('/tools/')) return 'Study tools';
  if (s.startsWith('/sponsor')) return 'Sponsorships';
  if (s.startsWith('/blog/')) return 'Blog';
  if (s.startsWith('/go/')) return 'Tracked links';
  if (['/about/', '/contact/', '/projects/'].includes(s)) return 'About & contact';
  return 'Other';
}

// Referrer hosts in plain words
export function refererName(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return 'Direct / unknown';
  if (/(^|\.)jareddesu\.com$/.test(h)) return 'Your own site';
  if (/youtube\.com$|youtu\.be$/.test(h)) return 'YouTube';
  if (/google\./.test(h)) return 'Google';
  if (/bing\.com$/.test(h)) return 'Bing';
  if (/duckduckgo\.com$/.test(h)) return 'DuckDuckGo';
  if (/reddit\.com$/.test(h)) return 'Reddit';
  if (/(twitter|x)\.com$|t\.co$/.test(h)) return 'X / Twitter';
  if (/instagram\.com$/.test(h)) return 'Instagram';
  if (/tiktok\.com$/.test(h)) return 'TikTok';
  if (/facebook\.com$/.test(h)) return 'Facebook';
  if (/discord(app)?\.com$/.test(h)) return 'Discord';
  if (/chatgpt\.com$|openai\.com$|perplexity\.ai$|claude\.ai$/.test(h)) return `AI assistant (${h})`;
  return h;
}

const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
const change = (now, before) => (before > 0 ? (now - before) / before : null);

function merge(rows, keyOf) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyOf(r.key);
    const x = m.get(k) || { key: k, views: 0, visits: 0 };
    x.views += r.views; x.visits += r.visits;
    m.set(k, x);
  });
  return [...m.values()].sort((a, b) => b.views - a.views);
}

function withChange(now, before) {
  const prev = new Map(before.map((r) => [r.key, r]));
  const total = sum(now, 'views') || 1;
  return now.map((r) => {
    const p = prev.get(r.key);
    return { ...r, share: r.views / total, prevViews: p ? p.views : 0, change: p ? change(r.views, p.views) : null, isNew: !p && before.length > 0 };
  });
}

// Least-squares slope of daily views (views per day, per day)
function slope(values) {
  const n = values.length;
  if (n < 5) return null;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
  return den ? { a: my - (num / den) * mx, b: num / den } : null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// data: { from, to, prevFrom, prevTo, daily: [{day, views, visits}], top: {dim: rows}, prevTop: {dim: rows} }
export function summarize(data) {
  const daily = [];
  const byDay = new Map(data.daily.map((d) => [d.day, d]));
  for (let d = data.from; d <= data.to; d = dayAdd(d, 1)) {
    const r = byDay.get(d);
    daily.push({ day: d, views: r ? r.views : 0, visits: r ? r.visits : 0 });
  }
  const prevDaily = data.daily.filter((d) => d.day >= data.prevFrom && d.day <= data.prevTo);
  const views = sum(daily, 'views');
  const visits = sum(daily, 'visits');
  const prevViews = sum(prevDaily, 'views');
  const prevVisits = sum(prevDaily, 'visits');
  const top = data.top || {};
  const prevTop = data.prevTop || {};
  const pages = withChange(merge(top.path || [], normalizePath), merge(prevTop.path || [], normalizePath))
    .map((r) => ({ ...r, name: pageName(r.key), section: sectionOf(r.key) }));
  const referers = withChange(merge(top.referer || [], refererName), merge(prevTop.referer || [], refererName));
  const sections = withChange(merge(top.path || [], sectionOf), merge(prevTop.path || [], sectionOf));
  const dims = {};
  ['country', 'device', 'browser', 'os'].forEach((d) => { dims[d] = withChange(merge(top[d] || [], (k) => k || 'Unknown'), merge(prevTop[d] || [], (k) => k || 'Unknown')); });

  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const weekdayN = [0, 0, 0, 0, 0, 0, 0];
  daily.forEach((d) => { const w = new Date(`${d.day}T00:00:00Z`).getUTCDay(); weekday[w] += d.views; weekdayN[w]++; });
  const avgByWeekday = weekday.map((v, i) => (weekdayN[i] ? v / weekdayN[i] : 0));
  const best = avgByWeekday.indexOf(Math.max(...avgByWeekday));
  const peak = daily.reduce((m, d) => (d.views > m.views ? d : m), { views: -1 });
  const fit = slope(daily.map((d) => d.views));
  const external = referers.filter((r) => !['Direct / unknown', 'Your own site'].includes(r.key));

  return {
    from: data.from, to: data.to, prevFrom: data.prevFrom, prevTo: data.prevTo, days: daily.length,
    totals: {
      views, visits, prevViews, prevVisits,
      viewsChange: change(views, prevViews), visitsChange: change(visits, prevVisits),
      viewsPerVisit: visits ? views / visits : null,
      perDay: daily.length ? views / daily.length : 0,
      externalShare: visits ? sum(external, 'visits') / visits : null,
    },
    daily, fit,
    trendPerWeek: fit ? fit.b * 7 : null,
    peak: peak.views > 0 ? peak : null,
    bestWeekday: daily.length >= 7 && Math.max(...avgByWeekday) > 0 ? WEEKDAYS[best] : null,
    avgByWeekday: WEEKDAYS.map((name, i) => ({ name, views: Math.round(avgByWeekday[i] * 10) / 10 })),
    pages, sections, referers, ...dims,
    // Pages growing faster than the site as a whole (at least 10 points faster)
    rising: pages.filter((p) => p.prevViews >= 3 && p.views > p.prevViews && p.change > (change(views, prevViews) || 0) + 0.1)
      .sort((a, b) => (b.views - b.prevViews) - (a.views - a.prevViews)).slice(0, 5),
    newReferrers: referers.filter((r) => r.isNew && r.key !== 'Direct / unknown').slice(0, 8),
  };
}
