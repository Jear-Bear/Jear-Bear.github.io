// sync.js — a signed-in player's Kana Wordle dailies follow them between devices, like the
// crossword's (scripts/crossword/sync.js): the daily games and the daily stats are saved on
// the sponsor Worker under their account (POST /public/tool/save { game: 'wordle' }) a few
// seconds after a change, and merged in when they sign in or come back to the tab. Settings
// and practice games stay in this browser. Signed out, everything stays in this browser only.
//
// What's in this browser belongs to one account at a time: it's forgotten when that account
// signs out or another one signs in; someone who played signed out keeps it, and it joins the
// first account they sign in with.

import { signedIn, onAccount, accountId, toolLoad, toolSave } from '../crossword/account.js?v=8';

const OWNER = 'jareddesu.wordle.owner';     // whose dailies this browser holds
const GAME = 'wordle';
let hooks = null;
let timer = null;
let lastSent = '';
let pulledFor = null;
let lastPull = 0;

// One daily: a finished game wins over an unfinished one, then the one with more guesses
function pickGame(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.answer !== b.answer) return a;
  if (Boolean(a.done) !== Boolean(b.done)) return a.done ? a : b;
  const ga = (a.guesses || []).length;
  const gb = (b.guesses || []).length;
  if (ga !== gb) return ga > gb ? a : b;
  return (a.hints || 0) >= (b.hints || 0) ? a : b;
}
// One level and length's daily stats: the larger counts, and the streak from whichever
// played more recently
const maxArr = (x = [], y = []) => Array.from({ length: Math.max(x.length, y.length) }, (_, i) => Math.max(x[i] || 0, y[i] || 0));
function pickStats(a, b) {
  if (!a) return b;
  if (!b) return a;
  const recent = (a.lastDay || 0) >= (b.lastDay || 0) ? a : b;
  const out = { ...recent };
  ['played', 'won', 'hinted', 'max', 'cleanMax'].forEach((k) => { if (a[k] != null || b[k] != null) out[k] = Math.max(a[k] || 0, b[k] || 0); });
  if (a.dist || b.dist) out.dist = maxArr(a.dist, b.dist);
  if (a.distHint || b.distHint) out.distHint = maxArr(a.distHint, b.distHint);
  return out;
}
const mergeMap = (a = {}, b = {}, pick) => {
  const out = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { out[k] = pick(a[k], b[k]); });
  return out;
};

const owner = () => { try { return localStorage.getItem(OWNER); } catch { return null; } };
function setOwner(v) { try { if (v) localStorage.setItem(OWNER, v); else localStorage.removeItem(OWNER); } catch { /* private mode */ } }

// The dailies only, without what the page works out again on load (the word's entry)
function local() {
  const h = hooks.get();
  const games = {};
  Object.entries(h.games || {}).forEach(([k, g]) => {
    if (!k.startsWith('daily:') || !g) return;
    const { info, ...rest } = g;
    games[k] = rest;
  });
  return { v: 1, games, stats: h.stats || {} };
}
function forget() {
  if (timer) { clearTimeout(timer); timer = null; }
  lastSent = '';
  hooks.set({ games: {}, stats: {} });
}

export function initSync(h) {
  hooks = h;
  onAccount((u) => {
    const id = accountId();
    if (u && id) {
      if (owner() && owner() !== id) forget();
      setOwner(id);
      if (pulledFor !== id) pull();
    }
    if (!signedIn()) {
      pulledFor = null;
      if (owner()) { forget(); setOwner(null); }        // signed out: their dailies go with them
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPull > 60000) pull();
    if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; push(); }
  });
}

export async function pull() {
  if (!hooks || !signedIn()) return;
  lastPull = Date.now();
  try {
    const r = await toolLoad(GAME);
    pulledFor = accountId();
    const mine = local();
    const theirs = r && r.data;
    if (theirs && typeof theirs === 'object') {
      hooks.set({ games: mergeMap(mine.games, theirs.games, pickGame), stats: mergeMap(mine.stats, theirs.stats, pickStats) });
    }
    await push();
  } catch { /* offline or signed out: try again later */ }
}

// After any change (at most every 10 seconds, and once more when the tab is hidden)
export function schedulePush() {
  if (!hooks || !signedIn() || timer) return;
  timer = setTimeout(() => { timer = null; push(); }, 10000);
}
export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  await push();
}

async function push() {
  if (!signedIn()) return;
  const data = local();
  const s = JSON.stringify(data);
  if (s === lastSent) return;
  try { await toolSave(GAME, data); lastSent = s; } catch { /* next change tries again */ }
}
