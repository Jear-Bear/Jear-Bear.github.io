// claude.js — everything Claude can write through the connector, and the
// review queue that decides it. Claude's writes are untrusted: every field is
// validated and whitelisted here, and proposals change nothing until passed.

import { validate, isUuid, isIsoDate, normalizeDomain, STAGES, SOURCES } from '../../../scripts/manage/schema.js';
import { HttpError, createRecord, updateRecord, getRecord } from './data.js';

const nowIso = () => new Date().toISOString();
const clip = (v, n) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, n) || null);
const json = (v) => JSON.stringify(v);
const parse = (v, fallback = null) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

export const PROPOSAL_KINDS = ['stage_change', 'amounts', 'dates', 'next_action', 'new_contact', 'add_domain', 'new_deal', 'new_company_deal', 'payment'];
export const LOW_RISK_KINDS = ['next_action', 'new_contact', 'add_domain'];
const CONFIDENCE = ['low', 'medium', 'high'];

// Fields each proposal kind may set, and on which record
const NEW_DEAL_FIELDS = ['source', 'stage', 'package', 'slot_note', 'pitched_on', 'replied_on', 'quoted', 'next_action', 'next_action_date', 'notes'];
const PAYMENT_FIELDS = ['amount', 'paid_on', 'invoiced_on', 'method', 'fees', 'net', 'notes'];
const KIND_FIELDS = {
  stage_change: { entity: 'deals', fields: ['stage'] },
  amounts: { entity: 'deals', fields: ['quoted', 'final'] },
  dates: { entity: 'deals', fields: ['pitched_on', 'replied_on', 'publish_date'] },
  next_action: { entity: 'deals', fields: ['next_action', 'next_action_date'] },
  new_contact: { entity: 'contacts', fields: ['name', 'email', 'role'] },
};

function safeGmailLink(v) {
  if (!v) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && u.hostname === 'mail.google.com' ? u.href.slice(0, 500) : null; } catch { return null; }
}

function cleanEvidence(e = {}) {
  return {
    email_date: e.email_date && !Number.isNaN(new Date(e.email_date).getTime()) ? new Date(e.email_date).toISOString() : null,
    subject: clip(e.subject, 300),
    quote: clip(e.quote, 300),
    gmail_link: safeGmailLink(e.gmail_link),
    message_id: clip(e.message_id, 200),
  };
}

// Validate a subset of an entity's fields (no unknown keys, types checked)
function checkFields(entity, allowed, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'values must be an object');
  const keys = Object.keys(values);
  if (!keys.length) throw new HttpError(400, 'values is empty');
  const extra = keys.filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(400, `Not allowed for this kind: ${extra.join(', ')}`);
  const v = validate(entity, values, { partial: true });
  if (!v.ok) throw new HttpError(400, 'Invalid values', v.errors);
  return v.values;
}

function checkPayment(values) {
  const v = checkFields('payments', PAYMENT_FIELDS, values);
  if (!(v.amount > 0)) throw new HttpError(400, 'A payment needs an amount above 0');
  if (!v.paid_on) throw new HttpError(400, 'A payment needs paid_on (the date it arrived)');
  return v;
}

function validateNewCompanyDeal(values) {
  const c = values && values.company;
  if (!c || typeof c !== 'object') throw new HttpError(400, 'new_company_deal needs a company');
  const company = checkFields('companies', ['name', 'domains', 'category', 'website', 'notes'], c);
  if (!company.name) throw new HttpError(400, 'The company needs a name');
  const contact = values.contact ? checkFields('contacts', ['name', 'email', 'role'], values.contact) : null;
  const deal = checkFields('deals', ['source', 'package', 'stage', 'replied_on', 'quoted', 'next_action', 'next_action_date', 'notes', 'slot_note'], {
    source: 'Inbound', stage: 'In conversation', ...(values.deal || {}),
  });
  return { company, contact, deal };
}

