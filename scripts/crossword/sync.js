// sync.js — a signed-in person's progress follows them between devices: puzzle
// progress and solves, stats, and the deck puzzles they've made. It's saved on the
// sponsor Worker under their account (POST /public/plus/save) a few seconds after
// a change, and merged in when they sign in or come back to the tab.
// Signed out, everything stays in this browser only, as before.
//
// What's in this browser belongs to one account at a time: the deck is kept under the
// account (account.js deckKey), and the progress is cleared when that account signs out
// or another one signs in, so nobody sees (or merges in) someone else's puzzles.

import { signedIn, onAccount, accountId, deckKey, deckKeyFor, loadSave, putSave } from './account.js?v=5';

const OWNER = 'jareddesu.crossword.owner';       // whose progress this browser holds
const LEGACY_DECK = 'jareddesu.crossword.deck';   // before decks were kept per account
const KEEP_MADE = 60;
let hooks = null;
let timer = null;
let lastSent = '';
let pulledFor = null;
let lastPull = 0;

const filled = (p) => Object.keys((p && p.cells) || {}).length;
// One puzzle's progress: a finished solve wins, then the further-along one
function pickProgress(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.done !== b.done) return a.done ? a : b;
  if (filled(a) !== filled(b)) return filled(a) > filled(b) ? a : b;
  return (a.time || 0) >= (b.time || 0) ? a : b;
}
function pickStats(a, b) {
  if (!a) return b;
  if (!b) return a;
  const win = (a.solved || 0) >= (b.solved || 0) ? a : b;
  const bests = [a.best, b.best].filter((x) => x != null);
  return { ...win, best: bests.length ? Math.min(...bests) : null, longest: Math.max(a.longest || 0, b.longest || 0) };
}
const mergeMap = (a = {}, b = {}, pick) => {
  const out = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { out[k] = pick(a[k], b[k]); });
  return out;
};

function readDeck() { const k = deckKey(); try { return k ? JSON.parse(localStorage.getItem(k) || '{}') : {}; } catch { return {}; } }
const owner = () => { try { return localStorage.getItem(OWNER); } catch { return null; } };
function setOwner(v) { try { if (v) localStorage.setItem(OWNER, v); else localStorage.removeItem(OWNER); } catch { /* private mode */ } }
// This browser's progress and deck belong to someone else (or to nobody, once they sign
// out): forget them here. Their solves and deck puzzles are saved on their account; the
// deck's word list never leaves the browser, so it's imported again after signing back in.
function forget() {
  if (timer) { clearTimeout(timer); timer = null; }
  lastSent = '';
  try { if (owner()) localStorage.removeItem(deckKeyFor(owner())); } catch { /* private mode */ }
  hooks.set({ progress: {}, stats: {} });
}
function local() {
  const h = hooks.get();
  return { v: 1, progress: h.progress || {}, stats: h.stats || {}, made: readDeck().made || [] };
}

export function initSync(h) {
  hooks = h;
  try { localStorage.removeItem(LEGACY_DECK); } catch { /* private mode */ }
  onAccount((u) => {
    const id = accountId();
    if (u && id) {
      if (owner() && owner() !== id) forget();
      setOwner(id);
      if (pulledFor !== id) pull();
    }
    if (!signedIn()) {
      pulledFor = null;
      if (owner()) { forget(); setOwner(null); }        // signed out: their puzzles go with them
    }
  });
  // Back on this tab after a while: pick up what was done on another device
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPull > 60000) pull();
    if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; push(); }
  });
}

export async function pull() {
  if (!hooks || !signedIn()) return;
  lastPull = Date.now();
  try {
    const r = await loadSave();
    pulledFor = accountId();
    const mine = local();
    const theirs = r && r.data;
    if (theirs && typeof theirs === 'object') {
      const progress = mergeMap(mine.progress, theirs.progress, pickProgress);
      const stats = mergeMap(mine.stats, theirs.stats, pickStats);
      const byId = new Map();
      [...(theirs.made || []), ...mine.made].forEach((p) => { if (p && p.id && !byId.has(p.id)) byId.set(p.id, p); });
      const made = [...byId.values()].sort((a, b) => String(a.made).localeCompare(String(b.made))).slice(-KEEP_MADE);
      if (made.length !== mine.made.length) {
        try { const d = readDeck(); d.made = made; localStorage.setItem(deckKey(), JSON.stringify(d)); } catch { /* full */ }
      }
      hooks.set({ progress, stats });
    }
    await push();
  } catch { /* offline or signed out: try again later */ }
}

// Called after any local change (the clock saves every second while solving, so this
// sends at most every 15 seconds, and once more when the tab is hidden)
export function schedulePush() {
  if (!hooks || !signedIn() || timer) return;
  timer = setTimeout(() => { timer = null; push(); }, 15000);
}

// Signing out: send what's waiting first, since this browser forgets it after
export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  await push();
}

async function push() {
  if (!signedIn()) return;
  const data = local();
  const s = JSON.stringify(data);
  if (s === lastSent) return;
  try { await putSave(data); lastSent = s; } catch { /* next change tries again */ }
}
