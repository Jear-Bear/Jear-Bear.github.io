// guide.js — Jared's Ultimate Japanese Guide: reading progress, scroll
// animations, chapter tracking and the interactive widgets.
//
// Progress, the reader's "why", and checklists stay in this browser
// (localStorage). Nothing typed by the reader is ever inserted as HTML.

const KEY = 'jareddesu.guide.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function load() {
  try { return { done: {}, why: '', checks: {}, last: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { done: {}, why: '', checks: {}, last: null }; }
}
const store = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c != null && c !== false && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const n = document.createElementNS(SVG, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) n.setAttribute(k, v); });
  kids.flat().forEach((c) => { if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const CHAPTER = document.body.dataset.chapter || null;
const IS_HUB = document.body.dataset.hub === '1';

// --------------------------------------------------------------- page chrome
// The Guide link in the site nav is current on every guide page
$$('.masthead-nav a, .menu-sheet a').forEach((a) => { if (/guide\/$/.test(a.getAttribute('href') || '')) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); } });

// Reading progress bar
const bar = $('.g-progress span');
function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (bar) bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Reveal on scroll
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { rootMargin: '0px 0px -12% 0px' });
function watch(el) { if (reduced) el.classList.add('is-in'); else io.observe(el); }
$$('.g-body > *:not(.g-loop):not(.g-mountain)').forEach((el) => { if (!el.classList.contains('g-noreveal')) el.classList.add('g-reveal'); });
$$('.g-reveal, .g-mark, .g-timeline li, .g-web').forEach(watch);

// Headings: numbers, ids, and the "On this page" list
const onpage = $('#onpage');
const heads = $$('.g-body h2');
heads.forEach((hd, i) => {
  if (!hd.id) hd.id = (hd.dataset.id || hd.textContent).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `s${i + 1}`;
  if (!hd.querySelector('.g-h2-n')) hd.prepend(h('span', { class: 'g-h2-n' }, `${String(i + 1).padStart(2, '0')}`));
  if (onpage) onpage.append(h('li', {}, h('a', { href: `#${hd.id}` }, hd.lastChild.textContent || hd.textContent)));
});
if (onpage && heads.length) {
  const links = $$('a', onpage);
  const spy = () => {
    let cur = 0;
    heads.forEach((hd, i) => { if (hd.getBoundingClientRect().top < innerHeight * 0.35) cur = i; });
    links.forEach((a, i) => a.classList.toggle('is-cur', i === cur));
  };
  addEventListener('scroll', spy, { passive: true });
  spy();
}

