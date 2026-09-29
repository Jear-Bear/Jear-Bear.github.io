// study-progress.js — XP, trainer rank and "time left" estimates shared by
// the Kanji, Kana and Nandoku trainers. Pure numbers plus two small DOM
// builders (text only, never HTML).
//
// XP: every item is worth 25 XP per mastery step (new 0 · learning 25 ·
// familiar 50 · strong 75 · mastered 100), so a level's bar is its share of
// the XP it can give.
//
// Time left comes from your last 28 days (new items a day, answers a day and
// accuracy), so it moves with how you actually study.

export const XP_STEP = 25;
export const PACE_DAYS = 28;
const DAY = 86400000;

export function tally(levels) {
  const counts = [0, 0, 0, 0, 0];
  levels.forEach((l) => { counts[l]++; });
  const total = levels.length;
  const xp = levels.reduce((s, l) => s + l * XP_STEP, 0);
  const max = total * 4 * XP_STEP;
  return { counts, total, xp, max, pct: max ? xp / max : 0 };
}

// Trainer rank: level L needs 100 + 50·L more XP to reach L + 1
const needFor = (L) => 100 + 50 * L;
export function rankOf(xp) {
  let level = 1;
  let floor = 0;
  while (xp >= floor + needFor(level)) { floor += needFor(level); level++; }
  const need = needFor(level);
  return { level, into: xp - floor, need, pct: (xp - floor) / need };
}

const iso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Recent pace from the daily logs. Null until there are 3 days of history.
export function pace(global, { now = Date.now() } = {}) {
  const logged = [...Object.keys(global.dailyCounts || {}), ...Object.keys(global.newByDay || {})].sort();
  if (!logged.length) return null;
  const start = new Date(`${logged[0]}T00:00:00`).getTime();
  const span = Math.min(PACE_DAYS, Math.floor((now - start) / DAY) + 1);
  if (span < 3) return null;
  let answers = 0, fresh = 0, active = 0;
  for (let i = 0; i < span; i++) {
    const d = iso(now - i * DAY);
    const n = (global.dailyCounts || {})[d] || 0;
    answers += n;
    fresh += (global.newByDay || {})[d] || 0;
    if (n) active++;
  }
  const accuracy = global.reviewCount ? global.totalCorrect / global.reviewCount : 0.85;
  return { span, active, answersPerDay: answers / span, newPerDay: fresh / span, accuracy };
}

// --- Spaced repetition (Kanji, Nandoku) ------------------------------------------------
// Days from an item's first answer to reach each box when every answer is
// right (boxes 1–9 wait 10 min, 1, 3, 7, 14, 30… days). Box 7 = mastered.
const REACH = [0, 0, 0, 1, 4, 11, 25, 55];
const reach = (box) => {
  if (box >= 7) return 55;
  const lo = Math.floor(box);
  return REACH[lo] + (REACH[lo + 1] - REACH[lo]) * (box - lo);
};
const missFactor = (p) => 1 / Math.max(0.6, Math.min(1, p.accuracy)) ** 2;

// boxes: average box of each started, not-yet-mastered item in the level.
// queued: new items that come before (and including) this level's last new
// item in your queue; 0 when everything is started, null when the level
// isn't selected. Returns { days } or { note }.
export function srsEstimate({ boxes, unstarted, queued, pace: p, newCap = Infinity, noun = 'items' }) {
  if (!boxes.length && !unstarted) return { days: 0 };
  if (!p) return { note: 'Study for a few days to see an estimate.' };
  const f = missFactor(p);
  const left = boxes.map((b) => (55 - reach(b)) * f).sort((a, b) => a - b);
  const startedDays = left.length ? left[Math.min(left.length - 1, Math.floor(left.length * 0.9))] : 0;
  if (!unstarted) return { days: startedDays };
  if (queued == null) return { note: boxes.length ? 'Select it to get an estimate.' : '' };
  const rate = Math.min(p.newPerDay, newCap);
  if (rate <= 0) return { note: `No new ${noun} in the last ${p.span} days, so no estimate yet.` };
  return { days: Math.max(startedDays, queued / rate + 55 * f) };
}

// --- Review-count mastery (Kana) --------------------------------------------------------
// Kana are mastered after about 12 answers with a 6-answer streak.
export function kanaAnswersLeft(rec, accuracy) {
  const a = Math.max(0.6, Math.min(1, accuracy));
  if (!rec || !rec.reviews) return 14 / a;
  return Math.max(12 - rec.reviews, 6 - rec.streak, 1) / a;
}

