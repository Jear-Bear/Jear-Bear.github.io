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
//   DASHBOARD_PASSWORD      optional; when set, also writes the encrypted
//                           sponsor-dashboard file stats.private.enc.json
//
//   node scripts/sponsor-stats.mjs            write the file if data changed
//   node scripts/sponsor-stats.mjs --dry-run  print the result, write nothing
//
// The repo and site are public: stats.public.json is built field by field
// from an allowlist. Traffic sources, demographics and retention go only in
// the encrypted private file. Revenue is never fetched: the OAuth scope
// (yt-analytics.readonly) can't read it. If any request fails the script
// exits non-zero before writing, so the last good files stay in place.
// =====================================================================

import { readFile, writeFile } from 'node:fs/promises';

const CHANNEL_ID = 'UCSIxTP9PCM2kcTszONRxZ1w';
const ANALYTICS_LAG_DAYS = 3;          // Analytics data lags 2–3 days
const RECENT_UPLOADS = 6;
const TOP_COUNTRIES = 10;
const ENGLISH_SPEAKING = ['US', 'GB', 'CA', 'AU'];

const ROOT = new URL('../', import.meta.url);
const OUT_FILE = new URL('data/sponsorships/stats.public.json', ROOT);
const PRIVATE_FILE = new URL('data/sponsorships/stats.private.enc.json', ROOT);
const CONTENT_FILE = new URL('data/sponsorships/content.json', ROOT);

const DRY_RUN = process.argv.includes('--dry-run');

// Anyone can download the encrypted file and guess offline, so the
// password must be long and random (e.g. `openssl rand -base64 18`)
const MIN_PASSWORD_LENGTH = 16;
const PBKDF2_ITERATIONS = 600000;

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
  if (!/-(list|series)$/.test(unit) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
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

// Day rows → one number per day from start to end (days without rows are 0)
function dailySeries(rows, start, end) {
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.views]));
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(byDay[d] || 0);
  return out;
}

// Rows → [{ code, share, views }] sorted by views, shares of the rows' total
function shareList(rows, dim) {
  const total = rows.reduce((s, r) => s + r.views, 0);
  return rows
    .filter((r) => r.views > 0)
    .sort((a, b) => b.views - a.views)
    .map((r) => ({ code: String(r[dim]), share: total ? Math.round((r.views / total) * 1000) / 1000 : 0, views: r.views }));
}

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
  const body = await dataApi('channels', 'channels', { part: 'snippet,statistics,contentDetails', id: CHANNEL_ID });
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

// The Data API rounds subscriber counts down to three significant figures
// (13,5xx -> 13,500). Lifetime gained minus lost from Analytics gives the
// exact count as of A_END. Use it only when it agrees with the rounded count
// (allowing for the rounding and a few days of growth); otherwise publish
// the rounded one.
async function exactSubscribers(token, channel) {
  const rounded = int(channel.statistics.subscriberCount);
  const fallback = metric(rounded, 'count', 'Subscribers', period(null, RUN_DATE), DATA_API);
  const since = String(channel.snippet.publishedAt || '').slice(0, 10);
  if (!since || since > A_END) return fallback;

  const [row] = await report('lifetime subscribers', token, {
    startDate: since, endDate: A_END, metrics: 'subscribersGained,subscribersLost',
  });
  const net = row ? row.subscribersGained - row.subscribersLost : NaN;
  const unit = 10 ** Math.max(0, String(rounded).length - 3);
  if (!Number.isFinite(net) || Math.abs(net - rounded) > unit + rounded * 0.03) {
    console.warn(`Exact subscriber count ${net} disagrees with ${rounded}; publishing the rounded count.`);
    return fallback;
  }
  const m = metric(net, 'count', 'Subscribers', period(null, A_END), ANALYTICS_API);
  m.exact = true;
  return m;
}

// --- Build ---------------------------------------------------------------------
function featuredVideoIds(content) {
  const ids = new Set();
  (content.videoCategories || []).forEach((c) => (c.videos || []).forEach((v) => ids.add(v.id)));
  (content.caseStudies || []).forEach((c) => c.video && c.video.id && ids.add(c.video.id));
  return [...ids];
}

function int(v) { return Number.parseInt(v, 10); }

