// data.js — reads and writes for the sponsor CRM. Every write is validated
// against the shared schema (scripts/manage/schema.js) and only touches the
// fields listed there. Nothing is ever deleted: records are archived.

import { ENTITIES, validate, isUuid, DEFAULT_CATEGORIES } from '../../../scripts/manage/schema.js';
import { defaultTargets, todayIn, DEFAULT_TZ } from '../../../scripts/manage/rules.js';
import { DEFAULT_CAPACITY, DEFAULT_JOB_HOURS } from '../../../scripts/manage/calendar.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const nowIso = () => new Date().toISOString();
const TABLES = ['companies', 'contacts', 'deals', 'payments', 'videos', 'rate_card', 'links'];
const STATE_KEY = { rate_card: 'rateCard' };

function fromRow(r) {
  if (!r) return r;
  const o = { ...r };
  if ('archived' in o) o.archived = o.archived === 1;
  return o;
}

// --- Settings --------------------------------------------------------------------
export async function getSetting(db, key, fallback) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
function putSettingStmt(db, key, value) {
  return db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) '
    + 'ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), nowIso());
}

function validTargets(t) {
  const ok = t && typeof t === 'object' && Number.isInteger(t.weeklyPitches) && t.weeklyPitches >= 0 && t.weeklyPitches <= 100
    && Array.isArray(t.months) && t.months.length <= 36
    && t.months.every((m) => m && /^\d{4}-\d{2}$/.test(m.month)
      && ['pitches', 'deals', 'revenue'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1e7));
  if (!ok) throw new HttpError(400, 'Targets are not in the expected shape');
  return {
    weeklyPitches: t.weeklyPitches,
    months: t.months.map((m) => ({ month: m.month, pitches: m.pitches, deals: m.deals, revenue: m.revenue })),
  };
}
function validCategories(list) {
  if (!Array.isArray(list) || list.length > 50 || !list.every((c) => typeof c === 'string' && c.trim() && c.length <= 60)) {
    throw new HttpError(400, 'Categories must be a list of short names');
  }
  return [...new Set(list.map((c) => c.trim()))];
}
function validCapacity(c) {
  if (!c || typeof c !== 'object' || ![c.min, c.max].every((n) => typeof n === 'number' && n >= 0 && n <= 80) || c.min > c.max) {
    throw new HttpError(400, 'Capacity needs a min and max in hours');
  }
  return { min: c.min, max: c.max };
}
function validJobHours(j) {
  const t = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!j || !Array.isArray(j.days) || !j.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !t.test(j.start) || !t.test(j.end) || j.end <= j.start) {
    throw new HttpError(400, 'Job hours need days (0 = Sunday) and HH:MM start and end');
  }
  return { days: [...new Set(j.days)].sort(), start: j.start, end: j.end };
}
// Private numbers for the full-time tracker (dollars a month, except savings)
function validFinance(f) {
  if (!f || typeof f !== 'object') throw new HttpError(400, 'Finance must be an object');
  const money = (k) => {
    const v = f[k];
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e8) throw new HttpError(400, `${k} must be a dollar amount`);
    return Math.round(n * 100) / 100;
  };
  const tax = f.taxPct == null || f.taxPct === '' ? 28 : Number(f.taxPct);
  if (!Number.isFinite(tax) || tax < 0 || tax > 60) throw new HttpError(400, 'Tax set-aside must be 0–60%');
  return {
    takeHome: money('takeHome'), expenses: money('expenses'), savings: money('savings'), taxPct: tax,
    healthMonthly: money('healthMonthly'), healthPriced: f.healthPriced === true,
    healthNote: f.healthNote == null ? null : String(f.healthNote).trim().slice(0, 200) || null,
  };
}
// Your details for invoices (private: only in D1)
function validInvoicing(v) {
  if (!v || typeof v !== 'object') throw new HttpError(400, 'Invoicing must be an object');
  const t = (x, n) => (x == null ? null : String(x).replace(/\u0000/g, '').trim().slice(0, n) || null);
  const prefix = t(v.prefix, 10) || 'INV-';
  if (!/^[A-Za-z0-9-]{1,10}$/.test(prefix)) throw new HttpError(400, 'The prefix can use letters, numbers and dashes');
  const terms = v.termsDays == null || v.termsDays === '' ? 30 : Number(v.termsDays);
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) throw new HttpError(400, 'Payment terms must be 0–120 days');
  const startAt = v.startAt == null || v.startAt === '' ? 1 : Number(v.startAt);
  if (!Number.isInteger(startAt) || startAt < 1 || startAt > 99999) throw new HttpError(400, 'The first number must be 1–99999');
  return { name: t(v.name, 120), email: t(v.email, 254), address: t(v.address, 400), payment: t(v.payment, 600), termsDays: terms, prefix, startAt };
}
// Brands and kinds of offers to skip (one short line each)
function validAvoid(list) {
  if (!Array.isArray(list) || list.length > 40 || !list.every((x) => typeof x === 'string' && x.trim() && x.length <= 120)) {
    throw new HttpError(400, 'The avoid list is up to 40 short lines');
  }
  return list.map((x) => x.trim());
}
// Your pitch templates ({{placeholders}} are filled per deal)
function validTemplates(list) {
  if (!Array.isArray(list) || !list.length || list.length > 12) throw new HttpError(400, 'Keep 1–12 templates');
  const ids = new Set();
  return list.map((t, i) => {
    const name = t && typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '';
    const subject = t && typeof t.subject === 'string' ? t.subject.trim().slice(0, 200) : '';
    const body = t && typeof t.body === 'string' ? t.body.replace(/\u0000/g, '').slice(0, 5000) : '';
    if (!name || !body.trim()) throw new HttpError(400, `Template ${i + 1} needs a name and a body`);
    let id = t.id && /^[a-z0-9-]{1,40}$/.test(t.id) ? t.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `t${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`.slice(0, 40);
    ids.add(id);
    return { id, name, subject, body };
  });
}
// The plan's scenarios: named monthly totals, drawn against actual income
function validScenarios(list) {
  if (!Array.isArray(list) || list.length > 5) throw new HttpError(400, 'Scenarios must be a list of up to 5');
  return list.map((sc) => {
    const name = sc && typeof sc.name === 'string' ? sc.name.trim().slice(0, 40) : '';
    const points = Array.isArray(sc && sc.points) ? sc.points : [];
    if (!name || !points.length || points.length > 36) throw new HttpError(400, 'Each scenario needs a name and 1–36 monthly points');
    const clean = points.map((p) => {
      if (!p || !/^\d{4}-\d{2}$/.test(p.month) || typeof p.total !== 'number' || !Number.isFinite(p.total) || p.total < 0 || p.total > 1e7) {
        throw new HttpError(400, 'Scenario points need a month (YYYY-MM) and a total');
      }
      return { month: p.month, total: Math.round(p.total) };
    }).sort((a, b) => a.month.localeCompare(b.month));
    const note = sc.note == null ? null : String(sc.note).trim().slice(0, 200) || null;
    return { name, points: clean, note };
  });
}
export { validScenarios };
const SETTING_VALIDATORS = {
  targets: validTargets, categories: validCategories, capacity: validCapacity, jobHours: validJobHours,
  finance: validFinance, scenarios: validScenarios, invoicing: validInvoicing,
  avoid: validAvoid, pitchTemplates: validTemplates,
};

