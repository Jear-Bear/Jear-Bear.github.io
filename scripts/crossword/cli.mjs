#!/usr/bin/env node
// cli.mjs — make and publish the daily crosswords.
//
//   node scripts/crossword/cli.mjs words            rebuild data/crossword/words.json from the JLPT lists + extras
//   node scripts/crossword/cli.mjs status [days]    which of the next days (default 3, from the earliest time zone) have no puzzles yet
//   node scripts/crossword/cli.mjs draft DATE       build the 8 puzzles for DATE (YYYY-MM-DD) into
//                                                   data/crossword/drafts/DATE.json (answers in clear, clues empty).
//                                                   If DATE is already published, builds only the levels it's missing
//                                                   (publish then adds them to the day).
//   node scripts/crossword/cli.mjs publish DATE     check the clues and write data/crossword/puzzles/DATE.json
//   node scripts/crossword/cli.mjs check            re-check every published puzzle
//   node scripts/crossword/cli.mjs kanji [DATE|all] add the kanji puzzles to a published day (publish does this
//                                                   too); "all" fills in every published day that has none
//   node scripts/crossword/cli.mjs seal-archive     seal (encrypt) days that are in the past everywhere (publish does this too)
//
// Drafts hold the answers in plain text, so data/crossword/drafts/ is git-ignored.
// Published files keep the answers lightly encoded (no spoilers in view-source).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gridKana, romaji, toHira } from './kana.js';
import { build, rng, themeMatcher, SIZES, SHAPES, LEVELS, WORD_LEVELS, JAPANESE_CLUES } from './construct.mjs';
import { buildFree } from './freeform.mjs';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'data/crossword');
const WORDS = path.join(DIR, 'words.json');
const EXTRAS = path.join(DIR, 'extra-words.json');
const DRAFTS = path.join(DIR, 'drafts');
const PUZZLES = path.join(DIR, 'puzzles');
const INDEX = path.join(DIR, 'index.json');
const THEMES = path.join(DIR, 'themes.json');
const SOURCE = 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0/src';
// Don't reuse an answer of 3+ kana at the same level for this many days. The
// beginner list is small (about 1,300 words, ~45 used a day), so it gets a
// shorter window. Two-kana answers may repeat (only ~150 at N1, and a 9x9
// uses about ten), like the short words every crossword leans on.
const RECENT_DAYS = { beginner: 7, intermediate: 14, advanced: 14, mixed: 7 };

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p, v, pretty = true) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `${JSON.stringify(v, null, pretty ? 2 : 0)}\n`); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Puzzles switch at each visitor's local midnight, so a day has to be live
// before it starts anywhere: in the earliest time zone, UTC+14 (Kiribati).
const todayEarliest = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
const die = (msg) => { console.error(msg); process.exit(1); };

