// calendar.js (Worker) — calendar items, recurring series and their
// per-occurrence exceptions. Plan items can be moved, completed or hidden,
// never deleted.

import { validate, isUuid, isIsoDate } from '../../../scripts/manage/schema.js';
import { occurrence } from '../../../scripts/manage/calendar.js';
import { HttpError, createStmts, snapshotLookup, getSetting, validScenarios } from './data.js';

const nowIso = () => new Date().toISOString();
const BOOLS = ['all_day', 'counts_hours', 'hidden'];
const LINKS = { company_id: 'companies', deal_id: 'deals', video_id: 'videos' };

function fromRow(r) {
  if (!r) return r;
  const o = { ...r };
  BOOLS.forEach((k) => { if (k in o) o[k] = o[k] === 1; });
  if ('checklist' in o) { try { o.checklist = o.checklist ? JSON.parse(o.checklist) : []; } catch { o.checklist = []; } }
  return o;
}
function toDb(values) {
  const v = { ...values };
  BOOLS.forEach((k) => { if (k in v && v[k] !== null) v[k] = v[k] ? 1 : 0; });
  if ('checklist' in v && v.checklist !== null) v.checklist = JSON.stringify(v.checklist);
  return v;
}

async function checkLinks(db, values, lookup = null) {
  for (const [k, table] of Object.entries(LINKS)) {
    if (values[k] == null) continue;
    const ok = lookup ? await lookup.has(table, values[k]) : await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(values[k]).first();
    if (!ok) throw new HttpError(400, `Linked ${k.replace('_id', '')} doesn't exist`);
  }
}

// all_day follows the shape of start; end can't come before start
function normalizeTimes(v, before = {}) {
  const start = v.start ?? before.start;
  if (v.start !== undefined) v.all_day = start.length === 10;
  const end = v.end !== undefined ? v.end : before.end;
  if (start && end && end < start) throw new HttpError(400, 'End is before start', { end: 'End is before start' });
  if (start && end && (start.length === 10) !== (end.length === 10)) throw new HttpError(400, 'Start and end must both be dates or both have times', { end: 'Match the start (all-day or timed)' });
  return v;
}

function defaultsFor(v) {
  return {
    status: 'not_started',
    counts_hours: v.type === 'event' && v.kind !== 'publishing',
    checklist: [],
    hidden: false,
  };
}

function insert(db, table, row) {
  const cols = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c]));
}
function update(db, table, id, row) {
  const cols = Object.keys(row);
  return db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((c) => row[c]), nowIso(), id);
}

export async function getItem(db, id) {
  const r = fromRow(await db.prepare('SELECT * FROM cal_items WHERE id = ?').bind(id).first());
  if (!r) throw new HttpError(404, 'Not found');
  return r;
}
export async function getSeries(db, id) {
  const r = fromRow(await db.prepare('SELECT * FROM cal_series WHERE id = ?').bind(id).first());
  if (!r) throw new HttpError(404, 'Not found');
  return r;
}

// --- Reads -------------------------------------------------------------------------------
export async function loadCalendar(db, from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new HttpError(400, 'Pass from and to as YYYY-MM-DD');
  const [items, series] = await db.batch([
    // one-off items overlapping the range, plus every exception (few)
    db.prepare("SELECT * FROM cal_items WHERE series_id IS NOT NULL OR (start <= ? AND COALESCE(end, start) >= ?)").bind(`${to}T99`, from),
    db.prepare('SELECT * FROM cal_series'),
  ]);
  return { from, to, items: items.results.map(fromRow), series: series.results.map(fromRow) };
}

// --- Items ---------------------------------------------------------------------------------
async function itemRow(db, input, { source = 'me', suggested = false, reason = null, planKey = null, id = null, lookup = null } = {}) {
  const v = validate('cal_items', input);
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const values = normalizeTimes({ ...defaultsFor(v.values), ...v.values });
  await checkLinks(db, values, lookup);
  const ts = nowIso();
  return toDb({ id: id || crypto.randomUUID(), ...values, source, suggested: suggested ? 1 : 0, suggestion_reason: reason, plan_key: planKey, created_at: ts, updated_at: ts });
}

