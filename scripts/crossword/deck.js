// deck.js — the My deck panel on the crossword page: crosswords from your
// own Anki deck (1 free a day, unlimited with Crossword+), bonus puzzles for
// members, and Crossword+ itself: sign in and plans (account.js; the sponsor
// Worker's plus.js and stripe.js).
//
// 2. Import: Anki's "Notes in Plain Text" export (or any tab/CSV list, or a
//    paste), or an .apkg deck package. Every deck has different fields, so the player picks which field
//    is the word, the meaning, and (optionally) the reading.
// 3. Make a puzzle: built here in a Web Worker (deck-worker.js) from the deck's
//    words only, then counted against today's limit by the Worker (2 a day).
// The deck and the puzzles stay in this browser (localStorage); nothing from
// the deck is sent anywhere. Everything from the deck is inserted as text.

import { lang } from '../games/i18n.js?v=1';
import { gridKana, toHira } from './kana.js?v=1';
import { info, refresh, currentUser, onAccount, signedIn, sendEmailLink, googleButton, logout, checkout, portal, bonusPuzzle } from './account.js?v=2';
import { plusPerks, plusBadge, supportLine, paywall, nudge } from './plus.js?v=10';
import { openBrowse } from './browse.js?v=1';

const STORE = 'jareddesu.crossword.deck';
const KEEP = 60;                 // puzzles kept to replay (the list shows the newest few; the rest are under "See all")
const SHOW = 3;
const FREE_PER_DAY = 1;
const MAX_NOTES = 20000;

