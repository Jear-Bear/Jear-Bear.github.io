// ui.js — the side panel (a full-screen sheet on phones), toasts with undo,
// and a small confirm dialog.

import { h, clear, $ } from './dom.js';

// --- Toasts -------------------------------------------------------------------------
export function toast(message, { action, onAction, kind = 'info', ms = 6000 } = {}) {
  const region = $('#crm-toasts');
  if (!region) return;
  const el = h('div', { class: ['crm-toast', `is-${kind}`], role: kind === 'error' ? 'alert' : 'status' },
    h('span', {}, message));
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (action) {
    el.append(h('button', { type: 'button', class: 'crm-toast-action', onclick: () => { close(); onAction(); } }, action));
  }
  el.append(h('button', { type: 'button', class: 'crm-toast-close', 'aria-label': 'Dismiss', onclick: close }, '×'));
  region.append(el);
  timer = setTimeout(close, ms);
}

export function toastError(err) {
  toast(err && err.message ? err.message : 'Something went wrong', { kind: 'error', ms: 9000 });
}

// --- Panel ---------------------------------------------------------------------------
let panelState = null;   // { onClose, isDirty, returnFocus }

export function openPanel({ title, subtitle, body, footer, isDirty, onClose, label }) {
  const panel = $('#crm-panel');
  const returnFocus = panelState ? panelState.returnFocus : document.activeElement;
  panelState = { isDirty, onClose, returnFocus };
  clear(panel);
  const closeBtn = h('button', { type: 'button', class: 'crm-panel-close', onclick: () => closePanel() }, 'Close');
  panel.append(
    h('header', { class: 'crm-panel-head' },
      h('div', { class: 'crm-panel-titles' },
        label ? h('p', { class: 'crm-panel-label' }, label) : null,
        h('h2', { id: 'crm-panel-title' }, title),
        subtitle ? h('p', { class: 'crm-panel-sub' }, subtitle) : null),
      closeBtn),
    h('div', { class: 'crm-panel-body' }, body),
    footer ? h('footer', { class: 'crm-panel-foot' }, footer) : null,
  );
  panel.hidden = false;
  document.body.classList.add('has-panel');
  requestAnimationFrame(() => {
    const first = panel.querySelector('.crm-panel-body input, .crm-panel-body select, .crm-panel-body textarea');
    (window.matchMedia('(pointer: fine)').matches && first ? first : closeBtn).focus({ preventScroll: true });
  });
}

export function closePanel({ force = false } = {}) {
  const panel = $('#crm-panel');
  if (!panel || panel.hidden) return true;
  if (!force && panelState && panelState.isDirty && panelState.isDirty()
    && !window.confirm('Discard your unsaved changes?')) return false;
  const st = panelState;
  panelState = null;
  panel.hidden = true;
  clear(panel);
  document.body.classList.remove('has-panel');
  if (st && st.onClose) st.onClose();
  if (st && st.returnFocus && document.contains(st.returnFocus)) st.returnFocus.focus({ preventScroll: true });
  return true;
}

export const panelDirty = () => Boolean(panelState && panelState.isDirty && panelState.isDirty());
export const panelOpen = () => { const p = $('#crm-panel'); return p && !p.hidden; };

// --- Buttons -------------------------------------------------------------------------
export function button(label, onclick, { kind = 'ghost', type = 'button', title, disabled } = {}) {
  return h('button', { type, class: ['crm-btn', `is-${kind}`], onclick, title, disabled }, label);
}

// Runs an async action with the button disabled; reports errors as toasts
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (err) { toastError(err); throw err; } finally { if (btn) btn.disabled = false; }
}
