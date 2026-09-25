// stats.js — Phase 4 data: the channel's daily history, monthly creator
// income, and rate-raise decisions. The numbers themselves are computed in
// scripts/manage/insights.js (shared with the app); this file only stores.
//
// Channel history arrives two ways:
//   - the stats Action POSTs /api/ingest/stats daily with the private
//     analytics (daily views and subscriber changes), signed with
//     CRM_INGEST_KEY;
//   - the daily cron (and "Refresh" in the app) reads the public
//     stats.public.json for daily views and the subscriber count, so views
//     work even before the Action is set up.

import { HttpError, getSetting, updateRecord, getRecord } from './data.js';
import { isIsoDate, isUuid } from '../../../scripts/manage/schema.js';
import { RATE_RULE_IDS, INCOME_SOURCES_ENTERED } from '../../../scripts/manage/insights.js';

const nowIso = () => new Date().toISOString();
const PUBLIC_STATS = 'https://www.jareddesu.com/data/sponsorships/stats.public.json';
const MAX_DAYS = 400;
const ROWS_PER_STMT = 19;            // 5 binds a row, under D1's 100 bound parameters

const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null);

// Upsert daily rows. Views and subscriber columns update only when given,
// so the public file (views only) never wipes the Action's subscriber data.
function dailyStmts(db, rows) {
  const stmts = [];
  const now = nowIso();
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const chunk = rows.slice(i, i + ROWS_PER_STMT);
    stmts.push(db.prepare(
      `INSERT INTO channel_daily (day, views, subs_gained, subs_lost, updated_at) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')} `
      + 'ON CONFLICT (day) DO UPDATE SET views = COALESCE(excluded.views, views), subs_gained = COALESCE(excluded.subs_gained, subs_gained), '
      + 'subs_lost = COALESCE(excluded.subs_lost, subs_lost), updated_at = excluded.updated_at',
    ).bind(...chunk.flatMap((r) => [r.day, r.views, r.subs_gained, r.subs_lost, now])));
  }
  return stmts;
}

function snapshotStmt(db, snap) {
  return db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (\'channel\', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(JSON.stringify(snap), nowIso());
}

// Keep the newest snapshot; the Action's exact count wins over the public file on the same day
function newer(prev, next) {
  if (!prev || !prev.asOf) return true;
  if (next.asOf !== prev.asOf) return next.asOf > prev.asOf;
  return next.source === 'action' || prev.source !== 'action';
}

// --- From the stats Action ---------------------------------------------------------------
export async function ingestStats(db, body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be an object');
  const days = Array.isArray(body.days) ? body.days : [];
  if (!days.length || days.length > MAX_DAYS) throw new HttpError(400, `days must have 1–${MAX_DAYS} rows`);
  const rows = days.map((d) => ({
    day: d && isIsoDate(d.day) ? d.day : null,
    views: count(d && d.views), subs_gained: count(d && d.subsGained), subs_lost: count(d && d.subsLost),
  }));
  if (rows.some((r) => !r.day)) throw new HttpError(400, 'Every row needs a day (YYYY-MM-DD)');
  const snap = {
    asOf: isIsoDate(body.asOf) ? body.asOf : rows[rows.length - 1].day,
    subscribers: count(body.subscribers), subscribersExact: body.subscribersExact === true,
    totalViews: count(body.totalViews), source: 'action', receivedAt: nowIso(),
  };
  const prev = await getSetting(db, 'channel', null);
  const stmts = dailyStmts(db, rows);
  if (snap.subscribers != null && newer(prev, snap)) stmts.push(snapshotStmt(db, snap));
  await db.batch(stmts);
  return { ok: true, days: rows.length };
}

// --- From the public stats file ------------------------------------------------------------
export async function pullPublicStats(db) {
  const res = await fetch(PUBLIC_STATS, { signal: AbortSignal.timeout(15000), cf: { cacheTtl: 600 } });
  if (!res.ok) throw new HttpError(502, `Couldn’t read the public stats file (${res.status})`);
  const pub = await res.json().catch(() => null);
  const m = pub && pub.metrics;
  const series = m && m.dailyViews;
  if (!series || !Array.isArray(series.value) || !isIsoDate(series.period && series.period.start)) throw new HttpError(502, 'The public stats file has no daily views');
  const start = series.period.start;
  const rows = series.value.slice(-MAX_DAYS).map((v, i) => ({
    day: new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) + i)).toISOString().slice(0, 10),
    views: count(v), subs_gained: null, subs_lost: null,
  }));
  const subs = m.subscribers || {};
  const snap = {
    asOf: (subs.period && subs.period.end) || (pub.generatedAt || '').slice(0, 10),
    subscribers: count(subs.value), subscribersExact: subs.exact === true,
    totalViews: count(m.totalViews && m.totalViews.value),
    gained28: count(m.subscribersGained && m.subscribersGained.value),
    source: 'public', receivedAt: nowIso(),
  };
  const prev = await getSetting(db, 'channel', null);
  const stmts = dailyStmts(db, rows);
  if (snap.subscribers != null && isIsoDate(snap.asOf) && newer(prev, snap)) stmts.push(snapshotStmt(db, snap));
  else if (prev && snap.gained28 != null && prev.gained28 == null) stmts.push(snapshotStmt(db, { ...prev, gained28: snap.gained28 }));
  await db.batch(stmts);
  return { ok: true, days: rows.length };
}

