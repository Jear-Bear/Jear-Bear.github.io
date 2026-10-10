// deck.js — My deck (Crossword+): crosswords made from the player's own Anki deck.
//
// 1. Unlock with a Crossword+ key (checked by the sponsor Worker, plus.js).
// 2. Import: Anki's "Notes in Plain Text" export (or any tab/CSV list, or a
//    paste). Every deck has different fields, so the player picks which field
//    is the word, the meaning, and (optionally) the reading.
// 3. Make a puzzle: built here in a Web Worker (deck-worker.js) from the deck's
//    words only, then counted against today's limit by the Worker (2 a day).
// The deck and the puzzles stay in this browser (localStorage); nothing from
// the deck is sent anywhere. Everything from the deck is inserted as text.

import { lang } from '../games/i18n.js?v=1';
import { gridKana, toHira } from './kana.js?v=1';
import { plusKey, setPlusKey } from './plus.js?v=5';

const API = 'https://sponsor-crm.jared-65b.workers.dev';
const STORE = 'jareddesu.crossword.deck';
const KEEP = 12;                 // puzzles kept to replay
const MAX_NOTES = 20000;

const T = {
  en: {
    title: 'My deck', plus: 'Crossword+',
    lockedBody: 'Turn your own Anki deck into crosswords: your words, with your meanings as the clues. It’s part of Crossword+, with 2 deck puzzles a day.',
    keyLabel: 'Crossword+ key', unlock: 'Unlock', checking: 'Checking…',
    badKey: 'That key didn’t work. Check it, or ask Jared for a new one.', failed: 'Couldn’t reach the server. Please try again in a bit.',
    notOpen: 'Crossword+ isn’t open to everyone yet.', joinList: 'Join the list for one email when it is.',
    importTitle: 'Import your deck',
    howto: 'In Anki: File → Export, choose “Notes in Plain Text (.txt)”, and export. Then pick the file here. A CSV or a list pasted from a spreadsheet works too.',
    file: 'Choose a file', paste: 'Or paste it', read: 'Read it', empty: 'There’s nothing to read in that.',
    pick: 'Which field is which? Every deck is set up differently, so pick them here.',
    fWord: 'Word (the answer)', fMeaning: 'Meaning (the clue)', fReading: 'Reading (optional)', none: 'None: work it out', field: 'Field {n}',
    name: 'Deck name', save: 'Import {n} notes', cancel: 'Cancel',
    usable: '{kana} of {n} can be kana answers · {kanji} can be kanji answers',
    noReading: '{n} words have no reading, so they’ll be skipped for kana answers.',
    tooFew: 'Only {n} words can be used. A puzzle needs at least {min}; try another field for the word or reading.',
    tooBig: 'This deck is too big to keep in this browser. Try exporting part of it.',
    size: 'Size', mini: 'Mini', daily: 'Daily', answers: 'Answers', kana: 'Kana', kanji: 'Kanji',
    make: 'Make a puzzle', making: 'Building your puzzle…', left: '{n} left today', none_left: 'That’s today’s 2. More tomorrow!',
    limit: 'That’s your 2 deck puzzles for today. More tomorrow!', buildFail: 'Couldn’t fit enough of these words together. Try the Mini, or kana answers.',
    recent: 'Your deck puzzles', play: 'Play', solved: 'solved',
    replace: 'Import a different deck', removeKey: 'Sign out this browser', confirmReplace: 'Replace this deck? Your deck puzzles stay.',
    member: 'Crossword+ · {label}', words: '{n} words',
  },
  ja: {
    title: 'マイデッキ', plus: 'クロスワード＋',
    lockedBody: '自分のAnkiデッキがクロスワードに。答えは自分の単語、カギは自分で書いた意味です。クロスワード＋の機能で、1日2つまで作れます。',
    keyLabel: 'クロスワード＋のキー', unlock: '使う', checking: '確認中…',
    badKey: 'このキーは使えませんでした。もう一度確認するか、Jaredに新しいキーをもらってください。', failed: 'サーバーにつながりませんでした。少し待ってからもう一度どうぞ。',
    notOpen: 'クロスワード＋はまだ準備中です。', joinList: 'リストに登録すると、始まったときにメールを1通だけ送ります。',
    importTitle: 'デッキを読み込む',
    howto: 'Ankiで「ファイル → 書き出す」を開き、「ノートをプレーンテキストで（.txt）」を選んで書き出します。そのファイルをここで選んでください。CSVや表計算ソフトから貼り付けたリストでも大丈夫です。',
    file: 'ファイルを選ぶ', paste: 'または貼り付け', read: '読み込む', empty: '読み込めるものがありませんでした。',
    pick: 'どのフィールドが何かを選んでください（デッキごとに違うので）。',
    fWord: '単語（答え）', fMeaning: '意味（カギ）', fReading: '読み（任意）', none: 'なし：自動で探す', field: 'フィールド{n}',
    name: 'デッキの名前', save: '{n}件を読み込む', cancel: 'やめる',
    usable: '{n}語のうち、かなの答えに使えるのは{kana}語・漢字の答えは{kanji}語',
    noReading: '{n}語は読みがわからないので、かなの答えには使いません。',
    tooFew: '使える単語が{n}語しかありません（{min}語以上必要）。単語や読みのフィールドを変えてみてください。',
    tooBig: 'このデッキはブラウザに保存するには大きすぎます。一部だけ書き出してみてください。',
    size: 'サイズ', mini: 'ミニ', daily: 'デイリー', answers: '答え', kana: 'かな', kanji: '漢字',
    make: 'パズルを作る', making: 'パズルを作っています…', left: '今日はあと{n}つ', none_left: '今日の2つを作りました。また明日！',
    limit: '今日のデッキパズル（2つ）を作りました。また明日！', buildFail: 'この単語ではうまく組めませんでした。ミニか、かなの答えを試してください。',
    recent: 'デッキのパズル', play: '解く', solved: 'クリア',
    replace: '別のデッキを読み込む', removeKey: 'このブラウザからキーを外す', confirmReplace: 'デッキを入れ替えますか？作ったパズルは残ります。',
    member: 'クロスワード＋ · {label}', words: '{n}語',
  },
};
const t = (k, vars = {}) => String((T[lang()] || T.en)[k] ?? T.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');

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

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function read() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function write(v) { localStorage.setItem(STORE, JSON.stringify(v)); }       // throws when full (caller handles)

// --- reading an export ------------------------------------------------------------------------
// Anki's plain-text export: optional "#key:value" header lines, then one note
// per line, fields split by tab (or the #separator), quoted when needed.
export function parseExport(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const head = {};
  let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) {
    const m = lines[i].match(/^#([a-z ]+):(.*)$/i);
    if (m) head[m[1].trim().toLowerCase()] = m[2].trim();
    i++;
  }
  const body = lines.slice(i).join('\n');
  const first = body.split('\n').find((l) => l.trim()) || '';
  const sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ' }[(head.separator || '').toLowerCase()]
    || (first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',');
  const rows = [];
  let row = [], field = '', q = false, start = true;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (q) {
      if (c === '"' && body[k + 1] === '"') { field += '"'; k++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"' && start) { q = true; start = false; }
    else if (c === sep) { row.push(field); field = ''; start = true; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; start = true; }
    else { field += c; start = false; }
    if (rows.length > MAX_NOTES) break;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  // Columns Anki adds that aren't note fields
  const skip = new Set(['guid column', 'notetype column', 'deck column', 'tags column'].map((k) => Number(head[k]) - 1).filter((n) => n >= 0));
  const names = head.columns ? head.columns.split(sep) : null;
  const notes = rows.filter((r) => r.some((x) => x.trim())).map((r) => r.filter((_, j) => !skip.has(j)));
  const width = Math.max(0, ...notes.slice(0, 200).map((r) => r.length));
  return { notes, width, names: names ? names.filter((_, j) => !skip.has(j)) : null };
}

// HTML and Anki markup to plain text
export function clean(s) {
  return String(s || '')
    .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\[sound:[^\]]*\]/g, '').replace(/\{\{c\d+::([^}:]*)(::[^}]*)?\}\}/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
const KANA_ONLY = /^[ぁ-ゖァ-ヺー・]+$/;
const KANJI = /[㐀-鿿豈-﫿々]/;
const ALL_KANJI = /^[一-鿿々]{2,5}$/;
const JAPANESE = /[ぁ-ゖァ-ヺ㐀-鿿々]/;
// Furigana written Anki-style: 漢字[かんじ] or 勉強[べんきょう]する
const withoutFurigana = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
const furiganaReading = (s) => (/\[[^\]]+\]/.test(s) ? s.replace(/[㐀-鿿々]+\[([^\]]+)\]/g, '$1').replace(/\s+/g, '') : '');

