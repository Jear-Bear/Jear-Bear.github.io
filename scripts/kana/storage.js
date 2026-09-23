// storage.js — versioned localStorage persistence with debounced writes.
import { downloadJSON } from '../study-backup.js';

const KEY = 'jareddesu.kana.v1';

export function defaultStore() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: { fontRotation: true, sound: false, batchSize: 25, lastMode: 'smart', autoSubmit: true, newPerDay: 15, haptics: true },
    overrides: { unlockedStages: [] },
    global: {
      reviewCount: 0, totalCorrect: 0,
      sessionDates: [], dailyCounts: {}, studyTimeMs: 0,
      newByDay: {},
      lastExportAt: 0, reviewsAtExport: 0,   // backup reminders
    },
    kana: {},
    confusions: {},
    recentMisses: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultStore();
    const data = JSON.parse(raw);
    if (data.version !== 1) return migrate(data);
    // merge over defaults so new fields appear after updates
    const base = defaultStore();
    return {
      ...base, ...data,
      settings: { ...base.settings, ...data.settings },
      overrides: { ...base.overrides, ...data.overrides },
      global: { ...base.global, ...data.global },
    };
  } catch (e) {
    // never destroy silently — back up the corrupt blob first
    try { localStorage.setItem(KEY + '.bak', localStorage.getItem(KEY) || ''); } catch {}
    return defaultStore();
  }
}

function migrate(data) {
  // future versions migrate forward here
  return { ...defaultStore(), ...data, version: 1 };
}

let pending = null;
export function save(store, { now = false } = {}) {
  if (now) {
    clearTimeout(pending); pending = null;
    write(store);
    return;
  }
  if (pending) return;
  pending = setTimeout(() => { pending = null; write(store); }, 2000);
}

function write(store) {
  // cap unbounded collections before writing
  store.global.sessionDates = store.global.sessionDates.slice(-400);
  store.recentMisses = store.recentMisses.slice(-100);
  const days = Object.keys(store.global.dailyCounts).sort();
  for (const d of days.slice(0, Math.max(0, days.length - 90))) delete store.global.dailyCounts[d];
  if (store.global.newByDay) {
    const nd = Object.keys(store.global.newByDay).sort();
    for (const d of nd.slice(0, Math.max(0, nd.length - 90))) delete store.global.newByDay[d];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    // private mode / storage full: tell the app so it can warn the user
    window.dispatchEvent(new CustomEvent('study-save-failed', { detail: e }));
  }
}

export function flushOnHide(store) {
  const flush = () => save(store, { now: true });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export function exportJSON(store) {
  store.global.lastExportAt = Date.now();
  store.global.reviewsAtExport = store.global.reviewCount;
  save(store, { now: true });
  downloadJSON(`kana-trainer-${new Date().toISOString().slice(0, 10)}.json`,
    { ...store, app: 'jareddesu-kana', exportedAt: new Date().toISOString() });
}

// Validates a backup and returns the store it would restore — without
// writing, so the caller can confirm first. Throws with a readable message.
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn\'t valid JSON.'); }
  if (!data || typeof data !== 'object' || typeof data.kana !== 'object' || typeof data.global !== 'object') {
    throw new Error(data && data.app === 'jareddesu-kanji'
      ? 'That\'s a Kanji Trainer backup. Import it on the Kanji Trainer page.'
      : 'Not a Kana Trainer backup.');
  }
  const base = defaultStore();
  const { app, exportedAt, ...rest } = data;
  return {
    store: {
      ...base, ...rest, version: 1,
      settings: { ...base.settings, ...rest.settings },
      overrides: { ...base.overrides, ...rest.overrides },
      global: { ...base.global, ...rest.global },
    },
    exportedAt: exportedAt || null,
    reviews: rest.global.reviewCount || 0,
  };
}

export function commitImport(store) {
  localStorage.setItem(KEY, JSON.stringify(store));   // throws if storage is unavailable
  return store;
}

// Kept for older callers
export function importJSON(text) {
  return commitImport(parseImport(text).store);
}

export function reset() {
  localStorage.removeItem(KEY);
  return defaultStore();
}