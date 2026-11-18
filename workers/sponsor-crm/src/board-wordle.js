// board-wordle.js — Kana Wordle's entry in the leaderboard registry (board.js).
//
// Result: { game: 'wordle', puzzleId, guesses, hints, won, word }
//   puzzleId  wordle-{date}-{level}-{len}: one of the six dailies (3 levels × 4 or 5 kana)
//   word      the last guess; for a win it must be that day's answer, picked with the page's
//             own code (scripts/wordle/daily.js) from the published word list. A loss used all 8.
// Points: a win 10, plus 8 minus the guesses, +5 with no hints, streak +1 a day up to +5
// (days with a daily won); a loss 2 for playing. Ranked: won first, fewest guesses, fewest
// hints, earliest. No podium bonus.

import { HttpError } from './data.js';
import { decodeAnswers, dailyAnswer } from '../../../scripts/wordle/daily.js';

const ID = /^wordle-(\d{4}-\d{2}-\d{2})-(beginner|intermediate|advanced)-([45])$/;
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const TRIES = 8;
const HOUR = 3600000;

const lists = new Map();
async function answers(env, len) {
  const hit = lists.get(len);
  if (hit && hit.at > Date.now() - 30 * 60000) return hit.answers;
  const site = env.CROSSWORD_SITE || 'https://www.jareddesu.com';
  const res = await fetch(`${site}/data/wordle/words-${len}.json?v=3`, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new HttpError(503, 'Couldn’t check that word right now');
  const a = decodeAnswers((await res.json()).answers);
  lists.set(len, { answers: a, at: Date.now() });
  return a;
}

export default {
  id: 'wordle',
  name: 'Kana Wordle',
  idPattern: ID,
  streakWonOnly: true,

  async check(b, env) {
    const puzzleId = String(b.puzzleId || '');
    const m = ID.exec(puzzleId);
    if (!m) throw new HttpError(400, 'Not a daily word');
    const [, day, level, lenS] = m;
    // Someone's today or yesterday: from the first time zone's midnight (UTC+14) to the end
    // of the next day in the last one (UTC−12)
    const start = Date.parse(`${day}T00:00:00Z`);
    if (!(Date.now() >= start - 14 * HOUR && Date.now() <= start + 60 * HOUR)) throw new HttpError(400, 'That word is closed for the leaderboard');
    const guesses = Number.isInteger(b.guesses) && b.guesses >= 1 && b.guesses <= TRIES ? b.guesses : null;
    const hints = Number.isInteger(b.hints) && b.hints >= 0 && b.hints <= 2 ? b.hints : null;
    if (guesses == null || hints == null || typeof b.won !== 'boolean') throw new HttpError(400, 'Bad result');
    if (!b.won && guesses !== TRIES) throw new HttpError(400, 'Bad result');
    if (b.won) {
      const len = Number(lenS);
      const answer = dailyAnswer((await answers(env, len))[level], level, len, day);
      if (!answer || String(b.word || '') !== answer.a) throw new HttpError(400, 'That isn’t the word');
    }
    return { puzzleId, day, guesses, hints, won: b.won ? 1 : 0 };
  },

  points: (r, streak) => (r.won ? 10 + (TRIES - r.guesses) + (r.hints ? 0 : 5) + Math.min(5, streak) : 2),

  compare: (a, b) => (b.won - a.won) || a.guesses - b.guesses || a.hints - b.hints || String(a.solved_at).localeCompare(String(b.solved_at)),
  podium: null,

  // One embed, one line per level and length with players
  embeds({ day, byPuzzle, esc, medal }) {
    const lines = [];
    LEVELS.forEach((level) => [4, 5].forEach((len) => {
      const list = byPuzzle.get(`wordle-${day}-${level}-${len}`);
      if (!list || !list.length) return;
      const won = list.filter((r) => r.won);
      const missed = list.length - won.length;
      const top = won.slice(0, 3).map((r, i) => `${medal(i)} ${esc(r.nickname)} ${r.guesses}/${TRIES}${r.hints ? '' : ' ✨'}`).join('  ');
      if (!won.length) { lines.push(`**${LEVEL[level]} ${len}:** nobody got it (${missed} played)`); return; }
      const rest = [won.length > 3 ? `${won.length} got it` : '', missed ? `${missed} didn’t get it` : ''].filter(Boolean).join(', ');
      lines.push(`**${LEVEL[level]} ${len}:** ${top}${rest ? `  · ${rest}` : ''}`);
    }));
    return lines.length ? [{ title: 'Wordle', color: 0x5d8a3a, description: lines.join('\n'), footer: { text: '✨ no hints' } }] : [];
  },
};
