// review.js — the review queue: everything Claude filed through the
// connector. Nothing applies until you Pass it; you can edit any value first.
// All of Claude's text is rendered as text (dom.js never parses HTML).

import { h, fmtDate, fmtDateTime, fmtMoney } from './dom.js';
import { request } from './api.js';
import { store, reload, companyName, deal, dealTitle } from './store.js';
import { STAGES, SOURCES } from './schema.js';
import { INCOME_SOURCES_ENTERED, INCOME_LABELS } from './insights.js';
import { button, busy, toast, toastError } from './ui.js';
import { openCalItem } from './cal-panel.js';

const KIND_LABEL = {
  stage_change: 'Stage change', amounts: 'Amounts', dates: 'Dates', next_action: 'Next action',
  new_contact: 'New contact', add_domain: 'Add email domain', new_deal: 'New deal', new_company_deal: 'New company + inbound deal', payment: 'Payment received', income: 'Creator income',
};
const LOW_RISK = ['next_action', 'new_contact', 'add_domain'];
const BATCHABLE = [...LOW_RISK, 'income'];   // can be ticked and passed together
const FIELD_LABEL = {
  stage: 'Stage', quoted: 'Quoted ($)', final: 'Final ($)', pitched_on: 'Pitched on', replied_on: 'Replied on', publish_date: 'Publish date',
  next_action: 'Next action', next_action_date: 'Next action date', source: 'Source', package: 'Package', slot_note: 'Slot', notes: 'Notes', name: 'Name', email: 'Email', role: 'Role', domain: 'Domain',
  amount: 'Amount ($)', paid_on: 'Paid on', paid_amount: 'Amount paid ($)', paid_method: 'Paid via', invoiced_on: 'Invoiced on', method: 'Method', fees: 'Fees ($)', net: 'Net ($)',
};
const MONEY = ['quoted', 'final', 'amount', 'fees', 'net', 'paid_amount'];
const DATES = ['pitched_on', 'replied_on', 'publish_date', 'next_action_date', 'paid_on', 'invoiced_on'];

export let reviewCount = 0;
let onCount = () => {};
export function whenReviewCountChanges(fn) { onCount = fn; }

export async function refreshReviewCount() {
  try {
    const r = await request('GET', 'review');
    reviewCount = r.proposals.length + r.suggestions.length + r.ideas.length;
    onCount(reviewCount);
    return r;
  } catch { return null; }
}

function safeGmail(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'mail.google.com' ? u.href : null; } catch { return null; }
}

function input(name, value) {
  if (name === 'stage') return h('select', { name }, STAGES.map((s) => h('option', { value: s, selected: s === value }, s)));
  if (name === 'source') return h('select', { name }, SOURCES.map((s) => h('option', { value: s, selected: s === value }, s)));
  if (name === 'notes') return h('textarea', { name, rows: 2 }, value || '');
  const type = DATES.includes(name) ? 'date' : name === 'email' ? 'email' : 'text';
  return h('input', { name, type, value: value ?? '', inputmode: MONEY.includes(name) ? 'decimal' : null, autocapitalize: ['email', 'domain'].includes(name) ? 'off' : null });
}

function currentValue(p, name) {
  const d = !['payment', 'income'].includes(p.kind) && p.deal_id && deal(p.deal_id);
  if (!d || !(name in d)) return null;
  const v = d[name];
  return v == null ? '—' : MONEY.includes(name) ? fmtMoney(v) : DATES.includes(name) ? fmtDate(v, { year: true }) : String(v);
}

