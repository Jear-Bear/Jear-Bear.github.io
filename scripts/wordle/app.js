// app.js — Kana Wordle.
//
// Guess a hidden hiragana word (4 or 5 kana) in 8 tries. Daily words are the
// same for everyone: a fixed shuffle of each level's answer list, indexed by
// the day. Practice picks at random. Progress and stats stay in this browser.

import { toHiragana } from '../kanji/romaji.js?v=1';
import { gridKana, cycleDakuten, romaji } from '../crossword/kana.js?v=1';
import { translator, setLang } from '../games/i18n.js?v=1';

const $ = (id) => document.getElementById(id);
// replaceChildren() would print null/false as text
const fill = (el, ...kids) => el.replaceChildren(...kids.filter((k) => k != null && k !== false));
const KEY = 'jareddesu.wordle.v1';
// Daily #1. Launched on Oct 1 local time, so that's #1 (an earlier START of Oct 2
// clamped Oct 1 to #1 too, and Oct 1 and 2 got the same word).
const START = '2026-10-01';
const TRIES = 8;

// ---------------------------------------------------------------- interface text
const THEMES_JA = {
  'Food & drink': '食べ物・飲み物', 'Body & health': '体と健康', 'Family & people': '家族・人', 'Time & calendar': '時間・暦',
  'Numbers & counting': '数・数え方', 'Weather & nature': '天気・自然', Animals: '動物', 'Around the house': '家の中',
  Clothes: '服', 'Getting around': '乗り物・交通', 'Around town': '町の中', 'School & work': '学校・仕事', Feelings: '気持ち',
  'Colors & looks': '色・見た目', 'Fun & hobbies': '遊び・趣味', 'A thing or an idea': 'もの・こと',
  'A describing word': '様子を表す言葉', 'Something you do': '動作', 'Something people say': 'あいさつ・決まり文句',
  'How, when or how much': '様子・程度を表す言葉', 'Pop culture': 'ポップカルチャー', 'Everyday life': '日常生活',
  'Japanese culture': '日本文化', 'Places in Japan': '日本の地名', 'Sound words': 'オノマトペ', 'Things people say': 'よく言う言葉',
  'Hard-to-translate words': '訳しにくい言葉', 'Life in Japan': '日本の暮らし', Sayings: 'ことわざ・慣用句', Slang: 'スラング',
};
const t = translator({
  en: {
    'level.beginner': 'Beginner', 'level.intermediate': 'Intermediate', 'level.advanced': 'Advanced',
    'opt.beginner': 'Beginner · N5–N4', 'opt.intermediate': 'Intermediate · N3–N2', 'opt.advanced': 'Advanced · N1+',
    bar: 'Game options', modeGroup: 'Mode', lenGroup: 'Word length', 'mode.daily': 'Daily', 'mode.practice': 'Practice',
    len4: '4 kana', len5: '5 kana', level: 'Level', statistics: 'Statistics', settings: 'Settings', close: 'Close',
    board: 'Guesses', keys: 'Kana keyboard', ime: 'Type your guess (romaji or kana)',
    loadFail: 'Couldn’t load the word list. Try again in a moment.',
    titleDaily: 'Daily #{day} · {level} · {len} kana', titlePractice: 'Practice · {level} · {len} kana',
    theme: 'Theme', meaning: 'Meaning', kana: 'Kana',
    kanaHint: ({ n }) => [' Square ', String(n), ' is '],
    hint1: 'Hint: show the meaning', hint2: 'Hint: show one kana',
    'pos.verb': 'verb', 'pos.adjective': 'い-adjective', 'pos.na-adjective': 'な-adjective', 'pos.adverb': 'adverb',
    'pos.expression': 'expression', 'pos.counter': 'counter', 'pos.noun': 'noun',
    tileEmpty: 'empty', 'mark.correct': 'correct', 'mark.present': 'present', 'mark.close': 'close', 'mark.absent': 'absent',
    'key.daku': 'Add dakuten or handakuten', 'key.del': 'Delete', enter: 'Enter',
    short: 'Not enough kana', notWord: 'Not in the word list',
    imeKanji: 'Only kana count. Press Enter instead of converting to kanji.', newDay: 'A new day, a new word.',
    hardSquare: 'Square {n} must be {ch}', hardContain: 'Guess must contain {ch}', hardLate: 'Change hard mode before your first guess.',
    played: 'Played', winPct: 'Win %', cleanPct: 'No-hint win %', streak: 'Streak',
    statLine: ({ clean, won, cs, cm, max }) => `${clean} of ${won} win${won === 1 ? '' : 's'} without hints · hint-free streak ${cs} (best ${cm}) · best streak ${max}`,
    distTitle: 'Guess distribution · daily {level}, {len} kana', withHints: '{n} with hints',
    keyClean: ' without hints   ', keyHint: ' 💡 with hints',
    statsEyebrow: 'statistics', statsTitle: 'Your daily record',
    solvedIn: 'solved in {n}/{tries}', lost: 'out of guesses', usedHints: ({ n }) => (n ? ` · ${n} hint${n === 1 ? '' : 's'}` : ' · no hints'),
    copy: 'Copy result', nextWord: 'Next word →', keepPlaying: 'Keep playing in practice →',
    nextIn: 'Next daily word in {time}', copied: 'Copied. Paste it anywhere.',
    shareDaily: 'Kana Wordle #{day} {level} {len}', sharePractice: 'Kana Wordle practice {level} {len}',
    'set.title': 'Settings', 'set.lang': 'Language',
    'set.hard': 'Hard mode', 'set.hard.d': 'Green and yellow kana must be used in later guesses.',
    'set.any': 'Accept any kana', 'set.any.d': 'Guesses don\'t have to be dictionary words.',
    'set.notheme': 'Hide the theme', 'set.notheme.d': 'for a harder game.',
    'set.nohints': 'Hide the hint buttons', 'set.nohints.d': 'so you can\'t tap one by accident.',
    'set.meaning': 'Show the meaning', 'set.meaning.d': 'of the answer when the game ends.',
    'set.romaji': 'Show romaji', 'set.romaji.d': 'under the kana keys.',
  },
  ja: {
    'level.beginner': '初級', 'level.intermediate': '中級', 'level.advanced': '上級',
    'opt.beginner': '初級 · N5–N4', 'opt.intermediate': '中級 · N3–N2', 'opt.advanced': '上級 · N1+',
    bar: 'ゲームの設定', modeGroup: 'モード', lenGroup: '文字数', 'mode.daily': 'デイリー', 'mode.practice': '練習',
    len4: '4文字', len5: '5文字', level: 'レベル', statistics: '記録', settings: '設定', close: '閉じる',
    board: '回答', keys: 'かなキーボード', ime: '回答を入力（ローマ字・かな）',
    loadFail: '単語リストを読み込めませんでした。少し待ってから試してください。',
    titleDaily: 'デイリー #{day} · {level} · {len}文字', titlePractice: '練習 · {level} · {len}文字',
    theme: 'テーマ', meaning: '意味', kana: 'かな',
    kanaHint: ({ n }) => [` ${n}マス目は `],
    hint1: 'ヒント：意味を見る', hint2: 'ヒント：かなを一つ見る',
    'pos.verb': '動詞', 'pos.adjective': 'い形容詞', 'pos.na-adjective': 'な形容詞', 'pos.adverb': '副詞',
    'pos.expression': '表現', 'pos.counter': '助数詞', 'pos.noun': '名詞',
    tileEmpty: '空き', 'mark.correct': '正解', 'mark.present': '別の位置', 'mark.close': '濁点違い', 'mark.absent': 'なし',
    'key.daku': '濁点・半濁点をつける', 'key.del': '消す', enter: '決定',
    short: 'かなが足りません', notWord: '単語リストにありません',
    imeKanji: 'かなだけ入力できます。漢字に変換せず、そのまま確定してください。', newDay: '日付が変わりました。新しい単語です。',
    hardSquare: '{n}マス目は「{ch}」にしてください', hardContain: '「{ch}」を使ってください', hardLate: 'ハードモードは最初の回答の前に切り替えてください。',
    played: 'プレイ', winPct: '勝率', cleanPct: 'ノーヒント勝率', streak: '連勝',
    statLine: ({ clean, won, cs, cm, max }) => `ヒントなしの勝ち ${clean}/${won}回 · ノーヒント連勝 ${cs}（最高 ${cm}） · 最高連勝 ${max}`,
    distTitle: '回数の分布 · デイリー {level}・{len}文字', withHints: 'ヒントあり {n}回',
    keyClean: ' ヒントなし   ', keyHint: ' 💡 ヒントあり',
    statsEyebrow: '記録', statsTitle: 'デイリーの成績',
    solvedIn: '{n}/{tries}回で正解', lost: '回数切れ', usedHints: ({ n }) => (n ? ` · ヒント${n}回` : ' · ヒントなし'),
    copy: '結果をコピー', nextWord: '次の単語 →', keepPlaying: '練習モードで続ける →',
    nextIn: '次の単語まで {time}', copied: 'コピーしました。どこにでも貼り付けられます。',
    shareDaily: 'かなWordle #{day} {level} {len}文字', sharePractice: 'かなWordle 練習 {level} {len}文字',
    'set.title': '設定', 'set.lang': '表示言語',
    'set.hard': 'ハードモード', 'set.hard.d': '緑と黄色のかなは、次の回答でも使わないといけません。',
    'set.any': 'どんなかなでもOK', 'set.any.d': '辞書にない言葉でも回答できます。',
    'set.notheme': 'テーマを隠す', 'set.notheme.d': '（もっと難しくしたい人に）',
    'set.nohints': 'ヒントボタンを隠す', 'set.nohints.d': '（うっかり押さないように）',
    'set.meaning': '意味を表示', 'set.meaning.d': '（ゲームが終わったとき、答えの意味を表示）',
    'set.romaji': 'ローマ字を表示', 'set.romaji.d': '（かなキーの下に）',
  },
});
const LEVEL_NAME = (l) => t(`level.${l}`);
const themeName = (name) => (document.documentElement.dataset.ui === 'ja' && THEMES_JA[name]) || name;
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
if (settings.meaning == null) settings.meaning = true;

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
let composing = '';       // Japanese IME text not yet committed
let data = null;

