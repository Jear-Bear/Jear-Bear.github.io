#!/usr/bin/env node
// build-v2.mjs — the Kana Wordle word lists used from V2_FROM (scripts/wordle/daily.js) (Node only).
//
//   node scripts/wordle/build-v2.mjs path/to/JMdict_e.gz
//   node scripts/wordle/clues.mjs apply          (puts the hand-written themes and clues back in)
//
// Writes data/wordle/v2/words-4.json and words-5.json. Never reorder the answers once they're
// live: each daily word is picked by position.
//
// Answers, per level (beginner, intermediate, advanced):
//   - JLPT vocabulary from data/crossword/words.json (open-anki-jlpt-decks, MIT, from Jonathan
//     Waller's JLPT lists, CC BY), at its own level (N5–N4 beginner, N3–N2 intermediate, N1
//     advanced), plus the crossword's hand-picked extras.
//   - Common words from JMdict (EDRDG, CC BY-SA 4.0) that aren't on the JLPT lists, levelled by
//     how frequent they are (JMdict's newspaper frequency bands, nf01 = the 500 most frequent):
//     beginner: common loanwords (gai1) up to nf24 and everyday words (ichi1) up to nf12;
//     intermediate: other words up to nf24; advanced nf25–nf40. Each level is topped up to
//     730 answers (two years of dailies), most frequent first. The rest are guesses only.
//     Beginner stops at 400: loanwords first, then the most common N3 words, then everyday words.
//   No answer is about war, violence, crime or death (GRIM below); those are guesses only.
//   Mixed isn't stored: it's all three levels together (daily.js), so each word is in the file once.
//   Only nouns, verbs and adjectives of exactly 4 or 5 kana (grid kana: small kana full size),
//   and never: proper nouns, vulgar, derogatory, sensitive, X-rated, slang, archaic, obsolete,
//   rare or dialect words, specialist terms (any JMdict field tag), irregular or outdated kana,
//   を or ゔ, or anything on data/crossword/blocklist.json.
//   Each answer carries its JLPT level (j: 'N5'…'N1', or none), shown after the game.
// Accepted guesses: every JMdict reading of the right length (not only common words), plus the
//   answers, so far more guesses are accepted than can come up as answers.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { gridKana } from '../crossword/kana.js';
import { partOfSpeech, theme, POS_THEME } from './themes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LENGTHS = [4, 5];
const JLPT = { n5: ['beginner', 'N5'], n4: ['beginner', 'N4'], n3: ['intermediate', 'N3'], n2: ['intermediate', 'N2'], n1: ['advanced', 'N1'], beginner: ['beginner', null], intermediate: ['intermediate', null], advanced: ['advanced', null] };
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const COMMON = /^(news1|news2|ichi1|ichi2|spec1|spec2|gai1|gai2|nf\d\d)$/;
const NOT_ANSWER_MISC = new Set(['vulg', 'derog', 'sens', 'X', 'sl', 'arch', 'obs', 'rare', 'obsc', 'dated', 'joc', 'm-sl', 'net-sl', 'chn', 'male', 'fem', 'poet', 'proverb', 'yoji', 'id', 'form']);
const BAD_KANA_INF = new Set(['ik', 'ok', 'sk', 'rk', 'gikun']);
const POS_OK = /^(n|adj-i|adj-na|v1|v5.|vk|vz|vs-i|vs-s)$/;

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/wordle/build-v2.mjs JMdict_e.gz'); process.exit(1); }

const xml = zlib.gunzipSync(fs.readFileSync(src)).toString('utf8');
const valid = new Map(LENGTHS.map((L) => [L, new Set()]));
const common = new Map();            // grid kana → best candidate from JMdict's common words
const posBy = new Map();             // grid kana and 'kanji|kana' → first sense's parts of speech
const nfRank = (pri) => Math.min(99, ...pri.map((p) => (/^nf(\d\d)$/.exec(p) || [])[1]).filter(Boolean).map(Number));
const tags = (block, tag) => [...block.matchAll(new RegExp(`<${tag}>&?([^;<]+);?</${tag}>`, 'g'))].map((x) => x[1]);

