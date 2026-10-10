// browse.js — a sheet for finding a puzzle in a long history: a month calendar
// (default) or a list grouped by month, with an "unsolved only" filter.
// Used for past dailies (app.js), bonus puzzles and deck puzzles (deck.js).
//
// openBrowse({ title, items, onPick, start })
//   items: [{ date: 'YYYY-MM-DD', label, sub, done, some (partly done), locked, current }]
//   start: the date whose month opens first (default: the newest item)

import { lang, dateLocale } from '../games/i18n.js?v=1';

const T = {
  en: { calendar: 'Calendar', list: 'List', unsolved: 'Unsolved only', close: 'Close', none: 'Nothing here yet.', prev: 'Previous month', next: 'Next month', count: '{n} puzzles', solvedN: '{n} solved' },
  ja: { calendar: 'カレンダー', list: 'リスト', unsolved: '未クリアだけ', close: '閉じる', none: 'まだありません。', prev: '前の月', next: '次の月', count: '{n}個', solvedN: '{n}個クリア' },
};
const t = (k, v = {}) => String((T[lang()] || T.en)[k]).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const VIEW_KEY = 'jareddesu.crossword.browse';

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== '' && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthOf = (date) => date.slice(0, 7);
const monthName = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long' });
const dayName = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' });

export function openBrowse({ title, items, onPick, start }) {
  let view = 'calendar';
  try { view = localStorage.getItem(VIEW_KEY) || 'calendar'; } catch { /* private mode */ }
  let unsolved = false;
  const all = items.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const months = [...new Set(all.map((x) => monthOf(x.date)))];       // newest first
  let month = monthOf(start && months.includes(monthOf(start)) ? start : (all[0] || { date: new Date().toISOString() }).date);
  let day = null;

  const body = h('div', { class: 'cw-browse-body' });
  const overlay = h('div', { class: 'cw-overlay cw-browse' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const pick = (x) => { close(); onPick(x); };
  const shown = () => all.filter((x) => !unsolved || !x.done);

  const row = (x) => h('li', {}, h('button', { type: 'button', class: x.current ? 'is-on' : '', onclick: () => pick(x) },
    h('span', {}, x.label), h('span', { class: 'cw-date-done' }, x.locked ? '🔒' : x.sub || (x.done ? '✓' : ''))));

  function calendar() {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const byDay = new Map();
    shown().forEach((x) => { if (monthOf(x.date) === month) byDay.set(x.date, [...(byDay.get(x.date) || []), x]); });
    const i = months.indexOf(month);
    const older = months[i + 1];
    const newer = months[i - 1];
    const heads = Array.from({ length: 7 }, (_, d) => new Date(2026, 1, d + 1).toLocaleDateString(dateLocale(), { weekday: 'narrow' }));  // Feb 1 2026 is a Sunday
    const cells = [];
    for (let k = 0; k < first; k++) cells.push(h('span', { class: 'cw-cal-day is-blank' }));
    for (let d = 1; d <= days; d++) {
      const date = ymd(y, m - 1, d);
      const its = byDay.get(date) || [];
      if (!its.length) { cells.push(h('span', { class: 'cw-cal-day is-empty' }, d)); continue; }
      const done = its.every((x) => x.done);
      const some = its.some((x) => x.done || x.some);
      const locked = its.every((x) => x.locked);
      cells.push(h('button', {
        type: 'button',
        class: `cw-cal-day${done ? ' is-done' : some ? ' is-some' : ''}${locked ? ' is-locked' : ''}${its.some((x) => x.current) ? ' is-on' : ''}${day === date ? ' is-picked' : ''}`,
        'aria-label': `${dayName(date)}${its.length > 1 ? ` · ${t('count', { n: its.length })}` : ''}${done ? ' ✓' : ''}${locked ? ' 🔒' : ''}`,
        onclick: () => { if (its.length === 1) pick(its[0]); else { day = date; render(); } },
      }, h('span', {}, d), its.length > 1 ? h('span', { class: 'cw-cal-n' }, its.length) : null));
    }
    const picked = day && byDay.get(day);
    return [
      h('div', { class: 'cw-cal-head' },
        h('button', { type: 'button', class: 'cw-icon', 'aria-label': t('prev'), disabled: !older, onclick: () => { month = older; day = null; render(); } }, '‹'),
        h('strong', {}, monthName(month)),
        h('button', { type: 'button', class: 'cw-icon', 'aria-label': t('next'), disabled: !newer, onclick: () => { month = newer; day = null; render(); } }, '›')),
      h('div', { class: 'cw-cal', role: 'grid' }, heads.map((x) => h('span', { class: 'cw-cal-wd', 'aria-hidden': 'true' }, x)), cells),
      picked ? h('ol', { class: 'cw-date-list' }, picked.map(row)) : null,
    ];
  }

  function list() {
    const xs = shown();
    if (!xs.length) return [h('p', { class: 'cw-deck-muted' }, t('none'))];
    const groups = [];
    xs.forEach((x) => { const ym = monthOf(x.date); const g = groups[groups.length - 1]; if (g && g.ym === ym) g.xs.push(x); else groups.push({ ym, xs: [x] }); });
    return [h('div', { class: 'cw-browse-list' }, groups.map((g) => [
      h('h3', { class: 'cw-browse-month' }, monthName(g.ym), h('span', { class: 'cw-date-done' }, ` · ${t('solvedN', { n: g.xs.filter((x) => x.done).length })} / ${g.xs.length}`)),
      h('ol', { class: 'cw-date-list' }, g.xs.map(row)),
    ]))];
  }

  function render() {
    const tab = (v) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(view === v), onclick: () => { view = v; try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } render(); } }, t(v));
    body.replaceChildren(
      h('div', { class: 'cw-browse-tools' },
        h('div', { class: 'cw-seg', role: 'radiogroup' }, tab('calendar'), tab('list')),
        h('label', { class: 'cw-browse-filter' }, h('input', { type: 'checkbox', checked: unsolved, onchange: (e) => { unsolved = e.target.checked; day = null; render(); } }), ' ', t('unsolved'))),
      ...(all.length ? (view === 'list' ? list() : calendar()) : [h('p', { class: 'cw-deck-muted' }, t('none'))]).filter(Boolean));
  }

  overlay.append(h('div', { class: 'cw-sheet cw-browse-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { class: 'cw-sheet-title' }, title),
    body,
    h('div', { class: 'cw-sheet-actions' }, h('button', { type: 'button', class: 'btn-link', onclick: close }, t('close')))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onEsc);
  render();
  (document.querySelector('.cw') || document.body).append(overlay);
}