async function start({ fresh = false } = {}) {
  closeOverlays();
  renderBar();
  try { data = await words(settings.len); } catch { $('title').textContent = t('loadFail'); return; }
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
    ? t('titleDaily', { day: game.day, level: LEVEL_NAME(game.level), len: game.len })
    : t('titlePractice', { level: LEVEL_NAME(game.level), len: game.len });
}

// Theme, then up to two hints on request: the English meaning, then one kana
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
    parts.push(h('p', { class: 'wd-theme' }, h('span', { class: 'wd-theme-label' }, t('theme')), ` ${themeName(info.t)}`, info.p && !/^(Something you do|A describing word|How, when or how much|Something people say|A thing or an idea)$/.test(info.t) ? h('span', { class: 'wd-muted' }, ` · ${t(`pos.${info.p}`)}`) : null));
  }
  if (game.hints >= 1 && info.m) parts.push(h('p', { class: 'wd-hint' }, h('span', { class: 'wd-theme-label' }, t('meaning')), ' ', h('span', { lang: 'en' }, info.m)));
  if (game.hints >= 2) {
    const k = game.hintKana || hintKana();
    if (k) { game.hintKana = k; parts.push(h('p', { class: 'wd-hint' }, h('span', { class: 'wd-theme-label' }, t('kana')), ...t('kanaHint', { n: k.i + 1 }), h('strong', { lang: 'ja' }, k.ch))); }
  }
  if (!game.done && game.hints < 2 && !settings.nohints) {
    const label = game.hints === 0 ? t('hint1') : t('hint2');
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
    // While a Japanese IME is composing, show its kana in the row (and any romaji after them as the tail)
    const cm = composing.match(/^([^a-z']*)([a-z']*)$/i) || ['', '', ''];
    const pending = [...cm[1]].map((ch) => (ch === 'ー' ? 'ー' : gridKana(ch))).filter(Boolean).join('');
    const letters = g ? [...g] : isCur ? [...(typed + pending)].slice(0, game.len) : [];
    const rowTail = composing ? cm[2] : tail;
    return h('div', { class: `wd-row${isCur ? ' is-cur' : ''}`, role: 'row' },
      Array.from({ length: game.len }, (_, i) => h('div', {
        class: `wd-tile${marks ? ` is-${marks[i]}` : letters[i] ? ' is-filled' : ''}${isCur && composing && i >= [...typed].length && letters[i] ? ' is-preview' : ''}`, role: 'gridcell', lang: 'ja',
        'aria-label': letters[i] ? `${letters[i]}${marks ? `, ${t(`mark.${marks[i]}`)}` : ''}` : t('tileEmpty'),
      }, letters[i] || (isCur && i === letters.length && rowTail ? h('span', { class: 'wd-tail' }, rowTail) : ''))));
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
      'aria-label': fn ? t('key.daku') : k,
      onpointerdown: (e) => e.preventDefault(),
      onclick: () => (fn ? dakuten() : add(k)),
    }, fn ? h('span', { class: 'wd-daku' }, 'が・ぱ') : k, !fn && k !== 'ー' ? h('span', { class: 'wd-key-r' }, romaji(k)) : null);
  }));
  // Voiced kana appear on the board but have no key of their own; show their colour on the base key's corner
  keys.replaceChildren(...kanaKeys,
    h('div', { class: 'wd-key-row' },
      h('button', { type: 'button', class: 'wd-key is-wide is-fn', onpointerdown: (e) => e.preventDefault(), onclick: back, 'aria-label': t('key.del') }, '⌫'),
      h('button', { type: 'button', class: 'wd-key is-wide is-enter', onpointerdown: (e) => e.preventDefault(), onclick: submit }, t('enter'))));
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
  if ([...typed].length < game.len) { shake(t('short')); return; }
  if (!settings.any && !data.valid.has(typed)) { shake(t('notWord')); return; }
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
      if (marks[i] === 'correct' && g[i] !== prev[i]) return t('hardSquare', { n: i + 1, ch: prev[i] });
    }
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] === 'present' && !g.includes(prev[i])) return t('hardContain', { ch: prev[i] });
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
  // keyCode 229: a key the IME is handling (Safari sends the committing Enter this way)
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter' && Date.now() - composedAt < 80) return;
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
  const hinted = (game.hints || 0) > 0;
  game.usedHints = game.hints || 0;
  if (game.mode !== 'daily') {
    store.recent = [...(store.recent || []), game.answer].slice(-50);
    const p = store.practice = store.practice || {};
    const s = p[statsKey()] = p[statsKey()] || { played: 0, won: 0, hinted: 0 };
    s.played++;
    if (game.won) { s.won++; if (hinted) s.hinted = (s.hinted || 0) + 1; }
    return;
  }
  const s = dailyStats();
  s.played++;
  if (game.won) {
    s.won++;
    s.streak = s.lastDay === game.day - 1 ? s.streak + 1 : 1;
    s.max = Math.max(s.max, s.streak);
    if (hinted) {
      s.hinted++;
      s.distHint[game.guesses.length - 1]++;
      s.cleanStreak = 0;
    } else {
      s.dist[game.guesses.length - 1]++;
      s.cleanStreak = s.lastCleanDay === game.day - 1 ? s.cleanStreak + 1 : 1;
      s.cleanMax = Math.max(s.cleanMax, s.cleanStreak);
      s.lastCleanDay = game.day;
    }
  } else { s.streak = 0; s.cleanStreak = 0; }
  s.lastDay = game.day;
}

