// study-placement.js — "Find my level" for the Kanji and Nandoku trainers,
// plus crediting a level you already know. Everything is shown as text.
//
// The test goes level by level (easiest first), asks a few multiple-choice
// questions from each, and stops at the first level you score under 80% on.
// Nothing is saved until you press Save.
//
// Crediting never marks anything mastered. Items you answered right start
// at box 4 (a week out), the rest of a passed level at box 3 (3 days out),
// spread out so no more than ~25 come due a day. Missed items stay new.
// Placement doesn't count toward "new per day", so your pace isn't skewed.

export const SAMPLE = 15;
export const PASS = 0.8;
const DAY = 86400000;
const PER_DAY = 25;

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((k) => { if (k != null && k !== '') n.append(k instanceof Node ? k : document.createTextNode(String(k))); });
  return n;
}
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Credit items in an SRS store (Kanji/Nandoku card model). Skips anything
// already started. Returns how many were credited.
export function credit(store, { right = [], known = [], skills, isNew, now = Date.now() }) {
  const start = Object.values(store.cards).filter((c) => c && c.placedDue).reduce((m, c) => Math.max(m, c.placedDue), now);
  const offset = Math.max(0, Math.round((start - now) / DAY) - 3);   // queue after earlier placements
  let i = 0, n = 0;
  const put = (key, box, minDays) => {
    if (!isNew(key)) return;
    const days = Math.max(minDays, 1 + offset + Math.floor(i++ / PER_DAY));
    const due = now + days * DAY;
    const card = (store.cards[key] = store.cards[key] || {});
    skills.forEach((s) => { card[s] = { box, due, right: box === 4 ? 1 : 0, wrong: 0, last: now }; });
    card.added = card.added || now;
    card.placed = true;
    card.placedDue = due;
    n++;
  };
  known.forEach((k) => put(k, 3, 3));
  right.forEach((k) => put(k, 4, 7));
  return n;
}

