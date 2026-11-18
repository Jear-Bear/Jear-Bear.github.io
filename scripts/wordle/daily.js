// daily.js — which word is the daily, shared by the page (app.js) and the sponsor Worker's
// leaderboard check (workers/sponsor-crm/src/board-wordle.js), so both pick the same word.
//
// Each level and length has a fixed, seeded shuffle of its answers; day N (Oct 1, 2026 is #1)
// is the Nth word in it. Never reorder the answers in data/wordle/words-*.json: that would
// change every day's word. (scripts/wordle/clues.mjs has its own copy for Node.)

export const START = '2026-10-01';

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

// The daily answer entry ({ a, w, r, m, … }) for a level's answer pool, length and date
export function dailyAnswer(pool, level, len, date) {
  const day = Math.max(1, dayNumber(date));
  return shuffled(pool, `${level}:${len}`)[(day - 1) % pool.length];
}
