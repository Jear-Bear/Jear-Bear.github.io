// board.js — the Discord leaderboard: opt-in results from the games, points, and one
// results post a day to a Discord channel webhook. It never pings anyone (a separate bot
// does the daily role ping) and it isn't a bot: it only sends a webhook message.
//
//   GET  /public/board/profile                     → { opt_in, nickname } for the signed-in account
//   POST /public/board/profile { opt_in, nickname }  turning it off deletes their results
//   POST /public/board/result  { game, puzzleId, … } a finished game (opted-in accounts only)
//   GET  /api/board/preview?day=YYYY-MM-DD           the post for a day, built but not sent (desk login)
//
// Each game joins through GAMES below: one entry per game (board-<game>.js) with its puzzle
// ID pattern, the checks on a result, its points, how a puzzle's finishers are ranked, the
// podium bonus (if any) and the embeds it adds to the daily post. docs/crossword.md,
// "Discord leaderboard".
//
// The nickname and the opt-in belong to the account, so one switch covers every game.

import { HttpError } from './data.js';
import { needUser, limit } from './plus.js';
import { text } from './public.js';
import { dailyStreak, addDays } from '../../../scripts/crossword/streak.js';
import crossword from './board-crossword.js';

export const GAMES = { crossword };

const TZ = 'America/Chicago';
const MEDALS = ['🥇', '🥈', '🥉'];
const NICK = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} .'\-ー・]*$/u;
const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

async function readBody(request) {
  try { return JSON.parse((await request.text()).slice(0, 4000)) || {}; } catch { return {}; }
}

// A nickname as it will show in Discord: 2–20 characters of letters, numbers, spaces and
// a little punctuation, so no @, links, mentions or Discord markdown can get through.
export function cleanNickname(v) {
  const s = text(v, 60).replace(/\s+/g, ' ');
  const n = [...s].length;
  if (n < 2 || n > 20) throw new HttpError(400, 'Pick a nickname of 2 to 20 characters.');
  if (!NICK.test(s) || /\.\p{L}{2,}/u.test(s) || /discord|https?|www/i.test(s)) throw new HttpError(400, 'Nicknames can use letters, numbers, spaces, dots, dashes and apostrophes, but no links.');
  return s;
}

// --- the signed-in account's profile ------------------------------------------------------
export async function getProfile(request, env) {
  const u = await needUser(request, env);
  const r = await env.DB.prepare('SELECT nickname, opt_in FROM board_profiles WHERE user_id = ?').bind(u.id).first();
  return { opt_in: Boolean(r && r.opt_in), nickname: r ? r.nickname : null };
}

export async function putProfile(request, env) {
  const u = await needUser(request, env);
  await limit(request, env, 'board-profile', 30);
  const b = await readBody(request);
  const at = new Date().toISOString();
  if (!b.opt_in) {
    // Off: their results go (from every game); the nickname stays for next time
    await env.DB.batch([
      env.DB.prepare('DELETE FROM game_results WHERE user_id = ?').bind(u.id),
      env.DB.prepare('UPDATE board_profiles SET opt_in = 0, updated_at = ? WHERE user_id = ?').bind(at, u.id),
    ]);
    return getProfileFor(env, u.id);
  }
  const nickname = cleanNickname(b.nickname);
  await env.DB.prepare('INSERT INTO board_profiles (user_id, nickname, opt_in, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, opt_in = 1, updated_at = excluded.updated_at')
    .bind(u.id, nickname, at).run();
  return getProfileFor(env, u.id);
}
async function getProfileFor(env, id) {
  const r = await env.DB.prepare('SELECT nickname, opt_in FROM board_profiles WHERE user_id = ?').bind(id).first();
  return { ok: true, opt_in: Boolean(r && r.opt_in), nickname: r ? r.nickname : null };
}

