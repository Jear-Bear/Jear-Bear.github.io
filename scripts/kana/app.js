// app.js — UI orchestration for the Kana Trainer.
import { KANA, BY_CHAR, STAGES, stageItems } from './data.js';
import * as E from './engine.js';
import * as S from './storage.js';

const $ = (id) => document.getElementById(id);
const store = S.load();
S.flushOnHide(store);

// ---------------------------------------------------------------- state
const MODES = {
  smart:       { name: 'Smart review',    pool: () => E.unlockedKana(store) },
  hiragana:    { name: 'Hiragana',        pool: () => E.unlockedKana(store).filter((k) => k.script === 'hiragana') },
  katakana:    { name: 'Katakana',        pool: () => E.unlockedKana(store).filter((k) => k.script === 'katakana') },
  weak:        { name: 'Weak kana',       pool: () => weakPool() },
  missed:      { name: 'Recently missed', pool: () => store.recentMisses.map((c) => BY_CHAR[c]).filter(Boolean) },
  confusables: { name: 'Confusables',     pool: () => E.confusablePool(store, new Set(E.unlockedKana(store).map((k) => k.char))) },
  speed:       { name: 'Speed',           pool: () => E.unlockedKana(store), uniform: true, speed: true },
  random:      { name: 'Random',          pool: () => E.unlockedKana(store), uniform: true },
};

let session = null; // { mode, pool, history[], current, answered, shownAt, count, correct, combo, bestCombo, placement }
let selectedMode = 'smart';
const JP_FONTS = ['"Noto Sans JP"', '"M PLUS Rounded 1c"', '"Shippori Mincho"', '"Klee One"'];

function weakPool() {
  const pool = E.unlockedKana(store)
    .map((k) => ({ k, rec: store.kana[k.char] }))
    .filter(({ rec }) => rec && rec.reviews >= 2)
    .map(({ k, rec }) => ({ k, score: E.recentAccuracy(rec) }))
    .sort((a, b) => a.score - b.score);
  const cut = Math.max(8, Math.ceil(pool.length * 0.25));
  return pool.slice(0, cut).filter((p) => p.score < 0.9).map((p) => p.k);
}

// ---------------------------------------------------------------- views
function show(view) {
  for (const v of ['view-dashboard', 'view-review', 'view-placement']) {
    $(v).hidden = v !== view;
  }
  document.body.classList.toggle('kt-focus', view === 'view-review');
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- toasts
const toastQueue = [];
let toastBusy = false;
function toast(html, cls = '') {
  toastQueue.push({ html, cls });
  if (!toastBusy) nextToast();
}
function nextToast() {
  const t = toastQueue.shift();
  if (!t) { toastBusy = false; return; }
  toastBusy = true;
  const el = document.createElement('div');
  el.className = `kt-toast ${t.cls}`;
  el.innerHTML = t.html;
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => { el.remove(); nextToast(); }, 350);
  }, 2200);
}

// ---------------------------------------------------------------- dashboard
function renderDashboard() {
  renderContinue();
  renderStages();
  renderGrid();
  renderTrouble();
  renderStats();
}

function renderContinue() {
  const due = E.dueCount(store);
  const total = Object.values(store.kana).filter((r) => r.reviews > 0).length;
  const line = $('continue-line'), sub = $('continue-sub');
  if (total === 0) {
    line.textContent = 'Start with hiragana — or test into your level.';
    sub.textContent = '46 kana are waiting. The first session takes about five minutes.';
    $('btn-start').textContent = 'Start reviewing';
  } else if (due > 0) {
    line.textContent = `${due} kana due for review.`;
    sub.textContent = nextStepHint();
    $('btn-start').textContent = 'Continue';
  } else {
    line.textContent = 'Queue clear. Nicely done.';
    sub.textContent = nextStepHint() || 'Practice ahead, drill weak kana, or come back later.';
    $('btn-start').textContent = 'Practice anyway';
  }
}

