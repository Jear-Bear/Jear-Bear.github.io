#!/usr/bin/env node
// cli.mjs — make and publish the daily crosswords.
//
//   node scripts/crossword/cli.mjs words            rebuild data/crossword/words.json from the JLPT lists + extras
//   node scripts/crossword/cli.mjs status [days]    which of the next days (default 7) have no puzzles yet
//   node scripts/crossword/cli.mjs draft DATE       build the 6 puzzles for DATE (YYYY-MM-DD) into
//                                                   data/crossword/drafts/DATE.json (answers in clear, clues empty)
//   node scripts/crossword/cli.mjs publish DATE     check the clues and write data/crossword/puzzles/DATE.json
//   node scripts/crossword/cli.mjs check            re-check every published puzzle
//
// Drafts hold the answers in plain text, so data/crossword/drafts/ is git-ignored.
// Published files keep the answers lightly encoded (no spoilers in view-source).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gridKana, romaji } from './kana.js';
import { build, SIZES, LEVELS } from './construct.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'data/crossword');
const WORDS = path.join(DIR, 'words.json');
const EXTRAS = path.join(DIR, 'extra-words.json');
const DRAFTS = path.join(DIR, 'drafts');
const PUZZLES = path.join(DIR, 'puzzles');
const INDEX = path.join(DIR, 'index.json');
const SOURCE = 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0/src';
const RECENT_DAYS = 21;               // don't reuse an answer used in the last three weeks

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p, v, pretty = true) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `${JSON.stringify(v, null, pretty ? 2 : 0)}\n`); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const todayCentral = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
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
    if (!a || !LEVELS.includes(x.level)) { console.warn(`Skipping extra word ${x.word} (${x.reading})`); continue; }
    out.push({ w: x.word, r: x.reading, a, m: x.meaning, l: x.level, extra: 1 });
  }
  writeJson(WORDS, { source: 'JLPT vocabulary from jamsinclair/open-anki-jlpt-decks (MIT; based on Jonathan Waller’s tanos.co.uk lists, CC BY) plus data/crossword/extra-words.json', count: out.length, words: out }, false);
  const by = out.reduce((m, w) => ((m[w.l] = (m[w.l] || 0) + 1), m), {});
  console.log(`Wrote ${out.length} words`, by);
}

// --- recent answers (to avoid repeats) ------------------------------------------------------
function decode(s) { return JSON.parse(Buffer.from(String(s).split('').reverse().join(''), 'base64').toString('utf8')); }
function encode(v) { return Buffer.from(JSON.stringify(v), 'utf8').toString('base64').split('').reverse().join(''); }

function recentAnswers(date) {
  const used = new Set();
  for (let i = 1; i <= RECENT_DAYS; i++) {
    const d = addDays(date, -i);
    const p = readJson(path.join(PUZZLES, `${d}.json`), null);
    if (p) p.puzzles.forEach((z) => decode(z.key).entries.forEach((e) => used.add(e.answer)));
    const dr = readJson(path.join(DRAFTS, `${d}.json`), null);          // unpublished drafts count too
    if (dr) dr.puzzles.forEach((z) => z.entries.forEach((e) => used.add(e.answer)));
  }
  return used;
}