export async function createItem(db, input, opts = {}) {
  const row = await itemRow(db, input, opts);
  await insert(db, 'cal_items', row).run();
  return getItem(db, row.id);
}

export async function updateItem(db, id, input) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const before = await getItem(db, id);
  const v = validate('cal_items', input, { partial: true });
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const values = normalizeTimes(v.values, before);
  await checkLinks(db, values);
  if (Object.keys(values).length) await update(db, 'cal_items', id, toDb(values)).run();
  return getItem(db, id);
}

export async function deleteItem(db, id) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const it = await getItem(db, id);
  if (it.source === 'plan' && !it.series_id) throw new HttpError(409, 'Plan items can’t be deleted. Hide it instead.');
  await db.prepare('DELETE FROM cal_items WHERE id = ?').bind(id).run();
  return { deleted: id, item: it };
}

// Claude suggestions: accept keeps the item as is; dismiss hides it
export async function decideSuggestion(db, id, accept) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const it = await getItem(db, id);
  if (it.suggested !== 1) throw new HttpError(409, 'That item isn’t a pending suggestion');
  await db.prepare('UPDATE cal_items SET suggested = ?, hidden = ?, updated_at = ? WHERE id = ?')
    .bind(accept ? 0 : 2, accept ? 0 : 1, nowIso(), id).run();
  return getItem(db, id);
}

// --- Series ----------------------------------------------------------------------------------
function seriesDefaults(v) {
  return {
    interval: 1, status: 'active', checklist: [], hidden: false,
    counts_hours: v.type === 'event' && v.kind !== 'publishing',
    byday: null, until: null, start_time: null, duration_min: null,
  };
}
function checkSeries(v) {
  if (v.start_time && !v.duration_min) v.duration_min = 60;
  if (v.until && v.dtstart && v.until < v.dtstart) throw new HttpError(400, 'Until is before the start', { until: 'Until is before the start' });
  return v;
}

async function seriesRow(db, input, { source = 'me', planKey = null, id = null, lookup = null } = {}) {
  const v = validate('cal_series', input);
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const values = checkSeries({ ...seriesDefaults(v.values), ...v.values });
  await checkLinks(db, values, lookup);
  const ts = nowIso();
  return toDb({ id: id || crypto.randomUUID(), ...values, source, plan_key: planKey, created_at: ts, updated_at: ts });
}

export async function createSeries(db, input, opts = {}) {
  const row = await seriesRow(db, input, opts);
  await insert(db, 'cal_series', row).run();
  return getSeries(db, row.id);
}

export async function updateSeries(db, id, input) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const before = await getSeries(db, id);
  const v = validate('cal_series', input, { partial: true });
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const values = checkSeries({ ...v.values, dtstart: v.values.dtstart ?? before.dtstart, until: v.values.until !== undefined ? v.values.until : before.until });
  if (values.start_time && !v.values.duration_min && before.duration_min) delete values.duration_min;
  await checkLinks(db, values);
  await update(db, 'cal_series', id, toDb(values)).run();
  return getSeries(db, id);
}

export async function deleteSeries(db, id) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const s = await getSeries(db, id);
  if (s.source === 'plan') throw new HttpError(409, 'Plan series can’t be deleted. Cancel or hide it instead.');
  await db.batch([
    db.prepare('DELETE FROM cal_items WHERE series_id = ?').bind(id),
    db.prepare('DELETE FROM cal_series WHERE id = ?').bind(id),
  ]);
  return { deleted: id };
}

// Change one occurrence: creates (or updates) the exception for that date
export async function editOccurrence(db, seriesId, date, input) {
  if (!isUuid(seriesId) || !isIsoDate(date)) throw new HttpError(400, 'Bad series or date');
  const s = await getSeries(db, seriesId);
  const v = validate('cal_items', input, { partial: true });
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const existing = fromRow(await db.prepare('SELECT * FROM cal_items WHERE series_id = ? AND original_date = ?').bind(seriesId, date).first());
  if (existing) {
    const values = normalizeTimes(v.values, existing);
    await checkLinks(db, values);
    if (Object.keys(values).length) await update(db, 'cal_items', existing.id, toDb(values)).run();
    return { item: await getItem(db, existing.id), created: false };
  }
  const base = occurrence(s, date);
  const values = normalizeTimes({ ...v.values }, base);
  await checkLinks(db, values);
  const ts = nowIso();
  const row = toDb({
    id: crypto.randomUUID(), series_id: seriesId, original_date: date,
    type: base.type, kind: base.kind, title: base.title, notes: base.notes, start: base.start, end: base.end,
    all_day: base.all_day, status: 'not_started', source: s.source, counts_hours: base.counts_hours,
    company_id: base.company_id, deal_id: base.deal_id, video_id: base.video_id, checklist: base.checklist, hidden: false,
    ...values, created_at: ts, updated_at: ts,
  });
  await insert(db, 'cal_items', row).run();
  return { item: await getItem(db, row.id), created: true };
}