// --- words --------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function words() {
  const out = [];
  const seen = new Set();
  for (const n of [5, 4, 3, 2, 1]) {
    const res = await fetch(`${SOURCE}/n${n}.csv`);
    if (!res.ok) die(`n${n}.csv: HTTP ${res.status}`);
    for (const r of parseCsv(await res.text())) {
      if (/[～〜()（）]/.test(r.reading) || /[～〜]/.test(r.expression)) continue;        // affixes and annotated entries
      const reading = r.reading.split(/[;；]/)[0].trim();
      if (/\s/.test(reading) || /\s/.test(r.expression.split(/[;；]/)[0].trim())) continue;   // "四角 四角い" style pairs
      const a = gridKana(reading);
      if (!a || a.length < 2 || a.length > 7) continue;
      const key = `${r.expression}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ w: r.expression.split(/[;；]/)[0].trim(), r: reading, a, m: r.meaning.replace(/\s+/g, ' ').trim().slice(0, 120), l: `n${n}` });
    }
  }
  const extras = readJson(EXTRAS, { words: [] }).words;
  for (const x of extras) {
    const a = gridKana(x.reading);
    if (!a || !WORD_LEVELS.includes(x.level)) { console.warn(`Skipping extra word ${x.word} (${x.reading})`); continue; }
    out.push({ w: x.word, r: x.reading, a, m: x.meaning, l: x.level, extra: 1, ...(x.tags && x.tags.length ? { t: x.tags } : {}) });
  }
  writeJson(WORDS, { source: 'JLPT vocabulary from jamsinclair/open-anki-jlpt-decks (MIT; based on Jonathan Waller’s tanos.co.uk lists, CC BY) plus data/crossword/extra-words.json', count: out.length, words: out }, false);
  const by = out.reduce((m, w) => ((m[w.l] = (m[w.l] || 0) + 1), m), {});
  console.log(`Wrote ${out.length} words`, by);
}

// --- recent answers (to avoid repeats) ------------------------------------------------------
function decode(s) { return JSON.parse(Buffer.from(String(s).split('').reverse().join(''), 'base64').toString('utf8')); }
function encode(v) { return Buffer.from(JSON.stringify(v), 'utf8').toString('base64').split('').reverse().join(''); }

function recentAnswers(date, level) {
  const used = new Set();
  for (let i = 1; i <= RECENT_DAYS[level]; i++) {
    const d = addDays(date, -i);
    const p = readJson(path.join(PUZZLES, `${d}.json`), null);
    const add = (e) => { if (e.answer.length >= 3) used.add(e.answer); };
    if (isSealed(p)) sealedAnswers(d, level).forEach((a) => add({ answer: a }));
    else if (p) p.puzzles.filter((z) => z.level === level && !z.mode).forEach((z) => decode(z.key).entries.forEach(add));
    const dr = readJson(path.join(DRAFTS, `${d}.json`), null);          // unpublished drafts count too
    if (dr) dr.puzzles.filter((z) => z.level === level).forEach((z) => z.entries.forEach(add));
  }
  return used;
}

// --- theme of the day ---------------------------------------------------------------------
// Every theme comes round once per cycle, in a fixed shuffled order so
// neighbouring days feel different. A day already published keeps its theme.
export function themeFor(date) {
  const { themes } = readJson(THEMES, { themes: [] });
  if (!themes.length) return null;
  const order = [...themes].sort((x, y) => x.id.localeCompare(y.id));
  const rand = rng('themes');
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  return order[((day % order.length) + order.length) % order.length];
}

// --- shape of the day ---------------------------------------------------------------------
// About one day in three, the Mini or the Daily (sometimes both) gets a fun
// shape of black squares (SHAPES in construct.mjs), the same at every level.
// Shapes start on Oct 10, 2026, so days already out keep their grids.
const SHAPES_FROM = '2026-10-10';
export function shapeFor(date, size) {
  if (date < SHAPES_FROM) return null;
  if (rng(`shape:${date}:${size}`)() >= 0.3) return null;
  const names = Object.keys(SHAPES[size]);
  return names[Math.floor(rng(`shape-name:${date}:${size}`)() * names.length)];
}

// --- draft --------------------------------------------------------------------------------
function draft(date) {
  if (!isDate(date)) die('Usage: draft YYYY-MM-DD');
  const published = readJson(path.join(PUZZLES, `${date}.json`), null);
  const have = new Set(published ? published.puzzles.filter((p) => !p.mode).map((p) => p.level) : []);
  const levels = LEVELS.filter((l) => !have.has(l));
  if (!levels.length) die(`${date} is already published with every level`);
  const out = path.join(DRAFTS, `${date}.json`);
  if (fs.existsSync(out)) { console.log(`Draft already exists: ${path.relative(ROOT, out)}`); return; }
  const { words: list } = readJson(WORDS, { words: [] });
  if (!list.length) die('Run "words" first');
  // Today's answers (any level) and blocked words are always out; recent
  // days' answers are out for the same level
  const today = new Set();
  if (published) published.puzzles.forEach((z) => decode(z.key).entries.forEach((e) => today.add(e.answer)));
  const blocked = new Set(readJson(path.join(DIR, 'blocklist.json'), { words: [] }).words);
  list.forEach((w) => { if (blocked.has(w.w) || blocked.has(w.a)) today.add(w.a); });
  const { themes } = readJson(THEMES, { themes: [] });
  const theme = (published && published.theme && themes.find((t) => t.id === published.theme.id)) || themeFor(date);
  if (theme) console.log(`Theme: ${theme.en} (${theme.ja})`);
  const puzzles = [];
  for (const level of levels) {
    const recent = recentAnswers(date, level);
    for (const size of Object.keys(SIZES)) {
      const t = Date.now();
      const exclude = new Set([...today, ...recent]);
      const shape = shapeFor(date, size);
      const p = build({ size, level, words: list, seed: `${date}:${level}:${size}`, exclude, theme, shape });
      p.entries.forEach((e) => today.add(e.answer));
      today.add(p.keyword.answer);                                     // no repeated keyword either
      puzzles.push(p);
      console.log(`${level} ${size}: ${p.entries.length} entries, ${p.entries.filter((e) => e.theme).length} on theme, keyword ${p.keyword.answer}${p.keyword.theme ? ' (theme)' : ''}${p.shape ? `, shape ${p.shape}` : shape ? `, shape ${shape} didn't fill (plain grid)` : ''} (${Date.now() - t} ms)`);
    }
  }
  writeJson(out, { date, theme: theme ? { id: theme.id, en: theme.en, ja: theme.ja } : null, note: 'Fill in every "clue" (entries and keyword), then run: node scripts/crossword/cli.mjs publish ' + date + '. Clues may nod to the theme; don’t force it.', puzzles });
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

// --- clue checks ---------------------------------------------------------------------------
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
export function clueProblems(p) {
  const problems = [];
  const ja = JAPANESE_CLUES.has(p.level);
  const check = (label, clue, x) => {
    const c = String(clue || '').trim();
    if (!c) { problems.push(`${label}: missing clue`); return; }
    if (ja) {
      // Japanese clues (mixed level): mostly Japanese, and never the answer itself
      if (c.length > 60) problems.push(`${label}: clue over 60 characters`);
      if (!JAPANESE.test(c)) problems.push(`${label}: clue must be in Japanese`);
      // The answer's kana in a run of kana (a 2-kana answer only as a whole run), or its written form
      const runs = (c.match(/[぀-ヿ]+/g) || []).map((r) => gridKana(r) || toHira(r));
      const kana = runs.some((r) => (x.answer.length > 2 ? r.includes(x.answer) : r === x.answer));
      const written = x.word && !/^[぀-ヿ]+$/.test(x.word) && c.includes(x.word);
      if (kana || written) problems.push(`${label}: clue gives away the answer (${x.word || x.answer})`);
      return;
    }
    if (c.length > 140) problems.push(`${label}: clue over 140 characters`);
    if (JAPANESE.test(c)) problems.push(`${label}: clue must be English only (no kana or kanji)`);
    const r = romaji(x.answer);
    if (r.length >= 3 && new RegExp(`\\b${r}\\b`, 'i').test(c.replace(/[āīūēō]/g, (y) => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' }[y])))) problems.push(`${label}: clue gives away the answer ("${r}")`);
  };
  p.entries.forEach((e) => check(`${p.level} ${p.size} ${e.num} ${e.dir} (${e.answer})`, e.clue, e));
  check(`${p.level} ${p.size} keyword (${p.keyword.answer})`, p.keyword.clue, p.keyword);
  return problems;
}

// --- publish -------------------------------------------------------------------------------
// A draft puzzle as the player loads it (answers lightly encoded)
function toPublished(p, id) {
  return {
    id, ...(p.mode ? { mode: p.mode } : {}), size: p.size, level: p.level, width: p.width, height: p.height, ...(p.shape ? { shape: p.shape } : {}), ...(p.free ? { free: true } : {}),
    grid: p.rows.map((r) => r.replace(/[^#]/g, '.')),
    clues: p.entries.map((e) => ({ num: e.num, dir: e.dir, row: e.row, col: e.col, len: e.len, clue: e.clue.trim() })),
    keyword: p.keyword ? { cells: p.keyword.cells, clue: p.keyword.clue.trim() } : null,
    key: encode({
      rows: p.rows,
      entries: p.entries.map((e) => ({ num: e.num, dir: e.dir, answer: e.answer, word: e.word, reading: e.reading, meaning: e.meaning })),
      keyword: p.keyword ? { answer: p.keyword.answer, word: p.keyword.word, reading: p.keyword.reading, meaning: p.keyword.meaning } : null,
    }),
  };
}

async function publish(date) {
  if (!isDate(date)) die('Usage: publish YYYY-MM-DD');
  const src = path.join(DRAFTS, `${date}.json`);
  const d = readJson(src, null);
  if (!d) die(`No draft at ${path.relative(ROOT, src)}`);
  const problems = d.puzzles.flatMap(clueProblems);
  if (problems.length) die(`Fix these first:\n- ${problems.join('\n- ')}`);
  const puzzles = d.puzzles.map((p) => toPublished(p, `${date}-${p.level}-${p.size}`));
  // Adding levels to a day that's already out: keep its puzzles, in level order
  const old = readJson(path.join(PUZZLES, `${date}.json`), null);
  if (old) {
    const ids = new Set(puzzles.map((p) => p.id));
    puzzles.push(...old.puzzles.filter((p) => !ids.has(p.id)));
    puzzles.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || Object.keys(SIZES).indexOf(a.size) - Object.keys(SIZES).indexOf(b.size));
  }
  const theme = d.theme || (old && old.theme) || null;
  writeJson(path.join(PUZZLES, `${date}.json`), { date, ...(theme ? { theme } : {}), puzzles }, false);
  const index = readJson(INDEX, { dates: [] });
  index.dates = [...new Set([...index.dates, date])].sort();
  writeJson(INDEX, index);
  fs.rmSync(src);
  console.log(`Published ${date} (${puzzles.length} puzzles)`);
  addKanji(date);
  await sealArchive();
}

// --- the archive (Crossword+) ----------------------------------------------------------------
// Today's puzzles are free; past ones are for Crossword+ members. A day is
// sealed (encrypted for the sponsor Worker, like the bonus puzzles) once it's
// in the past in every time zone, so its file can't be read from the repo.
// The Worker opens it for members (POST /public/plus/day). To keep avoiding
// repeats, the answers of sealed days are kept as salted hashes in
// sealed-answers.json (no clues, no grids).
const SEALED_ANSWERS = path.join(DIR, 'sealed-answers.json');
const isSealed = (f) => Boolean(f && f.ct && f.ek);
const answerHash = (a) => createHash('sha256').update(`jareddesu-crossword:${a}`).digest('hex').slice(0, 20);
let answerLookup = null;
function sealedAnswers(date, group) {
  const rec = readJson(SEALED_ANSWERS, { days: {} }).days[date];
  if (!rec || !rec[group]) return [];
  if (!answerLookup) {
    answerLookup = new Map();
    readJson(WORDS, { words: [] }).words.forEach((w) => { answerLookup.set(answerHash(w.a), w.a); answerLookup.set(answerHash(w.w), w.w); });
  }
  return rec[group].map((h) => answerLookup.get(h)).filter(Boolean);
}

async function sealArchive() {
  const cutoff = addDays(todayEarliest(), -2);             // the oldest "today" anywhere (UTC-12)
  const rec = readJson(SEALED_ANSWERS, { about: 'Answers of sealed (Crossword+) days, hashed, so new puzzles can avoid repeats. No clues or grids.', days: {} });
  let n = 0;
  for (const date of readJson(INDEX, { dates: [] }).dates) {
    if (date >= cutoff) continue;
    const file = path.join(PUZZLES, `${date}.json`);
    const f = readJson(file, null);
    if (!f || isSealed(f)) continue;
    const groups = {};
    f.puzzles.forEach((z) => {
      const g = `${z.mode === 'kanji' ? 'kanji:' : ''}${z.level}`;
      groups[g] = [...new Set([...(groups[g] || []), ...decode(z.key).entries.map((e) => answerHash(e.answer))])];
    });
    rec.days[date] = groups;
    writeJson(file, { date, sealed: true, ...(await seal(f)) }, false);
    n++;
  }
  if (n) { writeJson(SEALED_ANSWERS, rec, false); console.log(`Sealed ${n} past day${n === 1 ? '' : 's'} for Crossword+`); }
}

// --- kanji puzzles --------------------------------------------------------------------------
// The 漢字 mode: answers written in kanji, one per square. Nearly every kanji
// word is two characters, so these are freeform grids (freeform.mjs), and the
// clues come straight from the word list: the meaning and the reading (just
// the reading for Mixed, like a 漢字の書き取り test). No clue-writing step, so
// publish adds them to the day by itself.
const KANJI_POOLS = { beginner: ['n5', 'n4'], intermediate: ['n3', 'n2'], advanced: ['n1'], mixed: ['n5', 'n4', 'n3', 'n2', 'n1'] };
const KANJI_WORD = /^[\u4e00-\u9fff々]{2,4}$/;
// Meanings that don't belong in a fun puzzle (on top of blocklist.json)
const KANJI_SKIP = /\b(urine|urinat|feces|excrement|faeces|toilet|sexual|sex|death|dead|die|dying|kill|murder|suicide|corpse|funeral|war|cancer|disease|blood|bomb|weapon|rape|prostitut|slave)\b/i;
const KANJI_RECENT_DAYS = 7;

function kanjiWords() {
  const blocked = new Set(readJson(path.join(DIR, 'blocklist.json'), { words: [] }).words);
  return readJson(WORDS, { words: [] }).words
    .filter((w) => !w.extra && KANJI_WORD.test(w.w) && !blocked.has(w.w) && w.m && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(w.m) && !KANJI_SKIP.test(w.m))
    // The list gives する verbs with する on the reading (運転: うんてんする); the answer is just the kanji
    .map((w) => ({ a: w.w, w: w.w, r: w.r.replace(/する$/, ''), m: w.m, l: w.l }));
}

// "electric train; tram" -> "electric train" (the first sense or two, kept short)
const shortMeaning = (m) => {
  const parts = String(m).replace(/\s*\([^)]*\)\s*/g, ' ').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  let out = parts[0] || String(m);
  if (parts[1] && (out + ', ' + parts[1]).length <= 40) out += `, ${parts[1]}`;
  return out.slice(0, 60);
};
const kanjiClue = (level, e) => (level === 'mixed' ? e.reading : `${shortMeaning(e.meaning)} · ${e.reading}`);

function kanjiRecent(date, level) {
  const used = new Set();
  for (let i = 1; i <= KANJI_RECENT_DAYS; i++) {
    const d = addDays(date, -i);
    const p = readJson(path.join(PUZZLES, `${d}.json`), null);
    if (isSealed(p)) sealedAnswers(d, `kanji:${level}`).forEach((a) => used.add(a));
    else if (p) p.puzzles.filter((z) => z.mode === 'kanji' && z.level === level).forEach((z) => decode(z.key).entries.forEach((e) => used.add(e.answer)));
  }
  return used;
}

export function kanjiPuzzles(date, theme) {
  const all = kanjiWords();
  const fits = themeMatcher(theme);
  const out = [];
  for (const level of LEVELS) {
    const words = all.filter((w) => KANJI_POOLS[level].includes(w.l)).map((w) => ({ ...w, pref: fits(w) ? 1 : 0 }));
    const exclude = kanjiRecent(date, level);
    const today = new Set();
    for (const size of Object.keys(SIZES)) {
      let p = null;
      // Fresh answers if the list allows (Beginner's is small: about 400 words), else just none from today
      const make = (k) => {
        try { return buildFree({ size, level, kind: 'kanji', words, seed: `kanji:${date}:${level}:${size}:${k}`, exclude: new Set([...exclude, ...today]) }); } catch {
          return buildFree({ size, level, kind: 'kanji', words, seed: `kanji:${date}:${level}:${size}:${k}`, exclude: today });
        }
      };
      for (let k = 0; k < 6 && !(p && p.keyword); k++) { const q = make(k); if (!p || q.keyword) p = q; }
      // Small grids sometimes have no word hidden in them; then there's no keyword
      p.entries.forEach((e) => { today.add(e.answer); e.clue = kanjiClue(level, e); });
      if (p.keyword) p.keyword.clue = kanjiClue(level, p.keyword);
      out.push(toPublished({ ...p, mode: 'kanji' }, `${date}-kanji-${level}-${size}`));
    }
  }
  return out;
}

function addKanji(date, { quiet = false } = {}) {
  const file = path.join(PUZZLES, `${date}.json`);
  const f = readJson(file, null);
  if (!f) die(`${date} isn't published`);
  if (isSealed(f)) return false;
  if (f.puzzles.some((p) => p.mode === 'kanji')) { if (!quiet) console.log(`${date} already has kanji puzzles`); return false; }
  f.puzzles.push(...kanjiPuzzles(date, f.theme ? readJson(THEMES, { themes: [] }).themes.find((t) => t.id === f.theme.id) : null));
  writeJson(file, f, false);
  console.log(`Added kanji puzzles to ${date}`);
  return true;
}

function kanji(arg) {
  if (arg === 'all') { readJson(INDEX, { dates: [] }).dates.forEach((d) => addKanji(d, { quiet: true })); return; }
  if (!isDate(arg)) die('Usage: kanji YYYY-MM-DD | all');
  addKanji(arg);
}

// --- check / status ---------------------------------------------------------------------------
function checkAll() {
  const index = readJson(INDEX, { dates: [] });
  let bad = 0;
  for (const date of index.dates) {
    const f = readJson(path.join(PUZZLES, `${date}.json`), null);
    if (!f) { console.error(`${date}: listed in index.json but missing`); bad++; continue; }
    if (isSealed(f)) { if (!f.kid) { console.error(`${date}: sealed without a key ID`); bad++; } continue; }   // the Worker checks these when it opens them
    for (const p of f.puzzles) {
      const k = decode(p.key);
      const ok = k.rows.length === p.height && k.rows.every((r, i) => [...r].length === p.width && [...r].every((ch, j) => (ch === '#') === (p.grid[i][j] === '#')));
      const answersFit = k.entries.every((e) => {
        const c = p.clues.find((x) => x.num === e.num && x.dir === e.dir);
        return c && [...e.answer].every((ch, i) => k.rows[c.dir === 'across' ? c.row : c.row + i][c.dir === 'across' ? c.col + i : c.col] === ch);
      });
      const kw = !p.keyword || p.keyword.cells.map(([r, c]) => [...k.rows[r]][c]).join('') === k.keyword.answer;
      if (!ok || !answersFit || !kw) { console.error(`${p.id}: ${!ok ? 'grid mismatch ' : ''}${!answersFit ? 'answers don’t fit ' : ''}${!kw ? 'keyword mismatch' : ''}`); bad++; }
    }
  }
  if (bad) process.exit(1);
  console.log(`All ${index.dates.length} days check out`);
}

// status N: which of the next N days (counted from the earliest time zone's today) aren't fully published
function status(days = 3) {
  const today = todayEarliest();
  const missing = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const f = readJson(path.join(PUZZLES, `${d}.json`), null);
    // Not published, or published without every level (draft then builds just those)
    if (!f || LEVELS.some((l) => !f.puzzles.some((p) => p.level === l && !p.mode))) missing.push(d);
  }
  console.log(JSON.stringify({ today, missing, drafts: fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS) : [] }));
}