const T = {
  en: {
    title: 'My deck',
    intro: 'Turn your own Anki deck into crosswords: your words, with your meanings as the clues. One a day is free.',
    plusTitle: 'Crossword+',
    pitch: 'Today’s puzzles are always free. Crossword+ unlocks:',
    seeAll: 'See all {n}', bonusLockedN: '{n} bonus puzzles are waiting in Crossword+.',
    freeLeft: '1 free puzzle today', freeUsed: 'You’ve made today’s free deck puzzle. With Crossword+ you can make as many as you like.', unlimited: 'Unlimited with Crossword+',
    bonusLocked: 'Bonus puzzles are part of Crossword+.',
    perMonth: '{price} / month', perYear: '{price} / year', yearNote: 'about 30% off',
    signInTitle: 'Sign in', signInWhy: 'Crossword+ is tied to your email, so it works on all your devices. Signing in is only for Crossword+; the daily puzzles never need it.',
    emailLabel: 'Your email', sendLink: 'Email me a sign-in link', sending: 'Sending…', sent: 'Check your inbox for a sign-in link (it works for 20 minutes). It can take a minute; check spam too.',
    or: 'or', noSignIn: 'Sign-in isn’t set up yet.',
    signedInAs: 'Signed in as {email}', signOut: 'Sign out', notOpen: 'Crossword+ isn’t open yet.', joinList: 'Join the list for one email when it is.',
    choose: 'Choose a plan', paying: 'Opening Stripe…', test: 'Test mode: no real charges.', secure: 'Payment by Stripe. Cancel anytime from “Manage subscription”.',
    member: 'You’re a Crossword+ member', memberFree: 'You have Crossword+ (on the house)', renews: 'Renews {date}', ends: 'Ends {date}', pastDue: 'Your last payment didn’t go through; Stripe will try again. Update your card in “Manage subscription”.',
    manage: 'Manage subscription', welcome: 'Welcome to Crossword+! Thanks for supporting the crossword.', signedInMsg: 'You’re signed in.', cancelled: 'No charge was made.',
    deckTitle: 'My deck', bonusTitle: 'Bonus puzzles', bonusNone: 'The first bonus puzzles are on their way.', bonusLoad: 'Couldn’t open that puzzle. Please try again.',
    importTitle: 'Import your deck',
    howto: 'Pick the .apkg file you exported from Anki (File → Export → Anki Deck Package, or the file you downloaded from AnkiWeb). A plain-text export, a CSV, or a list pasted from a spreadsheet works too.',
    file: 'Choose a file', paste: 'Or paste it', read: 'Read it', empty: 'There’s nothing to read in that.',
    readingApkg: 'Opening your deck…', apkgBad: 'That doesn’t look like an Anki deck package. Try exporting it again, or use “Notes in Plain Text”.',
    apkgFail: 'Couldn’t open that deck here. Try exporting it as “Notes in Plain Text” instead.', noteType: 'Note type', notesN: '{n} notes',
    pick: 'Which field is which? Every deck is set up differently, so pick them here.',
    fWord: 'Word (the answer)', fMeaning: 'Meaning (the clue)', fReading: 'Reading (optional)', none: 'None: work it out', field: 'Field {n}',
    name: 'Deck name', save: 'Import {n} notes', cancel: 'Cancel', checking: 'Reading…',
    usable: '{kana} of {n} can be kana answers · {kanji} can be kanji answers',
    noReading: '{n} words have no reading, so they’ll be skipped for kana answers.',
    tooFew: 'Only {n} words can be used. A puzzle needs at least {min}; try another field for the word or reading.',
    tooBig: 'This deck is too big to keep in this browser. Try exporting part of it.',
    size: 'Size', mini: 'Mini', daily: 'Daily', answers: 'Answers', kana: 'Kana', kanji: 'Kanji',
    make: 'Make a puzzle', making: 'Building your puzzle…', left: '{n} left today', none_left: 'That’s today’s 2. More tomorrow!',
    limit: 'That’s your 2 deck puzzles for today. More tomorrow!', buildFail: 'Couldn’t fit enough of these words together. Try the Mini, or kana answers.',
    failed: 'Couldn’t reach the server. Please try again in a bit.',
    recent: 'Your deck puzzles', solved: 'solved',
    replace: 'Import a different deck', confirmReplace: 'Replace this deck? Your deck puzzles stay.', words: '{n} words',
  },
  ja: {
    title: 'マイデッキ',
    intro: '自分のAnkiデッキがクロスワードに。答えは自分の単語、カギは自分で書いた意味です。1日1つは無料。',
    plusTitle: 'クロスワード＋',
    pitch: '今日のパズルはずっと無料。クロスワード＋なら：',
    seeAll: '全部見る（{n}）', bonusLockedN: 'クロスワード＋で{n}個のボーナスパズルが遊べます。',
    freeLeft: '今日の無料パズル：あと1つ', freeUsed: '今日の無料デッキパズルを作りました。クロスワード＋なら何個でも作れます。', unlimited: 'クロスワード＋で作り放題',
    bonusLocked: 'ボーナスパズルはクロスワード＋の特典です。',
    perMonth: '月{price}', perYear: '年{price}', yearNote: '約30%お得',
    signInTitle: 'ログイン', signInWhy: 'クロスワード＋はメールアドレスにひもづくので、どの端末でも使えます。ログインはクロスワード＋のためだけで、毎日のパズルには必要ありません。',
    emailLabel: 'メールアドレス', sendLink: 'ログインリンクをメールで送る', sending: '送信中…', sent: 'ログインリンクを送りました（20分間有効）。届くまで少しかかることがあります。迷惑メールも確認してください。',
    or: 'または', noSignIn: 'ログインはまだ準備中です。',
    signedInAs: '{email} でログイン中', signOut: 'ログアウト', notOpen: 'クロスワード＋はまだ準備中です。', joinList: 'リストに登録すると、始まったときにメールを1通だけ送ります。',
    choose: 'プランを選ぶ', paying: 'Stripeを開いています…', test: 'テストモード：実際の請求はありません。', secure: 'お支払いはStripeで。「プランの管理」からいつでも解約できます。',
    member: 'クロスワード＋のメンバーです', memberFree: 'クロスワード＋をご利用いただけます（招待）', renews: '{date}に更新', ends: '{date}に終了', pastDue: '前回のお支払いができませんでした。Stripeが再度試みます。「プランの管理」でカードを更新してください。',
    manage: 'プランの管理', welcome: 'クロスワード＋へようこそ！応援ありがとうございます。', signedInMsg: 'ログインしました。', cancelled: '請求はされていません。',
    deckTitle: 'マイデッキ', bonusTitle: 'ボーナスパズル', bonusNone: '最初のボーナスパズルは準備中です。', bonusLoad: 'パズルを開けませんでした。もう一度お試しください。',
    importTitle: 'デッキを読み込む',
    howto: 'Ankiで書き出した .apkg ファイル（「ファイル → 書き出す → Ankiデッキパッケージ」、またはAnkiWebでダウンロードしたもの）を選んでください。プレーンテキストやCSV、表計算ソフトから貼り付けたリストでも大丈夫です。',
    file: 'ファイルを選ぶ', paste: 'または貼り付け', read: '読み込む', empty: '読み込めるものがありませんでした。',
    readingApkg: 'デッキを開いています…', apkgBad: 'Ankiのデッキパッケージではないようです。もう一度書き出すか、「ノートをプレーンテキストで」を使ってください。',
    apkgFail: 'このデッキはここでは開けませんでした。「ノートをプレーンテキストで」で書き出してみてください。', noteType: 'ノートタイプ', notesN: '{n}件',
    pick: 'どのフィールドが何かを選んでください（デッキごとに違うので）。',
    fWord: '単語（答え）', fMeaning: '意味（カギ）', fReading: '読み（任意）', none: 'なし：自動で探す', field: 'フィールド{n}',
    name: 'デッキの名前', save: '{n}件を読み込む', cancel: 'やめる', checking: '読み込み中…',
    usable: '{n}語のうち、かなの答えに使えるのは{kana}語・漢字の答えは{kanji}語',
    noReading: '{n}語は読みがわからないので、かなの答えには使いません。',
    tooFew: '使える単語が{n}語しかありません（{min}語以上必要）。単語や読みのフィールドを変えてみてください。',
    tooBig: 'このデッキはブラウザに保存するには大きすぎます。一部だけ書き出してみてください。',
    size: 'サイズ', mini: 'ミニ', daily: 'デイリー', answers: '答え', kana: 'かな', kanji: '漢字',
    make: 'パズルを作る', making: 'パズルを作っています…', left: '今日はあと{n}つ', none_left: '今日の2つを作りました。また明日！',
    limit: '今日のデッキパズル（2つ）を作りました。また明日！', buildFail: 'この単語ではうまく組めませんでした。ミニか、かなの答えを試してください。',
    failed: 'サーバーにつながりませんでした。少し待ってからもう一度どうぞ。',
    recent: 'デッキのパズル', solved: 'クリア',
    replace: '別のデッキを読み込む', confirmReplace: 'デッキを入れ替えますか？作ったパズルは残ります。', words: '{n}語',
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

// An Anki deck package (.apkg, or a whole collection .colpkg): a zip with the
// collection as SQLite. Newer Anki writes collection.anki21b (zstd-compressed,
// note types in their own tables, and a stub collection.anki2 asking you to
// update); older ones collection.anki21 / .anki2 (note types as JSON in col).
// The libraries load only when someone picks a package. Returns the note
// types, most notes first: [{ name, names (field names), notes (rows of fields) }].
const LIBS = {
  zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  sql: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
  wasm: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm',
  zstd: 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js',
};
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true; el.crossOrigin = 'anonymous';
      el.onload = resolve; el.onerror = () => { delete scripts[src]; reject(new Error('load')); };
      document.head.append(el);
    });
  }
  return scripts[src];
}
const rowsOf = (db, sql) => { const r = db.exec(sql); return r.length ? r[0].values : []; };