export async function putSetting(db, key, value) {
  const check = SETTING_VALIDATORS[key];
  if (!check) throw new HttpError(404, 'Unknown setting');
  const clean = check(value);
  await putSettingStmt(db, key, clean).run();
  return clean;
}

export async function settingsFor(db) {
  const tz = DEFAULT_TZ;
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const get = (key, fallback) => {
    const r = rows.results.find((x) => x.key === key);
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch { return fallback; }
  };
  return {
    tz,
    targets: get('targets', defaultTargets(todayIn(tz))),
    categories: get('categories', DEFAULT_CATEGORIES),
    capacity: get('capacity', DEFAULT_CAPACITY),
    jobHours: get('jobHours', DEFAULT_JOB_HOURS),
    invoicing: get('invoicing', null),
    avoid: get('avoid', null),
    pitchTemplates: get('pitchTemplates', null),
  };
}

// --- Reads -----------------------------------------------------------------------
export async function loadState(db) {
  const results = await db.batch([
    ...TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)),
    db.prepare('SELECT domain, company_id FROM company_domains'),
    db.prepare('SELECT company_id, deal_id, COUNT(*) AS n, MAX(occurred_at) AS last FROM activities WHERE archived = 0 GROUP BY company_id, deal_id'),
    db.prepare("SELECT slug, day, clicks FROM link_clicks WHERE day >= date('now', '-400 days') ORDER BY day"),
  ]);
  const state = {};
  TABLES.forEach((t, i) => { state[STATE_KEY[t] || t] = results[i].results.map(fromRow); });
  const domains = new Map();
  results[TABLES.length].results.forEach((r) => domains.set(r.company_id, [...(domains.get(r.company_id) || []), r.domain]));
  state.companies.forEach((c) => { c.domains = (domains.get(c.id) || []).sort(); });
  state.activitySummary = results[TABLES.length + 1].results;
  state.linkClicks = results[TABLES.length + 2].results;
  state.settings = await settingsFor(db);
  return state;
}