// --- Writes from the connector ---------------------------------------------------------------
export async function logEmail(db, input) {
  const messageId = clip(input.message_id, 200);
  if (!messageId) throw new HttpError(400, 'message_id is required');
  const existing = await db.prepare('SELECT id, company_id, deal_id FROM activities WHERE gmail_message_id = ?').bind(messageId).first();
  if (existing) return { logged: false, duplicate: true, activity_id: existing.id, company_id: existing.company_id };

  const direction = input.direction === 'out' ? 'out' : 'in';
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'date must be an ISO date-time');
  let companyId = isUuid(input.company_id) ? input.company_id : null;
  let dealId = isUuid(input.deal_id) ? input.deal_id : null;
  if (dealId) {
    const d = await db.prepare('SELECT company_id FROM deals WHERE id = ?').bind(dealId).first();
    if (!d) throw new HttpError(400, 'deal_id doesn’t exist');
    companyId = companyId || d.company_id;
  }
  if (companyId && !(await db.prepare('SELECT 1 FROM companies WHERE id = ?').bind(companyId).first())) throw new HttpError(400, 'company_id doesn’t exist');
  if (!companyId) {
    // Match the other party's domain to a tracked company
    const counterpart = direction === 'in' ? input.from : input.to;
    const domains = String(counterpart || '').split(/[,;\s]+/).map(normalizeDomain).filter(Boolean);
    for (const d of domains) {
      const r = await db.prepare('SELECT company_id FROM company_domains WHERE domain = ?').bind(d).first();
      if (r) { companyId = r.company_id; break; }
    }
  }
  if (!companyId) {
    return { logged: false, unmatched: true, message: 'No tracked company matches this email. If it is a sponsorship inquiry, file a new_company_deal proposal.' };
  }
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT OR IGNORE INTO activities (id, company_id, deal_id, kind, occurred_at, title, source, direction, email_from, email_to, email_cc, subject, snippet, gmail_message_id, gmail_thread_id, gmail_link, claude_note, created_at) '
    + "VALUES (?, ?, ?, 'email', ?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id, companyId, dealId, date.toISOString(), clip(input.subject, 300), direction,
    clip(input.from, 300), clip(input.to, 500), clip(input.cc, 500), clip(input.subject, 300), clip(input.snippet, 299),
    messageId, clip(input.thread_id, 200), safeGmailLink(input.gmail_link), clip(input.note, 1000), nowIso(),
  ).run();
  return { logged: true, activity_id: id, company_id: companyId, deal_id: dealId };
}

