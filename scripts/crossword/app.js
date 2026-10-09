// app.js — Kana Crossword player.
//
// Puzzles come from data/crossword/puzzles/DATE.json (built by cli.mjs).
// Answers are hiragana, small kana full size, ー allowed. Type romaji or kana,
// or use the on-screen kana keys. Progress, times and streaks stay in this
// browser (localStorage). Everything from data is inserted as text.

import { toHiragana } from '../kanji/romaji.js?v=1';
import { gridKana, cycleDakuten, romaji } from './kana.js?v=1';
import { translator, lang, setLang, dateLocale } from '../games/i18n.js?v=1';
import { plusEligible, plusCard, mountPlusSection } from './plus.js?v=4';

const $ = (id) => document.getElementById(id);
// replaceChildren() would print null/false as text
const fill = (el, ...kids) => el.replaceChildren(...kids.filter((k) => k != null && k !== false));
const KEY = 'jareddesu.crossword.v1';
const DATA = '../../data/crossword';

// ---------------------------------------------------------------- interface text
const t = translator({
  en: {
    'size.mini': 'Mini', 'size.daily': 'Daily',
    'level.beginner': 'Beginner', 'level.intermediate': 'Intermediate', 'level.advanced': 'Advanced', 'level.mixed': 'Mixed',
    'opt.beginner': 'Beginner · N5–N4', 'opt.intermediate': 'Intermediate · N3–N2', 'opt.advanced': 'Advanced · N1+', 'opt.mixed': 'Mixed · all levels, Japanese clues',
    'empty.level': 'There’s no {level} puzzle for this day yet. Try another level or day.',
    'ime.kanji': 'Only kana fit in the squares. Press Enter instead of converting to kanji.',
    level: 'Level', bar: 'Puzzle options', sizeGroup: 'Size', prev: 'Previous puzzle', next: 'Next puzzle', settings: 'Settings',
    today: 'Today · {date}',
    themeToday: 'Today’s theme', themeDay: 'Theme',
    check: 'Check', reveal: 'Reveal', square: 'Square', word: 'Word', puzzle: 'Puzzle', autocheck: 'Autocheck', clear: 'Clear puzzle',
    pause: 'Pause', paused: 'Paused', resume: 'Resume', prevClue: 'Previous clue', nextClue: 'Next clue',
    grid: 'Crossword grid', keys: 'Kana keyboard', ime: 'Type answers (romaji or kana)',
    'key.daku': 'Add dakuten or handakuten', 'key.del': 'Delete', 'key.next': 'Next clue',
    clueId: ({ num, dir }) => `${num}${dir === 'across' ? 'A' : 'D'}`,
    cell: ({ num, r, c }) => `${num ? `${num}, ` : ''}row ${r}, column ${c}`,
    keyword: 'Keyword ', kwLine: 'Keyword: ',
    'empty.soon': 'Today’s puzzle is on its way. Check back soon.',
    'empty.fail': 'Couldn’t load this puzzle. Try again in a moment.',
    'toast.newDay': 'A new day, a new puzzle.',
    'toast.out': 'Today’s puzzle is out. Use › to go to it.',
    'toast.wrong': ({ n }) => `${n} square${n === 1 ? '' : 's'} to fix.`,
    'toast.ok': 'Nothing wrong so far.',
    'toast.off': 'Not quite. Something’s off — try Check.',
    'confirm.clear': 'Clear this puzzle and start over? Your time resets too.',
    copied: 'Copied.',
    stats: ({ level, size, solved, best, streak, longest }) => `${level} ${size}: ${solved} solved · best ${best} · streak ${streak} (longest ${longest}).`,
    withReveals: ' · with reveals',
    listed: 'Every answer, with its kanji and meaning, is listed under the puzzle.',
    nextIn: 'Next puzzle in {time} (your midnight)',
    solved: 'solved', share: 'Copy result', doneClose: 'Keep looking', pastTitle: 'Past puzzles', close: 'Close',
    'th.word': 'Word', 'th.reading': 'Reading', 'th.meaning': 'Meaning', 'th.clue': 'Clue',
    shareText: ({ size, level, date, time, reveals }) => `Kana Crossword · ${size} · ${level} · ${date}\nSolved in ${time}${reveals ? ' (with reveals)' : ''} ✅`,
    'set.title': 'Settings', 'set.lang': 'Language',
    'set.romaji': 'Show romaji', 'set.romaji.d': 'under the kana keys.',
    'set.assist': 'Hide Check and Reveal', 'set.assist.d': 'for a solve with no help.',
    'set.words': 'Show answers and meanings', 'set.words.d': 'under the puzzle after you solve it.',
  },
  ja: {
    'size.mini': 'ミニ', 'size.daily': 'デイリー',
    'level.beginner': '初級', 'level.intermediate': '中級', 'level.advanced': '上級', 'level.mixed': '一般',
    'opt.beginner': '初級 · N5–N4', 'opt.intermediate': '中級 · N3–N2', 'opt.advanced': '上級 · N1+', 'opt.mixed': '一般 · 全レベル・日本語のカギ',
    'empty.level': 'この日の{level}パズルはまだありません。別のレベルか日付を選んでください。',
    'ime.kanji': 'マスに入るのはかなだけです。漢字に変換せず、そのまま確定してください。',
    level: 'レベル', bar: 'パズルの設定', sizeGroup: 'サイズ', prev: '前のパズル', next: '次のパズル', settings: '設定',
    today: '今日 · {date}',
    themeToday: '今日のテーマ', themeDay: 'テーマ',
    check: 'チェック', reveal: '答えを見る', square: 'マス', word: '単語', puzzle: '全体', autocheck: '自動チェック', clear: '最初からやり直す',
    pause: '一時停止', paused: '一時停止中', resume: '再開', prevClue: '前のカギ', nextClue: '次のカギ',
    grid: 'クロスワードの盤面', keys: 'かなキーボード', ime: '答えを入力（ローマ字・かな）',
    'key.daku': '濁点・半濁点をつける', 'key.del': '消す', 'key.next': '次のカギ',
    clueId: ({ num, dir }) => `${dir === 'across' ? 'ヨコ' : 'タテ'}${num}`,
    cell: ({ num, r, c }) => `${num ? `${num}番、` : ''}${r}行${c}列`,
    keyword: 'キーワード', kwLine: 'キーワード：',
    'empty.soon': '今日のパズルは準備中です。少し後でまた来てね。',
    'empty.fail': 'パズルを読み込めませんでした。少し待ってから試してください。',
    'toast.newDay': '日付が変わりました。新しいパズルです。',
    'toast.out': '今日のパズルが出ました。› で移動できます。',
    'toast.wrong': ({ n }) => `${n}マス間違っています。`,
    'toast.ok': '今のところ間違いはありません。',
    'toast.off': '惜しい！どこかが違います。チェックを使ってみて。',
    'confirm.clear': 'このパズルを最初からやり直しますか？タイムもリセットされます。',
    copied: 'コピーしました。',
    stats: ({ level, size, solved, best, streak, longest }) => `${level}${size}：${solved}回クリア · ベスト ${best} · 連続 ${streak}日（最長 ${longest}日）`,
    withReveals: ' · 答えを見て',
    listed: '答えの漢字と意味は、パズルの下に並んでいます。',
    nextIn: '次のパズルまで {time}（あなたの時間で0時）',
    solved: 'クリア', share: '結果をコピー', doneClose: '閉じる', pastTitle: '過去のパズル', close: '閉じる',
    'th.word': '単語', 'th.reading': '読み', 'th.meaning': '意味', 'th.clue': 'カギ',
    shareText: ({ size, level, date, time, reveals }) => `かなクロスワード · ${size} · ${level} · ${date}\n${time}でクリア${reveals ? '（答えを見て）' : ''} ✅`,
    'set.title': '設定', 'set.lang': '表示言語',
    'set.romaji': 'ローマ字を表示', 'set.romaji.d': '（かなキーの下に）',
    'set.assist': 'チェックと答えを隠す', 'set.assist.d': '（ヒントなしで解きたい人に）',
    'set.words': '答えと意味を表示', 'set.words.d': '（解いた後、パズルの下に）',
  },
});
const LEVEL_NAME = (l) => t(`level.${l}`);
const SIZE_NAME = (s) => t(`size.${s}`);
const LETTERS = 'ABCDEFGHIJ';
const coarse = window.matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- storage
function load() {
  try { return { settings: {}, progress: {}, stats: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { settings: {}, progress: {}, stats: {} }; }
}
const store = load();
let saveTimer = null;
function save(now = false) {
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };
  clearTimeout(saveTimer);
  if (now) write(); else saveTimer = setTimeout(write, 400);
}
window.addEventListener('pagehide', () => { stopClock(); save(true); });

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

