// =====================================================================
// app.js — Kanji Trainer
//
// Dashboard (sets, practice options, progress grid, stats, backups) and the
// review screen (multiple choice, typed readings, handwriting, new-item
// intros). All text from data or user lists is inserted as text, never HTML.
// =====================================================================

import * as D from './data.js?v=2';
import * as S from './storage.js?v=3';
import * as R from './srs.js?v=1';
import { toHiragana, finalize } from './romaji.js?v=1';
import { WritingPad, strokeAnimation, gradeWriting } from './writing.js?v=2';
import { parseFile, parseText } from './importer.js?v=1';
import { requestPersistence, backupStatus, describeBackup, storageWorks, readFileText } from '../study-backup.js';

const $ = (id) => document.getElementById(id);
const store = S.load();
S.flushOnHide(store);
const settings = store.settings;

let selChars = [];          // kanji in the current selection that we have data for
let selSet = new Set();
let persisted = false;
let gridExpanded = false;

// ---------------------------------------------------------------- DOM helper
function h(tag, attrs, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach((c) => {
    if (c === null || c === undefined || c === false || c === '') return;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return n;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const shortMeaning = (m) => (m || '').split(/;\s*/).slice(0, 2).join('; ');
const fmt = new Intl.NumberFormat('en');

// ---------------------------------------------------------------- toasts
function toast(text, kind = '') {
  const t = h('div', { class: `kj-toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  $('toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

let saveWarned = false;
function warnSaveFailed() {
  if (saveWarned) return;
  saveWarned = true;
  toast('Progress can\'t be saved in this browser (private mode or storage full). Export it to keep it.', 'error');
}
window.addEventListener('study-save-failed', warnSaveFailed);
if (!storageWorks()) setTimeout(warnSaveFailed, 800);

// ---------------------------------------------------------------- selection
function validSelection() {
  const ids = settings.selection.filter((id) => !id.startsWith('custom:') || store.custom.some((l) => `custom:${l.id}` === id));
  return ids;
}

async function refreshSelection() {
  settings.selection = validSelection();
  const raw = D.selectionChars(settings.selection, store.custom);
  await D.ensureChars(raw);
  selChars = raw.filter(D.known);
  selSet = new Set(selChars);
}

const skills = () => R.skillsFor(settings);
const kKey = (c) => `k:${c}`;

function wordKeysInSelection() {
  return Object.keys(store.cards).filter((k) => k.startsWith('w:') && store.cards[k].d &&
    [...k.slice(2)].some((c) => selSet.has(c)));
}

// ---------------------------------------------------------------- dashboard
function renderSets() {
  const box = $('set-picker');
  box.replaceChildren();
  const meta = D.builtinGroups();
  for (const group of meta) {
    const chips = h('div', { class: 'kj-chips' });
    for (const s of group.sets) {
      const n = [...D.setChars(s.id)].length;
      chips.append(setChip(s.id, s.label, n, s.sub));
    }
    box.append(h('div', { class: 'kj-set-group' },
      h('p', { class: 'kj-set-title' }, group.title),
      chips,
      group.note ? h('p', { class: 'kj-set-note' }, group.note) : null));
  }
  const custom = $('custom-sets');
  custom.replaceChildren(...store.custom.map((l) => {
    const chip = setChip(`custom:${l.id}`, l.name, [...l.chars].length);
    chip.append(h('span', {
      class: 'kj-chip-x', role: 'button', tabindex: '0', 'aria-label': `Delete list ${l.name}`,
      onclick: (e) => { e.stopPropagation(); deleteList(l.id); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteList(l.id); } },
    }, '×'));
    return chip;
  }));
}

function setChip(id, label, count, sub) {
  const on = settings.selection.includes(id);
  return h('button', {
    class: `kj-chip${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
    onclick: () => toggleSet(id),
  }, label, sub ? h('span', { class: 'kj-chip-sub', lang: 'ja' }, sub) : null, h('span', { class: 'kj-chip-count' }, fmt.format(count)));
}

async function toggleSet(id) {
  const i = settings.selection.indexOf(id);
  if (i >= 0) settings.selection.splice(i, 1);
  else settings.selection.push(id);
  S.save(store);
  await refreshSelection();
  renderSets();
  renderDashboard();
}

function deleteList(id) {
  const list = store.custom.find((l) => l.id === id);
  if (!list || !confirm(`Delete the list "${list.name}"? Your progress on its kanji is kept.`)) return;
  store.custom = store.custom.filter((l) => l.id !== id);
  settings.selection = settings.selection.filter((s) => s !== `custom:${id}`);
  S.save(store, { now: true });
  refreshSelection().then(() => { renderSets(); renderDashboard(); });
}

function renderOptions() {
  document.querySelectorAll('.kj-seg').forEach((seg) => {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(settings[key] === b.dataset.value));
    });
  });
  document.querySelectorAll('[data-question]').forEach((c) => { c.checked = !!settings.questions[c.dataset.question]; });
  $('opt-new').value = settings.newPerDay;
  $('opt-size').value = String(settings.sessionSize);
  $('opt-auto').checked = settings.autoAdvance;
  $('opt-writing-level').hidden = !settings.questions.writing;
  $('stroke-check-note').textContent = {
    lenient: 'Rough shapes pass. Wrong direction or order is pointed out but still counts.',
    standard: 'Shape and placement need to be close. Wrong direction or order counts as a miss.',
    strict: 'Tighter placement and proportions. Wrong direction or order counts as a miss.',
  }[settings.strokeCheck] || '';
  $('writing-level-note').textContent = {
    trace: 'The outline is shown. Draw over it in the right order.',
    guided: 'A blank square. After a miss, the next stroke is shown.',
    memory: 'No outline, and hints only after two misses.',
  }[settings.writingLevel];
}

function renderDashboard() {
  renderContinue();
  renderSummary();
  renderGrid();
  renderTrouble();
  renderStats();
  renderBackup();
}

function renderSummary() {
  const el = $('selection-summary');
  if (!settings.selection.length) { el.textContent = 'Nothing selected yet. Pick a list above.'; return; }
  const names = settings.selection.map((id) => D.setLabel(id, store.custom)).join(' + ');
  const noStrokes = settings.questions.writing ? selChars.filter((c) => !D.info(c).hasStrokes).length : 0;
  el.textContent = `${names}: ${fmt.format(selChars.length)} kanji` +
    (noStrokes ? ` (${noStrokes} without stroke data, skipped for writing)` : '') + '.';
}

function renderContinue() {
  const line = $('continue-line');
  const sub = $('continue-sub');
  const has = selChars.length > 0;
  $('btn-start').disabled = !has;
  $('btn-practice').disabled = !has;
  if (!has) {
    line.textContent = 'Choose what to study below.';
    sub.textContent = '';
    return;
  }
  const sk = skills();
  const allowance = Math.max(0, settings.newPerDay - R.newToday(store));
  if (settings.itemType === 'words') {
    const due = R.dueCount(store, wordKeysInSelection(), sk);
    line.textContent = due ? `${due} word review${due === 1 ? '' : 's'} due.` : 'No word reviews due.';
    sub.textContent = `Up to ${allowance} new words today, taken from your selected kanji.`;
    return;
  }
  const keys = selChars.map(kKey);
  const due = R.dueCount(store, keys, sk);
  const fresh = Math.min(allowance, keys.filter((k) => R.isNew(store, k)).length);
  line.textContent = due ? `${due} review${due === 1 ? '' : 's'} due.` : (fresh ? 'Ready for new kanji.' : 'All caught up.');
  sub.textContent = `${fresh} new kanji ready today · ${fmt.format(selChars.length)} in your selection.`;
}

function renderGrid() {
  const grid = $('mastery-grid');
  const sk = skills();
  const LIMIT = 360;
  const shown = gridExpanded ? selChars : selChars.slice(0, LIMIT);
  grid.replaceChildren(...shown.map((c) => h('button', {
    class: `kj-cell m${R.mastery(store, kKey(c), sk)}`, lang: 'ja',
    title: shortMeaning(D.info(c).meaning), onclick: () => openDetail(c),
  }, c)));
  const more = $('btn-grid-more');
  more.hidden = selChars.length <= LIMIT;
  more.textContent = gridExpanded ? 'Show fewer' : `Show all ${fmt.format(selChars.length)}`;
}

function renderTrouble() {
  const box = $('trouble');
  const items = Object.entries(store.misses)
    .filter(([k, n]) => n > 0 && (k.startsWith('w:') || selSet.has(k.slice(2))))
    .sort((a, b) => b[1] - a[1]).slice(0, 16);
  if (!items.length) {
    box.replaceChildren(h('p', { class: 'kj-empty' }, 'Nothing yet. The kanji and words you miss most will collect here.'));
    return;
  }
  box.replaceChildren(
    h('div', { class: 'kj-trouble' }, items.map(([k, n]) => h('button', {
      class: 'kj-trouble-item', lang: 'ja',
      onclick: () => (k.startsWith('k:') ? openDetail(k.slice(2)) : openDetail([...k.slice(2)].find(D.isKanji))),
    }, k.slice(2), h('span', { class: 'kj-trouble-n' }, `×${n}`)))),
    h('button', { class: 'btn-link', onclick: () => startSession('practice', items.map(([k]) => k)) }, 'Drill these ', h('span', { class: 'arrow' }, '→')));
}

function streakDays() {
  const days = new Set(store.global.sessionDates);
  let n = 0;
  const d = new Date();
  if (!days.has(R.today(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(R.today(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderStats() {
  const g = store.global;
  const started = Object.keys(store.cards).filter((k) => k.startsWith('k:'));
  const words = Object.keys(store.cards).filter((k) => k.startsWith('w:'));
  const mastered = started.filter((k) => R.mastery(store, k, ['meaning', 'reading']) === 4).length;
  const mins = Math.round(g.studyTimeMs / 60000);
  const stats = [
    [fmt.format(g.reviewCount), 'reviews'],
    [fmt.format(g.dailyCounts[R.today()] || 0), 'today'],
    [g.reviewCount ? `${Math.round((g.totalCorrect / g.reviewCount) * 100)}%` : '—', 'accuracy'],
    [fmt.format(started.length), 'kanji started'],
    [fmt.format(mastered), 'kanji mastered'],
    [fmt.format(words.length), 'words started'],
    [`${streakDays()}d`, 'day streak'],
    [mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`, 'study time'],
  ];
  $('stats').replaceChildren(...stats.map(([v, l]) => h('div', { class: 'kj-stat' }, h('p', { class: 'kj-stat-v' }, v), h('p', { class: 'kj-stat-l' }, l))));
}

function renderBackup() {
  const g = store.global;
  const { text, nudge } = backupStatus({ lastExportAt: g.lastExportAt, reviewsSince: g.reviewCount - (g.reviewsAtExport || 0), persisted });
  const el = $('backup-status');
  el.textContent = nudge ? `${text} Time for a backup: export your progress.` : text;
  el.classList.toggle('is-nudge', nudge);
}

if (navigator.storage && navigator.storage.persisted) {
  navigator.storage.persisted().then((p) => { persisted = p; renderBackup(); }).catch(() => {});
}

// ---------------------------------------------------------------- options wiring
document.querySelectorAll('.kj-seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[seg.dataset.setting] = b.dataset.value;
    S.save(store);
    renderOptions();
    renderDashboard();
  });
});
document.querySelectorAll('[data-question]').forEach((c) => {
  c.addEventListener('change', () => {
    settings.questions[c.dataset.question] = c.checked;
    if (!Object.values(settings.questions).some(Boolean)) {
      settings.questions[c.dataset.question] = true;
      c.checked = true;
      toast('Keep at least one question type on.');
    }
    S.save(store);
    renderOptions();
    renderDashboard();
  });
});
$('opt-new').addEventListener('change', (e) => {
  settings.newPerDay = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
  e.target.value = settings.newPerDay;
  S.save(store);
  renderContinue();
});
$('opt-size').addEventListener('change', (e) => { settings.sessionSize = parseInt(e.target.value, 10) || 20; S.save(store); });
$('opt-auto').addEventListener('change', (e) => { settings.autoAdvance = e.target.checked; S.save(store); });
$('btn-grid-more').addEventListener('click', () => { gridExpanded = !gridExpanded; renderGrid(); });

// ---------------------------------------------------------------- word pool
// Data for a word key: [word, reading, meaning]
function wordData(key) {
  const c = store.cards[key];
  return (c && c.d) || pendingWords.get(key) || null;
}
const pendingWords = new Map();

async function findWord(word) {
  const first = [...word].find(D.isKanji);
  if (!first) return null;
  const det = await D.detail(first);
  return det.w.find((w) => w[0] === word) || null;
}

// New words: from custom lists first, then common words of the selected
// kanji (kanji you've already started first)
async function newWordCandidates(limit) {
  const out = [];
  const taken = new Set(Object.keys(store.cards).filter((k) => k.startsWith('w:')));
  const add = (w) => {
    const key = `w:${w[0]}`;
    if (taken.has(key) || !w[1] || !w[2] || out.length >= limit) return;
    taken.add(key);
    pendingWords.set(key, [w[0], w[1], w[2]]);
    out.push(key);
  };
  for (const id of settings.selection.filter((s) => s.startsWith('custom:'))) {
    const list = store.custom.find((l) => `custom:${l.id}` === id);
    for (const w of (list && list.words) || []) {
      if (out.length >= limit) break;
      if (!w[1] || !w[2]) {
        const found = await findWord(w[0]);
        if (found) add([w[0], w[1] || found[1], w[2] || found[2]]);
      } else add(w);
    }
  }
  const started = selChars.filter((c) => store.cards[kKey(c)]);
  const order = [...started, ...selChars.filter((c) => !store.cards[kKey(c)])].slice(0, 80);
  for (const c of order) {
    if (out.length >= limit) break;
    const det = await D.detail(c);
    let perChar = 0;
    for (const w of det.w) {
      if (perChar >= 2 || out.length >= limit) break;
      if (w[3] >= 2 && [...w[0]].length <= 4) { const before = out.length; add(w); if (out.length > before) perChar++; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- session
let session = null;

async function startSession(mode, keysOverride) {
  if (!selChars.length && !keysOverride) { toast('Pick a list to study first.'); return; }
  const sk = skills();
  let queue;
  if (keysOverride) {
    queue = R.practiceQueue(store, keysOverride, sk, Math.max(settings.sessionSize, keysOverride.length));
  } else if (settings.itemType === 'words') {
    const allowance = Math.max(0, settings.newPerDay - R.newToday(store));
    const known = wordKeysInSelection();
    const fresh = mode === 'smart' ? await newWordCandidates(allowance) : [];
    if (mode === 'smart') {
      queue = R.smartQueue(store, known, sk, { size: settings.sessionSize, newAllowance: allowance, newKeys: fresh });
    } else {
      const pool = known.length >= 8 ? known : [...known, ...(await newWordCandidates(20))];
      queue = R.practiceQueue(store, pool, sk, settings.sessionSize);
    }
  } else {
    const keys = selChars.map(kKey);
    const allowance = Math.max(0, settings.newPerDay - R.newToday(store));
    queue = mode === 'smart'
      ? R.smartQueue(store, keys, sk, { size: settings.sessionSize, newAllowance: allowance, newKeys: keys.filter((k) => R.isNew(store, k)) })
      : R.practiceQueue(store, keys, sk, settings.sessionSize);
  }
  // Writing needs stroke data
  queue = queue.filter((q) => q.skill !== 'writing' || q.key.startsWith('w:') || D.info(q.key.slice(2)).hasStrokes);
  if (!queue.length) {
    toast(mode === 'smart' ? 'Nothing due right now. Try Extra practice, or raise New per day.' : 'Nothing to practice in this selection yet.');
    return;
  }
  // Download every card's stroke/word file in the background, in order.
  // Cards never wait on it: the kanji, meaning and readings come from the
  // index, and strokes/words fill in when they arrive.
  D.prefetch(queue.flatMap((q) => charsFor(q.key)));

  session = {
    mode, queue, i: 0, right: 0, wrong: 0, answered: 0,
    introduced: new Set(), retries: new Map(), missed: new Set(),
    startedAt: Date.now(), keysOverride,
  };
  $('hud-mode').textContent = keysOverride ? 'Drill' : (mode === 'smart' ? 'Review' : 'Practice');
  show('view-review');
  next();
}

function updateHud() {
  const s = session;
  $('hud-count').textContent = `${Math.min(s.i + 1, s.queue.length)} / ${s.queue.length}`;
  $('hud-acc').textContent = s.answered ? `${Math.round((s.right / s.answered) * 100)}%` : '— %';
  $('session-bar').style.width = `${(s.i / s.queue.length) * 100}%`;
}

let pad = null;
let current = null;   // { q, type, ... }

function clearCard() {
  if (pad) pad = null;
  ['q-label', 'q-sub', 'feedback'].forEach((id) => { $(id).textContent = ''; });
  $('q-prompt').replaceChildren();
  $('q-prompt').className = 'kj-prompt';
  $('q-body').replaceChildren();
  $('after').hidden = true;
  $('after').replaceChildren();
  $('feedback').className = 'kj-feedback';
}

async function next() {
  const s = session;
  if (!s) return;
  if (s.i >= s.queue.length) { finish(); return; }
  updateHud();
  clearCard();
  const q = s.queue[s.i];
  if (q.isNew && !s.introduced.has(q.key)) { await showIntro(q); return; }
  await ask(q);
}

// ---------------------------------------------------------------- intro
async function showIntro(q) {
  current = { q, type: 'intro' };
  const isWord = q.key.startsWith('w:');
  const zone = $('q-body');
  $('q-label').textContent = isWord ? 'New word' : 'New kanji';
  if (isWord) {
    const [word, reading, meaning] = wordData(q.key);
    $('q-prompt').textContent = word;
    $('q-sub').textContent = `${reading} · ${meaning}`;
    const parts = [...word].filter(D.isKanji).map((c) => {
      const inf = D.info(c);
      return inf ? h('li', null, h('span', { lang: 'ja', class: 'kj-mini-char' }, c), ` ${shortMeaning(inf.meaning)}`) : null;
    });
    zone.append(h('ul', { class: 'kj-intro-parts' }, parts));
  } else {
    const c = q.key.slice(2);
    const inf = D.info(c);
    // Everything from the index shows at once; stroke order and words
    // fill in when the kanji's file arrives (usually already prefetched)
    $('q-prompt').textContent = c;
    $('q-sub').textContent = shortMeaning(inf.meaning);
    const anim = h('div', { class: 'kj-intro-anim' });
    const info = h('div', { class: 'kj-intro-info' }, readingsBlock(inf));
    zone.append(h('div', { class: 'kj-intro' }, inf.hasStrokes ? anim : null, info));
    D.detail(c).then((det) => {
      if (!current || current.q !== q || current.type !== 'intro') return;
      if (det.s.length) strokeAnimation(anim, det.s, { strokeMs: 320 });
      const words = wordsList(det.w.slice(0, 3));
      if (words) info.append(words);
    });
  }
  const btn = h('button', { class: 'btn btn-primary', onclick: () => {
    R.markIntroduced(store, q.key, q.key.startsWith('w:') ? wordData(q.key) : null);
    session.introduced.add(q.key);
    S.save(store);
    clearCard();
    ask(q);
  } }, 'Got it');
  zone.append(h('div', { class: 'kj-actions' }, btn));
  btn.focus();
}

function readingsBlock(inf) {
  return h('dl', { class: 'kj-readings' },
    inf.on.length ? [h('dt', null, 'On'), h('dd', { lang: 'ja' }, inf.on.join('、'))] : null,
    inf.kun.length ? [h('dt', null, 'Kun'), h('dd', { lang: 'ja' }, inf.kun.map(kunNode).reduce((acc, n, i) => (i ? [...acc, '、', n] : [n]), []))] : null);
}

function kunNode(r) {
  const { stem, okuri } = D.splitKun(r);
  return h('span', { class: 'kj-kun' }, stem, okuri ? h('span', { class: 'kj-okuri' }, okuri) : null);
}

function wordsList(words) {
  if (!words.length) return null;
  return h('ul', { class: 'kj-words' }, words.map((w) => h('li', null,
    h('span', { class: 'kj-word', lang: 'ja' }, w[0]), h('span', { class: 'kj-word-r', lang: 'ja' }, w[1]), h('span', { class: 'kj-word-m' }, w[2]))));
}

// ---------------------------------------------------------------- questions
function questionTypes(skill) {
  const q = settings.questions;
  if (skill === 'meaning') return [q.meaning && 'meaning', q.reverse && 'reverse'].filter(Boolean);
  if (skill === 'reading') return [q.reading && 'reading', q.typed && 'typed'].filter(Boolean);
  return ['writing'];
}

function similarChars(c, n) {
  const inf = D.info(c);
  const out = [];
  const seen = new Set([c]);
  const push = (x) => { if (!seen.has(x) && D.info(x) && out.length < n) { seen.add(x); out.push(x); } };
  D.lookalikes(c).forEach(push);
  const pool = selChars.length >= 12 ? selChars : D.selectionChars(['joyo']);
  const near = shuffle(pool.filter((x) => Math.abs(D.info(x).strokes - inf.strokes) <= 3));
  near.forEach(push);
  shuffle([...pool]).forEach(push);
  return out;
}

async function wordPool(word) {
  const words = [];
  for (const c of new Set([...word].filter(D.isKanji))) {
    const det = await D.detail(c);
    words.push(...det.w);
  }
  session.queue.forEach((q) => { if (q.key.startsWith('w:')) { const d = wordData(q.key); if (d) words.push(d); } });
  const seen = new Set([word]);
  return shuffle(words.filter((w) => { if (seen.has(w[0])) return false; seen.add(w[0]); return true; }));
}

// Shows a small "Loading…" only if the data takes more than a moment
function loading(promise) {
  const body = $('q-body');
  const t = setTimeout(() => {
    if (!body.children.length) body.append(h('p', { class: 'kj-loading' }, 'Loading…'));
  }, 250);
  return promise.finally(() => {
    clearTimeout(t);
    const l = body.querySelector('.kj-loading');
    if (l) l.remove();
  });
}

// The card may have moved on (End, skip) while data was loading
const stillAsking = (q) => session && current && current.q === q;

// Kanji whose files a queue item needs (the kanji itself, or a word's kanji)
function charsFor(key) {
  return key.startsWith('k:') ? [key.slice(2)] : [...key.slice(2)].filter(D.isKanji);
}

async function ask(q) {
  const isWord = q.key.startsWith('w:');
  const types = questionTypes(q.skill);
  const type = types[Math.floor(Math.random() * types.length)];
  current = { q, type, answered: false };
  if (isWord) await askWord(q, type);
  else await askKanji(q, type);
}

async function askKanji(q, type) {
  const c = q.key.slice(2);
  const inf = D.info(c);
  const prompt = $('q-prompt');

  if (type === 'meaning') {
    $('q-label').textContent = 'What does this kanji mean?';
    prompt.textContent = c;
    const correct = shortMeaning(inf.meaning);
    const others = [];
    for (const x of similarChars(c, 12)) {
      const m = shortMeaning(D.info(x).meaning);
      if (m && m !== correct && !others.includes(m)) others.push(m);
      if (others.length >= 3) break;
    }
    choices(correct, others, (t) => h('span', null, t));
  } else if (type === 'reading') {
    const readings = [...inf.on.map((r) => ({ r, kind: 'on' })), ...inf.kun.map((r) => ({ r, kind: 'kun' }))];
    if (!readings.length) { skip(); return; }
    const target = Math.random() < 0.7 ? readings[0] : readings[Math.floor(Math.random() * readings.length)];
    const mine = D.acceptedReadings(inf);
    const others = [];
    for (const x of similarChars(c, 20)) {
      const xi = D.info(x);
      const pool = target.kind === 'on' ? xi.on : xi.kun;
      for (const r of pool) {
        const norm = target.kind === 'on' ? D.kataToHira(r) : D.splitKun(r).stem + D.splitKun(r).okuri;
        if (!mine.has(norm) && !others.includes(r)) { others.push(r); break; }
      }
      if (others.length >= 3) break;
    }
    $('q-label').textContent = target.kind === 'on' ? 'Which is its on\'yomi?' : 'Which is its kun\'yomi?';
    prompt.textContent = c;
    choices(target.r, others, (r) => (target.kind === 'kun' ? kunNode(r) : h('span', { lang: 'ja' }, r)), true);
  } else if (type === 'reverse') {
    $('q-label').textContent = 'Which kanji means…';
    prompt.textContent = shortMeaning(inf.meaning);
    prompt.classList.add('is-text');
    choices(c, similarChars(c, 3), (x) => h('span', { lang: 'ja', class: 'kj-choice-kanji' }, x));
  } else if (type === 'typed') {
    $('q-label').textContent = 'Type a reading (on or kun)';
    prompt.textContent = c;
    typedInput(D.acceptedReadings(inf));
  } else if (type === 'writing') {
    $('q-label').textContent = 'Write the kanji for…';
    prompt.textContent = shortMeaning(inf.meaning);
    prompt.classList.add('is-text');
    $('q-sub').textContent = [inf.on[0], inf.kun[0] && inf.kun[0].replace('.', '')].filter(Boolean).join(' · ');
    const det = await loading(D.detail(c));
    if (!stillAsking(q)) return;
    writing([c], [det.s]);
  }
}

async function askWord(q, type) {
  const data = wordData(q.key);
  if (!data) { skip(); return; }
  const [word, reading, meaning] = data;
  const prompt = $('q-prompt');
  if ((type === 'reading' || type === 'typed') && !reading) { skip(); return; }
  if ((type === 'meaning' || type === 'reverse') && !meaning) { skip(); return; }

  if (type === 'meaning') {
    $('q-label').textContent = 'What does this word mean?';
    prompt.textContent = word;
    const pool0 = await loading(wordPool(word));
    if (!stillAsking(q)) return;
    const others = pool0.map((w) => w[2]).filter((m) => m && m !== meaning);
    choices(meaning, [...new Set(others)].slice(0, 3), (t) => h('span', null, t));
  } else if (type === 'reading') {
    $('q-label').textContent = 'How is this word read?';
    prompt.textContent = word;
    const len = [...reading].length;
    const pool = (await loading(wordPool(word))).filter((w) => w[1] && w[1] !== reading);
    if (!stillAsking(q)) return;
    pool.sort((a, b) => Math.abs([...a[1]].length - len) - Math.abs([...b[1]].length - len));
    choices(reading, [...new Set(pool.map((w) => w[1]))].slice(0, 3), (r) => h('span', { lang: 'ja' }, r), true);
  } else if (type === 'reverse') {
    $('q-label').textContent = 'Which word means…';
    prompt.textContent = meaning;
    prompt.classList.add('is-text');
    const others = (await loading(wordPool(word))).map((w) => w[0]).filter((w) => w !== word);
    if (!stillAsking(q)) return;
    choices(word, [...new Set(others)].slice(0, 3), (w) => h('span', { lang: 'ja', class: 'kj-choice-word' }, w));
  } else if (type === 'typed') {
    $('q-label').textContent = 'Type the reading';
    prompt.textContent = word;
    typedInput(new Set([D.kataToHira(reading)]));
  } else if (type === 'writing') {
    const kanji = [...word].filter(D.isKanji);
    $('q-label').textContent = 'Write the word for…';
    prompt.textContent = meaning;
    prompt.classList.add('is-text');
    $('q-sub').textContent = reading;
    const dets = await loading(Promise.all(kanji.map((c) => D.detail(c))));
    if (!stillAsking(q)) return;
    if (dets.some((d) => !d.s.length)) { skip(); return; }
    writing([...word], dets.map((d) => d.s));
  }
}

// Question can't be asked (missing data): move on without grading
function skip() {
  session.queue.splice(session.i, 1);
  next();
}

// ---------------------------------------------------------------- multiple choice
function choices(correct, others, render, isReading = false) {
  const opts = shuffle([correct, ...others.slice(0, 3)]);
  const list = h('div', { class: `kj-choices${isReading ? ' is-reading' : ''}` });
  opts.forEach((o, i) => {
    list.append(h('button', {
      class: 'kj-choice', 'data-key': String(i + 1), 'data-correct': String(o === correct),
      onclick: (e) => pick(e.currentTarget, o === correct),
    }, h('span', { class: 'kj-choice-n' }, String(i + 1)), render(o)));
  });
  $('q-body').append(list);
  current.choiceList = list;
}

function pick(btn, ok) {
  if (current.answered) return;
  current.answered = true;
  const list = current.choiceList;
  list.querySelectorAll('.kj-choice').forEach((b) => { b.disabled = true; });
  btn.classList.add(ok ? 'is-right' : 'is-wrong');
  if (!ok) {
    // highlight the right answer
    [...list.children].forEach((b) => { if (b.dataset.correct === 'true') b.classList.add('is-right'); });
  }
  settle(ok ? 'good' : 'again');
}

// ---------------------------------------------------------------- typed
function typedInput(accepted) {
  const form = h('form', { class: 'kj-typed', autocomplete: 'off' });
  const input = h('input', {
    type: 'text', class: 'kj-typed-input', lang: 'ja', autocapitalize: 'off', autocorrect: 'off',
    spellcheck: 'false', placeholder: 'reading…', 'aria-label': 'Type the reading',
  });
  // Convert romaji as you type, but never while a Japanese keyboard is still
  // composing a character (rewriting the value then garbles the input)
  let composing = false;
  const convert = () => {
    const conv = toHiragana(input.value);
    if (conv !== input.value) input.value = conv;
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; convert(); });
  input.addEventListener('input', (e) => { if (!composing && !e.isComposing) convert(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (current.answered) { advance(); return; }
    const val = D.kataToHira(finalize(input.value.trim())).replace(/\s/g, '');
    if (!val) return;
    input.value = val;
    const ok = accepted.has(val);
    input.readOnly = true;
    form.classList.add(ok ? 'is-right' : 'is-wrong');
    current.answered = true;
    settle(ok ? 'good' : 'again');
  });
  form.append(input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Check'));
  $('q-body').append(form);
  setTimeout(() => input.focus(), 30);
}

// ---------------------------------------------------------------- writing
function writing(chars, strokeSets) {
  const body = $('q-body');
  const slots = h('div', { class: 'kj-word-slots', lang: 'ja' });
  const holder = h('div', { class: 'kj-pad-holder' });
  const tools = h('div', { class: 'kj-pad-tools' },
    h('button', { class: 'btn-link', onclick: () => pad && pad.showHint(true) }, 'Hint'),
    h('button', { class: 'btn-link', onclick: () => pad && pad.reveal() }, 'Show me'));
  if (chars.length > 1) body.append(slots);
  body.append(holder, tools);

  const kanjiIdx = chars.map((c, i) => (D.isKanji(c) ? i : -1)).filter((i) => i >= 0);
  let k = 0;
  let totalMisses = 0;
  let totalSlips = 0;
  let revealed = false;
  const drawSlots = () => {
    slots.replaceChildren(...chars.map((c, i) => h('span', {
      class: `kj-slot${i === kanjiIdx[k] ? ' is-current' : ''}${!D.isKanji(c) || kanjiIdx.indexOf(i) < k ? ' is-done' : ''}`,
    }, !D.isKanji(c) || kanjiIdx.indexOf(i) < k ? c : '　')));
  };
  const loadNext = () => {
    drawSlots();
    pad = new WritingPad(holder, {
      level: settings.writingLevel,
      checking: settings.strokeCheck,
      onFeedback: (msg, kind) => {
        const f = $('feedback');
        f.textContent = msg;
        f.className = `kj-feedback${kind === 'miss' ? ' is-miss' : kind === 'note' ? ' is-hard' : ''}`;
      },
      onDone: (r) => {
        totalMisses += r.misses;
        totalSlips += r.slips || 0;
        revealed = revealed || r.revealed;
        k++;
        if (k < kanjiIdx.length) { setTimeout(loadNext, 350); return; }
        drawSlots();
        tools.hidden = true;
        holder.classList.add('is-done');   // shrink the finished drawing so Continue fits on screen
        current.answered = true;
        settle(gradeWriting({ misses: totalMisses, revealed }), { misses: totalMisses, revealed, slips: totalSlips });
      },
    });
    pad.load(strokeSets[k]);
  };
  loadNext();
}

// ---------------------------------------------------------------- grading
function settle(result, extra = {}) {
  const s = session;
  const q = current.q;
  R.grade(store, q.key, q.skill, result);
  s.answered++;
  if (result === 'again') {
    s.wrong++;
    s.missed.add(q.key);
    const tries = s.retries.get(`${q.key}|${q.skill}`) || 0;
    if (tries < 2) {
      s.retries.set(`${q.key}|${q.skill}`, tries + 1);
      s.queue.splice(Math.min(s.queue.length, s.i + 3), 0, { key: q.key, skill: q.skill, isNew: false });
    }
  } else {
    s.right++;
    if (store.misses[q.key] && result === 'good') store.misses[q.key] = Math.max(0, store.misses[q.key] - 1);
  }
  S.save(store);
  updateHud();

  const f = $('feedback');
  if (current.type === 'writing') {
    f.textContent = extra.revealed ? 'Shown. You\'ll see it again soon.'
      : result === 'good' && extra.slips ? `Counted, with ${extra.slips} direction/order slip${extra.slips === 1 ? '' : 's'}.`
      : result === 'good' ? 'Clean. Every stroke right.'
      : result === 'hard' ? `Done, with ${extra.misses} miss${extra.misses === 1 ? '' : 'es'}.`
      : 'Keep practicing this one.';
  } else {
    f.textContent = result === 'good' ? 'Right.' : 'Not quite.';
  }
  f.className = `kj-feedback ${result === 'good' ? 'is-ok' : result === 'hard' ? 'is-hard' : 'is-miss'}`;
  showAfter(q);
  if (result === 'good' && settings.autoAdvance) {
    // Writing: only a clean kanji moves on by itself, after a moment to see it
    const clean = current.type !== 'writing' || (!extra.misses && !extra.slips);
    if (clean) current.autoTimer = setTimeout(advance, current.type === 'writing' ? 1500 : 900);
  }
}

function showAfter(q) {
  const after = $('after');
  after.replaceChildren();
  if (q.key.startsWith('w:')) {
    const [word, reading, meaning] = wordData(q.key);
    after.append(h('p', { class: 'kj-after-main' }, h('span', { lang: 'ja', class: 'kj-after-char' }, word),
      h('span', { lang: 'ja' }, reading), h('span', null, meaning)));
  } else {
    const c = q.key.slice(2);
    const inf = D.info(c);
    // After writing, the meaning is already on screen above the pad
    const meaningLine = current.type === 'writing' ? null : h('p', { class: 'kj-after-meaning' }, shortMeaning(inf.meaning));
    after.append(h('div', { class: 'kj-after-main' },
      h('button', { class: 'kj-after-char', lang: 'ja', title: 'Details', onclick: () => openDetail(c) }, c),
      h('div', null, meaningLine, readingsBlock(inf))));
  }
  const btn = h('button', { class: 'btn btn-primary', onclick: advance }, 'Continue');
  after.append(h('div', { class: 'kj-actions' }, btn, h('span', { class: 'kj-hint-key' }, 'Enter')));
  after.hidden = false;
  if (!(current.type === 'typed')) btn.focus({ preventScroll: true });
  // If the card is still taller than the screen, bring Continue into view
  // (so there's no scrolling, and no tap spent stopping a scroll)
  requestAnimationFrame(() => requestAnimationFrame(() => btn.scrollIntoView({ block: 'nearest' })));
}

function advance() {
  if (!session || !current || (!current.answered && current.type !== 'intro')) return;
  clearTimeout(current.autoTimer);
  session.i++;
  next();
}

function finish() {
  const s = session;
  const ms = Date.now() - s.startedAt;
  store.global.studyTimeMs += Math.min(ms, 2 * 3600000);
  const d = R.today();
  if (store.global.sessionDates[store.global.sessionDates.length - 1] !== d) store.global.sessionDates.push(d);
  S.save(store, { now: true });
  if (!persisted) requestPersistence().then((p) => { persisted = p; renderBackup(); });

  const acc = s.answered ? Math.round((s.right / s.answered) * 100) : 0;
  $('summary-title').textContent = acc >= 90 ? 'Excellent.' : acc >= 70 ? 'Nice work.' : 'Good practice.';
  const body = $('summary-body');
  body.replaceChildren(
    h('div', { class: 'kj-summary-stats' },
      h('div', null, h('p', { class: 'kj-stat-v' }, String(s.answered)), h('p', { class: 'kj-stat-l' }, 'answered')),
      h('div', null, h('p', { class: 'kj-stat-v' }, `${acc}%`), h('p', { class: 'kj-stat-l' }, 'right')),
      h('div', null, h('p', { class: 'kj-stat-v' }, String(s.introduced.size)), h('p', { class: 'kj-stat-l' }, 'new'))),
    s.missed.size ? h('div', null, h('p', { class: 'kj-help' }, 'Missed this time:'),
      h('div', { class: 'kj-trouble' }, [...s.missed].map((k) => h('span', { class: 'kj-trouble-item', lang: 'ja' }, k.slice(2))))) : null);
  $('summary-overlay').hidden = false;
  $('summary-again').focus();
}

function endSession() {
  if (session && session.answered) {
    store.global.studyTimeMs += Math.min(Date.now() - session.startedAt, 2 * 3600000);
    const d = R.today();
    if (store.global.sessionDates[store.global.sessionDates.length - 1] !== d) store.global.sessionDates.push(d);
  }
  S.save(store, { now: true });
  session = null;
  current = null;
  $('summary-overlay').hidden = true;
  show('view-dashboard');
  renderDashboard();
}

$('btn-end').addEventListener('click', () => (session && session.answered ? finish() : endSession()));
$('summary-done').addEventListener('click', endSession);
$('summary-again').addEventListener('click', () => {
  const mode = session ? session.mode : 'smart';
  const keys = session && session.keysOverride;
  $('summary-overlay').hidden = true;
  session = null;
  startSession(mode, keys);
});
$('btn-start').addEventListener('click', () => startSession('smart'));
$('btn-practice').addEventListener('click', () => startSession('practice'));

// ---------------------------------------------------------------- views + viewport
const COMPACT_BELOW = 560;
function syncViewport() {
  const vv = window.visualViewport;
  const hgt = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${hgt}px`);
  document.body.classList.toggle('kj-compact', hgt < COMPACT_BELOW);
  if (document.body.classList.contains('kj-focus') && (window.scrollY !== 0 || (vv && vv.offsetTop > 0))) window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
} else window.addEventListener('resize', syncViewport);
syncViewport();

let savedScroll = 0;
function show(view) {
  const toReview = view === 'view-review';
  if (toReview) savedScroll = window.scrollY;
  $('view-dashboard').hidden = toReview;
  $('view-review').hidden = !toReview;
  document.body.classList.toggle('kj-focus', toReview);
  syncViewport();
  window.scrollTo(0, toReview ? 0 : savedScroll);
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  if (!$('detail-overlay').hidden || !$('import-overlay').hidden) {
    if (e.key === 'Escape') { closeOverlay('detail-overlay'); closeOverlay('import-overlay'); }
    return;
  }
  if (!session || $('view-review').hidden) return;
  if (!$('summary-overlay').hidden) return;
  const typing = e.target.matches && e.target.matches('input, textarea');
  if (e.key === 'Escape') { e.preventDefault(); $('btn-end').click(); return; }
  if (!current) return;
  if (current.choiceList && !current.answered && /^[1-4]$/.test(e.key)) {
    const b = current.choiceList.children[Number(e.key) - 1];
    if (b) b.click();
    return;
  }
  if (e.key === 'Enter' && !typing && current.answered) { e.preventDefault(); advance(); return; }
  if (current.type === 'writing' && !typing && pad) {
    if (e.key === 'h') pad.showHint(true);
    if (e.key === '?') pad.reveal();
  }
});

// ---------------------------------------------------------------- detail
function closeOverlay(id) {
  const o = $(id);
  if (o.hidden) return;
  o.hidden = true;
  if (id === 'detail-overlay' && detailAnim) { detailAnim.destroy(); detailAnim = null; }
}
let detailAnim = null;

async function openDetail(c) {
  const inf = D.info(c);
  if (!inf) return;
  const body = $('detail-body');
  // Open straight away; fill in once the kanji's file is loaded
  if (detailAnim) { detailAnim.destroy(); detailAnim = null; }
  body.replaceChildren(h('p', { class: 'kj-detail-char', lang: 'ja' }, c), h('p', { class: 'kj-loading' }, 'Loading…'));
  $('detail-overlay').hidden = false;
  const det = await D.detail(c);
  if ($('detail-overlay').hidden) return;
  const tags = [
    D.setChars('joyo').includes(c) ? 'Jōyō' : D.setChars('jinmeiyo').includes(c) ? 'Jinmeiyō' : null,
    inf.jlpt ? `JLPT N${inf.jlpt}` : null,
    inf.kanken ? `Kanken ${(D.KANKEN_LEVELS.find(([k]) => k === inf.kanken) || [, inf.kanken])[1]}` : null,
    `${inf.strokes} strokes`,
  ].filter(Boolean);
  const anim = h('div', { class: 'kj-detail-anim' });
  const sk = ['meaning', 'reading', 'writing'];
  const card = store.cards[kKey(c)] || {};
  const progress = sk.map((s) => {
    const st = card[s];
    let text = 'not started';
    if (st) {
      const days = Math.round((st.due - Date.now()) / 86400000);
      text = st.due <= Date.now() ? 'due now' : days <= 0 ? 'due today' : `next in ${days} day${days === 1 ? '' : 's'}`;
    }
    return h('li', null, h('span', null, s), h('span', null, text));
  });
  const looks = D.lookalikes(c).filter((x) => D.info(x));
  body.replaceChildren(...[
    h('div', { class: 'kj-detail-head' },
      h('div', null,
        h('p', { class: 'kj-detail-char', id: 'detail-char', lang: 'ja' }, c),
        h('p', { class: 'kj-detail-meaning' }, inf.meaning)),
      det.s.length ? h('div', { class: 'kj-detail-anim-wrap' }, anim,
        h('button', { class: 'btn-link', onclick: () => detailAnim && detailAnim.replay() }, 'Replay strokes')) : null),
    h('p', { class: 'kj-tags' }, tags.map((t) => h('span', { class: 'kj-tag' }, t))),
    readingsBlock(inf),
    det.w.length ? [h('p', { class: 'kj-opt-label' }, 'Common words'), wordsList(det.w)] : null,
    looks.length ? [h('p', { class: 'kj-opt-label' }, 'Looks like'),
      h('div', { class: 'kj-looks' }, looks.map((x) => h('button', { class: 'kj-trouble-item', lang: 'ja', onclick: () => openDetail(x) }, x)))] : null,
    h('p', { class: 'kj-opt-label' }, 'Your progress'),
    h('ul', { class: 'kj-progress' }, progress),
    h('div', { class: 'kj-sheet-actions' },
      h('button', { class: 'btn btn-primary', onclick: () => { closeOverlay('detail-overlay'); startSession('practice', [kKey(c)]); } }, 'Practice this kanji')),
  ].flat().filter(Boolean));
  $('detail-overlay').hidden = false;
  if (detailAnim) detailAnim.destroy();
  detailAnim = det.s.length ? strokeAnimation(anim, det.s) : null;
  $('detail-close').focus();
}
$('detail-close').addEventListener('click', () => closeOverlay('detail-overlay'));
$('detail-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay('detail-overlay'); });

// ---------------------------------------------------------------- add a list
let pendingList = null;

async function previewList(parsed) {
  await D.loadAllIndex();
  const chars = [...parsed.chars];
  const known = chars.filter(D.known);
  const unknown = chars.length - known.length;
  pendingList = { chars: known.join(''), words: parsed.words };
  const parts = [`Found ${fmt.format(known.length)} kanji`];
  if (parsed.words.length) parts.push(`${fmt.format(parsed.words.length)} words`);
  let text = parts.join(' and ') + '.';
  if (unknown) text += ` ${unknown} character${unknown === 1 ? '' : 's'} aren't in the dictionary and will be skipped.`;
  $('list-preview').textContent = known.length ? text : 'No kanji found yet.';
  $('list-save').disabled = !known.length;
}

let textTimer = null;
$('list-text').addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    $('list-file-name').textContent = '';
    previewList(parseText($('list-text').value));
  }, 250);
});
$('list-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('list-file-name').textContent = file.name;
  try {
    const parsed = await parseFile(file);
    if (!$('list-name').value) $('list-name').value = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
    await previewList(parsed);
  } catch (err) {
    $('list-preview').textContent = err.message;
    $('list-save').disabled = true;
  }
  e.target.value = '';
});
$('btn-add-list').addEventListener('click', () => {
  pendingList = null;
  $('list-name').value = '';
  $('list-text').value = '';
  $('list-file-name').textContent = '';
  $('list-preview').textContent = '';
  $('list-save').disabled = true;
  $('import-overlay').hidden = false;
  $('list-name').focus();
});
$('list-save').addEventListener('click', async () => {
  if (!pendingList) return;
  const id = Date.now().toString(36);
  const name = ($('list-name').value || '').trim() || `My list ${store.custom.length + 1}`;
  store.custom.push({ id, name, chars: pendingList.chars, words: pendingList.words.slice(0, 2000), createdAt: Date.now() });
  settings.selection.push(`custom:${id}`);
  S.save(store, { now: true });
  closeOverlay('import-overlay');
  await refreshSelection();
  renderSets();
  renderDashboard();
  toast(`Saved "${name}" and added it to your selection.`);
});
['import-close', 'list-cancel'].forEach((id) => $(id).addEventListener('click', () => closeOverlay('import-overlay')));
$('import-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay('import-overlay'); });

// ---------------------------------------------------------------- backups
$('btn-export').addEventListener('click', () => {
  S.exportJSON(store);
  renderBackup();
  toast('Backup downloaded. Keep the file somewhere safe.');
});
$('btn-import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const backup = S.parseImport(await readFileText(file));
    const current = store.global.reviewCount || 0;
    if (current > 0 && !confirm(
      `Replace your current progress (${current} reviews) with ${describeBackup(backup)}?\n\n` +
      'Tip: export your current progress first if you might want it back.')) return;
    const restored = S.commitImport(backup.store);
    Object.keys(store).forEach((k) => delete store[k]);
    Object.assign(store, restored);
    Object.assign(settings, store.settings);
    store.settings = settings;
    await refreshSelection();
    renderOptions();
    renderSets();
    renderDashboard();
    toast('Progress restored from backup.');
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'error');
  }
});
$('btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset all Kanji Trainer progress and lists? This can\'t be undone (export first if unsure).')) return;
  const fresh = S.reset();
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, fresh);
  Object.keys(settings).forEach((k) => delete settings[k]);
  Object.assign(settings, fresh.settings);
  store.settings = settings;
  await refreshSelection();
  renderOptions();
  renderSets();
  renderDashboard();
  toast('All progress reset.');
});

// ---------------------------------------------------------------- boot
(async function boot() {
  renderOptions();
  try {
    await D.loadMeta();
  } catch (err) {
    $('continue-line').textContent = 'Couldn\'t load the kanji data. Check your connection and reload.';
    console.error(err);
    return;
  }
  await refreshSelection();
  renderSets();
  renderDashboard();
  if (window.observeReveal) window.observeReveal(document.querySelector('.kj'));
})();
