// io.js — import the old spreadsheet tracker (.xlsx or .csv) and export
// everything as .xlsx, CSV or JSON. Files are parsed and built in the
// browser with SheetJS (vendored, Apache-2.0); only the resulting records
// are sent to the Worker, where they're validated again.

import { h, fmtMoney, download } from './dom.js';
import { api } from './api.js';
import { validate, normalizeDomain, STAGES, SOURCES, FITS, isIsoDate } from './schema.js';
import { followUp, isOverdue, priceCheck, todayIn } from './rules.js';
import { store, reload, live } from './store.js';
import { openPanel, closePanel, toast, toastError, button, busy } from './ui.js';

let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/sheetjs/xlsx.mini.min.js', import.meta.url).href;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { xlsxPromise = null; reject(new Error('Couldn’t load the spreadsheet reader')); };
      document.head.append(s);
    });
  }
  return xlsxPromise;
}

// --- Parsing helpers -----------------------------------------------------------------------
const norm = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
const str = (v) => (v == null ? '' : String(v).trim());
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com']);

function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && isIsoDate(s.slice(0, 10))) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function toMoney(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
const pick = (list, v) => list.find((x) => x.toLowerCase() === str(v).toLowerCase()) || null;

// Column aliases per sheet kind: normalized header -> field
const FIELDS = {
  pipeline: {
    company: ['brand', 'company', 'companyname', 'sponsor'], category: ['category'], contact_name: ['contactname', 'contact'],
    contact_email: ['contactemail', 'email'], source: ['source'], package: ['package'], slot: ['videoslot', 'video', 'slot'],
    pitched_on: ['pitchedon', 'pitched'], replied_on: ['repliedon', 'replied'], stage: ['stage', 'status'],
    quoted: ['quoted', 'quote'], final: ['final', 'finalprice'], publish_date: ['publishdate', 'publish'],
    invoiced_on: ['invoicedon', 'invoiced'], paid_on: ['paidon', 'paid'], next_action: ['nextaction'],
    next_action_date: ['nextactiondate'], lost_reason: ['lostreason'], notes: ['notes'],
  },
  brands: {
    company: ['brand', 'company', 'name'], category: ['category'], fit: ['fit'], notes: ['notes'],
    website: ['website', 'url', 'site'], domains: ['domain', 'domains', 'emaildomain'],
  },
  rates: {
    package: ['package', 'name'], standard: ['standard', 'price', 'standardprice'], floor: ['floor', 'floorprice'],
    included: ['whatsincluded', 'included', 'includes'], notes: ['notes'],
  },
};
const FIELD_LABELS = {
  company: 'Company', category: 'Category', contact_name: 'Contact name', contact_email: 'Contact email', source: 'Source',
  package: 'Package', slot: 'Video / slot', pitched_on: 'Pitched on', replied_on: 'Replied on', stage: 'Stage', quoted: 'Quoted',
  final: 'Final', publish_date: 'Publish date', invoiced_on: 'Invoiced on', paid_on: 'Paid on', next_action: 'Next action',
  next_action_date: 'Next action date', lost_reason: 'Lost reason', notes: 'Notes', fit: 'Fit', website: 'Website',
  domains: 'Email domain', standard: 'Standard', floor: 'Floor', included: 'What’s included',
};
const KIND_LABEL = { pipeline: 'Pipeline (deals)', brands: 'Brands (companies)', rates: 'Rate card', targets: 'Monthly targets', lists: 'Category list' };

function autoMap(kind, headers) {
  const map = {};
  headers.forEach((hd, i) => {
    const n = norm(hd);
    for (const [field, aliases] of Object.entries(FIELDS[kind] || {})) {
      if (aliases.includes(n) && !Object.values(map).includes(field)) { map[i] = field; break; }
    }
  });
  return map;
}

function findHeaderRow(rows, kind) {
  const need = { pipeline: ['stage'], brands: ['fit'], rates: ['floor'] }[kind] || [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const n = (rows[i] || []).map(norm);
    if (need.every((k) => n.includes(k)) && n.some((x) => (FIELDS[kind].company || FIELDS[kind].package).includes(x))) return i;
  }
  return -1;
}

function detectKind(name, rows) {
  const n = norm(name);
  if (n.includes('pipeline') || n.includes('deals')) return 'pipeline';
  if (n.includes('brand') || n.includes('compan')) return 'brands';
  if (n.includes('rate')) return 'rates';
  if (n.includes('dashboard') || n.includes('target')) return 'targets';
  if (n === 'lists') return 'lists';
  for (const k of ['pipeline', 'rates', 'brands']) if (findHeaderRow(rows, k) >= 0) return k;
  return null;
}

// Targets from the tracker's Dashboard tab: the "By month" table plus the weekly target
function parseTargets(rows) {
  let weekly = null;
  const months = [];
  let head = -1;
  rows.forEach((r, i) => {
    const first = norm(r && r[0]);
    if (first.startsWith('pitchessentthisweek')) weekly = Number(r[2]) || null;
    if (head < 0 && (r || []).map(norm).includes('targetpitches')) head = i;
  });
  if (head >= 0) {
    const cols = rows[head].map(norm);
    const col = (name) => cols.indexOf(name);
    for (const r of rows.slice(head + 1)) {
      if (!r || norm(r[0]) === 'total' || !r[0]) continue;
      const iso = toIsoDate(r[col('monthstart')]) || toIsoDate(`1 ${r[0]}`);
      if (!iso) continue;
      months.push({
        month: iso.slice(0, 7),
        pitches: Number(r[col('targetpitches')]) || 0,
        deals: Number(r[col('targetdeals')]) || 0,
        revenue: Number(r[col('target')]) || 0,
      });
    }
  }
  return months.length ? { weeklyPitches: weekly ?? 5, months } : null;
}

function parseCategories(rows) {
  const head = (rows[0] || []).map(norm);
  const c = head.indexOf('categories');
  if (c < 0) return null;
  return rows.slice(1).map((r) => str(r && r[c])).filter(Boolean);
}

// --- Build the import from mapped sheets ------------------------------------------------------
function buildImport(sheets, { updateRates }) {
  const s = store.state;
  const out = { companies: [], contacts: [], deals: [], payments: [], rateCard: [] };
  const warnings = [];
  const skipped = [];
  const byName = new Map(s.companies.map((c) => [c.name.toLowerCase(), { id: c.id, existing: true, rec: c }]));
  const usedDomains = new Set(s.companies.flatMap((c) => c.domains || []));
  const cats = [...s.settings.categories];

  const companyFor = (name, extra = {}) => {
    const key = name.toLowerCase();
    let entry = byName.get(key);
    if (!entry) {
      const rec = { id: crypto.randomUUID(), name, domains: [] };
      out.companies.push(rec);
      entry = { id: rec.id, existing: false, rec };
      byName.set(key, entry);
    }
    if (!entry.existing) {
      for (const [k, v] of Object.entries(extra)) {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
        if (k === 'domains') {
          v.forEach((d) => { if (!usedDomains.has(d)) { usedDomains.add(d); entry.rec.domains.push(d); } });
        } else if (k === 'notes' && entry.rec.notes) {
          if (!entry.rec.notes.includes(v)) entry.rec.notes = `${entry.rec.notes}\n${v}`;
        } else if (entry.rec[k] == null) entry.rec[k] = v;
      }
    }
    return entry.id;
  };

  const rowsOf = (sh) => sh.rows.slice(sh.headerRow + 1).map((r, i) => {
    const o = { _row: sh.headerRow + i + 2 };
    Object.entries(sh.map).forEach(([col, field]) => { if (field) o[field] = r[col]; });
    return o;
  });

  // Brands first, so pipeline rows join the richer company records
  for (const sh of sheets.filter((x) => x.kind === 'brands' && x.include)) {
    for (const r of rowsOf(sh)) {
      const name = str(r.company);
      if (!name) continue;
      const domains = str(r.domains).split(/[\s,;]+/).map(normalizeDomain).filter(Boolean);
      const website = str(r.website);
      if (website && normalizeDomain(website) && !domains.length) domains.push(normalizeDomain(website));
      companyFor(name, { category: str(r.category) || null, fit: pick(FITS, r.fit), notes: str(r.notes) || null, website: website || null, domains });
      if (str(r.category) && !cats.includes(str(r.category))) cats.push(str(r.category));
    }
  }

  // Same company, package and slot = already imported (dates change as the deal moves)
  const existingDeals = new Set(live(s.deals).map((d) => [d.company_id, d.package || '', d.slot_note || ''].join('|')));
  const contactsByKey = new Map(s.contacts.map((c) => [`${c.company_id}|${(c.email || c.name || '').toLowerCase()}`, c.id]));

  for (const sh of sheets.filter((x) => x.kind === 'pipeline' && x.include)) {
    for (const r of rowsOf(sh)) {
      const name = str(r.company);
      if (!name) continue;
      const email = str(r.contact_email).toLowerCase();
      const dom = email.includes('@') ? normalizeDomain(email) : null;
      const companyId = companyFor(name, { category: str(r.category) || null, domains: dom && !FREE_MAIL.has(dom) ? [dom] : [] });

      let contactId = null;
      if (str(r.contact_name) || email) {
        const key = `${companyId}|${(email || str(r.contact_name)).toLowerCase()}`;
        contactId = contactsByKey.get(key) || null;
        if (!contactId) {
          contactId = crypto.randomUUID();
          contactsByKey.set(key, contactId);
          out.contacts.push({ id: contactId, company_id: companyId, name: str(r.contact_name) || null, email: email || null });
        }
      }

      let stage = pick(STAGES, r.stage);
      if (!stage) {
        if (str(r.stage)) warnings.push(`Row ${r._row} (${name}): unknown stage "${str(r.stage)}", set to Researching.`);
        stage = 'Researching';
      }
      const source = pick(SOURCES, r.source);
      if (str(r.source) && !source) warnings.push(`Row ${r._row} (${name}): unknown source "${str(r.source)}", left blank.`);
      const deal = {
        id: crypto.randomUUID(), company_id: companyId, contact_id: contactId, stage, source,
        package: str(r.package) || null, slot_note: str(r.slot) || null,
        pitched_on: toIsoDate(r.pitched_on), replied_on: toIsoDate(r.replied_on),
        quoted: toMoney(r.quoted), final: toMoney(r.final), publish_date: toIsoDate(r.publish_date),
        next_action: str(r.next_action) || null, next_action_date: toIsoDate(r.next_action_date),
        lost_reason: str(r.lost_reason) || null, notes: str(r.notes) || null,
      };
      const sig = [companyId, deal.package || '', deal.slot_note || ''].join('|');
      if (existingDeals.has(sig)) { skipped.push(`Row ${r._row} (${name}): already in the CRM`); continue; }
      existingDeals.add(sig);
      out.deals.push(deal);
      const inv = toIsoDate(r.invoiced_on);
      const paid = toIsoDate(r.paid_on);
      const amount = deal.final ?? deal.quoted;
      if ((inv || paid) && amount != null) out.payments.push({ id: crypto.randomUUID(), deal_id: deal.id, amount, invoiced_on: inv, paid_on: paid });
      else if (inv || paid) warnings.push(`Row ${r._row} (${name}): invoiced/paid date but no amount, so no payment was added.`);
    }
  }

  const existingRates = new Map(s.rateCard.map((r) => [r.package.toLowerCase(), r.id]));
  for (const sh of sheets.filter((x) => x.kind === 'rates' && x.include)) {
    sh.rateRows.forEach((r, i) => {
      if (!r.package) return;
      const rec = { package: r.package, standard: r.standard, floor: r.floor, included: r.included || null, notes: r.notes || null, sort: i };
      const existing = existingRates.get(r.package.toLowerCase());
      if (existing) {
        if (updateRates) out.rateCard.push({ replaceId: existing, ...rec });
        else skipped.push(`Rate card: "${r.package}" already exists (tick "Update existing packages" to overwrite)`);
      } else out.rateCard.push({ id: crypto.randomUUID(), ...rec });
    });
  }

  const targetSheet = sheets.find((x) => x.kind === 'targets' && x.include && x.targets);
  if (targetSheet) out.targets = targetSheet.targets;
  const listSheet = sheets.find((x) => x.kind === 'lists' && x.include && x.categories);
  listSheet && listSheet.categories.forEach((c) => { if (!cats.includes(c)) cats.push(c); });
  if (cats.length !== s.settings.categories.length) out.categories = cats;

  // Validate locally so problems show before anything is sent
  const errors = [];
  const check = (list, entity, label) => list.forEach((rec) => {
    const { replaceId, ...rest } = rec;
    const v = validate(entity, rest, { partial: Boolean(replaceId) });
    if (!v.ok) errors.push(`${label} "${rec.name || rec.package || rec.id}": ${Object.values(v.errors).join('; ')}`);
  });
  check(out.companies, 'companies', 'Company');
  check(out.contacts, 'contacts', 'Contact');
  check(out.deals, 'deals', 'Deal');
  check(out.payments, 'payments', 'Payment');
  check(out.rateCard, 'rate_card', 'Package');
  return { payload: out, warnings, skipped, errors };
}

// --- Import panel ---------------------------------------------------------------------------
export function openImport() {
  const status = h('p', { class: 'crm-note', 'aria-live': 'polite' });
  const work = h('div', { class: 'crm-import' });
  const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': 'Tracker file' });
  let sheets = [];
  let updateRates = false;

  const summaryEl = h('div');
  const importBtn = button('Import', async () => {
    const { payload, errors } = buildImport(sheets, { updateRates });
    if (errors.length) { toast('Fix the errors listed first', { kind: 'error' }); return; }
    try {
      const res = await busy(importBtn, () => api.import(payload));
      await reload();
      closePanel({ force: true });
      const n = res.imported;
      toast(`Imported ${n.companies || 0} companies, ${n.contacts || 0} contacts, ${n.deals || 0} deals, ${n.payments || 0} payments, ${n.rateCard || 0} packages${n.targets ? ', targets' : ''}.`, { kind: 'ok', ms: 9000 });
    } catch (err) {
      if (Array.isArray(err.details)) {
        summaryEl.replaceChildren(h('ul', { class: 'crm-checks' }, err.details.map((e) => h('li', { class: 'is-bad' },
          `${e.sheet}${e.row ? ` row ${e.row}` : ''}: ${e.message}${e.details ? ` (${Object.values(e.details).join('; ')})` : ''}`))));
      }
    }
  }, { kind: 'primary', disabled: true });

  const refreshSummary = () => {
    const { payload, warnings, skipped, errors } = buildImport(sheets, { updateRates });
    const p = payload;
    const lines = [
      `${p.companies.length} new companies`, `${p.contacts.length} contacts`, `${p.deals.length} deals`,
      `${p.payments.length} payments`, `${p.rateCard.length} packages`,
      p.targets ? `targets for ${p.targets.months.length} months` : null,
      p.categories ? `${p.categories.length} categories` : null,
    ].filter(Boolean);
    summaryEl.replaceChildren(
      h('p', { class: 'crm-import-sum' }, `Will add: ${lines.join(', ')}.`),
      errors.length ? h('ul', { class: 'crm-checks' }, errors.map((e) => h('li', { class: 'is-bad' }, e))) : null,
      warnings.length ? h('ul', { class: 'crm-checks' }, warnings.map((e) => h('li', { class: 'is-warn' }, e))) : null,
      skipped.length ? h('details', {}, h('summary', {}, `${skipped.length} skipped`), h('ul', { class: 'crm-checks' }, skipped.map((e) => h('li', {}, e)))) : null);
    importBtn.disabled = errors.length > 0 || !lines.some((l) => !l.startsWith('0 '));
  };

  const renderSheet = (sh) => {
    const box = h('section', { class: 'crm-import-sheet' });
    const include = h('input', { type: 'checkbox', checked: sh.include, onchange: (e) => { sh.include = e.target.checked; refreshSummary(); } });
    const kindSel = h('select', { 'aria-label': `What is the ${sh.name} sheet?`, onchange: (e) => { setKind(sh, e.target.value || null); box.replaceWith(renderSheet(sh)); refreshSummary(); } },
      h('option', { value: '' }, 'Skip this sheet'),
      Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k, selected: sh.kind === k }, l)));
    box.append(h('div', { class: 'crm-import-sheet-head' },
      h('label', { class: 'crm-check' }, include, ' ', h('strong', {}, sh.name)), kindSel));

    if (sh.kind && FIELDS[sh.kind] && sh.headerRow >= 0) {
      const headers = sh.rows[sh.headerRow] || [];
      const dataRows = sh.rows.slice(sh.headerRow + 1).filter((r) => r && r.some((c) => c !== null && c !== ''));
      const mapRow = h('div', { class: 'crm-map' }, headers.map((hd, i) => {
        if (hd == null || hd === '') return null;
        return h('label', { class: 'crm-map-item' }, h('span', {}, str(hd)),
          h('select', { onchange: (e) => { sh.map[i] = e.target.value || null; refreshSummary(); if (sh.kind === 'rates') { buildRateRows(sh); box.replaceWith(renderSheet(sh)); } } },
            h('option', { value: '' }, 'Ignore'),
            Object.keys(FIELDS[sh.kind]).map((f) => h('option', { value: f, selected: sh.map[i] === f }, FIELD_LABELS[f]))));
      }));
      box.append(h('p', { class: 'crm-note is-muted' }, `${dataRows.length} rows. Match each column to a field:`), mapRow);

      if (sh.kind === 'rates') {
        const upd = h('input', { type: 'checkbox', checked: updateRates, onchange: (e) => { updateRates = e.target.checked; refreshSummary(); } });
        box.append(h('p', { class: 'crm-note is-muted' }, 'Check the prices before importing; you can edit them here.'),
          h('div', { class: 'crm-table-wrap' }, h('table', { class: 'crm-table is-compact' },
            h('thead', {}, h('tr', {}, ['Package', 'Standard', 'Floor'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, sh.rateRows.map((r) => h('tr', {},
              h('th', { scope: 'row' }, r.package),
              ['standard', 'floor'].map((k) => h('td', {}, h('input', {
                type: 'number', min: 0, value: r[k] ?? '', 'aria-label': `${r.package} ${k}`, onchange: (e) => { r[k] = toMoney(e.target.value); refreshSummary(); },
              })))))))),
          h('label', { class: 'crm-check' }, upd, ' Update existing packages with these values'));
      } else {
        const fields = [...new Set(Object.values(sh.map).filter(Boolean))];
        box.append(h('div', { class: 'crm-table-wrap' }, h('table', { class: 'crm-table is-compact is-preview' },
          h('thead', {}, h('tr', {}, fields.map((f) => h('th', { scope: 'col' }, FIELD_LABELS[f])))),
          h('tbody', {}, dataRows.slice(0, 6).map((r) => h('tr', {}, fields.map((f) => {
            const col = Object.keys(sh.map).find((k) => sh.map[k] === f);
            let v = r[col];
            if (/_on$|_date$|publish/.test(f)) v = toIsoDate(v) || str(v);
            else if (['quoted', 'final'].includes(f)) v = toMoney(v) != null ? fmtMoney(toMoney(v)) : str(v);
            return h('td', {}, str(v).slice(0, 80));
          })))))));
      }
    } else if (sh.kind === 'targets') {
      box.append(sh.targets
        ? h('p', { class: 'crm-note' }, `${sh.targets.months.length} months of targets, ${sh.targets.weeklyPitches} pitches a week.`)
        : h('p', { class: 'crm-note is-error' }, 'Couldn’t find a "Target pitches" table on this sheet.'));
    } else if (sh.kind === 'lists') {
      box.append(sh.categories ? h('p', { class: 'crm-note' }, `Categories: ${sh.categories.join(', ')}`) : h('p', { class: 'crm-note is-error' }, 'No "Categories" column found.'));
    } else if (sh.kind) {
      box.append(h('p', { class: 'crm-note is-error' }, 'Couldn’t find the header row for this kind of sheet.'));
    }
    return box;
  };

  function buildRateRows(sh) {
    const col = (f) => Object.keys(sh.map).find((k) => sh.map[k] === f);
    sh.rateRows = sh.rows.slice(sh.headerRow + 1).map((r) => ({
      package: str(r[col('package')]), standard: toMoney(r[col('standard')]), floor: toMoney(r[col('floor')]),
      included: str(r[col('included')]), notes: str(r[col('notes')]),
    })).filter((r) => r.package && (r.standard != null || r.floor != null));
  }

  function setKind(sh, kind) {
    sh.kind = kind;
    sh.include = Boolean(kind);
    sh.headerRow = kind && FIELDS[kind] ? findHeaderRow(sh.rows, kind) : -1;
    if (sh.headerRow < 0 && kind && FIELDS[kind] && sh.rows.length) sh.headerRow = 0;
    sh.map = sh.headerRow >= 0 ? autoMap(kind, sh.rows[sh.headerRow] || []) : {};
    if (kind === 'rates') buildRateRows(sh);
    if (kind === 'targets') sh.targets = parseTargets(sh.rows);
    if (kind === 'lists') sh.categories = parseCategories(sh.rows);
  }

  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { status.textContent = 'That file is over 10 MB.'; return; }
    status.textContent = 'Reading…';
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false, cellFormula: false, cellHTML: false });
      sheets = wb.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
        const sh = { name, rows };
        setKind(sh, detectKind(f.name.endsWith('.csv') ? '' : name, rows));
        return sh;
      });
      status.textContent = `${f.name}: ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}. Check the matches, then import.`;
      work.replaceChildren(...sheets.map(renderSheet));
      refreshSummary();
    } catch (err) {
      status.textContent = err.message || 'Couldn’t read that file.';
    }
  });

  openPanel({
    label: 'Settings', title: 'Import a tracker',
    subtitle: 'An .xlsx (Pipeline, Brands, Rate card, Dashboard and Lists tabs) or a single .csv.',
    body: [h('label', { class: 'crm-file' }, h('span', {}, 'Choose a file'), file), status, work, summaryEl],
    footer: [importBtn, button('Cancel', () => closePanel())],
  });
}