// --- Plan import ------------------------------------------------------------------------------
// The plan file (kept out of the repo) carries stable IDs and plan_keys, so
// importing twice adds only what's missing and never overwrites your edits.
// Everything is checked against one snapshot and written in one batch: on
// the free plan each D1 call counts toward 50 subrequests per request.
export async function importPlan(db, body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected an object');
  const total = ['videos', 'series', 'items'].reduce((s, k) => s + ((body[k] || []).length || 0), 0);
  if (total > 1000) throw new HttpError(413, 'Plan file too large');
  const [lookup, keys] = await Promise.all([
    snapshotLookup(db),
    db.batch([db.prepare('SELECT plan_key FROM cal_series WHERE plan_key IS NOT NULL'), db.prepare('SELECT plan_key FROM cal_items WHERE plan_key IS NOT NULL')]),
  ]);
  const seriesKeys = new Set(keys[0].results.map((r) => r.plan_key));
  const itemKeys = new Set(keys[1].results.map((r) => r.plan_key));
  const counts = { videos: 0, series: 0, items: 0, skipped: 0 };
  const stmts = [];
  const errors = [];
  const attempt = async (label, fn) => { try { await fn(); } catch (err) { errors.push(`${label}: ${err.message}${err.details ? ` (${Object.values(err.details).join('; ')})` : ''}`); } };

  for (const v of body.videos || []) {
    await attempt(`Video "${v && v.title}"`, async () => {
      if (!isUuid(v.id)) throw new HttpError(400, 'needs an ID');
      if (await lookup.has('videos', v.id)) { counts.skipped += 1; return; }
      stmts.push(...(await createStmts(db, 'videos', v, lookup)).stmts);
      counts.videos += 1;
    });
  }
  const key = (x) => (x && typeof x.plan_key === 'string' && x.plan_key.length <= 80 ? x.plan_key : null);
  for (const s of body.series || []) {
    await attempt(`Series "${s && s.title}"`, async () => {
      const { plan_key: k, id, ...rest } = s;
      if (!key(s)) throw new HttpError(400, 'needs a plan_key');
      if (seriesKeys.has(k)) { counts.skipped += 1; return; }
      seriesKeys.add(k);
      stmts.push(insert(db, 'cal_series', await seriesRow(db, rest, { source: 'plan', planKey: k, id: isUuid(id) ? id : null, lookup })));
      counts.series += 1;
    });
  }
  for (const it of body.items || []) {
    await attempt(`Item "${it && it.title}"`, async () => {
      const { plan_key: k, id, ...rest } = it;
      if (!key(it)) throw new HttpError(400, 'needs a plan_key');
      if (itemKeys.has(k)) { counts.skipped += 1; return; }
      itemKeys.add(k);
      stmts.push(insert(db, 'cal_items', await itemRow(db, rest, { source: 'plan', planKey: k, id: isUuid(id) ? id : null, lookup })));
      counts.items += 1;
    });
  }
  // The plan's income scenarios, for the full-time tracker (only if none are saved yet)
  if (Array.isArray(body.scenarios) && body.scenarios.length) {
    await attempt('Scenarios', async () => {
      const clean = validScenarios(body.scenarios);
      if ((await getSetting(db, 'scenarios', [])).length) { counts.skipped += 1; return; }
      stmts.push(db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('scenarios', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(JSON.stringify(clean), new Date().toISOString()));
      counts.scenarios = clean.length;
    });
  }
  if (errors.length) throw new HttpError(400, 'Nothing was imported: fix these first', errors);
  if (stmts.length) await db.batch(stmts);
  return counts;
}
