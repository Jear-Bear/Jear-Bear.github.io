// pitch-view.js — write a pitch (or recap) for a deal from your templates,
// filled with live numbers. Copy it, open it as a Gmail draft, or ask Claude
// to draft a personalized one on its next run. Nothing is ever sent from here.

import { h } from './dom.js';
import { request } from './api.js';
import { store, reload, companyName, dealTitle, today } from './store.js';
import { openPanel, closePanel, toast, toastError, button, busy } from './ui.js';
import { addDays } from './rules.js';
import { pitchValues, renderTemplate, templatesFrom, gmailComposeUrl } from './pitching.js';
import { insightData } from './insights-view.js';
import { copyText } from './growth.js';

let draftsCache = null;
export async function draftRequests({ force = false } = {}) {
  if (!force && draftsCache) return draftsCache;
  draftsCache = await request('GET', 'drafts');
  return draftsCache;
}

// Status line for Claude drafts on a deal (open or done)
export function draftStatus(d) {
  const el = h('div', { class: 'crm-drafts' });
  draftRequests().then((list) => {
    const mine = list.filter((r) => r.deal_id === d.id).slice(0, 3);
    el.replaceChildren(...mine.map((r) => h('p', { class: 'crm-note is-muted' },
      r.status === 'open' ? `Claude will draft the ${r.kind.replace('_', '-')} on its next run.` : r.status === 'done' ? `Claude drafted the ${r.kind.replace('_', '-')}: ${r.result || 'saved in Gmail drafts'}` : `Draft request cancelled.`,
      r.status === 'open' ? [' ', button('Cancel', async () => { try { await request('POST', `drafts/${r.id}/cancel`); draftsCache = null; toast('Cancelled'); el.replaceWith(draftStatus(d)); } catch (err) { toastError(err); } }, { kind: 'chip' })] : null)));
  }).catch(() => {});
  return el;
}

export async function askClaude(d, kind, notes, btn) {
  await busy(btn, () => request('POST', 'drafts', { kind, deal_id: d.id, notes: notes || null }));
  draftsCache = null;
  toast('Queued. Claude drafts it in Gmail on its next run (it never sends).', { kind: 'ok', ms: 5000 });
}

export async function openPitch(d, { returnTo } = {}) {
  let data = null;
  try { data = await insightData(); } catch { /* numbers fall back to placeholders */ }
  const templates = templatesFrom(store.state.settings);
  const vals = pitchValues(store.state, d, { channel: data && data.channel, daily: data ? data.daily : [], audience: data && data.audience, today: today() });
  let current = templates.find((t) => t.id === d.pitch_style || t.name === d.pitch_style) || templates[0];
  const to = h('input', { type: 'email', value: vals.to, placeholder: 'Their email' });
  const subject = h('input', {});
  const body = h('textarea', { rows: 16, class: 'crm-pitch-body' });
  const fill = () => { subject.value = renderTemplate(current.subject, vals); body.value = renderTemplate(current.body, vals); };
  fill();
  const pick = h('select', { onchange: (e) => { current = templates.find((t) => t.id === e.target.value); fill(); } },
    templates.map((t) => h('option', { value: t.id, selected: t.id === current.id }, t.name)));
  const left = () => (body.value.match(/\[[^\]\n]{2,80}\]/g) || []);
  const warn = h('p', { class: 'crm-note is-error', hidden: true });
  const check = () => { const l = left(); warn.hidden = !l.length; warn.textContent = l.length ? `Fill in before sending: ${l.join(', ')}` : ''; };
  body.addEventListener('input', check); check();
  const notes = h('input', { placeholder: 'Anything Claude should mention (optional)' });

  const markPitched = button('Mark as pitched', async () => {
    const t = today();
    await busy(markPitched, () => request('PATCH', `deals/${d.id}`, {
      stage: 'Pitched', pitched_on: d.pitched_on || t, pitch_style: current.name, next_action: 'Follow-up 1', next_action_date: addDays(d.pitched_on || t, 4),
    }));
    await reload();
    toast(`Marked as pitched (${current.name})`, { kind: 'ok', ms: 3000 });
    if (returnTo) returnTo(); else closePanel({ force: true });
  }, { kind: 'primary' });
  const claudeBtn = button('Ask Claude to draft it', () => askClaude(d, 'pitch', notes.value.trim(), claudeBtn).catch(() => {}));

  openPanel({
    label: 'Pitch', title: `Pitch ${companyName(d.company_id)}`, subtitle: dealTitle(d),
    body: h('div', { class: 'crm-pitch' },
      h('label', { class: 'crm-field' }, 'Template', pick),
      h('label', { class: 'crm-field' }, 'To', to),
      h('label', { class: 'crm-field' }, 'Subject', subject),
      h('label', { class: 'crm-field' }, 'Message', body), warn,
      h('div', { class: 'crm-row-actions' },
        button('Open in Gmail', () => { check(); window.open(gmailComposeUrl({ to: to.value, subject: subject.value, body: body.value }), '_blank', 'noopener'); }, { kind: 'chip' }),
        button('Copy', () => copyText(`Subject: ${subject.value}\n\n${body.value}`, 'Pitch copied'), { kind: 'chip' })),
      h('p', { class: 'crm-note is-muted' }, 'Gmail opens a draft; you send it. After sending, mark it as pitched so follow-ups and pitch stats track it.'),
      h('h3', { class: 'crm-subhead' }, 'Or let Claude write it'),
      h('p', { class: 'crm-note is-muted' }, 'Claude reads the brand and your template, saves a personalized draft in Gmail on its next run, and never sends.'),
      notes, h('div', { class: 'crm-row-actions' }, claudeBtn),
      draftStatus(d)),
    footer: h('div', { class: 'crm-row-actions' }, markPitched, button('Close', () => (returnTo ? returnTo() : closePanel()))),
  });
}
