// srs.js — spaced repetition for the Kanji Trainer.
//
// Each item ('k:学' kanji, 'w:大学' word) keeps a separate schedule per skill:
//   meaning  — meaning multiple choice, and meaning → kanji
//   reading  — reading multiple choice, and typed reading
//   writing  — handwriting
// Boxes 1–9 map to growing intervals. Right: up a box. Hard: same box,
// shorter wait. Wrong: back to box 1 (seen again this session / in 10 min).

const MIN = 60000;
const DAY = 86400000;
export const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 120 * DAY, 240 * DAY];
const MAX_BOX = INTERVALS.length - 1;

export const today = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function skillsFor(settings) {
  const q = settings.questions;
  const out = [];
  if (q.meaning || q.reverse) out.push('meaning');
  if (q.reading || q.typed) out.push('reading');
  if (q.writing) out.push('writing');
  return out.length ? out : ['meaning'];
}

export function state(store, key, skill) {
  const c = store.cards[key];
  return c && c[skill];
}

export function isNew(store, key) {
  const c = store.cards[key];
  return !c || !['meaning', 'reading', 'writing'].some((s) => c[s]);
}

// result: 'good' | 'hard' | 'again'
export function grade(store, key, skill, result, now = Date.now()) {
  const card = (store.cards[key] = store.cards[key] || {});
  const s = (card[skill] = card[skill] || { box: 0, due: 0, right: 0, wrong: 0, last: 0 });
  if (result === 'good') {
    s.box = Math.min(MAX_BOX, s.box + 1);
    s.due = now + INTERVALS[s.box];
    s.right++;
  } else if (result === 'hard') {
    s.box = Math.max(1, s.box);
    s.due = now + Math.max(10 * MIN, INTERVALS[s.box] / 2);
    s.right++;
  } else {
    s.box = 1;
    s.due = now + INTERVALS[1];
    s.wrong++;
    store.misses[key] = (store.misses[key] || 0) + 1;
  }
  s.last = now;

  const g = store.global;
  g.reviewCount++;
  if (result !== 'again') g.totalCorrect++;
  const d = today(now);
  g.dailyCounts[d] = (g.dailyCounts[d] || 0) + 1;
}

export function markIntroduced(store, key, data, now = Date.now()) {
  const card = (store.cards[key] = store.cards[key] || {});
  if (data) card.d = data;            // word info: [word, reading, meaning]
  card.added = card.added || now;
  const d = today(now);
  store.global.newByDay[d] = (store.global.newByDay[d] || 0) + 1;
}

export const newToday = (store) => store.global.newByDay[today()] || 0;

// 0 new · 1 learning · 2 familiar · 3 strong · 4 mastered
export function mastery(store, key, skills) {
  const c = store.cards[key];
  if (!c) return 0;
  const boxes = skills.map((s) => (c[s] ? c[s].box : 0));
  if (boxes.every((b) => b === 0)) return 0;
  const avg = boxes.reduce((a, b) => a + b, 0) / boxes.length;
  if (avg >= 7) return 4;
  if (avg >= 5) return 3;
  if (avg >= 3) return 2;
  return 1;
}

export function dueCount(store, keys, skills, now = Date.now()) {
  let n = 0;
  for (const key of keys) {
    const c = store.cards[key];
    if (!c) continue;
    for (const s of skills) if (c[s] && c[s].due <= now) n++;
  }
  return n;
}

// Smart review: everything due (oldest first), then new items up to today's
// allowance. Returns [{ key, skill, isNew }], at most `size` questions.
export function smartQueue(store, keys, skills, { size, newAllowance, newKeys }, now = Date.now()) {
  const due = [];
  for (const key of keys) {
    const c = store.cards[key];
    if (!c) continue;
    for (const s of skills) if (c[s] && c[s].due <= now) due.push({ key, skill: s, due: c[s].due });
  }
  due.sort((a, b) => a.due - b.due);
  const out = due.slice(0, size).map(({ key, skill }) => ({ key, skill, isNew: false }));
  let room = size - out.length;
  // Skills the learner already knows for an item but hasn't started (e.g.
  // writing turned on later) count as new questions, not new items
  for (const key of keys) {
    if (room <= 0) break;
    const c = store.cards[key];
    if (!c || isNew(store, key)) continue;
    for (const s of skills) {
      if (room > 0 && !c[s]) { out.push({ key, skill: s, isNew: false }); room--; }
    }
  }
  for (const key of newKeys.slice(0, Math.max(0, newAllowance))) {
    if (room <= 0) break;
    for (const s of skills) {
      if (room <= 0) break;
      out.push({ key, skill: s, isNew: true });
      room--;
    }
  }
  return interleave(out);
}

// Practice: extra study that doesn't wait for due dates. Weakest first,
// with some randomness.
export function practiceQueue(store, keys, skills, size) {
  const scored = keys.map((key) => {
    const c = store.cards[key] || {};
    const box = skills.reduce((t, s) => t + (c[s] ? c[s].box : 0), 0) / skills.length;
    return { key, score: box - (store.misses[key] || 0) * 0.5 + Math.random() * 2 };
  });
  scored.sort((a, b) => a.score - b.score);
  const out = [];
  for (const { key } of scored) {
    for (const s of skills) {
      if (out.length >= size) break;
      out.push({ key, skill: s, isNew: false });
    }
    if (out.length >= size) break;
  }
  return interleave(out);
}

// Spread an item's questions apart so the same kanji isn't asked twice in a row
function interleave(list) {
  const byKey = new Map();
  list.forEach((q) => { if (!byKey.has(q.key)) byKey.set(q.key, []); byKey.get(q.key).push(q); });
  const groups = [...byKey.values()];
  const out = [];
  let round = 0;
  while (out.length < list.length) {
    groups.forEach((g) => { if (g[round]) out.push(g[round]); });
    round++;
  }
  return out;
}
