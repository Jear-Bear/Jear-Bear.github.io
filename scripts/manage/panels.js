// panels.js — detail editors for every record type, opened in the side panel.

import { h, fmtDate, fmtDateTime, fmtMoney } from './dom.js';
import { api } from './api.js';
import { buildForm } from './form.js';
import { ENTITIES, STAGES, VIDEO_STATUS_LABELS, ACTIVITY_KINDS } from './schema.js';
import { addDays } from './rules.js';
import {
  store, reload, live, company, companyName, deal, dealTitle, video, today, followUp, priceCheck, videoStatus, dash,
} from './store.js';
import { openPanel, closePanel, toast, toastError, button, busy } from './ui.js';

const API_TYPE = { companies: 'companies', contacts: 'contacts', deals: 'deals', payments: 'payments', videos: 'videos', rate_card: 'rate-card', activities: 'activities' };
const byName = (a, b) => (a.label || '').localeCompare(b.label || '');

const companyChoices = () => live(store.state.companies).map((c) => ({ value: c.id, label: c.name })).sort(byName);
const contactChoices = (companyId) => live(store.state.contacts).filter((c) => !companyId || c.company_id === companyId)
  .map((c) => ({ value: c.id, label: [c.name, c.email].filter(Boolean).join(' · ') || 'Unnamed contact' })).sort(byName);
const videoChoices = () => live(store.state.videos)
  .sort((a, b) => (a.publish_date || '9999').localeCompare(b.publish_date || '9999'))
  .map((v) => ({ value: v.id, label: `${v.publish_date ? `${fmtDate(v.publish_date)} · ` : ''}${v.title}` }));
const dealChoices = () => live(store.state.deals).map((d) => ({ value: d.id, label: dealTitle(d) })).sort(byName);
const packageList = () => live(store.state.rateCard).map((r) => r.package);

// --- Generic editor -----------------------------------------------------------------
function editor({ type, record, sections, options, title, label, subtitle, before, after, preset, reopen }) {
  const isNew = !record;
  const form = buildForm(type, record || preset || null, sections, options, { onChange: (name) => onFieldChange && onFieldChange(name) });
  let onFieldChange = null;

  const save = button(isNew ? 'Create' : 'Save', async () => {
    const values = isNew
      ? Object.fromEntries(Object.entries(form.values()).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)))
      : form.values({ changedOnly: true });
    if (!isNew && !Object.keys(values).length) { closePanel({ force: true }); return; }
    try {
      const saved = await busy(save, () => (isNew ? api.create(API_TYPE[type], values) : api.update(API_TYPE[type], record.id, values)));
      await reload();
      toast(isNew ? `${ENTITIES[type].label} created` : 'Saved', { kind: 'ok', ms: 2500 });
      if (reopen) reopen(saved);
      else closePanel({ force: true });
    } catch (err) {
      if (err.details) form.showErrors(err.details);
    }
  }, { kind: 'primary', type: 'submit' });
  form.el.addEventListener('submit', (e) => { e.preventDefault(); save.click(); });

  const archive = !isNew && button(record.archived ? 'Restore' : 'Archive', async () => {
    const to = !record.archived;
    await busy(archive, () => api.archive(API_TYPE[type], record.id, to));
    await reload();
    closePanel({ force: true });
    toast(to ? `${ENTITIES[type].label} archived` : 'Restored', {
      action: to ? 'Undo' : null,
      onAction: async () => { try { await api.archive(API_TYPE[type], record.id, false); await reload(); } catch (err) { toastError(err); } },
    });
  });

  openPanel({
    label: label || ENTITIES[type].label,
    title: title || (isNew ? `New ${ENTITIES[type].label.toLowerCase()}` : ''),
    subtitle,
    isDirty: () => form.dirty(),
    body: [record && record.archived ? h('p', { class: 'crm-note is-muted' }, 'Archived. Restore it to use it again.') : null,
      before || null, form.el, after || null],
    footer: [save, archive || null, button('Cancel', () => closePanel())],
  });
  return { form, onChange: (fn) => { onFieldChange = fn; } };
}