// --- Everything the Insights screen needs (raw; computed in the browser) ---------------------
export async function loadInsights(db) {
  const [daily, uploads, income, weekly, settings] = await db.batch([
    db.prepare('SELECT day, views, subs_gained, subs_lost FROM channel_daily ORDER BY day DESC LIMIT 400'),
    db.prepare('SELECT youtube_id, title, published_at, views, views_30d, views_30d_on FROM uploads ORDER BY published_at DESC LIMIT 200'),
    db.prepare('SELECT * FROM income ORDER BY month, source'),
    db.prepare('SELECT id, kind, week_of, text, created_at FROM insights ORDER BY created_at DESC LIMIT 26'),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('channel', 'finance', 'scenarios', 'rateRules')"),
  ]);
  const get = (k, fallback) => {
    const r = settings.results.find((x) => x.key === k);
    try { return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
  };
  return {
    daily: daily.results.reverse(),
    channel: get('channel', null),
    uploads: uploads.results,
    income: income.results,
    insights: weekly.results,
    finance: get('finance', null),
    scenarios: get('scenarios', []),
    rateRules: get('rateRules', {}),
  };
}

// --- Monthly income (AdSense, affiliates, memberships, other) ------------------------------
export async function putIncome(db, body) {
  const month = body && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ? body.month : null;
  if (!month) throw new HttpError(400, 'month must be YYYY-MM');
  if (!INCOME_SOURCES_ENTERED.includes(body.source)) throw new HttpError(400, `source must be one of ${INCOME_SOURCES_ENTERED.join(', ')}`);
  const raw = body.amount;
  if (raw === null || raw === '') {
    await db.prepare('DELETE FROM income WHERE month = ? AND source = ?').bind(month, body.source).run();
    return { cleared: true, month, source: body.source };
  }
  const amount = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) throw new HttpError(400, 'amount must be a number of dollars');
  const notes = body.notes == null ? null : String(body.notes).trim().slice(0, 300) || null;
  const now = nowIso();
  await db.prepare('INSERT INTO income (id, month, source, amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT (month, source) DO UPDATE SET amount = excluded.amount, notes = excluded.notes, updated_at = excluded.updated_at')
    .bind(crypto.randomUUID(), month, body.source, Math.round(amount * 100) / 100, notes, now, now).run();
  return db.prepare('SELECT * FROM income WHERE month = ? AND source = ?').bind(month, body.source).first();
}

// --- Rate-raise rules: accept (writes the rate card) or dismiss -----------------------------
// A decision snoozes the rule (60 days after accepting, 30 after dismissing)

export async function decideRateRule(db, rule, accept, body = {}, today) {
  if (!RATE_RULE_IDS.includes(rule)) throw new HttpError(404, 'Unknown rule');
  const applied = [];
  if (accept) {
    const changes = Array.isArray(body.packages) ? body.packages : [];
    if (!changes.length || changes.length > 20) throw new HttpError(400, 'Pick at least one package to update');
    for (const c of changes) {
      if (!isUuid(c && c.id)) throw new HttpError(400, 'Bad package ID');
      const values = {};
      for (const k of ['standard', 'floor']) if (c[k] != null) values[k] = Number(c[k]);
      if (!Object.keys(values).length) continue;
      const before = await getRecord(db, 'rate_card', c.id);
      await updateRecord(db, 'rate_card', c.id, values);
      applied.push({ id: c.id, package: before.package, from: { standard: before.standard, floor: before.floor }, to: values });
    }
  }
  const all = await getSetting(db, 'rateRules', {});
  const history = Array.isArray(all.history) ? all.history.slice(-49) : [];
  if (applied.length) history.push({ rule, on: today, applied });
  const next = { ...all, [rule]: { status: accept ? 'accepted' : 'dismissed', on: today }, history };
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('rateRules', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(next), nowIso()).run();
  return { rule, status: next[rule].status, applied };
}

// Views at 30 days: once an upload is 30–45 days old, keep its view count then
export function snapshot30Stmt(db, now = new Date()) {
  const day = (n) => new Date(now.getTime() - n * 86400000).toISOString();
  return db.prepare('UPDATE uploads SET views_30d = views, views_30d_on = ? WHERE views_30d IS NULL AND views IS NOT NULL AND published_at <= ? AND published_at > ?')
    .bind(now.toISOString().slice(0, 10), day(30), day(45));
}
