// board-crossword.js — the Daily Kana Crossword's entry in the leaderboard registry (board.js).
//
// Result: { game: 'crossword', puzzleId, seconds, revealed, checked }
//   puzzleId  a published daily: {date}-{level}-{size} or {date}-kanji-{level}-{size}
//   seconds   the solve time; revealed: squares revealed; checked: squares Check marked wrong
// Points: finishing a mini 10, a daily 15; no revealed squares +5; streak +1 a day up to +5;
// the fastest three on each puzzle +3/+2/+1 once the daily post goes out (clean solves rank
// ahead of ones with reveals).

import { HttpError } from './data.js';
import { openSealed } from './sealed.js';

const ID = /^(\d{4}-\d{2}-\d{2})-(?:(kanji)-)?(beginner|intermediate|advanced|mixed)-(mini|daily)$/;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed'];
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', mixed: 'Mixed' };
const MIN_SECONDS = { mini: 8, daily: 25 };       // faster than this isn't typing, it's pasting
const HOUR = 3600000;

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// Which puzzles a day has, read from the site (sealed days are opened with the Worker's key)
const days = new Map();
async function puzzleIds(env, day) {
  const hit = days.get(day);
  if (hit && hit.at > Date.now() - 10 * 60000) return hit.ids;
  const site = env.CROSSWORD_SITE || 'https://www.jareddesu.com';
  const res = await fetch(`${site}/data/crossword/puzzles/${day}.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) return new Set();
  let f = await res.json();
  if (f && f.ct) f = await openSealed(env.DB, f);
  const ids = new Set(((f && f.puzzles) || []).map((p) => p.id));
  days.set(day, { ids, at: Date.now() });
  return ids;
}

export default {
  id: 'crossword',
  name: 'Daily Kana Crossword',
  idPattern: ID,

  async check(b, env) {
    const puzzleId = String(b.puzzleId || '');
    const m = ID.exec(puzzleId);
    if (!m) throw new HttpError(400, 'Not a daily puzzle');
    const day = m[1];
    // The streak's 48 hours, from the first time zone's midnight (UTC+14) to the last one's
    // end of the next day (UTC−12)
    const start = Date.parse(`${day}T00:00:00Z`);
    if (!(Date.now() >= start - 14 * HOUR && Date.now() <= start + 60 * HOUR)) throw new HttpError(400, 'That puzzle is closed for the leaderboard');
    const seconds = int(b.seconds, MIN_SECONDS[m[4]], 86400);
    if (seconds == null) throw new HttpError(400, 'That time doesn’t look right');
    const revealed = int(b.revealed, 0, 200);
    const checked = int(b.checked, 0, 200);
    if (revealed == null || checked == null) throw new HttpError(400, 'Bad result');
    if (!(await puzzleIds(env, day)).has(puzzleId)) throw new HttpError(400, 'No such puzzle');
    return { puzzleId, day, seconds, revealed, checked, won: 1 };
  },

  points(r, streak) {
    const size = ID.exec(r.puzzleId)[4];
    return (size === 'daily' ? 15 : 10) + (r.revealed ? 0 : 5) + Math.min(5, streak);
  },

  // Fastest first, clean solves ahead of ones with reveals, then whoever finished first
  compare: (a, b) => (a.revealed > 0) - (b.revealed > 0) || a.seconds - b.seconds || String(a.solved_at).localeCompare(String(b.solved_at)),
  podium: [3, 2, 1],

  streakName: 'crossword',

  // Two embeds, kana and kanji, one field per puzzle with finishers: the top three with medals
  // and times (✨ no reveals), then "+N more finished". The day's fastest solve gets 👑.
  embeds({ day, byPuzzle, medal, fmtSeconds, name }) {
    const crown = fastest(byPuzzle);
    const section = (kanji, title, color) => {
      const fields = [];
      eachPuzzle(day, kanji, byPuzzle, (label, list) => {
        const top = list.slice(0, 3).map((r, i) => `${medal(i)} ${name(r)} ${fmtSeconds(r.seconds)}${r.revealed ? '' : ' ✨'}${r === crown ? ' 👑' : ''}`).join('  ');
        fields.push({ name: label, value: `${top}${list.length > 3 ? `\n+${list.length - 3} more finished` : ''}` });
      });
      return fields.length ? { title, color, fields, footer: { text: '✨ no reveals · 👑 fastest of the day' } } : null;
    };
    return [section(false, 'Crossword · kana', 0x4c6cb3), section(true, 'Crossword · kanji', 0x42602d)].filter(Boolean);
  },

  // The picture: a card each for kana and kanji, a row of tiles per puzzle
  cards({ day, byPuzzle, fmtSeconds, displayName, avatarUrl, dayShort }) {
    const crown = fastest(byPuzzle);
    const card = (kanji, title) => {
      const sections = [];
      eachPuzzle(day, kanji, byPuzzle, (label, list) => sections.push({
        label,
        tiles: list.map((r) => ({ kind: 'crossword', name: displayName(r), avatarUrl: avatarUrl(r), time: fmtSeconds(r.seconds), clean: !r.revealed, crown: r === crown })),
      }));
      return sections.length ? { title: `${title}, ${dayShort}`, sections } : null;
    };
    return [card(false, 'Kana Crossword'), card(true, 'Kanji Crossword')].filter(Boolean);
  },
};

// Each puzzle of a mode that had finishers, in level and size order
function eachPuzzle(day, kanji, byPuzzle, fn) {
  LEVELS.forEach((level) => ['mini', 'daily'].forEach((size) => {
    const list = byPuzzle.get(`${day}-${kanji ? 'kanji-' : ''}${level}-${size}`);
    if (list && list.length) fn(`${LEVEL[level]} ${size}`, list);
  }));
}
// The day's fastest solve across every puzzle (clean solves first, like the ranking)
function fastest(byPuzzle) {
  let best = null;
  byPuzzle.forEach((list) => list.forEach((r) => {
    if (!best || (r.revealed > 0) - (best.revealed > 0) < 0 || ((r.revealed > 0) === (best.revealed > 0) && r.seconds < best.seconds)) best = r;
  }));
  return best;
}
