// app.js — Kana Wordle.
//
// Guess a hidden hiragana word (4 or 5 kana) in 8 tries. Daily words are the
// same for everyone: a fixed shuffle of each level's answer list, indexed by
// the day. Practice picks at random. Progress and stats stay in this browser.

import { toHiragana } from '../kanji/romaji.js?v=1';
import { gridKana, cycleDakuten, romaji } from '../crossword/kana.js?v=1';

const $ = (id) => document.getElementById(id);
const KEY = 'jareddesu.wordle.v1';
const START = '2026-10-02';             // daily #1
const TRIES = 8;
const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const RANK = { absent: 1, close: 2, present: 3, correct: 4 };
const EMOJI = { correct: '🟩', present: '🟨', close: '🟦', absent: '⬜' };

// ---------------------------------------------------------------- storage
function load() {
  try { return { settings: {}, games: {}, stats: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { settings: {}, games: {}, stats: {} }; }
}
const store = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };
const settings = store.settings;
settings.mode = settings.mode || 'daily';
settings.len = settings.len || 4;
settings.level = settings.level || 'beginner';

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c != null && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

// ---------------------------------------------------------------- words
const lists = {};
async function words(len) {
  if (lists[len]) return lists[len];
  const res = await fetch(`../../data/wordle/words-${len}.json?v=2`);
  if (!res.ok) throw new Error(`words-${len}.json: ${res.status}`);
  const d = await res.json();
  const bin = atob(d.answers.split('').reverse().join(''));
  const answers = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  lists[len] = { valid: new Set(d.valid), answers };
  return lists[len];
}