export async function listActivities(db, { company_id: companyId, deal_id: dealId }) {
  if (companyId && !isUuid(companyId)) throw new HttpError(400, 'Bad company ID');
  if (dealId && !isUuid(dealId)) throw new HttpError(400, 'Bad deal ID');
  if (!companyId && !dealId) throw new HttpError(400, 'Pass company_id or deal_id');
  const where = companyId && dealId ? 'company_id = ? AND deal_id = ?' : companyId ? 'company_id = ?' : 'deal_id = ?';
  const binds = [companyId, dealId].filter(Boolean);
  const r = await db.prepare(`SELECT * FROM activities WHERE ${where} AND archived = 0 ORDER BY occurred_at DESC LIMIT 300`).bind(...binds).all();
  return r.results.map(fromRow);
}

// --- Writes ----------------------------------------------------------------------
async function exists(db, table, id) {
  return Boolean(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first());
}

// Existence checks either query D1 (single writes) or use a snapshot loaded
// in one batch (bulk imports). On the free plan every D1 call counts toward
// the 50-subrequests-per-request limit, so imports must not query per row.
function liveLookup(db) {
  return {
    has: (table, id) => exists(db, table, id),
    domainOwner: async (d) => {
      const r = await db.prepare('SELECT company_id FROM company_domains WHERE domain = ?').bind(d).first();
      return r ? r.company_id : null;
    },
    add() {},
    claimDomain() {},
  };
}

export async function snapshotLookup(db) {
  const tables = ['companies', 'contacts', 'videos', 'deals', 'payments', 'rate_card'];
  const res = await db.batch([...tables.map((t) => db.prepare(`SELECT id FROM ${t}`)), db.prepare('SELECT domain, company_id FROM company_domains')]);
  const ids = new Map(tables.map((t, i) => [t, new Set(res[i].results.map((r) => r.id))]));
  const domains = new Map(res[tables.length].results.map((r) => [r.domain, r.company_id]));
  return {
    has: async (table, id) => ids.get(table).has(id),
    domainOwner: async (d) => domains.get(d) || null,
    add: (table, id) => ids.get(table).add(id),
    claimDomain: (d, companyId) => domains.set(d, companyId),
  };
}

async function checkRefs(entityName, values, lookup) {
  const fields = ENTITIES[entityName].fields;
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== 'ref' || values[key] == null) continue;
    if (!(await lookup.has(ENTITIES[field.entity].table, values[key]))) throw new HttpError(400, `${field.label} doesn't exist`);
  }
}

async function domainStmts(db, companyId, domains, { replace, lookup }) {
  const stmts = [];
  if (replace) stmts.push(db.prepare('DELETE FROM company_domains WHERE company_id = ?').bind(companyId));
  for (const d of domains) {
    const owner = await lookup.domainOwner(d);
    if (owner && owner !== companyId) throw new HttpError(409, `${d} already belongs to another company`);
    lookup.claimDomain(d, companyId);
    stmts.push(db.prepare('INSERT OR IGNORE INTO company_domains (domain, company_id) VALUES (?, ?)').bind(d, companyId));
  }
  return stmts;
}

function activityStmt(db, a) {
  return db.prepare('INSERT INTO activities (id, company_id, deal_id, kind, occurred_at, title, body, source, created_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), a.company_id || null, a.deal_id || null, a.kind, a.occurred_at || nowIso(),
      a.title || null, a.body || null, a.source || 'system', nowIso());
}

