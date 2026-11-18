// daily.js — which word is the daily, shared by the page (app.js) and the sponsor Worker's
// leaderboard check (workers/sponsor-crm/src/board-wordle.js), so both pick the same word.
//
// Each level and length has a fixed, seeded shuffle of its answers; day N (Oct 1, 2026 is #1)
// is the Nth word in it. Never reorder the answers in a word list that's been used: that would
// change those days' words.
//
// Two sets of lists: data/wordle/words-*.json (the first ones, frozen) for the dailies before
// V2_FROM, and data/wordle/v2/words-*.json (wider, with the Mixed level) from V2_FROM on, with
// their own shuffle that starts at #1 on V2_FROM. So every day before V2_FROM keeps its word.
// Mixed is every level of the v2 lists together (it isn't stored separately).

export const START = '2026-10-01';
export const V2_FROM = '2026-11-19';
export const LEVELS = ['beginner', 'intermediate', 'advanced'];

// The word list a day uses ('mixed' only exists in v2; practice games use v2)
export const listFile = (len, date, level) => (level === 'mixed' || !date || date >= V2_FROM ? `v2/words-${len}.json` : `words-${len}.json`);
// The answers a level draws from
export const poolFor = (answers, level) => (level === 'mixed' ? LEVELS.flatMap((l) => answers[l] || []) : answers[level] || []);
// Accepted guesses: v2 keeps them as one string of fixed-length words, the first lists as an array
export const validSet = (valid, len) => new Set(typeof valid === 'string' ? valid.match(new RegExp(`.{${len}}`, 'gu')) || [] : valid);

// The answer lists are lightly encoded (reversed base64 of UTF-8 JSON) so they don't show in view-source
export function decodeAnswers(s) {
  const bin = atob(String(s).split('').reverse().join(''));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export function rng(seed) {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled(list, seed) {
  const r = rng(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export const dayNumber = (date) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${START}T12:00:00Z`)) / 86400000) + 1;

// The daily answer entry ({ a, w, r, m, j?, … }) for a level's pool (from listFile's list, via
// poolFor), length and date
export function dailyAnswer(pool, level, len, date) {
  if (level === 'mixed' || date >= V2_FROM) {
    const n = Math.max(0, dayNumber(date) - dayNumber(V2_FROM));
    return shuffled(pool, `v2:${level}:${len}`)[n % pool.length];
  }
  const day = Math.max(1, dayNumber(date));
  return shuffled(pool, `${level}:${len}`)[(day - 1) % pool.length];
}
