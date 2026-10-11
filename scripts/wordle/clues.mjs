#!/usr/bin/env node
// clues.mjs — hand-written themes and clues for Kana Wordle answers (Node only).
//
//   node scripts/wordle/clues.mjs todo [days] [from]   upcoming daily answers without one (JSON)
//   node scripts/wordle/clues.mjs apply                 check data/wordle/clues.json, merge it in
//
// Each answer can have, in data/wordle/clues.json (keyed by the answer in grid kana):
//   { "t": "Continents", "tj": "大陸", "c": "Home of the Sahara and the Nile" }
//   t / tj  the theme in English / Japanese: what the word is about, as close to the word
//           as it can be without naming it ("Continents" for アフリカ, not "A thing or an idea")
//   c       the first hint, in English: a clue, not the dictionary meaning. It never contains
//           the answer, its kanji, or (for loanwords) the English word it comes from.
// The dictionary meaning still shows once the game is over.
//
// apply re-encodes data/wordle/words-*.json without changing the order of the answers
// (the daily word is picked by position), so no JMdict download is needed. Answers
// without an entry keep the automatic theme (build.mjs) and the meaning as the hint.
// clues.json itself is kept out of the site (_config.yml), since it lists the answers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLUES = path.join(ROOT, 'data/wordle/clues.json');
const START = '2026-10-01';                         // same as app.js
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const file = (L) => path.join(ROOT, `data/wordle/words-${L}.json`);

const decode = (s) => JSON.parse(Buffer.from(s.split('').reverse().join(''), 'base64').toString('utf8'));
const encode = (v) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64').split('').reverse().join('');
const readClues = () => (fs.existsSync(CLUES) ? JSON.parse(fs.readFileSync(CLUES, 'utf8')) : {});

// The daily pick, exactly as app.js does it
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
const dayNumber = (date) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${START}T12:00:00Z`)) / 86400000) + 1;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// What a clue must not give away
const KATAKANA = /^[゠-ヿ]+$/;
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
function problems(w, x) {
  const out = [];
  if (!x || typeof x !== 'object') return ['not an object'];
  if (!x.t || !x.tj || !x.c) out.push('needs t, tj and c');
  const c = String(x.c || '');
  const t = `${x.t || ''} ${x.tj || ''}`;
  if (c.length > 120) out.push('clue over 120 characters');
  [w.a, toHira(w.w), w.w, w.r].filter((s) => s && s.length >= 2).forEach((s) => {
    if (c.includes(s) || toHira(c).includes(toHira(s))) out.push(`clue contains ${s}`);
    if (t.includes(s)) out.push(`theme contains ${s}`);
  });
  [...w.w].filter((ch) => /\p{Script=Han}/u.test(ch)).forEach((ch) => { if (c.includes(ch) || t.includes(ch)) out.push(`contains the kanji ${ch}`); });
  if (/[぀-ヿ\p{Script=Han}]/u.test(c)) out.push('clue has kana or kanji (it should be English)');
  // A loanword's meaning is the English word it comes from: keep it out of the clue and theme
  if (KATAKANA.test(w.w)) {
    const gloss = w.m.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    gloss.forEach((g) => {
      const main = g.split(/\s+/).filter((s) => s.length >= 4 && !/^(with|from|that|this|than|into|over|some)$/.test(s));
      main.forEach((m) => { if (new RegExp(`\\b${m.replace(/[^a-z']/g, '')}`, 'i').test(`${c} ${x.t}`)) out.push(`gives away the loanword (${m})`); });
    });
  }
  return [...new Set(out)];
}

const cmd = process.argv[2];
if (cmd === 'todo') {
  const days = Number(process.argv[3] || 90);
  const from = process.argv[4] || new Date().toISOString().slice(0, 10);
  const clues = readClues();
  const want = new Map();
  for (const L of [4, 5]) {
    const answers = decode(JSON.parse(fs.readFileSync(file(L), 'utf8')).answers);
    for (const level of LEVELS) {
      const pool = answers[level];
      const order = shuffled(pool, `${level}:${L}`);
      for (let d = 0; d < days; d++) {
        const date = addDays(from, d);
        const w = order[(Math.max(1, dayNumber(date)) - 1) % pool.length];
        if (clues[w.a] && !problems(w, clues[w.a]).length) continue;
        const x = want.get(w.a) || { a: w.a, w: w.w, r: w.r, m: w.m, theme: w.t, dates: [] };
        x.dates.push(`${date} ${level} ${L}`);
        want.set(w.a, x);
      }
    }
  }
  const list = [...want.values()].sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  console.log(JSON.stringify(list, null, 1));
  console.error(`${list.length} answers need a theme and clue (next ${days} days from ${from})`);
} else if (cmd === 'apply') {
  const clues = readClues();
  let bad = 0;
  const used = new Set();
  for (const L of [4, 5]) {
    const f = JSON.parse(fs.readFileSync(file(L), 'utf8'));
    const answers = decode(f.answers);
    for (const level of LEVELS) {
      answers[level] = answers[level].map((w) => {
        // Start from the automatic theme (kept as "auto" so a later apply can go back to it)
        const base = { ...w, t: w.auto || w.t };
        delete base.auto; delete base.tj; delete base.c;
        const x = clues[w.a];
        if (!x) return base;
        used.add(w.a);
        const p = problems(w, x);
        if (p.length) { bad++; console.error(`${w.a} (${w.w}, ${level} ${L}): ${p.join('; ')}`); return base; }
        return { ...base, auto: base.t, t: x.t, tj: x.tj, c: x.c };
      });
    }
    f.answers = encode(answers);
    fs.writeFileSync(file(L), `${JSON.stringify(f)}\n`);
  }
  const unused = Object.keys(clues).filter((k) => !used.has(k));
  if (unused.length) console.error(`Not an answer (ignored): ${unused.join(' ')}`);
  console.log(`${used.size - bad} clues applied${bad ? `, ${bad} skipped (fix them above)` : ''}`);
  if (bad) process.exitCode = 1;
} else {
  console.error('Usage: node scripts/wordle/clues.mjs todo [days] [from] | apply');
  process.exit(1);
}
