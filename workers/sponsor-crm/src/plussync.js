// plussync.js — things tied to a signed-in crossword account (any account, member or not):
//   POST /public/plus/deck-use  { day, peek }  the free My deck puzzle: one per account per day
//   POST /public/plus/load                     this account's saved progress
//   POST /public/plus/save      { data }       replace it (the page merges before saving)
// The page builds deck puzzles itself, so this is a fair-use check (no more resetting the
// count in a private window), not a lock: it's tied to the email instead of the browser.

import { needUser, isMember } from './plus.js';
import { HttpError } from './data.js';

const MAX_SAVE = 700 * 1024;          // about 60 deck puzzles plus every solve, with room to spare
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function body(request, max) {
  const t = await request.text();
  if (t.length > max) throw new HttpError(413, 'That’s too much to save. Try deleting some deck puzzles.');
  try { return JSON.parse(t) || {}; } catch { return {}; }
}

// The person's own calendar day, as long as it's a real one somewhere on Earth right now
function checkDay(day) {
  if (!DAY.test(day || '')) throw new HttpError(400, 'Bad date');
  const now = Date.now();
  const ok = [-12, 0, 14].some((h) => new Date(now + h * 3600000).toISOString().slice(0, 10) === day);
  if (!ok) throw new HttpError(400, 'Check the date on this device');
  return day;
}

export async function deckUse(request, env) {
  const u = await needUser(request, env);
  const b = await body(request, 2000);
  const day = checkDay(b.day);
  if (isMember(u)) return { ok: true, unlimited: true };
  if (b.peek) {
    const r = await env.DB.prepare('SELECT 1 FROM plus_deck_uses WHERE user_id = ? AND day = ?').bind(u.id, day).first();
    return { ok: true, left: r ? 0 : 1 };
  }
  const r = await env.DB.prepare('INSERT OR IGNORE INTO plus_deck_uses (user_id, day) VALUES (?, ?)').bind(u.id, day).run();
  // Old rows are no use to anyone
  await env.DB.prepare("DELETE FROM plus_deck_uses WHERE day < date('now', '-3 days')").run();
  return r.meta && r.meta.changes ? { ok: true, left: 0 } : { ok: false, used: true, left: 0 };
}

export async function loadSave(request, env) {
  const u = await needUser(request, env);
  const r = await env.DB.prepare('SELECT data, updated_at FROM plus_saves WHERE user_id = ?').bind(u.id).first();
  if (!r) return { data: null };
  try { return { data: JSON.parse(r.data), updated_at: r.updated_at }; } catch { return { data: null }; }
}

export async function putSave(request, env) {
  const u = await needUser(request, env);
  const b = await body(request, MAX_SAVE);
  if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw new HttpError(400, 'Nothing to save');
  const data = JSON.stringify(b.data);
  if (data.length > MAX_SAVE) throw new HttpError(413, 'That’s too much to save. Try deleting some deck puzzles.');
  const at = new Date().toISOString();
  await env.DB.prepare('INSERT INTO plus_saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(u.id, data, at).run();
  return { ok: true, updated_at: at };
}