export async function parseApkg(file) {
  await loadScript(LIBS.zip);
  const zip = await window.JSZip.loadAsync(file);
  const name = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.file(n));
  if (!name) throw new Error('nocollection');
  let bytes = await zip.file(name).async('uint8array');
  if (name.endsWith('b')) { await loadScript(LIBS.zstd); bytes = window.fzstd.decompress(bytes); }
  await loadScript(LIBS.sql);
  const SQL = await window.initSqlJs({ locateFile: () => LIBS.wasm });
  const db = new SQL.Database(bytes);
  try {
    const tables = new Set(rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r[0]));
    const types = new Map();            // note type id -> { name, names }
    if (tables.has('notetypes') && tables.has('fields')) {
      rowsOf(db, 'SELECT id, name FROM notetypes').forEach(([id, n]) => types.set(String(id), { name: n, names: [] }));
      rowsOf(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').forEach(([nt, ord, n]) => { const x = types.get(String(nt)); if (x) x.names[ord] = n; });
    } else {
      const col = rowsOf(db, 'SELECT models FROM col');
      const models = col.length ? JSON.parse(col[0][0] || '{}') : {};
      Object.entries(models).forEach(([id, m]) => types.set(String(id), { name: m.name, names: (m.flds || []).slice().sort((a, b) => a.ord - b.ord).map((f) => f.name) }));
    }
    const byType = new Map();
    rowsOf(db, 'SELECT mid, flds FROM notes').forEach(([mid, flds]) => {
      const k = String(mid);
      if (!byType.has(k)) byType.set(k, []);
      if (byType.get(k).length < MAX_NOTES) byType.get(k).push(String(flds).split('\x1f'));
    });
    return [...byType].map(([k, notes]) => ({ name: (types.get(k) || {}).name || 'Notes', names: (types.get(k) || {}).names || null, notes }))
      .filter((x) => x.notes.length).sort((a, b) => b.notes.length - a.notes.length);
  } finally { db.close(); }
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
// Field names are the best hint (Word / Expression / 単語, Meaning / 意味,
// Reading / 読み); the contents decide when the names don't say
const NAME_WORD = /^(word|expression|vocab(ulary)?|front|kanji|term|japanese|target ?word|単語|語彙|表現|言葉|漢字)$|(^|\b)(word|expression|vocab)(\b|$)/i;
const NAME_MEANING = /(meaning|definition|gloss|english|translation|back|意味|英訳|訳)/i;
const NAME_READING = /(reading|kana|furigana|yomi|読み|ふりがな|かな)/i;
const NAME_SKIP = /(sentence|example|audio|sound|image|pic|note|frequency|freq|pitch|tags?|例文|文)/i;
function guessFields(notes, width, names = null) {
  const sample = notes.slice(0, 120);
  const score = (j, test) => sample.filter((r) => test(clean(r[j]))).length / Math.max(1, sample.length);
  const avgLen = (j) => sample.reduce((n, r) => n + clean(r[j]).length, 0) / Math.max(1, sample.length);
  const name = (j) => (names && names[j]) || '';
  const cols = Array.from({ length: width }, (_, j) => ({
    j, ja: score(j, (x) => JAPANESE.test(x) && x.length <= 12), latin: score(j, (x) => /[a-z]{2}/i.test(x) && !JAPANESE.test(x)),
    kana: score(j, (x) => KANA_ONLY.test(x)), kanji: score(j, (x) => KANJI.test(x)), len: avgLen(j), skip: NAME_SKIP.test(name(j)),
  }));
  // A field named like a reading or meaning isn't the word, even if "Word" is in its name ("Word Reading")
  const named = (re, not = []) => cols.find((c) => re.test(name(c.j)) && !c.skip && !not.some((x) => x.test(name(c.j))));
  const wordScore = (c) => c.ja + c.kanji * 0.5 - (c.len > 8 ? 1 : 0) - (c.skip ? 2 : 0);
  const word = named(NAME_WORD, [NAME_MEANING, NAME_READING]) || [...cols].sort((a, b) => wordScore(b) - wordScore(a))[0];
  const meaning = named(NAME_MEANING, []) && named(NAME_MEANING, []).j !== word.j ? named(NAME_MEANING, [])
    : [...cols].filter((c) => c.j !== word.j && !c.skip).sort((a, b) => b.latin - a.latin)[0] || cols.find((c) => c.j !== word.j);
  const namedReading = named(NAME_READING, []);
  const reading = namedReading && namedReading.j !== word.j && (!meaning || namedReading.j !== meaning.j) ? namedReading
    : cols.filter((c) => c.j !== word.j && (!meaning || c.j !== meaning.j) && c.kana > 0.6 && !c.skip).sort((a, b) => b.kana - a.kana)[0];
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
  let draft = null;             // an import in progress: { notes, width, names, fields, name }
  let status = { text: '', error: false };
  let busy = false;
  let cfg = null;               // account.info()
  let bonus = null;             // the bonus puzzle list
  let loaded = false;
  let googleOk = true;          // false once Google's script fails (blocked, offline): then just email

  const state = () => read();
  const member = () => Boolean(currentUser() && currentUser().member);
  // Everyone gets 1 deck puzzle a day (counted in this browser); members, as many as they like
  const freeLeft = () => { const f = state().free || {}; return f.day === localDate() ? Math.max(0, FREE_PER_DAY - f.n) : FREE_PER_DAY; };
  const useFree = () => { const x = state(); const f = x.free && x.free.day === localDate() ? x.free : { day: localDate(), n: 0 }; x.free = { day: f.day, n: f.n + 1 }; try { write(x); } catch { /* full */ } };
  const setStatus = (text, error = false) => { status = { text, error }; render(); };
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(lang() === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  onAccount(() => render());

  async function load() {
    if (loaded) return;
    loaded = true;
    cfg = await info();
    await refresh();
    try { bonus = ((await (await fetch('../../data/crossword/bonus/index.json', { cache: 'no-cache' })).json()).bonus || []); } catch { bonus = []; }
    render();
  }

  // --- views
  function plans() {
    if (!cfg || !cfg.open) return [h('p', { class: 'cw-deck-muted' }, t('notOpen'), ' ', h('a', { href: '#plus-sec' }, t('joinList')))];
    const go = (plan) => async (e) => {
      if (!signedIn()) { document.getElementById('cw-signin')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      busy = true; setStatus(t('paying'));
      try { await checkout(plan); } catch (err) { busy = false; setStatus(err.message || t('failed'), true); }
    };
    return [
      h('div', { class: 'cw-deck-row cw-plans' },
        h('button', { type: 'button', class: 'btn btn-plus', disabled: busy, onclick: go('month') }, t('perMonth', { price: cfg.prices.month })),
        h('button', { type: 'button', class: 'btn', disabled: busy, onclick: go('year') }, t('perYear', { price: cfg.prices.year }), h('span', { class: 'cw-seg-sub' }, ` · ${t('yearNote')}`))),
      h('p', { class: 'cw-deck-muted' }, t('secure'), cfg.test ? ` ${t('test')}` : ''),
    ];
  }

  function signInBox() {
    const useGoogle = cfg && cfg.google && googleOk;
    if (!cfg || (!useGoogle && !cfg.email)) return [h('p', { class: 'cw-deck-muted' }, t('noSignIn'))];
    const g = h('div', { class: 'cw-google' });
    // A failed load hides the button (no message: re-rendering would just try again)
    if (useGoogle) googleButton(g, { onError: (e) => { if (/load/i.test(e.message || '')) { googleOk = false; render(); } else setStatus(e.message || t('failed'), true); } });
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: t('emailLabel'), 'aria-label': t('emailLabel'), maxlength: '254' });
    const send = h('button', { type: 'button', class: 'btn', disabled: busy, onclick: async () => {
      const v = email.value.trim();
      if (!v) { email.focus(); return; }
      busy = true; setStatus(t('sending'));
      try { await sendEmailLink(v); busy = false; setStatus(t('sent')); } catch (e) { busy = false; setStatus(e.message || t('failed'), true); }
    } }, t('sendLink'));
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
    return [
      h('div', { class: 'cw-signin', id: 'cw-signin' },
        h('h3', { class: 'cw-deck-sub' }, t('signInTitle')),
        h('p', { class: 'cw-deck-muted' }, t('signInWhy')),
        useGoogle ? g : null,
        useGoogle && cfg.email ? h('p', { class: 'cw-deck-or' }, t('or')) : null,
        cfg.email ? h('div', { class: 'cw-deck-row' }, email, send) : null),
    ];
  }

  function accountLine(u) {
    return h('p', { class: 'cw-deck-muted' }, t('signedInAs', { email: u.email }), ' · ',
      h('button', { type: 'button', class: 'btn-link', onclick: async () => { await logout(); setStatus(''); } }, t('signOut')));
  }

  function membership(u) {
    const line = u.granted && !u.paid ? t('memberFree')
      : `${t('member')}${u.renews ? ` · ${t(u.status === 'canceled' ? 'ends' : 'renews', { date: fmtDay(u.renews) })}` : ''}`;
    return [
      h('p', { class: 'cw-deck-member' }, '✓ ', line),
      u.status === 'past_due' ? h('p', { class: 'cw-deck-status is-error' }, t('pastDue')) : null,
      u.paid ? h('div', { class: 'cw-deck-row' }, h('button', { type: 'button', class: 'btn-link', onclick: async () => { try { await portal(); } catch (e) { setStatus(e.message || t('failed'), true); } } }, t('manage'))) : null,
    ];
  }

  function importer() {
    const fileIn = h('input', { type: 'file', accept: '.apkg,.colpkg,.txt,.tsv,.csv,text/plain,text/csv', 'aria-label': t('file') });
    const area = h('textarea', { 'aria-label': t('paste'), placeholder: t('paste') });
    const start = (text, name) => {
      const p = parseExport(text);
      if (!p.notes.length || p.width < 2) { setStatus(t('empty'), true); return; }
      draft = { ...p, fields: guessFields(p.notes, p.width, p.names), name: (name || 'My deck').replace(/\.(txt|tsv|csv)$/i, '').slice(0, 60) };
      setStatus('');
    };
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      if (!f) return;
      if (!/\.(apkg|colpkg)$/i.test(f.name)) { start(await f.text(), f.name); return; }
      busy = true; setStatus(t('readingApkg'));
      try {
        const types = await parseApkg(f);
        busy = false;
        if (!types.length) { setStatus(t('empty'), true); return; }
        draft = { types, type: 0, ...fromType(types[0]), name: f.name.replace(/\.(apkg|colpkg)$/i, '').slice(0, 60) };
        setStatus('');
      } catch (e) { busy = false; setStatus(t(e.message === 'nocollection' ? 'apkgBad' : 'apkgFail'), true); }
    });
    return [
      h('h3', { class: 'cw-deck-sub' }, t('importTitle')),
      h('p', {}, t('howto')),
      h('div', { class: 'cw-deck-row' }, fileIn),
      h('details', {}, h('summary', {}, t('paste')), area, h('div', { class: 'cw-deck-row' }, h('button', { type: 'button', class: 'btn', onclick: () => start(area.value, 'My deck') }, t('read')))),
    ];
  }

  // One note type of a package as the rows the field picker works on
  function fromType(tp) {
    const width = Math.max(0, ...tp.notes.slice(0, 200).map((r) => r.length));
    return { notes: tp.notes, width, names: tp.names, fields: guessFields(tp.notes, width, tp.names) };
  }

  function picker() {
    const d = draft;
    // A package with several note types: pick which one to use
    const typeSel = d.types && d.types.length > 1 ? h('label', {}, t('noteType'), (() => {
      const s = h('select', { onchange: (e) => { Object.assign(d, fromType(d.types[Number(e.target.value)]), { type: Number(e.target.value) }); render(); } },
        d.types.map((tp, i) => h('option', { value: String(i) }, `${tp.name} · ${t('notesN', { n: tp.notes.length })}`)));
      s.value = String(d.type || 0);
      return s;
    })()) : null;
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
      typeSel ? h('div', { class: 'cw-deck-fields' }, typeSel) : null,
      preview,
      h('div', { class: 'cw-deck-fields' },
        h('label', {}, t('fWord'), sel('word')), h('label', {}, t('fMeaning'), sel('meaning')), h('label', {}, t('fReading'), sel('reading', true)),
        h('label', {}, t('name'), name)),
      h('div', { class: 'cw-deck-row' }, save, h('button', { type: 'button', class: 'btn-link', onclick: () => { draft = null; setStatus(''); } }, t('cancel'))),
    ];
  }

  function deckView(s, u) {
    const c = counts(s.words);
    const size = s.size || 'mini';
    const kind = c.kanji >= MIN_WORDS && s.kind === 'kanji' ? 'kanji' : c.kana >= MIN_WORDS ? 'kana' : 'kanji';
    const seg = (name, value, opts) => h('div', { class: 'cw-seg', role: 'radiogroup', 'aria-label': t(name) }, opts.map(([v, label, disabled]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), disabled,
      onclick: () => { const x = state(); x[name] = v; try { write(x); } catch { /* full */ } render(); },
    }, label)));
    const isMember = member();
    const left = isMember ? Infinity : freeLeft();
    const made = (s.made || []).slice().reverse();
    return [
      h('p', { class: 'cw-deck-muted' }, `${s.name} · ${t('words', { n: s.words.length })} · ${t('usable', c)}`),
      h('div', { class: 'cw-deck-row' },
        seg('size', size, [['mini', t('mini')], ['daily', t('daily')]]),
        seg('kind', kind, [['kana', t('kana'), c.kana < MIN_WORDS], ['kanji', t('kanji'), c.kanji < MIN_WORDS]])),
      h('div', { class: 'cw-deck-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: () => (left ? make(s, size, kind) : nudge(document.getElementById('cw-paywall'))) }, t('make')),
        h('span', { class: 'cw-deck-muted' }, isMember ? t('unlimited') : left ? t('freeLeft') : '')),
      !isMember && !left ? paywall(t('freeUsed'), showPlus, { id: 'cw-paywall' }) : null,
      made.length ? h('div', {}, h('h3', { class: 'cw-deck-sub' }, t('recent')),
        h('ul', { class: 'cw-deck-list' }, made.slice(0, SHOW).map((p) => h('li', {}, h('button', { type: 'button', onclick: () => play(p) },
          h('span', {}, deckLabel(p)),
          h('span', { class: 'cw-deck-muted' }, `${p.made}${solvedIds().has(p.id) ? ` · ${t('solved')} ✓` : ''}`))))),
        made.length > SHOW ? h('button', { type: 'button', class: 'btn-link cw-see-all', onclick: () => {
          const done = solvedIds();
          openBrowse({ title: t('recent'), items: made.map((p, i) => ({ date: p.made, label: `#${made.length - i} · ${deckLabel(p)}`, done: done.has(p.id), p })), onPick: (x) => play(x.p) });
        } }, t('seeAll', { n: made.length })) : null) : null,
      h('div', { class: 'cw-deck-row' },
        h('button', { type: 'button', class: 'btn-link', onclick: () => { if (confirm(t('confirmReplace'))) { const x = state(); delete x.words; delete x.name; write(x); render(); } } }, t('replace'))),
    ];
  }

  const deckLabel = (p) => `${p.deck.name} · ${t(p.size)} · ${t(p.mode === 'kanji' ? 'kanji' : 'kana')}`;

  function bonusView() {
    if (!bonus) return [];
    if (!member()) return bonus.length ? [h('h3', { class: 'cw-deck-sub' }, t('bonusTitle')), paywall(t('bonusLockedN', { n: bonus.length }), showPlus)] : [];
    if (!bonus.length) return [h('h3', { class: 'cw-deck-sub' }, t('bonusTitle')), h('p', { class: 'cw-deck-muted' }, t('bonusNone'))];
    const done = solvedIds();
    return [
      h('h3', { class: 'cw-deck-sub' }, t('bonusTitle')),
      h('ul', { class: 'cw-deck-list' }, bonus.slice().reverse().slice(0, SHOW).map((b) => h('li', {}, h('button', { type: 'button', onclick: () => openBonus(b) },
        h('span', {}, bonusLabel(b)),
        h('span', { class: 'cw-deck-muted' }, done.has(b.id) ? `${t('solved')} ✓` : ''))))),
      bonus.length > SHOW ? h('button', { type: 'button', class: 'btn-link cw-see-all', onclick: () => openBrowse({
        title: t('bonusTitle'), items: bonus.map((b) => ({ date: b.made, label: bonusLabel(b), done: done.has(b.id), b })), onPick: (x) => openBonus(x.b),
      }) }, t('seeAll', { n: bonus.length })) : null,
    ];
  }

  const bonusLabel = (b) => `#${Number(b.id.replace(/\D/g, ''))} · ${b.level}${b.theme ? ` · ${b.theme}` : ''}`;
  async function openBonus(b) {
    setStatus('');
    try {
      const r = await bonusPuzzle(b.id);
      if (!r.ok) { setStatus(t('bonusLoad'), true); return; }
      const n = Number(b.id.replace(/\D/g, ''));
      play({ ...r.puzzle, deck: { name: `Bonus #${n}`, line: `Crossword+ bonus #${n}${b.theme ? ` · ${b.theme}` : ''}` } });
    } catch { setStatus(t('bonusLoad'), true); }
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
    busy = false;
    if (!member()) useFree();
    const p = toPuzzle(draftPuzzle, { kind, size, name: s.name, seed });
    const x = state();
    x.made = [...(x.made || []), p].slice(-KEEP);
    try { write(x); } catch { x.made = x.made.slice(-3); try { write(x); } catch { /* full: still playable now */ } }
    setStatus('');
    play(p);
  }

  // Crossword+ for people who aren't members yet: what it is, plans, sign in
  function plusBlock(u) {
    return h('div', { class: 'cw-plusblock', id: 'cw-plusblock' },
      plusBadge(),
      h('p', {}, t('pitch')),
      plusPerks(),
      u ? accountLine(u) : null,
      ...plans(),
      ...(u ? [] : signInBox()),
      supportLine());
  }
  function showPlus() { const el = document.getElementById('cw-plusblock'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

  function render() {
    if (!visible) return;
    const s = state();
    const u = currentUser();
    const head = h('h2', {}, t('title'));
    let body;
    if (!loaded || !cfg) body = [h('p', { class: 'cw-deck-muted' }, '…')];
    else {
      body = u && u.member ? [accountLine(u), ...membership(u)] : [h('p', {}, t('intro'))];
      if (draft) body.push(...picker());
      else if (!s.words || !s.words.length) body.push(...importer());
      else body.push(...deckView(s, u));
      body.push(...bonusView());
      body.push(u && u.member ? supportLine() : plusBlock(u));
    }
    root.replaceChildren(head, ...body.filter(Boolean), h('p', { class: `cw-deck-status${status.error ? ' is-error' : ''}`, role: 'status', 'aria-live': 'polite' }, status.text));
  }

  return {
    show(on) {
      visible = on;
      root.hidden = !on;
      if (!on) return;
      load();
      render();
    },
    showPlus,
    message(kind, text) {
      setStatus(kind === 'paid' ? t('welcome') : kind === 'signedIn' ? t('signedInMsg') : kind === 'cancelled' ? t('cancelled') : text || t('failed'), kind === 'error');
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
