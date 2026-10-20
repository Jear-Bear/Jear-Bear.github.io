#!/usr/bin/env node
// seo-pages.mjs — landing pages for what people search for ("hiragana crossword",
// "JLPT N5 crossword", "kanji crossword"...), so the crossword is found on Google and not
// only through videos. Node only:
//
//   node scripts/crossword/seo-pages.mjs
//
// Writes tools/crossword/<slug>/index.html for each page below, built from the site's
// shared header and footer (taken from terms/index.html). Each has its own text, a list of
// words from that level (data/crossword/words.json, minus the blocklist), a button that
// opens the crossword at that mode and level, an FAQ, and structured data. Run it again
// after changing the text here, the word list or the shared header/footer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'https://www.jareddesu.com';
const OG = `${SITE}/images/og/crossword.jpg`;

const PAGES = [
  {
    slug: 'hiragana', levels: ['n5'], mode: 'kana', level: 'beginner', size: 'mini',
    title: 'Hiragana Crossword Puzzles', short: 'Hiragana',
    desc: 'Free daily hiragana crossword puzzles for Japanese learners: English clues, answers typed in hiragana, at a beginner (JLPT N5–N4) level. A new 5×5 mini every day, no account needed.',
    intro: 'Know your hiragana and want to actually use it? These crosswords give you an English clue and you fill in the answer in hiragana, one kana per square. The words come from the first JLPT levels, so you’ll recognise most of them, and the crossing words help when you’re stuck.',
    how: ['Read the English clue, then type the answer in romaji (it turns into kana as you go) or with a Japanese keyboard.', 'Small kana are written full size, like in a Japanese newspaper: きゃ becomes きや, がっこう becomes がつこう.', 'Start with the 5×5 mini. When it feels easy, try the 9×9 daily at the same level.'],
    faq: [['Do I need to know kanji?', 'No. In kana mode every answer is written in hiragana, and the clues are in English.'], ['How hard is it?', 'Beginner puzzles use JLPT N5 and N4 words: everyday things like food, family, time and places. Intermediate and advanced levels are there when you want more.']],
  },
  {
    slug: 'jlpt-n5', levels: ['n5'], mode: 'kana', level: 'beginner', size: 'mini',
    title: 'JLPT N5 Crossword Puzzles', short: 'JLPT N5',
    desc: 'Free daily Japanese crossword puzzles with JLPT N5 vocabulary: English clues, hiragana answers. Practice the N5 word list a fun way, with a new mini and daily puzzle every day.',
    intro: 'Studying for the JLPT N5? Flashcards teach you the words; a crossword makes you pull them out of memory, which is what sticks. Every beginner puzzle is built from the N5 and N4 vocabulary lists, with English clues and hiragana answers.',
    how: ['A new beginner mini (5×5) and daily (9×9) every day, at your midnight.', 'Clues are in English; answers are N5–N4 words in hiragana.', 'After you solve, every answer is listed with its kanji and meaning, so each puzzle doubles as a short vocab review.'],
    faq: [['Is it only N5 words?', 'Beginner puzzles mix N5 and N4 words, with a few fun extras like food and pop culture. That keeps them solvable for N5 learners and useful on the way to N4.'], ['Can I play older puzzles?', 'Today’s and yesterday’s puzzles are free. The whole archive is part of Crossword+.']],
  },
  {
    slug: 'jlpt-n4', levels: ['n4'], mode: 'kana', level: 'beginner', size: 'daily',
    title: 'JLPT N4 Crossword Puzzles', short: 'JLPT N4',
    desc: 'Free daily Japanese crossword puzzles with JLPT N4 vocabulary. English clues, hiragana answers, a new puzzle every day for N4 learners.',
    intro: 'N4 is where the vocabulary list doubles. These crosswords mix the N4 words you’re learning with the N5 words you already know, so every puzzle is a review and a stretch at once.',
    how: ['Pick Beginner: it uses N5 and N4 words.', 'Try the 9×9 daily for longer words and more crossings.', 'Turn on the kanji mode when you want to practise writing the same words in kanji.'],
    faq: [['What’s the difference between the mini and the daily?', 'The mini is a quick 5×5 grid, a couple of minutes. The daily is 9×9 with longer words and takes 5 to 15 minutes.'], ['Is there a streak?', 'Yes. Solve one daily puzzle each day; like the New York Times crossword, each day’s puzzles count for 48 hours.']],
  },
  {
    slug: 'jlpt-n3', levels: ['n3'], mode: 'kana', level: 'intermediate', size: 'daily',
    title: 'JLPT N3 Crossword Puzzles', short: 'JLPT N3',
    desc: 'Free daily Japanese crossword puzzles with JLPT N3 and N2 vocabulary. English clues, hiragana answers, a new intermediate puzzle every day.',
    intro: 'Intermediate puzzles are built from the N3 and N2 lists: the words that show up in news, manga and everyday conversation once you’re past the basics. They’re a good check of how much of your intermediate vocabulary you can actually recall.',
    how: ['Pick Intermediate: N3 and N2 words, English clues.', 'Stuck? Check a word or reveal a square; your time still counts, marked as helped.', 'Every answer is listed after you solve, with kanji and meaning.'],
    faq: [['Are the clues in English?', 'Yes, for beginner, intermediate and advanced. The Mixed level has clues in Japanese, like a newspaper crossword.'], ['Can I use a Japanese keyboard?', 'Yes. Type in hiragana and press Enter, without converting to kanji, or type romaji with the IME off.']],
  },
  {
    slug: 'jlpt-n2', levels: ['n2'], mode: 'kana', level: 'intermediate', size: 'daily',
    title: 'JLPT N2 Crossword Puzzles', short: 'JLPT N2',
    desc: 'Free daily Japanese crossword puzzles with JLPT N2 vocabulary. Upper-intermediate words, English clues, hiragana answers, a new puzzle every day.',
    intro: 'N2 vocabulary is big, abstract and easy to half-know. A crossword won’t let you half-know a word: you have to produce it, kana by kana. The intermediate puzzles mix N3 and N2 words, with fun extras along the way.',
    how: ['Pick Intermediate for N3–N2, or Advanced when you want N1 and slang.', 'Use the kanji mode to practise writing the same words.', 'Solve daily to build a streak; yesterday’s puzzle still counts today.'],
    faq: [['How is this different from flashcards?', 'Flashcards show you the word. A crossword gives you the meaning and makes you recall the word yourself, with crossing letters as hints, which is better practice for real use.'], ['Is it free?', 'Today’s and yesterday’s puzzles are free, with no account. Crossword+ adds the archive, crosswords from your own Anki deck and bonus puzzles.']],
  },
  {
    slug: 'jlpt-n1', levels: ['n1'], mode: 'kana', level: 'advanced', size: 'daily',
    title: 'JLPT N1 Crossword Puzzles', short: 'JLPT N1',
    desc: 'Free daily Japanese crossword puzzles with JLPT N1 vocabulary, slang and idioms. A challenging puzzle every day for advanced Japanese learners.',
    intro: 'Advanced puzzles use N1 vocabulary plus the slang, idioms and set phrases you only meet in native material. If the intermediate level feels easy, this is where it stops being easy.',
    how: ['Pick Advanced: N1 words, idioms and slang, English clues.', 'Or pick Mixed for words from every level with clues written in Japanese.', 'Your best time and streak are kept for each level.'],
    faq: [['Is there anything harder?', 'Try the kanji mode at the advanced level: you write each answer in kanji, one character per square, from its meaning.'], ['Can I play on my phone?', 'Yes. On a phone the puzzle has its own kana keyboard under the grid.']],
  },
  {
    slug: 'kanji', levels: ['n5', 'n4'], mode: 'kanji', level: 'beginner', size: 'mini', kanjiOnly: true,
    title: 'Kanji Crossword Puzzles', short: 'Kanji',
    desc: 'Free daily kanji crossword puzzles: read the meaning and write the word in kanji, one character per square. Beginner (N5–N4) to advanced (N1) levels.',
    intro: 'In the kanji mode you get a word’s meaning and write it in kanji, one character per square. Words cross where they share a kanji, so a kanji you know in one word helps you find another. It’s recall practice for kanji, the hardest part of Japanese to keep in your head.',
    how: ['Read the meaning, then type the reading with a Japanese keyboard and convert it, or tap the kanji tiles under the grid.', 'Turn on readings in ⚙ for an easier puzzle.', 'Beginner uses N5–N4 words; intermediate and advanced go up to N1.'],
    faq: [['Do I need a Japanese keyboard?', 'No. On a phone or computer, kanji tiles under the grid let you tap the characters in.'], ['Is there a hiragana version?', 'Yes: the kana mode has the same levels with answers in hiragana.']],
  },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KANJI = /^[一-鿿々]{2,4}$/;
function rng(seed) {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const { words } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/words.json'), 'utf8'));
const blocked = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/crossword/blocklist.json'), 'utf8')).words);
function sample(p, n = 24) {
  const r = rng(p.slug);
  const pool = words.filter((w) => p.levels.includes(w.l) && !blocked.has(w.w) && !blocked.has(w.a) && w.m && w.m.length < 60
    && (p.kanjiOnly ? KANJI.test(w.w) : true) && w.a.length >= 2 && w.a.length <= 6);
  const out = pool.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, n);
}

// The shared page: head, masthead and footer from terms/index.html (one level deep), three levels deep here
const shell = fs.readFileSync(path.join(ROOT, 'terms/index.html'), 'utf8').replace(/(href|src)="\.\.\//g, '$1="../../../');
const head = shell.slice(0, shell.indexOf('<main id="main">'));
const foot = shell.slice(shell.indexOf('</main>'));

for (const p of PAGES) {
  const url = `${SITE}/tools/crossword/${p.slug}/`;
  const play = `../?mode=${p.mode}&level=${p.level}&size=${p.size}`;
  const list = sample(p);
  const others = PAGES.filter((x) => x.slug !== p.slug);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: `Japanese Crossword: ${p.title}`, url, applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser)', inLanguage: ['en', 'ja'], description: p.desc, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Person', name: 'Jared P.' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Tools', item: `${SITE}/tools/` },
      { '@type': 'ListItem', position: 2, name: 'Japanese Crossword', item: `${SITE}/tools/crossword/` },
      { '@type': 'ListItem', position: 3, name: p.title, item: url }] },
  ];
  const meta = `  <title>${esc(p.title)}: Free Daily Japanese Crosswords · Jared P.</title>
  <meta name="description" content="${esc(p.desc)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(p.title)} · Japanese Crossword" />
  <meta property="og:description" content="${esc(p.desc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${OG}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="stylesheet" href="../../../styles/learn.css?v=1">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  let html = head
    .replace(/<title>[\s\S]*?<\/title>\n\s*<meta name="description"[^>]*\/>/, meta.trimStart())
    .replace('<body data-page="terms">', '<body data-page="crossword-learn">');
  html += `<main id="main">
    <div class="container legal learn">
      <header class="page-head">
        <div class="page-head-copy">
          <p class="learn-crumb"><a href="../../">Tools</a> › <a href="../">Japanese Crossword</a></p>
          <h1 class="page-title">${esc(p.title)}<em>.</em></h1>
          <p class="page-intro">${esc(p.intro)}</p>
          <p><a class="btn learn-play" href="${play}">Play today’s ${esc(p.short)} crossword →</a></p>
          <p class="learn-free">Free every day, no account needed.</p>
        </div>
        <p class="page-v"><span class="page-v-ja" lang="ja">十字</span><span class="page-v-en">Crossword</span></p>
      </header>

      <h2>How it works</h2>
      <ul>${p.how.map((x) => `\n        <li>${esc(x)}</li>`).join('')}
      </ul>

      <h2>Words you might see</h2>
      <p>A sample from the ${esc(p.levels.map((l) => l.toUpperCase()).join(' and '))} list the puzzles are built from. Each day’s puzzle picks different ones.</p>
      <table class="learn-words">
        <thead><tr><th>Word</th><th>Reading</th><th>Meaning</th></tr></thead>
        <tbody>${list.map((w) => `\n          <tr><td lang="ja">${esc(w.w)}</td><td lang="ja">${esc(w.r)}</td><td>${esc(w.m)}</td></tr>`).join('')}
        </tbody>
      </table>

      <h2>Questions</h2>
      <dl class="learn-faq">${p.faq.map(([q, a]) => `\n        <dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}
      </dl>

      <p><a class="btn learn-play" href="${play}">Play today’s ${esc(p.short)} crossword →</a></p>

      <h2>More Japanese crosswords</h2>
      <ul class="learn-more">${others.map((x) => `\n        <li><a class="inline-link" href="../${x.slug}/">${esc(x.title)}</a></li>`).join('')}
        <li><a class="inline-link" href="../../wordle/">Kana Wordle: guess a Japanese word in hiragana</a></li>
      </ul>
    </div>
  </main>`;
  html += foot.slice('</main>'.length);
  fs.mkdirSync(path.join(ROOT, 'tools/crossword', p.slug), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tools/crossword', p.slug, 'index.html'), html);
  console.log(`tools/crossword/${p.slug}/ · ${list.length} words`);
}
export { PAGES };