// --- Crossword+ bonus puzzles --------------------------------------------------------------
// Extra 9x9 puzzles for Crossword+ subscribers, made a couple a week ahead of
// launch. They're committed to the public repo *sealed*: encrypted with the
// sponsor Worker's public key (data/crossword/bonus/key.json), so only the
// Worker can open them. index.json lists what's there (no answers or clues).
const BONUS = path.join(DIR, 'bonus');
const BONUS_INDEX = path.join(BONUS, 'index.json');
const KEY_FILE = path.join(BONUS, 'key.json');
const WORKER = process.env.CROSSWORD_WORKER || 'https://sponsor-crm.jared-65b.workers.dev';   // override for local testing
const BONUS_LEVELS = ['intermediate', 'beginner', 'advanced', 'mixed'];

async function bonusKey() {
  const res = await fetch(`${WORKER}/public/crossword-key`, { headers: { Origin: 'https://www.jareddesu.com' } });
  if (!res.ok) die(`Couldn’t get the key: HTTP ${res.status}`);
  const k = await res.json();
  writeJson(KEY_FILE, { about: 'Public half of the Crossword+ sealing key. The private half lives only in the sponsor Worker (D1). Fetched with: node scripts/crossword/cli.mjs bonus-key', ...k });
  console.log(`Saved key ${k.kid} to ${path.relative(ROOT, KEY_FILE)}`);
}

