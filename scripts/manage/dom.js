// dom.js — builds DOM nodes without ever parsing HTML. Everything the CRM
// shows (including text Claude writes later) goes in as text nodes, so no
// stored value can inject markup. There is deliberately no innerHTML here.

const BOOL_ATTRS = new Set(['disabled', 'checked', 'selected', 'hidden', 'required', 'readonly', 'multiple', 'open']);

// h('button', { class: 'x', onclick: fn, dataset: { id } }, 'Label', child…)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'value') el.value = v;
    else if (k === 'text') el.textContent = v;
    else if (BOOL_ATTRS.has(k)) el[k] = Boolean(v);
    else if (k === 'style') throw new Error('Use classes, not inline styles (CSP)');
    else if (/^[a-z][a-z0-9-]*$/i.test(k) && !k.startsWith('on')) el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);

// --- Formatting -------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso, { year = false } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}
export function fmtMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function fmtMoney(n, { cents = false } = {}) {
  if (n == null || n === '') return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0,
  }).format(n);
}
export const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
}

// Download a Blob as a file
export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
