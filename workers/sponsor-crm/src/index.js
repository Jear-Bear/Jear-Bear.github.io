// Sponsor CRM Worker — the private backend for /sponsorships/manage/.
//
//   POST /api/login                 { password } -> { token, expiresAt }
//   POST /api/logout-all            sign out every device
//   GET  /api/state                 everything the app needs
//   GET  /api/dashboard             computed metrics (same code as the app)
//   GET  /api/activities?company_id=…&deal_id=…
//   POST /api/:type                 create
//   PATCH /api/:type/:id            update
//   POST /api/:type/:id/archive     { archived: true | false }
//   PUT  /api/settings/:key         targets | categories
//   POST /api/import                spreadsheet rows parsed in the browser
//   GET  /api/export                everything, for .xlsx / CSV / JSON export
//
// Every route but /api/login and /api/health needs a Bearer session token.

import {
  configured, passwordMatches, issueToken, verifyToken, lockState, recordFailure, recordSuccess,
} from './auth.js';
import {
  HttpError, loadState, listActivities, createRecord, updateRecord, setArchived, putSetting,
  importAll, exportAll, getSetting, settingsFor,
} from './data.js';
import { dashboard, todayIn } from '../../../scripts/manage/rules.js';

const TYPES = {
  companies: 'companies', contacts: 'contacts', deals: 'deals', payments: 'payments',
  videos: 'videos', 'rate-card': 'rate_card', activities: 'activities',
};
const MAX_BODY = 1024 * 1024;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function allowedOrigin(env, origin) {
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (env.ALLOW_LOCALHOST === 'true' && LOCAL_ORIGIN.test(origin)) return origin;
  return null;
}

function json(data, status = 200, origin = null, extra = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Request too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Request too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Body must be JSON'); }
}

const epochOf = (db) => getSetting(db, 'session_epoch', 1);

async function login(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const nowS = Math.floor(Date.now() / 1000);
  const lock = await lockState(env.DB, ip, nowS);
  if (lock.locked) {
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(lock.retryAfter / 60)} min.`, { retryAfter: lock.retryAfter });
  }
  const body = await readJson(request);
  if (!(await passwordMatches(env, body.password))) {
    await recordFailure(env.DB, ip, nowS);
    throw new HttpError(401, 'Wrong password');
  }
  await recordSuccess(env.DB, ip);
  return issueToken(env, await epochOf(env.DB));
}

async function requireSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = token && (await verifyToken(env, token, await epochOf(env.DB)));
  if (!session) throw new HttpError(401, 'Please sign in again');
  return session;
}

async function route(request, env, url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', …]
  if (parts[0] !== 'api') throw new HttpError(404, 'Not found');
  const [, a, b, c] = parts;
  const m = request.method;

  if (m === 'GET' && a === 'health') return { ok: true, configured: configured(env) };
  if (!configured(env)) throw new HttpError(503, 'The CRM isn’t configured yet (missing secrets)');
  if (m === 'POST' && a === 'login' && !b) return login(request, env);

  await requireSession(request, env);
  const db = env.DB;

  if (m === 'POST' && a === 'logout-all' && !b) {
    const next = (await epochOf(db)) + 1;
    await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind('session_epoch', JSON.stringify(next), new Date().toISOString()).run();
    return { ok: true };
  }
  if (m === 'GET' && a === 'state' && !b) return loadState(db);
  if (m === 'GET' && a === 'dashboard' && !b) {
    const state = await loadState(db);
    const settings = await settingsFor(db);
    return dashboard(state, { today: todayIn(settings.tz), targets: settings.targets });
  }
  if (m === 'GET' && a === 'activities' && !b) {
    return listActivities(db, { company_id: url.searchParams.get('company_id'), deal_id: url.searchParams.get('deal_id') });
  }
  if (m === 'PUT' && a === 'settings' && b && !c) return putSetting(db, b, (await readJson(request)).value);
  if (m === 'POST' && a === 'import' && !b) return importAll(db, await readJson(request));
  if (m === 'GET' && a === 'export' && !b) return exportAll(db);

  const type = TYPES[a];
  if (type) {
    if (m === 'POST' && !b) return createRecord(db, type, await readJson(request));
    if (m === 'PATCH' && b && !c) return updateRecord(db, type, b, await readJson(request));
    if (m === 'POST' && b && c === 'archive') return setArchived(db, type, b, (await readJson(request)).archived);
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(env, request.headers.get('Origin'));

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    // Browsers from other sites get nothing back
    if (request.headers.get('Origin') && !origin) return json({ error: 'Origin not allowed' }, 403);

    try {
      return json(await route(request, env, url), 200, origin);
    } catch (err) {
      if (err instanceof HttpError) {
        const extra = err.status === 429 && err.details ? { 'Retry-After': String(err.details.retryAfter) } : {};
        return json({ error: err.message, details: err.details }, err.status, origin, extra);
      }
      console.error('Unhandled error', err && err.message);
      return json({ error: 'Something went wrong' }, 500, origin);
    }
  },
};