// Seeded shuffle so the daily order is fixed and never repeats until the list runs out
function rng(seed) {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(list, seed) {
  const r = rng(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = (date) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${START}T12:00:00Z`)) / 86400000) + 1;

// ---------------------------------------------------------------- scoring
function score(guess, answer) {
  const g = [...guess], a = [...answer];
  const out = g.map(() => 'absent');
  const left = {};
  a.forEach((ch, i) => { if (g[i] === ch) out[i] = 'correct'; else left[ch] = (left[ch] || 0) + 1; });
  g.forEach((ch, i) => {
    if (out[i] === 'correct') return;
    if (left[ch]) { out[i] = 'present'; left[ch]--; } else if (sameBase(ch, a[i])) out[i] = 'close';
  });
  return out;
}
// Same kana apart from dakuten / handakuten (か・が, は・ば・ぱ, う・ゔ)
function sameBase(x, y) {
  if (x === y) return false;
  let c = x;
  for (let i = 0; i < 3; i++) { c = cycleDakuten(c); if (c === y) return true; }
  return false;
}

// ---------------------------------------------------------------- game state
let game = null;          // { key, answer, guesses: [], done, won, mode, level, len, day }
let typed = '';           // current row
let tail = '';            // unfinished romaji
let data = null;

async function start({ fresh = false } = {}) {
  closeOverlays();
  renderBar();
  try { data = await words(settings.len); } catch { $('title').textContent = 'Couldn’t load the word list. Try again in a moment.'; return; }
  const pool = data.answers[settings.level];
  if (settings.mode === 'daily') {
    const today = localDate();
    const day = Math.max(1, dayNumber(today));
    const key = `daily:${today}:${settings.level}:${settings.len}`;
    const answer = shuffled(pool, `${settings.level}:${settings.len}`)[(day - 1) % pool.length];
    game = store.games[key] && store.games[key].answer === answer.a ? store.games[key] : (store.games[key] = { key, answer: answer.a, guesses: [], done: false, won: false, mode: 'daily', day });
    pruneOld();
  } else {
    const key = `practice:${settings.level}:${settings.len}`;
    const cur = store.games[key];
    if (!cur || cur.done || fresh) {
      const recent = new Set((store.recent || []).slice(-50));
      const choices = pool.filter((w) => !recent.has(w.a));
      const answer = (choices.length ? choices : pool)[Math.floor(Math.random() * (choices.length || pool.length))];
      store.games[key] = { key, answer: answer.a, guesses: [], done: false, won: false, mode: 'practice' };
    }
    game = store.games[key];
  }
  game.level = settings.level;
  game.len = settings.len;
  game.info = pool.find((w) => w.a === game.answer) || { a: game.answer, w: game.answer, r: game.answer, m: '' };
  game.hints = game.hints || 0;
  typed = ''; tail = '';
  save();
  renderTitle();
  renderHints();
  renderBoard();
  renderKeys();
  if (game.done) setTimeout(() => showResult(), 300);
  if (!window.matchMedia('(pointer: coarse)').matches) $('ime').focus({ preventScroll: true });
}

function pruneOld() {
  const cutoff = Object.keys(store.games).filter((k) => k.startsWith('daily:')).sort().slice(0, -60);
  cutoff.forEach((k) => delete store.games[k]);
}

// ---------------------------------------------------------------- rendering
function renderBar() {
  document.querySelectorAll('#mode-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  document.querySelectorAll('#len-seg button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.len) === settings.len)));
  $('level').value = settings.level;
}

function renderTitle() {
  $('title').textContent = game.mode === 'daily'
    ? `Daily #${game.day} · ${LEVEL_NAMES[game.level]} · ${game.len} kana`
    : `Practice · ${LEVEL_NAMES[game.level]} · ${game.len} kana`;
}

// Theme, then up to two hints on request: the English meaning, then one kana
const POS_LABEL = { verb: 'verb', adjective: 'い-adjective', 'na-adjective': 'な-adjective', adverb: 'adverb', expression: 'expression', counter: 'counter', noun: 'noun' };
function hintKana() {
  const solved = new Set();
  game.guesses.forEach((g) => score(g, game.answer).forEach((m, i) => { if (m === 'correct') solved.add(i); }));
  const i = [...game.answer].findIndex((_, k) => !solved.has(k));
  return i < 0 ? null : { i, ch: [...game.answer][i] };
}
function renderHints() {
  const box = $('hints');
  const info = game.info;
  const showTheme = !settings.notheme || game.done;
  const parts = [];
  if (showTheme && info.t) {
    parts.push(h('p', { class: 'wd-theme' }, h('span', { class: 'wd-theme-label' }, 'Theme'), ` ${info.t}`, info.p && !/^(Something you do|A describing word|How, when or how much|Something people say|A thing or an idea)$/.test(info.t) ? h('span', { class: 'wd-muted' }, ` · ${POS_LABEL[info.p] || info.p}`) : null));
  }
  if (game.hints >= 1 && info.m) parts.push(h('p', { class: 'wd-hint' }, h('span', { class: 'wd-theme-label' }, 'Meaning'), ` ${info.m}`));
  if (game.hints >= 2) {
    const k = game.hintKana || hintKana();
    if (k) { game.hintKana = k; parts.push(h('p', { class: 'wd-hint' }, h('span', { class: 'wd-theme-label' }, 'Kana'), ' Square ', String(k.i + 1), ' is ', h('strong', { lang: 'ja' }, k.ch))); }
  }
  if (!game.done && game.hints < 2) {
    const label = game.hints === 0 ? 'Hint: show the meaning' : 'Hint: show one kana';
    parts.push(h('button', { type: 'button', class: 'wd-hint-btn', onclick: () => { game.hints++; save(); renderHints(); } }, '💡 ', label));
  }
  box.replaceChildren(...parts);
}

function renderBoard() {
  const board = $('board');
  board.style.setProperty('--len', game.len);
  board.replaceChildren(...Array.from({ length: TRIES }, (_, r) => {
    const g = game.guesses[r];
    const marks = g ? score(g, game.answer) : null;
    const isCur = !game.done && r === game.guesses.length;
    const letters = g ? [...g] : isCur ? [...typed] : [];
    return h('div', { class: `wd-row${isCur ? ' is-cur' : ''}`, role: 'row' },
      Array.from({ length: game.len }, (_, i) => h('div', {
        class: `wd-tile${marks ? ` is-${marks[i]}` : letters[i] ? ' is-filled' : ''}`, role: 'gridcell', lang: 'ja',
        'aria-label': letters[i] ? `${letters[i]}${marks ? `, ${marks[i]}` : ''}` : 'empty',
      }, letters[i] || (isCur && i === letters.length && tail ? h('span', { class: 'wd-tail' }, tail) : ''))));
  }));
}

// The 50-sound chart, read right to left like a Japanese kana keyboard
const KEY_ROWS = [
  'わらやまはなたさかあ',
  'をり　みひにちしきい',
  'んるゆむふぬつすくう',
  'ーれ　めへねてせけえ',
  '゛ろよもほのとそこお',
];
function renderKeys() {
  const best = {};
  game.guesses.forEach((g) => score(g, game.answer).forEach((m, i) => {
    const ch = g[i];
    const s = m === 'close' ? 'absent' : m;      // "close" says nothing about the kana itself
    if (!best[ch] || RANK[s] > RANK[best[ch]]) best[ch] = s;
  }));
  const keys = $('keys');
  keys.classList.toggle('show-romaji', Boolean(settings.romaji));
  const kanaKeys = KEY_ROWS.flatMap((row) => [...row].map((k) => {
    if (k === '　') return h('span', { class: 'wd-key is-gap', 'aria-hidden': 'true' });
    const fn = k === '゛';
    return h('button', {
      type: 'button', class: `wd-key${fn ? ' is-fn' : ''}${best[k] ? ` is-${best[k]}` : ''}`, lang: 'ja',
      'aria-label': fn ? 'Add dakuten or handakuten' : k,
      onpointerdown: (e) => e.preventDefault(),
      onclick: () => (fn ? dakuten() : add(k)),
    }, fn ? h('span', { class: 'wd-daku' }, 'が・ぱ') : k, !fn && k !== 'ー' ? h('span', { class: 'wd-key-r' }, romaji(k)) : null);
  }));
  // Voiced kana appear on the board but have no key of their own; show their colour on the base key's corner
  keys.replaceChildren(...kanaKeys,
    h('div', { class: 'wd-key-row' },
      h('button', { type: 'button', class: 'wd-key is-wide is-fn', onpointerdown: (e) => e.preventDefault(), onclick: back, 'aria-label': 'Delete' }, '⌫'),
      h('button', { type: 'button', class: 'wd-key is-wide is-enter', onpointerdown: (e) => e.preventDefault(), onclick: submit }, 'Enter')));
  // Mark base keys whose voiced forms were tried
  Object.entries(best).forEach(([ch, s]) => {
    let base = ch;
    for (let i = 0; i < 3 && !KEY_ROWS.join('').includes(base); i++) base = cycleDakuten(base);
    if (base === ch) return;
    const btn = [...keys.querySelectorAll('.wd-key')].find((b) => b.getAttribute('aria-label') === base);
    if (btn) btn.append(h('span', { class: `wd-key-dot is-${s}`, title: `${ch}: ${s}` }));
  });
}

// ---------------------------------------------------------------- input
function add(ch) {
  if (!game || game.done) return;
  const g = ch === 'ー' ? 'ー' : gridKana(ch);
  if (!g || [...typed].length >= game.len) return;
  typed += g;
  renderBoard();
}
function back() {
  if (!game || game.done) return;
  if (tail) tail = tail.slice(0, -1); else typed = [...typed].slice(0, -1).join('');
  renderBoard();
}
function dakuten() {
  if (!typed) return;
  const chars = [...typed];
  chars[chars.length - 1] = cycleDakuten(chars[chars.length - 1]);
  typed = chars.join('');
  renderBoard();
}

function submit() {
  if (!game || game.done) return;
  if (tail === 'n') { typed += 'ん'; tail = ''; }
  if ([...typed].length < game.len) { shake('Not enough kana'); return; }
  if (!settings.any && !data.valid.has(typed)) { shake('Not in the word list'); return; }
  if (settings.hard) {
    const miss = hardModeMiss(typed);
    if (miss) { shake(miss); return; }
  }
  game.guesses.push(typed);
  typed = ''; tail = '';
  if (game.guesses[game.guesses.length - 1] === game.answer) { game.done = true; game.won = true; }
  else if (game.guesses.length >= TRIES) game.done = true;
  if (game.done) recordStats();
  save();
  renderBoard();
  flipLast();
  renderKeys();
  renderHints();
  if (game.done) setTimeout(showResult, 1500);
}

function hardModeMiss(guess) {
  const g = [...guess];
  for (const prev of game.guesses) {
    const marks = score(prev, game.answer);
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] === 'correct' && g[i] !== prev[i]) return `Square ${i + 1} must be ${prev[i]}`;
    }
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] === 'present' && !g.includes(prev[i])) return `Guess must contain ${prev[i]}`;
    }
  }
  return null;
}