export async function createProposal(db, input) {
  const kind = input.kind;
  if (!PROPOSAL_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${PROPOSAL_KINDS.join(', ')}`);
  const confidence = CONFIDENCE.includes(input.confidence) ? input.confidence : 'medium';
  let dealId = isUuid(input.deal_id) ? input.deal_id : null;
  let companyId = isUuid(input.company_id) ? input.company_id : null;
  let proposed;
  if (kind === 'new_company_deal') {
    proposed = validateNewCompanyDeal(input.values);
    dealId = null; companyId = null;
  } else if (kind === 'new_deal') {
    if (!companyId) throw new HttpError(400, 'new_deal needs company_id (for a new brand use new_company_deal)');
    if (!(await db.prepare('SELECT 1 FROM companies WHERE id = ?').bind(companyId).first())) throw new HttpError(400, 'company_id doesn’t exist');
    proposed = checkFields('deals', NEW_DEAL_FIELDS, { source: 'Inbound', stage: 'In conversation', ...(input.values || {}) });
    dealId = null;
  } else if (kind === 'payment') {
    if (!dealId) throw new HttpError(400, 'payment needs deal_id');
    const d = await db.prepare('SELECT company_id FROM deals WHERE id = ?').bind(dealId).first();
    if (!d) throw new HttpError(400, 'deal_id doesn’t exist');
    companyId = d.company_id;
    proposed = checkPayment(input.values);
    const paid = await db.prepare('SELECT id FROM payments WHERE deal_id = ? AND archived = 0 AND paid_on = ? AND abs(amount - ?) < 0.005').bind(dealId, proposed.paid_on, proposed.amount).first();
    if (paid) return { created: false, duplicate: true, message: 'That payment is already recorded' };
  } else if (kind === 'add_domain') {
    if (!companyId) throw new HttpError(400, 'add_domain needs company_id');
    if (!(await db.prepare('SELECT 1 FROM companies WHERE id = ?').bind(companyId).first())) throw new HttpError(400, 'company_id doesn’t exist');
    const domain = normalizeDomain(input.values && input.values.domain);
    if (!domain) throw new HttpError(400, 'values.domain must be a domain like brand.com');
    const taken = await db.prepare('SELECT company_id FROM company_domains WHERE domain = ?').bind(domain).first();
    if (taken) return { created: false, duplicate: true, message: taken.company_id === companyId ? 'Already tracked' : 'That domain belongs to another company' };
    proposed = { domain };
  } else if (kind === 'new_contact') {
    if (!companyId) throw new HttpError(400, 'new_contact needs company_id');
    if (!(await db.prepare('SELECT 1 FROM companies WHERE id = ?').bind(companyId).first())) throw new HttpError(400, 'company_id doesn’t exist');
    proposed = checkFields('contacts', KIND_FIELDS.new_contact.fields, input.values);
  } else {
    if (!dealId) throw new HttpError(400, `${kind} needs deal_id`);
    const d = await db.prepare('SELECT company_id FROM deals WHERE id = ?').bind(dealId).first();
    if (!d) throw new HttpError(400, 'deal_id doesn’t exist');
    companyId = d.company_id;
    proposed = checkFields('deals', KIND_FIELDS[kind].fields, input.values);
    if (kind === 'stage_change' && !STAGES.includes(proposed.stage)) throw new HttpError(400, 'Unknown stage');
  }
  const evidence = cleanEvidence(input.evidence);
  const dedupe = `${kind}|${dealId || companyId || ''}|${evidence.message_id || ''}|${json(proposed)}`.slice(0, 900);
  const id = crypto.randomUUID();
  const r = await db.prepare('INSERT OR IGNORE INTO proposals (id, kind, company_id, deal_id, proposed, evidence, reason, confidence, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, kind, companyId, dealId, json(proposed), json(evidence), clip(input.reason, 300), confidence, dedupe, nowIso()).run();
  if (!r.meta.changes) return { created: false, duplicate: true };
  return { created: true, proposal_id: id };
}

export async function suggestVideoIdea(db, input) {
  const title = clip(input.title, 200);
  if (!title) throw new HttpError(400, 'title is required');
  const source = ['performance', 'sponsor_conversations', 'both'].includes(input.source) ? input.source : 'performance';
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).slice(0, 5).map((e) => clip(e, 200)).filter(Boolean);
  const dup = await db.prepare("SELECT id FROM video_ideas WHERE lower(title) = lower(?) AND status != 'dismissed'").bind(title).first();
  if (dup) return { created: false, duplicate: true, idea_id: dup.id };
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO video_ideas (id, title, why, source, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, title, clip(input.why, 600), source, json(evidence), nowIso()).run();
  return { created: true, idea_id: id };
}

export async function saveInsight(db, input) {
  const text = clip(input.text, 1500);
  if (!text) throw new HttpError(400, 'text is required');
  const kind = input.kind === 'weekly' ? 'weekly' : 'note';
  const weekOf = isIsoDate(input.week_of) ? input.week_of : null;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO insights (id, kind, week_of, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, kind, weekOf, text, nowIso()).run();
  return { saved: true, insight_id: id };
}

export async function getCursor(db) {
  const r = await db.prepare("SELECT value, updated_at FROM settings WHERE key = 'email_sync_cursor'").first();
  return { cursor: r ? parse(r.value) : null, updated_at: r ? r.updated_at : null };
}
export async function setCursor(db, cursor) {
  const c = clip(cursor, 200);
  if (!c) throw new HttpError(400, 'cursor is required');
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('email_sync_cursor', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(json(c), nowIso()).run();
  return { cursor: c };
}

// --- Review queue (app side) ---------------------------------------------------------------------
function proposalRow(r) {
  return { ...r, proposed: parse(r.proposed, {}), evidence: parse(r.evidence, {}), applied: parse(r.applied) };
}

export async function listReview(db) {
  const [p, ideas, suggested, insights] = await db.batch([
    db.prepare("SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200"),
    db.prepare("SELECT * FROM video_ideas WHERE status = 'new' ORDER BY created_at DESC LIMIT 100"),
    db.prepare('SELECT * FROM cal_items WHERE suggested = 1 ORDER BY start LIMIT 100'),
    db.prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT 20'),
  ]);
  return {
    proposals: p.results.map(proposalRow),
    ideas: ideas.results.map((r) => ({ ...r, evidence: parse(r.evidence, []) })),
    suggestions: suggested.results.map((r) => ({ ...r, checklist: parse(r.checklist, []) })),
    insights: insights.results,
  };
}

async function logApproval(db, companyId, dealId, title) {
  await db.prepare("INSERT INTO activities (id, company_id, deal_id, kind, occurred_at, title, source, created_at) VALUES (?, ?, ?, 'note', ?, ?, 'system', ?)")
    .bind(crypto.randomUUID(), companyId, dealId, nowIso(), title, nowIso()).run();
}

// Pass: apply the (possibly edited) values and record that you approved it
export async function passProposal(db, id, edited) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const p = await db.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Not found');
  if (p.status !== 'pending') throw new HttpError(409, 'Already decided');
  const proposed = parse(p.proposed, {});
  let applied;
  let summary;
  if (p.kind === 'new_company_deal') {
    const v = validateNewCompanyDeal(edited || proposed);
    const company = await createRecord(db, 'companies', v.company);
    let contactId = null;
    if (v.contact && (v.contact.name || v.contact.email)) contactId = (await createRecord(db, 'contacts', { ...v.contact, company_id: company.id })).id;
    const deal = await createRecord(db, 'deals', { ...v.deal, company_id: company.id, contact_id: contactId });
    applied = { company_id: company.id, contact_id: contactId, deal_id: deal.id };
    summary = `Approved by me: new company ${company.name} and inbound deal (Claude proposal)`;
    await logApproval(db, company.id, deal.id, summary);
  } else if (p.kind === 'new_deal') {
    const values = checkFields('deals', NEW_DEAL_FIELDS, edited || proposed);
    const d = await createRecord(db, 'deals', { stage: 'In conversation', ...values, company_id: p.company_id });
    applied = { deal_id: d.id, ...values };
    summary = `Approved by me: new ${values.source || ''} deal (Claude proposal)`.replace('  ', ' ');
    await logApproval(db, p.company_id, d.id, summary);
  } else if (p.kind === 'payment') {
    const values = checkPayment(edited || proposed);
    await getRecord(db, 'deals', p.deal_id);
    // Mark a matching invoiced-but-unpaid payment as paid, else record a new one
    const open = await db.prepare('SELECT id FROM payments WHERE deal_id = ? AND archived = 0 AND paid_on IS NULL AND abs(amount - ?) < 0.005 ORDER BY invoiced_on LIMIT 1')
      .bind(p.deal_id, values.amount).first();
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v != null)); // keep the invoice's own details
    const pay = open ? await updateRecord(db, 'payments', open.id, filled) : await createRecord(db, 'payments', { ...values, deal_id: p.deal_id });
    applied = { payment_id: pay.id, matched_invoice: Boolean(open), ...values };
    summary = `Approved by me: payment received $${values.amount} on ${values.paid_on}${open ? ' (invoice marked paid)' : ''} (Claude proposal)`;
    await logApproval(db, p.company_id, p.deal_id, summary);
  } else if (p.kind === 'add_domain') {
    const domain = normalizeDomain((edited || proposed).domain);
    if (!domain) throw new HttpError(400, 'Not a valid domain');
    const company = await getRecord(db, 'companies', p.company_id);
    await updateRecord(db, 'companies', p.company_id, { domains: [...new Set([...(company.domains || []), domain])] });
    applied = { domain };
    summary = `Approved by me: email domain ${domain} (Claude proposal)`;
    await logApproval(db, p.company_id, null, summary);
  } else if (p.kind === 'new_contact') {
    const values = checkFields('contacts', KIND_FIELDS.new_contact.fields, edited || proposed);
    const c = await createRecord(db, 'contacts', { ...values, company_id: p.company_id });
    applied = { contact_id: c.id, ...values };
    summary = `Approved by me: new contact ${values.name || values.email} (Claude proposal)`;
    await logApproval(db, p.company_id, null, summary);
  } else {
    const spec = KIND_FIELDS[p.kind];
    const values = checkFields('deals', spec.fields, edited || proposed);
    await getRecord(db, 'deals', p.deal_id);
    await updateRecord(db, 'deals', p.deal_id, values);
    applied = values;
    summary = `Approved by me: ${Object.entries(values).map(([k, v]) => `${k.replace(/_/g, ' ')} → ${v ?? '—'}`).join(', ')} (Claude proposal)`;
    await logApproval(db, p.company_id, p.deal_id, summary);
  }
  await db.prepare("UPDATE proposals SET status = 'passed', applied = ?, decided_at = ? WHERE id = ?").bind(json(applied), nowIso(), id).run();
  return { passed: true, applied };
}

export async function dismissProposal(db, id, reason) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const r = await db.prepare("UPDATE proposals SET status = 'dismissed', dismiss_reason = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .bind(clip(reason, 300), nowIso(), id).run();
  if (!r.meta.changes) throw new HttpError(409, 'Not pending');
  return { dismissed: true };
}

export async function decideIdea(db, id, keep) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  const idea = await db.prepare("SELECT * FROM video_ideas WHERE id = ? AND status = 'new'").bind(id).first();
  if (!idea) throw new HttpError(409, 'Not a new idea');
  let videoId = null;
  if (keep) {
    const v = await createRecord(db, 'videos', { title: idea.title, format: 'guide', sponsor_status: 'open', notes: idea.why ? `Idea from Claude: ${idea.why}` : 'Idea from Claude' });
    videoId = v.id;
  }
  await db.prepare('UPDATE video_ideas SET status = ?, video_id = ?, decided_at = ? WHERE id = ?').bind(keep ? 'kept' : 'dismissed', videoId, nowIso(), id).run();
  return { status: keep ? 'kept' : 'dismissed', video_id: videoId };
}

export { SOURCES };