function nextStepHint() {
  const pairs = E.troublePairs(store);
  if (pairs.length) {
    const p = pairs[0];
    return `Watch out for ${p.a} ↔ ${p.b} — it keeps tripping you up.`;
  }
  const near = E.nearlyMastered(store);
  if (near.length) return `${near.slice(0, 3).join(' ')} ${near.length > 3 ? 'and more ' : ''}are close to mastered.`;
  return '';
}

function renderStages() {
  const unlocked = E.unlockedStageIds(store);
  const frontier = Math.max(...unlocked);
  $('stage-track').innerHTML = STAGES.map((s) => {
    const p = E.stageProgress(store, s.id);
    const isOpen = unlocked.has(s.id);
    const isFrontier = s.id === frontier;
    return `
      <li class="kt-stage ${isOpen ? 'open' : 'locked'} ${isFrontier ? 'frontier' : ''}" data-stage="${s.id}">
        <div class="kt-stage-head">
          <span class="kt-stage-num">${s.id}</span>
          <span class="kt-stage-name">${s.name}</span>
          <span class="kt-stage-kana" lang="ja" aria-hidden="true">${s.short}</span>
        </div>
        <div class="kt-bar"><div class="kt-bar-fill" style="--w:${p.pct}%"></div></div>
        <div class="kt-stage-meta">
          ${isOpen
            ? `<span>${p.pct}% · ${p.mastered}/${p.total} mastered</span><button class="kt-stage-go" data-go="${s.id}">Review →</button>`
            : `<span>Locked</span><button class="kt-stage-go" data-unlock="${s.id}">Unlock early</button>`}
        </div>
      </li>`;
  }).join('');

  $('stage-track').querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => startSession('smart', stageItems(+b.dataset.go === 8 ? 0 : +b.dataset.go).length ? stageItems(+b.dataset.go) : E.unlockedKana(store))));
  $('stage-track').querySelectorAll('[data-unlock]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = +b.dataset.unlock;
      // unlock everything up to and including this stage
      for (let s = 2; s <= id; s++) {
        if (!store.overrides.unlockedStages.includes(s)) store.overrides.unlockedStages.push(s);
      }
      S.save(store);
      toast(`Stage ${id} unlocked — new kana will start appearing.`);
      renderDashboard();
    }));
}

