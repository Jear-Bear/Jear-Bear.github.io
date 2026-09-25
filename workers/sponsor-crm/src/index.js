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
//   GET  /api/calendar?from=…&to=…  one-off items, exceptions and series
//   POST|PATCH|DELETE /api/cal-items[/:id]      (plan items can't be deleted)
//   POST /api/cal-items/:id/accept|dismiss      Claude suggestions
//   POST|PATCH|DELETE /api/cal-series[/:id]
//   PUT  /api/cal-series/:id/occurrences/:date  change one occurrence
//   DELETE /api/cal-series/:id/occurrences/:date  undo that change
//   POST /api/plan                  import the private plan file
//   GET  /api/uploads               the channel's uploads (cached)
//   POST /api/uploads/refresh       refetch them from the YouTube Data API
//   GET  /api/insights              channel history, income, finance, insights (Phase 4)
//   POST /api/stats/refresh         read the public stats file into the history
//   PUT  /api/income                { month, source, amount } (amount null clears it)
//   POST /api/rate-rules/:id/accept|dismiss   accept writes the new rates
//   POST /api/ingest/stats          from the stats Action (Bearer CRM_INGEST_KEY)
//   POST /api/invoices              number an invoice and record it as a payment
//   GET  /go/:slug                  tracked sponsor link: redirect + count (public)
//   GET|POST /api/drafts, POST /api/drafts/:id/cancel   ask Claude to draft an email
//   GET  /public/availability       open sponsor slots by month (public, counts only)
//   POST /public/inquiry            the sponsor-page form → Review (public, rate-limited)
//
// A daily cron refreshes the uploads (capturing 30-day views) and the history.
//
// Every route but /api/login and /api/health needs a Bearer session token.

import {
  configured, passwordMatches, ingestKeyMatches, issueToken, verifyToken, lockState, recordFailure, recordSuccess,
} from './auth.js';
import {
  HttpError, loadState, listActivities, createRecord, updateRecord, setArchived, putSetting,
  importAll, exportAll, getSetting, settingsFor,
} from './data.js';
import { dashboard, todayIn } from '../../../scripts/manage/rules.js';
import {
  loadCalendar, createItem, updateItem, deleteItem, decideSuggestion,
  createSeries, updateSeries, deleteSeries, editOccurrence, importPlan,
} from './calendar.js';
import { listUploads, refreshUploads } from './youtube.js';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { createServer } from './mcp.js';
import { handleAuthorize, redirectAllowed } from './authorize.js';
import { listReview, passProposal, dismissProposal, decideIdea } from './claude.js';
import { ingestStats, pullPublicStats, loadInsights, putIncome, decideRateRule } from './stats.js';
import { handleGo, createInvoice } from './growth.js';
import { listDrafts, requestDraft, closeDraft } from './drafts.js';
import { availability, inquiry } from './public.js';

