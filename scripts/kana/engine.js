// engine.js — pure logic. No DOM, no storage. Everything testable.
import { KANA, BY_CHAR, stageItems, SEED_PAIRS } from './data.js?v=8';

// ---------- records ----------
export function freshRecord() {
  return {
    reviews: 0, correct: 0, streak: 0, bestStreak: 0,
    lastReviewed: 0, ease: 2.0, interval: 0, duePosition: 0, recent: '',
  };
}

export const getRecord = (store, char) => store.kana[char] || (store.kana[char] = freshRecord());

// ---------- grading ----------
export const normalize = (input) => input.trim().toLowerCase().replace(/\s+/g, '');

export function grade(kana, input) {
  return kana.accepted.includes(normalize(input));
}

// If the wrong answer is exactly another kana's *primary* reading, name it.
// When several kana share that reading (つ/ツ), prefer the same script as the
// shown kana — that's almost always the actual confusion.
export function detectConfusion(shownKana, input, unlockedChars) {
  const n = normalize(input);
  if (!n || shownKana.accepted.includes(n)) return null;
  const matches = KANA.filter(
    (k) => k.reading === n && k.char !== shownKana.char &&
           k.reading !== shownKana.reading && unlockedChars.has(k.char)
  );
  if (!matches.length) return null;
  const sameScript = matches.find((k) => k.script === shownKana.script);
  return (sameScript || matches[0]).char;
}

// ---------- mastery ----------
// 0 New · 1 Learning · 2 Familiar · 3 Strong · 4 Mastered
export const LEVEL_NAMES = ['New', 'Learning', 'Familiar', 'Strong', 'Mastered'];

export function recentAccuracy(rec) {
  if (!rec.recent.length) return 0;
  const hits = [...rec.recent].filter((c) => c === '1').length;
  return hits / rec.recent.length;
}

export function masteryLevel(rec) {
  if (rec.reviews < 3) return 0;
  const acc = recentAccuracy(rec);
  if (acc >= 0.92 && rec.streak >= 6 && rec.reviews >= 12) return 4;
  if (acc >= 0.85 && rec.streak >= 4 && rec.reviews >= 8) return 3;
  if (acc >= 0.75 && rec.streak >= 2) return 2;
  return 1;
}

// ---------- scheduling ----------
export function applyAnswer(store, kana, correct) {
  const rec = getRecord(store, kana.char);
  rec.reviews++;
  rec.lastReviewed = Date.now();
  rec.recent = (rec.recent + (correct ? '1' : '0')).slice(-20);
  if (correct) {
    rec.correct++;
    rec.streak++;
    rec.bestStreak = Math.max(rec.bestStreak, rec.streak);
    rec.interval = Math.max(4, Math.round(Math.max(rec.interval, 2) * rec.ease));
    if (masteryLevel(rec) === 4) rec.interval = Math.max(rec.interval, 40); // mastered floor
    rec.ease = Math.min(3.0, rec.ease + 0.05);
    store.global.totalCorrect++;
  } else {
    rec.streak = 0;
    rec.interval = 2 + Math.floor(Math.random() * 3); // reappear in 2–4 cards
    rec.ease = Math.max(1.3, rec.ease - 0.25);
  }
  rec.duePosition = store.global.reviewCount + rec.interval;
  store.global.reviewCount++;
  return rec;
}

function weight(store, kana, recentMissSet, newDrawShare) {
  const rec = store.kana[kana.char];
  if (!rec || rec.reviews === 0) {
    // new card — drip-feed while new cards are under ~15% of recent draws
    return newDrawShare < 0.15 ? 2.0 : 0.3;
  }
  const g = store.global.reviewCount;
  const overdue = Math.max(0.01, (g - rec.duePosition) / Math.max(rec.interval, 1));
  const err = 1 + 2 * (1 - recentAccuracy(rec));
  const recency = recentMissSet.has(kana.char) ? 3 : 1;
  return overdue * overdue * err * recency;
}