function renderGrid() {
  const groups = [
    { label: 'Hiragana', items: KANA.filter((k) => k.script === 'hiragana' && k.stage <= 4) },
    { label: 'Katakana', items: KANA.filter((k) => k.script === 'katakana' && k.stage <= 4) },
    { label: 'Combinations', items: KANA.filter((k) => k.stage === 5 || k.stage === 6) },
    { label: 'Extended', items: KANA.filter((k) => k.stage === 7) },
  ];
  $('mastery-grid').innerHTML = groups.map((g) => `
    <div class="kt-grid-group">
      <p class="kt-grid-label">${g.label}</p>
      <div class="kt-grid">
        ${g.items.map((k) => {
          const rec = store.kana[k.char];
          const lvl = rec ? E.masteryLevel(rec) : 0;
          const acc = rec && rec.reviews ? Math.round(E.recentAccuracy(rec) * 100) : null;
          const title = `${k.char} · ${k.reading}${acc != null ? ` · ${acc}% · ${E.LEVEL_NAMES[lvl]}` : ' · not yet reviewed'}`;
          return `<button class="kt-cell m${lvl}" lang="ja" title="${title}" aria-label="${title}">${k.char}</button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function renderTrouble() {
  const pairs = E.troublePairs(store);
  const el = $('trouble-spots');
  if (!pairs.length) {
    el.innerHTML = `<p class="kt-empty">No confusion pairs yet — that's a good sign. If patterns emerge (シ↔ツ, ぬ↔め…), they'll show up here with a way to drill them.</p>`;
    return;
  }
  el.innerHTML = `
    <ul class="kt-pairs">
      ${pairs.slice(0, 6).map((p) => `
        <li class="kt-pair">
          <span class="kt-pair-kana" lang="ja">${p.a} <span class="kt-pair-arrow">↔</span> ${p.b}</span>
          <span class="kt-pair-meta">${p.pairAcc}% · mixed up ${p.count}×</span>
        </li>`).join('')}
    </ul>
    <button class="btn btn-primary kt-pairs-btn" id="btn-trouble">Train these</button>`;
  $('btn-trouble').addEventListener('click', () => startSession('confusables'));
}

function renderStats() {
  const g = store.global;
  const today = E.isoDay();
  const reviewedKana = Object.values(store.kana).filter((r) => r.reviews > 0);
  const mastered = Object.entries(store.kana).filter(([, r]) => E.masteryLevel(r) === 4).length;
  const acc = g.reviewCount ? Math.round((g.totalCorrect / g.reviewCount) * 100) : 0;
  const mins = Math.round(g.studyTimeMs / 60000);
  const cells = [
    [g.reviewCount, 'total reviews'],
    [g.dailyCounts[today] || 0, 'today'],
    [`${E.dayStreak(store)}d`, 'day streak'],
    [`${acc}%`, 'accuracy'],
    [`${mastered}/${KANA.length}`, 'mastered'],
    [mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`, 'study time'],
    [reviewedKana.length, 'kana seen'],
    [Math.max(0, ...reviewedKana.map((r) => r.bestStreak)), 'best streak'],
  ];
  $('stats-panel').innerHTML = cells.map(([v, l]) =>
    `<div class="kt-stat"><span class="kt-stat-v">${v}</span><span class="kt-stat-l">${l}</span></div>`).join('');
}

// ---------------------------------------------------------------- review loop
function startSession(modeKey, poolOverride = null) {
  const mode = MODES[modeKey];
  let pool = poolOverride || mode.pool();
  if (!pool.length) {
    toast(modeKey === 'weak' ? 'No weak kana yet — review a bit first.' : 'Nothing to review in that mode yet.');
    return;
  }
  session = {
    modeKey, pool, history: [], current: null, answered: false,
    shownAt: 0, count: 0, correct: 0, combo: 0, bestCombo: 0, placement: null,
  };
  $('hud-mode').textContent = mode.name;
  $('speedbar').hidden = !mode.speed;
  $('placement-progress').hidden = true;
  markSessionDay();
  show('view-review');
  nextCard();
}

function markSessionDay() {
  const today = E.isoDay();
  if (!store.global.sessionDates.includes(today)) store.global.sessionDates.push(today);
}

function nextCard() {
  const mode = MODES[session.modeKey];
  session.current = E.pickNext(store, session.pool, session.history, { uniform: !!mode.uniform });
  session.history.push(session.current.char);
  session.answered = false;
  session.awaitingAdvance = false;
  session.cardToken = (session.cardToken || 0) + 1;
  session.shownAt = performance.now();

  const k = $('kana-display');
  k.textContent = session.current.char;
  k.className = 'kt-kana';
  k.style.fontFamily = pickFont();
  void k.offsetWidth; // restart animation
  k.classList.add('enter');

  $('feedback').innerHTML = '&nbsp;';
  $('feedback').className = 'kt-feedback';
  const input = $('answer-input');
  input.value = '';
  input.disabled = false;
  input.focus();

  if (mode.speed) restartSpeedbar();
}

function pickFont() {
  if (!store.settings.fontRotation) return JP_FONTS[0];
  // weight toward the standard gothic face; more variety as the user matures
  const r = Math.random();
  const variety = Math.min(0.5, store.global.reviewCount / 2000 + 0.15);
  if (r > variety) return JP_FONTS[0];
  return JP_FONTS[1 + Math.floor(Math.random() * (JP_FONTS.length - 1))];
}

function restartSpeedbar() {
  const bar = $('speedbar').firstElementChild;
  bar.classList.remove('run');
  void bar.offsetWidth;
  bar.classList.add('run');
}

function submitAnswer() {
  const input = $('answer-input');
  if (session.placement) return submitPlacement(input.value);

  if (session.awaitingAdvance) { advance(); return; }
  const raw = input.value;
  if (!raw.trim()) return;

  const kana = session.current;
  const correct = E.grade(kana, raw);
  const levelBefore = store.kana[kana.char] ? E.masteryLevel(store.kana[kana.char]) : 0;
  const unlockedBefore = E.unlockedStageIds(store);

  E.applyAnswer(store, kana, correct);
  const today = E.isoDay();
  store.global.dailyCounts[today] = (store.global.dailyCounts[today] || 0) + 1;
  store.global.studyTimeMs += Math.min(15000, performance.now() - session.shownAt);

  session.count++;
  session.answered = true;
  session.awaitingAdvance = true;
  const k = $('kana-display'), fb = $('feedback');

  if (correct) {
    session.correct++;
    session.combo++;
    session.bestCombo = Math.max(session.bestCombo, session.combo);
    k.classList.add('hit');
    fb.innerHTML = `<span class="ok">✓ ${kana.reading}</span>`;
    fb.className = 'kt-feedback show';
    comboFeedback();
    levelUpCheck(kana, levelBefore);
    unlockCheck(unlockedBefore);
    const token = session.cardToken;
    setTimeout(() => {
      if (session && session.awaitingAdvance && session.cardToken === token) advance();
    }, 380);
  } else {
    session.combo = 0;
    store.recentMisses = store.recentMisses.filter((c) => c !== kana.char);
    store.recentMisses.push(kana.char);
    const confusedWith = E.detectConfusion(kana, raw, new Set(E.unlockedKana(store).map((x) => x.char)));
    if (confusedWith) E.recordConfusion(store, kana.char, confusedWith);
    k.classList.add('miss');
    fb.innerHTML = `<span class="no">✗ ${escapeHTML(E.normalize(raw)) || '…'}</span>
      <span class="truth">it's <strong>${kana.reading}</strong></span>
      ${confusedWith ? `<span class="confused">you typed <span lang="ja">${confusedWith}</span>'s reading</span>` : ''}`;
    fb.className = 'kt-feedback show';
    input.value = ''; // held state — Enter to continue
  }
  updateHUD();
  S.save(store);
}

function advance() {
  if (!session) return;
  session.awaitingAdvance = false;
  if (session.count > 0 && session.count % 25 === 0) showSummary();
  else nextCard();
}

function comboFeedback() {
  const el = $('hud-combo');
  el.textContent = `×${session.combo}`;
  el.classList.remove('pop', 'hot', 'blazing');
  void el.offsetWidth;
  el.classList.add('pop');
  if (session.combo >= 25) el.classList.add('blazing');
  else if (session.combo >= 10) el.classList.add('hot');
  if ([10, 25, 50, 100].includes(session.combo)) {
    toast(`<strong>×${session.combo} streak</strong> — locked in.`, 'kt-toast-combo');
  }
}

function levelUpCheck(kana, before) {
  const after = E.masteryLevel(store.kana[kana.char]);
  if (after > before && after >= 2) {
    toast(`<span lang="ja" class="kt-toast-kana">${kana.char}</span> reached <strong>${E.LEVEL_NAMES[after]}</strong>`, after === 4 ? 'kt-toast-mastered' : '');
  }
}

function unlockCheck(before) {
  const after = E.unlockedStageIds(store);
  for (const id of after) {
    if (!before.has(id)) {
      const s = STAGES.find((x) => x.id === id);
      toast(`<strong>Stage ${id} unlocked</strong> — ${s.name}`, 'kt-toast-unlock');
    }
  }
}

function updateHUD() {
  $('hud-count').textContent = `${session.count} reviewed`;
  $('hud-acc').textContent = session.count ? `${Math.round((session.correct / session.count) * 100)}%` : '— %';
}

function showSummary() {
  const acc = Math.round((session.correct / session.count) * 100);
  $('summary-title').textContent = `${session.count} down.`;
  $('summary-stats').innerHTML = [
    [`${acc}%`, 'accuracy'],
    [`×${session.bestCombo}`, 'best streak'],
    [E.dueCount(store), 'still due'],
  ].map(([v, l]) => `<div class="kt-stat"><span class="kt-stat-v">${v}</span><span class="kt-stat-l">${l}</span></div>`).join('');
  const near = E.nearlyMastered(store);
  $('summary-hook').innerHTML = near.length
    ? `<p><span lang="ja">${near.join(' ')}</span> ${near.length === 1 ? 'is' : 'are'} a few correct answers from <strong>Mastered</strong>.</p>`
    : '';
  $('summary-overlay').hidden = false;
  $('btn-summary-continue').focus();
}

function endSession() {
  S.save(store, { now: true });
  session = null;
  $('summary-overlay').hidden = true;
  renderDashboard();
  show('view-dashboard');
}

// ---------------------------------------------------------------- placement
function openPlacement() {
  $('placement-intro').hidden = false;
  $('placement-results').hidden = true;
  show('view-placement');
}

function startPlacement() {
  session = {
    modeKey: 'smart', history: [], answered: false, count: 0, correct: 0,
    combo: 0, bestCombo: 0, shownAt: 0,
    placement: {
      stage: 1, queue: E.placementSample(1), index: 0,
      stageCorrect: 0, results: new Map(), passedThrough: 0, perStage: [],
    },
  };
  $('hud-mode').textContent = 'Placement test';
  $('speedbar').hidden = true;
  show('view-review');
  nextPlacementCard();
}

function nextPlacementCard() {
  const p = session.placement;
  session.current = p.queue[p.index];
  session.answered = false;
  const k = $('kana-display');
  k.textContent = session.current.char;
  k.className = 'kt-kana enter';
  k.style.fontFamily = JP_FONTS[0]; // placement is always the standard face
  $('feedback').innerHTML = '&nbsp;';
  $('feedback').className = 'kt-feedback';
  const prog = $('placement-progress');
  prog.hidden = false;
  prog.innerHTML = `Stage ${p.stage} · ${STAGES[p.stage - 1].name} · <strong>${p.index + 1}/${E.PLACEMENT_SAMPLE}</strong>`;
  const input = $('answer-input');
  input.value = '';
  input.focus();
}

function submitPlacement(raw) {
  if (session.answered) return; // placement: no held state, flows continuously
  if (!raw.trim()) return;
  const p = session.placement;
  const kana = session.current;
  const correct = E.grade(kana, raw);
  p.results.set(kana.char, correct);
  if (correct) p.stageCorrect++;
  session.count++;
  if (correct) session.correct++;

  const k = $('kana-display'), fb = $('feedback');
  k.classList.add(correct ? 'hit' : 'miss');
  fb.innerHTML = correct
    ? `<span class="ok">✓ ${kana.reading}</span>`
    : `<span class="no">✗</span> <span class="truth">it's <strong>${kana.reading}</strong></span>`;
  fb.className = 'kt-feedback show';
  $('answer-input').value = '';
  updateHUD();

  session.answered = true;
  setTimeout(() => {
    p.index++;
    if (p.index < p.queue.length) { nextPlacementCard(); return; }
    // stage finished
    const passed = p.stageCorrect >= E.PLACEMENT_PASS;
    p.perStage.push({ stage: p.stage, correct: p.stageCorrect, passed });
    E.seedPlacement(store, p.stage, p.results, passed);
    if (passed) {
      if (!store.overrides.unlockedStages.includes(p.stage + 1) && p.stage < 8) {
        store.overrides.unlockedStages.push(p.stage + 1);
      }
      p.passedThrough = p.stage;
      if (p.stage < 7) {
        p.stage++;
        p.queue = E.placementSample(p.stage);
        p.index = 0; p.stageCorrect = 0; p.results = new Map();
        nextPlacementCard();
        return;
      }
    }
    finishPlacement();
  }, correct ? 350 : 1100);
}

function finishPlacement() {
  S.save(store, { now: true });
  markSessionDay();
  const p = session.placement;
  session = null;
  const passed = p.passedThrough;
  $('placement-intro').hidden = true;
  $('placement-results').hidden = false;
  $('placement-result-title').textContent =
    passed >= 7 ? 'Full clear. 完璧.' :
    passed >= 1 ? `You tested through Stage ${passed}.` :
    'Starting from the top.';
  $('placement-result-body').innerHTML = `
    <ul class="kt-placement-list">
      ${p.perStage.map((s) => `
        <li class="${s.passed ? 'pass' : 'fail'}">
          <span>${STAGES[s.stage - 1].name}</span>
          <span>${s.correct}/${E.PLACEMENT_SAMPLE} ${s.passed ? '· passed' : '· your frontier'}</span>
        </li>`).join('')}
    </ul>
    <p class="kt-placement-copy">${passed >= 1
      ? `Stages 1–${passed} are seeded as known and Stage ${Math.min(passed + 1, 8)} is unlocked. Smart review will mix light maintenance of what you know with new material at your frontier.`
      : 'No stages cleared — which is exactly what this trainer is for. Smart review will start you on basic hiragana.'}</p>`;
  show('view-placement');
  renderDashboard();
}

// ---------------------------------------------------------------- wiring
$('btn-start').addEventListener('click', () => startSession(selectedMode));
$('btn-placement').addEventListener('click', openPlacement);
$('btn-placement-start').addEventListener('click', startPlacement);
$('btn-placement-cancel').addEventListener('click', () => show('view-dashboard'));
$('btn-placement-review').addEventListener('click', () => startSession('smart'));
$('btn-placement-dash').addEventListener('click', () => { renderDashboard(); show('view-dashboard'); });
$('btn-end').addEventListener('click', endSession);
$('btn-summary-continue').addEventListener('click', () => { $('summary-overlay').hidden = true; nextCard(); });
$('btn-summary-end').addEventListener('click', endSession);

$('answer-form').addEventListener('submit', (e) => { e.preventDefault(); submitAnswer(); });
document.addEventListener('keydown', (e) => {
  if (!session) return;
  if (e.key === 'Escape') {
    if (!$('summary-overlay').hidden) { $('summary-overlay').hidden = true; nextCard(); }
    else if (session.placement) { finishPlacement(); }
    else endSession();
  }
});
// keep the input owning the keyboard during review
window.addEventListener('focus', () => { if (session) $('answer-input').focus(); });
document.addEventListener('click', (e) => {
  if (session && !e.target.closest('button, a, input')) $('answer-input').focus();
});

$('mode-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.kt-chip');
  if (!chip) return;
  selectedMode = chip.dataset.mode;
  $('mode-chips').querySelectorAll('.kt-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
  if (selectedMode === 'smart') renderContinue();
  else $('btn-start').textContent = `Start: ${MODES[selectedMode].name}`;
});

$('opt-fonts').checked = store.settings.fontRotation;
$('opt-fonts').addEventListener('change', (e) => {
  store.settings.fontRotation = e.target.checked;
  S.save(store);
});

$('btn-export').addEventListener('click', () => S.exportJSON(store));
$('btn-import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const merged = S.importJSON(await file.text());
    Object.assign(store, merged);
    toast('Progress imported.');
    renderDashboard();
  } catch (err) {
    toast(`Import failed — ${err.message}`, 'kt-toast-error');
  }
  e.target.value = '';
});
$('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset all Kana Trainer progress? This cannot be undone (export first if unsure).')) return;
  Object.assign(store, S.reset());
  toast('All progress reset.');
  renderDashboard();
});

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- boot
renderDashboard();
show('view-dashboard');