// Guess which fields are the word, meaning and reading from a sample of notes
function guessFields(notes, width) {
  const sample = notes.slice(0, 120);
  const score = (j, test) => sample.filter((r) => test(clean(r[j]))).length / Math.max(1, sample.length);
  const cols = Array.from({ length: width }, (_, j) => ({
    j, ja: score(j, (x) => JAPANESE.test(x) && x.length <= 12), latin: score(j, (x) => /[a-z]{2}/i.test(x) && !JAPANESE.test(x)),
    kana: score(j, (x) => KANA_ONLY.test(x)), kanji: score(j, (x) => KANJI.test(x)),
  }));
  const word = [...cols].sort((a, b) => (b.ja + b.kanji * 0.5) - (a.ja + a.kanji * 0.5))[0];
  const meaning = [...cols].filter((c) => c.j !== word.j).sort((a, b) => b.latin - a.latin)[0] || cols.find((c) => c.j !== word.j);
  const reading = cols.filter((c) => c.j !== word.j && (!meaning || c.j !== meaning.j) && c.kana > 0.6).sort((a, b) => b.kana - a.kana)[0];
  return { word: word ? word.j : 0, meaning: meaning ? meaning.j : 1, reading: reading ? reading.j : -1 };
}

// The dictionary the daily puzzles use, for readings a deck doesn't have
let dict = null;
async function dictionary() {
  if (dict) return dict;
  dict = new Map();
  try {
    const res = await fetch('../../data/crossword/words.json');
    (await res.json()).words.forEach((w) => { if (!dict.has(w.w)) dict.set(w.w, w.r); });
  } catch { /* none */ }
  return dict;
}