// Weighted pick avoiding the last 3 shown.
export function pickNext(store, pool, history, { uniform = false } = {}) {
  const recent3 = new Set(history.slice(-3));
  let candidates = pool.filter((k) => !recent3.has(k.char));
  if (!candidates.length) candidates = pool;
  if (uniform) return candidates[Math.floor(Math.random() * candidates.length)];

  const last20 = history.slice(-20);
  const newDraws = last20.filter((c) => !store.kana[c] || store.kana[c].reviews <= 1).length;
  const newShare = last20.length ? newDraws / last20.length : 0;
  const missSet = new Set(store.recentMisses.slice(-10));

  const weights = candidates.map((k) => weight(store, k, missSet, newShare));
  let total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ---------- stages / unlocks ----------
export function stageProgress(store, stageId) {
  const items = stageItems(stageId === 8 ? 0 : stageId);
  const pool = stageId === 8 ? KANA : items;
  if (!pool.length) return { pct: 0, mastered: 0, total: 0 };
  let score = 0, mastered = 0;
  for (const k of pool) {
    const lvl = store.kana[k.char] ? masteryLevel(store.kana[k.char]) : 0;
    score += lvl / 4;
    if (lvl === 4) mastered++;
  }
  return { pct: Math.round((score / pool.length) * 100), mastered, total: pool.length };
}

// A stage "clears" for unlock purposes when ≥70% of its kana are Familiar+.
function stageCleared(store, stageId) {
  const items = stageItems(stageId);
  if (!items.length) return false;
  const ok = items.filter((k) => store.kana[k.char] && masteryLevel(store.kana[k.char]) >= 2).length;
  return ok / items.length >= 0.7;
}

export function unlockedStageIds(store) {
  const unlocked = new Set([1, ...store.overrides.unlockedStages]);
  for (let s = 1; s <= 7; s++) {
    if (unlocked.has(s) && stageCleared(store, s)) unlocked.add(s + 1);
  }
  // mixed unlocks once 7 is cleared or manually
  return unlocked;
}

export function unlockedKana(store) {
  const ids = unlockedStageIds(store);
  return KANA.filter((k) => ids.has(k.stage));
}

// ---------- confusion ----------
export function recordConfusion(store, shownChar, answeredAsChar) {
  const key = `${shownChar}→${answeredAsChar}`;
  store.confusions[key] = (store.confusions[key] || 0) + 1;
}

export function troublePairs(store) {
  const agg = {};
  for (const [key, count] of Object.entries(store.confusions)) {
    const [a, b] = key.split('→');
    const pairKey = [a, b].sort().join('|');
    agg[pairKey] = (agg[pairKey] || 0) + count;
  }
  return Object.entries(agg)
    .filter(([, count]) => count >= 3)
    .map(([pairKey, count]) => {
      const [a, b] = pairKey.split('|');
      const acc = (rec) => (rec ? recentAccuracy(rec) : 0);
      const pairAcc = Math.round(((acc(store.kana[a]) + acc(store.kana[b])) / 2) * 100);
      return { a, b, count, pairAcc };
    })
    .sort((x, y) => y.count - x.count || x.pairAcc - y.pairAcc);
}

// Pool for Confusables mode: detected pairs first, padded with classic pairs.
export function confusablePool(store, unlockedChars) {
  const chars = new Set();
  troublePairs(store).forEach(({ a, b }) => { chars.add(a); chars.add(b); });
  for (const [a, b] of SEED_PAIRS) {
    if (chars.size >= 16) break;
    if (unlockedChars.has(a) && unlockedChars.has(b)) { chars.add(a); chars.add(b); }
  }
  return [...chars].map((c) => BY_CHAR[c]).filter(Boolean);
}

// ---------- placement ----------
export const PLACEMENT_SAMPLE = 6;
export const PLACEMENT_PASS = 5;

export function placementSample(stageId) {
  const items = [...stageItems(stageId)];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, PLACEMENT_SAMPLE);
}

// Seed records after a passed/failed placement stage.
export function seedPlacement(store, stageId, results /* Map<char, boolean> */, passed) {
  const now = Date.now();
  for (const k of stageItems(stageId)) {
    const rec = getRecord(store, k.char);
    if (rec.reviews > 0) continue; // never overwrite real history
    const answered = results.get(k.char);
    if (answered === false) {
      Object.assign(rec, { reviews: 1, correct: 0, streak: 0, recent: '0', ease: 1.7, interval: 2, duePosition: store.global.reviewCount + 1, lastReviewed: now });
    } else if (answered === true) {
      Object.assign(rec, { reviews: 3, correct: 3, streak: 3, bestStreak: 3, recent: '111', ease: 2.2, interval: 24, duePosition: store.global.reviewCount + 24, lastReviewed: now });
    } else if (passed) {
      Object.assign(rec, { reviews: 2, correct: 2, streak: 2, bestStreak: 2, recent: '11', ease: 2.1, interval: 16, duePosition: store.global.reviewCount + 16, lastReviewed: now });
    }
  }
}

// ---------- misc derived ----------
export function dueCount(store) {
  const g = store.global.reviewCount;
  return unlockedKana(store).filter((k) => {
    const rec = store.kana[k.char];
    return rec && rec.reviews > 0 && rec.duePosition <= g;
  }).length;
}

export function nearlyMastered(store) {
  return unlockedKana(store)
    .map((k) => ({ k, rec: store.kana[k.char] }))
    .filter(({ rec }) => rec && masteryLevel(rec) === 3 && rec.streak >= 4)
    .map(({ k }) => k.char)
    .slice(0, 6);
}

export function dayStreak(store) {
  const days = new Set(store.global.sessionDates);
  const d = new Date();
  let streak = 0;
  // streak may start today or yesterday
  if (!days.has(isoDay(d))) d.setDate(d.getDate() - 1);
  while (days.has(isoDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