// --- Text -------------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function etaText(est, { now = Date.now() } = {}) {
  if (!est) return '';
  if (est.note != null) return est.note;
  const d = est.days;
  if (!d) return 'Done!';
  if (!Number.isFinite(d)) return 'No estimate yet.';
  let span;
  if (d < 1.5) span = 'about a day';
  else if (d < 14) span = `about ${Math.round(d)} days`;
  else if (d < 60) span = `about ${Math.round(d / 7)} weeks`;
  else if (d < 730) span = `about ${Math.round(d / 30.4)} months`;
  else span = `about ${(d / 365).toFixed(1).replace('.0', '')} years`;
  const when = new Date(now + d * DAY);
  const date = d < 60 ? `${MONTHS[when.getMonth()]} ${when.getDate()}` : `${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
  return `${span} left · around ${date}`;
}

export function paceText(p, noun) {
  if (!p) return 'Estimates appear after a few days of study.';
  const r = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  return `Estimates use your last ${p.span} days: ${r(p.newPerDay)} new ${noun} and ${r(p.answersPerDay)} answers a day, ${Math.round(p.accuracy * 100)}% right.`;
}

// --- Today's XP and level-ups -------------------------------------------------------------
// Kept apart from the trainer's store so backups stay unchanged
const XP_KEY = 'jareddesu.xp.v1';
export function trackXp(app, xp, { now = Date.now() } = {}) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(XP_KEY) || '{}') || {}; } catch { all = {}; }
  const mine = all[app] || {};
  const day = iso(now);
  if (mine.day !== day) { mine.day = day; mine.start = mine.last ?? xp; }
  const before = rankOf(mine.last ?? xp).level;
  mine.last = xp;
  all[app] = mine;
  try { localStorage.setItem(XP_KEY, JSON.stringify(all)); } catch { /* cosmetic */ }
  const level = rankOf(xp).level;
  return { today: Math.max(0, xp - mine.start), levelUp: level > before ? level : 0 };
}

// --- DOM ----------------------------------------------------------------------------------
function el(tag, cls, ...kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  kids.flat().forEach((k) => { if (k != null && k !== '') n.append(k instanceof Node ? k : document.createTextNode(String(k))); });
  return n;
}
const nf = new Intl.NumberFormat('en');

export function rankCard({ xp, today = 0, title }) {
  const r = rankOf(xp);
  const bar = el('div', 'sp-xpbar', el('span'));
  bar.firstChild.style.width = `${Math.round(r.pct * 1000) / 10}%`;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `Level ${r.level}: ${r.into} of ${r.need} XP to the next level`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(r.need));
  bar.setAttribute('aria-valuenow', String(r.into));
  return el('div', 'sp-rank',
    el('div', 'sp-rank-badge', el('span', 'sp-rank-lv', 'Lv'), el('span', 'sp-rank-n', r.level)),
    el('div', 'sp-rank-body',
      el('p', 'sp-rank-title', title),
      bar,
      el('p', 'sp-rank-meta', `${nf.format(r.need - r.into)} XP to Lv ${r.level + 1} · ${nf.format(xp)} XP total`,
        today ? el('span', 'sp-rank-today', ` · +${nf.format(today)} today`) : null)));
}

// One level: name, segmented bar (mastered → learning), XP, time left
export function levelRow({ name, sub, t, eta, extra, lang, action }) {
  const bar = el('div', 'sp-bar');
  [4, 3, 2, 1].forEach((m) => {
    if (!t.counts[m]) return;
    const s = el('span', `m${m}`);
    s.style.flexGrow = t.counts[m];
    bar.append(s);
  });
  const rest = el('span', 'sp-rest');
  rest.style.flexGrow = t.counts[0];
  bar.append(rest);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${name}: ${t.counts[4]} mastered, ${t.counts[3]} strong, ${t.counts[2]} familiar, ${t.counts[1]} learning, ${t.counts[0]} new, of ${t.total}`);
  const pct = Math.floor(t.pct * 100);
  const nameEl = el('span', 'sp-level-name', name, sub ? el('span', 'sp-level-sub', sub) : null);
  if (lang) nameEl.lastChild.lang = lang;
  return el('div', `sp-level${t.pct >= 1 ? ' is-done' : ''}`,
    el('div', 'sp-level-head', nameEl, el('span', 'sp-level-pct', `${pct}%`)),
    bar,
    el('p', 'sp-level-meta',
      `${nf.format(t.counts[4])} / ${nf.format(t.total)} mastered · ${nf.format(t.xp)} / ${nf.format(t.max)} XP${extra ? ` · ${extra}` : ''}`),
    eta || action ? el('p', 'sp-level-eta', eta, action ? el('span', 'sp-level-action', action) : null) : null);
}