// Daily stats for this level and length. Wins from before hints were tracked count as hint-free.
function dailyStats() {
  const s = store.stats[statsKey()] = store.stats[statsKey()] || { played: 0, won: 0, streak: 0, max: 0, dist: Array(TRIES).fill(0), lastDay: 0 };
  if (s.hinted == null) Object.assign(s, { hinted: 0, distHint: Array(TRIES).fill(0), cleanStreak: s.streak, cleanMax: s.max, lastCleanDay: s.lastDay });
  return s;
}

function statsBlock() {
  const s = dailyStats();
  const clean = s.won - s.hinted;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const max = Math.max(1, ...s.dist.map((n, i) => n + s.distHint[i]));
  const now = game.mode === 'daily' && game.won ? game.guesses.length - 1 : -1;
  const tile = (v, l) => h('div', { class: 'wd-stat' }, h('span', { class: 'wd-stat-v' }, v), h('span', { class: 'wd-stat-l' }, l));
  return h('div', { class: 'wd-stats' },
    h('div', { class: 'wd-stat-row' }, tile(s.played, t('played')), tile(pct(s.won, s.played), t('winPct')), tile(pct(clean, s.played), t('cleanPct')), tile(s.streak, t('streak'))),
    h('p', { class: 'wd-stat-line' },
      t('statLine', { clean, won: s.won, cs: s.cleanStreak, cm: s.cleanMax, max: s.max })),
    h('p', { class: 'wd-dist-title' }, t('distTitle', { level: LEVEL_NAME(game.level), len: game.len })),
    h('ol', { class: 'wd-dist' }, s.dist.map((n, i) => {
      const k = s.distHint[i];
      const bar = h('span', { class: `wd-dist-bar${i === now ? ' is-now' : ''}` },
        n || !k ? h('span', { class: 'wd-dist-clean' }, n) : null,
        k ? h('span', { class: 'wd-dist-hint', title: t('withHints', { n: k }) }, `💡${k}`) : null);
      bar.style.width = `${Math.max(8, ((n + k) / max) * 100)}%`;
      if (n && k) bar.querySelector('.wd-dist-clean').style.flexGrow = n;
      if (k) bar.querySelector('.wd-dist-hint').style.flexGrow = k;
      return h('li', {}, h('span', { class: 'wd-dist-n' }, i + 1), bar);
    })),
    s.hinted ? h('p', { class: 'wd-dist-key' }, h('span', { class: 'wd-key-swatch' }), t('keyClean'), h('span', { class: 'wd-key-swatch is-hint' }), t('keyHint')) : null);
}

