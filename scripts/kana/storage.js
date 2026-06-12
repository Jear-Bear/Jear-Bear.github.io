// storage.js — versioned localStorage persistence with debounced writes.
const KEY = 'jareddesu.kana.v1';

export function defaultStore() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: { fontRotation: true, sound: false },
    overrides: { unlockedStages: [] },
    global: {
      reviewCount: 0, totalCorrect: 0,
      sessionDates: [], dailyCounts: {}, studyTimeMs: 0,
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
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
}

export function flushOnHide(store) {
  const flush = () => save(store, { now: true });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export function exportJSON(store) {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kana-trainer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJSON(text) {
  const data = JSON.parse(text); // throws on bad input — caller handles
  if (typeof data !== 'object' || !data.kana) throw new Error('Not a Kana Trainer export.');
  const merged = { ...defaultStore(), ...data, version: 1 };
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

export function reset() {
  localStorage.removeItem(KEY);
  return defaultStore();
}
