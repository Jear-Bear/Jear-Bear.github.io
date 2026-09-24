// =====================================================================
// app.js — Nandoku Trainer
//
// Rare-kanji words from 漢字でGO!: type the reading, pick the meaning
// (multiple choice, Japanese definitions), on the Kanji Trainer's spaced-
// repetition schedule, plus a Challenge run (timer, three lives, high
// scores). All text from the data is inserted as text, never HTML.
// =====================================================================

import * as D from './data.js?v=4';
import * as S from './storage.js?v=1';
import * as R from '../kanji/srs.js?v=1';
import { toHiragana, finalize } from '../kanji/romaji.js?v=1';
import { requestPersistence, backupStatus, describeBackup, storageWorks, readFileText } from '../study-backup.js';

const $ = (id) => document.getElementById(id);
const store = S.load();
S.flushOnHide(store);
const settings = store.settings;

let selIds = [];            // term ids in the selected levels
let persisted = false;
const FONT = '"Nandoku Pop"';
const ALL_LEVELS = ['01', '02', '03', '04', '05', '06', '07', '08'];

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
const fmt = new Intl.NumberFormat('en');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listText = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// The word as the game draws it: yellow runs in <span class="k">, white runs
// (okurigana, given parts) as plain text. The wiki marks the white runs; for
// other spellings, kana count as white.
const KANA = /^[\u3040-\u30ff\uff66-\uff9f]$/;
function termNodes(t) {
  if (t.segs && t.segs.length) {
    return t.segs.map((run, i) => (i % 2 ? run : run && h('span', { class: 'k' }, run))).filter(Boolean);
  }
  const out = [];
  let run = '';
  let runKanji = null;
  for (const ch of t.term) {
    if (/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(ch)) { run += ch; continue; }  // variation selector
    const k = !KANA.test(ch);
    if (runKanji !== null && k !== runKanji) { out.push(runKanji ? h('span', { class: 'k' }, run) : run); run = ''; }
    runKanji = k;
    run += ch;
  }
  if (run) out.push(runKanji ? h('span', { class: 'k' }, run) : run);
  return out;
}

// Loads the font chunks a word needs (unicode-range), without waiting forever
function warmFont(text, wait = 0) {
  if (!text || !document.fonts || !document.fonts.load) return Promise.resolve();
  const p = document.fonts.load(`48px ${FONT}`, text).catch(() => {});
  return wait ? Promise.race([p, sleep(wait)]) : p;
}

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
function refreshSelection() {
  const have = D.levelList();
  settings.levels = settings.levels.filter((l) => have.includes(l));
  if (!settings.levels.length && have.length) settings.levels = [have[0]];
  selIds = settings.levels.flatMap((l) => D.inLevel(l).map((t) => t.id));
}

function skills() {
  const q = settings.questions;
  const out = [];
  if (q.reading) out.push('reading');
  if (q.meaning) out.push('meaning');
  return out.length ? out : ['reading'];
}
const bestKey = () => [...settings.levels].sort().join('+');
const started = (ids) => ids.filter((id) => store.cards[id] && !R.isNew(store, id));

// ---------------------------------------------------------------- dashboard
function renderLevels() {
  const box = $('level-picker');
  box.replaceChildren(...D.levelList().map((lv) => h('button', {
    class: `kj-chip${settings.levels.includes(lv) ? ' is-on' : ''}`, 'aria-pressed': String(settings.levels.includes(lv)),
    onclick: () => toggleLevel(lv),
  }, D.levelName(lv), h('span', { class: 'kj-chip-count' }, fmt.format(D.levelCount(lv))))));
  const missing = ALL_LEVELS.filter((l) => !D.levelCount(l)).map(Number);
  $('level-note').textContent = [
    missing.length ? `Level${missing.length === 1 ? '' : 's'} ${listText(ranges(missing))} ${missing.length === 1 ? 'isn\'t' : 'aren\'t'} in the word list yet.` : '',
    'Levels 1–3 are partial: the fan wiki hasn\'t written all of them out yet.',
  ].filter(Boolean).join(' ');
}