// --- Timeline -------------------------------------------------------------------------
const KIND_LABEL = { note: 'Note', call: 'Call', meeting: 'Meeting', form: 'Form', email: 'Email', system: 'Update' };

function safeGmailLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'mail.google.com' ? u.href : null;
  } catch { return null; }
}

function activityItem(a, refresh) {
  const link = a.gmail_link && safeGmailLink(a.gmail_link);
  const hide = a.source !== 'system' && h('button', {
    type: 'button', class: 'crm-link-btn', onclick: async () => {
      try {
        await api.archive('activities', a.id, true);
        refresh();
        toast('Hidden from the timeline', { action: 'Undo', onAction: async () => { await api.archive('activities', a.id, false); refresh(); } });
      } catch (err) { toastError(err); }
    },
  }, 'Hide');
  return h('li', { class: ['crm-tl-item', `is-${a.kind}`, a.source === 'claude' && 'is-claude'] },
    h('div', { class: 'crm-tl-meta' },
      h('span', { class: 'crm-tl-kind' }, KIND_LABEL[a.kind] || a.kind),
      h('time', { datetime: a.occurred_at }, fmtDateTime(a.occurred_at)),
      a.source === 'claude' ? h('span', { class: 'crm-tl-src' }, 'logged by Claude') : null,
      hide || null),
    a.kind === 'email'
      ? [h('p', { class: 'crm-tl-title' }, a.direction === 'out' ? '→ ' : '← ', a.subject || '(no subject)'),
        h('p', { class: 'crm-tl-small' }, [a.email_from, a.email_to].filter(Boolean).join(' → ')),
        a.snippet ? h('p', { class: 'crm-tl-body' }, a.snippet) : null,
        a.claude_note ? h('p', { class: 'crm-tl-claude' }, h('span', {}, 'Claude’s note: '), a.claude_note) : null,
        link ? h('a', { class: 'crm-tl-link', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Gmail') : null]
      : [a.title ? h('p', { class: 'crm-tl-title' }, a.title) : null, a.body ? h('p', { class: 'crm-tl-body' }, a.body) : null]);
}

export function timeline({ company_id: companyId, deal_id: dealId }) {
  const list = h('ol', { class: 'crm-tl' }, h('li', { class: 'crm-note is-muted' }, 'Loading…'));
  const refresh = async () => {
    try {
      const items = await api.activities(dealId ? { deal_id: dealId } : { company_id: companyId });
      list.replaceChildren(...(items.length ? items.map((a) => activityItem(a, refresh)) : [h('li', { class: 'crm-note is-muted' }, 'Nothing logged yet.')]));
    } catch (err) { list.replaceChildren(h('li', { class: 'crm-note is-error' }, err.message)); }
  };

  const kind = h('select', { 'aria-label': 'Kind' }, ACTIVITY_KINDS.filter((k) => k !== 'system').map((k) => h('option', { value: k }, KIND_LABEL[k])));
  const title = h('input', { type: 'text', placeholder: 'Title (optional)', maxlength: 200, 'aria-label': 'Title' });
  const body = h('textarea', { rows: 2, placeholder: 'What happened?', maxlength: 5000, 'aria-label': 'Details' });
  const add = button('Log it', async () => {
    if (!title.value.trim() && !body.value.trim()) { body.focus(); return; }
    await busy(add, () => api.create('activities', {
      company_id: companyId || (deal(dealId) || {}).company_id, deal_id: dealId || null,
      kind: kind.value, title: title.value.trim() || null, body: body.value.trim() || null,
    }));
    title.value = ''; body.value = '';
    refresh();
  }, { kind: 'primary' });

  refresh();
  return h('section', { class: 'crm-section' },
    h('h3', { class: 'crm-section-title' }, 'Timeline'),
    h('div', { class: 'crm-composer' }, h('div', { class: 'crm-composer-row' }, kind, title), body, add),
    list);
}

// --- Deal -------------------------------------------------------------------------------
async function quick(d, changes, message) {
  const prev = Object.fromEntries(Object.keys(changes).map((k) => [k, d[k] ?? null]));
  try {
    await api.update('deals', d.id, changes);
    await reload();
    openDeal(deal(d.id));
    toast(message, { action: 'Undo', onAction: async () => { await api.update('deals', d.id, prev); await reload(); openDeal(deal(d.id)); } });
  } catch (err) { toastError(err); }
}

function dealQuickActions(d) {
  const t = today();
  const acts = [];
  if (d.stage === 'Researching') acts.push(['Pitched today', { stage: 'Pitched', pitched_on: d.pitched_on || t, next_action: 'Follow-up 1', next_action_date: addDays(d.pitched_on || t, 4) }, 'Marked as pitched']);
  if (d.stage === 'Pitched') acts.push(['Follow-up 1 sent', { stage: 'Follow-up 1 sent', next_action: 'Follow-up 2', next_action_date: d.pitched_on ? addDays(d.pitched_on, 10) : null }, 'Follow-up 1 logged']);
  if (d.stage === 'Follow-up 1 sent') acts.push(['Follow-up 2 sent', { stage: 'Follow-up 2 sent', next_action: 'Mark No reply if still silent', next_action_date: d.pitched_on ? addDays(d.pitched_on, 14) : null }, 'Follow-up 2 logged']);
  if (['Pitched', 'Follow-up 1 sent', 'Follow-up 2 sent', 'Researching'].includes(d.stage)) acts.push(['They replied', { stage: 'In conversation', replied_on: d.replied_on || t }, 'Reply logged']);
  if (d.stage === 'Follow-up 2 sent') acts.push(['No reply', { stage: 'No reply', next_action: null, next_action_date: null }, 'Marked No reply']);
  if (['In conversation', 'Negotiating'].includes(d.stage)) acts.push(['Won', { stage: 'Won' }, 'Marked as won']);
  if (d.stage === 'Won') acts.push(['Delivered', { stage: 'Delivered' }, 'Marked as delivered']);
  if (!acts.length) return null;
  return h('div', { class: 'crm-quick' }, h('span', { class: 'crm-quick-label' }, 'Quick'),
    acts.map(([label, changes, msg]) => button(label, () => quick(d, changes, msg), { kind: 'chip' })));
}

function dealStatus(d) {
  const lines = [];
  const fu = followUp(d, today());
  if (fu) lines.push(h('li', { class: fu.isDue ? 'is-due' : '' }, `${fu.label}: ${fmtDate(fu.due, { year: false })}${fu.isDue ? ' (due)' : ''}`));
  const p = priceCheck(d, store.state.rateCard);
  if (p) lines.push(h('li', { class: p.below ? 'is-bad' : 'is-ok' }, `${p.basis === 'final' ? 'Final' : 'Quote'} ${fmtMoney(p.amount)} vs floor ${fmtMoney(p.floor)}: ${p.below ? 'below floor. Cut deliverables, not price.' : 'OK'}`));
  const cs = ((dash() || {}).conflicts || []).filter((c) => c.dealIds.includes(d.id));
  cs.forEach((c) => lines.push(h('li', { class: c.severity === 'conflict' ? 'is-bad' : 'is-warn' }, c.message)));
  return lines.length ? h('ul', { class: 'crm-checks' }, lines) : null;
}

function dealPayments(d) {
  const pays = live(store.state.payments).filter((p) => p.deal_id === d.id);
  return h('section', { class: 'crm-section' },
    h('h3', { class: 'crm-section-title' }, 'Payments'),
    pays.length ? h('ul', { class: 'crm-mini-list' }, pays.map((p) => h('li', {},
      h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openPayment(p, { returnTo: () => openDeal(deal(d.id)) }) },
        h('span', {}, fmtMoney(p.amount, { cents: true })),
        h('span', { class: 'crm-muted' }, p.paid_on ? `Paid ${fmtDate(p.paid_on)}` : p.invoiced_on ? `Invoiced ${fmtDate(p.invoiced_on)}, unpaid` : 'Not invoiced'))))) : null,
    button('Add payment', () => openPayment(null, { preset: { deal_id: d.id, amount: d.final ?? d.quoted }, returnTo: () => openDeal(deal(d.id)) })));
}

export function openDeal(d, { preset } = {}) {
  const sections = [
    { title: 'Deal', fields: ['company_id', 'contact_id', 'stage', 'source', 'package'] },
    { title: 'Slot', fields: ['video_id', 'slot_note', 'publish_date'] },
    { title: 'Dates', fields: ['pitched_on', 'replied_on'] },
    { title: 'Money', fields: ['quoted', 'final'] },
    { title: 'Next step', fields: ['next_action', 'next_action_date'], wide: ['next_action'] },
    { title: 'Terms', fields: ['deliverables', 'usage_rights', 'exclusivity'] },
    { title: 'Notes', fields: ['lost_reason', 'notes'] },
  ];
  const companyId = d ? d.company_id : preset && preset.company_id;
  const options = {
    company_id: { choices: companyChoices() },
    contact_id: { choices: contactChoices(companyId), blankLabel: 'No contact' },
    video_id: { choices: videoChoices(), blankLabel: 'No video yet' },
    package: { datalist: packageList() },
    stage: { default: 'Researching' },
    slot_note: { hint: 'Free text when the video isn’t in Videos yet.' },
  };
  const ed = editor({
    type: 'deals', record: d, preset: { stage: 'Researching', ...(preset || {}) }, sections, options,
    title: d ? companyName(d.company_id) : 'New deal',
    subtitle: d ? [d.stage, d.package].filter(Boolean).join(' · ') : null,
    before: d ? [dealQuickActions(d), dealStatus(d)] : null,
    after: d ? [dealPayments(d), timeline({ deal_id: d.id })] : null,
    reopen: (saved) => openDeal(deal(saved.id)),
  });
  ed.onChange((name) => {
    if (name !== 'company_id') return;
    const sel = ed.form.inputs.contact_id;
    const cid = ed.form.inputs.company_id.value;
    sel.replaceChildren(h('option', { value: '' }, 'No contact'), ...contactChoices(cid).map((c) => h('option', { value: c.value }, c.label)));
  });
}

// --- Company ------------------------------------------------------------------------------
export function openCompany(c) {
  const sections = [
    { fields: ['name', 'category', 'fit', 'domains'] },
    { title: 'How to reach them', fields: ['contact_method', 'website', 'form_url'] },
    { fields: ['notes'] },
  ];
  const options = {
    category: { datalist: store.state.settings.categories },
    domains: { hint: 'Emails from these domains get matched to this company.' },
    contact_method: { labels: { email: 'Email', form: 'Web form' } },
  };
  let after = null;
  if (c) {
    const contacts = live(store.state.contacts).filter((x) => x.company_id === c.id);
    const deals = live(store.state.deals).filter((x) => x.company_id === c.id);
    const back = () => openCompany(company(c.id));
    after = [
      h('section', { class: 'crm-section' },
        h('h3', { class: 'crm-section-title' }, 'Contacts'),
        contacts.length ? h('ul', { class: 'crm-mini-list' }, contacts.map((x) => h('li', {},
          h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openContact(x, { returnTo: back }) },
            h('span', {}, x.name || 'Unnamed'), h('span', { class: 'crm-muted' }, [x.role, x.email].filter(Boolean).join(' · ')))))) : null,
        button('Add contact', () => openContact(null, { preset: { company_id: c.id }, returnTo: back }))),
      h('section', { class: 'crm-section' },
        h('h3', { class: 'crm-section-title' }, 'Deals'),
        deals.length ? h('ul', { class: 'crm-mini-list' }, deals.map((x) => h('li', {},
          h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openDeal(x) },
            h('span', {}, x.slot_note || (x.video_id && (video(x.video_id) || {}).title) || x.package || 'Deal'),
            h('span', { class: 'crm-muted' }, x.stage))))) : null,
        button('New deal', () => openDeal(null, { preset: { company_id: c.id } }))),
      timeline({ company_id: c.id }),
    ];
  }
  editor({
    type: 'companies', record: c, sections, options,
    title: c ? c.name : 'New company', subtitle: c ? [c.category, c.fit && `${c.fit} fit`].filter(Boolean).join(' · ') : null,
    after, reopen: (saved) => openCompany(company(saved.id)),
  });
}

