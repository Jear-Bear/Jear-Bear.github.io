// app.js — Japanese Crossword player.
//
// Three modes:
//   かな   puzzles from data/crossword/puzzles/DATE.json (built by cli.mjs).
//          Answers are hiragana, small kana full size, ー allowed. Type romaji
//          or kana, or use the on-screen kana keys.
//   漢字   the same files (mode: "kanji"): answers in kanji, one per square,
//          typed with a Japanese IME or picked from tiles under the grid.
//   Crossword+  members only (sign in and Stripe: account.js): puzzles made
//          from the player's own Anki deck, in this browser, and bonus
//          puzzles (deck.js).
// Progress, times and streaks are kept in this browser (localStorage), and for a
// signed-in person also on their account, so they follow them between devices (sync.js).
// Everything from data is inserted as text.

import { toHiragana } from '../kanji/romaji.js?v=1';
import { gridKana, cycleDakuten, romaji } from './kana.js?v=1';
import { translator, lang, setLang, dateLocale } from '../games/i18n.js?v=1';
import { plusEligible, plusCard, mountPlusSection } from './plus.js?v=12';
import { mountDeck } from './deck.js?v=9';
import { openBrowse } from './browse.js?v=2';
import { initSync, schedulePush } from './sync.js?v=1';
import { handleReturn, refresh, isMember, onAccount, archiveDay, currentUser, logout, info as plusInfo } from './account.js?v=3';
import { rng } from './construct.mjs?v=1';

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
    'ime.convert': 'Convert to kanji before pressing Enter, or tap a tile.',
    'kanji.type': 'Type with a Japanese keyboard (IME) and convert to kanji, or tap the tiles under the grid.',
    modeGroup: 'Mode', 'mode.kana': 'Kana', 'mode.kanji': 'Kanji', 'mode.deck': 'My deck',
    'acct.signIn': 'Sign in to Crossword+', 'acct.as': 'Signed in as {email}', 'acct.out': 'Sign out',
    locked: '<b>Past puzzles are part of Crossword+</b>, along with unlimited My deck crosswords and weekly bonus puzzles. Today’s puzzles are always free.', plusName: 'Crossword+', toToday: 'Go to today’s puzzle', seePlus: 'See Crossword+',
    tiles: 'Kanji tiles', 'empty.deck': '',
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
    'toast.off': 'Not quite. Something’s off — try Check.',
    'confirm.clear': 'Clear this puzzle and start over? Your time resets too.',
    copied: 'Copied.',
    stats: ({ level, size, solved, best, streak, longest }) => `${level} ${size}: ${solved} solved · best ${best} · streak ${streak} (longest ${longest}).`,
    withReveals: ' · with reveals',
    listed: 'Every answer, with its kanji and meaning, is listed under the puzzle.',
    nextIn: 'Next puzzle in {time} (your midnight)',
    solved: 'solved', share: 'Copy result', doneClose: 'Keep looking', pastTitle: 'Past puzzles', close: 'Close',
    'th.word': 'Word', 'th.reading': 'Reading', 'th.meaning': 'Meaning', 'th.clue': 'Clue',
    shareText: ({ mode, size, level, date, time, reveals }) => `Japanese Crossword · ${mode ? `${mode} · ` : ''}${size} · ${level} · ${date}\nSolved in ${time}${reveals ? ' (with reveals)' : ''} ✅`,
    deckLine: ({ name }) => `From your deck: ${name}`,
    'set.title': 'Settings', 'set.lang': 'Language',
    'set.romaji': 'Show romaji', 'set.romaji.d': 'under the kana keys.',
    'set.assist': 'Hide Check and Reveal', 'set.assist.d': 'for a solve with no help.',
    'set.words': 'Show answers and meanings', 'set.words.d': 'under the puzzle after you solve it.',
    'set.display': 'Display', 'set.clues': 'Clues', 'set.clueLang': 'Clue language', 'set.clueLang.auto': 'Auto (English; Japanese for Mixed)', 'set.clueLang.en': 'English', 'set.clueLang.ja': 'Japanese',
    'set.clueStyle': 'Clue style', 'set.clueStyle.fun': 'Fun hints, like a real crossword', 'set.clueStyle.def': 'Plain definitions',
    'set.typing': 'Typing', 'set.arrows': 'After an arrow key changes direction', 'set.arrows.stay': 'Stay in the same square', 'set.arrows.move': 'Move in the arrow’s direction',
    'set.space': 'The spacebar should', 'set.space.toggle': 'Switch between Across and Down', 'set.space.clear': 'Clear the square and move on',
    'set.backInto': 'Backspace into the previous word', 'set.backInto.d': 'from the first square of a word.',
    'set.skip': 'Skip over filled squares', 'set.skip.d': 'inside a word.',
    'set.jumpBack': 'At the end of a word, jump back', 'set.jumpBack.d': 'to its first empty square.',
    'set.nextClue': 'At the end of a word, go to the next clue', 'set.nextClue.d': '(when not jumping back).',
    'set.timer': 'Show the timer', 'set.timer.d': '(it keeps counting either way).',
    'set.readings': 'Show readings in kanji clues', 'set.readings.d': 'an easier kanji puzzle (Mixed always shows them).',
  },
  ja: {
    'size.mini': 'ミニ', 'size.daily': 'デイリー',
    'level.beginner': '初級', 'level.intermediate': '中級', 'level.advanced': '上級', 'level.mixed': '一般',
    'opt.beginner': '初級 · N5–N4', 'opt.intermediate': '中級 · N3–N2', 'opt.advanced': '上級 · N1+', 'opt.mixed': '一般 · 全レベル・日本語のカギ',
    'empty.level': 'この日の{level}パズルはまだありません。別のレベルか日付を選んでください。',
    'ime.kanji': 'マスに入るのはかなだけです。漢字に変換せず、そのまま確定してください。',
    'ime.convert': '漢字に変換してから確定するか、タイルをタップしてください。',
    'kanji.type': '日本語入力（IME）で漢字に変換して入力するか、盤面の下のタイルをタップしてください。',
    modeGroup: 'モード', 'mode.kana': 'かな', 'mode.kanji': '漢字', 'mode.deck': 'マイデッキ',
    'acct.signIn': 'クロスワード＋にログイン', 'acct.as': '{email} でログイン中', 'acct.out': 'ログアウト',
    locked: '<b>過去のパズルはクロスワード＋の特典です</b>。デッキのクロスワード作り放題、毎週のボーナスパズルも。今日のパズルはいつでも無料です。', plusName: 'クロスワード＋', toToday: '今日のパズルへ', seePlus: 'クロスワード＋を見る',
    tiles: '漢字タイル', 'empty.deck': '',
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
    'toast.off': '惜しい！どこかが違います。チェックを使ってみて。',
    'confirm.clear': 'このパズルを最初からやり直しますか？タイムもリセットされます。',
    copied: 'コピーしました。',
    stats: ({ level, size, solved, best, streak, longest }) => `${level}${size}：${solved}回クリア · ベスト ${best} · 連続 ${streak}日（最長 ${longest}日）`,
    withReveals: ' · 答えを見て',
    listed: '答えの漢字と意味は、パズルの下に並んでいます。',
    nextIn: '次のパズルまで {time}（あなたの時間で0時）',
    solved: 'クリア', share: '結果をコピー', doneClose: '閉じる', pastTitle: '過去のパズル', close: '閉じる',
    'th.word': '単語', 'th.reading': '読み', 'th.meaning': '意味', 'th.clue': 'カギ',
    shareText: ({ mode, size, level, date, time, reveals }) => `日本語クロスワード · ${mode ? `${mode} · ` : ''}${size} · ${level} · ${date}\n${time}でクリア${reveals ? '（答えを見て）' : ''} ✅`,
    deckLine: ({ name }) => `マイデッキ：${name}`,
    'set.title': '設定', 'set.lang': '表示言語',
    'set.romaji': 'ローマ字を表示', 'set.romaji.d': '（かなキーの下に）',
    'set.assist': 'チェックと答えを隠す', 'set.assist.d': '（ヒントなしで解きたい人に）',
    'set.words': '答えと意味を表示', 'set.words.d': '（解いた後、パズルの下に）',
    'set.display': '表示', 'set.clues': 'カギ', 'set.clueLang': 'カギの言語', 'set.clueLang.auto': '自動（英語。一般は日本語）', 'set.clueLang.en': '英語', 'set.clueLang.ja': '日本語',
    'set.clueStyle': 'カギのスタイル', 'set.clueStyle.fun': 'クロスワードらしい遊び心のあるヒント', 'set.clueStyle.def': 'ふつうの意味（定義）',
    'set.typing': '入力', 'set.arrows': '矢印キーで向きが変わったとき', 'set.arrows.stay': '同じマスにとどまる', 'set.arrows.move': '矢印の方向へ進む',
    'set.space': 'スペースキーで', 'set.space.toggle': 'ヨコとタテを切り替え', 'set.space.clear': 'マスを消して次へ',
    'set.backInto': 'バックスペースで前の言葉に戻る', 'set.backInto.d': '（言葉の最初のマスから）',
    'set.skip': '入力済みのマスを飛ばす', 'set.skip.d': '（言葉の中で）',
    'set.jumpBack': '言葉の最後で、空いているマスに戻る', 'set.jumpBack.d': '（最初の空きマスへ）',
    'set.nextClue': '言葉の最後で、次のカギへ', 'set.nextClue.d': '（戻らないとき）',
    'set.timer': 'タイマーを表示', 'set.timer.d': '（非表示でも計測は続きます）',
    'set.readings': '漢字のカギに読みを表示', 'set.readings.d': '（やさしくなります。一般はいつも表示）',
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
  schedulePush();
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
settings.mode = ['kana', 'kanji', 'deck'].includes(settings.mode) ? settings.mode : 'kana';
const MODES = ['kana', 'kanji', 'deck'];
const SIZE_SUB = { kana: { mini: '5×5', daily: '9×9' }, kanji: { mini: '5×5', daily: '8×8' } };
let deck = null;              // deck.js controller (My deck)
if (settings.words == null) settings.words = true;
// Typing options (like the NYT's). Defaults keep how the page has always behaved.
const TYPING_DEFAULTS = { clueLang: 'auto', clueStyle: 'fun', arrowMove: false, spaceClear: false, backInto: false, skipFilled: true, jumpBack: true, nextClue: true, showTimer: true };
Object.entries(TYPING_DEFAULTS).forEach(([k, v]) => { if (settings[k] == null) settings[k] = v; });

async function init() {
  try { dates = (await getJson('index.json')).dates || []; } catch { dates = []; }
  const today = localDate();
  const asked = new URLSearchParams(location.search).get('date');
  const pastOrToday = dates.filter((d) => d <= today);
  // Future puzzles are published early (so every time zone gets one at its midnight) but stay hidden
  date = asked && pastOrToday.includes(asked) ? asked : (pastOrToday[pastOrToday.length - 1] || null);
  t.apply();
  deck = mountDeck({ root: $('deck'), play: (p) => { settings.mode = 'deck'; save(); openPuzzle(p); $('play').scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
  // Signed in: progress, stats and deck puzzles follow the account between devices (sync.js)
  initSync({
    get: () => ({ progress: store.progress, stats: store.stats }),
    set: ({ progress, stats }) => {
      const before = pz && store.progress[pz.id];
      store.progress = progress;
      store.stats = stats;
      save(true);
      if (pz && !pz.deck && progress[pz.id] !== before) openPuzzle(); else if (pz) renderStats();
      deck.relabel();
    },
  });
  // Back from an email sign-in link or from Stripe: open the Crossword+ panel and say what happened
  const back = await handleReturn();
  if (back) { settings.mode = 'deck'; save(); } else await refresh();
  document.addEventListener('crossword:plus', () => {
    $('done').hidden = true;
    settings.mode = 'deck';
    save();
    openPuzzle();
    setTimeout(() => deck.showPlus(), 150);
  });
  // Becoming a member (or signing out) while on a past day: show it, or lock it
  let wasMember = isMember();
  onAccount(renderAccount);
  renderAccount();
  onAccount(() => { if (isMember() !== wasMember) { wasMember = isMember(); if (settings.mode !== 'deck' && date && date < localDate()) openDay(); } });
  wireControls();
  wireSettings();
  buildKeys();
  await openDay();
  if (back) deck.message(back.kind, back.message);
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
  if (settings.mode === 'deck') { openPuzzle(); return; }
  if (!date) { showEmpty(t('empty.soon')); return; }
  // Past days are for Crossword+ members (today's are free)
  if (date < localDate() && !isMember()) { day = null; showLocked(); return; }
  const want = date;
  day = null;
  let d;
  try {
    d = await getJson(`puzzles/${want}.json`);
    // Older days are sealed in the repo; the sponsor Worker opens them for members
    if (d.ct) { const r = await archiveDay(want); if (!r.ok) { if (date === want) showLocked(); return; } d = r.day; }
  } catch { if (date === want) showEmpty(t('empty.fail')); return; }
  if (date !== want) return;                 // they moved to another day meanwhile
  day = d;
  openPuzzle();
}

// "<b>bold</b> rest" → nodes
const rich = (s) => String(s).split(/(<b>.*?<\/b>)/).filter(Boolean).map((x) => { const m = x.match(/^<b>(.*)<\/b>$/); return m ? h('strong', {}, m[1]) : x; });

function showLocked() {
  stopClock();
  renderBar();
  $('play').hidden = true;
  $('words-sec').hidden = true;
  $('empty').hidden = false;
  fill($('empty'), h('span', { class: 'cw-locked' }, h('span', { class: 'cw-plus-badge' }, '🔒 ', t('plusName')), h('span', { class: 'cw-locked-msg' }, rich(t('locked')))), h('span', { class: 'cw-locked-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => { const today = dates.filter((d) => d <= localDate()).pop(); if (today) { date = today; history.replaceState(null, '', location.pathname); openDay(); } } }, t('toToday')),
    h('button', { type: 'button', class: 'btn btn-plus', onclick: () => document.dispatchEvent(new CustomEvent('crossword:plus')) }, t('seePlus'))));
}

function showEmpty(msg) {
  stopClock();
  $('play').hidden = true;
  $('empty').hidden = false;
  $('empty').textContent = msg;
}

// Show the puzzle for the current mode, size, level and date. A deck puzzle
// (from deck.js) is passed in; deck mode with none shows just the deck panel.
function openPuzzle(deckPuzzle = null) {
  stopClock();
  document.body.dataset.mode = settings.mode;
  deck.show(settings.mode === 'deck');
  // My deck has its own Crossword+ box, so the page one would just repeat it
  $('plus-sec').hidden = settings.mode === 'deck';
  let p;
  if (settings.mode === 'deck') {
    p = deckPuzzle || deck.current();
    if (!p) { renderBar(); pz = null; $('play').hidden = true; $('empty').hidden = true; $('words-sec').hidden = true; $('stats').textContent = ''; return; }
  } else {
    if (!day || !day.puzzles) { renderBar(); if (date) openDay(); else showEmpty(t('empty.soon')); return; }
    p = day.puzzles.find((x) => x.size === settings.size && x.level === settings.level && (x.mode || 'kana') === settings.mode);
    if (!p) { renderBar(); showEmpty(t('empty.level', { level: LEVEL_NAME(settings.level) })); return; }
  }
  const key = p.keyObj || decodeKey(p.key);
  pz = { ...p, key, cells: [], mode: p.mode || 'kana' };
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
  if (p.keyword) p.keyword.cells.forEach(([r, c], i) => { cell(r, c).kw = LETTERS[i]; });
  pz.tilePool = tilePool();

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
  buildKeys();
  renderGrid();
  renderClues();
  renderWords();
  renderStats();
  select(cur.r, cur.c, cur.dir);
  if (!st.done) startClock();
  else $('timer').textContent = fmtTime(st.time);
  if (!coarse) $('ime').focus({ preventScroll: true });
}

const cell = (r, c) => pz.cells[r * pz.width + c];
// Clues: Settings pick the language (auto = the level's own: Japanese for Mixed) and the
// style (fun hint or plain definition). Clues without versions (older days, deck puzzles) show as written.
const levelLang = () => (pz.level === 'mixed' ? 'ja' : 'en');
const pickLang = () => (settings.clueLang === 'en' || settings.clueLang === 'ja' ? settings.clueLang : levelLang());
const clueLang = (e) => (e && e.alt ? pickLang() : levelLang());
const val = (r, c) => st.cells[`${r},${c}`] || '';
const kanjiMode = () => Boolean(pz && pz.mode === 'kanji');
const isKanji = (ch) => /[\u3400-\u9fff\uf900-\ufaff々]/.test(ch);
// What a typed character becomes in a square (null: it doesn't go in one)
const toCell = (ch) => (kanjiMode() ? (isKanji(ch) ? ch : null) : ch === 'ー' ? 'ー' : gridKana(ch));
const statsKey = () => `${pz.mode === 'kanji' ? 'kanji-' : ''}${pz.level}-${pz.size}`;

// ---------------------------------------------------------------- top bar
function renderBar() {
  const deckMode = settings.mode === 'deck';
  document.querySelectorAll('#mode-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  document.querySelectorAll('#size-seg button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.size === settings.size));
    b.querySelector('.cw-seg-sub').textContent = (SIZE_SUB[settings.mode] || SIZE_SUB.kana)[b.dataset.size];
  });
  ['size-seg', 'level-wrap', 'date-nav'].forEach((id) => { $(id).hidden = deckMode; });
  if (deckMode) { $('theme').hidden = true; return; }
  $('level').value = settings.level;
  const today = localDate();
  fill($('date-label'), CAL_ICON(), h('span', {}, date ? (date === today ? t('today', { date: fmtDate(date, false) }) : fmtDate(date)) : ''));
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
  document.querySelectorAll('#mode-seg button').forEach((b) => b.addEventListener('click', () => {
    if (settings.mode === b.dataset.mode) return;
    settings.mode = b.dataset.mode;
    save();
    if (settings.mode !== 'deck' && !day && date) openDay(); else openPuzzle();
  }));
  $('level').addEventListener('change', (e) => { settings.level = e.target.value; save(); openPuzzle(); });
  const go = (d) => { date = d; history.replaceState(null, '', d === localDate() ? location.pathname : `?date=${d}`); openDay(); };
  $('date-prev').addEventListener('click', () => { const i = dates.indexOf(date); if (i > 0) go(dates[i - 1]); });
  $('date-next').addEventListener('click', () => { const i = dates.indexOf(date); if (i < dates.length - 1) go(dates[i + 1]); });
  $('date-label').addEventListener('click', () => openDates(go));
  $('timer').addEventListener('click', () => { if (st && !st.done) pause(); });
  $('resume').addEventListener('click', resume);
  $('clue-prev').addEventListener('click', () => nextEntry(-1));
  $('clue-next').addEventListener('click', () => nextEntry(1));
  $('clue-text').addEventListener('click', () => toggleDir());
  document.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => { check(b.dataset.check); b.closest('details').open = false; }));
  document.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => { reveal(b.dataset.reveal); b.closest('details').open = false; }));
  $('autocheck').checked = Boolean(settings.autocheck);
  $('autocheck').addEventListener('change', (e) => { settings.autocheck = e.target.checked; save(); if (settings.autocheck) check('puzzle'); });
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
    if (kanjiMode()) { if (text && ![...text].some(isKanji)) toast(t('ime.convert')); } else if (/[^ぁ-ゖァ-ヺー・\s]/.test(text) && !/^[a-z']+$/i.test(text)) toast(t('ime.kanji'));
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
    if (!$('done').hidden || document.querySelector('.cw-browse') || !$('settings').hidden) return;
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
  [['opt-romaji', 'romaji'], ['opt-noassist', 'noassist'], ['opt-words', 'words'], ['opt-readings', 'readings'], ['opt-backInto', 'backInto'], ['opt-skipFilled', 'skipFilled'], ['opt-jumpBack', 'jumpBack'], ['opt-nextClue', 'nextClue'], ['opt-showTimer', 'showTimer']].forEach(([id, k]) => {
    $(id).checked = Boolean(settings[k]);
    $(id).addEventListener('change', (e) => {
      settings[k] = e.target.checked;
      save();
      if (k === 'romaji') $('keys').classList.toggle('show-romaji', settings.romaji);
      if (k === 'noassist') applyAssist();
      if (k === 'words' && pz) { renderWords(); }
      if (k === 'showTimer') applyTimer();
      if (k === 'readings' && pz) { renderClues(); if (cur) select(cur.r, cur.c, cur.dir); }
    });
  });
  ['arrowMove', 'spaceClear', 'clueLang', 'clueStyle'].forEach((k) => {
    const bool = typeof TYPING_DEFAULTS[k] === 'boolean';
    document.querySelectorAll(`input[name="opt-${k}"]`).forEach((r) => {
      r.checked = r.value === (bool ? (settings[k] ? '1' : '0') : settings[k]);
      r.addEventListener('change', () => {
        settings[k] = bool ? r.value === '1' : r.value;
        save();
        if ((k === 'clueLang' || k === 'clueStyle') && pz) { renderClues(); renderWords(); if (cur) select(cur.r, cur.c, cur.dir); }
      });
    });
  });
  applyAssist();
  applyTimer();
}
function applyAssist() { $('play').classList.toggle('no-assist', Boolean(settings.noassist)); }

// Language switch: redraw everything that has text in it (progress is untouched)
function relabel() {
  t.apply();
  renderAccount();
  buildKeys();
  mountPlusSection();
  deck.relabel();
  if (!pz) { if (date) renderBar(); return; }
  renderBar();
  renderGrid();
  renderClues();
  renderWords();
  renderStats();
  select(cur.r, cur.c, cur.dir);
}

// Who's signed in, on every tab, with Sign out (or a way to sign in)
let canSignIn = false;
plusInfo().then((i) => { canSignIn = Boolean(i && (i.google || i.email)); renderAccount(); }).catch(() => {});
function renderAccount() {
  const bar = $('account-bar');
  const u = currentUser();
  if (!u && !canSignIn) { bar.hidden = true; return; }
  bar.hidden = false;
  if (!u) {
    fill(bar, h('button', { type: 'button', class: 'btn-link', onclick: () => document.dispatchEvent(new CustomEvent('crossword:plus')) }, t('acct.signIn')));
    return;
  }
  fill(bar, h('span', {}, t('acct.as', { email: u.email })),
    u.member ? h('span', { class: 'cw-plus-badge cw-acct-badge' }, '✓ ', t('plusName')) : null,
    h('button', { type: 'button', class: 'btn-link', onclick: async () => { await logout(); renderAccount(); } }, t('acct.out')));
}

// A small calendar so it's clear the date opens the calendar/list of past puzzles
const CAL_ICON = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'cw-cal-icon'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx=".5" fill="currentColor"/>';
  return svg;
};

function openDates(go) {
  const today = localDate();
  openBrowse({
    title: t('pastTitle'),
    start: date,
    items: dates.filter((d) => d <= today).map((d) => {
      const done = ['mini', 'daily'].filter((s) => (store.progress[`${d}${settings.mode === 'kanji' ? '-kanji' : ''}-${settings.level}-${s}`] || {}).done);
      return { date: d, label: fmtDate(d), sub: done.map((s) => `${SIZE_NAME(s)} ✓`).join(' · '), done: done.length === 2, some: done.length > 0, locked: d < today && !isMember(), current: d === date };
    }),
    onPick: (x) => go(x.date),
  });
}

// ---------------------------------------------------------------- grid
function renderGrid() {
  const g = $('grid');
  g.style.setProperty('--n', pz.width);
  g.classList.toggle('is-free', Boolean(pz.free));
  g.classList.toggle('is-kanji', kanjiMode());
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
  if (kanjiMode()) buildTiles(e);
  // Clue bar and list
  $('clue-text').replaceChildren(h('strong', {}, t('clueId', e)), ' ', h('span', { lang: clueLang(e) }, clueFor(e)), h('span', { class: 'cw-len' }, ` (${e.len})`));
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
    }, h('span', { class: 'cw-clue-num' }, e.num), h('span', { class: 'cw-clue-body', lang: clueLang(e) }, clueFor(e), h('span', { class: 'cw-len' }, ` (${e.len})`)))));
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

