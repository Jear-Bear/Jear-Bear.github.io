// data.js — reads and writes for the sponsor CRM. Every write is validated
// against the shared schema (scripts/manage/schema.js) and only touches the
// fields listed there. Nothing is ever deleted: records are archived.

import { ENTITIES, validate, isUuid, DEFAULT_CATEGORIES } from '../../../scripts/manage/schema.js';
import { defaultTargets, todayIn, DEFAULT_TZ } from '../../../scripts/manage/rules.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const nowIso = () => new Date().toISOString();
const TABLES = ['companies', 'contacts', 'deals', 'payments', 'videos', 'rate_card'];
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
const SETTING_VALIDATORS = { targets: validTargets, categories: validCategories };

export async function putSetting(db, key, value) {
  const check = SETTING_VALIDATORS[key];
  if (!check) throw new HttpError(404, 'Unknown setting');
  const clean = check(value);
  await putSettingStmt(db, key, clean).run();
  return clean;
}

export async function settingsFor(db) {
  const tz = DEFAULT_TZ;
  return {
    tz,
    targets: await getSetting(db, 'targets', defaultTargets(todayIn(tz))),
    categories: await getSetting(db, 'categories', DEFAULT_CATEGORIES),
  };
}

// --- Reads -----------------------------------------------------------------------
export async function loadState(db) {
  const results = await db.batch([
    ...TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)),
    db.prepare('SELECT domain, company_id FROM company_domains'),
    db.prepare('SELECT company_id, deal_id, COUNT(*) AS n, MAX(occurred_at) AS last FROM activities WHERE archived = 0 GROUP BY company_id, deal_id'),
  ]);
  const state = {};
  TABLES.forEach((t, i) => { state[STATE_KEY[t] || t] = results[i].results.map(fromRow); });
  const domains = new Map();
  results[TABLES.length].results.forEach((r) => domains.set(r.company_id, [...(domains.get(r.company_id) || []), r.domain]));
  state.companies.forEach((c) => { c.domains = (domains.get(c.id) || []).sort(); });
  state.activitySummary = results[TABLES.length + 1].results;
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

async function checkRefs(db, entityName, values, pending = null) {
  const fields = ENTITIES[entityName].fields;
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== 'ref' || values[key] == null) continue;
    const table = ENTITIES[field.entity].table;
    if (pending && pending.has(`${table}:${values[key]}`)) continue;
    if (!(await exists(db, table, values[key]))) throw new HttpError(400, `${field.label} doesn't exist`);
  }
}

async function domainStmts(db, companyId, domains, { replace }) {
  const stmts = [];
  if (replace) stmts.push(db.prepare('DELETE FROM company_domains WHERE company_id = ?').bind(companyId));
  for (const d of domains) {
    const owner = await db.prepare('SELECT company_id FROM company_domains WHERE domain = ?').bind(d).first();
    if (owner && owner.company_id !== companyId) throw new HttpError(409, `${d} already belongs to another company`);
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

async function createStmts(db, entityName, input, pending = null) {
  const v = validate(entityName, input);
  if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
  const id = input.id ? String(input.id).toLowerCase() : crypto.randomUUID();
  const table = ENTITIES[entityName].table;
  if (input.id && (await exists(db, table, id))) throw new HttpError(409, 'That ID is already used');
  await checkRefs(db, entityName, v.values, pending);
  const values = derive(entityName, v.values);
  const stmts = [insertStmt(db, entityName, id, values)];
  if (entityName === 'companies' && values.domains && values.domains.length) {
    stmts.push(...(await domainStmts(db, id, values.domains, { replace: false })));
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
  await checkRefs(db, entityName, v.values);
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
    stmts.push(...(await domainStmts(db, id, values.domains, { replace: true })));
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
  const pending = new Set();
  IMPORT_ORDER.forEach(([k, entity]) => (body[k] || []).forEach((r) => {
    if (r && isUuid(r.id)) pending.add(`${ENTITIES[entity].table}:${String(r.id).toLowerCase()}`);
  }));
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
          if (!isUuid(replaceId) || !(await exists(db, 'rate_card', replaceId))) throw new HttpError(400, 'Unknown package to replace');
          const v = validate('rate_card', rest, { partial: true });
          if (!v.ok) throw new HttpError(400, 'Some fields need fixing', v.errors);
          const cols = Object.keys(v.values);
          stmts.push(db.prepare(`UPDATE rate_card SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .bind(...cols.map((c) => v.values[c]), nowIso(), replaceId));
        } else {
          const r = await createStmts(db, entity, list[i], pending);
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
  const acts = await db.prepare('SELECT * FROM activities ORDER BY occurred_at').all();
  delete state.activitySummary;
  return { exportedAt: nowIso(), ...state, activities: acts.results.map(fromRow) };
}
