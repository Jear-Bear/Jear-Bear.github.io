// growth.js — tracked sponsor links and invoices in the app.
// Links live at jareddesu.com/go/<slug> (the site's 404 page forwards them to
// the Worker, which counts the click and redirects). Invoices are payments
// with a number; printing uses the browser's "Save as PDF".

import { h, fmtDate, fmtMoney } from './dom.js';
import { request } from './api.js';
import { store, reload, live, companyName, dealTitle, video, today } from './store.js';
import { openPanel, closePanel, toast, button, busy } from './ui.js';
import { addDays } from './rules.js';

export const LINK_BASE = 'https://www.jareddesu.com/go/';
export const linkUrl = (slug) => `${LINK_BASE}${slug}`;

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'link';
}

// Clicks per link: total, last 7 and 30 days, and in a window after a date
export function clickStats(slug, { from, to } = {}) {
  const rows = (store.state.linkClicks || []).filter((r) => r.slug === slug);
  const t = today();
  const since = (n) => addDays(t, -n);
  const sumIf = (f) => rows.filter(f).reduce((s, r) => s + r.clicks, 0);
  return {
    total: sumIf(() => true),
    d7: sumIf((r) => r.day > since(7)),
    d30: sumIf((r) => r.day > since(30)),
    window: from ? sumIf((r) => r.day >= from && (!to || r.day <= to)) : null,
  };
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label, { kind: 'ok', ms: 1800 }); return true; } catch { return false; }
}

// --- Invoices -------------------------------------------------------------------------------
export function openInvoice(d, { returnTo } = {}) {
  const inv = store.state.settings.invoicing || {};
  const contact = d.contact_id && store.byId.contacts.get(d.contact_id);
  const co = store.byId.companies.get(d.company_id) || {};
  const v = d.video_id && video(d.video_id);
  const date = today();
  const f = {
    name: h('input', { value: co.name || '' }),
    contact: h('input', { value: contact ? contact.name || '' : '' }),
    email: h('input', { type: 'email', value: contact ? contact.email || '' : '' }),
    address: h('textarea', { rows: 2 }),
    date: h('input', { type: 'date', value: date }),
    due: h('input', { type: 'date', value: addDays(date, inv.termsDays ?? 30) }),
    notes: h('textarea', { rows: 2, placeholder: 'Optional, e.g. PO number' }),
  };
  const lines = [{ description: [d.package || 'Sponsored integration', v ? `“${v.title}”` : d.slot_note].filter(Boolean).join(' · '), amount: d.final ?? d.quoted ?? '' }];
  const linesEl = h('div', { class: 'crm-inv-lines' });
  const drawLines = () => linesEl.replaceChildren(...lines.map((l, i) => h('div', { class: 'crm-inv-line' },
    h('input', { value: l.description, 'aria-label': `Line ${i + 1} description`, oninput: (e) => { l.description = e.target.value; } }),
    h('input', { value: l.amount, inputmode: 'decimal', 'aria-label': `Line ${i + 1} amount`, oninput: (e) => { l.amount = e.target.value; } }),
    lines.length > 1 ? button('Remove', () => { lines.splice(i, 1); drawLines(); }, { kind: 'chip' }) : h('span'))),
  button('Add line', () => { lines.push({ description: '', amount: '' }); drawLines(); }, { kind: 'chip' }));
  drawLines();
  const row = (label, el, wide) => h('label', { class: ['crm-field', wide && 'is-wide'] }, label, el);
  const missing = !inv.name ? h('p', { class: 'crm-note is-error' }, 'Add your name and payment details under Settings → Invoices first, so they print on the invoice.') : null;
  const create = button('Create and print', async () => {
    const body = {
      deal_id: d.id, date: f.date.value, due: f.due.value || null, notes: f.notes.value.trim() || null,
      bill_to: { name: f.name.value.trim(), contact: f.contact.value.trim() || null, email: f.email.value.trim() || null, address: f.address.value.trim() || null },
      lines: lines.map((l) => ({ description: l.description.trim(), amount: Number(String(l.amount).replace(/[$,\s]/g, '')) })),
    };
    const pay = await busy(create, () => request('POST', 'invoices', body));
    await reload();
    toast(`Invoice ${pay.invoice_no} created`, { kind: 'ok', ms: 4000 });
    printInvoice(pay);
    if (returnTo) returnTo(); else closePanel({ force: true });
  }, { kind: 'primary' });
  openPanel({
    label: 'Invoice', title: `Invoice ${companyName(d.company_id)}`, subtitle: dealTitle(d),
    body: h('div', {}, missing,
      h('p', { class: 'crm-note is-muted' }, 'Creating the invoice numbers it, records it under Payments as invoiced, and opens the print dialog (choose “Save as PDF”).'),
      h('div', { class: 'crm-form-grid' }, row('Bill to', f.name), row('Contact', f.contact), row('Email', f.email), row('Address', f.address, true),
        row('Invoice date', f.date), row('Due', f.due)),
      h('h3', { class: 'crm-subhead' }, 'Lines'), linesEl, row('Notes', f.notes, true)),
    footer: h('div', { class: 'crm-row-actions' }, create, button('Cancel', () => (returnTo ? returnTo() : closePanel()))),
  });
}