// --- Contact ------------------------------------------------------------------------------
export function openContact(x, { preset, returnTo } = {}) {
  editor({
    type: 'contacts', record: x, preset, sections: [{ fields: ['company_id', 'name', 'email', 'role', 'notes'] }],
    options: { company_id: { choices: companyChoices() } },
    title: x ? x.name || 'Contact' : 'New contact', subtitle: x ? companyName(x.company_id) : null,
    reopen: returnTo ? () => returnTo() : null,
  });
}

// --- Video --------------------------------------------------------------------------------
export function openVideo(v) {
  let before = null;
  if (v) {
    const eff = videoStatus(v, store.state.deals);
    const deals = live(store.state.deals).filter((d) => d.video_id === v.id);
    const cs = ((dash() || {}).conflicts || []).filter((c) => c.videoIds.includes(v.id));
    before = h('div', {},
      h('p', { class: 'crm-note' }, `Sponsor status: ${VIDEO_STATUS_LABELS[eff]}${eff !== (v.sponsor_status || 'open') ? ' (from its deals)' : ''}`),
      cs.length ? h('ul', { class: 'crm-checks' }, cs.map((c) => h('li', { class: c.severity === 'conflict' ? 'is-bad' : 'is-warn' }, c.message))) : null,
      deals.length ? h('ul', { class: 'crm-mini-list' }, deals.map((d) => h('li', {},
        h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openDeal(d) },
          h('span', {}, companyName(d.company_id)), h('span', { class: 'crm-muted' }, d.stage))))) : null);
  }
  editor({
    type: 'videos', record: v, preset: { sponsor_status: 'open', format: 'guide' },
    sections: [{ fields: ['title', 'publish_date', 'format', 'sponsor_status', 'youtube_id', 'view_estimate', 'notes'] }],
    options: {
      sponsor_status: { labels: VIDEO_STATUS_LABELS },
      format: { labels: { guide: 'Guide', milestone: 'Milestone update', story: 'Story', other: 'Other' } },
      youtube_id: { hint: 'The part after watch?v= (optional).' },
      view_estimate: { hint: 'Views you expect in the first 30 days. Sponsored videos that beat it count toward a rate raise.' },
    },
    title: v ? v.title : 'New video', subtitle: v && v.publish_date ? fmtDate(v.publish_date, { year: true }) : null,
    before, reopen: (saved) => openVideo(video(saved.id)),
  });
}

// --- Payment ------------------------------------------------------------------------------
export function openPayment(p, { preset, returnTo } = {}) {
  editor({
    type: 'payments', record: p, preset,
    sections: [{ fields: ['deal_id', 'amount', 'invoiced_on', 'paid_on', 'method', 'fees', 'net', 'notes'] }],
    options: { deal_id: { choices: dealChoices() }, net: { hint: 'Left blank, net = amount − fees.' }, method: { datalist: ['PayPal', 'Bank transfer', 'Wise', 'Stripe', 'Check'] } },
    title: p ? fmtMoney(p.amount, { cents: true }) : 'New payment', subtitle: p ? dealTitle(deal(p.deal_id) || {}) : null,
    reopen: returnTo ? () => returnTo() : null,
  });
}

// --- Rate card ----------------------------------------------------------------------------
export function openPackage(r) {
  editor({
    type: 'rate_card', record: r, label: 'Rate card',
    sections: [{ fields: ['package', 'standard', 'floor', 'sort', 'included', 'notes'] }],
    options: { floor: { hint: 'Private. Never shown outside this app.' } },
    title: r ? r.package : 'New package',
  });
}

export { STAGES };
