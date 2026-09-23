#!/usr/bin/env node
// =====================================================================
// sponsor-stats.mjs — builds data/sponsorships/stats.public.json
//
// Run daily by .github/workflows/sponsor-stats.yml. No dependencies
// (Node 20+ fetch). Reads which videos to fetch from content.json.
//
//   YT_API_KEY              YouTube Data API v3 key (public data)
//   YT_OAUTH_CLIENT_ID      OAuth client for the YouTube Analytics API
//   YT_OAUTH_CLIENT_SECRET
//   YT_OAUTH_REFRESH_TOKEN  from scripts/get-refresh-token.mjs
//
//   node scripts/sponsor-stats.mjs            write the file if data changed
//   node scripts/sponsor-stats.mjs --dry-run  print the result, write nothing
//
// The repo and site are public: the output is built field by field from
// an allowlist. Never add revenue, traffic sources, demographics or
// retention here. If any request fails the script exits non-zero before
// writing, so the last good file stays in place.
// =====================================================================

import { readFile, writeFile } from 'node:fs/promises';

const CHANNEL_ID = 'UCSIxTP9PCM2kcTszONRxZ1w';
const ANALYTICS_LAG_DAYS = 3;          // Analytics data lags 2–3 days
const RECENT_UPLOADS = 6;
const TOP_COUNTRIES = 10;
const ENGLISH_SPEAKING = ['US', 'GB', 'CA', 'AU'];

const ROOT = new URL('../', import.meta.url);
const OUT_FILE = new URL('data/sponsorships/stats.public.json', ROOT);
const CONTENT_FILE = new URL('data/sponsorships/content.json', ROOT);

const DRY_RUN = process.argv.includes('--dry-run');

// --- Dates -----------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoDay(date) { return date.toISOString().slice(0, 10); }

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function fmtRange(start, end) {
  const [ay, am, ad] = start.split('-').map(Number);
  const [by, bm, bd] = end.split('-').map(Number);
  if (ay !== by) return `${fmtDate(start)}–${fmtDate(end)}`;
  if (am !== bm) return `${MONTHS[am - 1]} ${ad}–${MONTHS[bm - 1]} ${bd}, ${by}`;
  return `${MONTHS[am - 1]} ${ad}–${bd}, ${by}`;
}

const RUN_DATE = isoDay(new Date());
const A_END = addDays(RUN_DATE, -ANALYTICS_LAG_DAYS);
const A_START_28 = addDays(A_END, -27);
const A_START_90 = addDays(A_END, -89);

// --- Metric objects ----------------------------------------------------------
function period(start, end, display) {
  return { start, end, display: display || (start ? fmtRange(start, end) : `As of ${fmtDate(end)}`) };
}

function metric(value, unit, label, per, source) {
  if (unit !== 'share-list' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid value for "${label}": ${value}`);
  }
  return { value, unit, label, period: per, source, asOf: RUN_DATE };
}

const DATA_API = 'youtube-data-api';
const ANALYTICS_API = 'youtube-analytics-api';
const lifetime = (publishedAt) =>
  period(publishedAt ? publishedAt.slice(0, 10) : null, RUN_DATE, `All time · as of ${fmtDate(RUN_DATE)}`);
const last28 = period(A_START_28, A_END);
const last90 = period(A_START_90, A_END);

// --- HTTP --------------------------------------------------------------------
// Error messages never include URLs (the Data API key is a query param).
async function request(name, url, init = {}, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    if (attempt < 3) return request(name, url, init, attempt + 1);
    throw new Error(`${name}: network error (${err.name})`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return request(name, url, init, attempt + 1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body.error_description || (body.error && (body.error.message || body.error)) || res.statusText;
    throw new Error(`${name}: HTTP ${res.status} ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  }
  return body;
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

// --- YouTube Data API --------------------------------------------------------
async function dataApi(name, path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key: env('YT_API_KEY') }).forEach(([k, v]) => url.searchParams.set(k, v));
  return request(name, url);
}

