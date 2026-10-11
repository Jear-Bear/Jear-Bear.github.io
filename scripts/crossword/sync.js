// sync.js — a signed-in person's progress follows them between devices: puzzle
// progress and solves, stats, and the deck puzzles they've made. It's saved on the
// sponsor Worker under their account (POST /public/plus/save) a few seconds after
// a change, and merged in when they sign in or come back to the tab.
// Signed out, everything stays in this browser only, as before.

import { signedIn, onAccount, currentUser, loadSave, putSave } from './account.js?v=3';

const DECK = 'jareddesu.crossword.deck';
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

function readDeck() { try { return JSON.parse(localStorage.getItem(DECK) || '{}'); } catch { return {}; } }
function local() {
  const h = hooks.get();
  return { v: 1, progress: h.progress || {}, stats: h.stats || {}, made: readDeck().made || [] };
}

export function initSync(h) {
  hooks = h;
  onAccount((u) => { if (u && pulledFor !== u.id) pull(); if (!u) pulledFor = null; });
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
    const u = currentUser();
    if (u) pulledFor = u.id;
    const mine = local();
    const theirs = r && r.data;
    if (theirs && typeof theirs === 'object') {
      const progress = mergeMap(mine.progress, theirs.progress, pickProgress);
      const stats = mergeMap(mine.stats, theirs.stats, pickStats);
      const byId = new Map();
      [...(theirs.made || []), ...mine.made].forEach((p) => { if (p && p.id && !byId.has(p.id)) byId.set(p.id, p); });
      const made = [...byId.values()].sort((a, b) => String(a.made).localeCompare(String(b.made))).slice(-KEEP_MADE);
      if (made.length !== mine.made.length) {
        try { const d = readDeck(); d.made = made; localStorage.setItem(DECK, JSON.stringify(d)); } catch { /* full */ }
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

async function push() {
  if (!signedIn()) return;
  const data = local();
  const s = JSON.stringify(data);
  if (s === lastSent) return;
  try { await putSave(data); lastSent = s; } catch { /* next change tries again */ }
}