// [1,2,3,4,8] -> ['1–4', '8']
function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out;
}

function toggleLevel(lv) {
  const on = settings.levels.includes(lv);
  if (on && settings.levels.length === 1) { toast('Keep at least one level on.'); return; }
  settings.levels = on ? settings.levels.filter((l) => l !== lv) : [...settings.levels, lv].sort();
  S.save(store);
  refreshSelection();
  renderLevels();
  renderDashboard();
}

function renderOptions() {
  document.querySelectorAll('[data-question]').forEach((c) => { c.checked = !!settings.questions[c.dataset.question]; });
  document.querySelectorAll('.kj-seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(settings[seg.dataset.setting]))));
  });
  $('opt-new').value = settings.newPerDay;
  $('opt-size').value = String(settings.sessionSize);
  $('opt-auto').checked = settings.autoAdvance;
}

function renderDashboard() {
  renderSummary();
  renderContinue();
  renderProgress();
  renderTrouble();
  renderStats();
  renderBackup();
}

function renderSummary() {
  const n = started(selIds).length;
  $('selection-summary').textContent = `${fmt.format(selIds.length)} words selected · ${fmt.format(n)} started.`;
}

function newAllowance() {
  return Math.max(0, settings.newPerDay - R.newToday(store));
}

function renderContinue() {
  const sk = skills();
  const due = R.dueCount(store, selIds, sk);
  const unstarted = selIds.filter((id) => R.isNew(store, id)).length;
  const fresh = Math.min(newAllowance(), unstarted);
  const line = $('continue-line');
  const sub = $('continue-sub');
  if (due || fresh) {
    line.textContent = [due ? `${fmt.format(due)} review${due === 1 ? '' : 's'} due` : '', fresh ? `${fresh} new word${fresh === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    sub.textContent = `About ${Math.max(1, Math.round(Math.min(settings.sessionSize, due + fresh * sk.length) * 0.2))} min. ${settings.levels.map(D.levelName).join(', ')}.`;
  } else {
    line.textContent = 'All caught up.';
    sub.textContent = unstarted ? 'New words unlock again tomorrow. Try a challenge run meanwhile.' : 'Every word here is started. Try a challenge run.';
  }
  $('btn-start').disabled = !(due || fresh);
  $('btn-practice').disabled = !selIds.length;
  $('btn-challenge').disabled = !selIds.length;
  const best = store.best[bestKey()];
  $('btn-challenge').firstChild.textContent = best ? `Challenge run (best ${best.score}) ` : 'Challenge run ';
}

function renderProgress() {
  const sk = skills();
  $('level-progress').replaceChildren(...D.levelList().map((lv) => {
    const ids = D.inLevel(lv).map((t) => t.id);
    const counts = [0, 0, 0, 0, 0];
    ids.forEach((id) => counts[R.mastery(store, id, sk)]++);
    const total = ids.length;
    const begun = total - counts[0];
    const best = store.best[lv];
    return h('div', { class: 'nd-level' },
      h('div', { class: 'nd-level-head' },
        h('span', { class: 'nd-level-name' }, D.levelName(lv)),
        h('span', { class: 'nd-level-nums' }, `${fmt.format(begun)} / ${fmt.format(total)} started · ${fmt.format(counts[4])} mastered${best ? ` · best run ${best.score}` : ''}`)),
      h('div', { class: 'nd-level-bar', role: 'img', 'aria-label': `${D.levelName(lv)}: ${counts[1]} learning, ${counts[2]} familiar, ${counts[3]} strong, ${counts[4]} mastered of ${total}` },
        [4, 3, 2, 1].map((m) => (counts[m] ? h('span', { class: `m${m}`, style: `flex-grow:${counts[m]}` }) : null)),
        h('span', { class: 'nd-rest', style: `flex-grow:${counts[0]}` })));
  }));
}

function renderTrouble() {
  const list = Object.entries(store.misses).filter(([id, n]) => n > 0 && D.get(id)).sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('trouble').replaceChildren(list.length
    ? h('div', { class: 'kj-trouble' }, list.map(([id, n]) => h('button', { class: 'kj-trouble-item nd-pop', lang: 'ja', onclick: () => openDetail(id) },
      D.get(id).term, h('span', { class: 'kj-trouble-n' }, `×${n}`))))
    : h('p', { class: 'kj-empty' }, 'Nothing yet. Words you miss will show up here.'));
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
  const ids = Object.keys(store.cards).filter((id) => D.get(id) && !R.isNew(store, id));
  const mastered = ids.filter((id) => R.mastery(store, id, skills()) === 4).length;
  const mins = Math.round(g.studyTimeMs / 60000);
  const best = store.best[bestKey()];
  const stats = [
    [fmt.format(g.reviewCount), 'answers'],
    [fmt.format(g.dailyCounts[R.today()] || 0), 'today'],
    [g.reviewCount ? `${Math.round((g.totalCorrect / g.reviewCount) * 100)}%` : '—', 'accuracy'],
    [fmt.format(ids.length), 'words started'],
    [fmt.format(mastered), 'words mastered'],
    [best ? String(best.score) : '—', 'best challenge'],
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
    const v = b.dataset.value;
    settings[seg.dataset.setting] = /^\d+$/.test(v) ? Number(v) : v;
    S.save(store);
    renderOptions();
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
    renderDashboard();
  });
});
$('opt-new').addEventListener('change', (e) => {
  settings.newPerDay = Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0));
  e.target.value = settings.newPerDay;
  S.save(store);
  renderContinue();
});
$('opt-size').addEventListener('change', (e) => { settings.sessionSize = parseInt(e.target.value, 10) || 20; S.save(store); renderContinue(); });
$('opt-auto').addEventListener('change', (e) => { settings.autoAdvance = e.target.checked; S.save(store); });

// ---------------------------------------------------------------- session
let session = null;
let current = null;   // { q, t, answered, ... }

function startSession(mode) {
  const sk = skills();
  let queue;
  if (mode === 'challenge') {
    queue = shuffle([...selIds]).map((key) => ({ key, skill: 'reading', isNew: false }));
  } else if (mode === 'practice') {
    const pool = started(selIds);
    queue = R.practiceQueue(store, pool.length >= 8 ? pool : selIds, sk, settings.sessionSize);
  } else {
    const newKeys = selIds.filter((id) => R.isNew(store, id));
    queue = R.smartQueue(store, selIds, sk, { size: settings.sessionSize, newAllowance: newAllowance(), newKeys });
  }
  if (!queue.length) { toast('Nothing to review right now. Try extra practice or a challenge run.'); return; }
  session = {
    mode, queue, i: 0, answered: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0,
    lives: 3, score: 0, missed: new Set(), retries: new Map(), introduced: new Set(), startedAt: Date.now(),
  };
  $('hud-mode').textContent = mode === 'challenge' ? 'Challenge' : mode === 'practice' ? 'Practice' : 'Review';
  $('hud-lives').hidden = mode !== 'challenge';
  show('view-review');
  updateHud();
  next();
}

function updateHud() {
  const s = session;
  if (!s) return;
  const challenge = s.mode === 'challenge';
  $('hud-count').textContent = challenge ? `Score ${s.score}` : `${Math.min(s.i + 1, s.queue.length)} / ${s.queue.length}`;
  $('hud-acc').textContent = s.answered ? `${Math.round((s.right / s.answered) * 100)}%` : '— %';
  $('hud-streak').textContent = s.streak >= 3 ? `${s.streak} in a row` : '';
  $('hud-lives').textContent = '♥'.repeat(s.lives) + '♡'.repeat(3 - s.lives);
  $('hud-lives').setAttribute('aria-label', `${s.lives} lives left`);
  $('session-bar').style.width = `${(s.i / s.queue.length) * 100}%`;
}

function clearCard() {
  if (current) { clearTimeout(current.autoTimer); clearTimeout(current.timer); }
  $('q-body').replaceChildren();
  $('feedback').textContent = '';
  $('feedback').className = 'kj-feedback';
  $('after').replaceChildren();
  $('after').hidden = true;
  const bar = $('q-timer');
  bar.hidden = true;
  bar.firstElementChild.style.transition = 'none';
  bar.firstElementChild.style.width = '100%';
}

function next() {
  const s = session;
  if (!s) return;
  if (s.i >= s.queue.length) { finish(); return; }
  updateHud();
  // Fetch the font pieces the next few words need while this one is answered
  s.queue.slice(s.i + 1, s.i + 4).forEach((q) => { const t = D.get(q.key); if (t) warmFont(t.term); });
  ask(s.queue[s.i]);
}

const stillAsking = (q) => session && current && current.q === q;

async function ask(q) {
  clearCard();
  const t = D.get(q.key);
  if (!t) { session.i++; next(); return; }
  // Words whose meaning is unknown (字義未詳) are only asked for their reading
  if (q.skill === 'meaning' && !D.hasMeaning(t)) q.skill = 'reading';
  current = { q, t, answered: false };
  const reading = q.skill === 'reading';
  $('q-label').textContent = `${q.isNew ? 'New word · ' : ''}${reading ? 'How is this read?' : 'What does it mean?'}`;
  const prompt = $('q-prompt');
  prompt.replaceChildren(...termNodes(t));
  $('q-hint').textContent = reading && t.hint ? `${t.hint}文字` : '';
  prompt.setAttribute('aria-label', t.term);
  prompt.dataset.len = String(Math.min(8, [...t.term.replace(/[︀-️\u{E0100}-\u{E01EF}]/gu, '')].length));
  prompt.classList.add('is-loading');
  await warmFont(t.term, 1500);
  if (!stillAsking(q)) return;
  prompt.classList.remove('is-loading');
  warmFont(t.vars.join(''));
  if (reading) typedInput(t);
  else meaningChoices(t);
  if (session.mode === 'challenge' && settings.timer) startTimer(settings.timer);
}

// ---------------------------------------------------------------- challenge timer
function startTimer(secs) {
  const bar = $('q-timer');
  const fill = bar.firstElementChild;
  bar.hidden = false;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  fill.classList.remove('is-low');
  void fill.offsetWidth;   // restart the transition
  fill.style.transition = `width ${secs}s linear`;
  fill.style.width = '0%';
  const q = current.q;
  current.lowTimer = setTimeout(() => { if (stillAsking(q)) fill.classList.add('is-low'); }, secs * 700);
  current.timer = setTimeout(() => {
    if (!stillAsking(q) || current.answered) return;
    current.answered = true;
    lockInputs();
    settle('again', { timeout: true });
  }, secs * 1000);
}

function stopTimer() {
  if (!current) return;
  clearTimeout(current.timer);
  clearTimeout(current.lowTimer);
  const fill = $('q-timer').firstElementChild;
  fill.style.width = `${fill.getBoundingClientRect().width / Math.max(1, $('q-timer').getBoundingClientRect().width) * 100}%`;
  fill.style.transition = 'none';
}

function lockInputs() {
  $('q-body').querySelectorAll('input').forEach((i) => { i.readOnly = true; });
  $('q-body').querySelectorAll('button').forEach((b) => { if (b.type !== 'submit') b.disabled = true; });
}

// ---------------------------------------------------------------- typed reading
function typedInput(t) {
  const form = h('form', { class: 'kj-typed nd-typed', autocomplete: 'off' });
  const input = h('input', {
    type: 'text', class: 'kj-typed-input', lang: 'ja', autocapitalize: 'off', autocorrect: 'off',
    spellcheck: 'false', enterkeyhint: 'done', placeholder: 'reading…', 'aria-label': 'Type the reading',
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
    const ok = D.accepts(t, val);
    input.readOnly = true;
    form.classList.add(ok ? 'is-right' : 'is-wrong');
    current.answered = true;
    current.typed = val;
    settle(ok ? 'good' : 'again');
  });
  form.append(input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Check'));
  const giveUp = h('button', {
    class: 'btn-link nd-giveup', type: 'button',
    onclick: () => {
      if (current.answered) return;
      current.answered = true;
      input.readOnly = true;
      settle('again', { gaveUp: true });
    },
  }, 'Don\'t know');
  $('q-body').append(form, giveUp);
  setTimeout(() => input.focus(), 30);
}

// ---------------------------------------------------------------- meaning (multiple choice)
function meaningChoices(t) {
  const pool = D.inLevel(t.level);
  const others = [];
  const seen = new Set([t.meaning]);
  for (let tries = 0; others.length < 3 && tries < 60; tries++) {
    const o = pool[Math.floor(Math.random() * pool.length)];
    if (D.hasMeaning(o) && !seen.has(o.meaning)) { seen.add(o.meaning); others.push(o.meaning); }
  }
  const opts = shuffle([t.meaning, ...others]);
  const list = h('div', { class: 'kj-choices nd-choices' });
  opts.forEach((o, i) => {
    list.append(h('button', {
      class: 'kj-choice', lang: 'ja', 'data-correct': String(o === t.meaning),
      onclick: (e) => pick(e.currentTarget, o === t.meaning),
    }, h('span', { class: 'kj-choice-n' }, String(i + 1)), o));
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
  if (!ok) [...list.children].forEach((b) => { if (b.dataset.correct === 'true') b.classList.add('is-right'); });
  settle(ok ? 'good' : 'again');
}

// ---------------------------------------------------------------- grading
function snapshot(id) {
  const g = store.global;
  return {
    card: store.cards[id] ? JSON.parse(JSON.stringify(store.cards[id])) : null,
    miss: store.misses[id],
    reviewCount: g.reviewCount, totalCorrect: g.totalCorrect,
    today: g.dailyCounts[R.today()] || 0,
  };
}

function restore(id, snap) {
  const g = store.global;
  if (snap.card) store.cards[id] = snap.card; else delete store.cards[id];
  if (snap.miss === undefined) delete store.misses[id]; else store.misses[id] = snap.miss;
  g.reviewCount = snap.reviewCount;
  g.totalCorrect = snap.totalCorrect;
  g.dailyCounts[R.today()] = snap.today;
}

function settle(result, extra = {}) {
  const s = session;
  const { q, t } = current;
  stopTimer();
  $('q-body').querySelector('.nd-giveup')?.remove();
  current.snap = snapshot(q.key);
  current.streakBefore = s.streak;
  if (R.isNew(store, q.key)) {
    if (s.mode === 'smart' && q.isNew) R.markIntroduced(store, q.key);
    else { store.cards[q.key] = store.cards[q.key] || {}; store.cards[q.key].added = store.cards[q.key].added || Date.now(); }
    s.introduced.add(q.key);
  }
  R.grade(store, q.key, q.skill, result);
  s.answered++;
  if (result === 'again') {
    s.wrong++;
    s.streak = 0;
    s.missed.add(q.key);
    if (s.mode === 'challenge') s.lives--;
    else {
      const tries = s.retries.get(`${q.key}|${q.skill}`) || 0;
      if (tries < 2) {
        s.retries.set(`${q.key}|${q.skill}`, tries + 1);
        const at = Math.min(s.queue.length, s.i + 4);
        current.retry = { key: q.key, skill: q.skill, isNew: false };
        s.queue.splice(at, 0, current.retry);
      }
    }
  } else {
    s.right++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (s.mode === 'challenge') s.score++;
    if (store.misses[q.key]) store.misses[q.key] = Math.max(0, store.misses[q.key] - 1);
  }
  S.save(store);
  updateHud();

  const f = $('feedback');
  f.textContent = result === 'good'
    ? (s.streak >= 5 && s.streak % 5 === 0 ? `Right. ${s.streak} in a row!` : 'Right.')
    : extra.timeout ? 'Time\'s up.' : extra.gaveUp ? 'Here it is.' : 'Not quite.';
  f.className = `kj-feedback ${result === 'good' ? 'is-ok' : 'is-miss'}`;
  showAfter(t, result, extra);
  const gameOver = s.mode === 'challenge' && s.lives <= 0;
  // Meaning questions wait for Continue, so there's time to read the definition
  if (result === 'good' && !gameOver && q.skill === 'reading' && (settings.autoAdvance || s.mode === 'challenge')) {
    current.autoTimer = setTimeout(advance, s.mode === 'challenge' ? 700 : 1100);
  }
}

// "I was right": undo a miss when the typed answer is a reading the data lacks
function overrideAsRight() {
  const s = session;
  const { q } = current;
  if (!current.snap || current.overridden) return;
  current.overridden = true;
  restore(q.key, current.snap);
  R.grade(store, q.key, q.skill, 'good');
  s.wrong--;
  s.right++;
  s.streak = (current.streakBefore || 0) + 1;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.missed.delete(q.key);
  if (s.mode === 'challenge') { s.lives++; s.score++; }
  if (current.retry) {
    const at = s.queue.indexOf(current.retry, s.i + 1);
    if (at > 0) s.queue.splice(at, 1);
    s.retries.delete(`${q.key}|${q.skill}`);
  }
  S.save(store);
  updateHud();
  $('feedback').textContent = 'Counted as right.';
  $('feedback').className = 'kj-feedback is-ok';
  $('q-body').querySelector('.kj-typed')?.classList.replace('is-wrong', 'is-right');
  $('after').querySelector('.nd-override')?.remove();
  const cont = $('after').querySelector('.kj-actions .btn');
  if (cont) cont.textContent = 'Continue';
}

function showAfter(t, result, extra) {
  const after = $('after');
  after.replaceChildren();
  const s = session;
  after.append(h('div', { class: 'nd-answer' },
    h('button', { class: 'nd-answer-term nd-pop', lang: 'ja', title: 'Details', onclick: () => openDetail(t.id) }, t.term),
    h('p', { class: 'nd-answer-reading', lang: 'ja' }, D.readingsText(t)),
    h('p', { class: 'nd-answer-meaning', lang: 'ja' }, t.meaning),
    t.note ? h('p', { class: 'nd-answer-note', lang: 'ja' }, t.note) : null,
    t.tags.length ? h('p', { class: 'kj-tags nd-tags' }, t.tags.map((g) => h('span', { class: 'kj-tag', lang: 'ja' }, g))) : null,
    t.vars.length ? h('p', { class: 'nd-answer-vars' }, 'Also written ', h('span', { class: 'nd-pop', lang: 'ja' }, t.vars.slice(0, 6).join('、'))) : null));
  if (result === 'again' && current.typed && current.q.skill === 'reading') {
    after.append(h('p', { class: 'nd-override' }, 'You typed', h('span', { lang: 'ja', class: 'nd-typed-was' }, current.typed), '·',
      h('button', { class: 'btn-link', type: 'button', onclick: overrideAsRight }, 'I was right')));
  }
  const gameOver = s.mode === 'challenge' && s.lives <= 0;
  const btn = h('button', { class: 'btn btn-primary', onclick: advance }, gameOver ? 'See results' : 'Continue');
  after.append(h('div', { class: 'kj-actions' }, btn, h('span', { class: 'kj-hint-key' }, 'Enter')));
  after.hidden = false;
  if (current.q.skill !== 'reading') btn.focus({ preventScroll: true });
  requestAnimationFrame(() => requestAnimationFrame(() => btn.scrollIntoView({ block: 'nearest' })));
}

function advance() {
  if (!session || !current || !current.answered) return;
  clearTimeout(current.autoTimer);
  if (session.mode === 'challenge' && session.lives <= 0) { finish(); return; }
  session.i++;
  next();
}

function recordTime() {
  const s = session;
  store.global.studyTimeMs += Math.min(Date.now() - s.startedAt, 2 * 3600000);
  const d = R.today();
  if (store.global.sessionDates[store.global.sessionDates.length - 1] !== d) store.global.sessionDates.push(d);
}

function finish() {
  const s = session;
  if (s.finished) return;
  s.finished = true;
  if (current) { clearTimeout(current.autoTimer); stopTimer(); }
  recordTime();
  const stat = (v, l) => h('div', null, h('p', { class: 'kj-stat-v' }, String(v)), h('p', { class: 'kj-stat-l' }, l));
  const body = $('summary-body');
  if (s.mode === 'challenge') {
    store.global.games = (store.global.games || 0) + 1;
    const key = bestKey();
    const prev = store.best[key] ? store.best[key].score : 0;
    const isBest = s.score > prev;
    if (isBest) {
      store.best[key] = { score: s.score, at: Date.now() };
      // single-level runs also count as that level's best
      if (settings.levels.length === 1) store.best[settings.levels[0]] = store.best[key];
    }
    const cleared = s.lives > 0;
    $('summary-eyebrow').textContent = cleared ? 'every word done' : 'game over';
    $('summary-title').textContent = isBest && s.score ? 'New best!' : cleared ? 'All the way through.' : s.score >= 10 ? 'Good run.' : 'Nice try.';
    body.replaceChildren(h('div', { class: 'kj-summary-stats' },
      stat(s.score, 'score'), stat(s.bestStreak, 'best streak'), stat(Math.max(prev, s.score), 'best')));
    $('summary-again').textContent = 'Play again';
  } else {
    const acc = s.answered ? Math.round((s.right / s.answered) * 100) : 0;
    $('summary-eyebrow').textContent = 'session done';
    $('summary-title').textContent = acc >= 90 ? 'Excellent.' : acc >= 70 ? 'Nice work.' : 'Good practice.';
    body.replaceChildren(h('div', { class: 'kj-summary-stats' },
      stat(s.answered, 'answered'), stat(`${acc}%`, 'right'), stat(s.introduced.size, 'new')));
    $('summary-again').textContent = 'Keep going';
  }
  if (s.missed.size) {
    body.append(h('div', null, h('p', { class: 'kj-help' }, 'Missed this time (tap for details):'),
      h('div', { class: 'kj-trouble' }, [...s.missed].map((id) => h('button', { class: 'kj-trouble-item nd-pop', lang: 'ja', onclick: () => openDetail(id) }, D.get(id).term)))));
  }
  S.save(store, { now: true });
  if (!persisted) requestPersistence().then((p) => { persisted = p; renderBackup(); });
  $('summary-overlay').hidden = false;
  $('summary-again').focus();
}

function endSession() {
  if (session && session.answered && !session.finished) recordTime();
  if (current) { clearTimeout(current.autoTimer); clearTimeout(current.timer); }
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
  $('summary-overlay').hidden = true;
  if (current) clearTimeout(current.autoTimer);
  session = null;
  current = null;
  startSession(mode);
  if (!session) endSession();
});
$('btn-start').addEventListener('click', () => startSession('smart'));
$('btn-practice').addEventListener('click', () => startSession('practice'));
$('btn-challenge').addEventListener('click', () => startSession('challenge'));

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
  if (!$('detail-overlay').hidden) {
    if (e.key === 'Escape') closeDetail();
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
  if (e.key === 'Enter' && !typing && current.answered) { e.preventDefault(); advance(); }
});

// ---------------------------------------------------------------- detail
let detailReturn = null;
function closeDetail() {
  $('detail-overlay').hidden = true;
  if (detailReturn) detailReturn.focus({ preventScroll: true });
}
$('detail-close').addEventListener('click', closeDetail);
$('detail-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDetail(); });

function openDetail(id) {
  const t = D.get(id);
  if (!t) return;
  detailReturn = document.activeElement;
  warmFont(t.term + t.vars.join(''));
  const c = store.cards[id] || {};
  const when = (ts) => {
    const d = Math.round((ts - Date.now()) / 86400000);
    return d <= 0 ? 'due now' : d === 1 ? 'next in 1 day' : `next in ${d} days`;
  };
  const progress = ['reading', 'meaning'].map((sk) => h('li', null, h('span', null, sk),
    h('span', null, c[sk] ? `${c[sk].right} right · ${c[sk].wrong} missed · ${when(c[sk].due)}` : 'not started')));
  $('detail-body').replaceChildren(...[
    h('p', { class: 'eyebrow' }, t.of ? `別表記 · ${t.of.replace('_', ' #')}` : `${D.levelName(t.level)} · ${t.id.replace('_', ' #')}`),
    h('p', { class: 'nd-detail-term nd-pop', id: 'detail-term', lang: 'ja' }, t.term),
    t.tags.length || t.hint ? h('p', { class: 'kj-tags' }, [t.hint ? `${t.hint}文字指定` : null, ...t.tags].filter(Boolean).map((g) => h('span', { class: 'kj-tag', lang: 'ja' }, g))) : null,
    h('p', { class: 'nd-answer-reading', lang: 'ja' }, D.readingsText(t)),
    h('p', { class: 'nd-answer-meaning', lang: 'ja' }, t.meaning),
    t.note ? h('p', { class: 'nd-answer-note', lang: 'ja' }, t.note) : null,
    t.of && D.get(t.of) ? h('p', { class: 'kj-help nd-of' }, 'Another spelling of ',
      h('button', { class: 'btn-link nd-pop', lang: 'ja', onclick: () => openDetail(t.of) }, D.get(t.of).term),
      ` (${D.levelName(D.get(t.of).level)}).`) : null,
    t.vars.length ? h('div', null, h('p', { class: 'kj-opt-label' }, t.of ? 'Main spelling and others' : 'Also written'),
      h('p', { class: 'nd-detail-vars nd-pop', lang: 'ja' }, t.vars.join('　'))) : null,
    h('div', null, h('p', { class: 'kj-opt-label' }, 'Your progress'), h('ul', { class: 'kj-progress' }, progress))].filter(Boolean));
  $('detail-overlay').hidden = false;
  $('detail-close').focus({ preventScroll: true });
}

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
    const count = store.global.reviewCount || 0;
    if (count > 0 && !confirm(
      `Replace your current progress (${count} answers) with ${describeBackup(backup)}?\n\n` +
      'Tip: export your current progress first if you might want it back.')) return;
    replaceStore(S.commitImport(backup.store));
    toast('Progress restored from backup.');
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'error');
  }
});
$('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset all Nandoku Trainer progress and high scores? This can\'t be undone (export first if unsure).')) return;
  replaceStore(S.reset());
  toast('All progress reset.');
});

function replaceStore(next) {
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, next);
  Object.keys(settings).forEach((k) => delete settings[k]);
  Object.assign(settings, store.settings);
  store.settings = settings;
  refreshSelection();
  renderOptions();
  renderLevels();
  renderDashboard();
}

// ---------------------------------------------------------------- boot
(async function boot() {
  renderOptions();
  try {
    await D.load();
  } catch (err) {
    $('continue-line').textContent = 'Couldn\'t load the word list. Check your connection and reload.';
    console.error(err);
    return;
  }
  refreshSelection();
  renderLevels();
  renderDashboard();
  if (window.observeReveal) window.observeReveal(document.querySelector('.kj'));
})();