for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const e = m[1];
  const kanji = [...e.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g)].map((k) => ({ keb: tags(k[1], 'keb')[0], pri: tags(k[1], 'ke_pri'), inf: tags(k[1], 'ke_inf') }));
  const senses = [...e.matchAll(/<sense>([\s\S]*?)<\/sense>/g)].map((x) => x[1]);
  const first = senses[0] || '';
  const pos = tags(first, 'pos');
  const misc = senses.flatMap((x) => tags(x, 'misc'));
  const uk = tags(first, 'misc').includes('uk');
  const glossFirst = tags(first, 'gloss').filter(Boolean).slice(0, 3).join('; ');
  for (const r of e.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)) {
    const reb = tags(r[1], 'reb')[0];
    const a = reb && gridKana(reb);
    if (!a) continue;
    if (!posBy.has(a)) posBy.set(a, pos);
    kanji.forEach((k) => { if (!posBy.has(`${k.keb}|${a}`)) posBy.set(`${k.keb}|${a}`, pos); });
    if (!LENGTHS.includes(a.length)) continue;
    valid.get(a.length).add(a);
    // An answer candidate: a common reading of a plain everyday word
    const rpri = tags(r[1], 're_pri');
    const restr = tags(r[1], 're_restr');
    const kanjiFor = kanji.filter((k) => !restr.length || restr.includes(k.keb));
    const kpri = kanjiFor.flatMap((k) => k.pri);
    const pri = rpri.length ? rpri : kpri;
    if (!pri.some((p) => COMMON.test(p))) continue;
    if (tags(r[1], 're_inf').some((x) => BAD_KANA_INF.has(x))) continue;
    if (!pos.some((p) => POS_OK.test(p)) || pos.some((p) => /^n-pr|^pn$|^suf|^pref|^aux|^cop|^conj|^prt/.test(p))) continue;
    if (misc.some((x) => NOT_ANSWER_MISC.has(x)) || /<field>|<dial>/.test(first)) continue;
    if (/[をゔ]/.test(a) || !glossFirst || /\b(abbr|name of|surname|given name)\b/i.test(glossFirst)) continue;
    const nokanji = /<re_nokanji\/>/.test(r[1]);
    const written = nokanji || uk || !kanjiFor.length ? reb : (kanjiFor.find((k) => k.pri.some((p) => COMMON.test(p)) && !k.inf.length) || kanjiFor[0]).keb;
    const cand = { a, w: written, r: reb, m: glossFirst, pos, nf: nfRank(pri), gai: pri.includes('gai1'), ichi: pri.includes('ichi1') };
    const prev = common.get(a);
    if (!prev || cand.nf < prev.nf) common.set(a, cand);
  }
}

// --- Answers ----------------------------------------------------------------------------------
const { words } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/words.json'), 'utf8'));
const blocked = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/blocklist.json'), 'utf8')).words);
const extras = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/extra-words.json'), 'utf8')).words.map((x) => [gridKana(x.reading), x]));
const encode = (v) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64').split('').reverse().join('');
const pos = (w, list) => partOfSpeech(list || posBy.get(`${w.w}|${w.a}`) || posBy.get(w.a) || [], w.m);
// Which level a non-JLPT common word fits, or null (only a guess). Beginner wants everyday
// words, not newspaper ones: common loanwords, and words on the "ichi" list of everyday
// vocabulary that are also frequent.
const freqLevel = (c) => ((c.gai && c.nf <= 30) || (c.ichi && c.nf <= 8) ? 'beginner' : c.nf <= 24 ? 'intermediate' : c.nf <= 40 ? 'advanced' : null);
// A word game for learners: no answers about war, violence, crime or death (they still count as guesses)
const GRIM = /\b(massacre|murder|kill|killing|slaughter|suicide|terror|terrorist|rape|war|wartime|military|army|armies|troops|weapon|weapons|bomb|bombing|missile|corpse|death|deaths|dead|die|dying|crime|criminal|suspect|prison|slave|slavery|prostitut\w*|drug|drugs|narcotic|disaster|corruption|bribe|bribery|assassin\w*|execution|torture|invasion|enemy|disarmament|shoot\w*|gun|guns|gunfire|blood|bloodshed|penal|servitude|arson|assault|abuse|hostage|riot|kidnap\w*|sentence|sentenced|jail|police|homicide|violence|violent|fatal|casualt\w*|wound\w*|injur\w*|funeral|grave|nuclear|defendant|accused|prisoner|convict\w*)\b/i;
const BEGINNER = 400;               // a little over a year of beginner dailies
// Enough words for two years of dailies without a repeat; JLPT words are always all in, and
// common words fill a level up to this, most frequent (loanwords first for beginner) first
const TARGET = 730;
const order = (x, y) => (y.gai - x.gai) || x.nf - y.nf || x.a.localeCompare(y.a);