async function build({ includePrivate }) {
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
  // Match content types loosely (API casing/naming varies) and log what came back
  console.warn(`Content types: ${byType.map((r) => `${r.creatorContentType}=${r.views}`).join(', ') || 'none'}`);
  const norm = (v) => String(v).toLowerCase().replace(/[^a-z]/g, '');
  const typeViews = (aliases) => byType
    .filter((r) => aliases.includes(norm(r.creatorContentType)))
    .reduce((s, r) => s + r.views, 0);
  const LONG_FORM = ['videoondemand', 'longform', 'longformcontent', 'vod'];
  const SHORTS = ['shorts', 'short', 'shortform'];
  const LIVE = ['livestream', 'live'];
  // If none of the returned types is recognized, leave these metrics out
  // rather than publish zeros
  const typesKnown = typeViews([...LONG_FORM, ...SHORTS, ...LIVE]) > 0;
  if (!typesKnown && totals.views > 0) {
    console.warn('No recognized content types; omitting long-form/Shorts/live views this run.');
  }

  const countries = await report('countries', token, {
    ...range28, metrics: 'views', dimensions: 'country', sort: '-views', maxResults: '250',
  });
  const countryTotal = countries.reduce((s, r) => s + r.views, 0);
  if (!countryTotal) throw new Error('analytics countries: no rows');
  const share = (v) => Math.round((v / countryTotal) * 1000) / 1000;

  const video90 = featured.length
    ? await report('featured videos', token, {
        startDate: A_START_90, endDate: A_END, dimensions: 'video',
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
        filters: `video==${featured.join(',')}`, sort: '-views', maxResults: '200',
      })
    : [];
  const views90 = Object.fromEntries(video90.map((r) => [r.video, r.views]));

  const subscribers = await exactSubscribers(token, channel);

  // Allowlisted output
  const s = channel.statistics;
  const englishShare = countries
    .filter((r) => ENGLISH_SPEAKING.includes(r.country))
    .reduce((sum, r) => sum + r.views, 0) / countryTotal;

  const metrics = {
    subscribers,
    totalViews: metric(int(s.viewCount), 'count', 'Total channel views', lifetime(null), DATA_API),
    videoCount: metric(int(s.videoCount), 'count', 'Public videos', period(null, RUN_DATE), DATA_API),
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
  if (typesKnown) {
    metrics.longFormViews = metric(typeViews(LONG_FORM), 'count', 'Long-form views', last28, ANALYTICS_API);
    metrics.shortsViews = metric(typeViews(SHORTS), 'count', 'Shorts views', last28, ANALYTICS_API);
    metrics.liveViews = metric(typeViews(LIVE), 'count', 'Live views', last28, ANALYTICS_API);
  }

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

  // Daily views for the trend charts: the channel, and each featured video
  // (from its publish date if that's inside the 90-day window)
  const dailyParams = { startDate: A_START_90, endDate: A_END, metrics: 'views', dimensions: 'day', sort: 'day' };
  const channelDaily = await report('daily views', token, dailyParams);
  metrics.dailyViews = metric(dailySeries(channelDaily, A_START_90, A_END), 'daily-series', 'Daily views', last90, ANALYTICS_API);

  for (const id of featured) {
    if (!videos[id]) continue;
    const published = videos[id].publishedAt.slice(0, 10);
    const start = published > A_START_90 ? published : A_START_90;
    if (start > A_END) continue;
    const rows = await report(`daily views ${id}`, token, { ...dailyParams, startDate: start, filters: `video==${id}` });
    videos[id].metrics.dailyViews = metric(dailySeries(rows, start, A_END), 'daily-series',
      'Daily views', period(start, A_END), ANALYTICS_API);
  }

  const missing = featured.filter((id) => !videos[id]);
  if (missing.length) console.warn(`Featured videos not returned (private or deleted?): ${missing.join(', ')}`);

  const generatedAt = new Date().toISOString();
  const pub = {
    schemaVersion: 1,
    generatedAt,
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

  if (!includePrivate) return { pub, priv: null };
  return { pub, priv: await buildPrivate(token, featured, video90, generatedAt) };
}

// --- Private (encrypted) dashboard data -------------------------------------
// No revenue: the token's scope can't read it, and nothing here asks for it.
async function buildPrivate(token, featured, video90, generatedAt) {
  const range28 = { startDate: A_START_28, endDate: A_END };
  const range90 = { startDate: A_START_90, endDate: A_END };

  const [retention] = await report('retention', token, {
    ...range28, metrics: 'averageViewDuration,averageViewPercentage',
  });
  const traffic = await report('traffic sources', token, {
    ...range28, metrics: 'views', dimensions: 'insightTrafficSourceType',
  });
  const subscribed = await report('subscribed status', token, {
    ...range28, metrics: 'views', dimensions: 'subscribedStatus',
  });
  const devices = await report('devices', token, {
    ...range28, metrics: 'views', dimensions: 'deviceType',
  });
  // Demographics are sparse over 28 days, so use 90
  const demo = await report('demographics', token, {
    ...range90, metrics: 'viewerPercentage', dimensions: 'ageGroup,gender',
  });

  // Only counts go to the (public) Action log, never the percentages
  console.warn(`Demographics: ${new Set(demo.map((r) => r.ageGroup)).size} age groups × ` +
    `${new Set(demo.map((r) => r.gender)).size} genders (${demo.length} rows)`);

  const sumBy = (rows, key) => {
    const out = {};
    rows.forEach((r) => { out[r[key]] = (out[r[key]] || 0) + r.viewerPercentage; });
    return Object.entries(out)
      .map(([code, pct]) => ({ code, share: Math.round(pct * 10) / 1000 }))
      .filter((r) => r.share > 0);
  };

  const metrics = {
    averageViewDuration: metric(Math.round(retention ? retention.averageViewDuration : 0), 'seconds',
      'Average view duration', last28, ANALYTICS_API),
    averageViewPercentage: metric(Math.round(retention ? retention.averageViewPercentage : 0) / 100, 'percent',
      'Average percentage viewed', last28, ANALYTICS_API),
    trafficSources: metric(shareList(traffic, 'insightTrafficSourceType'), 'share-list',
      'How viewers find the videos', last28, ANALYTICS_API),
    subscribedStatus: metric(shareList(subscribed, 'subscribedStatus'), 'share-list',
      'Views from subscribers vs. non-subscribers', last28, ANALYTICS_API),
    deviceTypes: metric(shareList(devices, 'deviceType'), 'share-list', 'Views by device', last28, ANALYTICS_API),
    ageGroups: metric(sumBy(demo, 'ageGroup').sort((a, b) => a.code.localeCompare(b.code)), 'share-list',
      'Viewers by age', last90, ANALYTICS_API),
    genders: metric(sumBy(demo, 'gender').sort((a, b) => b.share - a.share), 'share-list',
      'Viewers by gender', last90, ANALYTICS_API),
    // Cross-tab for the age × gender chart: share of all viewers per cell
    ageGender: metric(
      demo
        .filter((r) => r.viewerPercentage > 0)
        .map((r) => ({ age: String(r.ageGroup), gender: String(r.gender), share: Math.round(r.viewerPercentage * 10) / 1000 }))
        .sort((a, b) => a.age.localeCompare(b.age) || a.gender.localeCompare(b.gender)),
      'age-gender-list', 'Viewers by age and gender', last90, ANALYTICS_API),
  };

  const videos = {};
  video90.forEach((r) => {
    if (!featured.includes(r.video)) return;
    videos[r.video] = {
      id: r.video,
      metrics: {
        watchTimeHours: metric(Math.round(r.estimatedMinutesWatched / 60), 'hours', 'Watch time', last90, ANALYTICS_API),
        averageViewDuration: metric(Math.round(r.averageViewDuration), 'seconds', 'Average view duration', last90, ANALYTICS_API),
        averageViewPercentage: metric(Math.round(r.averageViewPercentage) / 100, 'percent', 'Average percentage viewed', last90, ANALYTICS_API),
      },
    };
  });

  return { schemaVersion: 1, generatedAt, metrics, videos };
}

// --- Encryption (same format the dashboard decrypts with WebCrypto) ---------
const { subtle } = globalThis.crypto;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (str) => new Uint8Array(Buffer.from(str, 'base64'));

async function deriveKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encrypt(obj, password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return {
    format: 'jareddesu-sponsor-dashboard',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    ciphertext: b64(new Uint8Array(data)),
  };
}

async function decrypt(file, password) {
  const key = await deriveKey(password, unb64(file.kdf.salt), file.kdf.iterations);
  const data = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.cipher.iv) }, key, unb64(file.ciphertext));
  return JSON.parse(new TextDecoder().decode(data));
}

