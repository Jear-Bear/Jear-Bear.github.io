// cal-view.js — the calendar (FullCalendar 7 standard, MIT, vendored).
// Month, week, day and agenda views in the owner's time zone; drag to move,
// drag an edge to resize (long-press on touch), undo after every change.

import { h } from './dom.js';
import { request } from './api.js';
import { store } from './store.js';
import { expand, ruleItems, weekHours, capacityState, dateOf, DEFAULT_CAPACITY, DEFAULT_JOB_HOURS } from './calendar.js';
import { addDays, weekStart, todayIn, daysBetween } from './rules.js';
import { openCalItem, openRuleItem, askScope, applyChange, onCalendarChange } from './cal-panel.js';
import { toastError } from './ui.js';

const VENDOR = new URL('../../vendor/fullcalendar/', import.meta.url).href;
const PREF_KEY = 'crm.calendar';
let libPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load the calendar'));
    document.head.append(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href }));
}
function loadLib() {
  if (!libPromise) {
    loadCss(`${VENDOR}skeleton.css`);
    loadCss(`${VENDOR}theme-classic.css`);
    libPromise = (window.Temporal ? Promise.resolve() : loadScript(`${VENDOR}temporal-polyfill.min.js`))
      .then(() => loadScript(`${VENDOR}fullcalendar.min.js`))
      .then(() => loadScript(`${VENDOR}theme-classic.min.js`))
      .then(() => window.FullCalendar)
      .catch((err) => { libPromise = null; throw err; });
  }
  return libPromise;
}

const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } };
if (!prefs.sources) prefs.sources = { plan: true, rules: true, claude: true, me: true };

// --- Data for a range ---------------------------------------------------------------
const cache = { from: null, to: null, data: null };

export async function fetchRange(from, to, { force = false } = {}) {
  if (!force && cache.data && cache.from <= from && cache.to >= to) return cache.data;
  // Fetch a padded window so small navigation doesn't refetch
  const f = addDays(from, -14);
  const t = addDays(to, 14);
  const data = await request('GET', `calendar?from=${f}&to=${t}`);
  Object.assign(cache, { from: f, to: t, data });
  return data;
}
export const invalidate = () => { cache.data = null; };

// Any change (including undo from a toast) refetches the visible calendar
let activeCal = null;
onCalendarChange(() => { invalidate(); if (activeCal && document.contains(activeCal.el)) activeCal.cal.refetchEvents(); });

const SOURCE_COLOR = { plan: '#95483f', me: '#1f1c18', claude: '#6a4c93', rules: '#9c4f12' };

function toEvent(it) {
  const classes = ['crm-ev', `src-${it.source}`, `st-${it.status}`, `ty-${it.type}`];
  if (it.suggested === 1) classes.push('is-suggested');
  if (it.overdue) classes.push('is-overdue');
  if (it.occurrence) classes.push('is-recurring');
  const allDay = Boolean(it.all_day);
  let end = it.end || undefined;
  if (allDay && end) end = addDays(dateOf(end), 1);      // FullCalendar's all-day end is exclusive
  const movable = it.source !== 'rules';
  return {
    id: it.id,
    title: `${it.status === 'done' ? '✓ ' : ''}${it.title}`,
    start: it.start,
    end,
    allDay,
    className: classes.join(' '),
    color: SOURCE_COLOR[it.source] || SOURCE_COLOR.me,
    contrastColor: '#f9f6ef',
    editable: movable,
    durationEditable: movable && !(allDay && it.type !== 'event'),
    extendedProps: { item: it },
  };
}

function jobEvents(from, to, job) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (job.days.includes(wd)) out.push({ id: `job:${d}`, start: `${d}T${job.start}`, end: `${d}T${job.end}`, display: 'background', className: 'crm-job', title: 'Day job' });
  }
  return out;
}