// --- Export ------------------------------------------------------------------------------------
const dayStamp = () => todayIn();
// Spreadsheet apps run cells starting with these as formulas: neutralize them
const safeCell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

async function exportTables() {
  const data = await api.export();
  const companies = new Map(data.companies.map((c) => [c.id, c]));
  const contacts = new Map(data.contacts.map((c) => [c.id, c]));
  const videos = new Map(data.videos.map((v) => [v.id, v]));
  const deals = new Map(data.deals.map((d) => [d.id, d]));
  const t = todayIn(data.settings.tz);
  const cname = (id) => (companies.get(id) || {}).name || '';
  const tables = {
    Deals: data.deals.map((d) => {
      const fu = followUp(d, t);
      const pc = priceCheck(d, data.rateCard);
      return {
        Company: cname(d.company_id), Contact: (contacts.get(d.contact_id) || {}).name || '', 'Contact email': (contacts.get(d.contact_id) || {}).email || '',
        Source: d.source, Package: d.package, Video: (videos.get(d.video_id) || {}).title || '', 'Slot note': d.slot_note, Stage: d.stage,
        'Pitched on': d.pitched_on, 'Replied on': d.replied_on, 'Quoted ($)': d.quoted, 'Final ($)': d.final,
        'Floor ($)': pc ? pc.floor : null, 'Price check': pc ? (pc.below ? 'Below floor' : 'OK') : '',
        'Publish date': d.publish_date, 'Next follow-up': fu ? `${fu.label} ${fu.due}` : '',
        'Next action': d.next_action, 'Next action date': d.next_action_date, Overdue: isOverdue(d, t) ? 'Overdue' : '',
        Deliverables: d.deliverables, 'Usage rights': d.usage_rights, Exclusivity: d.exclusivity,
        'Lost reason': d.lost_reason, Notes: d.notes, Archived: d.archived ? 'Yes' : '', ID: d.id,
      };
    }),
    Companies: data.companies.map((c) => ({
      Name: c.name, 'Email domains': (c.domains || []).join(', '), Category: c.category, Fit: c.fit, Website: c.website,
      'Contact method': c.contact_method, 'Form URL': c.form_url, Notes: c.notes, Archived: c.archived ? 'Yes' : '', ID: c.id,
    })),
    Contacts: data.contacts.map((c) => ({ Company: cname(c.company_id), Name: c.name, Email: c.email, Role: c.role, Notes: c.notes, Archived: c.archived ? 'Yes' : '', ID: c.id })),
    Payments: data.payments.map((p) => {
      const d = deals.get(p.deal_id) || {};
      return { Company: cname(d.company_id), Deal: d.package || d.slot_note || '', 'Amount ($)': p.amount, 'Invoiced on': p.invoiced_on, 'Paid on': p.paid_on, Method: p.method, 'Fees ($)': p.fees, 'Net ($)': p.net, Notes: p.notes, Archived: p.archived ? 'Yes' : '', ID: p.id };
    }),
    Videos: data.videos.map((v) => ({ Title: v.title, 'Publish date': v.publish_date, Format: v.format, 'Sponsor status': v.sponsor_status, 'YouTube ID': v.youtube_id, Notes: v.notes, Archived: v.archived ? 'Yes' : '', ID: v.id })),
    'Rate card': data.rateCard.map((r) => ({ Package: r.package, 'Standard ($)': r.standard, 'Floor ($)': r.floor, "What's included": r.included, Notes: r.notes, Archived: r.archived ? 'Yes' : '' })),
    Activity: data.activities.map((a) => ({
      When: a.occurred_at, Company: cname(a.company_id), Deal: a.deal_id ? ((deals.get(a.deal_id) || {}).package || 'Deal') : '', Kind: a.kind, Source: a.source,
      Title: a.title, Details: a.body, Direction: a.direction, From: a.email_from, To: a.email_to, Subject: a.subject, Snippet: a.snippet, 'Gmail link': a.gmail_link, "Claude's note": a.claude_note,
    })),
    Targets: data.settings.targets.months.map((m) => ({ Month: m.month, 'Target pitches': m.pitches, 'Target deals': m.deals, 'Target sponsor $': m.revenue })),
  };
  Object.values(tables).forEach((rows) => rows.forEach((r) => Object.keys(r).forEach((k) => { r[k] = safeCell(r[k] ?? ''); })));
  return { data, tables };
}

export async function exportAs(format, btn) {
  await busy(btn, async () => {
    if (format === 'json') {
      const data = await api.export();
      download(`sponsor-crm-${dayStamp()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      return;
    }
    const [XLSX, { tables }] = await Promise.all([loadXLSX(), exportTables()]);
    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      Object.entries(tables).forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name));
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      download(`sponsor-crm-${dayStamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      return;
    }
    const rows = tables[format];
    if (!rows) throw new Error('Unknown export');
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows.length ? rows : [{}]));
    download(`sponsor-crm-${format.toLowerCase().replace(/\s+/g, '-')}-${dayStamp()}.csv`, new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  }).catch(() => {});
}

export const CSV_TABLES = ['Deals', 'Companies', 'Contacts', 'Payments', 'Videos', 'Rate card', 'Activity', 'Targets'];
export { toastError };