function insertStmt(db, entityName, id, values) {
  const cols = Object.keys(values).filter((k) => !ENTITIES[entityName].fields[k].virtual);
  const table = ENTITIES[entityName].table;
  const ts = nowIso();
  const extra = entityName === 'activities' ? ['source', 'created_at'] : ['created_at', 'updated_at'];
  const extraVals = entityName === 'activities' ? ['me', ts] : [ts, ts];
  const all = ['id', ...cols, ...extra];
  return db.prepare(`INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})`)
    .bind(id, ...cols.map((c) => values[c]), ...extraVals);
}

// Fill derived values before saving
function derive(entityName, values, before = {}) {
  if (entityName === 'payments') {
    const amount = values.amount ?? before.amount;
    const fees = values.fees !== undefined ? values.fees : before.fees;
    const netGiven = values.net !== undefined ? values.net : null;
    if (netGiven == null && amount != null && ('amount' in values || 'fees' in values || !before.id)) {
      values.net = Math.round((amount - (fees || 0)) * 100) / 100;
    }
  }
  if (entityName === 'activities' && !values.occurred_at && !before.id) values.occurred_at = nowIso();
  return values;
}

// Short names for tracked links and invoice numbers must be unique
async function checkUnique(db, entityName, values, id) {
  const checks = { links: ['slug'], payments: ['invoice_no'] }[entityName] || [];
  for (const col of checks) {
    if (values[col] == null) continue;
    const r = await db.prepare(`SELECT id FROM ${ENTITIES[entityName].table} WHERE ${col} = ? AND id != ?`).bind(values[col], id || '').first();
    if (r) throw new HttpError(409, `${ENTITIES[entityName].fields[col].label} “${values[col]}” is already used`);
  }
}

export async function createStmts(db, entityName, input, lookup = liveLookup(db)) {
  const v = validate(entityName, input);
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const id = input.id ? String(input.id).toLowerCase() : crypto.randomUUID();
  const table = ENTITIES[entityName].table;
  if (input.id && (await lookup.has(table, id))) throw new HttpError(409, 'That ID is already used');
  await checkRefs(entityName, v.values, lookup);
  await checkUnique(db, entityName, v.values, null);
  const values = derive(entityName, v.values);
  const stmts = [insertStmt(db, entityName, id, values)];
  lookup.add(table, id);
  if (entityName === 'companies' && values.domains && values.domains.length) {
    stmts.push(...(await domainStmts(db, id, values.domains, { replace: false, lookup })));
  }
  if (entityName === 'deals') {
    stmts.push(activityStmt(db, { company_id: values.company_id, deal_id: id, kind: 'system', title: `Deal created · ${values.stage}` }));
  }
  return { id, stmts };
}

export async function createRecord(db, entityName, input) {
  const { id, stmts } = await createStmts(db, entityName, input);
  await db.batch(stmts);
  return getRecord(db, entityName, id);
}

export async function getRecord(db, entityName, id) {
  const table = ENTITIES[entityName].table;
  const r = fromRow(await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first());
  if (!r) throw new HttpError(404, 'Not found');
  if (entityName === 'companies') {
    const d = await db.prepare('SELECT domain FROM company_domains WHERE company_id = ? ORDER BY domain').bind(id).all();
    r.domains = d.results.map((x) => x.domain);
  }
  return r;
}