// levels: [{ id, name, keys }] easiest first
// ask(key, pool): { prompt, promptClass, label, answer, options, optionsClass } or null to skip
// save({ passed: [{ id, name, right, known }], stoppedAt, next }) is called when the learner saves
export function runPlacement({ title, noun, levels, ask, save, nextLabel }) {
  let li = 0, qs = [], qi = 0, score = 0, answered = false;
  const results = [];
  let right = new Set();

  const body = el('div', { class: 'sp-place-body' });
  const close = el('button', { class: 'kj-close', 'aria-label': 'Close', onclick: () => done() }, '×');
  const sheet = el('div', { class: 'kj-sheet sp-place', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, close, body);
  const overlay = el('div', { class: 'kj-overlay' }, sheet);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); done(); return; }
    const b = body.querySelector(`[data-key="${e.key}"]`);
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  };
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  function done() { document.removeEventListener('keydown', onKey, true); overlay.remove(); }

  function intro() {
    body.replaceChildren(
      el('p', { class: 'eyebrow' }, 'find my level'),
      el('h2', { class: 'kj-sheet-title' }, title),
      el('p', {}, `Up to ${SAMPLE} quick questions per level, starting with ${levels[0].name}. Get ${Math.ceil(SAMPLE * PASS)} right and you move up; the test stops at the first level you don't pass.`),
      el('p', { class: 'kj-help' }, `Nothing is marked mastered: ${noun} you pass come back for quick checks over the next few weeks, so the trainer can catch anything you've forgotten. Not sure? Pick "I don't know" rather than guess.`),
      el('div', { class: 'kj-sheet-actions' },
        el('button', { class: 'btn btn-primary', onclick: startLevel }, 'Start'),
        el('button', { class: 'btn-link', onclick: done }, 'Cancel')));
    body.querySelector('.btn-primary').focus();
  }

  function startLevel() {
    const lv = levels[li];
    const pool = lv.keys;
    qs = [];
    for (const k of shuffle([...pool])) {
      if (qs.length >= SAMPLE) break;
      const q = ask(k, pool);
      if (q) qs.push({ key: k, ...q });
    }
    qi = 0; score = 0; right = new Set();
    if (!qs.length) { finishLevel(); return; }
    question();
  }

  function question() {
    const lv = levels[li];
    const q = qs[qi];
    answered = false;
    const feedback = el('p', { class: 'kj-feedback', 'aria-live': 'polite' });
    const pick = (btn, ok) => {
      if (answered) return;
      answered = true;
      if (ok) { score++; right.add(q.key); }
      body.querySelectorAll('.kj-choice').forEach((b) => {
        b.disabled = true;
        if (b.dataset.correct === 'true') b.classList.add('is-right');
      });
      if (btn && !ok) btn.classList.add('is-wrong');
      feedback.textContent = ok ? 'Right.' : `It's ${q.answer}.`;
      feedback.className = `kj-feedback ${ok ? 'is-ok' : 'is-miss'}`;
      setTimeout(() => {
        qi++;
        // Stop the level early once passing or failing is certain
        const left = qs.length - qi;
        const need = Math.ceil(qs.length * PASS);
        if (!left || score >= need || score + left < need) finishLevel(); else question();
      }, ok ? 450 : 1200);
    };
    const choices = el('div', { class: `kj-choices ${q.optionsClass || ''}` },
      q.options.map((o, i) => el('button', {
        class: 'kj-choice', 'data-key': String(i + 1), 'data-correct': String(o === q.answer),
        onclick: (e) => pick(e.currentTarget, o === q.answer),
      }, el('span', { class: 'kj-choice-n' }, String(i + 1)), el('span', { lang: q.optionsLang || null }, o))));
    body.replaceChildren(
      el('div', { class: 'sp-place-hud' },
        el('span', {}, `${lv.name}`),
        el('span', {}, `${qi + 1} / ${qs.length} · ${score} right`)),
      el('div', { class: 'sp-place-bar' }, el('span', { style: `width:${(qi / qs.length) * 100}%` })),
      el('p', { class: 'kj-qlabel' }, q.label),
      el('div', { class: `sp-place-prompt ${q.promptClass || ''}`, lang: 'ja' }, q.prompt),
      choices,
      el('button', { class: 'btn-link sp-place-skip', 'data-key': '0', onclick: () => pick(null, false) }, 'I don\'t know (0)'),
      feedback);
  }

  function finishLevel() {
    const lv = levels[li];
    const passed = qs.length > 0 && score >= Math.ceil(qs.length * PASS);
    results.push({ id: lv.id, name: lv.name, score, of: qs.length, passed, right: [...right], keys: lv.keys });
    if (passed && li + 1 < levels.length) { li++; startLevel(); return; }
    summary();
  }

  function summary() {
    const passed = results.filter((r) => r.passed);
    const stopped = results.find((r) => !r.passed) || null;
    const next = stopped ? levels.find((l) => l.id === stopped.id) : null;
    const credited = passed.reduce((n, r) => n + r.keys.length, 0) + (stopped ? stopped.right.length : 0);
    const addNext = next && nextLabel ? el('input', { type: 'checkbox', checked: true }) : null;
    body.replaceChildren(
      el('p', { class: 'eyebrow' }, 'your level'),
      el('h2', { class: 'kj-sheet-title' }, passed.length
        ? (stopped ? `You're working on ${stopped.name}.` : `You passed every level.`)
        : `Start from ${levels[0].name}.`),
      el('ul', { class: 'sp-place-results' }, results.map((r) => el('li', { class: r.passed ? 'is-pass' : '' },
        el('span', {}, r.name), el('span', {}, `${r.score} / ${r.of} · ${r.passed ? 'passed' : 'stopped here'}`)))),
      el('p', { class: 'kj-help' }, credited
        ? `Saving marks about ${credited} ${noun} as familiar (the ones you missed stay new). They come back for quick checks, about ${PER_DAY} a day, over the next few weeks.`
        : `Nothing to save: ${noun} start as new, the usual way.`),
      addNext ? el('label', { class: 'kj-toggle' }, addNext, el('span', {}, nextLabel(next))) : null,
      el('div', { class: 'kj-sheet-actions' },
        credited ? el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            save({ passed: passed.map((r) => ({ id: r.id, right: r.right, known: r.keys.filter((k) => !r.right.includes(k)) })),
              stoppedAt: stopped && { id: stopped.id, right: stopped.right }, next: addNext && addNext.checked ? next : null });
            done();
          },
        }, 'Save my level') : null,
        el('button', { class: credited ? 'btn-link' : 'btn btn-primary', onclick: () => {
          if (!credited && addNext && addNext.checked) save({ passed: [], stoppedAt: null, next });
          done();
        } }, credited ? 'Discard' : 'Close')));
  }

  intro();
}

// Up to three wrong options with a different answer text
export function options(answer, pool, textOf, n = 3) {
  const out = new Set([answer]);
  for (const k of shuffle([...pool])) {
    if (out.size > n) break;
    const t = textOf(k);
    if (t && !out.has(t)) out.add(t);
  }
  return out.size > n ? shuffle([...out]) : null;
}
