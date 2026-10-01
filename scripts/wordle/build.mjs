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
const posBy = new Map();            // 'reading' and 'kanji|reading' -> first sense's parts of speech
let entries = 0;
for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  entries++;
  const e = m[1];
  const kanjiCommon = [...e.matchAll(/<ke_pri>([^<]+)<\/ke_pri>/g)].some((x) => COMMON.test(x[1]));
  const pos = [...((e.match(/<sense>([\s\S]*?)<\/sense>/) || [])[1] || '').matchAll(/<pos>&([^;]+);<\/pos>/g)].map((x) => x[1]);
  const kebs = [...e.matchAll(/<keb>([^<]+)<\/keb>/g)].map((x) => x[1]);
  for (const r of e.matchAll(/<reb>([^<]+)<\/reb>/g)) {
    const a = gridKana(r[1]);
    if (!a) continue;
    if (!posBy.has(a)) posBy.set(a, pos);
    kebs.forEach((k) => { if (!posBy.has(`${k}|${a}`)) posBy.set(`${k}|${a}`, pos); });
  }
  for (const r of e.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)) {
    const reb = (r[1].match(/<reb>([^<]+)<\/reb>/) || [])[1];
    const pri = [...r[1].matchAll(/<re_pri>([^<]+)<\/re_pri>/g)].map((x) => x[1]);
    if (!reb || (!pri.some((p) => COMMON.test(p)) && !kanjiCommon)) continue;
    const a = gridKana(reb);
    if (a && valid.has(a.length)) valid.get(a.length).add(a);
  }
}

// --- Themes: a hint from the word's meaning, else its part of speech ------------------------
const THEMES = [
  ['Food & drink', 'food eat eating drink rice meal bread meat fish vegetable fruit tea coffee sugar salt cook cooking kitchen restaurant lunch dinner breakfast noodle noodles egg milk beer sake soup candy cake sweets delicious taste flavor apple banana orange juice snack bento dumpling dumplings pancake curry tofu soy sauce wasabi cucumber potato onion'],
  ['Body & health', 'body head hand hands foot feet leg legs arm arms eye eyes ear ears mouth nose tooth teeth face hair stomach belly heart blood sick sickness illness ill medicine doctor dentist nurse hospital health healthy pain painful cold fever cough injury wound throat neck finger shoulder knee back skin'],
  ['Family & people', 'mother father parent parents brother sister child children son daughter wife husband family friend person people man woman baby aunt uncle grandfather grandmother grandchild teacher student boss adult boy girl lover guest neighbor neighbour colleague senior junior'],
  ['Time & calendar', 'day days week month year time morning evening night today tomorrow yesterday hour minute monday tuesday wednesday thursday friday saturday sunday spring summer autumn fall winter season birthday holiday vacation calendar era future past soon later early late always sometimes noon midnight weekend'],
  ['Numbers & counting', 'one two three four five six seven eight nine ten hundred thousand counter number numbers counting half double first second third quantity'],
  ['Weather & nature', 'rain snow wind weather sky cloud sun sunny moon star mountain river sea ocean tree trees flower flowers forest woods island lake nature earth fire water stone rock leaf leaves grass typhoon thunder storm beach sand pond hill field garden'],
  ['Animals', 'dog cat bird animal horse cow cattle pig insect bug monkey bear fox mouse rabbit tiger elephant snake turtle frog duck chicken whale goldfish raccoon'],
  ['Around the house', 'house home room door window desk chair table bed bedding futon bath toilet key box bag umbrella phone telephone television radio clock watch pen pencil book paper cup glass plate closet stairs wall floor roof shelf furniture refrigerator mattress blanket pillow towel soap mirror lamp light'],
  ['Clothes', 'clothes clothing shirt shoe shoes sock socks hat cap coat skirt trousers pants kimono wear dress glove gloves button pocket sweater uniform necktie tie suit belt'],
  ['Getting around', 'train car bus bicycle bike airplane plane ship boat station road street bridge airport travel trip ticket drive taxi map traffic corner intersection crossing subway platform passenger journey'],
  ['Around town', 'shop store bank post office library park city town village country building company embassy police temple shrine hotel theater theatre museum cinema market supermarket convenience cafe café'],
  ['School & work', 'study school class lesson test exam examination homework university college work job meeting business letter word words language kanji read write question answer dictionary practice office career salary interview report notebook'],
  ['Feelings', 'happy sad angry anger fear afraid love lonely glad worried worry kind gentle strict feel feeling emotion embarrassed surprise surprised nervous tired sleepy bored joy fun pleasant unpleasant hate envy proud shy'],
  ['Colors & looks', 'red blue green white black yellow brown color colour bright dark beautiful pretty cute ugly big small large little long short round thin thick tall wide narrow heavy light new old'],
  ['Fun & hobbies', 'sport sports game games music song songs sing singing dance dancing movie film picture photo photograph play hobby party festival guitar piano swim swimming karaoke anime manga comics toy toys cards'],
];
const THEME_WORDS = THEMES.map(([name, list]) => [name, new Set(list.split(' '))]);
const EXTRA_TAGS = { food: 'Food & drink', pop: 'Pop culture', comedy: 'Pop culture', slang: 'Slang', culture: 'Japanese culture', places: 'Places in Japan', animals: 'Animals', 'daily life': 'Everyday life', sport: 'Fun & hobbies', fun: 'Fun & hobbies', onomatopoeia: 'Sound words', idioms: 'Sayings', phrases: 'Things people say', society: 'Life in Japan', untranslatable: 'Hard-to-translate words' };
const extras = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/extra-words.json'), 'utf8')).words.map((x) => [gridKana(x.reading), x]));

function partOfSpeech(w) {
  const pos = posBy.get(`${w.w}|${w.a}`) || posBy.get(w.a) || [];
  const has = (re) => pos.some((p) => re.test(p));
  if (has(/^adj-i$/)) return 'adjective';
  if (has(/^(v1|v2|v4|v5|vk|vz|vs-i|vs-s|vs-c)/)) return 'verb';      // not plain "vs" (a noun you can use with する)
  if (!pos.length && /^(\([^)]*\) )?to /.test(w.m)) return 'verb';
  if (has(/^adj-na$/)) return 'na-adjective';
  if (has(/^adv/)) return 'adverb';
  if (has(/^(exp|int)$/)) return 'expression';
  if (has(/^(ctr|num)$/)) return 'counter';
  return 'noun';
}
function theme(w) {
  const x = extras.get(w.a);
  if (x && x.tags && EXTRA_TAGS[x.tags[0]]) return EXTRA_TAGS[x.tags[0]];
  // The category whose keyword shows up earliest in the English meaning
  const words = w.m.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-zé']+/).filter(Boolean);
  let best = null, at = Infinity;
  THEME_WORDS.forEach(([name, set]) => {
    const i = words.findIndex((t) => set.has(t));
    if (i >= 0 && i < at) { at = i; best = name; }
  });
  return best;
}
const POS_THEME = { verb: 'Something you do', adjective: 'A describing word', 'na-adjective': 'A describing word', adverb: 'How, when or how much', expression: 'Something people say', counter: 'Numbers & counting', noun: 'A thing or an idea' };

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
      const p = partOfSpeech(w);
      answers[level].push({ a: w.a, w: w.w, r: w.r, m: w.m, p, t: theme(w) || POS_THEME[p] });
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