function showResult({ statsOnly = false } = {}) {
  const info = game.info;
  const actions = $('result-actions');
  actions.replaceChildren();
  if (statsOnly || !game.done) {
    $('result-eyebrow').textContent = t('statsEyebrow');
    $('result-title').textContent = t('statsTitle');
    fill($('result-body'), statsBlock());
  } else {
    const used = game.usedHints ?? game.hints ?? 0;
    $('result-eyebrow').textContent = (game.won ? t('solvedIn', { n: game.guesses.length, tries: TRIES }) : t('lost')) + t('usedHints', { n: used });
    $('result-title').textContent = game.won ? ['天才！', '見事！', 'すごい！', 'いいね！', 'よし！', 'ナイス！', 'ふう…', 'セーフ！'][game.guesses.length - 1] : 'ざんねん…';
    fill($('result-body'), 
      h('div', { class: 'wd-answer' },
        h('p', { class: 'wd-answer-word', lang: 'ja' }, info.w),
        h('p', { class: 'wd-answer-reading', lang: 'ja' }, info.r, h('span', { class: 'wd-muted' }, ` · ${romaji(info.r)}`)),
        info.m && settings.meaning ? h('p', { class: 'wd-answer-meaning', lang: 'en' }, info.m) : null),
      game.mode === 'daily' ? statsBlock() : null,
      game.mode === 'daily' ? h('p', { class: 'wd-next', id: 'next-in' }) : null);
    actions.append(h('button', { type: 'button', class: 'btn btn-primary', onclick: share }, t('copy')));
    if (game.mode === 'practice') actions.append(h('button', { type: 'button', class: 'btn-link', onclick: () => start({ fresh: true }) }, t('nextWord')));
    else actions.append(h('button', { type: 'button', class: 'btn-link', onclick: () => { settings.mode = 'practice'; save(); start(); } }, t('keepPlaying')));
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
    el.textContent = t('nextIn', { time: `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` });
  };
  run();
  countdown = setInterval(run, 1000);
}