export async function updateRecord(db, entityName, id, input) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const before = await getRecord(db, entityName, id);
  const v = validate(entityName, input, { partial: true });
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  await checkRefs(entityName, v.values, liveLookup(db));
  await checkUnique(db, entityName, v.values, id);
  const values = derive(entityName, v.values, before);
  const table = ENTITIES[entityName].table;
  const cols = Object.keys(values).filter((k) => !ENTITIES[entityName].fields[k].virtual);
  const stmts = [];
  if (cols.length) {
    const stamp = entityName === 'activities' ? '' : ', updated_at = ?';
    const binds = [...cols.map((c) => values[c]), ...(stamp ? [nowIso()] : []), id];
    stmts.push(db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${stamp} WHERE id = ?`).bind(...binds));
  }
  if (entityName === 'companies' && values.domains) {
    stmts.push(...(await domainStmts(db, id, values.domains, { replace: true, lookup: liveLookup(db) })));
  }
  if (entityName === 'deals' && values.stage && values.stage !== before.stage) {
    stmts.push(activityStmt(db, {
      company_id: values.company_id || before.company_id, deal_id: id, kind: 'system', title: `Stage: ${before.stage} → ${values.stage}`,
    }));
  }
  if (stmts.length) await db.batch(stmts);
  return getRecord(db, entityName, id);
}

export async function setArchived(db, entityName, id, archived) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  if (typeof archived !== 'boolean') throw new HttpError(400, 'archived must be true or false');
  await getRecord(db, entityName, id);
  const table = ENTITIES[entityName].table;
  const stamp = entityName === 'activities' ? '' : ', updated_at = ?';
  await db.prepare(`UPDATE ${table} SET archived = ?${stamp} WHERE id = ?`)
    .bind(archived ? 1 : 0, ...(stamp ? [nowIso()] : []), id).run();
  return getRecord(db, entityName, id);
}

// --- Import ------------------------------------------------------------------------
// The browser parses the spreadsheet and sends fully-formed records with
// client-made IDs (so deals can point at companies created in the same
// import). Everything is validated first, then written in one batch.
const IMPORT_ORDER = [['companies', 'companies'], ['contacts', 'contacts'], ['videos', 'videos'], ['deals', 'deals'], ['payments', 'payments'], ['rateCard', 'rate_card']];
const MAX_IMPORT_ROWS = 2000;

export async function importAll(db, body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected an object');
  const total = IMPORT_ORDER.reduce((s, [k]) => s + (Array.isArray(body[k]) ? body[k].length : 0), 0);
  if (total > MAX_IMPORT_ROWS) throw new HttpError(413, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  const lookup = await snapshotLookup(db);
  const stmts = [];
  const counts = {};
  const errors = [];
  for (const [key, entity] of IMPORT_ORDER) {
    const list = body[key];
    if (list == null) continue;
    if (!Array.isArray(list)) throw new HttpError(400, `${key} must be a list`);
    counts[key] = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        if (entity === 'rate_card' && list[i] && list[i].replaceId) {
          const { replaceId, ...rest } = list[i];
          if (!isUuid(replaceId) || !(await lookup.has('rate_card', replaceId))) throw new HttpError(400, 'Unknown package to replace');
          const v = validate('rate_card', rest, { partial: true });
          if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
          const cols = Object.keys(v.values);
          stmts.push(db.prepare(`UPDATE rate_card SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .bind(...cols.map((c) => v.values[c]), nowIso(), replaceId));
        } else {
          const r = await createStmts(db, entity, list[i], lookup);
          stmts.push(...r.stmts);
        }
        counts[key] += 1;
      } catch (err) {
        errors.push({ sheet: key, row: i + 1, message: err.message, details: err.details });
      }
    }
  }
  if (body.targets) {
    try { stmts.push(putSettingStmt(db, 'targets', validTargets(body.targets))); counts.targets = 1; } catch (err) { errors.push({ sheet: 'targets', message: err.message }); }
  }
  if (body.categories) {
    try { stmts.push(putSettingStmt(db, 'categories', validCategories(body.categories))); counts.categories = 1; } catch (err) { errors.push({ sheet: 'categories', message: err.message }); }
  }
  if (errors.length) throw new HttpError(400, 'Nothing was imported: fix these rows first', errors);
  if (stmts.length) await db.batch(stmts);
  return { imported: counts };
}

// --- Export -------------------------------------------------------------------------
export async function exportAll(db) {
  const state = await loadState(db);
  const [acts, series, items, income, finance] = await db.batch([
    db.prepare('SELECT * FROM activities ORDER BY occurred_at'),
    db.prepare('SELECT * FROM cal_series ORDER BY dtstart'),
    db.prepare('SELECT * FROM cal_items ORDER BY start'),
    db.prepare('SELECT month, source, amount, notes FROM income ORDER BY month, source'),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('finance', 'scenarios', 'rateRules')"),
  ]);
  delete state.activitySummary;
  const extra = Object.fromEntries(finance.results.map((r) => { try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, null]; } }));
  return {
    exportedAt: nowIso(), ...state, activities: acts.results.map(fromRow), calendarSeries: series.results, calendarItems: items.results,
    income: income.results, finance: extra.finance || null, scenarios: extra.scenarios || [], rateRules: extra.rateRules || {},
  };
}
