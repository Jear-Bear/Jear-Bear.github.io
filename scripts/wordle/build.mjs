#!/usr/bin/env node
// build.mjs — word lists for Kana Wordle (Node only).
//
//   node scripts/wordle/build.mjs path/to/JMdict_e.gz
//
// Answers: JLPT words and the fun extras from data/crossword/words.json, by
// level (minus data/crossword/blocklist.json). Accepted guesses: those plus
// every common word in JMdict (EDRDG, CC BY-SA 4.0) of the right length.
// All in grid kana (hiragana, small kana full size, ー allowed).
// Writes data/wordle/words-4.json and words-5.json. Answers are lightly
// encoded so they don't show in view-source.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { gridKana } from '../crossword/kana.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LENGTHS = [4, 5];
const LEVELS = { beginner: ['n5', 'n4', 'beginner'], intermediate: ['n3', 'n2', 'intermediate'], advanced: ['n1', 'advanced'] };
const COMMON = /^(news1|news2|ichi1|ichi2|spec1|spec2|gai1|gai2|nf\d\d)$/;

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/wordle/build.mjs JMdict_e.gz'); process.exit(1); }

// --- JMdict common readings ------------------------------------------------------------------
const xml = zlib.gunzipSync(fs.readFileSync(src)).toString('utf8');
const valid = new Map(LENGTHS.map((L) => [L, new Set()]));
let entries = 0;
for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  entries++;
  const e = m[1];
  const kanjiCommon = [...e.matchAll(/<ke_pri>([^<]+)<\/ke_pri>/g)].some((x) => COMMON.test(x[1]));
  for (const r of e.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)) {
    const reb = (r[1].match(/<reb>([^<]+)<\/reb>/) || [])[1];
    const pri = [...r[1].matchAll(/<re_pri>([^<]+)<\/re_pri>/g)].map((x) => x[1]);
    if (!reb || (!pri.some((p) => COMMON.test(p)) && !kanjiCommon)) continue;
    const a = gridKana(reb);
    if (a && valid.has(a.length)) valid.get(a.length).add(a);
  }
}

// --- Answers by level --------------------------------------------------------------------------
const { words } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/words.json'), 'utf8'));
const blocked = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/blocklist.json'), 'utf8')).words);
const encode = (v) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64').split('').reverse().join('');

for (const L of LENGTHS) {
  const answers = {};
  const seen = new Set();
  for (const [level, tags] of Object.entries(LEVELS)) {
    answers[level] = [];
    for (const w of words) {
      if (!tags.includes(w.l) || w.a.length !== L || blocked.has(w.w) || blocked.has(w.a)) continue;
      if (/を|ゔ/.test(w.a) || /^--/.test(w.m)) continue;
      const key = `${level}:${w.a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      answers[level].push({ a: w.a, w: w.w, r: w.r, m: w.m });
      valid.get(L).add(w.a);
    }
  }
  // Every answer from the word list also counts as a guess, at any level
  words.forEach((w) => { if (w.a.length === L) valid.get(L).add(w.a); });
  const out = {
    length: L,
    note: 'Accepted guesses: common words from JMdict (EDRDG, CC BY-SA 4.0) and JLPT vocabulary (open-anki-jlpt-decks, MIT). Answers are encoded.',
    valid: [...valid.get(L)].sort(),
    answers: encode(answers),
  };
  fs.mkdirSync(path.join(ROOT, 'data/wordle'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `data/wordle/words-${L}.json`), `${JSON.stringify(out)}\n`);
  console.log(`${L} kana: ${out.valid.length} guesses; answers ${Object.entries(answers).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
}
console.log(`(${entries} JMdict entries read)`);
