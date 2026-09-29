// traffic.js — website traffic from Cloudflare Web Analytics.
//
// The public pages load Cloudflare's cookieless beacon. Once a day (and on
// "Refresh" in the app) this reads the last 7 days of aggregated counts from
// Cloudflare's GraphQL Analytics API and keeps them in D1 (site_traffic), so
// history builds up here and the app never talks to Cloudflare directly.
//
// Needs two Worker secrets: CF_ANALYTICS_TOKEN (an API token with only
// Account → Account Analytics → Read) and CF_ACCOUNT_ID.

import { HttpError, getSetting } from './data.js';
import { DIMS } from '../../../scripts/manage/traffic.js';

const GQL = 'https://api.cloudflare.com/client/v4/graphql';
const HOSTS = ['www.jareddesu.com', 'jareddesu.com'];
const FIELDS = { path: 'requestPath', referer: 'refererHost', country: 'countryName', device: 'deviceType', browser: 'userAgentBrowser', os: 'userAgentOS' };
const TOP_PER_DAY = 40;
const ROWS_PER_STMT = 19;            // 5 binds a row, under D1's 100 bound parameters
const PULL_DAYS = 7;

const nowIso = () => new Date().toISOString();
const dayAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const utcToday = () => new Date().toISOString().slice(0, 10);
const int = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

export const trafficConfigured = (env) => Boolean(env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID);

function query() {
  const group = (alias, field, extra) => `${alias}: rumPageloadEventsAdaptiveGroups(filter: $f, limit: ${extra}) { count sum { visits } dimensions { date${field ? ` ${field}` : ''} } }`;
  return `query Traffic($a: string!, $f: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer { accounts(filter: { accountTag: $a }) {
    ${group('total', null, '100, orderBy: [date_ASC]')}
    ${DIMS.map((d) => group(d, FIELDS[d], '5000, orderBy: [count_DESC]')).join('\n    ')}
  } }
}`;
}

async function fetchRange(env, from, to) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query(),
      variables: {
        a: env.CF_ACCOUNT_ID,
        f: { AND: [{ datetime_geq: `${from}T00:00:00Z`, datetime_lt: `${dayAdd(to, 1)}T00:00:00Z` }, { OR: HOSTS.map((h) => ({ requestHost: h })) }] },
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || (body.errors && body.errors.length)) {
    const msg = body && body.errors && body.errors.length ? body.errors[0].message : `HTTP ${res.status}`;
    throw new HttpError(502, `Cloudflare analytics: ${msg}`);
  }
  const acct = body.data && body.data.viewer && body.data.viewer.accounts && body.data.viewer.accounts[0];
  if (!acct) throw new HttpError(502, 'Cloudflare analytics: no account data (check CF_ACCOUNT_ID and the token’s permissions)');
  return acct;
}

// Rows for D1: the daily total plus the top rows per breakdown per day
function toRows(acct) {
  const rows = [];
  (acct.total || []).forEach((g) => rows.push({ day: g.dimensions.date, dim: 'total', key: '', views: int(g.count), visits: int(g.sum && g.sum.visits) }));
  DIMS.forEach((d) => {
    const perDay = new Map();
    (acct[d] || []).forEach((g) => {
      const day = g.dimensions.date;
      const key = String(g.dimensions[FIELDS[d]] ?? '').slice(0, 300);
      const list = perDay.get(day) || [];
      list.push({ day, dim: d, key, views: int(g.count), visits: int(g.sum && g.sum.visits) });
      perDay.set(day, list);
    });
    perDay.forEach((list) => rows.push(...list.sort((a, b) => b.views - a.views).slice(0, TOP_PER_DAY)));
  });
  return rows;
}

async function saveStatus(db, status) {
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('traffic_sync', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(status), nowIso()).run();
}

export async function pullTraffic(env, db, { days = PULL_DAYS } = {}) {
  if (!trafficConfigured(env)) throw new HttpError(503, 'Traffic isn’t set up yet: add the CF_ANALYTICS_TOKEN secret (see docs/sponsor-crm-setup.md).');
  const to = utcToday();
  const from = dayAdd(to, -(days - 1));
  try {
    const rows = toRows(await fetchRange(env, from, to));
    const stmts = [db.prepare('DELETE FROM site_traffic WHERE day >= ? AND day <= ?').bind(from, to)];
    for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
      const chunk = rows.slice(i, i + ROWS_PER_STMT);
      stmts.push(db.prepare(`INSERT INTO site_traffic (day, dim, key, views, visits) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`)
        .bind(...chunk.flatMap((r) => [r.day, r.dim, r.key, r.views, r.visits])));
    }
    await db.batch(stmts);
    await saveStatus(db, { last_run: nowIso(), ok: true, from, to, rows: rows.length });
    return { ok: true, from, to, rows: rows.length };
  } catch (err) {
    await saveStatus(db, { last_run: nowIso(), ok: false, error: err.message }).catch(() => {});
    throw err;
  }
}

// Aggregated traffic for a range ending at the latest day (today in UTC),
// with the same-length period before it for comparison
export async function loadTraffic(env, db, { days = 28, to = null } = {}) {
  const n = Math.max(1, Math.min(366, Number(days) || 28));
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : utcToday();
  const from = dayAdd(end, -(n - 1));
  const prevTo = dayAdd(from, -1);
  const prevFrom = dayAdd(prevTo, -(n - 1));
  const top = (a, b) => db.prepare("SELECT dim, key, SUM(views) AS views, SUM(visits) AS visits FROM site_traffic WHERE dim != 'total' AND day >= ? AND day <= ? GROUP BY dim, key ORDER BY views DESC").bind(a, b);
  const [daily, cur, prev, first, status] = await Promise.all([
    db.prepare("SELECT day, views, visits FROM site_traffic WHERE dim = 'total' AND day >= ? AND day <= ? ORDER BY day").bind(prevFrom, end).all(),
    top(from, end).all(),
    top(prevFrom, prevTo).all(),
    db.prepare("SELECT MIN(day) AS day FROM site_traffic WHERE dim = 'total'").first(),
    getSetting(db, 'traffic_sync', null),
  ]);
  const byDim = (rows) => {
    const out = {};
    rows.forEach((r) => { (out[r.dim] = out[r.dim] || []).length < 100 && out[r.dim].push({ key: r.key, views: r.views, visits: r.visits }); });
    return out;
  };
  return {
    configured: trafficConfigured(env), status, since: first && first.day,
    from, to: end, prevFrom, prevTo,
    daily: daily.results, top: byDim(cur.results), prevTop: byDim(prev.results),
  };
}