export function printInvoice(p) {
  let inv = p.invoice;
  if (typeof inv === 'string') { try { inv = JSON.parse(inv); } catch { inv = null; } }
  if (!inv) { toast('This payment has no invoice to print', { kind: 'error' }); return; }
  const from = inv.from || {};
  const total = inv.lines.reduce((s, l) => s + l.amount, 0);
  const lines = (s) => String(s || '').split('\n').map((x, i) => [i ? h('br') : null, x]);
  const sheet = h('section', { class: 'crm-print', 'aria-hidden': 'true' },
    h('header', { class: 'crm-print-head' },
      h('div', {}, h('p', { class: 'crm-print-from' }, from.name || ''), h('p', {}, lines(from.address)), h('p', {}, from.email || '')),
      h('div', { class: 'crm-print-meta' }, h('h1', {}, 'Invoice'), h('p', {}, h('strong', {}, p.invoice_no)),
        h('p', {}, `Date: ${fmtDate(inv.date, { year: true })}`), inv.due ? h('p', {}, `Due: ${fmtDate(inv.due, { year: true })}`) : null)),
    h('div', { class: 'crm-print-to' }, h('p', { class: 'crm-print-label' }, 'Bill to'),
      h('p', {}, h('strong', {}, inv.bill_to.name)), inv.bill_to.contact ? h('p', {}, inv.bill_to.contact) : null,
      inv.bill_to.email ? h('p', {}, inv.bill_to.email) : null, inv.bill_to.address ? h('p', {}, lines(inv.bill_to.address)) : null),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Description'), h('th', { class: 'crm-num' }, 'Amount'))),
      h('tbody', {}, inv.lines.map((l) => h('tr', {}, h('td', {}, l.description), h('td', { class: 'crm-num' }, fmtMoney(l.amount, { cents: true }))))),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Total (USD)'), h('th', { class: 'crm-num' }, fmtMoney(total, { cents: true }))))),
    inv.payment ? h('div', { class: 'crm-print-pay' }, h('p', { class: 'crm-print-label' }, 'Payment'), h('p', {}, lines(inv.payment))) : null,
    inv.notes ? h('p', { class: 'crm-print-notes' }, inv.notes) : null);
  document.querySelectorAll('.crm-print').forEach((x) => x.remove());
  document.body.append(sheet);
  const done = () => { sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

// --- Links -----------------------------------------------------------------------------------
export function linkRow(l, { onOpen } = {}) {
  const st = clickStats(l.slug);
  return h('li', { class: 'crm-link-row' },
    h('button', { type: 'button', class: 'crm-row-btn', onclick: () => onOpen && onOpen(l) },
      h('span', {}, h('strong', {}, `/go/${l.slug}`), h('span', { class: 'crm-muted' }, ` → ${l.target.replace(/^https?:\/\//, '').slice(0, 48)}`)),
      h('span', { class: 'crm-muted crm-num' }, `${st.d30} in 30 days · ${st.total} total`)),
    button('Copy', () => copyText(linkUrl(l.slug), 'Link copied'), { kind: 'chip' }));
}

export function linksFor({ dealId, companyId } = {}) {
  return live(store.state.links || []).filter((l) => (dealId ? l.deal_id === dealId : true) && (companyId ? l.company_id === companyId : true));
}