function share() {
  const head = game.mode === 'daily' ? t('shareDaily', { day: game.day, level: LEVEL_NAME(game.level), len: game.len }) : t('sharePractice', { level: LEVEL_NAME(game.level), len: game.len });
  const grid = game.guesses.map((g) => score(g, game.answer).map((m) => EMOJI[m]).join('')).join('\n');
  const hints = game.hints ? ` ${'💡'.repeat(game.hints)}` : '';
  const text = `${head} ${game.won ? game.guesses.length : 'X'}/${TRIES}${settings.hard ? '*' : ''}${hints}\n${grid}\nhttps://www.jareddesu.com/tools/wordle/`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(t('copied')), () => toast(text));
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
[['opt-hard', 'hard'], ['opt-any', 'any'], ['opt-romaji', 'romaji'], ['opt-notheme', 'notheme'], ['opt-nohints', 'nohints'], ['opt-meaning', 'meaning']].forEach(([id, k]) => {
  $(id).checked = Boolean(settings[k]);
  $(id).addEventListener('change', (e) => {
    if (k === 'hard' && game && game.guesses.length && !game.done) { e.target.checked = Boolean(settings.hard); toast(t('hardLate')); return; }
    settings[k] = e.target.checked; save(); if (k === 'romaji') renderKeys(); if ((k === 'notheme' || k === 'nohints') && game) renderHints();
  });
});
const ime = $('ime');
ime.addEventListener('keydown', onKey);
// Japanese IME: show the kana being composed in the row; they're added when committed (Enter)
let composedAt = 0;
ime.addEventListener('compositionstart', () => {
  const r = $('board').querySelector('.wd-row.is-cur');
  if (r) { const b = r.getBoundingClientRect(); Object.assign(ime.style, { left: `${b.left}px`, top: `${b.bottom}px` }); }
});
ime.addEventListener('compositionupdate', (e) => { if (game && !game.done) { composing = e.data || ''; renderBoard(); } });
ime.addEventListener('compositionend', (e) => {
  composing = '';
  composedAt = Date.now();
  const text = e.data || '';
  if (/[^ぁ-ゖァ-ヺー・\s]/.test(text) && !/^[a-z']+$/i.test(text)) toast(t('imeKanji'));
  for (const ch of text) add(ch);
  ime.value = '';
  renderBoard();
});
ime.addEventListener('input', (e) => {
  if (e.isComposing) return;
  if (Date.now() - composedAt < 80) { ime.value = ''; return; }      // Safari repeats the committed text
  if (ime.value) { for (const ch of ime.value) add(ch); ime.value = ''; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (!$('result').hidden || !$('settings').hidden)) { closeOverlays(); return; }
  if (e.target === ime || e.target.closest('input, select, textarea, button')) return;
  onKey(e);
});
$('board').addEventListener('click', () => { if (!window.matchMedia('(pointer: coarse)').matches) ime.focus({ preventScroll: true }); });

// Language switch: redraw everything that has text in it
document.querySelectorAll('[data-lang-seg] button').forEach((b) => b.addEventListener('click', () => {
  setLang(b.dataset.lang);
  t.apply();
  if (!game) return;
  renderTitle();
  renderHints();
  renderBoard();
  renderKeys();
}));

// A new daily word at local midnight: if the page is left open on today's
// daily, move to the new one unless a game is half played
let today = localDate();
setInterval(() => {
  const now = localDate();
  if (now === today) return;
  today = now;
  if (settings.mode === 'daily' && game && (game.done || !game.guesses.length)) { start(); toast(t('newDay')); }
}, 30000);

t.apply();
start();
