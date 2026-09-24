// cal-panel.js — the calendar item panel, the "this occurrence / whole
// series" question, and applying changes with undo.

import { h, fmtDate } from './dom.js';
import { request } from './api.js';
import { store, live, companyName, dealTitle, deal, company, video } from './store.js';
import { CAL_TYPES, CAL_TYPE_LABELS, CAL_KINDS, CAL_STATUSES, CAL_STATUS_LABELS, CAL_SOURCE_LABELS, WEEKDAYS } from './schema.js';
import { addMinutes, dateOf, timeOf, minutesBetween } from './calendar.js';
import { addDays, daysBetween } from './rules.js';
import { openPanel, closePanel, toast, toastError, button, busy } from './ui.js';
import { openDeal, openCompany, openVideo } from './panels.js';
import { invalidate } from './cal-view.js';

const KIND_LABELS = { meeting: 'Meeting', call: 'Call', filming: 'Filming', editing: 'Editing', publishing: 'Publishing', other: 'Other' };
const SERIES_KEYS = ['type', 'kind', 'title', 'notes', 'counts_hours', 'company_id', 'deal_id', 'video_id', 'checklist', 'hidden'];
const isPureOccurrence = (it) => it.series_id && it.occurrence && !it.exception;

// --- Scope question -------------------------------------------------------------------------
export function askScope(verb = 'Change') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'crm-dialog', 'aria-labelledby': 'crm-scope-title' });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('h2', { id: 'crm-scope-title' }, `${verb}: this one or the whole series?`),
      h('p', { class: 'crm-note' }, 'This item repeats.'),
      h('div', { class: 'crm-row-actions' },
        button('This occurrence', () => done('this'), { kind: 'primary' }),
        button('Whole series', () => done('series')),
        button('Cancel', () => done(null))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// --- Applying changes -------------------------------------------------------------------------
async function seriesOf(it) {
  const data = await request('GET', `calendar?from=${dateOf(it.start)}&to=${dateOf(it.start)}`);
  const s = data.series.find((x) => x.id === it.series_id);
  if (!s) throw new Error('That series no longer exists');
  return s;
}

// Map an occurrence change onto its series: shift dates, times and weekdays
function seriesPatch(it, s, changes) {
  const out = {};
  for (const k of SERIES_KEYS) if (k in changes) out[k] = changes[k];
  if (changes.status === 'cancelled') out.status = 'cancelled';
  if ('start' in changes) {
    const delta = daysBetween(it.original_date, dateOf(changes.start));
    if (delta) {
      out.dtstart = addDays(s.dtstart, delta);
      if (s.freq === 'weekly' && s.byday) {
        out.byday = s.byday.split(',').map((d) => WEEKDAYS[(((WEEKDAYS.indexOf(d) + delta) % 7) + 7) % 7]).join(',');
      }
    }
    const t = timeOf(changes.start);
    out.start_time = t;
    if (t) {
      const end = 'end' in changes ? changes.end : null;
      out.duration_min = end ? Math.max(15, minutesBetween(changes.start, end)) : (s.duration_min || 60);
    } else out.duration_min = null;
  }
  return out;
}

// Returns true when applied, false when the person backed out
export async function applyChange(it, changes, { verb = 'Saved', scope = null } = {}) {
  const keys = Object.keys(changes);
  let target = scope;
  if (isPureOccurrence(it) && !target) {
    const onlyThis = keys.every((k) => ['status', 'checklist'].includes(k)) && changes.status !== 'cancelled';
    target = onlyThis ? 'this' : await askScope(verb === 'Moved' ? 'Move' : verb === 'Cancelled' ? 'Cancel' : 'Change');
    if (!target) return false;
  }
  let undo;
  if (isPureOccurrence(it) && target === 'this') {
    const r = await request('PUT', `cal-series/${it.series_id}/occurrences/${it.original_date}`, changes);
    undo = () => request('DELETE', `cal-series/${it.series_id}/occurrences/${it.original_date}`);
    void r;
  } else if (it.series_id && target === 'series') {
    const s = await seriesOf(it);
    const patch = seriesPatch(it, s, changes);
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, s[k] ?? null]));
    await request('PATCH', `cal-series/${s.id}`, patch);
    undo = () => request('PATCH', `cal-series/${s.id}`, prev);
  } else {
    const prev = Object.fromEntries(keys.map((k) => [k, it[k] ?? null]));
    await request('PATCH', `cal-items/${it.id}`, changes);
    undo = () => request('PATCH', `cal-items/${it.id}`, prev);
  }
  invalidate();
  notify();
  toast(`${verb}${target === 'series' ? ' (whole series)' : ''}`, {
    action: 'Undo',
    onAction: async () => { try { await undo(); invalidate(); notify(); } catch (err) { toastError(err); } },
  });
  return true;
}