// Compare everything except run timestamps, so an unchanged day is a no-op
function comparable(obj) {
  return JSON.stringify(obj, (key, value) => (key === 'generatedAt' || key === 'asOf' ? undefined : value));
}

async function main() {
  const password = process.env.DASHBOARD_PASSWORD || '';
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`DASHBOARD_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (use a random one).`);
  }
  if (!password) console.warn('DASHBOARD_PASSWORD not set; skipping the sponsor dashboard file.');

  // Everything is fetched before anything is written
  const { pub, priv } = await build({ includePrivate: Boolean(password) });

  if (DRY_RUN) {
    process.stdout.write(`${JSON.stringify({ public: pub, private: priv }, null, 2)}\n`);
    return;
  }

  const prev = await readFile(OUT_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (prev && comparable(prev) === comparable(pub)) {
    console.log('No data changes; leaving stats.public.json as is.');
  } else {
    await writeFile(OUT_FILE, `${JSON.stringify(pub, null, 2)}\n`);
    console.log(`Wrote stats.public.json (analytics window ${A_START_28} to ${A_END}).`);
  }

  if (!priv) return;
  // Each encryption is different (random salt/IV), so compare the decrypted
  // contents. A file that no longer decrypts (password changed) is replaced.
  const prevEnc = await readFile(PRIVATE_FILE, 'utf8').then(JSON.parse).catch(() => null);
  const prevPriv = prevEnc ? await decrypt(prevEnc, password).catch(() => null) : null;
  if (prevPriv && comparable(prevPriv) === comparable(priv)) {
    console.log('No data changes; leaving stats.private.enc.json as is.');
    return;
  }
  await writeFile(PRIVATE_FILE, `${JSON.stringify(await encrypt(priv, password), null, 2)}\n`);
  console.log('Wrote stats.private.enc.json (encrypted).');
}

main().catch((err) => {
  console.error(`sponsor-stats failed; keeping the last good file.\n${err.message}`);
  process.exit(1);
});