// Editable fields for a proposal; returns { el, values() }
function editor(p) {
  if (p.kind === 'income') {
    const v = p.proposed;
    const f = {
      month: h('input', { type: 'month', value: v.month || '' }),
      source: h('select', {}, INCOME_SOURCES_ENTERED.map((x) => h('option', { value: x, selected: x === v.source }, INCOME_LABELS[x]))),
      amount: h('input', { value: v.amount ?? '', inputmode: 'decimal' }),
      program: h('input', { value: v.program || '', placeholder: 'e.g. Migaku' }),
      notes: h('input', { value: v.notes || '' }),
    };
    const row = (label, el) => h('label', { class: 'crm-field' }, label, el);
    const d = p.deal_id && deal(p.deal_id);
    return {
      el: h('div', {},
        h('div', { class: 'crm-form-grid' }, row('Month', f.month), row('Source', f.source), row('Amount ($)', f.amount), row('Program', f.program), row('Notes', f.notes)),
        h('p', { class: 'crm-field-hint' }, `Added to that month’s ${INCOME_LABELS[v.source] || 'income'} total.${d ? ` Replaces the deal “${dealTitle(d)}”, which is archived when you pass this.` : ''}`)),
      values: () => ({
        month: f.month.value, source: f.source.value, amount: Number(f.amount.value.replace(/[$,\s]/g, '')),
        program: f.program.value.trim() || null, notes: f.notes.value.trim() || null,
      }),
    };
  }
  if (p.kind === 'new_company_deal') {
    const c = p.proposed.company || {};
    const ct = p.proposed.contact || {};
    const dl = p.proposed.deal || {};
    const f = {
      name: h('input', { value: c.name || '' }), domains: h('input', { value: (c.domains || []).join(', '), autocapitalize: 'off' }),
      category: h('input', { value: c.category || '', list: 'crm-cats' }), website: h('input', { value: c.website || '', autocapitalize: 'off' }),
      cname: h('input', { value: ct.name || '' }), cemail: h('input', { value: ct.email || '', type: 'email', autocapitalize: 'off' }), crole: h('input', { value: ct.role || '' }),
      package: h('input', { value: dl.package || '' }), replied_on: h('input', { type: 'date', value: dl.replied_on || '' }), notes: h('textarea', { rows: 2 }, dl.notes || ''),
      stage: input('stage', dl.stage || 'In conversation'), source: input('source', dl.source || 'Inbound'),
      quoted: h('input', { value: dl.quoted ?? '', inputmode: 'decimal' }),
      paid_amount: h('input', { value: dl.paid_amount ?? '', inputmode: 'decimal' }), paid_on: h('input', { type: 'date', value: dl.paid_on || '' }),
      paid_method: h('input', { value: dl.paid_method || '' }),
    };
    const row = (label, el) => h('label', { class: 'crm-field' }, label, el);
    return {
      el: h('div', { class: 'crm-form-grid' },
        row('Company', f.name), row('Email domains', f.domains), row('Category', f.category), row('Website', f.website),
        row('Contact name', f.cname), row('Contact email', f.cemail), row('Contact role', f.crole),
        row('Source', f.source), row('Stage', f.stage), row('Package', f.package), row('Replied on', f.replied_on), row('Quoted ($)', f.quoted),
        row('Amount paid ($)', f.paid_amount), row('Paid on', f.paid_on), row('Paid via', f.paid_method),
        h('label', { class: 'crm-field is-wide' }, 'Deal notes', f.notes)),
      values: () => {
        const nn = (v) => (v && v.trim() ? v.trim() : null);
        const money = (v) => (nn(v) ? Number(v.replace(/[$,\s]/g, '')) : null);
        const keep = Object.fromEntries(['fit', 'contact_method', 'form_url', 'notes'].filter((k) => c[k] != null).map((k) => [k, c[k]]));
        const out = { company: { ...keep, name: f.name.value.trim(), domains: f.domains.value.split(/[\s,;]+/).filter(Boolean) }, deal: { source: f.source.value, stage: f.stage.value } };
        if (money(f.quoted.value) != null) out.deal.quoted = money(f.quoted.value);
        if (money(f.paid_amount.value) != null) out.deal.paid_amount = money(f.paid_amount.value);
        if (nn(f.paid_on.value)) out.deal.paid_on = nn(f.paid_on.value);
        if (nn(f.paid_method.value)) out.deal.paid_method = nn(f.paid_method.value);
        if (nn(f.category.value)) out.company.category = nn(f.category.value);
        if (nn(f.website.value)) out.company.website = nn(f.website.value);
        if (nn(f.cname.value) || nn(f.cemail.value)) out.contact = { name: nn(f.cname.value), email: nn(f.cemail.value), role: nn(f.crole.value) };
        if (nn(f.package.value)) out.deal.package = nn(f.package.value);
        if (nn(f.replied_on.value)) out.deal.replied_on = nn(f.replied_on.value);
        if (nn(f.notes.value)) out.deal.notes = nn(f.notes.value);
        return out;
      },
    };
  }
  const inputs = {};
  const fields = Object.keys(p.proposed);
  const el = h('div', { class: 'crm-form-grid' }, fields.map((name) => {
    inputs[name] = input(name, p.proposed[name]);
    const now = currentValue(p, name);
    return h('label', { class: 'crm-field' }, FIELD_LABEL[name] || name, inputs[name], now != null ? h('span', { class: 'crm-field-hint' }, `Now: ${now}`) : null);
  }));
  return {
    el,
    values: () => Object.fromEntries(fields.map((name) => {
      const raw = inputs[name].value.trim();
      if (!raw) return [name, null];
      return [name, MONEY.includes(name) ? Number(raw.replace(/[$,\s]/g, '')) : raw];
    })),
  };
}