// Notes → { w, r, m } (written form, hiragana reading or '', meaning)
async function toWords(notes, f) {
  const out = [];
  const seen = new Set();
  let needDict = false;
  for (const r of notes) {
    const raw = clean(r[f.word]);
    const w = withoutFurigana(raw);
    const m = clean(r[f.meaning]).slice(0, 160);
    if (!w || !m || w.length > 12 || seen.has(w)) continue;
    seen.add(w);
    let rd = f.reading >= 0 ? toHira(withoutFurigana(clean(r[f.reading]))) : '';
    if (!KANA_ONLY.test(rd)) rd = '';
    if (!rd && KANA_ONLY.test(w)) rd = toHira(w);
    if (!rd) rd = toHira(furiganaReading(raw));
    if (!KANA_ONLY.test(rd)) rd = '';
    if (!rd) needDict = true;
    out.push({ w, r: rd, m });
  }
  if (needDict) {
    const d = await dictionary();
    out.forEach((x) => { if (!x.r && d.has(x.w)) x.r = d.get(x.w); });
  }
  return out;
}

// Which words can be answers of each kind
const kanaAnswer = (x) => { const a = x.r ? gridKana(x.r) : ''; return a.length >= 2 && a.length <= 9 ? a : ''; };
const kanjiAnswer = (x) => (ALL_KANJI.test(x.w) ? x.w : '');
const counts = (words) => ({ n: words.length, kana: words.filter(kanaAnswer).length, kanji: words.filter(kanjiAnswer).length });
const MIN_WORDS = 12;

// A deck meaning as a clue: never shows the answer itself
function deckClue(x, kind) {
  let c = x.m;
  [x.w, x.r, kind === 'kanji' ? null : toHira(x.r)].filter(Boolean).forEach((s) => { if (s.length >= 1) c = c.split(s).join('＿＿'); });
  c = c.length > 110 ? `${c.slice(0, 108).replace(/[,;、。]?\s*\S*$/, '')}…` : c;
  return kind === 'kanji' && x.r ? `${c} · ${x.r}` : c;
}