fs.mkdirSync(path.join(ROOT, 'data/wordle/v2'), { recursive: true });
for (const L of LENGTHS) {
  const answers = Object.fromEntries(LEVELS.map((l) => [l, []]));
  const taken = new Set();            // each answer at one level only (the easiest it's listed at)
  const add = (level, x) => {
    if (taken.has(x.a) || blocked.has(x.a) || blocked.has(x.w)) return;
    taken.add(x.a);
    answers[level].push(x);
    valid.get(L).add(x.a);
  };
  const jlptEntry = (w, lv) => { const p = pos(w); return { a: w.a, w: w.w, r: w.r, m: w.m, p, t: theme(w, extras) || POS_THEME[p], ...(JLPT[lv][1] ? { j: JLPT[lv][1] } : {}) }; };
  const jlptWords = (lv) => words.filter((w) => w.l === lv && w.a.length === L && !/[をゔ]/.test(w.a) && !/^--/.test(w.m));
  const onJlpt = new Set(words.filter((w) => /^n[1-5]$/.test(w.l)).map((w) => w.a));     // these keep their JLPT level
  const fill = (level, max, only = () => true) => [...common.values()].filter((c) => c.a.length === L && freqLevel(c) === level && !onJlpt.has(c.a) && !GRIM.test(c.m) && only(c)).sort(order).forEach((c) => {
    if (answers[level].length >= max) return;
    const p = pos(c, c.pos);
    add(level, { a: c.a, w: c.w, r: c.r, m: c.m, p, t: theme(c, extras) || POS_THEME[p] });
  });
  // Beginner: N5, N4 and the extras; then, up to 400, common loanwords, the most common N3
  // words (they still say N3 after the game), and last everyday words from the ichi list
  ['n5', 'n4', 'beginner'].forEach((lv) => jlptWords(lv).forEach((w) => add('beginner', jlptEntry(w, lv))));
  fill('beginner', BEGINNER, (c) => c.gai);
  const nf = (w) => (common.get(w.a) || { nf: 99 }).nf;
  jlptWords('n3').filter((w) => !GRIM.test(w.m)).sort((x, y) => nf(x) - nf(y) || x.a.localeCompare(y.a))
    .forEach((w) => { if (answers.beginner.length < BEGINNER) add('beginner', jlptEntry(w, 'n3')); });
  fill('beginner', BEGINNER);
  // Intermediate and advanced: the rest of the JLPT words at their own level, then common words
  ['n3', 'n2', 'intermediate'].forEach((lv) => jlptWords(lv).forEach((w) => add('intermediate', jlptEntry(w, lv))));
  ['n1', 'advanced'].forEach((lv) => jlptWords(lv).forEach((w) => add('advanced', jlptEntry(w, lv))));
  fill('intermediate', TARGET);
  fill('advanced', TARGET);
  const out = {
    length: L,
    note: 'Answers: JLPT vocabulary (open-anki-jlpt-decks, MIT; Jonathan Waller’s JLPT lists, CC BY) and common words from JMdict (EDRDG, CC BY-SA 4.0). Accepted guesses: every JMdict reading of this length. Answers are encoded.',
    valid: [...valid.get(L)].sort().join(''),
    answers: encode(answers),
  };
  fs.writeFileSync(path.join(ROOT, `data/wordle/v2/words-${L}.json`), `${JSON.stringify(out)}\n`);
  console.log(`${L} kana: ${valid.get(L).size} guesses; answers ${Object.entries(answers).map(([k, v]) => `${k} ${v.length} (JLPT ${v.filter((x) => x.j).length})`).join(', ')}`);
}