const TYPES = {
  companies: 'companies', contacts: 'contacts', deals: 'deals', payments: 'payments',
  videos: 'videos', 'rate-card': 'rate_card', activities: 'activities', links: 'links',
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
  const [, a, b, c, d, e] = parts;
  const m = request.method;

  if (m === 'GET' && a === 'health') return { ok: true, configured: configured(env) };
  if (!configured(env)) throw new HttpError(503, 'The CRM isn’t configured yet (missing secrets)');
  if (m === 'POST' && a === 'login' && !b) return login(request, env);
  if (m === 'POST' && a === 'ingest' && b === 'stats' && !c) {
    const auth = request.headers.get('Authorization') || '';
    if (!(await ingestKeyMatches(env, auth.startsWith('Bearer ') ? auth.slice(7) : ''))) throw new HttpError(401, 'Bad ingest key');
    return ingestStats(env.DB, await readJson(request));
  }

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

  if (a === 'calendar' && !b && m === 'GET') return loadCalendar(db, url.searchParams.get('from'), url.searchParams.get('to'));
  if (a === 'plan' && !b && m === 'POST') return importPlan(db, await readJson(request));
  if (a === 'uploads' && !b && m === 'GET') return listUploads(db);
  if (a === 'uploads' && b === 'refresh' && !c && m === 'POST') return refreshUploads(env, db);
  if (a === 'invoices' && !b && m === 'POST') return createInvoice(db, await readJson(request));
  if (a === 'drafts' && !b && m === 'GET') return listDrafts(db);
  if (a === 'drafts' && !b && m === 'POST') return requestDraft(db, await readJson(request));
  if (a === 'drafts' && b && c === 'cancel' && !d && m === 'POST') return closeDraft(db, b, { status: 'cancelled' });
  if (a === 'insights' && !b && m === 'GET') return loadInsights(db);
  if (a === 'stats' && b === 'refresh' && !c && m === 'POST') return pullPublicStats(db);
  if (a === 'income' && !b && m === 'PUT') return putIncome(db, await readJson(request));
  if (a === 'rate-rules' && b && (c === 'accept' || c === 'dismiss') && !d && m === 'POST') {
    const settings = await settingsFor(db);
    return decideRateRule(db, b, c === 'accept', await readJson(request), todayIn(settings.tz));
  }
  if (a === 'cal-items') {
    if (m === 'POST' && !b) return createItem(db, await readJson(request));
    if (m === 'PATCH' && b && !c) return updateItem(db, b, await readJson(request));
    if (m === 'DELETE' && b && !c) return deleteItem(db, b);
    if (m === 'POST' && b && (c === 'accept' || c === 'dismiss') && !d) return decideSuggestion(db, b, c === 'accept');
  }
  if (a === 'cal-series') {
    if (m === 'POST' && !b) return createSeries(db, await readJson(request));
    if (m === 'PATCH' && b && !c) return updateSeries(db, b, await readJson(request));
    if (m === 'DELETE' && b && !c) return deleteSeries(db, b);
    if (m === 'PUT' && b && c === 'occurrences' && d && !e) return editOccurrence(db, b, d, await readJson(request));
    if (m === 'DELETE' && b && c === 'occurrences' && d && !e) {
      const ex = await db.prepare('SELECT id FROM cal_items WHERE series_id = ? AND original_date = ?').bind(b, d).first();
      if (!ex) throw new HttpError(404, 'No change to undo');
      await db.prepare('DELETE FROM cal_items WHERE id = ?').bind(ex.id).run();
      return { deleted: ex.id };
    }
  }

  // Review queue (what Claude filed)
  if (a === 'review' && !b && m === 'GET') return listReview(db);
  if (a === 'proposals' && b === 'pass-batch' && !c && m === 'POST') {
    const { ids } = await readJson(request);
    if (!Array.isArray(ids) || !ids.length || ids.length > 5) throw new HttpError(400, 'Pass 1–5 proposal IDs at a time');
    const results = [];
    for (const id of ids) {
      try { results.push({ id, ...(await passProposal(db, id, null)) }); } catch (err) { results.push({ id, error: err.message }); }
    }
    return { results };
  }
  if (a === 'proposals' && b && c === 'pass' && !d && m === 'POST') return passProposal(db, b, (await readJson(request)).values || null);
  if (a === 'proposals' && b && c === 'dismiss' && !d && m === 'POST') return dismissProposal(db, b, (await readJson(request)).reason);
  if (a === 'ideas' && b && (c === 'keep' || c === 'dismiss') && !d && m === 'POST') return decideIdea(db, b, c === 'keep');

  // Connected Claude sessions (OAuth grants)
  if (a === 'claude' && b === 'grants') {
    const oauth = env.OAUTH_PROVIDER;
    if (!oauth) throw new HttpError(503, 'The connector isn’t set up');
    if (m === 'GET' && !c) {
      const list = await oauth.listUserGrants('owner');
      return Promise.all(list.items.map(async (g) => {
        const client = await oauth.lookupClient(g.clientId).catch(() => null);
        return { id: g.id, client: (client && client.clientName) || (g.metadata && g.metadata.label) || 'Unknown app', createdAt: g.createdAt * 1000, expiresAt: g.expiresAt ? g.expiresAt * 1000 : null, scope: g.scope };
      }));
    }
    if (m === 'DELETE' && c && !d) { const gid = decodeURIComponent(c); await oauth.revokeGrant(gid, 'owner'); return { revoked: gid }; }
  }

  const type = TYPES[a];
  if (type) {
    if (m === 'POST' && !b) return createRecord(db, type, await readJson(request));
    if (m === 'PATCH' && b && !c) return updateRecord(db, type, b, await readJson(request));
    if (m === 'POST' && b && c === 'archive') return setArchived(db, type, b, (await readJson(request)).archived);
  }
  throw new HttpError(404, 'Not found');
}