// --- the panel --------------------------------------------------------------------------------
export function mountDeck({ root, play }) {
  let visible = false;
  let member = null;            // { label, left } once the key checks out
  let draft = null;             // an import in progress: { notes, width, names, fields, name }
  let status = { text: '', error: false };
  let busy = false;
  let checked = false;

  const state = () => read();
  const setStatus = (text, error = false) => { status = { text, error }; render(); };

  async function api(path, body) {
    const res = await fetch(`${API}/public/plus/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok && res.status !== 429) throw new Error(String(res.status));
    return res.json();
  }

  async function check(key) {
    busy = true; setStatus(t('checking'));
    try {
      const r = await api('check', { key, day: localDate() });
      if (r.ok) { setPlusKey(key); member = { label: r.label, left: r.left }; status = { text: '', error: false }; }
      else { member = null; if (key === plusKey()) setPlusKey(''); status = { text: r.error === 'key' ? t('badKey') : r.error || t('failed'), error: true }; }
    } catch { status = { text: t('failed'), error: true }; }
    busy = false; checked = true; render();
  }

  // --- views
  function locked() {
    const input = h('input', { type: 'text', placeholder: 'CWP-XXXX-XXXX-XXXX-XXXX', 'aria-label': t('keyLabel'), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: plusKey() });
    const go = h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => { const k = input.value.trim().toUpperCase(); if (k) check(k); } }, t('unlock'));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    return [
      h('p', {}, t('lockedBody')),
      h('div', { class: 'cw-deck-row' }, input, go),
      h('p', { class: 'cw-deck-muted' }, t('notOpen'), ' ', h('a', { href: '#plus-sec' }, t('joinList'))),
    ];
  }

  function importer() {
    const fileIn = h('input', { type: 'file', accept: '.txt,.tsv,.csv,text/plain,text/csv', 'aria-label': t('file') });
    const area = h('textarea', { 'aria-label': t('paste'), placeholder: t('paste') });
    const start = (text, name) => {
      const p = parseExport(text);
      if (!p.notes.length || p.width < 2) { setStatus(t('empty'), true); return; }
      draft = { ...p, fields: guessFields(p.notes, p.width), name: (name || 'My deck').replace(/\.(txt|tsv|csv)$/i, '').slice(0, 60) };
      setStatus('');
    };
    fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (f) start(await f.text(), f.name); });
    return [
      h('h3', { class: 'cw-deck-sub' }, t('importTitle')),
      h('p', {}, t('howto')),
      h('div', { class: 'cw-deck-row' }, fileIn),
      h('details', {}, h('summary', {}, t('paste')), area, h('div', { class: 'cw-deck-row' }, h('button', { type: 'button', class: 'btn', onclick: () => start(area.value, 'My deck') }, t('read')))),
    ];
  }

  function picker() {
    const d = draft;
    const label = (j) => (d.names && d.names[j] ? d.names[j] : t('field', { n: j + 1 }));
    const sel = (key, optional) => {
      const s = h('select', { onchange: (e) => { d.fields[key] = Number(e.target.value); render(); } },
        optional ? h('option', { value: '-1' }, t('none')) : null,
        Array.from({ length: d.width }, (_, j) => h('option', { value: String(j) }, `${label(j)}: ${clean(d.notes[0][j] || '').slice(0, 24)}`)));
      s.value = String(d.fields[key]);
      return s;
    };
    const name = h('input', { type: 'text', value: d.name, maxlength: '60', 'aria-label': t('name'), oninput: (e) => { d.name = e.target.value; } });
    const preview = h('div', { class: 'cw-deck-preview' }, h('table', {},
      h('thead', {}, h('tr', {}, Array.from({ length: d.width }, (_, j) => h('th', {}, label(j))))),
      h('tbody', {}, d.notes.slice(0, 5).map((r) => h('tr', {}, Array.from({ length: d.width }, (_, j) => h('td', {}, clean(r[j] || '').slice(0, 40))))))));
    const save = h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: async () => {
      busy = true; setStatus(t('checking'));
      const words = await toWords(d.notes, d.fields);
      const c = counts(words);
      busy = false;
      if (Math.max(c.kana, c.kanji) < MIN_WORDS) { setStatus(t('tooFew', { n: Math.max(c.kana, c.kanji), min: MIN_WORDS }), true); return; }
      const s = state();
      try { write({ ...s, name: d.name.trim() || 'My deck', words, kind: c.kana >= MIN_WORDS ? (s.kind || 'kana') : 'kanji' }); } catch { setStatus(t('tooBig'), true); return; }
      draft = null;
      setStatus(t('usable', c) + (c.n - c.kana ? ` ${t('noReading', { n: c.n - c.kana })}` : ''));
    } }, t('save', { n: d.notes.length }));
    return [
      h('h3', { class: 'cw-deck-sub' }, t('importTitle')),
      h('p', {}, t('pick')),
      preview,
      h('div', { class: 'cw-deck-fields' },
        h('label', {}, t('fWord'), sel('word')), h('label', {}, t('fMeaning'), sel('meaning')), h('label', {}, t('fReading'), sel('reading', true)),
        h('label', {}, t('name'), name)),
      h('div', { class: 'cw-deck-row' }, save, h('button', { type: 'button', class: 'btn-link', onclick: () => { draft = null; setStatus(''); } }, t('cancel'))),
    ];
  }

  function ready(s) {
    const c = counts(s.words);
    const size = s.size || 'mini';
    const kind = c.kanji >= MIN_WORDS && s.kind === 'kanji' ? 'kanji' : c.kana >= MIN_WORDS ? 'kana' : 'kanji';
    const seg = (name, value, opts) => h('div', { class: 'cw-seg', role: 'radiogroup', 'aria-label': t(name) }, opts.map(([v, label, disabled]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), disabled,
      onclick: () => { const x = state(); x[name] = v; try { write(x); } catch { /* full */ } render(); },
    }, label)));
    const left = member ? member.left : 0;
    const made = (s.made || []).slice().reverse();
    return [
      h('p', { class: 'cw-deck-muted' }, `${s.name} · ${t('words', { n: s.words.length })} · ${t('usable', c)}`),
      h('div', { class: 'cw-deck-row' },
        seg('size', size, [['mini', t('mini')], ['daily', t('daily')]]),
        seg('kind', kind, [['kana', t('kana'), c.kana < MIN_WORDS], ['kanji', t('kanji'), c.kanji < MIN_WORDS]])),
      h('div', { class: 'cw-deck-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy || !left, onclick: () => make(s, size, kind) }, t('make')),
        h('span', { class: 'cw-deck-muted' }, left ? t('left', { n: left }) : t('none_left'))),
      made.length ? h('div', {}, h('h3', { class: 'cw-deck-sub' }, t('recent')),
        h('ul', { class: 'cw-deck-list' }, made.map((p) => h('li', {}, h('button', { type: 'button', onclick: () => play(p) },
          h('span', {}, `${p.deck.name} · ${t(p.size)} · ${t(p.mode === 'kanji' ? 'kanji' : 'kana')}`),
          h('span', { class: 'cw-deck-muted' }, `${p.made}${solvedIds().has(p.id) ? ` · ${t('solved')} ✓` : ''}`)))))) : null,
      h('div', { class: 'cw-deck-row' },
        h('button', { type: 'button', class: 'btn-link', onclick: () => { if (confirm(t('confirmReplace'))) { const x = state(); delete x.words; delete x.name; write(x); render(); } } }, t('replace')),
        h('button', { type: 'button', class: 'btn-link', onclick: () => { setPlusKey(''); member = null; render(); } }, t('removeKey'))),
    ];
  }

  const solvedIds = () => {
    try { const p = JSON.parse(localStorage.getItem('jareddesu.crossword.v1') || '{}').progress || {}; return new Set(Object.keys(p).filter((k) => p[k].done)); } catch { return new Set(); }
  };

  // Build in a Web Worker (the page stays responsive), then count it
  async function make(s, size, kind) {
    busy = true; setStatus(t('making'));
    const pick = kind === 'kanji' ? kanjiAnswer : kanaAnswer;
    const words = s.words.map((x) => ({ x, a: pick(x) })).filter((y) => y.a).map(({ x, a }) => ({ a, w: x.w, r: x.r, m: x.m }));
    const seed = `${Date.now()}:${Math.random()}`;
    let draftPuzzle;
    try {
      draftPuzzle = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('./deck-worker.js?v=1', import.meta.url), { type: 'module' });
        const timer = setTimeout(() => { w.terminate(); reject(new Error('timeout')); }, 60000);
        w.onmessage = (e) => { clearTimeout(timer); w.terminate(); if (e.data.ok) resolve(e.data.p); else reject(new Error(e.data.error)); };
        w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'worker')); };
        w.postMessage({ words, kind, size, seed });
      });
    } catch { busy = false; setStatus(t('buildFail'), true); return; }
    let r;
    try { r = await api('deck', { key: plusKey(), day: localDate() }); } catch { busy = false; setStatus(t('failed'), true); return; }
    busy = false;
    if (!r.ok) {
      if (r.error === 'key') { member = null; setPlusKey(''); setStatus(t('badKey'), true); return; }
      if (member) member.left = 0;
      setStatus(t('limit'), true);
      return;
    }
    if (member) member.left = r.left;
    const p = toPuzzle(draftPuzzle, { kind, size, name: s.name, seed });
    const x = state();
    x.made = [...(x.made || []), p].slice(-KEEP);
    try { write(x); } catch { x.made = x.made.slice(-3); try { write(x); } catch { /* full: still playable now */ } }
    setStatus('');
    play(p);
  }

  function render() {
    if (!visible) return;
    const s = state();
    const head = h('h2', {}, t('title'), ' ', h('span', { class: 'cw-plus-mark' }, '＋'),
      member && member.label ? h('span', { class: 'cw-deck-muted' }, ` · ${t('member', { label: member.label })}`) : null);
    let body;
    if (!member) body = locked();
    else if (draft) body = picker();
    else if (!s.words || !s.words.length) body = importer();
    else body = ready(s);
    root.replaceChildren(head, ...body.filter(Boolean), h('p', { class: `cw-deck-status${status.error ? ' is-error' : ''}`, role: 'status', 'aria-live': 'polite' }, status.text));
  }

  return {
    show(on) {
      visible = on;
      root.hidden = !on;
      if (!on) return;
      if (!checked && plusKey()) { checked = true; check(plusKey()); }
      render();
    },
    current() { return null; },
    relabel() { render(); },
  };
}

// A built draft as the player loads it (like cli.mjs toPublished, but with the key in clear: it's the player's own deck)
function toPuzzle(p, { kind, size, name, seed }) {
  const id = `deck-${seed.replace(/[^0-9]/g, '').slice(0, 16)}`;
  const entries = p.entries.map((e) => ({ ...e, clue: deckClue({ w: e.word, r: e.reading, m: e.meaning }, kind) }));
  return {
    id, mode: kind === 'kanji' ? 'kanji' : 'kana', size, level: 'deck', width: p.width, height: p.height, free: true,
    made: localDate(), deck: { name },
    grid: p.rows.map((r) => [...r].map((ch) => (ch === '#' ? '#' : '.')).join('')),
    clues: entries.map((e) => ({ num: e.num, dir: e.dir, row: e.row, col: e.col, len: e.len, clue: e.clue })),
    keyword: p.keyword ? { cells: p.keyword.cells, clue: deckClue({ w: p.keyword.word, r: p.keyword.reading, m: p.keyword.meaning }, kind) } : null,
    keyObj: {
      rows: p.rows,
      entries: entries.map((e) => ({ num: e.num, dir: e.dir, answer: e.answer, word: e.word, reading: e.reading, meaning: e.meaning })),
      keyword: p.keyword ? { answer: p.keyword.answer, word: p.keyword.word, reading: p.keyword.reading, meaning: p.keyword.meaning } : null,
    },
  };
}