function flipLast() {
  const rows = $('board').querySelectorAll('.wd-row');
  const row = rows[game.guesses.length - 1];
  if (!row) return;
  row.querySelectorAll('.wd-tile').forEach((t, i) => { t.style.animationDelay = `${i * 180}ms`; t.classList.add('is-flip'); });
  if (game.won) setTimeout(() => row.classList.add('is-win'), game.len * 180 + 250);
}

function shake(msg) {
  toast(msg);
  const row = $('board').querySelector('.wd-row.is-cur');
  if (row) { row.classList.remove('is-shake'); void row.offsetWidth; row.classList.add('is-shake'); }
}

function onKey(e) {
  if (e.isComposing || e.key === 'Process' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('result').hidden || !$('settings').hidden) { if (e.key === 'Escape') closeOverlays(); return; }
  const k = e.key;
  if (k === 'Enter') { e.preventDefault(); submit(); return; }
  if (k === 'Backspace') { e.preventDefault(); back(); return; }
  if (k === '-' || k === 'ー') { e.preventDefault(); tail = ''; add('ー'); return; }
  if (/^[a-z']$/i.test(k)) {
    e.preventDefault();
    if (!game || game.done) return;
    const conv = toHiragana(tail + k.toLowerCase());
    const m = conv.match(/^([^a-z']*)([a-z']*)$/);
    tail = m ? m[2] : '';
    if (m && m[1]) for (const ch of m[1]) add(ch);
    renderBoard();
    return;
  }
  if (k.length === 1 && /[ぁ-ゖァ-ヶ]/.test(k)) { e.preventDefault(); add(k); }
}

// ---------------------------------------------------------------- stats + result
function statsKey() { return `${game.level}:${game.len}`; }
function recordStats() {
  if (game.mode !== 'daily') {
    store.recent = [...(store.recent || []), game.answer].slice(-50);
    const p = store.practice = store.practice || {};
    const s = p[statsKey()] = p[statsKey()] || { played: 0, won: 0 };
    s.played++; if (game.won) s.won++;
    return;
  }
  const s = store.stats[statsKey()] = store.stats[statsKey()] || { played: 0, won: 0, streak: 0, max: 0, dist: Array(TRIES).fill(0), lastDay: 0 };
  s.played++;
  if (game.won) {
    s.won++;
    s.streak = s.lastDay === game.day - 1 ? s.streak + 1 : 1;
    s.max = Math.max(s.max, s.streak);
    s.dist[game.guesses.length - 1]++;
  } else s.streak = 0;
  s.lastDay = game.day;
}

function statsBlock() {
  const s = store.stats[statsKey()] || { played: 0, won: 0, streak: 0, max: 0, dist: Array(TRIES).fill(0) };
  const max = Math.max(1, ...s.dist);
  return h('div', { class: 'wd-stats' },
    h('div', { class: 'wd-stat-row' },
      [[s.played, 'Played'], [s.played ? Math.round((s.won / s.played) * 100) : 0, 'Win %'], [s.streak, 'Streak'], [s.max, 'Best streak']]
        .map(([v, l]) => h('div', { class: 'wd-stat' }, h('span', { class: 'wd-stat-v' }, v), h('span', { class: 'wd-stat-l' }, l)))),
    h('p', { class: 'wd-dist-title' }, `Guess distribution · daily ${LEVEL_NAMES[game.level]}, ${game.len} kana`),
    h('ol', { class: 'wd-dist' }, s.dist.map((n, i) => {
      const bar = h('span', { class: `wd-dist-bar${game.mode === 'daily' && game.won && game.guesses.length === i + 1 ? ' is-now' : ''}` }, n);
      bar.style.width = `${Math.max(8, (n / max) * 100)}%`;
      return h('li', {}, h('span', { class: 'wd-dist-n' }, i + 1), bar);
    })));
}

function showResult({ statsOnly = false } = {}) {
  const info = game.info;
  const actions = $('result-actions');
  actions.replaceChildren();
  if (statsOnly || !game.done) {
    $('result-eyebrow').textContent = 'statistics';
    $('result-title').textContent = 'Your daily record';
    $('result-body').replaceChildren(statsBlock());
  } else {
    $('result-eyebrow').textContent = game.won ? `solved in ${game.guesses.length}/${TRIES}` : 'out of guesses';
    $('result-title').textContent = game.won ? ['天才！', '見事！', 'すごい！', 'いいね！', 'よし！', 'ナイス！', 'ふう…', 'セーフ！'][game.guesses.length - 1] : 'ざんねん…';
    $('result-body').replaceChildren(
      h('div', { class: 'wd-answer' },
        h('p', { class: 'wd-answer-word', lang: 'ja' }, info.w),
        h('p', { class: 'wd-answer-reading', lang: 'ja' }, info.r, h('span', { class: 'wd-muted' }, ` · ${romaji(info.r)}`)),
        info.m ? h('p', { class: 'wd-answer-meaning' }, info.m) : null),
      game.mode === 'daily' ? statsBlock() : null,
      game.mode === 'daily' ? h('p', { class: 'wd-next', id: 'next-in' }) : null);
    actions.append(h('button', { type: 'button', class: 'btn btn-primary', onclick: share }, 'Copy result'));
    if (game.mode === 'practice') actions.append(h('button', { type: 'button', class: 'btn-link', onclick: () => start({ fresh: true }) }, 'Next word →'));
    else actions.append(h('button', { type: 'button', class: 'btn-link', onclick: () => { settings.mode = 'practice'; save(); start(); } }, 'Keep playing in practice →'));
    tickCountdown();
  }
  $('result').hidden = false;
}

let countdown = null;
function tickCountdown() {
  clearInterval(countdown);
  const run = () => {
    const el = $('next-in');
    if (!el) { clearInterval(countdown); return; }
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((next - now) / 1000));
    el.textContent = `Next daily word in ${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  run();
  countdown = setInterval(run, 1000);
}

function share() {
  const head = game.mode === 'daily' ? `Kana Wordle #${game.day} ${LEVEL_NAMES[game.level]} ${game.len}` : `Kana Wordle practice ${LEVEL_NAMES[game.level]} ${game.len}`;
  const grid = game.guesses.map((g) => score(g, game.answer).map((m) => EMOJI[m]).join('')).join('\n');
  const hints = game.hints ? ` ${'💡'.repeat(game.hints)}` : '';
  const text = `${head} ${game.won ? game.guesses.length : 'X'}/${TRIES}${settings.hard ? '*' : ''}${hints}\n${grid}\nhttps://www.jareddesu.com/tools/wordle/`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied. Paste it anywhere.'), () => toast(text));
}

// ---------------------------------------------------------------- misc
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
function closeOverlays() { $('result').hidden = true; $('settings').hidden = true; clearInterval(countdown); }

document.querySelectorAll('#mode-seg button').forEach((b) => b.addEventListener('click', () => { settings.mode = b.dataset.mode; save(); start(); }));
document.querySelectorAll('#len-seg button').forEach((b) => b.addEventListener('click', () => { settings.len = Number(b.dataset.len); save(); start(); }));
$('level').addEventListener('change', (e) => { settings.level = e.target.value; save(); start(); });
$('btn-stats').addEventListener('click', () => showResult({ statsOnly: true }));
$('btn-settings').addEventListener('click', () => { $('settings').hidden = false; });
['result', 'settings'].forEach((id) => {
  $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlays(); });
  $(`${id}-close`).addEventListener('click', closeOverlays);
});
[['opt-hard', 'hard'], ['opt-any', 'any'], ['opt-romaji', 'romaji'], ['opt-notheme', 'notheme']].forEach(([id, k]) => {
  $(id).checked = Boolean(settings[k]);
  $(id).addEventListener('change', (e) => {
    if (k === 'hard' && game && game.guesses.length && !game.done) { e.target.checked = Boolean(settings.hard); toast('Change hard mode before your first guess.'); return; }
    settings[k] = e.target.checked; save(); if (k === 'romaji') renderKeys(); if (k === 'notheme' && game) renderHints();
  });
});
const ime = $('ime');
ime.addEventListener('keydown', onKey);
ime.addEventListener('compositionend', (e) => { for (const ch of e.data || '') add(ch); ime.value = ''; });
ime.addEventListener('input', (e) => { if (!e.isComposing && ime.value) { for (const ch of ime.value) add(ch); ime.value = ''; } });
document.addEventListener('keydown', (e) => { if (e.target === ime || e.target.closest('input, select, textarea, button')) return; onKey(e); });
$('board').addEventListener('click', () => { if (!window.matchMedia('(pointer: coarse)').matches) ime.focus({ preventScroll: true }); });

start();
