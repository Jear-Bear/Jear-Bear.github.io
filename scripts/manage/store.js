// store.js — the app's copy of the CRM data, plus lookups and computed views.
// The Worker is the source of truth; after any write the store reloads.

import { api } from './api.js';
import { dashboard, todayIn, followUp, isOverdue, priceCheck, conflicts, videoStatus } from './rules.js';

const listeners = new Set();
export const store = {
  state: null,
  byId: {},
  loading: false,
  error: null,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => fn(store));

function index(state) {
  const maps = {};
  for (const key of ['companies', 'contacts', 'deals', 'payments', 'videos', 'rateCard']) {
    maps[key] = new Map(state[key].map((r) => [r.id, r]));
  }
  return maps;
}

export async function reload() {
  store.loading = true;
  emit();
  try {
    store.state = await api.state();
    store.byId = index(store.state);
    store.error = null;
  } catch (err) {
    store.error = err;
  } finally {
    store.loading = false;
    emit();
  }
  return store.state;
}

// --- Lookups ---------------------------------------------------------------------
export const live = (list) => list.filter((r) => !r.archived);
export const company = (id) => store.byId.companies && store.byId.companies.get(id);
export const contact = (id) => store.byId.contacts && store.byId.contacts.get(id);
export const deal = (id) => store.byId.deals && store.byId.deals.get(id);
export const video = (id) => store.byId.videos && store.byId.videos.get(id);
export const companyName = (id) => (company(id) || {}).name || 'Unknown company';
export const today = () => todayIn(store.state ? store.state.settings.tz : undefined);

export function dealTitle(d) {
  const c = companyName(d.company_id);
  const v = d.video_id && video(d.video_id);
  const slot = v ? v.title : d.slot_note;
  return slot ? `${c} · ${slot}` : c;
}

let dashCache = null;
export function dash() {
  if (!store.state) return null;
  if (dashCache && dashCache.state === store.state && dashCache.day === today()) return dashCache.value;
  const value = dashboard(store.state, { today: today(), targets: store.state.settings.targets });
  dashCache = { state: store.state, day: today(), value };
  return value;
}

// Flags shown on a deal row
export function dealFlags(d) {
  const t = today();
  const flags = [];
  const fu = followUp(d, t);
  if (fu && fu.isDue) flags.push({ kind: 'due', label: fu.label === 'Mark as No reply?' ? 'No reply?' : `${fu.label} due` });
  if (isOverdue(d, t)) flags.push({ kind: 'overdue', label: 'Overdue' });
  const p = priceCheck(d, store.state.rateCard);
  if (p && p.below && d.stage !== 'Lost' && d.stage !== 'No reply') flags.push({ kind: 'floor', label: 'Below floor' });
  const cs = (dash() || { conflicts: [] }).conflicts.filter((c) => c.dealIds.includes(d.id));
  if (cs.length) flags.push({ kind: cs.some((c) => c.severity === 'conflict') ? 'conflict' : 'warn', label: 'Conflict', title: cs.map((c) => c.message).join('\n') });
  return flags;
}

export { followUp, priceCheck, conflicts, videoStatus };