// Kanji clues are "meaning · reading", and the reading gives most of the answer away,
// so it's hidden unless the player turns it on in Settings. Mixed is the exception:
// there the reading is the whole clue (write it in kanji, like a 書き取り test).
const READING_TAIL = / · [\u3040-\u30ffー・]+$/;
function shownClue(c) {
  if (!pz || pz.mode !== 'kanji' || pz.level === 'mixed' || settings.readings) return c;
  return String(c).replace(READING_TAIL, '');
}
function clueFor(e) {
  const a = e.alt && e.alt[pickLang()];
  const text = a && (a[settings.clueStyle === 'def' ? 'def' : 'fun'] || a.fun || a.def);
  if (!text) return shownClue(e.clue);
  // Kanji: the reading only when asked for (Mixed always has it: there it's the main hint)
  return pz.mode === 'kanji' && e.reading && (settings.readings || pz.level === 'mixed') ? `${text} · ${e.reading}` : text;
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
    if (cur.dir !== dir && cell(cur.r, cur.c)[dir]) { select(cur.r, cur.c, dir); if (!settings.arrowMove) return; }
    step(move[0], move[1]);
    return;
  }
  if (k === 'Tab' || k === 'Enter') { e.preventDefault(); nextEntry(e.shiftKey ? -1 : 1); return; }
  if (k === ' ') { e.preventDefault(); if (settings.spaceClear) { romajiTail = ''; if (!st.done) { setCell(cur.r, cur.c, ''); nextSquare(); } } else toggleDir(); return; }
  if (k === 'Backspace') { e.preventDefault(); if (romajiTail) { romajiTail = romajiTail.slice(0, -1); showTail(); } else backspace(); return; }
  if (k === 'Delete') { e.preventDefault(); setCell(cur.r, cur.c, ''); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (kanjiMode()) {
    // Kanji come from the IME (compositionend) or the tiles; plain letters can't make them
    if (/^[a-z'\-]$/i.test(k)) { e.preventDefault(); if (!pz.typeHint) { pz.typeHint = true; toast(t('kanji.type')); } }
    else if (k.length === 1 && isKanji(k)) { e.preventDefault(); typeText(k); }
    return;
  }
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
  const kana = [...m[1]].map((ch) => (kanjiMode() ? ch : ch === 'ー' ? 'ー' : gridKana(ch))).filter(Boolean);
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
    const g = toCell(ch);
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
  save();
  checkSolved();
}

function advance() {
  const e = entryAt(cur.r, cur.c, cur.dir);
  const i = e.cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
  const rest = e.cells.slice(i + 1);
  const empty = ([r, c]) => !val(r, c);
  if (rest.length) {
    if (!settings.skipFilled) { moveTo(rest[0][0], rest[0][1]); return; }
    const nextEmpty = rest.find(empty);
    if (nextEmpty) { moveTo(nextEmpty[0], nextEmpty[1]); return; }
  }
  // End of the word (or nothing empty after this square)
  const earlier = settings.jumpBack && e.cells.find(empty);
  if (earlier) { moveTo(earlier[0], earlier[1]); return; }
  if (settings.nextClue && !st.done && !rest.length) { nextEntry(1); return; }
  if (rest.length) moveTo(rest[0][0], rest[0][1]);
}

// One square on in the word, whatever is in it (spacebar "clear and move on")
function nextSquare() {
  const e = entryAt(cur.r, cur.c, cur.dir);
  const i = e.cells.findIndex(([r, c]) => r === cur.r && c === cur.c);
  const n = e.cells[i + 1];
  if (n) moveTo(n[0], n[1]);
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
  if (i > 0) { const [r, c] = e.cells[i - 1]; moveTo(r, c); setCell(r, c, ''); return; }
  if (!settings.backInto) return;
  // From the first square: the end of the previous word, in clue order
  const list = [...pz.entries.filter((x) => x.dir === 'across'), ...pz.entries.filter((x) => x.dir === 'down')];
  const prev = list[(list.indexOf(e) - 1 + list.length) % list.length];
  const [r, c] = prev.cells[prev.cells.length - 1];
  select(r, c, prev.dir);
  setCell(r, c, '');
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
  keys.classList.remove('is-tiles');
  keys.setAttribute('aria-label', t('keys'));
  if (kanjiMode()) { if (pz.entries) buildTiles(entryAt(cur.r, cur.c, cur.dir)); return; }
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

// Kanji tiles: the current word's kanji mixed with a few others from the
// puzzle (and the day's other kanji puzzles), so a phone needs no IME
function tilePool() {
  const pool = new Set();
  const add = (s) => [...String(s)].forEach((ch) => { if (isKanji(ch)) pool.add(ch); });
  pz.key.entries.forEach((e) => add(e.answer));
  if (pz.mode === 'kanji' && day && !pz.deck) day.puzzles.filter((x) => x.mode === 'kanji' && x.id !== pz.id).forEach((x) => { try { decodeKey(x.key).entries.forEach((e) => add(e.answer)); } catch { /* skip */ } });
  return [...pool];
}

function buildTiles(e) {
  const keys = $('keys');
  if (!e) return;
  const rand = rng(`${pz.id}:${e.id}`);
  const answer = [...new Set(e.answer || pz.key.entries.find((x) => x.num === e.num && x.dir === e.dir).answer)];
  const others = pz.tilePool.filter((ch) => !answer.includes(ch));
  const want = Math.max(8, answer.length + 5) - answer.length;
  const picks = [];
  while (picks.length < want && others.length) picks.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
  const tiles = [...answer, ...picks].map((ch) => ({ ch, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.ch);
  keys.classList.add('is-tiles');
  keys.setAttribute('aria-label', t('tiles'));
  keys.replaceChildren(
    ...tiles.map((ch) => h('button', { type: 'button', class: 'cw-key cw-tile', lang: 'ja', onpointerdown: (ev) => ev.preventDefault(), onclick: () => { if (pz && !st.done) put(ch); } }, ch)),
    h('button', { type: 'button', class: 'cw-key is-fn', 'aria-label': t('key.del'), onpointerdown: (ev) => ev.preventDefault(), onclick: () => { if (pz && !st.done) backspace(); } }, '⌫'),
    h('button', { type: 'button', class: 'cw-key is-fn', 'aria-label': t('key.next'), onpointerdown: (ev) => ev.preventDefault(), onclick: () => { if (pz) nextEntry(1); } }, '↵'));
}

// ---------------------------------------------------------------- check / reveal
function scope(what) {
  if (what === 'cell') return [[cur.r, cur.c]];
  if (what === 'word') return entryAt(cur.r, cur.c, cur.dir).cells;
  return pz.cells.filter((x) => !x.black).map((x) => [x.r, x.c]);
}

// Wrong squares turn red; no message (like the NYT)
function check(what) {
  let wrong = 0;
  scope(what).forEach(([r, c]) => {
    const v = val(r, c);
    const k = `${r},${c}`;
    if (v && v !== cell(r, c).answer) { st.wrong[k] = 1; wrong++; } else delete st.wrong[k];
    paintCell(cell(r, c));
  });
  st.checked = true;
  save();
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
  renderWords();
  renderStats();
  celebrate(assisted);
}

function applyTimer() { $('timer').classList.toggle('is-hidden', !settings.showTimer); }

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
  if (pz.deck) return;                       // deck puzzles aren't dated, so no streaks
  const k = statsKey();
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
  const s = pz.deck ? null : store.stats[statsKey()];
  $('stats').textContent = s
    ? t('stats', { level: LEVEL_NAME(pz.level), size: SIZE_NAME(pz.size), solved: s.solved, best: s.best != null ? fmtTime(s.best) : '—', streak: s.streak, longest: s.longest })
    : '';
}

let nextTimer = null;
function celebrate(assisted) {
  const kw = pz.key.keyword;
  fill($('done-body'), 
    h('p', { class: 'cw-done-time' }, fmtTime(st.time), assisted ? h('span', { class: 'cw-muted' }, t('withReveals')) : null),
    pz.deck ? h('p', {}, `${pz.deck.line || t('deckLine', { name: pz.deck.name })} · ${SIZE_NAME(pz.size)}`)
      : h('p', {}, `${pz.mode === 'kanji' ? `${t('mode.kanji')} · ` : ''}${LEVEL_NAME(pz.level)} ${SIZE_NAME(pz.size)} · ${fmtDate(date)}`),
    kw ? h('p', { class: 'cw-done-kw' }, t('kwLine'), h('strong', { lang: 'ja' }, kw.word), ` (${kw.reading})`, settings.words ? h('span', { lang: 'en' }, ` · ${kw.meaning}`) : null) : null,
    settings.words ? h('p', { class: 'cw-muted' }, t('listed')) : null,
    !pz.deck && date === localDate() ? h('p', { class: 'cw-next', id: 'cw-next' }, t('nextIn', { time: untilMidnight() })) : null);
  // The Crossword+ question (or "you're on the list"); see plus.js for when it shows
  fill($('done-plus'), plusEligible() ? plusCard() : null);
  clearInterval(nextTimer);
  nextTimer = setInterval(() => { const el = $('cw-next'); if (!el || $('done').hidden) { clearInterval(nextTimer); return; } el.textContent = t('nextIn', { time: untilMidnight() }); }, 1000);
  $('done').hidden = false;
  $('done-share').focus();
}

function share() {
  const text = `${t('shareText', { mode: pz.deck ? t('mode.deck') : pz.mode === 'kanji' ? '漢字' : '', size: SIZE_NAME(pz.size), level: pz.deck ? pz.deck.name : LEVEL_NAME(pz.level), date: pz.deck ? fmtDate(localDate()) : fmtDate(date), time: fmtTime(st.time), reveals: Object.keys(st.revealed).length > 0 })}\nhttps://www.jareddesu.com/tools/crossword/`;
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
      h('td', { class: 'cw-muted', lang: clueLang(e) }, clueFor(e)))))));
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