async function fetchChannel() {
  const body = await dataApi('channels', 'channels', { part: 'statistics,contentDetails', id: CHANNEL_ID });
  const ch = body.items && body.items[0];
  if (!ch) throw new Error('channels: channel not found');
  if (ch.statistics.hiddenSubscriberCount) throw new Error('channels: subscriber count is hidden');
  return ch;
}

async function fetchRecentUploads(uploadsPlaylist) {
  const body = await dataApi('playlistItems', 'playlistItems', {
    part: 'contentDetails', playlistId: uploadsPlaylist, maxResults: String(RECENT_UPLOADS),
  });
  return (body.items || []).map((i) => i.contentDetails.videoId);
}

async function fetchVideos(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await dataApi('videos', 'videos', { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(',') });
    out.push(...(body.items || []));
  }
  return out;
}

// --- YouTube Analytics API ---------------------------------------------------
async function accessToken() {
  const body = await request('oauth token', 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('YT_OAUTH_CLIENT_ID'),
      client_secret: env('YT_OAUTH_CLIENT_SECRET'),
      refresh_token: env('YT_OAUTH_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!body.access_token) throw new Error('oauth token: no access token returned');
  return body.access_token;
}

async function report(name, token, params) {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  Object.entries({ ids: `channel==${CHANNEL_ID}`, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const body = await request(`analytics ${name}`, url, { headers: { Authorization: `Bearer ${token}` } });
  const cols = (body.columnHeaders || []).map((c) => c.name);
  return (body.rows || []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

// --- Build ---------------------------------------------------------------------
function featuredVideoIds(content) {
  const ids = new Set();
  (content.videoCategories || []).forEach((c) => (c.videos || []).forEach((v) => ids.add(v.id)));
  (content.caseStudies || []).forEach((c) => c.video && c.video.id && ids.add(c.video.id));
  return [...ids];
}

function int(v) { return Number.parseInt(v, 10); }

async function build() {
  const content = JSON.parse(await readFile(CONTENT_FILE, 'utf8'));
  const featured = featuredVideoIds(content);

  // Public data
  const channel = await fetchChannel();
  const recent = await fetchRecentUploads(channel.contentDetails.relatedPlaylists.uploads);
  const videoItems = await fetchVideos([...new Set([...featured, ...recent])]);

  // Private analytics (only aggregates listed below leave this script)
  const token = await accessToken();
  const range28 = { startDate: A_START_28, endDate: A_END };

  const [totals] = await report('totals', token, {
    ...range28, metrics: 'views,estimatedMinutesWatched,subscribersGained',
  });
  if (!totals) throw new Error('analytics totals: no rows');

  const byType = await report('content types', token, {
    ...range28, metrics: 'views', dimensions: 'creatorContentType',
  });
  if (!byType.length && totals.views > 0) throw new Error('analytics content types: no rows');
  const typeViews = (t) => byType.filter((r) => r.creatorContentType === t).reduce((s, r) => s + r.views, 0);

  const countries = await report('countries', token, {
    ...range28, metrics: 'views', dimensions: 'country', sort: '-views', maxResults: '250',
  });
  const countryTotal = countries.reduce((s, r) => s + r.views, 0);
  if (!countryTotal) throw new Error('analytics countries: no rows');
  const share = (v) => Math.round((v / countryTotal) * 1000) / 1000;

  const video90 = featured.length
    ? await report('featured videos', token, {
        startDate: A_START_90, endDate: A_END, metrics: 'views', dimensions: 'video',
        filters: `video==${featured.join(',')}`, sort: '-views', maxResults: '200',
      })
    : [];
  const views90 = Object.fromEntries(video90.map((r) => [r.video, r.views]));

  // Allowlisted output
  const s = channel.statistics;
  const englishShare = countries
    .filter((r) => ENGLISH_SPEAKING.includes(r.country))
    .reduce((sum, r) => sum + r.views, 0) / countryTotal;

  const metrics = {
    subscribers: metric(int(s.subscriberCount), 'count', 'Subscribers', period(null, RUN_DATE), DATA_API),
    totalViews: metric(int(s.viewCount), 'count', 'Total channel views', lifetime(null), DATA_API),
    videoCount: metric(int(s.videoCount), 'count', 'Public videos', period(null, RUN_DATE), DATA_API),
    longFormViews: metric(typeViews('VIDEO_ON_DEMAND'), 'count', 'Long-form views', last28, ANALYTICS_API),
    shortsViews: metric(typeViews('SHORTS'), 'count', 'Shorts views', last28, ANALYTICS_API),
    liveViews: metric(typeViews('LIVE_STREAM'), 'count', 'Live views', last28, ANALYTICS_API),
    viewsAllFormats: metric(totals.views, 'count', 'Views, all formats', last28, ANALYTICS_API),
    watchTimeHours: metric(Math.round(totals.estimatedMinutesWatched / 60), 'hours', 'Watch time', last28, ANALYTICS_API),
    subscribersGained: metric(totals.subscribersGained, 'count', 'Subscribers gained', last28, ANALYTICS_API),
    topCountries: metric(
      countries.slice(0, TOP_COUNTRIES).map((r) => ({ code: String(r.country), share: share(r.views) })),
      'share-list', 'Views by country', last28, ANALYTICS_API
    ),
    englishSpeakingShare: metric(Math.round(englishShare * 1000) / 1000, 'percent',
      'Views from the US, UK, Canada & Australia', last28, ANALYTICS_API),
  };

  const videos = {};
  videoItems.forEach((v) => {
    const st = v.statistics || {};
    const published = v.snippet.publishedAt;
    const m = { views: metric(int(st.viewCount), 'count', 'Views', lifetime(published), DATA_API) };
    if (st.likeCount !== undefined) m.likes = metric(int(st.likeCount), 'count', 'Likes', lifetime(published), DATA_API);
    if (st.commentCount !== undefined) m.comments = metric(int(st.commentCount), 'count', 'Comments', lifetime(published), DATA_API);
    if (featured.includes(v.id)) {
      m.recentViews = metric(views90[v.id] || 0, 'count', 'Views in the last 90 days', last90, ANALYTICS_API);
    }
    videos[v.id] = { id: v.id, title: String(v.snippet.title), publishedAt: published, metrics: m };
  });

  const missing = featured.filter((id) => !videos[id]);
  if (missing.length) console.warn(`Featured videos not returned (private or deleted?): ${missing.join(', ')}`);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'sponsor-stats-action',
    channel: {
      id: CHANNEL_ID,
      handle: '@jareddesu',
      title: 'まだまだJared',
      url: 'https://www.youtube.com/@jareddesu',
    },
    analyticsWindow: { lagDays: ANALYTICS_LAG_DAYS, last28: { start: A_START_28, end: A_END }, last90: { start: A_START_90, end: A_END } },
    metrics,
    recentUploads: recent,
    videos,
  };
}

// Compare everything except run timestamps, so an unchanged day is a no-op
function comparable(obj) {
  return JSON.stringify(obj, (key, value) => (key === 'generatedAt' || key === 'asOf' ? undefined : value));
}

async function main() {
  const next = await build();
  const json = `${JSON.stringify(next, null, 2)}\n`;

  if (DRY_RUN) {
    process.stdout.write(json);
    return;
  }

  const prev = await readFile(OUT_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (prev && comparable(prev) === comparable(next)) {
    console.log('No data changes; leaving stats.public.json as is.');
    return;
  }
  await writeFile(OUT_FILE, json);
  console.log(`Wrote stats.public.json (analytics window ${A_START_28} to ${A_END}).`);
}

main().catch((err) => {
  console.error(`sponsor-stats failed; keeping the last good file.\n${err.message}`);
  process.exit(1);
});