const app = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const go = url.pathname.match(/^\/go\/([^/]+)\/?$/);
    if (go && (request.method === 'GET' || request.method === 'HEAD')) {
      let slug = go[1];
      try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
      return handleGo(request, env, ctx, slug);
    }
    if (url.pathname === '/authorize') {
      if (!configured(env)) return new Response('Not configured', { status: 503 });
      return handleAuthorize(request, env);
    }
    const origin = allowedOrigin(env, request.headers.get('Origin'));

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    // Browsers from other sites get nothing back
    if (request.headers.get('Origin') && !origin) return json({ error: 'Origin not allowed' }, 403);

    // Public endpoints for the sponsor page (no sign-in)
    if (url.pathname === '/public/availability' && request.method === 'GET') {
      if (!configured(env)) return json({ error: 'Not configured' }, 503, origin);
      return json(await availability(env.DB, 'America/Chicago'), 200, origin, { 'Cache-Control': 'public, max-age=900' });
    }
    if (url.pathname === '/public/inquiry' && request.method === 'POST') {
      if (!origin) return json({ error: 'Origin not allowed' }, 403);
      if (!configured(env)) return json({ error: 'Not configured' }, 503, origin);
      try { return json(await inquiry(request, env), 200, origin); } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status, origin);
        console.error('Inquiry failed', err && err.message);
        return json({ error: 'Something went wrong' }, 500, origin);
      }
    }

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

// --- Claude connector: OAuth around a remote MCP server at /mcp -----------------------------
// The provider owns /oauth/token, /oauth/register and the discovery documents;
// /authorize (above) is ours; /mcp needs a token; everything else is the app.
const mcpHandler = {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env), { route: '/mcp' })(request, env, ctx);
  },
};

let provider = null;
function oauthProvider(env, origin) {
  if (!provider) {
    const base = env.PUBLIC_ORIGIN || origin;
    provider = new OAuthProvider({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler: app,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['crm'],
      resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['crm'] },
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 60 * 60,
      refreshTokenTTL: 60 * 60 * 24 * 90,
      refreshTokenIdleTTL: 60 * 60 * 24 * 30,
      // Only register clients that return to Claude (or localhost, for testing)
      clientRegistrationCallback: ({ clientMetadata }) => {
        const uris = Array.isArray(clientMetadata.redirect_uris) ? clientMetadata.redirect_uris : [];
        if (!uris.length || !uris.every((u) => typeof u === 'string' && redirectAllowed(u))) {
          return { error: 'invalid_redirect_uri', error_description: 'Only Claude can register with Sponsor desk' };
        }
        return undefined;
      },
    });
  }
  return provider;
}

// Daily: refresh the uploads (keeps each video's views at 30 days) and the
// channel history from the public stats file. Each step is independent.
async function daily(env) {
  if (!configured(env)) return;
  const steps = [['public stats', () => pullPublicStats(env.DB)]];
  if (env.YT_API_KEY) steps.push(['uploads', () => refreshUploads(env, env.DB)]);
  for (const [name, run] of steps) {
    try { await run(); } catch (err) { console.error(`Daily ${name} failed:`, err && err.message); }
  }
}

export default {
  fetch(request, env, ctx) {
    // Without the OAuth store (e.g. before KV is set up) serve the app alone
    if (!env.OAUTH_KV) return app.fetch(request, env, ctx);
    return oauthProvider(env, new URL(request.url).origin).fetch(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env));
  },
};