// Chapter drawer on phones
const side = $('.g-side');
if (side) {
  const toggle = h('button', { type: 'button', class: 'g-side-toggle', 'aria-expanded': 'false' }, ringSvg(18), h('span', {}, 'Chapters'));
  document.body.append(toggle);
  const set = (open) => { side.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => set(!side.classList.contains('is-open')));
  document.addEventListener('click', (e) => { if (side.classList.contains('is-open') && !side.contains(e.target) && !toggle.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  $$('a', side).forEach((a) => a.addEventListener('click', () => set(false)));
}

function ringSvg(size) {
  const r = 15, c = 2 * Math.PI * r;
  return s('svg', { class: 'g-ring', viewBox: '0 0 36 36', width: size, height: size, 'aria-hidden': 'true' },
    s('circle', { class: 'bg', cx: 18, cy: 18, r }), s('circle', { class: 'fg', cx: 18, cy: 18, r, 'stroke-dasharray': c, 'stroke-dashoffset': c }));
}

// --------------------------------------------------------------- chapters read
let total = 0;
function paintDone() {
  const items = $$('.g-toc li, .g-card');
  total = total || $$('.g-toc li').length || $$('.g-card').length;
  items.forEach((li) => li.classList.toggle('is-done', Boolean(store.done[li.dataset.slug])));
  const n = Object.keys(store.done).filter((k) => store.done[k]).length;
  $$('.g-side-count').forEach((el) => { el.textContent = `${n} / ${total}`; });
  $$('.g-side-bar span').forEach((el) => { el.style.width = `${total ? (n / total) * 100 : 0}%`; });
  $$('.g-ring .fg').forEach((c) => { const len = Number(c.getAttribute('stroke-dasharray')); c.setAttribute('stroke-dashoffset', String(len * (1 - (total ? n / total : 0)))); });
  $$('[data-read-count]').forEach((el) => { el.textContent = `${n} of ${total}`; });
  if (CHAPTER) {
    const done = Boolean(store.done[CHAPTER]);
    $$('.g-done-btn').forEach((b) => { b.classList.toggle('is-done', done); $('.g-done-text', b).textContent = done ? 'Read. Nice work!' : 'Mark this chapter as read'; });
    $$('.g-hero-done').forEach((el) => { el.hidden = !done; });
  }
}
$$('.g-done-btn').forEach((b) => b.addEventListener('click', () => {
  const slug = b.dataset.done;
  store.done[slug] = !store.done[slug];
  save();
  paintDone();
  if (store.done[slug]) { b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop'); }
}));
if (CHAPTER) { store.last = CHAPTER; save(); }
// Reaching the end of a chapter counts as reading it
if (CHAPTER) {
  const end = $('.g-chapter-end');
  if (end) new IntersectionObserver((es, ob) => es.forEach((e) => { if (e.isIntersecting && !store.done[CHAPTER]) { store.done[CHAPTER] = true; save(); paintDone(); ob.disconnect(); } }), { threshold: 0.6 }).observe(end);
}
paintDone();

// Hub: resume link and the reader's why
if (IS_HUB) {
  const resume = $('#g-resume');
  if (resume && store.last) {
    fetch('chapters.json').then((r) => r.json()).then((list) => {
      const c = list.find((x) => x.slug === store.last);
      if (!c) return;
      resume.replaceChildren('Pick up where you left off: ', h('a', { href: `${c.slug}/`, class: 'text-link' }, `${c.kanji} ${c.title} →`));
      resume.classList.add('is-on');
    }).catch(() => {});
  }
  const hw = $('#g-hub-why');
  if (hw && store.why) { $('q', hw).textContent = store.why; hw.classList.add('is-on'); }
}

// --------------------------------------------------------------- media
// Screenshot / photo placeholders: if the real image exists, show it
$$('.g-shot[data-src]').forEach((fig) => {
  const img = new Image();
  img.onload = () => {
    img.alt = $('figcaption', fig)?.textContent || '';
    img.loading = 'lazy';
    $('.g-shot-ph', fig).replaceWith(img);
    fig.classList.add('has-img');
  };
  img.src = fig.dataset.src;
});

// YouTube: load the player only when asked
$$('.g-yt').forEach((box) => {
  const btn = $('.g-yt-btn', box);
  // Full-HD thumbnail; older uploads without one get YouTube's 120px grey stand-in (or a 404), so drop to hqdefault.
  const img = $('img', btn);
  const fallback = () => { if (!img.src.includes('hqdefault')) img.src = `https://i.ytimg.com/vi/${box.dataset.id}/hqdefault.jpg`; };
  img.addEventListener('error', fallback);
  img.addEventListener('load', () => { if (img.naturalWidth <= 120) fallback(); });
  if (img.complete && img.naturalWidth && img.naturalWidth <= 120) fallback();
  btn.addEventListener('click', () => {
    const f = h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0`,
      title: btn.getAttribute('aria-label').replace(/^Play video: /, ''),
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
      allowfullscreen: true,
    });
    btn.replaceWith(f);
  });
});

// Numbers that count up when they come into view
$$('[data-count]').forEach((el) => {
  const end = Number(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  const run = () => {
    if (reduced) { el.textContent = fmt(end) + suffix; return; }
    const t0 = performance.now();
    const tick = (t) => {
      const p = clamp((t - t0) / 1400, 0, 1);
      el.textContent = fmt(end * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  el.textContent = '0' + suffix;
  new IntersectionObserver((es, ob) => es.forEach((e) => { if (e.isIntersecting) { run(); ob.disconnect(); } }), { threshold: 0.6 }).observe(el);
});

// Timelines that draw as you scroll
$$('.g-timeline').forEach((tl) => {
  const line = h('span', { class: 'g-timeline-line', 'aria-hidden': 'true' });
  tl.prepend(line);
  const upd = () => {
    const r = tl.getBoundingClientRect();
    const p = clamp((innerHeight * 0.65 - r.top) / r.height, 0, 1);
    tl.style.setProperty('--p', p.toFixed(3));
  };
  addEventListener('scroll', upd, { passive: true });
  upd();
});

// --------------------------------------------------------------- widgets
function widgetFrame(el, title, tag = 'Try it') {
  el.classList.add('g-widget');
  const head = h('div', { class: 'g-widget-head' }, h('p', { class: 'g-widget-title' }, title), h('span', { class: 'g-widget-tag' }, tag));
  el.prepend(head);
  return el;
}
function seg(options, value, onChange, label) {
  const box = h('div', { class: 'g-seg', role: 'group', 'aria-label': label });
  const paint = (v) => $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  options.forEach(([v, text]) => box.append(h('button', { type: 'button', 'data-v': v, onclick: () => { paint(v); onChange(v); } }, text)));
  paint(value);
  return box;
}
function range({ label, min, max, step = 1, value, unit = '', onInput }) {
  const out = h('output', {}, `${value}${unit}`);
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; onInput(Number(input.value)); });
  return h('label', { class: 'g-range' }, h('span', { class: 'g-range-top' }, h('span', {}, label), out), input);
}

const W = {};

// 山 — every word is one more stone. Builds as you scroll past it.
W.mountain = (el) => {
  const kanji = '日人一大年中会本出見行時上生子手言自気間前後話書読聞食飲来学先友家犬猫雨空花山川海夢心愛道光声音色旅映歌恋旨鬼縁粋侘寂凪';
  const rows = 10;
  const WORDS = 23000;                        // my current known-word count
  const stones = [];
  let k = 0;
  for (let r = rows; r >= 1; r--) {           // bottom row first
    for (let c = 0; c < r; c++) stones.push({ r, c, ch: kanji[k++] || '語' });
  }
  stones[stones.length - 1].ch = '凪';         // the peak is always my favorite kanji
  const size = 40, W0 = rows * size + 20, H0 = rows * size * 0.92 + 20;
  const svg = s('svg', { class: 'g-mountain-svg', viewBox: `0 0 ${W0} ${H0}`, role: 'img', 'aria-label': 'A mountain built from kanji, one stone per word' });
  const nodes = stones.map((st, i) => {
    const y = H0 - 10 - (rows - st.r) * size * 0.92 - size * 0.46;
    const x = W0 / 2 + (st.c - (st.r - 1) / 2) * size;
    const t = s('text', { x, y, 'font-size': 30, class: `off${i === stones.length - 1 ? ' peak' : ''}` }, st.ch);
    svg.append(t);
    return t;
  });
  const count = h('b', {}, '0');
  el.append(svg, h('p', { class: 'g-mountain-cap' }, h('span', {}, 'Every word you learn is one more stone.'), h('span', {}, count, ' words')));
  const upd = () => {
    const r = el.getBoundingClientRect();
    const p = reduced ? 1 : clamp((innerHeight - r.top) / (innerHeight * 0.55 + r.height * 0.6), 0, 1);
    const n = Math.round(p * nodes.length);
    nodes.forEach((t, i) => t.classList.toggle('off', i >= n));
    count.textContent = fmt(n === nodes.length ? WORDS : (n / nodes.length) * WORDS);
  };
  addEventListener('scroll', upd, { passive: true });
  upd();
};

// The loop: immerse → mine → review → repeat (scrollytelling)
W.loop = (el) => {
  const steps = $$('.g-loop-step', el);
  const pos = [[170, 52], [288, 170], [170, 288], [52, 170]];
  const labels = [['浸', 'IMMERSE'], ['掘', 'MINE'], ['復', 'REVIEW'], ['又', 'REPEAT']];
  const svg = s('svg', { viewBox: '0 0 340 340', role: 'img', 'aria-label': 'The loop: immerse, mine, review, repeat' },
    s('g', { class: 'spin' }, s('circle', { class: 'arc', cx: 170, cy: 170, r: 118 })),
    ...pos.map(([x, y], i) => s('g', { class: 'node', 'data-i': i },
      s('circle', { cx: x, cy: y, r: 44 }), s('text', { x, y: y - 6 }, labels[i][0]), s('text', { x, y: y + 20, class: 'en' }, labels[i][1]))));
  const stage = h('div', { class: 'g-loop-stage', 'aria-hidden': 'true' }, svg);
  el.prepend(stage);
  const nodes = $$('.node', svg);
  const ob = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const i = steps.indexOf(e.target);
    nodes.forEach((n, j) => n.classList.toggle('is-on', j === i % 4));
  }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((st) => ob.observe(st));
};

// Pin your why
W.why = (el) => {
  widgetFrame(el, 'Pin your why', 'Saved on this device');
  const ta = h('textarea', { 'aria-label': 'Why are you learning Japanese?', placeholder: 'e.g. I want to talk to my host family without pointing at things. / I want to read Dandadan the day it drops.', maxlength: 400 });
  ta.value = store.why || '';
  const card = h('div', { class: 'g-why-card', role: 'status' }, h('q', {}), h('small', {}, 'Pinned. It shows on the guide’s front page whenever you come back.'));
  const show = () => { $('q', card).textContent = store.why; card.classList.toggle('is-on', Boolean(store.why)); };
  el.append(ta, h('div', { class: 'g-btn-row', style: 'margin-top:10px' },
    h('button', { type: 'button', class: 'g-btn g-btn-primary', onclick: () => { store.why = ta.value.trim(); save(); show(); } }, 'Pin it'),
    h('button', { type: 'button', class: 'g-btn', onclick: () => { store.why = ''; ta.value = ''; save(); show(); } }, 'Clear')), card);
  show();
};

// Kana check
W.kana = (el) => {
  widgetFrame(el, 'Ten-second kana check', 'Quiz');
  const map = { あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'wo', ん: 'n', ア: 'a', カ: 'ka', シ: 'shi', ツ: 'tsu', ソ: 'so', ン: 'n', ノ: 'no', メ: 'me', ヌ: 'nu', ワ: 'wa', ケ: 'ke', ル: 'ru', ホ: 'ho' };
  const alts = { shi: ['si'], chi: ['ti'], tsu: ['tu'], fu: ['hu'], wo: ['o'], n: ['nn'] };
  const keys = Object.keys(map);
  let cur = null, right = 0, asked = 0;
  const big = h('p', { class: 'g-kana-big', lang: 'ja', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Type the romaji' });
  const score = h('p', { class: 'g-widget-note' });
  const next = () => { cur = keys[Math.floor(Math.random() * keys.length)]; big.textContent = cur; big.className = 'g-kana-big'; input.value = ''; };
  const check = () => {
    const a = input.value.trim().toLowerCase();
    if (!a) return;
    asked++;
    const ok = a === map[cur] || (alts[map[cur]] || []).includes(a);
    if (ok) right++;
    big.className = `g-kana-big ${ok ? 'ok' : 'no'}`;
    score.textContent = ok ? `Yes! ${right} / ${asked}` : `That one’s ${map[cur]}. ${right} / ${asked}`;
    setTimeout(next, ok ? 450 : 1100);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  el.append(big, h('div', { class: 'g-kana-in' }, input, h('button', { type: 'button', class: 'g-btn', onclick: check }, 'Check')), score,
    h('p', { class: 'g-widget-note' }, 'Missing a bunch? The ', h('a', { href: '../../tools/kana/' }, 'Kana Trainer'), ' on this site drills all of them.'));
  next();
};

// Bob (1k words) vs Ross (3k words)
W.bobross = (el) => {
  widgetFrame(el, 'Bob knows 1,000 words. Ross knows 3,000.', 'Compare');
  // [text, rough frequency rank, reading, meaning]
  const toks = [['今日', 90, 'きょう', 'today'], ['は', 1], ['バイト', 2900, 'ばいと', 'part-time job'], ['が', 1], ['休み', 700, 'やすみ', 'day off'], ['だから', 120], ['、', 0], ['兄弟', 1700, 'きょうだい', 'brothers'], ['みんな', 260, 'みんな', 'everyone'], ['で', 1], ['競馬場', 14000, 'けいばじょう', 'horse-racing track'], ['に', 1], ['行こう', 40, 'いこう', 'let’s go'], ['ぜ', 600, 'ぜ', '(rough sentence-ender)'], ['！', 0]];
  const sent = h('p', { class: 'g-br-sent', lang: 'ja' });
  const note = h('p', { class: 'g-verdict', 'aria-live': 'polite' });
  const spans = toks.map(([t, rank, r, m]) => {
    const sp = h('span', { 'data-rank': rank, title: r ? `${r}: ${m}` : '' }, t);
    sp.addEventListener('click', () => sp.classList.toggle('peek'));
    sent.append(sp);
    return sp;
  });
  const set = (who) => {
    const known = { bob: 1000, ross: 3000, native: 30000 }[who];
    const unknown = spans.filter((sp) => Number(sp.dataset.rank) > known);
    spans.forEach((sp) => sp.classList.toggle('unk', Number(sp.dataset.rank) > known));
    note.className = `g-verdict ${unknown.length > 1 ? 'is-warn' : 'is-good'}`;
    note.textContent = who === 'bob'
      ? `Bob is missing ${unknown.length} words. He can guess the vibe (someone’s going somewhere today), but he’s pausing for lookups every few seconds.`
      : who === 'ross'
        ? 'Ross is missing one word. That’s an i+1 sentence: everything else gives him the context to guess 競馬場, and it’s the perfect sentence to mine.'
        : 'A native speaker has the ~30,000-word passive vocabulary and gets all of it.';
  };
  el.append(seg([['bob', 'Bob · 1k'], ['ross', 'Ross · 3k'], ['native', 'Native · ~30k']], 'bob', set, 'Vocabulary size'), sent,
    h('p', { class: 'g-br-gloss' }, '“No work today, so let’s all go to the horse track together!” Tap a blurred word to peek.'), note,
    h('p', { class: 'g-widget-note' }, 'Frequency ranks are rough, in the style of JPDB’s list.'));
  set('bob');
};

// New cards a day → reviews a day
W.reviews = (el) => {
  widgetFrame(el, 'What 10 new cards a day turns into', 'Calculator');
  const INTERVALS = [1, 3, 7, 15, 30, 60, 120, 240, 480];
  function simulate(perDay, retention, days) {
    // Expected reviews per day. Each card climbs the interval ladder when you
    // pass and drops back to the start when you fail.
    const r = retention / 100;
    const due = new Map();          // day → Map(stage → mass)
    const add = (day, stage, mass) => {
      if (day >= days) return;
      if (!due.has(day)) due.set(day, new Map());
      const m = due.get(day); m.set(stage, (m.get(stage) || 0) + mass);
    };
    const out = [];
    for (let d = 0; d < days; d++) {
      let reviews = 0;
      const today = due.get(d);
      if (today) {
        today.forEach((mass, stage) => {
          reviews += mass;
          add(d + INTERVALS[Math.min(stage + 1, INTERVALS.length - 1)], stage + 1, mass * r);
          add(d + 1, 0, mass * (1 - r));
        });
        due.delete(d);
      }
      add(d + 1, 0, perDay);         // today's new cards come back tomorrow
      out.push(reviews);
    }
    return out;
  }
  let perDay = 10, retention = 90, days = 120;
  const chartBox = h('div', { class: 'g-chart-wrap' });
  const stats = h('div', { class: 'g-stats' });
  const verdict = h('p', { class: 'g-verdict', 'aria-live': 'polite' });
  const tbody = h('tbody');
  const draw = () => {
    const a = simulate(perDay, retention, days);
    const b = simulate(50, retention, days);
    const avg = (arr) => arr.slice(-14).reduce((x, y) => x + y, 0) / 14;
    const revA = avg(a), revB = avg(b);
    const minsA = (revA * 8 + perDay * 25) / 60;
    const minsB = (revB * 8 + 50 * 25) / 60;
    stats.replaceChildren(
      h('div', { class: 'g-stat' }, h('span', { class: 'g-stat-v' }, fmt(revA)), h('span', { class: 'g-stat-l' }, `reviews a day by day ${days}`)),
      h('div', { class: 'g-stat' }, h('span', { class: 'g-stat-v' }, `${fmt(minsA)} min`), h('span', { class: 'g-stat-l' }, 'a day in your SRS (≈8 s a review, 25 s a new card)')),
      h('div', { class: 'g-stat' }, h('span', { class: 'g-stat-v' }, fmt(perDay * days)), h('span', { class: 'g-stat-l' }, 'new words added')),
      h('div', { class: 'g-stat' }, h('span', { class: 'g-stat-v' }, `${fmt(minsB)} min`), h('span', { class: 'g-stat-l' }, 'a day at 50 new cards (my burnout pace)')));
    verdict.className = `g-verdict ${minsA > 75 ? 'is-bad' : minsA > 40 ? 'is-warn' : 'is-good'}`;
    verdict.textContent = minsA > 75
      ? 'That’s more time in flashcards than most people spend immersing. This is exactly how I burned out and quit for three months.'
      : minsA > 40
        ? 'Doable, but it’s eating into immersion time. If reviews start to feel like a chore, drop new cards for a week.'
        : 'Sustainable. This leaves the most time for the part that actually makes you good: immersion.';
    chartBox.replaceChildren(lineChart(a, b, days));
    tbody.replaceChildren(...a.map((v, i) => i % 7 === 6 ? h('tr', {}, h('td', {}, `Day ${i + 1}`), h('td', { class: 'num' }, fmt(v)), h('td', { class: 'num' }, fmt(b[i]))) : null).filter(Boolean));
  };
  function lineChart(a, b, n) {
    const Wd = 640, Ht = 240, L = 44, R = 16, T = 12, B = 28;
    const max = Math.max(...a, ...b) * 1.08 || 1;
    const step = max > 600 ? 200 : max > 300 ? 100 : max > 120 ? 50 : 20;
    const x = (i) => L + (i / (n - 1)) * (Wd - L - R);
    const y = (v) => T + (1 - v / max) * (Ht - T - B);
    const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = s('g', { class: 'grid' });
    const axis = s('g', { class: 'axis' });
    for (let v = 0; v <= max; v += step) { grid.append(s('line', { x1: L, x2: Wd - R, y1: y(v), y2: y(v) })); axis.append(s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v))); }
    [0, Math.round((n - 1) / 2), n - 1].forEach((i) => axis.append(s('text', { x: x(i), y: Ht - 8, 'text-anchor': 'middle' }, `day ${i + 1}`)));
    const area = s('path', { class: 'a1', d: `${path(a)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z` });
    const lineA = s('path', { class: 's1', d: path(a) });
    const lineB = s('path', { class: 's2', d: path(b) });
    const endA = s('circle', { class: 'd1', cx: x(n - 1), cy: y(a[n - 1]), r: 4 });
    const endB = s('circle', { class: 'd2', cx: x(n - 1), cy: y(b[n - 1]), r: 4 });
    const cross = s('line', { class: 'cross', y1: T, y2: Ht - B, visibility: 'hidden' });
    const svg = s('svg', { class: 'g-chart', viewBox: `0 0 ${Wd} ${Ht}`, role: 'img', 'aria-label': `Reviews per day over ${n} days: you at ${perDay} new cards a day versus 50 a day` }, grid, axis, area, lineB, lineA, cross, endB, endA);
    const tip = h('div', { class: 'g-tip', hidden: true });
    svg.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * Wd;
      const i = clamp(Math.round(((px - L) / (Wd - L - R)) * (n - 1)), 0, n - 1);
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.style.left = `${(x(i) / Wd) * 100}%`; tip.style.top = `${(y(Math.max(a[i], b[i])) / Ht) * 100}%`;
      tip.replaceChildren(h('b', {}, `Day ${i + 1}`), h('br'), `You: ${fmt(a[i])} reviews`, h('br'), `50 a day: ${fmt(b[i])} reviews`);
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    return h('div', {}, h('div', { class: 'g-legend' }, h('span', {}, `You (${perDay} new a day)`), h('span', { class: 'k2' }, '50 new a day')), h('div', { class: 'g-chart-wrap' }, svg, tip));
  }
  el.append(
    range({ label: 'New cards a day', min: 1, max: 60, value: perDay, onInput: (v) => { perDay = v; $('.g-widget-title', el).textContent = `What ${v} new card${v === 1 ? '' : 's'} a day turns into`; draw(); } }),
    range({ label: 'Retention (cards you pass)', min: 75, max: 95, value: retention, unit: '%', onInput: (v) => { retention = v; draw(); } }),
    range({ label: 'Days', min: 30, max: 365, step: 5, value: days, onInput: (v) => { days = v; draw(); } }),
    chartBox, stats, verdict,
    h('details', { class: 'g-table-toggle' }, h('summary', {}, 'Show as a table'), h('table', { class: 'g-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Week'), h('th', { class: 'num' }, 'You'), h('th', { class: 'num' }, '50 a day'))), tbody)),
    h('p', { class: 'g-widget-note' }, 'A simple model: pass a card and its gap grows (1, 3, 7, 15, 30… days); fail it and it starts over. Real Anki/FSRS schedules differ, but the shape is the same: reviews grow with every new card you add.'));
  draw();
};

// Mine it or skip it?
W.mine = (el) => {
  widgetFrame(el, 'Mine it or skip it?', 'Game');
  const words = [
    ['力', 'ちから', 'strength, power', 180, 'Hunter × Hunter: “What makes you think one kid’s 力 is enough?”'],
    ['気持ち', 'きもち', 'feeling', 340, 'A slice-of-life anime, every other episode'],
    ['幼稚園', 'ようちえん', 'preschool', 3800, 'Overheard at an onsen front desk (ask me how I know)'],
    ['ぼったくり', 'ぼったくり', 'rip-off', 14500, 'A variety show about tourist traps'],
    ['遺伝子治療', 'いでんしちりょう', 'gene therapy', 28000, 'The Japanese dub of a medical drama'],
    ['戸惑う', 'とまどう', 'to be bewildered', 5600, 'A light novel, three times in one chapter'],
    ['凪', 'なぎ', 'a lull, dead calm at sea', 21000, 'A novel’s opening line. Also my favorite kanji.'],
    ['魑魅魍魎', 'ちみもうりょう', 'evil spirits of the hills and rivers', 62000, 'One line in a yokai manga'],
  ];
  const limits = { beginner: 10000, intermediate: 20000, advanced: 40000 };
  let stage = 'beginner', i = 0, score = 0, played = 0;
  const card = h('div', { class: 'g-mine-card', 'aria-live': 'polite' });
  const verdict = h('p', { class: 'g-verdict' });
  verdict.hidden = true;
  const scoreEl = h('p', { class: 'g-mine-score' });
  const show = () => {
    const [w, r, m, rank, ctx] = words[i % words.length];
    card.replaceChildren(
      h('span', { class: 'g-mine-meta' }, `Card ${(i % words.length) + 1} of ${words.length}`),
      h('span', { class: 'g-mine-word', lang: 'ja' }, w),
      h('span', { class: 'g-mine-meta', lang: 'ja' }, r, h('span', { lang: 'en' }, ` · ${m}`)),
      h('span', { class: 'g-mine-ctx' }, 'Seen in: ', ctx),
      h('span', { class: 'g-mine-meta' }, 'Frequency rank: ', h('span', { class: 'g-mine-freq' }, `#${fmt(rank)}`)),
      h('span', { class: 'g-mine-bar' }, h('span', { style: `width:${clamp((Math.log10(rank) / Math.log10(80000)) * 100, 2, 100)}%` })));
    verdict.hidden = true;
  };
  const answer = (mine) => {
    const [w, , , rank] = words[i % words.length];
    const should = rank <= limits[stage];
    const ok = mine === should;
    played++; if (ok) score++;
    verdict.hidden = false;
    verdict.className = `g-verdict ${ok ? 'is-good' : 'is-warn'}`;
    const why = rank <= 1000 ? 'It’s one of the most common words in the language. Mine it every time.'
      : should ? `At #${fmt(rank)} it’s inside the ${stage} range (top ${fmt(limits[stage])}). Worth a card.`
        : `At #${fmt(rank)} it’s outside the ${stage} range (top ${fmt(limits[stage])}). Skip it, or mark it known so it stops bugging you. Exception: if it keeps showing up in YOUR content, or it’ll stick anyway, a card doesn’t hurt.`;
    verdict.textContent = `${ok ? 'Good call. ' : 'I’d go the other way. '}${why}`;
    scoreEl.textContent = `${score} / ${played} matched my call`;
    i++;
    setTimeout(show, 2600);
  };
  el.append(seg([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']], stage, (v) => { stage = v; }, 'Your level'),
    h('div', { style: 'height:12px' }), card,
    h('div', { class: 'g-btn-row', style: 'margin-top:12px' },
      h('button', { type: 'button', class: 'g-btn g-btn-primary', onclick: () => answer(true) }, '⛏ Mine it'),
      h('button', { type: 'button', class: 'g-btn', onclick: () => answer(false) }, 'Skip')),
    verdict, scoreEl);
  show();
};

// How 70–100% comprehension feels
W.gibberish = (el) => {
  widgetFrame(el, 'What does 80% comprehension feel like?', 'Slider');
  const text = 'You live and work in Tokyo. Every morning you squeeze onto the same crowded train, holding your bag against your chest like a shield. At the office you move papers from one desk to another and pretend it matters. Tonight you finally leave late, buy a warm can of coffee from the vending machine, and walk home through the quiet streets. Then your phone buzzes. It is a message from your sister: “Don’t go home. They are waiting inside.” You stop under a flickering streetlight and slowly turn around.';
  const words = text.split(/(\s+)/);
  const content = words.map((w, i) => ({ w, i })).filter(({ w }) => /[A-Za-z]{4,}/.test(w) && !/^(your|from|with|that|they|then|like|home|have|this|every|same|move)$/i.test(w.replace(/[^A-Za-z]/g, '')));
  // Fixed order so the same words go first every time
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const order = content.map((c) => ({ ...c, k: rand() })).sort((a, b) => a.k - b.k);
  const syl = ['bin', 'gle', 'loo', 'pi', 'ty', 'schn', 'oo', 'fri', 'zan', 'dor', 'muc', 'ci', 'gra', 'tune', 'flit', 'vic', 'ar', 'jup', 'al', 'wel', 'ing', 'crip', 'asc', 'en', 'dle'];
  const nonsense = (w, n) => {
    const core = w.replace(/[^A-Za-z]/g, '');
    let out = '';
    for (let j = 0; out.length < Math.max(4, core.length - 1); j++) out += syl[(n * 7 + j * 3 + core.length) % syl.length];
    if (/^[A-Z]/.test(core)) out = out[0].toUpperCase() + out.slice(1);
    return w.replace(core, out);
  };
  const box = h('p', { class: 'g-gib-text' });
  const info = h('p', { class: 'g-verdict', 'aria-live': 'polite' });
  const draw = (pct) => {
    const nUnknown = Math.round(((100 - pct) / 100) * words.filter((w) => /\S/.test(w)).length);
    const set = new Set(order.slice(0, nUnknown).map((o) => o.i));
    box.replaceChildren(...words.map((w, i) => (set.has(i) ? h('span', { class: 'w-x' }, nonsense(w, i)) : w)));
    info.className = `g-verdict ${pct >= 85 ? 'is-good' : pct >= 70 ? '' : 'is-warn'}`;
    info.textContent = pct >= 95 ? `${set.size} unknown words. You barely notice them; you could read this all day. Comfy, but you won’t grow much.`
      : pct >= 80 ? `${set.size} unknown words. You can still follow the story and guess most of them from context. This is the sweet spot.`
        : pct >= 70 ? `${set.size} unknown words. Still enjoyable if you’re into it, but expect lookups. My minimum.`
          : `${set.size} unknown words. Now imagine opening a dictionary for every one. This is how burnout starts.`;
  };
  el.append(range({ label: 'Comprehension', min: 50, max: 100, value: 80, unit: '%', onInput: draw }), box, info);
  draw(80);
};

// 精読 · 速読 · 多読 — the reading car
W.car = (el) => {
  widgetFrame(el, 'Build the reading car', 'Toy');
  const on = { sei: false, soku: false, ta: false };
  const svg = s('svg', { viewBox: '0 0 120 56', 'aria-hidden': 'true' },
    s('path', { class: 'part body', d: 'M8 36 L14 22 L40 20 L54 8 L84 8 L98 22 L114 26 L114 38 L8 38 Z' }),
    s('rect', { class: 'part engine', x: 96, y: 24, width: 16, height: 10 }),
    s('rect', { class: 'part tank', x: 12, y: 26, width: 12, height: 8 }),
    s('g', { class: 'wheel' }, s('circle', { class: 'part wheels', cx: 30, cy: 42, r: 9 }), s('line', { x1: 21, y1: 42, x2: 39, y2: 42, stroke: 'currentColor' })),
    s('g', { class: 'wheel' }, s('circle', { class: 'part wheels', cx: 92, cy: 42, r: 9 }), s('line', { x1: 83, y1: 42, x2: 101, y2: 42, stroke: 'currentColor' })));
  const car = h('div', { class: 'g-car' }, svg);
  const odo = h('span', { class: 'g-car-odo' }, '0 km');
  const stage = h('div', { class: 'g-car-stage' }, car, h('span', { class: 'g-car-road' }), odo);
  const msg = h('p', { class: 'g-verdict', 'aria-live': 'polite' });
  const parts = [
    ['sei', '精読', 'Seidoku · the engine', 'Slow, careful reading: look things up, parse the grammar, mine.', 'engine'],
    ['soku', '速読', 'Sokudoku · top speed', 'Reading at a set pace so you react instead of translating.', 'wheels'],
    ['ta', '多読', 'Tadoku · the mileage', 'Reading a lot, minimal lookups, keep the flow.', 'tank'],
  ];
  const btns = parts.map(([k, kj, name, desc, part]) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: (e) => { on[k] = !on[k]; e.currentTarget.setAttribute('aria-pressed', String(on[k])); $$(`.${part}`, svg).forEach((p) => p.classList.toggle('on', on[k])); paint(); } },
    h('span', { class: 'k', lang: 'ja' }, kj), h('strong', {}, name), h('span', { class: 'd' }, desc)));
  let timer = null;
  const paint = () => {
    const all = on.sei && on.soku && on.ta;
    car.classList.toggle('go', all && !reduced);
    clearInterval(timer);
    if (all) { let km = 0; timer = setInterval(() => { km += 37; odo.textContent = `${fmt(km)} km`; if (km > 2200) clearInterval(timer); }, 50); }
    msg.textContent = all ? 'Engine, top speed and mileage: now reading just gets easier. Not overnight, but it gets easier.'
      : on.ta && !on.sei ? 'Tadoku with no engine: if you only know 1 word in 3, that’s not extensive reading, that’s surviving an apocalypse of the unknown.'
        : on.sei && !on.soku && !on.ta ? 'All engine: very accurate, very slow. You understand every particle and finish one page an hour.'
          : on.soku && !on.sei ? 'Top speed with no engine: skimming. Fast, but you’re guessing.'
            : on.sei && on.soku ? 'Engine and speed: you read accurately at a decent clip. Now go put miles on it.'
              : on.sei && on.ta ? 'Engine and mileage: good, but you’re still translating in your head. Add some speed.'
                : 'Tap the parts. Learning to read isn’t picking one method; it’s cycling through all three.';
    msg.className = `g-verdict ${all ? 'is-good' : ''}`;
  };
  el.append(stage, h('div', { class: 'g-car-parts' }, btns), msg);
  paint();
};

// Games I tested: characters per hour vs comprehension
W.games = (el) => {
  widgetFrame(el, 'Nine games, one hour each, all in Japanese', 'Data');
  // [game, chars/hour (thousands), comprehension %, words mined, fun out of 4, genre]
  const data = [
    ['Angel Beats!', 26, 96, 46, 4, 'Visual novel'], ['Higurashi', 24, 95, 30, 3, 'Visual novel'], ['Cyberpunk 2077', 21, 94, 20, 4, 'Open world'],
    ['Persona 4 Golden', 21, 93, 22, 4, 'JRPG'], ['Like a Dragon (Yakuza)', 21, 88, 44, 4, 'Action RPG'], ['Final Fantasy XV', 17.7, 95, 15, 4, 'Open world'],
    ['Until Dawn', 17, 96, 14, 3, 'Interactive movie'], ['DayZ', 12.8, 88, 44, 1, 'Survival'], ['Resident Evil 3', 9, 93, 16, 3, 'Action horror'],
  ];
  const Wd = 640, Ht = 300, L = 44, R = 20, T = 16, B = 40;
  const x = (v) => L + ((v - 6) / (28 - 6)) * (Wd - L - R);
  const y = (v) => T + (1 - (v - 86) / (98 - 86)) * (Ht - T - B);
  const grid = s('g', { class: 'grid' }), axis = s('g', { class: 'axis' });
  for (let v = 86; v <= 98; v += 4) { grid.append(s('line', { x1: L, x2: Wd - R, y1: y(v), y2: y(v) })); axis.append(s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, `${v}%`)); }
  for (let v = 10; v <= 25; v += 5) axis.append(s('text', { x: x(v), y: Ht - B + 18, 'text-anchor': 'middle' }, `${v}k`));
  axis.append(s('text', { x: (L + Wd - R) / 2, y: Ht - 4, 'text-anchor': 'middle' }, 'characters of Japanese per hour of play →'));
  const tip = h('div', { class: 'g-tip', hidden: true });
  const dots = s('g', {});
  const labelled = new Set(['Angel Beats!', 'Resident Evil 3', 'DayZ', 'Persona 4 Golden', 'Like a Dragon (Yakuza)']);
  data.sort((a, b) => b[3] - a[3]).forEach(([name, cph, comp, mined, fun, genre]) => {
    const r = 4 + Math.sqrt(mined) * 1.6;
    const c = s('circle', { class: 'd1', cx: x(cph), cy: y(comp), r, 'fill-opacity': '0.85', tabindex: 0, 'aria-label': `${name}: ${cph}k characters an hour, ${comp}% comprehension, ${mined} words mined, fun ${fun} out of 4` });
    const show = () => { tip.hidden = false; tip.style.left = `${(x(cph) / Wd) * 100}%`; tip.style.top = `${((y(comp) - r) / Ht) * 100}%`; tip.replaceChildren(h('b', {}, name), h('br'), `${genre} · ${cph}k chars/hr`, h('br'), `${comp}% understood · ${mined} words mined`, h('br'), `Fun: ${'★'.repeat(fun)}${'☆'.repeat(4 - fun)}`); };
    c.addEventListener('pointerenter', show); c.addEventListener('focus', show);
    c.addEventListener('pointerleave', () => { tip.hidden = true; }); c.addEventListener('blur', () => { tip.hidden = true; });
    dots.append(c);
    if (labelled.has(name)) {
      const right = cph < 22;
      dots.append(s('text', { class: name === 'Persona 4 Golden' ? 'lbl-strong' : 'lbl', x: x(cph) + (right ? r + 6 : -r - 6), y: y(comp) + 4, 'text-anchor': right ? 'start' : 'end' }, name === 'Like a Dragon (Yakuza)' ? 'Yakuza' : name));
    }
  });
  const svg = s('svg', { class: 'g-chart', viewBox: `0 0 ${Wd} ${Ht}`, role: 'img', 'aria-label': 'Scatter plot of nine games by characters per hour and comprehension; bubble size is words mined' }, grid, axis, dots);
  const rows = data.slice().sort((a, b) => b[1] - a[1]).map(([n, c, p, m, f, g]) => h('tr', {}, h('td', {}, n), h('td', {}, g), h('td', { class: 'num' }, `${c}k`), h('td', { class: 'num' }, `${p}%`), h('td', { class: 'num' }, m), h('td', { class: 'num' }, `${f}/4`)));
  el.append(h('p', { class: 'g-widget-note', style: 'margin:0 0 6px' }, 'Bigger bubble = more new words mined in that hour. Hover or tap a bubble.'),
    h('div', { class: 'g-chart-wrap' }, svg, tip),
    h('details', { class: 'g-table-toggle' }, h('summary', {}, 'Show as a table'), h('table', { class: 'g-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Game'), h('th', {}, 'Type'), h('th', { class: 'num' }, 'Chars/hr'), h('th', { class: 'num' }, 'Understood'), h('th', { class: 'num' }, 'Mined'), h('th', { class: 'num' }, 'Fun'))), h('tbody', {}, rows))));
};

// かける: one word, ten meanings
W.kakeru = (el) => {
  widgetFrame(el, 'Is かける “to hang”? To wear? To call?', 'Tap a meaning');
  const leaves = [
    ['hang', '壁に絵を掛ける', 'hang a picture on the wall'], ['wear (glasses)', '眼鏡をかける', 'put on glasses'], ['call', '友達に電話をかける', 'call a friend'],
    ['pour on', 'ご飯に醤油をかける', 'pour soy sauce on rice'], ['spend', '時間をかけて読む', 'take your time reading'], ['lock', '鍵をかける', 'lock the door'],
    ['sit', '椅子に腰掛ける', 'sit down on a chair'], ['multiply', '二に三を掛ける', 'multiply 2 by 3'], ['run', '廊下を駆ける', 'run down the hallway'], ['bet', '人生を賭ける', 'bet your life on it'],
  ];
  // On phones the web is drawn on a tighter canvas so the labels stay readable
  const small = el.clientWidth < 520;
  const Wd = small ? 400 : 560, Ht = small ? 440 : 380, cx = Wd / 2, cy = Ht / 2;
  const rx = small ? 140 : 205, ry = small ? 180 : 148, fs = small ? 15 : 13;
  const svg = s('svg', { class: 'g-web', viewBox: `0 0 ${Wd} ${Ht}`, role: 'group', 'aria-label': 'Meanings of kakeru' });
  const out = h('div', { class: 'g-web-out', 'aria-live': 'polite' }, h('span', { class: 'en' }, 'English needs ten words for one Japanese verb. That’s your sign to start learning Japanese in Japanese.'));
  leaves.forEach(([en, jp, gl], i) => {
    const a = (i / leaves.length) * Math.PI * 2 - Math.PI / 2;
    const lx = cx + Math.cos(a) * rx, ly = cy + Math.sin(a) * ry;
    svg.append(s('line', { class: 'spoke', x1: cx, y1: cy, x2: lx, y2: ly, style: `transition-delay:${i * 60}ms` }));
    const g = s('g', { class: 'leaf', tabindex: 0, role: 'button', 'aria-label': en });
    const w = en.length * fs * 0.57 + 20;
    g.append(s('rect', { x: lx - w / 2, y: ly - fs - 2, width: w, height: fs * 2 + 4 }), s('text', { x: lx, y: ly, style: `font-size:${fs}px` }, en));
    const pick = () => { $$('.leaf', svg).forEach((x) => x.classList.toggle('is-on', x === g)); out.replaceChildren(h('span', { class: 'jp', lang: 'ja' }, jp), h('span', { class: 'en' }, gl)); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    svg.append(g);
  });
  svg.append(s('g', { class: 'hub' }, s('circle', { cx, cy, r: small ? 40 : 46 }), s('text', { x: cx, y: cy, lang: 'ja' }, 'かける')));
  el.append(svg, out);
  watch(svg);
};

// Close your eyes and picture it
W.picture = (el) => {
  widgetFrame(el, 'Don’t translate it. Picture it.', 'Try it');
  const scene = h('div', { class: 'g-pic-scene hidden', 'aria-hidden': 'true' }, '🐕 💥 🦵');
  const msg = h('p', { class: 'g-widget-note', 'aria-live': 'polite' }, 'Read the sentence once, then hit the button and picture the scene before it appears.');
  const btn = h('button', { type: 'button', class: 'g-btn g-btn-primary', onclick: () => {
    btn.disabled = true;
    let n = 3;
    msg.textContent = 'Eyes closed… 3';
    const t = setInterval(() => { n--; if (n > 0) msg.textContent = `Eyes closed… ${n}`; else { clearInterval(t); scene.classList.remove('hidden'); msg.textContent = 'Was that roughly what you saw? That’s the Japanese → picture path. No English stop in the middle.'; btn.disabled = false; } }, 900);
  } }, 'Close your eyes (3 s)');
  el.append(h('p', { class: 'g-br-sent', lang: 'ja' }, '犬に足を噛まれた。'), scene, h('div', { class: 'g-btn-row' }, btn, h('button', { type: 'button', class: 'g-btn', onclick: () => { scene.classList.add('hidden'); msg.textContent = 'Read it again, then try.'; } }, 'Reset')), msg);
};

// Pitch accent patterns
W.pitch = (el) => {
  widgetFrame(el, 'See the pitch', 'Pitch accent');
  // [word, kana morae, accent (0 = heiban), meaning]
  const words = [['桜', ['さ', 'く', 'ら'], 0, 'cherry blossom'], ['箸', ['は', 'し'], 1, 'chopsticks'], ['橋', ['は', 'し'], 2, 'bridge'], ['端', ['は', 'し'], 0, 'edge'],
    ['雨', ['あ', 'め'], 1, 'rain'], ['飴', ['あ', 'め'], 0, 'candy'], ['おにぎり', ['お', 'に', 'ぎ', 'り'], 2, 'rice ball'], ['花', ['は', 'な'], 2, 'flower'], ['後悔', ['こ', 'う', 'か', 'い'], 1, 'regret'], ['公開', ['こ', 'う', 'か', 'い'], 0, 'publishing (a video)']];
  const svgBox = h('div', {});
  const name = h('p', { class: 'g-pitch-name', 'aria-live': 'polite' });
  const draw = (idx) => {
    const [w, morae, acc, mean] = words[idx];
    const all = [...morae, 'が'];
    const n = morae.length;
    const high = all.map((_, i) => {
      if (acc === 0) return i > 0;
      if (acc === 1) return i === 0;
      return i > 0 && i < acc;
    });
    const step = 64, Wd = all.length * step + 20, top = 30, low = 90;
    const pts = all.map((_, i) => [20 + i * step + step / 2 - 10, high[i] ? top : low]);
    const svg = s('svg', { class: 'g-pitch-svg', viewBox: `0 0 ${Wd} 150`, role: 'img', 'aria-label': `${w}: ${all.map((m, i) => `${m} ${high[i] ? 'high' : 'low'}`).join(', ')}` },
      s('text', { class: 'hl', x: 4, y: top + 4 }, 'H'), s('text', { class: 'hl', x: 4, y: low + 4 }, 'L'),
      s('path', { class: 'pl', d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('') }),
      ...pts.map(([x, y], i) => s('circle', { class: `pd${i === n ? ' particle' : ''}`, cx: x, cy: y, r: 6 })),
      ...all.map((m, i) => s('text', { class: `mora${i === n ? ' particle' : ''}`, x: pts[i][0], y: 136 }, m)));
    if (!reduced) { const p = $('.pl', svg); const len = 400; p.style.strokeDasharray = len; p.style.strokeDashoffset = len; requestAnimationFrame(() => { p.style.transition = 'stroke-dashoffset .9s ease'; p.style.strokeDashoffset = 0; }); }
    svgBox.replaceChildren(svg);
    const type = acc === 0 ? ['平板', 'heiban', 'starts low, rises, and stays up, even on the particle'] : acc === 1 ? ['頭高', 'atamadaka', 'starts high and drops right after the first mora'] : acc === n ? ['尾高', 'odaka', 'rises and stays up to the end of the word, then drops on the particle'] : ['中高', 'nakadaka', 'rises, then drops somewhere in the middle'];
    name.replaceChildren(h('b', { lang: 'ja' }, `${w}（${morae.join('')}）`), ` ${mean} · `, h('b', { lang: 'ja' }, type[0]), ` ${type[1]}: ${type[2]}.`);
  };
  const picker = h('div', { class: 'g-btn-row', role: 'group', 'aria-label': 'Words' });
  words.forEach(([w, m], i) => picker.append(h('button', { type: 'button', class: 'g-btn', lang: 'ja', onclick: (e) => { $$('button', picker).forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); draw(i); } }, w)));
  el.append(picker, svgBox, name, h('p', { class: 'g-widget-note' }, 'Two rules that never break: the first two morae always differ in pitch, and once the pitch drops inside a word it doesn’t come back up. The hollow dot is the particle が.'));
  picker.firstChild.classList.add('is-on');
  draw(0);
};

// Keep the conversation going (aizuchi simulator)
W.convo = (el) => {
  widgetFrame(el, 'Keep the conversation alive', 'Simulator');
  const script = [
    { them: ['先週、沖縄に行ってきたんですよ。', 'I went to Okinawa last week.'], choices: [
      ['(say nothing and wait for your turn)', -2, 'In English that’s polite listening. In Japanese, silence reads as “I’m not interested.”'],
      ['へぇ〜！いいですね！', 2, 'Aizuchi. Tiny reactions that say “I’m with you.”'],
      ['沖縄ですか！', 2, 'Parroting: repeat the key word with a rising tone. Confirms you understood and invites more.'],
      ['話変わるけど、寿司好きですか？', -3, 'A bridge with no runway. They just told you about their trip!']] },
    { them: ['海がすごくきれいで、サーターアンダギーも食べました。', 'The sea was beautiful, and I ate sata andagi too.'], choices: [
      ['うんうん', 1, 'Fine aizuchi, keeps things moving.'],
      ['サーターアンダギー？', 3, 'Perfect parrot. Now they get to explain the thing they’re excited about.'],
      ['Oh, like a donut?', -1, 'Switching to English mid-conversation kills the vibe. Try あの、ドーナツみたいなやつですか？']] },
    { them: ['そうそう、揚げたお菓子です！めっちゃ美味しかった〜', 'Yes! It’s a fried sweet. So good.'], choices: [
      ['えーと…あ、甘いやつですよね？', 2, 'Filler buys you thinking time. Japanese speakers use it constantly. Business-class rules about cutting “um” don’t apply here.'],
      ['……', -2, 'Dead air. Even an えー is better than nothing.'],
      ['いいなぁ、俺も食べたい！', 2, 'A real reaction. You’re not reciting, you’re talking.']] },
    { them: ['ジャレッドさんは最近どこか行きました？', 'Have you been anywhere lately, Jared?'], choices: [
      ['いいえ。', -2, 'Technically correct, conversationally fatal.'],
      ['あ、そういえば名古屋に行きました！味噌カツやばかったです', 3, 'そういえば is a smooth bridge, and now there’s a whole new topic (and food) to talk about.'],
      ['沖縄の海には勝てないっすね…完敗です', 3, 'Gesture maxing. Be a little funny. A foreigner joking in Japanese gets a laugh almost every time.']] },
  ];
  let step = 0, vibe = 5;
  const chat = h('div', { class: 'g-chat', 'aria-live': 'polite' });
  const choices = h('div', { class: 'g-chat-choices' });
  const meter = h('span', {});
  const say = (cls, jp, en) => { chat.append(h('div', { class: `g-msg ${cls}` }, h('span', { class: 'jp', lang: 'ja' }, jp), en ? h('span', { class: 'en' }, en) : null)); chat.scrollTop = chat.scrollHeight; };
  const note = (t) => { chat.append(h('div', { class: 'g-msg note' }, t)); chat.scrollTop = chat.scrollHeight; };
  const paint = () => { meter.style.width = `${clamp(vibe, 0, 10) * 10}%`; };
  const next = () => {
    choices.replaceChildren();
    if (step >= script.length) {
      note(vibe >= 12 ? 'Vibe: immaculate. They ask for your LINE. This is the whole point: conversations are for connecting, not for being grammatically perfect.' : vibe >= 7 ? 'Solid conversation. A couple of awkward beats, but they enjoyed talking to you.' : 'Rough one. That’s fine. Everyone has these, and they make great stories later. Try again?');
      choices.append(h('button', { type: 'button', class: 'g-btn', onclick: () => { step = 0; vibe = 5; chat.replaceChildren(); paint(); next(); } }, 'Try again'));
      return;
    }
    const st = script[step];
    say('them', ...st.them);
    st.choices.forEach(([text, pts, why]) => choices.append(h('button', { type: 'button', class: 'g-btn', lang: /[ぁ-んァ-ン一-龯]/.test(text) ? 'ja' : 'en', onclick: () => {
      say('you', text);
      vibe += pts;
      paint();
      note(`${pts > 0 ? '＋' : '−'} ${why}`);
      step++;
      setTimeout(next, 700);
    } }, text)));
  };
  el.append(h('div', { class: 'g-vibe' }, h('span', {}, 'Vibe'), h('span', { class: 'g-vibe-bar' }, meter)), chat, choices);
  paint();
  next();
};

// Flip cards
W.flips = (el) => { $$('.g-flip', el).forEach((b) => b.addEventListener('click', () => { b.classList.toggle('is-flipped'); b.setAttribute('aria-pressed', String(b.classList.contains('is-flipped'))); })); };

// Tabs (used for manga by level)
W.tabs = (el) => {
  const panels = $$('[data-tab]', el);
  const bar = seg(panels.map((p) => [p.dataset.tab, p.dataset.label || p.dataset.tab]), panels[0].dataset.tab, (v) => panels.forEach((p) => { p.hidden = p.dataset.tab !== v; $$('li', p).forEach((li, i) => { li.style.setProperty('--i', i); li.style.animation = 'none'; void li.offsetWidth; li.style.animation = ''; }); }), 'Level');
  bar.setAttribute('role', 'tablist');
  el.prepend(bar);
  panels.forEach((p, i) => { p.hidden = i > 0; });
};

// Am I chasing a number?
W.chasing = (el) => {
  widgetFrame(el, 'Am I chasing a number?', 'Self-check');
  const qs = ['I added more new cards than usual because a YouTuber said 100/day.', 'I stayed up past my bedtime doing reviews I didn’t enjoy.', 'I picked a show because it’s “optimal”, not because I want to watch it.', 'I felt guilty for playing a game in English.', 'I compared my progress to someone who got “fluent in 8 months”.', 'I can’t remember the last time Japanese was fun.'];
  const verdict = h('p', { class: 'g-verdict', 'aria-live': 'polite' });
  const list = h('ul', { class: 'g-checks' });
  const upd = () => {
    const n = $$('input:checked', list).length;
    verdict.className = `g-verdict ${n >= 4 ? 'is-bad' : n >= 2 ? 'is-warn' : 'is-good'}`;
    verdict.textContent = n >= 4 ? 'You’re chasing numbers. Put the phone down, go to bed, and tomorrow do one hour of something you actually enjoy in Japanese. That’s it.'
      : n >= 2 ? 'Some warning signs. Cut new cards in half for a week and pick content you’d watch even if it weren’t Japanese.'
        : 'You’re free-flowing. Keep doing what you’re doing.';
  };
  qs.forEach((q) => list.append(h('li', {}, h('label', {}, h('input', { type: 'checkbox', onchange: upd }), h('span', {}, q)))));
  el.append(h('p', { class: 'g-widget-note', style: 'margin-top:0' }, 'Tick what happened this week.'), list, verdict);
  upd();
};

// Do it scared
W.scared = (el) => {
  widgetFrame(el, 'The confidence test', 'Decide');
  const out = h('p', { class: 'g-verdict', 'aria-live': 'polite' }, 'There’s a Japanese person at the next table reading Hunter × Hunter. If you were the most confident person in the world, would you go say hi?');
  el.append(out, h('div', { class: 'g-btn-row', style: 'margin-top:12px' },
    h('button', { type: 'button', class: 'g-btn g-btn-primary', onclick: () => { out.className = 'g-verdict is-good'; out.textContent = 'Then go do it, even though you’re terrified. 「ハンターハンター、日本語で読んでるんですか？」 and let whatever happens happen.'; } }, 'Yes'),
    h('button', { type: 'button', class: 'g-btn', onclick: () => { out.className = 'g-verdict'; out.textContent = 'Fair. Not every moment is the moment. But be honest: was that “no” you, or the nerves talking?'; } }, 'No')));
};

// Quick yes / no quiz
W.quiz = (el) => {
  const items = JSON.parse(el.dataset.items);
  widgetFrame(el, el.dataset.title || 'Quick quiz', 'Quiz');
  let i = 0, right = 0;
  const q = h('p', { class: 'g-quiz-q', 'aria-live': 'polite' });
  const count = h('p', { class: 'g-quiz-count' });
  const verdict = h('p', { class: 'g-verdict' });
  verdict.hidden = true;
  const btns = h('div', { class: 'g-btn-row' });
  const show = () => {
    if (i >= items.length) { q.textContent = `${right} out of ${items.length}. ${right === items.length ? 'You get it.' : 'Close enough. Go immerse.'}`; btns.replaceChildren(h('button', { type: 'button', class: 'g-btn', onclick: () => { i = 0; right = 0; verdict.hidden = true; show(); } }, 'Again')); count.textContent = ''; return; }
    q.textContent = items[i][0];
    count.textContent = `${i + 1} / ${items.length}`;
    btns.replaceChildren(...(el.dataset.answers || 'Yes|No').split('|').map((label, k) => h('button', { type: 'button', class: 'g-btn', onclick: () => {
      const ok = (k === 0) === items[i][1];
      if (ok) right++;
      verdict.hidden = false;
      verdict.className = `g-verdict ${ok ? 'is-good' : 'is-warn'}`;
      verdict.textContent = `${ok ? 'Right. ' : 'Not quite. '}${items[i][2]}`;
      i++;
      btns.replaceChildren(h('button', { type: 'button', class: 'g-btn g-btn-primary', onclick: () => { verdict.hidden = true; show(); } }, 'Next'));
    } }, label)));
  };
  el.append(count, q, btns, verdict);
  show();
};

// The roadmap checklist
W.stages = (el) => {
  el.classList.add('g-widget');
  $$('[data-stage]', el).forEach((st) => {
    const items = $$('li', st);
    const counter = h('span', {});
    const head = h('p', { class: 'g-stage-h' }, st.dataset.stage, counter);
    st.before(head);
    const upd = () => { counter.textContent = `${items.filter((li) => store.checks[li.dataset.id]).length} / ${items.length}`; };
    items.forEach((li) => {
      const id = li.dataset.id;
      const input = h('input', { type: 'checkbox' });
      input.checked = Boolean(store.checks[id]);
      input.addEventListener('change', () => { store.checks[id] = input.checked; save(); upd(); });
      const span = h('span', {});
      span.append(...li.childNodes);
      li.replaceChildren(h('label', {}, input, span));
    });
    upd();
  });
};

$$('[data-widget]').forEach((el) => {
  const fn = W[el.dataset.widget];
  if (!fn) { console.warn('Unknown widget', el.dataset.widget); return; }
  try { fn(el); } catch (err) { console.error('Widget failed', el.dataset.widget, err); }
});