let listeners = [];
export function onCalendarChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; }
const notify = () => listeners.forEach((fn) => fn());

// --- Item panel ------------------------------------------------------------------------------------
const choice = (list, value, blank) => [blank ? h('option', { value: '' }, blank) : null,
  ...list.map(([v, l]) => h('option', { value: v, selected: v === value }, l))];

function field(label, input, { wide = false, hint } = {}) {
  return h('div', { class: ['crm-field', wide && 'is-wide'] }, h('label', {}, label, input), hint ? h('p', { class: 'crm-field-hint' }, hint) : null);
}

export function openCalItem(it, { preset = {}, onSaved } = {}) {
  const isNew = !it;
  const src = it ? it.source : 'me';
  const base = it || { type: 'task', status: 'not_started', checklist: [], counts_hours: false, ...preset };
  const startDate = dateOf(base.start) || new Date().toISOString().slice(0, 10);

  const title = h('input', { type: 'text', value: base.title || '', maxlength: 200, required: true });
  const type = h('select', {}, choice(CAL_TYPES.map((t) => [t, CAL_TYPE_LABELS[t]]), base.type));
  const kind = h('select', {}, choice(CAL_KINDS.map((k) => [k, KIND_LABELS[k]]), base.kind, '—'));
  const allDay = h('input', { type: 'checkbox', checked: base.all_day !== false && !timeOf(base.start) });
  const date = h('input', { type: 'date', value: startDate, required: true });
  const endDate = h('input', { type: 'date', value: base.all_day !== false && base.end ? dateOf(base.end) : '' });
  const t1 = h('input', { type: 'time', value: timeOf(base.start) || '20:00', step: 900 });
  const t2 = h('input', { type: 'time', value: timeOf(base.end) || (timeOf(base.start) ? timeOf(addMinutes(base.start, 60)) : '21:00'), step: 900 });
  const counts = h('input', { type: 'checkbox', checked: isNew ? base.type === 'event' : Boolean(base.counts_hours) });
  const notes = h('textarea', { rows: 3, maxlength: 5000 }, base.notes || '');
  const companySel = h('select', {}, choice(live(store.state.companies).sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name]), base.company_id, 'None'));
  const dealSel = h('select', {}, choice(live(store.state.deals).map((d) => [d.id, dealTitle(d)]).sort((a, b) => a[1].localeCompare(b[1])), base.deal_id, 'None'));
  const videoSel = h('select', {}, choice(live(store.state.videos).sort((a, b) => (a.publish_date || '').localeCompare(b.publish_date || '')).map((v) => [v.id, v.title]), base.video_id, 'None'));
  const repeat = h('select', {}, choice([['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']], 'none'));
  const until = h('input', { type: 'date' });

  // Checklist
  let checklist = (base.checklist || []).map((c) => ({ ...c }));
  const listEl = h('ul', { class: 'crm-checklist' });
  const drawList = () => listEl.replaceChildren(...checklist.map((c, i) => h('li', {},
    h('label', {}, h('input', {
      type: 'checkbox', checked: c.done, onchange: async (e) => {
        checklist[i].done = e.target.checked;
        if (!isNew) {
          try { await applyChange(it, { checklist }, { verb: 'Checklist updated', scope: isPureOccurrence(it) ? 'this' : null }); it.checklist = checklist.map((x) => ({ ...x })); onSaved && onSaved(); } catch (err) { toastError(err); }
        }
      },
    }), ' ', h('span', {}, c.text)),
    h('button', { type: 'button', class: 'crm-link-btn', 'aria-label': `Remove ${c.text}`, onclick: () => { checklist.splice(i, 1); drawList(); } }, 'Remove'))));
  drawList();
  const newCheck = h('input', { type: 'text', placeholder: 'Add a checklist item', maxlength: 300, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } } });
  const addCheck = () => { const t = newCheck.value.trim(); if (!t) return; checklist.push({ text: t, done: false }); newCheck.value = ''; drawList(); };

  // Keyboard-friendly moves
  const shiftDays = (n) => { date.value = addDays(date.value, n); if (endDate.value) endDate.value = addDays(endDate.value, n); };
  const shiftMins = (n) => {
    if (allDay.checked) return;
    const s = addMinutes(`${date.value}T${t1.value}`, n);
    const e = addMinutes(`${date.value}T${t2.value}`, n);
    date.value = dateOf(s); t1.value = timeOf(s); t2.value = timeOf(e);
  };
  const moveRow = h('div', { class: 'crm-move', role: 'group', 'aria-label': 'Move' },
    h('span', { class: 'crm-quick-label' }, 'Move'),
    button('− 1 day', () => shiftDays(-1), { kind: 'chip' }), button('+ 1 day', () => shiftDays(1), { kind: 'chip' }),
    button('− 30 min', () => shiftMins(-30), { kind: 'chip' }), button('+ 30 min', () => shiftMins(30), { kind: 'chip' }));

  const timeRow = h('div', { class: 'crm-form-grid' });
  const drawTimes = () => {
    timeRow.replaceChildren(...[
      field('Date', date),
      allDay.checked ? field('Ends (optional)', endDate) : null,
      allDay.checked ? null : field('Starts', t1),
      allDay.checked ? null : field('Ends', t2)].filter(Boolean));
  };
  allDay.addEventListener('change', drawTimes);
  type.addEventListener('change', drawTimes);

  function values() {
    const v = {
      title: title.value.trim(), type: type.value, kind: type.value === 'event' ? (kind.value || null) : null,
      notes: notes.value.trim() || null, counts_hours: counts.checked, checklist,
      company_id: companySel.value || null, deal_id: dealSel.value || null, video_id: videoSel.value || null,
    };
    if (allDay.checked) {
      v.start = date.value;
      v.end = endDate.value && endDate.value > date.value ? endDate.value : null;
    } else {
      v.start = `${date.value}T${t1.value}`;
      let end = `${date.value}T${t2.value}`;
      if (end <= v.start) end = addMinutes(end, 24 * 60);    // runs past midnight
      v.end = end;
    }
    return v;
  }
  function changed(v) {
    const norm = (k, x) => (k === 'counts_hours' ? Boolean(x) : k === 'checklist' ? (x || []) : (x ?? null));
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (JSON.stringify(norm(k, val)) !== JSON.stringify(norm(k, base[k]))) out[k] = val;
    }
    return out;
  }

  const err = h('p', { class: 'crm-field-error', role: 'alert' });
  const save = button(isNew ? 'Create' : 'Save', async () => {
    const v = values();
    if (!v.title) { err.textContent = 'Give it a title.'; title.focus(); return; }
    err.textContent = '';
    try {
      await busy(save, async () => {
        if (isNew) {
          if (repeat.value === 'none') {
            await request('POST', 'cal-items', v);
          } else {
            const wd = WEEKDAYS[(new Date(`${date.value}T00:00:00Z`).getUTCDay() + 6) % 7];
            await request('POST', 'cal-series', {
              type: v.type, kind: v.kind, title: v.title, notes: v.notes, counts_hours: v.counts_hours, checklist: v.checklist,
              company_id: v.company_id, deal_id: v.deal_id, video_id: v.video_id,
              dtstart: date.value, start_time: allDay.checked ? null : t1.value,
              duration_min: allDay.checked ? null : Math.max(15, minutesBetween(v.start, v.end)),
              freq: repeat.value === 'biweekly' ? 'weekly' : repeat.value, interval: repeat.value === 'biweekly' ? 2 : 1,
              byday: ['weekly', 'biweekly'].includes(repeat.value) ? wd : null, until: until.value || null,
            });
          }
          invalidate(); notify();
          toast('Added to the calendar', { kind: 'ok', ms: 2500 });
          closePanel({ force: true });
        } else {
          const c = changed(v);
          if (!Object.keys(c).length) { closePanel({ force: true }); return; }
          const ok = await applyChange(it, c, { verb: 'Saved' });
          if (ok) closePanel({ force: true });
        }
      });
      onSaved && onSaved();
    } catch (ex) {
      err.textContent = ex.details && typeof ex.details === 'object' && !Array.isArray(ex.details) ? Object.values(ex.details).join(' ') : ex.message;
    }
  }, { kind: 'primary' });

  // Status: applies straight away on existing items
  const statusRow = h('div', { class: 'crm-status', role: 'group', 'aria-label': 'Status' },
    CAL_STATUSES.map((st) => h('button', {
      type: 'button', class: ['crm-status-btn', base.status === st && 'is-on'], 'aria-pressed': String(base.status === st),
      onclick: async () => {
        if (isNew) { base.status = st; statusRow.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b.textContent === CAL_STATUS_LABELS[st]); b.setAttribute('aria-pressed', String(b.textContent === CAL_STATUS_LABELS[st])); }); return; }
        try {
          const ok = await applyChange(it, { status: st }, { verb: st === 'cancelled' ? 'Cancelled' : `Marked ${CAL_STATUS_LABELS[st].toLowerCase()}` });
          if (ok) { closePanel({ force: true }); onSaved && onSaved(); }
        } catch (ex) { toastError(ex); }
      },
    }, CAL_STATUS_LABELS[st])));

  const links = [];
  if (base.deal_id && deal(base.deal_id)) links.push(button(`Deal: ${dealTitle(deal(base.deal_id))}`, () => openDeal(deal(base.deal_id)), { kind: 'chip' }));
  if (base.company_id && company(base.company_id)) links.push(button(`Company: ${companyName(base.company_id)}`, () => openCompany(company(base.company_id)), { kind: 'chip' }));
  if (base.video_id && video(base.video_id)) links.push(button(`Video: ${video(base.video_id).title}`, () => openVideo(video(base.video_id)), { kind: 'chip' }));

  const footer = [save];
  if (!isNew) {
    if (it.suggested === 1) {
      footer.push(button('Accept', async () => { try { await request('POST', `cal-items/${it.id}/accept`); invalidate(); notify(); closePanel({ force: true }); toast('Accepted', { kind: 'ok', ms: 2500 }); onSaved && onSaved(); } catch (ex) { toastError(ex); } }));
      footer.push(button('Dismiss', async () => {
        try { await request('POST', `cal-items/${it.id}/dismiss`); invalidate(); notify(); closePanel({ force: true }); toast('Dismissed'); onSaved && onSaved(); } catch (ex) { toastError(ex); }
      }));
    }
    const canDelete = src !== 'plan';
    footer.push(button(canDelete ? 'Delete' : (base.hidden ? 'Unhide' : 'Hide'), async () => {
      try {
        if (!canDelete) {
          const ok = await applyChange(it, { hidden: !base.hidden }, { verb: base.hidden ? 'Shown' : 'Hidden' });
          if (ok) { closePanel({ force: true }); onSaved && onSaved(); }
          return;
        }
        if (isPureOccurrence(it)) {
          const scope = await askScope('Delete');
          if (!scope) return;
          if (scope === 'this') {
            await applyChange(it, { status: 'cancelled' }, { verb: 'Cancelled', scope: 'this' });
          } else {
            if (!window.confirm('Delete every occurrence of this series? This can’t be undone.')) return;
            await request('DELETE', `cal-series/${it.series_id}`);
            invalidate(); notify();
            toast('Series deleted');
          }
        } else {
          const r = await request('DELETE', `cal-items/${it.id}`);
          invalidate(); notify();
          const { id, created_at: c1, updated_at: u1, series_id: sid, original_date: od, source, suggested, suggestion_reason: sr, plan_key: pk, ...copy } = r.item;
          void [id, c1, u1, sid, od, source, suggested, sr, pk];
          toast('Deleted', { action: 'Undo', onAction: async () => { try { await request('POST', 'cal-items', copy); invalidate(); notify(); } catch (ex) { toastError(ex); } } });
        }
        closePanel({ force: true });
        onSaved && onSaved();
      } catch (ex) { toastError(ex); }
    }));
  }
  footer.push(button('Close', () => closePanel()));

  const kindField = field('Event kind', kind);
  const body = [
    it && it.suggested === 1 ? h('p', { class: 'crm-note crm-suggested-note' }, 'Suggested by Claude', it.suggestion_reason ? `: ${it.suggestion_reason}` : '.', ' Accept, edit or dismiss it.') : null,
    links.length ? h('div', { class: 'crm-chip-row' }, links) : null,
    h('div', { class: 'crm-cal-status' }, h('span', { class: 'crm-quick-label' }, 'Status'), statusRow),
    h('div', { class: 'crm-form' },
      h('div', { class: 'crm-form-grid' }, field('Title', title, { wide: true }), field('Type', type), kindField),
      h('label', { class: 'crm-check' }, allDay, ' All day'),
      timeRow, moveRow,
      isNew ? h('div', { class: 'crm-form-grid' }, field('Repeat', repeat), field('Until (optional)', until)) : null,
      h('label', { class: 'crm-check' }, counts, ' Counts toward channel hours'),
      h('fieldset', { class: 'crm-fieldset' }, h('legend', {}, 'Checklist'), listEl, h('div', { class: 'crm-add-row' }, newCheck, button('Add', addCheck, { kind: 'chip' }))),
      h('fieldset', { class: 'crm-fieldset' }, h('legend', {}, 'Linked to'),
        h('div', { class: 'crm-form-grid' }, field('Company', companySel), field('Deal', dealSel), field('Video', videoSel, { wide: true }))),
      field('Notes', notes, { wide: true }),
      err),
  ];
  kindField.hidden = type.value !== 'event';
  type.addEventListener('change', () => { kindField.hidden = type.value !== 'event'; if (isNew) counts.checked = type.value === 'event'; });
  drawTimes();

  const sub = [CAL_SOURCE_LABELS[src], it && it.series_id ? 'repeats' : null, it && it.exception ? `changed occurrence (${fmtDate(it.original_date)})` : null].filter(Boolean).join(' · ');
  openPanel({
    label: isNew ? 'Calendar' : CAL_TYPE_LABELS[base.type],
    title: isNew ? 'New calendar item' : base.title,
    subtitle: sub,
    body,
    footer,
    isDirty: () => !isNew && Object.keys(changed(values())).filter((k) => k !== 'checklist').length > 0,
  });
}

// Rule items are computed from deals and payments; open the source instead
export function openRuleItem(it) {
  const d = it.deal_id && deal(it.deal_id);
  openPanel({
    label: 'Rules (automatic)',
    title: it.title,
    subtitle: fmtDate(it.start, { year: true }) + (it.overdue ? ' · overdue' : ''),
    body: [
      it.notes ? h('p', { class: 'crm-note' }, it.notes) : null,
      h('p', { class: 'crm-note is-muted' }, 'This comes from the deal’s dates and stage. Update the deal and it moves or disappears.'),
    ],
    footer: [d ? button('Open the deal', () => openDeal(d), { kind: 'primary' }) : null, button('Close', () => closePanel())],
  });
}