function proposalCard(p, { onDone, selected }) {
  const ed = editor(p);
  const ev = p.evidence || {};
  const link = ev.gmail_link && safeGmail(ev.gmail_link);
  const where = p.deal_id && deal(p.deal_id) ? dealTitle(deal(p.deal_id)) : p.company_id ? companyName(p.company_id) : (p.proposed.company && p.proposed.company.name) || '';
  const dismissReason = h('input', { type: 'text', placeholder: 'Why? (optional)', maxlength: 300, class: 'crm-dismiss-reason', hidden: true });
  const pass = button('Pass', async () => {
    try {
      await busy(pass, () => request('POST', `proposals/${p.id}/pass`, { values: ed.values() }));
      toast('Passed and applied', { kind: 'ok', ms: 3000 });
      onDone();
    } catch { /* toast shown */ }
  }, { kind: 'primary' });
  const dismiss = button('Dismiss', async () => {
    if (dismissReason.hidden) { dismissReason.hidden = false; dismissReason.focus(); dismiss.textContent = 'Confirm dismiss'; return; }
    try {
      await busy(dismiss, () => request('POST', `proposals/${p.id}/dismiss`, { reason: dismissReason.value.trim() || null }));
      toast('Dismissed');
      onDone();
    } catch { /* toast shown */ }
  });
  const low = LOW_RISK.includes(p.kind);
  const pick = BATCHABLE.includes(p.kind) ? h('label', { class: 'crm-check crm-batch-pick' }, h('input', { type: 'checkbox', checked: selected.has(p.id), onchange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); onDone({ selectionOnly: true }); } }), ' Select') : null;
  return h('article', { class: ['crm-review-card', `is-${p.confidence}`] },
    h('header', { class: 'crm-review-head' },
      h('div', {}, h('p', { class: 'crm-review-kind' }, KIND_LABEL[p.kind] || p.kind, low ? h('span', { class: 'crm-flag is-ok' }, 'Low risk') : null),
        h('h3', {}, where || '—')),
      h('span', { class: ['crm-conf', `is-${p.confidence}`] }, `${p.confidence} confidence`)),
    p.reason ? h('p', { class: 'crm-review-reason' }, p.reason) : null,
    h('div', { class: 'crm-evidence' },
      h('p', { class: 'crm-evidence-meta' }, [ev.email_date ? fmtDateTime(ev.email_date) : null, ev.subject].filter(Boolean).join(' · ') || 'No email evidence'),
      ev.quote ? h('blockquote', {}, ev.quote) : null,
      link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Gmail') : null),
    ed.el,
    h('div', { class: 'crm-row-actions' }, pass, dismiss, dismissReason, pick));
}

