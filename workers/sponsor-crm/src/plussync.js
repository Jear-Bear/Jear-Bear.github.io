// plussync.js — things tied to a signed-in crossword account (any account, member or not):
//   POST /public/plus/deck-use  { peek }       the free My deck puzzle: one per account, ever
//   POST /public/plus/load                     this account's saved progress
//   POST /public/plus/save      { data }       replace it (the page merges before saving)
// The page builds deck puzzles itself, so this is a fair-use check (no more resetting the
// count in a private window), not a lock: it's tied to the email instead of the browser.

import { needUser, isMember } from './plus.js';
import { HttpError } from './data.js';

const MAX_SAVE = 700 * 1024;          // about 60 deck puzzles plus every solve, with room to spare

async function body(request, max) {
  const t = await request.text();
  if (t.length > max) throw new HttpError(413, 'That’s too much to save. Try deleting some deck puzzles.');
  try { return JSON.parse(t) || {}; } catch { return {}; }
}

// One free deck puzzle per account, ever (plus_users.deck_free_at, migration 0021). The
// first deck puzzle an account makes is its free one, whether it's a member then or not
// (on the free week, say), so after that deck puzzles are for members. peek: just ask.
export async function deckUse(request, env) {
  const u = await needUser(request, env);
  const b = await body(request, 2000);
  const member = isMember(u);
  if (b.peek) return member ? { ok: true, unlimited: true } : { ok: true, left: u.deck_free_at ? 0 : 1 };
  // Claimed in one step, so two tabs at once can't both have it
  const r = await env.DB.prepare('UPDATE plus_users SET deck_free_at = ? WHERE id = ? AND deck_free_at IS NULL RETURNING id').bind(new Date().toISOString(), u.id).first();
  if (member) return { ok: true, unlimited: true };
  return r ? { ok: true, left: 0 } : { ok: false, used: true, left: 0 };
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
