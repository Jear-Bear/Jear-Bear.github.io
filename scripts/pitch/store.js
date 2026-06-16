// store.js — progress in localStorage, user audio in IndexedDB.
// Audio blobs are too large for localStorage, so they live in IDB keyed by id;
// progress (scores, prefs) stays in localStorage like the kana tool.

const LS_KEY = 'jareddesu.pitch.v1';
const DB_NAME = 'jareddesu.pitch.audio';
const STORE = 'clips';

export function defaultStore() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: { showContour: false, gender: 'all', genre: 'all', type: 'all', lastMode: 'repeat' },
    progress: {}, // id → { attempts, bestPattern: bool, bestContour: number }
    userClips: [], // metadata only; audio blob lives in IDB
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultStore();
    const d = JSON.parse(raw);
    const base = defaultStore();
    return { ...base, ...d, settings: { ...base.settings, ...d.settings } };
  } catch {
    try { localStorage.setItem(LS_KEY + '.bak', localStorage.getItem(LS_KEY) || ''); } catch {}
    return defaultStore();
  }
}

let pending = null;
export function save(store, { now = false } = {}) {
  const write = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch {}
  };
  if (now) { clearTimeout(pending); pending = null; write(); return; }
  if (pending) return;
  pending = setTimeout(() => { pending = null; write(); }, 1500);
}

export function recordAttempt(store, id, patternPass, contour) {
  const p = store.progress[id] || (store.progress[id] = { attempts: 0, bestPattern: false, bestContour: 0 });
  p.attempts++;
  p.bestPattern = p.bestPattern || patternPass;
  if (typeof contour === 'number') p.bestContour = Math.max(p.bestContour, contour);
  save(store);
  return p;
}

// ---------- IndexedDB for user audio ----------
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putAudio(id, blob) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch { return false; } // IDB unavailable → user clip is session-only
}

export async function getAudio(id) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}

export async function deleteAudio(id) {
  try {
    const db = await openDB();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch {}
}

// progress export/import (audio excluded — too large; users keep source files)
export function exportJSON(store) {
  const data = { ...store, userClips: store.userClips.map(({ audioInMemory, ...m }) => m) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pitch-mirror-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function reset(store) {
  localStorage.removeItem(LS_KEY);
  // best-effort wipe of audio store
  try { indexedDB.deleteDatabase(DB_NAME); } catch {}
  return defaultStore();
}