async function seal(obj) {
  const k = readJson(KEY_FILE, null);
  if (!k) die('No sealing key yet. Run: node scripts/crossword/cli.mjs bonus-key');
  const { subtle } = globalThis.crypto;
  const pub = await subtle.importKey('jwk', { ...k.jwk, ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aesKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(obj)));
  const ek = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', aesKey));
  const b64 = (buf) => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString('base64');
  return { v: 1, kid: k.kid, alg: k.alg, ek: b64(ek), iv: b64(iv), ct: b64(ct) };
}

function bonusDraft(count = 1) {
  const index = readJson(BONUS_INDEX, { bonus: [] });
  const { words: list } = readJson(WORDS, { words: [] });
  const { themes } = readJson(THEMES, { themes: [] });
  const blocked = new Set(readJson(path.join(DIR, 'blocklist.json'), { words: [] }).words);
  const pending = fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS).filter((f) => f.startsWith('bonus-')) : [];
  let n = index.bonus.length + pending.length;
  for (let i = 0; i < count; i++, n++) {
    const id = `bonus-${String(n + 1).padStart(3, '0')}`;
    const out = path.join(DRAFTS, `${id}.json`);
    if (fs.existsSync(out)) { console.log(`Draft already exists: ${path.relative(ROOT, out)}`); continue; }
    const level = BONUS_LEVELS[n % BONUS_LEVELS.length];
    const rand = rng(`bonus:${id}`);
    const theme = themes.length ? themes[Math.floor(rand() * themes.length)] : null;
    const names = Object.keys(SHAPES.daily);
    const shape = rand() < 0.4 ? names[Math.floor(rand() * names.length)] : null;
    // Fresh answers: nothing from the last two weeks of dailies at this level
    const exclude = recentAnswers(todayEarliest(), level);
    list.forEach((w) => { if (blocked.has(w.w) || blocked.has(w.a)) exclude.add(w.a); });
    const t = Date.now();
    const p = build({ size: 'daily', level, words: list, seed: `bonus:${id}`, exclude, theme, shape });
    writeJson(out, { id, theme: theme ? { id: theme.id, en: theme.en, ja: theme.ja } : null,
      note: `Bonus puzzle. Fill in every "clue" (entries and keyword), then run: node scripts/crossword/cli.mjs bonus-publish ${id}`, puzzles: [p] });
    console.log(`${id}: ${level} 9x9${p.shape ? `, shape ${p.shape}` : ''}${theme ? `, theme ${theme.en}` : ''}, ${p.entries.length} entries (${Date.now() - t} ms) → ${path.relative(ROOT, out)}`);
  }
}