// --- results ----------------------------------------------------------------------------------
// The account's current streak in a game on `day`, by the rule in streak.js: consecutive
// days each with a counted result. Results only exist inside each day's 48 hours, so a
// day with a row is a day that kept the streak.
async function streakOn(env, game, userId, day, wonOnly) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT day FROM game_results WHERE game = ? AND user_id = ? AND day BETWEEN ? AND ?${wonOnly ? ' AND won = 1' : ''}`)
    .bind(game, userId, addDays(day, -10), day).all();
  const progress = Object.fromEntries(results.map((r) => [`${r.day}-board`, { done: true }]));
  return dailyStreak(progress, day).current;
}

export async function postResult(request, env) {
  const u = await needUser(request, env);
  await limit(request, env, 'board-result', 120);
  const b = await readBody(request);
  const entry = Object.prototype.hasOwnProperty.call(GAMES, b.game) ? GAMES[b.game] : null;
  if (!entry) throw new HttpError(400, 'Unknown game');
  const p = await env.DB.prepare('SELECT opt_in FROM board_profiles WHERE user_id = ?').bind(u.id).first();
  if (!p || !p.opt_in) return { ok: false, reason: 'off' };
  const r = await entry.check(b, env);                // { puzzleId, day, seconds, guesses, hints, revealed, checked, won }
  const row = { seconds: null, guesses: null, hints: null, revealed: null, checked: null, won: 1, ...r };
  const at = new Date().toISOString();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO game_results (game, puzzle_id, day, user_id, seconds, guesses, hints, revealed, checked, won, solved_at, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(entry.id, row.puzzleId, row.day, u.id, row.seconds, row.guesses, row.hints, row.revealed, row.checked, row.won ? 1 : 0, at).run();
  if (!ins.meta || !ins.meta.changes) return { ok: true, duplicate: true };        // the first result counts
  // Points need this day in the streak, so they're set right after the row is in
  const streak = row.won ? await streakOn(env, entry.id, u.id, row.day, Boolean(entry.streakWonOnly)) : 0;
  const points = entry.points(row, streak);
  await env.DB.prepare('UPDATE game_results SET points = ? WHERE game = ? AND puzzle_id = ? AND user_id = ?').bind(points, entry.id, row.puzzleId, u.id).run();
  return { ok: true, points, streak };
}

// --- the daily post -----------------------------------------------------------------------------
const chicagoParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(d).map((p) => [p.type, p.value]));
export const chicagoDate = (d = new Date()) => { const p = chicagoParts(d); return `${p.year}-${p.month}-${p.day}`; };
const dayLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Nicknames are already plain, but anything that reaches Discord is escaped anyway
export const esc = (s) => String(s).replace(/[\\*_~`|>#[\]()<@:]/g, (c) => `\\${c}`);
export const fmtSeconds = (s) => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
export const medal = (i) => MEDALS[i] || `${i + 1}.`;

// Each puzzle's finishers in the game's order, with rank (0 = first) and the podium bonus
function rankGame(entry, rows) {
  const byPuzzle = new Map();
  rows.forEach((r) => { if (!byPuzzle.has(r.puzzle_id)) byPuzzle.set(r.puzzle_id, []); byPuzzle.get(r.puzzle_id).push(r); });
  const bonuses = [];
  byPuzzle.forEach((list) => {
    list.sort(entry.compare);
    list.forEach((r, i) => {
      r.rank = i;
      const bonus = (entry.podium && r.won && entry.podium[i]) || 0;
      if (bonus) bonuses.push({ game: entry.id, puzzle_id: r.puzzle_id, user_id: r.user_id, bonus });
    });
  });
  return { byPuzzle, bonuses };
}

async function totals(env, from, to, pending) {
  const { results } = await env.DB.prepare('SELECT r.user_id, p.nickname, SUM(r.points) AS pts FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1 WHERE r.day BETWEEN ? AND ? GROUP BY r.user_id')
    .bind(from, to).all();
  const map = new Map(results.map((r) => [r.user_id, { nickname: r.nickname, pts: r.pts || 0 }]));
  pending.forEach((b) => { const x = map.get(b.user_id); if (x) x.pts += b.bonus; });
  return [...map.values()].sort((a, b) => b.pts - a.pts || a.nickname.localeCompare(b.nickname));
}

// Discord's limits: 10 embeds, 4096 per description, 6000 characters across all embeds
function fit(embeds) {
  const list = embeds.slice(0, 10).map((e) => ({ ...e, description: String(e.description || '').slice(0, 4000) }));
  const size = () => list.reduce((n, e) => n + (e.title || '').length + e.description.length + ((e.footer && e.footer.text) || '').length, 0);
  while (size() > 5800) {
    const big = list.reduce((a, e) => (e.description.length > a.description.length ? e : a));
    const lines = big.description.split('\n');
    if (lines.length <= 1) { big.description = `${big.description.slice(0, Math.max(0, big.description.length - 500))}…`; continue; }
    lines.splice(lines.length - (lines[lines.length - 1] === '…' ? 2 : 1), 1, '…');
    big.description = lines.join('\n');
  }
  return list;
}