export function reviewView(root) {
  const selected = new Set();
  let data = null;
  const draw = () => {
    if (!data) { root.replaceChildren(h('p', { class: 'crm-note is-muted' }, 'Loading…')); return; }
    const reload2 = async (opts = {}) => { if (opts.selectionOnly) { draw(); return; } await load(); await reload(); };
    const lowIds = data.proposals.filter((p) => LOW_RISK.includes(p.kind)).map((p) => p.id);
    const incomeIds = data.proposals.filter((p) => p.kind === 'income').map((p) => p.id);
    [...selected].forEach((id) => { if (!lowIds.includes(id) && !incomeIds.includes(id)) selected.delete(id); });
    const batch = button(`Pass selected (${selected.size})`, async () => {
      const ids = [...selected];
      try {
        await busy(batch, async () => {
          let ok = 0; const errs = [];
          for (let i = 0; i < ids.length; i += 5) {
            const r = await request('POST', 'proposals/pass-batch', { ids: ids.slice(i, i + 5) });
            r.results.forEach((x) => (x.error ? errs.push(x.error) : ok++));
          }
          selected.clear();
          toast(`Passed ${ok}${errs.length ? `; ${errs.length} failed: ${errs[0]}` : ''}`, { kind: errs.length ? 'error' : 'ok', ms: 6000 });
        });
        await reload2();
      } catch { /* toast shown */ }
    }, { kind: 'primary', disabled: !selected.size });
    const selectAll = button('Select all low-risk', () => { lowIds.forEach((id) => selected.add(id)); draw(); }, { kind: 'chip' });
    const selectIncome = incomeIds.length ? button(`Select all income (${incomeIds.length})`, () => { incomeIds.forEach((id) => selected.add(id)); draw(); }, { kind: 'chip' }) : null;

    const suggestions = data.suggestions.map((it) => h('li', {},
      h('div', { class: 'crm-sugg-main' }, h('strong', {}, it.title), h('span', { class: 'crm-muted' }, ` · ${fmtDate(it.start.slice(0, 10), { year: true })}${it.start.length > 10 ? ` ${it.start.slice(11)}` : ''}`),
        it.suggestion_reason ? h('p', { class: 'crm-note' }, it.suggestion_reason) : null),
      h('div', { class: 'crm-row-actions' },
        button('Accept', async () => { try { await request('POST', `cal-items/${it.id}/accept`); toast('Added to the calendar', { kind: 'ok', ms: 2500 }); await reload2(); } catch (err) { toastError(err); } }, { kind: 'primary' }),
        button('Edit…', () => openCalItem({ ...it, all_day: it.all_day === 1, counts_hours: it.counts_hours === 1, hidden: it.hidden === 1 }, { onSaved: () => reload2() }), { kind: 'chip' }),
        button('Dismiss', async () => { try { await request('POST', `cal-items/${it.id}/dismiss`); toast('Dismissed'); await reload2(); } catch (err) { toastError(err); } }))));

    const ideas = data.ideas.map((idea) => h('li', {},
      h('div', { class: 'crm-sugg-main' }, h('strong', {}, idea.title),
        h('span', { class: 'crm-flag' }, { performance: 'From performance', sponsor_conversations: 'From sponsor emails', both: 'Performance + sponsors' }[idea.source] || idea.source),
        idea.why ? h('p', { class: 'crm-note' }, idea.why) : null,
        idea.evidence && idea.evidence.length ? h('ul', { class: 'crm-checks' }, idea.evidence.map((e) => h('li', {}, e))) : null),
      h('div', { class: 'crm-row-actions' },
        button('Add to Videos', async () => { try { await request('POST', `ideas/${idea.id}/keep`); toast('Added to Videos (no date yet)', { kind: 'ok', ms: 3000 }); await reload2(); } catch (err) { toastError(err); } }, { kind: 'primary' }),
        button('Dismiss', async () => { try { await request('POST', `ideas/${idea.id}/dismiss`); await reload2(); } catch (err) { toastError(err); } }))));

    const empty = !data.proposals.length && !data.suggestions.length && !data.ideas.length;
    root.replaceChildren(...[
      h('div', { class: 'crm-view-head' }, h('h1', { class: 'crm-view-title' }, 'Review', h('span', { class: 'crm-view-ja', lang: 'ja' }, '確認')),
        h('div', { class: 'crm-view-actions' }, button('Refresh', () => load(), { kind: 'chip' }))),
      h('p', { class: 'crm-note is-muted' }, 'What Claude filed from your email. Nothing changes until you pass it, and you can edit any value first.'),
      empty ? h('div', { class: 'crm-empty' }, h('p', {}, 'Nothing to review. Claude files proposals here when your scheduled tasks run.')) : null,
      data.proposals.length ? h('section', { class: 'crm-section' },
        h('div', { class: 'crm-section-head' }, h('h2', { class: 'crm-section-title' }, `Proposals (${data.proposals.length})`),
          lowIds.length || incomeIds.length ? h('div', { class: 'crm-row-actions' }, lowIds.length ? selectAll : null, selectIncome, batch) : null),
        h('div', { class: 'crm-review-list' }, data.proposals.map((p) => proposalCard(p, { onDone: reload2, selected })))) : null,
      data.suggestions.length ? h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, `Suggested tasks and events (${data.suggestions.length})`), h('ul', { class: 'crm-sugg-list' }, suggestions)) : null,
      data.ideas.length ? h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, `Video ideas (${data.ideas.length})`), h('ul', { class: 'crm-sugg-list' }, ideas)) : null,
      h('datalist', { id: 'crm-cats' }, (store.state.settings.categories || []).map((c) => h('option', { value: c })))].filter(Boolean));
  };
  async function load() {
    const r = await refreshReviewCount();
    if (r) data = r; else if (!data) data = { proposals: [], suggestions: [], ideas: [], insights: [] };
    draw();
  }
  draw();
  load();
  return () => draw();
}
