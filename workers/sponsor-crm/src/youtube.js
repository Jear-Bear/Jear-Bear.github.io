// youtube.js — the channel's uploads from the YouTube Data API (free quota,
// API key only: public data). Cached in D1 and refreshed on demand.
//
// A refresh costs about 1 + pages + pages API units (well under the 10,000
// daily quota) and a handful of subrequests: 1 channel call, up to 4 pages
// of 50 uploads, the same number of video-detail calls, and one D1 batch.

import { HttpError } from './data.js';

const MAX_PAGES = 4;                 // 200 most recent uploads

function parseDuration(iso) {       // "PT1H2M3S" -> seconds
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + ((+m[3] || 0) * 60) + (+m[4] || 0);
}

async function yt(env, path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key: env.YT_API_KEY }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  // Never echo the URL: it carries the key
  if (!res.ok) throw new HttpError(502, `YouTube ${path}: ${(body.error && body.error.message) || res.status}`);
  return body;
}

export async function listUploads(db) {
  const r = await db.prepare('SELECT * FROM uploads ORDER BY published_at DESC').all();
  return { uploads: r.results };
}

export async function refreshUploads(env, db) {
  if (!env.YT_API_KEY) throw new HttpError(503, 'The YouTube key isn’t set on the Worker yet (redeploy after adding YT_API_KEY)');
  if (!env.YT_CHANNEL_ID) throw new HttpError(503, 'YT_CHANNEL_ID isn’t set');
  const ch = await yt(env, 'channels', { part: 'contentDetails', id: env.YT_CHANNEL_ID });
  const playlist = ch.items && ch.items[0] && ch.items[0].contentDetails.relatedPlaylists.uploads;
  if (!playlist) throw new HttpError(502, 'Couldn’t find the channel’s uploads');

  const ids = [];
  let pageToken = '';
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await yt(env, 'playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    (page.items || []).forEach((it) => ids.push(it.contentDetails.videoId));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  const now = new Date().toISOString();
  const stmts = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await yt(env, 'videos', { part: 'snippet,statistics,contentDetails,status', id: ids.slice(i, i + 50).join(',') });
    for (const v of body.items || []) {
      const t = v.snippet.thumbnails || {};
      const thumb = (t.medium || t.default || {}).url || null;
      stmts.push(db.prepare(
        'INSERT INTO uploads (youtube_id, title, published_at, thumbnail, duration_s, views, likes, comments, privacy, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
        + 'ON CONFLICT (youtube_id) DO UPDATE SET title = excluded.title, published_at = excluded.published_at, thumbnail = excluded.thumbnail, '
        + 'duration_s = excluded.duration_s, views = excluded.views, likes = excluded.likes, comments = excluded.comments, privacy = excluded.privacy, fetched_at = excluded.fetched_at',
      ).bind(
        v.id, String(v.snippet.title || '').slice(0, 300), v.snippet.publishedAt || null,
        thumb && /^https:\/\/i\.ytimg\.com\//.test(thumb) ? thumb : null,
        parseDuration(v.contentDetails && v.contentDetails.duration),
        v.statistics && v.statistics.viewCount != null ? Number(v.statistics.viewCount) : null,
        v.statistics && v.statistics.likeCount != null ? Number(v.statistics.likeCount) : null,
        v.statistics && v.statistics.commentCount != null ? Number(v.statistics.commentCount) : null,
        (v.status && v.status.privacyStatus) || null, now,
      ));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { ...(await listUploads(db)), refreshed: stmts.length, fetchedAt: now };
}