// --- draft --------------------------------------------------------------------------------
function draft(date) {
  if (!isDate(date)) die('Usage: draft YYYY-MM-DD');
  if (fs.existsSync(path.join(PUZZLES, `${date}.json`))) die(`${date} is already published`);
  const out = path.join(DRAFTS, `${date}.json`);
  if (fs.existsSync(out)) { console.log(`Draft already exists: ${path.relative(ROOT, out)}`); return; }
  const { words: list } = readJson(WORDS, { words: [] });
  if (!list.length) die('Run "words" first');
  const exclude = recentAnswers(date);
  const blocked = new Set(readJson(path.join(DIR, 'blocklist.json'), { words: [] }).words);
  list.forEach((w) => { if (blocked.has(w.w) || blocked.has(w.a)) exclude.add(w.a); });
  const puzzles = [];
  for (const level of LEVELS) {
    for (const size of Object.keys(SIZES)) {
      const t = Date.now();
      const p = build({ size, level, words: list, seed: `${date}:${level}:${size}`, exclude });
      p.entries.forEach((e) => exclude.add(e.answer));
      puzzles.push(p);
      console.log(`${level} ${size}: ${p.entries.length} entries, keyword ${p.keyword.answer} (${Date.now() - t} ms)`);
    }
  }
  writeJson(out, { date, note: 'Fill in every "clue" (entries and keyword), then run: node scripts/crossword/cli.mjs publish ' + date, puzzles });
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

// --- clue checks ---------------------------------------------------------------------------
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
export function clueProblems(p) {
  const problems = [];
  const check = (label, clue, answer) => {
    const c = String(clue || '').trim();
    if (!c) { problems.push(`${label}: missing clue`); return; }
    if (c.length > 140) problems.push(`${label}: clue over 140 characters`);
    if (JAPANESE.test(c)) problems.push(`${label}: clue must be English only (no kana or kanji)`);
    const r = romaji(answer);
    if (r.length >= 3 && new RegExp(`\\b${r}\\b`, 'i').test(c.replace(/[āīūēō]/g, (x) => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' }[x])))) problems.push(`${label}: clue gives away the answer ("${r}")`);
  };
  p.entries.forEach((e) => check(`${p.level} ${p.size} ${e.num} ${e.dir} (${e.answer})`, e.clue, e.answer));
  check(`${p.level} ${p.size} keyword (${p.keyword.answer})`, p.keyword.clue, p.keyword.answer);
  return problems;
}

// --- publish -------------------------------------------------------------------------------
function publish(date) {
  if (!isDate(date)) die('Usage: publish YYYY-MM-DD');
  const src = path.join(DRAFTS, `${date}.json`);
  const d = readJson(src, null);
  if (!d) die(`No draft at ${path.relative(ROOT, src)}`);
  const problems = d.puzzles.flatMap(clueProblems);
  if (problems.length) die(`Fix these first:\n- ${problems.join('\n- ')}`);
  const puzzles = d.puzzles.map((p) => ({
    id: `${date}-${p.level}-${p.size}`, size: p.size, level: p.level, width: p.width, height: p.height,
    grid: p.rows.map((r) => r.replace(/[^#]/g, '.')),
    clues: p.entries.map((e) => ({ num: e.num, dir: e.dir, row: e.row, col: e.col, len: e.len, clue: e.clue.trim() })),
    keyword: { cells: p.keyword.cells, clue: p.keyword.clue.trim() },
    key: encode({
      rows: p.rows,
      entries: p.entries.map((e) => ({ num: e.num, dir: e.dir, answer: e.answer, word: e.word, reading: e.reading, meaning: e.meaning })),
      keyword: { answer: p.keyword.answer, word: p.keyword.word, reading: p.keyword.reading, meaning: p.keyword.meaning },
    }),
  }));
  writeJson(path.join(PUZZLES, `${date}.json`), { date, puzzles }, false);
  const index = readJson(INDEX, { dates: [] });
  index.dates = [...new Set([...index.dates, date])].sort();
  writeJson(INDEX, index);
  fs.rmSync(src);
  console.log(`Published ${date} (${puzzles.length} puzzles)`);
}

// --- check / status ---------------------------------------------------------------------------
function checkAll() {
  const index = readJson(INDEX, { dates: [] });
  let bad = 0;
  for (const date of index.dates) {
    const f = readJson(path.join(PUZZLES, `${date}.json`), null);
    if (!f) { console.error(`${date}: listed in index.json but missing`); bad++; continue; }
    for (const p of f.puzzles) {
      const k = decode(p.key);
      const ok = k.rows.length === p.height && k.rows.every((r, i) => [...r].length === p.width && [...r].every((ch, j) => (ch === '#') === (p.grid[i][j] === '#')));
      const answersFit = k.entries.every((e) => {
        const c = p.clues.find((x) => x.num === e.num && x.dir === e.dir);
        return c && [...e.answer].every((ch, i) => k.rows[c.dir === 'across' ? c.row : c.row + i][c.dir === 'across' ? c.col + i : c.col] === ch);
      });
      const kw = p.keyword.cells.map(([r, c]) => k.rows[r][c]).join('') === k.keyword.answer;
      if (!ok || !answersFit || !kw) { console.error(`${p.id}: ${!ok ? 'grid mismatch ' : ''}${!answersFit ? 'answers don’t fit ' : ''}${!kw ? 'keyword mismatch' : ''}`); bad++; }
    }
  }
  if (bad) process.exit(1);
  console.log(`All ${index.dates.length} days check out`);
}

function status(days = 7) {
  const today = todayCentral();
  const missing = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    if (!fs.existsSync(path.join(PUZZLES, `${d}.json`))) missing.push(d);
  }
  console.log(JSON.stringify({ today, missing, drafts: fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS) : [] }));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'words') await words();
else if (cmd === 'draft') draft(arg);
else if (cmd === 'publish') publish(arg);
else if (cmd === 'check') checkAll();
else if (cmd === 'status') status(Number(arg) || 7);
else die('Commands: words | status [days] | draft DATE | publish DATE | check');