// The message for `day` (a Chicago date), or null when nobody played. bonuses: the podium
// points to add once it's sent.
export async function buildPost(env, day) {
  const { results } = await env.DB.prepare('SELECT r.*, p.nickname FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1 WHERE r.day = ?').bind(day).all();
  if (!results.length) return null;
  const embeds = [];
  let bonuses = [];
  Object.values(GAMES).forEach((entry) => {
    const rows = results.filter((r) => r.game === entry.id);
    if (!rows.length) return;
    const ranked = rankGame(entry, rows);
    bonuses = bonuses.concat(ranked.bonuses);
    embeds.push(...entry.embeds({ day, byPuzzle: ranked.byPuzzle, esc, medal, fmtSeconds }));
  });
  const players = new Set(results.map((r) => r.user_id)).size;
  const solves = results.filter((r) => r.won).length;
  const posting = addDays(day, 1);
  // Mondays: last week's points (Mon–Sun, the day being posted is that Sunday)
  if (new Date(`${posting}T12:00:00Z`).getUTCDay() === 1) {
    const top = (await totals(env, addDays(day, -6), day, bonuses)).slice(0, 10);
    if (top.length) embeds.push({ title: 'Last week’s points', color: 0xc9a227, description: top.map((x, i) => `${medal(i)} ${esc(x.nickname)}: ${x.pts}`).join('\n') });
  }
  // The 1st: last month's season winners
  if (posting.endsWith('-01')) {
    const top = (await totals(env, `${day.slice(0, 7)}-01`, day, bonuses)).slice(0, 3);
    if (top.length) embeds.push({ title: `Season winners · ${monthLabel(day)}`, color: 0xc9a227, description: top.map((x, i) => `${medal(i)} ${esc(x.nickname)}: ${x.pts} points`).join('\n') });
  }
  return {
    message: {
      content: `Daily results for ${dayLabel(day)}: ${players} ${players === 1 ? 'player' : 'players'}, ${solves} ${solves === 1 ? 'solve' : 'solves'}`,
      embeds: fit(embeds),
      allowed_mentions: { parse: [] },
    },
    bonuses,
  };
}

// GET /api/board/preview?day=…: the message as it would be sent (nothing is sent or saved)
export async function previewPost(env, dayParam) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam || '') ? dayParam : addDays(chicagoDate(), -1);
  const post = await buildPost(env, day);
  const sent = await env.DB.prepare("SELECT posted_at FROM discord_posts WHERE day = ? AND kind = 'daily'").bind(day).first();
  return { day, posted_at: sent ? sent.posted_at : null, message: post ? post.message : null, bonuses: post ? post.bonuses.length : 0 };
}

// The cron (14:05 and 15:05 UTC, so one of them is 9:05 in Chicago whatever the season).
// Posts yesterday's results when Chicago's time has reached DISCORD_POST_HOUR:MINUTE (default
// 9:05) and it hasn't been posted yet. The later run retries a failed post.
export async function dailyPost(env, when = Date.now()) {
  const hook = env.DISCORD_CROSSWORD_WEBHOOK;
  if (!hook) return { skipped: 'no webhook' };
  if (!WEBHOOK.test(hook) && !(env.ALLOW_LOCALHOST === 'true' && /^http:\/\/localhost:\d+\//.test(hook))) { console.error('DISCORD_CROSSWORD_WEBHOOK isn’t a Discord webhook URL'); return { skipped: 'bad webhook' }; }
  const p = chicagoParts(new Date(when));
  const now = Number(p.hour) * 60 + Number(p.minute);
  const target = (Number(env.DISCORD_POST_HOUR ?? 9) || 0) * 60 + (Number(env.DISCORD_POST_MINUTE ?? 5) || 0);
  if (now < target || now >= target + 120) return { skipped: 'not time' };
  const day = addDays(`${p.year}-${p.month}-${p.day}`, -1);
  const done = await env.DB.prepare("SELECT 1 FROM discord_posts WHERE day = ? AND kind = 'daily'").bind(day).first();
  if (done) return { skipped: 'posted' };
  const post = await buildPost(env, day);
  if (!post) return { skipped: 'nobody played' };
  const res = await fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post.message) });
  if (!res.ok) {
    console.error('Discord post failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return { error: res.status };
  }
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO discord_posts (day, kind, posted_at) VALUES (?, 'daily', ?)").bind(day, new Date().toISOString()),
    ...post.bonuses.map((x) => env.DB.prepare('UPDATE game_results SET points = points + ? WHERE game = ? AND puzzle_id = ? AND user_id = ?').bind(x.bonus, x.game, x.puzzle_id, x.user_id)),
  ]);
  return { ok: true, day };
}