async function bonusPublish(id) {
  if (!/^bonus-\d{3,}$/.test(id || '')) die('Usage: bonus-publish bonus-001');
  const src = path.join(DRAFTS, `${id}.json`);
  const d = readJson(src, null);
  if (!d) die(`No draft at ${path.relative(ROOT, src)}`);
  const problems = d.puzzles.flatMap(clueProblems);
  if (problems.length) die(`Fix these first:\n- ${problems.join('\n- ')}`);
  const p = d.puzzles[0];
  const puzzle = { ...toPublished(p, id), ...(d.theme ? { theme: d.theme } : {}) };
  writeJson(path.join(BONUS, `${id}.json`), await seal(puzzle), false);
  const index = readJson(BONUS_INDEX, { bonus: [] });
  index.about = 'Crossword+ bonus puzzles. Each file is sealed (encrypted) for the sponsor Worker; this list has no clues or answers.';
  index.bonus = [...index.bonus.filter((b) => b.id !== id), { id, level: p.level, size: p.size, ...(p.shape ? { shape: p.shape } : {}), ...(d.theme ? { theme: d.theme.en } : {}), made: new Date().toISOString().slice(0, 10) }]
    .sort((a, b) => a.id.localeCompare(b.id));
  writeJson(BONUS_INDEX, index);
  fs.rmSync(src);
  console.log(`Sealed ${id} (${p.level}). Backlog: ${index.bonus.length} bonus puzzles`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'words') await words();
else if (cmd === 'draft') draft(arg);
else if (cmd === 'publish') await publish(arg);
else if (cmd === 'seal-archive') await sealArchive();
else if (cmd === 'check') checkAll();
else if (cmd === 'kanji') kanji(arg);
else if (cmd === 'status') status(Number(arg) || 3);
else if (cmd === 'bonus-key') await bonusKey();
else if (cmd === 'bonus-draft') bonusDraft(Number(arg) || 1);
else if (cmd === 'bonus-publish') await bonusPublish(arg);
else die('Commands: words | status [days] | draft DATE | publish DATE | check | kanji DATE|all | seal-archive | bonus-key | bonus-draft [n] | bonus-publish ID');
