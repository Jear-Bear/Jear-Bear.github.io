// calendar.js — recurrence, rule-generated items and channel-hour capacity,
// shared by the app and the Worker. Times are wall-clock strings in the
// owner's time zone: 'YYYY-MM-DD' (all-day) or 'YYYY-MM-DDTHH:MM'.

import { WEEKDAYS, WON_STAGES } from './schema.js';
import { addDays, daysBetween, followUp, isOverdue, weekStart } from './rules.js';

export const DEFAULT_CAPACITY = { min: 10, max: 15 };
export const DEFAULT_JOB_HOURS = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };   // Mon–Fri
export const INVOICE_CHASE_DAYS = 30;
export const RECAP_DAYS = 30;

// --- Wall-time helpers -----------------------------------------------------------------
export const dateOf = (wall) => (wall ? wall.slice(0, 10) : null);
export const timeOf = (wall) => (wall && wall.length > 10 ? wall.slice(11, 16) : null);
export function addMinutes(wall, mins) {
  const d = new Date(`${wall.length > 10 ? wall : `${wall}T00:00`}:00Z`);
  return new Date(d.getTime() + mins * 60000).toISOString().slice(0, 16);
}
export function minutesBetween(a, b) {
  return Math.round((new Date(`${b}:00Z`) - new Date(`${a}:00Z`)) / 60000);
}
const dow = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;   // 0 = Monday
const parseJson = (v, fallback) => { if (v == null) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };

// --- Recurrence -------------------------------------------------------------------------
// Dates (inclusive range) on which a series occurs
export function seriesDates(s, from, to) {
  const out = [];
  const start = s.dtstart;
  const last = s.until && s.until < to ? s.until : to;
  if (last < start || last < from) return out;
  const step = Math.max(1, s.interval || 1);
  if (s.freq === 'daily') {
    let k = Math.max(0, Math.ceil(daysBetween(start, from) / step));
    for (let d = addDays(start, k * step); d <= last && out.length < 1000; k++, d = addDays(start, k * step)) out.push(d);
  } else if (s.freq === 'weekly') {
    const days = (s.byday ? s.byday.split(',') : [WEEKDAYS[dow(start)]]).map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0).sort();
    const anchor = weekStart(start);
    let w = Math.max(0, Math.floor(daysBetween(anchor, weekStart(from)) / 7 / step));
    for (; out.length < 1000; w++) {
      const ws = addDays(anchor, w * 7 * step);
      if (ws > last) break;
      for (const i of days) {
        const d = addDays(ws, i);
        if (d >= start && d >= from && d <= last) out.push(d);
      }
    }
  } else if (s.freq === 'monthly') {
    const day = +start.slice(8, 10);
    let y = +start.slice(0, 4);
    let m = +start.slice(5, 7) - 1;
    for (let i = 0; i < 400; i++, m += step) {
      const yy = y + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      const iso = `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso > last) break;
      const valid = new Date(`${iso}T00:00:00Z`).getUTCMonth() === mm;
      if (valid && iso >= from && iso >= start) out.push(iso);
    }
    void y;
  }
  return out;
}

const SHARED = ['type', 'kind', 'title', 'notes', 'source', 'counts_hours', 'company_id', 'deal_id', 'video_id', 'checklist', 'hidden'];

export function occurrence(s, date) {
  const o = { id: `${s.id}::${date}`, series_id: s.id, original_date: date, occurrence: true, status: s.status === 'cancelled' ? 'cancelled' : 'not_started', suggested: 0 };
  SHARED.forEach((k) => { o[k] = s[k]; });
  if (s.start_time) {
    o.start = `${date}T${s.start_time}`;
    o.end = addMinutes(o.start, s.duration_min || 60);
    o.all_day = false;
  } else {
    o.start = date;
    o.end = null;
    o.all_day = true;
  }
  o.checklist = parseJson(o.checklist, []);
  return o;
}

// Every item visible between from and to (inclusive dates): one-off items,
// series occurrences, and exceptions standing in for their occurrence.
export function expand({ items, series }, from, to) {
  const out = [];
  const exceptions = new Map();
  for (const it of items) {
    if (it.series_id) exceptions.set(`${it.series_id}::${it.original_date}`, it);
  }
  const inRange = (it) => {
    const s = dateOf(it.start);
    const e = it.end ? dateOf(it.end) : s;
    return s <= to && e >= from;
  };
  for (const it of items) {
    if (!it.series_id && inRange(it)) out.push({ ...it, checklist: parseJson(it.checklist, []) });
  }
  for (const s of series) {
    // Exceptions whose occurrence moved into or out of the range: scan a margin
    const dates = seriesDates(s, addDays(from, -31), addDays(to, 31));
    for (const d of dates) {
      const ex = exceptions.get(`${s.id}::${d}`);
      const it = ex ? { ...ex, checklist: parseJson(ex.checklist, []), occurrence: true, exception: true } : occurrence(s, d);
      if (s.status === 'cancelled' && !ex) it.status = 'cancelled';
      if (inRange(it)) out.push(it);
    }
  }
  return out;
}

// --- Rule-generated items (never stored) --------------------------------------------------
export function ruleItems(state, from, to, today) {
  const companies = new Map(state.companies.map((c) => [c.id, c]));
  const name = (id) => (companies.get(id) || {}).name || 'Deal';
  const deals = state.deals.filter((d) => !d.archived);
  const out = [];
  const add = (it) => {
    if (it.start >= from && it.start <= to) out.push({ source: 'rules', all_day: true, status: 'not_started', type: 'task', counts_hours: false, ...it });
  };
  const onOrToday = (d) => (d < today ? today : d);

  for (const d of deals) {
    const fu = followUp(d, today);
    if (fu) {
      add({
        id: `rule:followup:${d.id}`, start: fu.isDue ? onOrToday(fu.due) : fu.due, deal_id: d.id, company_id: d.company_id,
        title: `${fu.label === 'Mark as No reply?' ? 'No reply yet' : fu.label} · ${name(d.company_id)}`, rule: 'followup', overdue: fu.due < today,
        notes: fu.label === 'Mark as No reply?' ? 'Two follow-ups and no answer: mark it No reply.' : `Due ${fu.due}, ${fu.step === 1 ? 4 : 10} days after pitching.`,
      });
    }
    // The next action often is the follow-up; don't show it twice
    const sameAsFollowUp = fu && d.next_action_date === fu.due;
    if (d.next_action_date && !sameAsFollowUp && !['Paid', 'Lost', 'No reply'].includes(d.stage)) {
      const overdue = isOverdue(d, today);
      add({
        id: `rule:next:${d.id}`, start: overdue ? today : d.next_action_date, deal_id: d.id, company_id: d.company_id,
        title: `${d.next_action || 'Next action'} · ${name(d.company_id)}`, rule: 'next', overdue,
        notes: overdue ? `Was due ${d.next_action_date}.` : null,
      });
    }
    if (WON_STAGES.includes(d.stage) && d.publish_date) {
      if (d.stage === 'Won') {
        add({
          id: `rule:deliver:${d.id}`, type: 'deliverable', start: d.publish_date, deal_id: d.id, company_id: d.company_id, video_id: d.video_id || null,
          title: `Publish with ${name(d.company_id)}`, rule: 'deliver', overdue: d.publish_date < today,
          notes: d.deliverables || 'Sponsor deliverable deadline.',
        });
      } else {
        const recap = addDays(d.publish_date, RECAP_DAYS);
        add({ id: `rule:recap:${d.id}`, start: recap, deal_id: d.id, company_id: d.company_id, title: `Results recap · ${name(d.company_id)}`, rule: 'recap', notes: 'Send the 30-day results recap with a renewal offer.' });
      }
    }
  }
  // Contract dates: script and draft deadlines while the deal is live, and
  // when exclusivity and usage rights end
  for (const d of deals.filter((x) => !['Lost', 'No reply'].includes(x.stage))) {
    const working = ['Negotiating', 'Won'].includes(d.stage);
    if (working && d.script_due) add({ id: `rule:script:${d.id}`, type: 'deliverable', start: d.script_due < today ? today : d.script_due, deal_id: d.id, company_id: d.company_id, title: `Script due · ${name(d.company_id)}`, rule: 'script', overdue: d.script_due < today, notes: `Due ${d.script_due}.` });
    if (working && d.draft_due) add({ id: `rule:draft:${d.id}`, type: 'deliverable', start: d.draft_due < today ? today : d.draft_due, deal_id: d.id, company_id: d.company_id, title: `Draft due · ${name(d.company_id)}`, rule: 'draft', overdue: d.draft_due < today, notes: `Due ${d.draft_due}.` });
    if (d.exclusivity_until) add({ id: `rule:excl:${d.id}`, start: d.exclusivity_until, deal_id: d.id, company_id: d.company_id, title: `Exclusivity ends · ${name(d.company_id)}`, rule: 'exclusivity', notes: 'After today you can pitch their competitors.' });
    if (d.usage_until) add({ id: `rule:usage:${d.id}`, start: d.usage_until, deal_id: d.id, company_id: d.company_id, title: `Usage rights end · ${name(d.company_id)}`, rule: 'usage', notes: 'Their right to use your footage ends. Offer a paid extension if they still use it.' });
  }

  const paid = new Set();
  for (const p of state.payments.filter((x) => !x.archived)) {
    if (p.invoiced_on || p.paid_on) paid.add(p.deal_id);
    if (p.invoiced_on && !p.paid_on) {
      const chase = addDays(p.invoiced_on, INVOICE_CHASE_DAYS);
      const d = deals.find((x) => x.id === p.deal_id) || {};
      add({ id: `rule:chase:${p.id}`, start: onOrToday(chase), deal_id: p.deal_id, company_id: d.company_id, title: `Chase invoice · ${name(d.company_id)}`, rule: 'chase', overdue: chase < today, notes: `Invoiced ${p.invoiced_on}, unpaid.` });
    }
  }
  for (const d of deals.filter((x) => x.stage === 'Delivered' && !paid.has(x.id))) {
    add({ id: `rule:invoice:${d.id}`, start: today, deal_id: d.id, company_id: d.company_id, title: `Send invoice · ${name(d.company_id)}`, rule: 'invoice' });
  }
  return out;
}

// --- Capacity ------------------------------------------------------------------------------
const COUNTED = (it) => it.counts_hours && !it.all_day && it.end && !it.hidden && !it.suggested
  && it.status !== 'cancelled' && it.status !== 'skipped';

// Scheduled channel hours in the week starting ws (Monday)
export function weekHours(items, ws) {
  const we = addDays(ws, 7);
  let mins = 0;
  for (const it of items.filter(COUNTED)) {
    const d = dateOf(it.start);
    if (d >= ws && d < we) mins += Math.max(0, minutesBetween(it.start, it.end));
  }
  return Math.round((mins / 60) * 10) / 10;
}

export function capacityState(hours, cap = DEFAULT_CAPACITY) {
  if (hours > cap.max) return 'over';
  if (hours < cap.min) return 'under';
  return 'ok';
}