// Visible items for a range, filtered by the source toggles
export function itemsFor(data, from, to) {
  const t = todayIn(store.state.settings.tz);
  const all = [...expand(data, from, to), ...ruleItems(store.state, from, to, t)];
  return all.filter((it) => prefs.sources[it.source] !== false && (prefs.showHidden || !it.hidden) && !(it.suggested === 2)
    && (prefs.showCancelled !== false || it.status !== 'cancelled'));
}

// --- The view ---------------------------------------------------------------------------
export function calendarView(root) {
  const s = store.state.settings;
  const capacity = s.capacity || DEFAULT_CAPACITY;
  const job = s.jobHours || DEFAULT_JOB_HOURS;
  const calEl = h('div', { class: 'crm-cal' });
  const capEl = h('div', { class: 'crm-cap', 'aria-live': 'polite' });
  let cal = null;

  const chips = h('div', { class: 'crm-cal-filters', role: 'group', 'aria-label': 'Show' },
    ['plan', 'rules', 'claude', 'me'].map((src) => h('label', { class: ['crm-src-chip', `src-${src}`] },
      h('input', { type: 'checkbox', checked: prefs.sources[src] !== false, onchange: (e) => { prefs.sources[src] = e.target.checked; savePrefs(); cal && cal.refetchEvents(); } }),
      h('span', { class: 'crm-src-swatch', 'aria-hidden': 'true' }),
      { plan: 'Plan', rules: 'Rules', claude: 'Claude', me: 'Me' }[src])),
    h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: prefs.showCancelled !== false, onchange: (e) => { prefs.showCancelled = e.target.checked; savePrefs(); cal && cal.refetchEvents(); } }), ' Cancelled'),
    h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: Boolean(prefs.showHidden), onchange: (e) => { prefs.showHidden = e.target.checked; savePrefs(); cal && cal.refetchEvents(); } }), ' Hidden'));

  const newBtn = h('button', { type: 'button', class: 'crm-btn is-primary', onclick: () => openCalItem(null, { preset: { start: todayIn(s.tz), type: 'task' }, onSaved: refresh }) }, 'New item');

  root.replaceChildren(
    h('div', { class: 'crm-view-head' },
      h('h1', { class: 'crm-view-title' }, 'Calendar', h('span', { class: 'crm-view-ja', lang: 'ja' }, '予定')),
      h('div', { class: 'crm-view-actions' }, newBtn)),
    capEl, chips, calEl,
    h('p', { class: 'crm-note is-muted crm-cal-help' }, 'Drag to move, drag an edge to change the length (long-press first on a phone). Open an item for dates, times and a keyboard-friendly move. Shaded hours are the day job.'));

  function renderCapacity(items, ws) {
    const hours = weekHours(items, ws);
    const state = capacityState(hours, capacity);
    const fill = h('span', { class: 'crm-cap-fill' });
    fill.style.width = `${Math.min(100, (hours / (capacity.max * 1.2)) * 100)}%`;
    const band = h('span', { class: 'crm-cap-band' });
    band.style.left = `${(capacity.min / (capacity.max * 1.2)) * 100}%`;
    band.style.width = `${((capacity.max - capacity.min) / (capacity.max * 1.2)) * 100}%`;
    capEl.className = `crm-cap is-${state}`;
    capEl.replaceChildren(
      h('span', { class: 'crm-cap-label' }, `Channel hours, week of ${new Date(`${ws}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`),
      h('span', { class: 'crm-cap-bar', role: 'img', 'aria-label': `${hours} of ${capacity.min} to ${capacity.max} hours` }, band, fill),
      h('span', { class: 'crm-cap-value' }, `${hours} h`, h('span', { class: 'crm-muted' }, ` / ${capacity.min}–${capacity.max} h`)),
      ...(state === 'over' ? [h('span', { class: 'crm-cap-warn' }, `Overbooked by ${Math.round((hours - capacity.max) * 10) / 10} h. Move or cancel something.`)] : []));
  }

  async function refresh() {
    invalidate();
    if (cal) cal.refetchEvents();
  }

  // Apply a drag or resize, asking about the series when needed
  async function onMove(info) {
    const it = info.event.extendedProps.item;
    const startStr = info.event.startStr;
    const allDay = info.event.allDay;
    const newStart = allDay ? startStr.slice(0, 10) : startStr.slice(0, 16);
    let newEnd = null;
    if (info.event.endStr) newEnd = allDay ? addDays(info.event.endStr.slice(0, 10), -1) : info.event.endStr.slice(0, 16);
    if (allDay && newEnd === newStart) newEnd = null;
    if (!allDay && !newEnd) newEnd = null;
    try {
      const done = await applyChange(it, { start: newStart, end: newEnd }, { verb: 'Moved', askScope });
      if (!done) { info.revert(); return; }
      refresh();
    } catch (err) {
      info.revert();
      toastError(err);
    }
  }

  loadLib().then((FC) => {
    const phone = window.matchMedia('(max-width: 640px)').matches;
    cal = new FC.Calendar(calEl, {
      timeZone: s.tz,
      initialView: prefs.view || (phone ? 'listWeek' : 'timeGridWeek'),
      initialDate: prefs.date || undefined,
      firstDay: 1,
      headerToolbar: phone
        ? { start: 'prev,next today', center: '', end: 'title' }
        : { start: 'prev,next today', center: 'title', end: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
      footerToolbar: phone ? { center: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' } : false,
      buttons: { today: { text: 'Today' }, dayGridMonth: { text: 'Month' }, timeGridWeek: { text: 'Week' }, timeGridDay: { text: 'Day' }, listWeek: { text: 'Agenda' } },
      height: 'auto',
      nowIndicator: true,
      editable: true,
      eventResizableFromStart: true,
      slotEventOverlap: false,
      selectable: true,
      selectMirror: true,
      longPressDelay: 450,
      eventLongPressDelay: 450,
      selectLongPressDelay: 450,
      snapDuration: '00:15',
      slotDuration: '00:30',
      scrollTime: '17:00',
      slotMinTime: '06:00',
      slotMaxTime: '24:00',
      dayMaxEvents: 4,
      allDayText: 'All day',
      navLinks: true,
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
      events: async (info, success, failure) => {
        try {
          const from = info.startStr.slice(0, 10);
          const to = addDays(info.endStr.slice(0, 10), -1);
          const data = await fetchRange(from, to);
          const items = itemsFor(data, from, to);
          const ws = weekStart(daysBetween(from, to) > 7 ? todayIn(s.tz) : from);
          renderCapacity(itemsFor(data, ws, addDays(ws, 6)), ws);
          success([...items.map(toEvent), ...jobEvents(from, to, job)]);
        } catch (err) { failure(err); toastError(err); }
      },
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        const it = info.event.extendedProps.item;
        if (!it) return;
        if (it.source === 'rules') openRuleItem(it);
        else openCalItem(it, { onSaved: refresh });
      },
      select: (info) => {
        const allDay = info.allDay;
        const start = allDay ? info.startStr.slice(0, 10) : info.startStr.slice(0, 16);
        const end = allDay ? addDays(info.endStr.slice(0, 10), -1) : info.endStr.slice(0, 16);
        cal.unselect();
        openCalItem(null, { preset: { type: allDay ? 'task' : 'event', kind: allDay ? null : 'other', start, end: allDay && end === start ? null : end }, onSaved: refresh });
      },
      eventDrop: onMove,
      eventResize: onMove,
      datesSet: (info) => {
        prefs.view = info.view.type;
        prefs.date = info.view.currentStart ? info.startStr.slice(0, 10) : undefined;
        savePrefs();
      },
    });
    cal.render();
    activeCal = { cal, el: calEl };
  }).catch((err) => {
    calEl.replaceChildren(h('p', { class: 'crm-note is-error' }, err.message));
  });

  return () => { refresh(); };
}

