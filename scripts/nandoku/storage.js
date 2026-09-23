// storage.js — Nandoku Trainer persistence (localStorage, debounced writes)
// plus export/import of backups.
import { downloadJSON } from '../study-backup.js';

const KEY = 'jareddesu.nandoku.v1';
const APP = 'jareddesu-nandoku';

export function defaultStore() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: {
      levels: ['05'],
      questions: { reading: true, meaning: true },
      newPerDay: 15,
      sessionSize: 20,
      autoAdvance: true,
      timer: 20,             // challenge: seconds per word, 0 = no timer
    },
    cards: {},         // term id -> { reading|meaning: { box, due, right, wrong, last }, added }
    misses: {},        // term id -> recent miss count (trouble spots)
    best: {},          // challenge high scores: '05+06' -> { score, at }
    global: {
      reviewCount: 0, totalCorrect: 0,
      dailyCounts: {}, newByDay: {}, studyTimeMs: 0, sessionDates: [],
      lastExportAt: 0, reviewsAtExport: 0, games: 0,
    },
  };
}

function mergeDefaults(data) {
  const base = defaultStore();
  return {
    ...base, ...data, version: 1,
    settings: {
      ...base.settings, ...data.settings,
      questions: { ...base.settings.questions, ...(data.settings && data.settings.questions) },
    },
    global: { ...base.global, ...data.global },
    cards: data.cards || {},
    misses: data.misses || {},
    best: data.best || {},
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? mergeDefaults(JSON.parse(raw)) : defaultStore();
  } catch {
    // never destroy silently — keep the unreadable blob
    try { localStorage.setItem(`${KEY}.bak`, localStorage.getItem(KEY) || ''); } catch {}
    return defaultStore();
  }
}

let pending = null;
export function save(store, { now = false } = {}) {
  if (now) { clearTimeout(pending); pending = null; write(store); return; }
  if (pending) return;
  pending = setTimeout(() => { pending = null; write(store); }, 1500);
}

function trimDays(obj, keep = 120) {
  const days = Object.keys(obj).sort();
  for (const d of days.slice(0, Math.max(0, days.length - keep))) delete obj[d];
}

function write(store) {
  store.global.sessionDates = store.global.sessionDates.slice(-400);
  trimDays(store.global.dailyCounts);
  trimDays(store.global.newByDay);
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
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
  downloadJSON(`nandoku-trainer-${new Date().toISOString().slice(0, 10)}.json`,
    { app: APP, exportedAt: new Date().toISOString(), ...store });
}

// Validates a backup and returns what it would restore, without writing,
// so the caller can confirm first. Throws a readable error.
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn\'t valid JSON.'); }
  if (!data || typeof data !== 'object') throw new Error('Not a Nandoku Trainer backup.');
  if (data.app === 'jareddesu-kana' || (data.kana && !data.cards)) {
    throw new Error('That\'s a Kana Trainer backup. Import it on the Kana Trainer page.');
  }
  if (data.app === 'jareddesu-kanji') {
    throw new Error('That\'s a Kanji Trainer backup. Import it on the Kanji Trainer page.');
  }
  if (data.app !== APP) throw new Error('Not a Nandoku Trainer backup.');
  if (typeof data.cards !== 'object' || typeof data.global !== 'object') throw new Error('This backup is incomplete.');
  const { app, exportedAt, ...rest } = data;
  return { store: mergeDefaults(rest), exportedAt: exportedAt || null, reviews: rest.global.reviewCount || 0 };
}

export function commitImport(store) {
  localStorage.setItem(KEY, JSON.stringify(store));   // throws if storage is unavailable
  return store;
}

export function reset() {
  localStorage.removeItem(KEY);
  return defaultStore();
}