// ---------------------------------------------------------------- dates
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (iso, year = true) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: year ? 'numeric' : undefined });
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

let dates = [];
let date = null;
let day = null;            // { date, puzzles }
let pz = null;             // the puzzle being played (with decoded key)
let st = null;             // its progress record
let cur = { r: 0, c: 0, dir: 'across' };
let romajiTail = '';

function decodeKey(s) {
  const bin = atob(String(s).split('').reverse().join(''));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

async function getJson(path) {
  const res = await fetch(`${DATA}/${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- setup
const settings = store.settings;
settings.size = settings.size || 'mini';
settings.level = settings.level || 'beginner';
if (settings.words == null) settings.words = true;

async function init() {
  try { dates = (await getJson('index.json')).dates || []; } catch { dates = []; }
  const today = localDate();
  const asked = new URLSearchParams(location.search).get('date');
  const pastOrToday = dates.filter((d) => d <= today);
  // Future puzzles are published early (so every time zone gets one at its midnight) but stay hidden
  date = asked && pastOrToday.includes(asked) ? asked : (pastOrToday[pastOrToday.length - 1] || null);
  t.apply();
  wireControls();
  wireSettings();
  buildKeys();
  await openDay();
  watchMidnight();
}

// A new puzzle at local midnight: if you're on today's puzzle when the date
// changes, move to the new day (your progress on the old one is saved)
function watchMidnight() {
  let day = localDate();
  setInterval(async () => {
    const now = localDate();
    if (now === day) return;
    const wasToday = date === day;
    day = now;
    try { dates = (await getJson('index.json')).dates || dates; } catch { /* keep the list */ }
    renderBar();
    if (wasToday && dates.includes(now) && !(st && !st.done && Object.keys(st.cells).length)) {
      date = now;
      history.replaceState(null, '', location.pathname);
      await openDay();
      toast(t('toast.newDay'));
    } else if (dates.includes(now)) toast(t('toast.out'));
  }, 30000);
}

const untilMidnight = () => {
  const now = new Date();
  const s = Math.max(0, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

async function openDay() {
  if (!date) { showEmpty(t('empty.soon')); return; }
  try { day = await getJson(`puzzles/${date}.json`); } catch { showEmpty(t('empty.fail')); return; }
  openPuzzle();
}

function showEmpty(msg) {
  $('play').hidden = true;
  $('empty').hidden = false;
  $('empty').textContent = msg;
}

function openPuzzle() {
  stopClock();
  const p = day.puzzles.find((x) => x.size === settings.size && x.level === settings.level);
  if (!p) { renderBar(); showEmpty(t('empty.level', { level: LEVEL_NAME(settings.level) })); return; }
  const key = decodeKey(p.key);
  pz = { ...p, key, cells: [] };
  // Cells: answer letter, number, the entries through it, keyword label
  for (let r = 0; r < p.height; r++) {
    for (let c = 0; c < p.width; c++) pz.cells.push({ r, c, black: p.grid[r][c] === '#', answer: key.rows[r][c], num: null, across: null, down: null, kw: null });
  }
  pz.entries = p.clues.map((cl) => {
    const k = key.entries.find((e) => e.num === cl.num && e.dir === cl.dir) || {};
    const cells = Array.from({ length: cl.len }, (_, i) => (cl.dir === 'across' ? [cl.row, cl.col + i] : [cl.row + i, cl.col]));
    return { ...cl, ...k, clue: cl.clue, cells, id: `${cl.num}${cl.dir[0]}` };
  });
  pz.entries.forEach((e) => {
    cell(e.row, e.col).num = e.num;
    e.cells.forEach(([r, c]) => { cell(r, c)[e.dir] = e; });
  });
  p.keyword.cells.forEach(([r, c], i) => { cell(r, c).kw = LETTERS[i]; });

  st = store.progress[p.id] = store.progress[p.id] || { cells: {}, wrong: {}, revealed: {}, time: 0, done: false };
  st.cells = st.cells || {}; st.wrong = st.wrong || {}; st.revealed = st.revealed || {};
  const first = pz.entries.find((e) => e.dir === 'across') || pz.entries[0];
  cur = { r: first.row, c: first.col, dir: first.dir };
  romajiTail = '';

  $('play').hidden = false;
  $('empty').hidden = true;
  document.body.dataset.size = p.size;
  document.body.dataset.level = p.level;
  renderBar();
  renderGrid();
  renderClues();
  renderKeyword();
  renderWords();
  renderStats();
  select(cur.r, cur.c, cur.dir);
  if (!st.done) startClock();
  else $('timer').textContent = fmtTime(st.time);
  if (!coarse) $('ime').focus({ preventScroll: true });
}

const cell = (r, c) => pz.cells[r * pz.width + c];
const clueLang = () => (pz.level === 'mixed' ? 'ja' : 'en');
const val = (r, c) => st.cells[`${r},${c}`] || '';

// ---------------------------------------------------------------- top bar
function renderBar() {
  document.querySelectorAll('#size-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.size === settings.size)));
  $('level').value = settings.level;
  const today = localDate();
  $('date-label').textContent = date ? (date === today ? t('today', { date: fmtDate(date, false) }) : fmtDate(date)) : '';
  // The day's loose theme (days before Oct 6, 2026 don't have one)
  const th = day && day.date === date ? day.theme : null;
  $('theme').hidden = !th;
  if (th) {
    const ja = lang() === 'ja';
    $('theme-k').textContent = t(date === today ? 'themeToday' : 'themeDay');
    $('theme-name').textContent = ja ? th.ja : th.en;
    $('theme-name').lang = ja ? 'ja' : 'en';
    $('theme-ja').textContent = ja ? th.en : th.ja;
    $('theme-ja').lang = ja ? 'en' : 'ja';
  }
  const i = dates.indexOf(date);
  $('date-prev').disabled = i <= 0;
  $('date-next').disabled = i < 0 || i >= dates.length - 1 || dates[i + 1] > today;
}

function wireControls() {
  document.querySelectorAll('#size-seg button').forEach((b) => b.addEventListener('click', () => { settings.size = b.dataset.size; save(); openPuzzle(); }));
  $('level').addEventListener('change', (e) => { settings.level = e.target.value; save(); openPuzzle(); });
  const go = (d) => { date = d; history.replaceState(null, '', d === localDate() ? location.pathname : `?date=${d}`); openDay(); };
  $('date-prev').addEventListener('click', () => { const i = dates.indexOf(date); if (i > 0) go(dates[i - 1]); });
  $('date-next').addEventListener('click', () => { const i = dates.indexOf(date); if (i < dates.length - 1) go(dates[i + 1]); });
  $('date-label').addEventListener('click', () => openDates(go));
  $('dates-close').addEventListener('click', () => { $('dates').hidden = true; });
  $('dates').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('dates').hidden = true; });
  $('timer').addEventListener('click', () => { if (st && !st.done) pause(); });
  $('resume').addEventListener('click', resume);
  $('clue-prev').addEventListener('click', () => nextEntry(-1));
  $('clue-next').addEventListener('click', () => nextEntry(1));
  $('clue-text').addEventListener('click', () => toggleDir());
  document.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => { check(b.dataset.check); b.closest('details').open = false; }));
  document.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => { reveal(b.dataset.reveal); b.closest('details').open = false; }));
  $('autocheck').checked = Boolean(settings.autocheck);
  $('autocheck').addEventListener('change', (e) => { settings.autocheck = e.target.checked; save(); if (settings.autocheck) check('puzzle', { quiet: true }); });
  document.addEventListener('click', (e) => document.querySelectorAll('.cw-menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
  $('done-close').addEventListener('click', () => { $('done').hidden = true; });
  $('done-share').addEventListener('click', share);
  // Typing
  const ime = $('ime');
  ime.addEventListener('keydown', onKey);
  // Japanese IME: show the word being composed in the squares, then fill
  // them when it's committed (Enter). Kanji can't go in a square.
  ime.addEventListener('compositionstart', () => { placeIme(); });
  ime.addEventListener('compositionupdate', (e) => showComposition(e.data || ''));
  ime.addEventListener('compositionend', (e) => {
    showComposition('');
    composedAt = Date.now();
    const text = e.data || '';
    if (/[^ぁ-ゖァ-ヺー・\s]/.test(text) && !/^[a-z']+$/i.test(text)) toast(t('ime.kanji'));
    typeText(text);
    ime.value = '';
  });
  ime.addEventListener('input', (e) => {
    if (e.isComposing) return;
    if (Date.now() - composedAt < 80) { ime.value = ''; return; }     // Safari repeats the committed text
    if (ime.value) { typeText(ime.value); ime.value = ''; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target === ime || e.target.closest('input, select, textarea, details, button') || !pz || $('play').hidden) return;
    if (!$('done').hidden || !$('dates').hidden || !$('settings').hidden) return;
    onKey(e);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopClock(); else if (pz && !st.done && $('paused').hidden) startClock(); });
}

// ---------------------------------------------------------------- settings
function wireSettings() {
  const sheet = $('settings');
  const close = () => { sheet.hidden = true; if (pz && !st.done && $('paused').hidden) startClock(); };
  $('btn-settings').addEventListener('click', () => { stopClock(); sheet.hidden = false; });
  $('settings-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) close(); });
  sheet.querySelectorAll('[data-lang-seg] button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); relabel(); }));
  [['opt-romaji', 'romaji'], ['opt-noassist', 'noassist'], ['opt-words', 'words']].forEach(([id, k]) => {
    $(id).checked = Boolean(settings[k]);
    $(id).addEventListener('change', (e) => {
      settings[k] = e.target.checked;
      save();
      if (k === 'romaji') $('keys').classList.toggle('show-romaji', settings.romaji);
      if (k === 'noassist') applyAssist();
      if (k === 'words' && pz) { renderWords(); renderKeyword(); }
    });
  });
  applyAssist();
}
function applyAssist() { $('play').classList.toggle('no-assist', Boolean(settings.noassist)); }

// Language switch: redraw everything that has text in it (progress is untouched)
function relabel() {
  t.apply();
  buildKeys();
  mountPlusSection();
  if (!pz) { if (date) renderBar(); return; }
  renderBar();
  renderGrid();
  renderClues();
  renderKeyword();
  renderWords();
  renderStats();
  select(cur.r, cur.c, cur.dir);
}

function openDates(go) {
  const today = localDate();
  const list = $('date-list');
  list.replaceChildren(...dates.filter((d) => d <= today).reverse().map((d) => {
    const done = ['mini', 'daily'].filter((s) => (store.progress[`${d}-${settings.level}-${s}`] || {}).done);
    return h('li', {}, h('button', { type: 'button', class: d === date ? 'is-on' : '', onclick: () => { $('dates').hidden = true; go(d); } },
      h('span', {}, fmtDate(d)), h('span', { class: 'cw-date-done' }, done.map((s) => `${SIZE_NAME(s)} ✓`).join(' · '))));
  }));
  $('dates').hidden = false;
}

// ---------------------------------------------------------------- grid
function renderGrid() {
  const g = $('grid');
  g.style.setProperty('--n', pz.width);
  g.replaceChildren(...pz.cells.map((x) => {
    if (x.black) return h('div', { class: 'cw-cell is-black', 'aria-hidden': 'true' });
    const el = h('div', {
      class: `cw-cell${x.kw ? ' is-kw' : ''}`, role: 'gridcell', 'data-r': x.r, 'data-c': x.c,
      'aria-label': t('cell', { num: x.num, r: x.r + 1, c: x.c + 1 }),
      onclick: () => {
        const same = cur.r === x.r && cur.c === x.c;
        select(x.r, x.c, same ? otherDir(x) : (x[cur.dir] ? cur.dir : otherDir(x)));
        if (!coarse) $('ime').focus({ preventScroll: true });
      },
    },
    x.num ? h('span', { class: 'cw-num' }, x.num) : null,
    h('span', { class: 'cw-letter', lang: 'ja' }),
    x.kw ? h('span', { class: 'cw-kw' }, x.kw) : null);
    x.el = el;
    return el;
  }));
  pz.cells.forEach((x) => { if (!x.black) paintCell(x); });
}

function paintCell(x) {
  const k = `${x.r},${x.c}`;
  x.el.querySelector('.cw-letter').textContent = st.cells[k] || '';
  x.el.classList.toggle('is-wrong', Boolean(st.wrong[k]));
  x.el.classList.toggle('is-revealed', Boolean(st.revealed[k]));
  x.el.classList.toggle('is-done', st.done);
}

const otherDir = (x) => (cur.dir === 'across' ? (x.down ? 'down' : 'across') : (x.across ? 'across' : 'down'));
const entryAt = (r, c, dir) => cell(r, c)[dir] || cell(r, c)[dir === 'across' ? 'down' : 'across'];

function select(r, c, dir) {
  const x = cell(r, c);
  if (!x || x.black) return;
  if (!x[dir]) dir = dir === 'across' ? 'down' : 'across';
  cur = { r, c, dir };
  romajiTail = '';
  const e = x[dir];
  const cross = x[dir === 'across' ? 'down' : 'across'];
  pz.cells.forEach((y) => {
    if (y.black) return;
    y.el.classList.toggle('is-cur', y === x);
    y.el.classList.toggle('is-word', y[dir] === e);
    y.el.querySelector('.cw-letter').dataset.tail = '';
  });
  placeIme();
  // Clue bar and list
  $('clue-text').replaceChildren(h('strong', {}, t('clueId', e)), ' ', h('span', { lang: clueLang() }, e.clue), h('span', { class: 'cw-len' }, ` (${e.len})`));
  document.querySelectorAll('.cw-clue-list li').forEach((li) => {
    li.classList.toggle('is-cur', li.dataset.id === e.id);
    li.classList.toggle('is-cross', Boolean(cross) && li.dataset.id === cross.id);
  });
  const li = document.querySelector(`.cw-clue-list li[data-id="${e.id}"]`);
  if (li && !coarse) li.scrollIntoView({ block: 'nearest' });
}

function toggleDir() {
  const x = cell(cur.r, cur.c);
  const d = cur.dir === 'across' ? 'down' : 'across';
  if (x[d]) select(cur.r, cur.c, d);
}

// ---------------------------------------------------------------- clues
function renderClues() {
  for (const dir of ['across', 'down']) {
    $(`clues-${dir}`).replaceChildren(...pz.entries.filter((e) => e.dir === dir).map((e) => h('li', {
      'data-id': e.id, onclick: () => { const [r, c] = firstEmpty(e); select(r, c, dir); if (!coarse) $('ime').focus({ preventScroll: true }); },
    }, h('span', { class: 'cw-clue-num' }, e.num), h('span', { class: 'cw-clue-body', lang: clueLang() }, e.clue, h('span', { class: 'cw-len' }, ` (${e.len})`)))));
  }
  markFilledClues();
}

function markFilledClues() {
  pz.entries.forEach((e) => {
    const li = document.querySelector(`.cw-clue-list li[data-id="${e.id}"]`);
    if (li) li.classList.toggle('is-filled', e.cells.every(([r, c]) => val(r, c)));
  });
}

const firstEmpty = (e) => e.cells.find(([r, c]) => !val(r, c)) || e.cells[0];

function nextEntry(step) {
  const list = [...pz.entries.filter((e) => e.dir === 'across'), ...pz.entries.filter((e) => e.dir === 'down')];
  const e = entryAt(cur.r, cur.c, cur.dir);
  let i = list.indexOf(e);
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length;
    if (st.done || list[i].cells.some(([r, c]) => !val(r, c)) || n === list.length - 1) break;
  }
  const t = list[i];
  const [r, c] = firstEmpty(t);
  select(r, c, t.dir);
}

// ---------------------------------------------------------------- keyword
function renderKeyword() {
  const k = pz.keyword;
  fill($('keyword'), 
    h('p', { class: 'cw-kw-clue' }, h('strong', {}, t('keyword')), h('span', { lang: 'ja' }, '（二重マス）'), ' ', h('span', { lang: clueLang() }, k.clue)),
    h('div', { class: 'cw-kw-boxes' }, k.cells.map(([r, c], i) => h('span', { class: 'cw-kw-box' }, h('span', { class: 'cw-kw-label' }, LETTERS[i]), h('span', { lang: 'ja' }, val(r, c))))),
    st.done ? h('p', { class: 'cw-kw-answer' }, h('span', { lang: 'ja' }, pz.key.keyword.word), ` (${pz.key.keyword.reading})`, settings.words ? h('span', { lang: 'en' }, ` · ${pz.key.keyword.meaning}`) : null) : null);
}

// ---------------------------------------------------------------- typing
function onKey(e) {
  // keyCode 229: a key the IME is handling (Safari sends the committing Enter this way)
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
  if (e.key === 'Enter' && Date.now() - composedAt < 80) return;
  const k = e.key;
  const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
  if (move) {
    e.preventDefault();
    const dir = move[0] ? 'down' : 'across';
    if (cur.dir !== dir && cell(cur.r, cur.c)[dir]) { select(cur.r, cur.c, dir); return; }
    step(move[0], move[1]);
    return;
  }
  if (k === 'Tab' || k === 'Enter') { e.preventDefault(); nextEntry(e.shiftKey ? -1 : 1); return; }
  if (k === ' ') { e.preventDefault(); toggleDir(); return; }
  if (k === 'Backspace') { e.preventDefault(); if (romajiTail) { romajiTail = romajiTail.slice(0, -1); showTail(); } else backspace(); return; }
  if (k === 'Delete') { e.preventDefault(); setCell(cur.r, cur.c, ''); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === '-' || k === 'ー') { e.preventDefault(); romajiTail = ''; put('ー'); return; }
  if (/^[a-z']$/i.test(k)) {
    e.preventDefault();
    const conv = toHiragana(romajiTail + k.toLowerCase());
    const m = conv.match(/^([^a-z']*)([a-z']*)$/);
    romajiTail = m ? m[2] : '';
    if (m && m[1]) typeText(m[1], { keepTail: true });
    showTail();
    return;
  }
  if (k.length === 1 && /[ぁ-ゖァ-ヶー]/.test(k)) { e.preventDefault(); typeText(k); }
}

// The hidden input sits on the current square so the IME's candidate list opens next to it
function placeIme() {
  const x = pz && cell(cur.r, cur.c);
  if (!x || !x.el) return;
  const r = x.el.getBoundingClientRect();
  Object.assign($('ime').style, { left: `${r.left}px`, top: `${r.bottom}px` });
}

let composedAt = 0;
let previewCells = [];
function showComposition(text) {
  previewCells.forEach((x) => { x.el.classList.remove('is-preview'); x.el.querySelector('.cw-letter').dataset.tail = ''; paintCell(x); });
  previewCells = [];
  if (!text || !pz || st.done) { showTail(); return; }
  // Kana so far (each in its own square from the cursor on), then any romaji still being typed
  const m = text.match(/^([^a-z']*)([a-z']*)$/i) || ['', text, ''];
  const kana = [...m[1]].map((ch) => (ch === 'ー' ? 'ー' : gridKana(ch))).filter(Boolean);
  const e = entryAt(cur.r, cur.c, cur.dir);
  const i = e.cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
  const cells = e.cells.slice(i).map(([r, c]) => cell(r, c));
  kana.slice(0, cells.length).forEach((k, j) => {
    const x = cells[j];
    x.el.querySelector('.cw-letter').textContent = k;
    x.el.classList.add('is-preview');
    previewCells.push(x);
  });
  const next = cells[kana.length];
  if (next && m[2]) { next.el.querySelector('.cw-letter').dataset.tail = m[2]; next.el.classList.add('is-preview'); previewCells.push(next); }
}

function showTail() {
  const x = cell(cur.r, cur.c);
  x.el.querySelector('.cw-letter').dataset.tail = romajiTail;
}

function typeText(text, { keepTail = false } = {}) {
  if (!keepTail) romajiTail = '';
  for (const ch of text) {
    const g = ch === 'ー' ? 'ー' : gridKana(ch);
    if (g) put(g);
  }
  showTail();
}

function put(ch) {
  if (st.done) return;
  setCell(cur.r, cur.c, ch);
  advance();
}

function setCell(r, c, ch) {
  const k = `${r},${c}`;
  if (st.revealed[k] && st.done) return;
  if (ch) st.cells[k] = ch; else delete st.cells[k];
  delete st.wrong[k];
  paintCell(cell(r, c));
  if (settings.autocheck && ch && ch !== cell(r, c).answer) { st.wrong[k] = 1; paintCell(cell(r, c)); }
  markFilledClues();
  renderKeyword();
  save();
  checkSolved();
}

function advance() {
  const e = entryAt(cur.r, cur.c, cur.dir);
  const i = e.cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
  // Next empty square in this word, else the next square, else the next clue
  const rest = e.cells.slice(i + 1);
  const nextEmpty = rest.find(([r, c]) => !val(r, c));
  if (nextEmpty) { moveTo(nextEmpty[0], nextEmpty[1]); return; }
  if (rest.length) { moveTo(rest[0][0], rest[0][1]); return; }
  // End of the word: back to an empty square in it, else on to the next clue
  const earlier = e.cells.find(([r, c]) => !val(r, c));
  if (earlier) moveTo(earlier[0], earlier[1]);
  else if (!st.done) nextEntry(1);
}

function moveTo(r, c) {
  cur.r = r; cur.c = c;
  select(r, c, cur.dir);
}

function step(dr, dc) {
  let r = cur.r + dr, c = cur.c + dc;
  while (r >= 0 && c >= 0 && r < pz.height && c < pz.width) {
    if (!cell(r, c).black) { select(r, c, cur.dir); return; }
    r += dr; c += dc;
  }
}

function backspace() {
  if (val(cur.r, cur.c)) { setCell(cur.r, cur.c, ''); return; }
  const e = entryAt(cur.r, cur.c, cur.dir);
  const i = e.cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
  if (i > 0) { const [r, c] = e.cells[i - 1]; moveTo(r, c); setCell(r, c, ''); }
}

// Dakuten key: changes this square, or the one just typed
function dakuten() {
  let { r, c } = cur;
  if (!val(r, c)) {
    const e = entryAt(r, c, cur.dir);
    const i = e.cells.findIndex(([y, x]) => y === r && x === c);
    if (i > 0) [r, c] = e.cells[i - 1];
  }
  const v = val(r, c);
  if (!v) return;
  const n = cycleDakuten(v);
  if (n !== v) setCell(r, c, n);
}

// ---------------------------------------------------------------- on-screen keys
const KEY_ROWS = [
  'あかさたなはまやらわ',
  'いきしちにひみゆりを',
  'うくすつぬふむよるん',
  'えけせてねへめーれ゛',
  'おこそとのほも⌫ろ↵',
];
function buildKeys() {
  const keys = $('keys');
  keys.replaceChildren(...KEY_ROWS.flatMap((row) => [...row].map((k) => h('button', {
    type: 'button', class: `cw-key${'゛⌫↵'.includes(k) ? ' is-fn' : ''}`, lang: 'ja',
    'aria-label': { '゛': t('key.daku'), '⌫': t('key.del'), '↵': t('key.next') }[k] || k,
    onpointerdown: (e) => { e.preventDefault(); },
    onclick: () => {
      if (!pz || st.done && k !== '↵') return;
      if (k === '⌫') backspace();
      else if (k === '↵') nextEntry(1);
      else if (k === '゛') dakuten();
      else put(k);
    },
  }, k === '゛' ? '゛゜' : k, '゛⌫↵ー'.includes(k) ? null : h('span', { class: 'cw-key-r' }, romaji(k))))));
  keys.classList.toggle('show-romaji', Boolean(settings.romaji));
}

// ---------------------------------------------------------------- check / reveal
function scope(what) {
  if (what === 'cell') return [[cur.r, cur.c]];
  if (what === 'word') return entryAt(cur.r, cur.c, cur.dir).cells;
  return pz.cells.filter((x) => !x.black).map((x) => [x.r, x.c]);
}

function check(what, { quiet = false } = {}) {
  let wrong = 0;
  scope(what).forEach(([r, c]) => {
    const v = val(r, c);
    const k = `${r},${c}`;
    if (v && v !== cell(r, c).answer) { st.wrong[k] = 1; wrong++; } else delete st.wrong[k];
    paintCell(cell(r, c));
  });
  st.checked = true;
  save();
  if (!quiet) toast(wrong ? t('toast.wrong', { n: wrong }) : t('toast.ok'));
}

function reveal(what) {
  if (what === 'clear') {
    if (!confirm(t('confirm.clear'))) return;
    store.progress[pz.id] = { cells: {}, wrong: {}, revealed: {}, time: 0, done: false };
    save(true);
    openPuzzle();
    return;
  }
  scope(what).forEach(([r, c]) => {
    const k = `${r},${c}`;
    if (val(r, c) !== cell(r, c).answer) { st.cells[k] = cell(r, c).answer; st.revealed[k] = 1; }
    delete st.wrong[k];
    paintCell(cell(r, c));
  });
  markFilledClues();
  renderKeyword();
  save();
  checkSolved();
}

function checkSolved() {
  if (st.done) return;
  const open = pz.cells.filter((x) => !x.black);
  if (!open.every((x) => val(x.r, x.c))) return;
  if (!open.every((x) => val(x.r, x.c) === x.answer)) { toast(t('toast.off')); return; }
  st.done = true;
  st.solvedAt = Date.now();
  stopClock();
  const assisted = Object.keys(st.revealed).length > 0;
  recordStats(assisted);
  save(true);
  pz.cells.forEach((x) => { if (!x.black) paintCell(x); });
  renderKeyword();
  renderWords();
  renderStats();
  celebrate(assisted);
}

// ---------------------------------------------------------------- clock
let clock = null;
let tickFrom = 0;
function startClock() {
  stopClock();
  tickFrom = Date.now();
  clock = setInterval(() => {
    const now = Date.now();
    st.time += (now - tickFrom) / 1000;
    tickFrom = now;
    $('timer').textContent = fmtTime(st.time);
    save();
  }, 1000);
  $('timer').textContent = fmtTime(st.time);
}
function stopClock() {
  if (!clock) return;
  clearInterval(clock);
  clock = null;
  if (st) st.time += (Date.now() - tickFrom) / 1000;
}
function pause() {
  stopClock();
  $('paused').hidden = false;
  $('grid').classList.add('is-hidden');
  save();
}
function resume() {
  $('paused').hidden = true;
  $('grid').classList.remove('is-hidden');
  startClock();
  if (!coarse) $('ime').focus({ preventScroll: true });
}

// ---------------------------------------------------------------- results
function recordStats(assisted) {
  const k = `${pz.level}-${pz.size}`;
  const s = store.stats[k] = store.stats[k] || { solved: 0, clean: 0, best: null, streak: 0, longest: 0, last: null };
  s.solved++;
  if (!assisted) {
    s.clean++;
    s.best = s.best == null ? st.time : Math.min(s.best, st.time);
  }
  // Streak: solving each day's puzzle in a row (by puzzle date)
  const prev = dates[dates.indexOf(date) - 1];
  s.streak = s.last && (s.last === prev || s.last === date) ? (s.last === date ? s.streak : s.streak + 1) : 1;
  s.last = date > (s.last || '') ? date : s.last;
  s.longest = Math.max(s.longest, s.streak);
}

function renderStats() {
  const s = store.stats[`${pz.level}-${pz.size}`];
  $('stats').textContent = s
    ? t('stats', { level: LEVEL_NAME(pz.level), size: SIZE_NAME(pz.size), solved: s.solved, best: s.best != null ? fmtTime(s.best) : '—', streak: s.streak, longest: s.longest })
    : '';
}

let nextTimer = null;
function celebrate(assisted) {
  const kw = pz.key.keyword;
  fill($('done-body'), 
    h('p', { class: 'cw-done-time' }, fmtTime(st.time), assisted ? h('span', { class: 'cw-muted' }, t('withReveals')) : null),
    h('p', {}, `${LEVEL_NAME(pz.level)} ${SIZE_NAME(pz.size)} · ${fmtDate(date)}`),
    h('p', { class: 'cw-done-kw' }, t('kwLine'), h('strong', { lang: 'ja' }, kw.word), ` (${kw.reading})`, settings.words ? h('span', { lang: 'en' }, ` · ${kw.meaning}`) : null),
    settings.words ? h('p', { class: 'cw-muted' }, t('listed')) : null,
    date === localDate() ? h('p', { class: 'cw-next', id: 'cw-next' }, t('nextIn', { time: untilMidnight() })) : null);
  // The Crossword+ question (or "you're on the list"); see plus.js for when it shows
  fill($('done-plus'), plusEligible() ? plusCard() : null);
  clearInterval(nextTimer);
  nextTimer = setInterval(() => { const el = $('cw-next'); if (!el || $('done').hidden) { clearInterval(nextTimer); return; } el.textContent = t('nextIn', { time: untilMidnight() }); }, 1000);
  $('done').hidden = false;
  $('done-share').focus();
}

function share() {
  const text = `${t('shareText', { size: SIZE_NAME(pz.size), level: LEVEL_NAME(pz.level), date: fmtDate(date), time: fmtTime(st.time), reveals: Object.keys(st.revealed).length > 0 })}\nhttps://www.jareddesu.com/tools/crossword/`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(t('copied')), () => toast(text));
}

function renderWords() {
  const sec = $('words-sec');
  if (!st.done || !settings.words) { sec.hidden = true; return; }
  sec.hidden = false;
  const rows = pz.entries.slice().sort((a, b) => a.num - b.num || (a.dir === 'across' ? -1 : 1));
  $('words').replaceChildren(h('table', { class: 'cw-words' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, t('th.word')), h('th', {}, t('th.reading')), h('th', {}, t('th.meaning')), h('th', {}, t('th.clue')))),
    h('tbody', {}, rows.map((e) => h('tr', {},
      h('td', { class: 'cw-muted' }, t('clueId', e)),
      h('td', { lang: 'ja', class: 'cw-word' }, e.word),
      h('td', { lang: 'ja' }, e.reading),
      h('td', { lang: 'en' }, e.meaning),
      h('td', { class: 'cw-muted', lang: clueLang() }, e.clue))))));
}

// ---------------------------------------------------------------- toast
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

mountPlusSection();
init();
