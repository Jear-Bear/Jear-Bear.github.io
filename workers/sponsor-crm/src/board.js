// board.js — the Discord leaderboard: opt-in results from the games, points, and one
// results post a day to a Discord channel webhook. It never pings anyone (a separate bot
// does the daily role ping) and it isn't a bot: it only sends a webhook message.
//
//   GET  /public/board/profile                     → { opt_in, nickname, discord } for the signed-in account
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
import wordle from './board-wordle.js';
import { renderResults } from './board-image.js';
import { discordOf } from './discord.js';

// The order is the order of their sections in the daily post
export const GAMES = { crossword, wordle };

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
// discord: the linked Discord account ({ id, username, avatar }) or null (discord.js)
const PROFILE = 'SELECT nickname, opt_in, discord_id, discord_username, discord_avatar FROM board_profiles WHERE user_id = ?';
const profileOut = (r) => ({ opt_in: Boolean(r && r.opt_in), nickname: r ? r.nickname || null : null, discord: discordOf(r) });

export async function getProfile(request, env) {
  const u = await needUser(request, env);
  return profileOut(await env.DB.prepare(PROFILE).bind(u.id).first());
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
  // With Discord linked, the Discord name shows instead, so a nickname is optional
  const had = await env.DB.prepare('SELECT discord_id FROM board_profiles WHERE user_id = ?').bind(u.id).first();
  const nickname = had && had.discord_id && !text(b.nickname, 60) ? '' : cleanNickname(b.nickname);
  await env.DB.prepare('INSERT INTO board_profiles (user_id, nickname, opt_in, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, opt_in = 1, updated_at = excluded.updated_at')
    .bind(u.id, nickname, at).run();
  return getProfileFor(env, u.id);
}
async function getProfileFor(env, id) {
  return { ok: true, ...profileOut(await env.DB.prepare(PROFILE).bind(id).first()) };
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
  const row = { seconds: null, guesses: null, hints: null, revealed: null, checked: null, pattern: null, won: 1, ...r };
  const at = new Date().toISOString();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO game_results (game, puzzle_id, day, user_id, seconds, guesses, hints, revealed, checked, pattern, won, solved_at, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(entry.id, row.puzzleId, row.day, u.id, row.seconds, row.guesses, row.hints, row.revealed, row.checked, row.pattern, row.won ? 1 : 0, at).run();
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
const shortDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Names are plain text: anything that reaches Discord is escaped, and nothing can ping
export const esc = (s) => String(s).replace(/[\\*_~`|>#[\]()<@:]/g, (c) => `\\${c}`);
export const fmtSeconds = (s) => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
export const medal = (i) => MEDALS[i] || `${i + 1}.`;

// Who a player is in the post and the picture: their Discord username and avatar when their
// account has Discord linked (the discord_* columns on board_profiles, discord.js), else their
// nickname and an initial circle
export const displayName = (r) => String((r.discord_id && r.discord_username) || r.nickname || '?');
export function avatarUrl(r) {
  if (!r.discord_id || !r.discord_avatar || !/^\d{5,25}$/.test(r.discord_id) || !/^(a_)?[0-9a-f]{20,40}$/.test(r.discord_avatar)) return null;
  return `https://cdn.discordapp.com/avatars/${r.discord_id}/${r.discord_avatar}.png?size=64`;
}

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

// The group's streak in a game: days in a row, up to `day`, with at least one result from
// someone on the leaderboard
async function groupStreak(env, game, day) {
  const { results } = await env.DB.prepare('SELECT DISTINCT r.day FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1 WHERE r.game = ? AND r.day <= ? AND r.day > ?')
    .bind(game, day, addDays(day, -400)).all();
  const days = new Set(results.map((r) => r.day));
  let n = 0;
  for (let d = day; days.has(d); d = addDays(d, -1)) n++;
  return n;
}

async function totals(env, from, to, pending) {
  const { results } = await env.DB.prepare('SELECT r.user_id, p.*, SUM(r.points) AS pts FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1 WHERE r.day BETWEEN ? AND ? GROUP BY r.user_id')
    .bind(from, to).all();
  const map = new Map(results.map((r) => [r.user_id, { name: displayName(r), pts: r.pts || 0 }]));
  pending.forEach((b) => { const x = map.get(b.user_id); if (x) x.pts += b.bonus; });
  return [...map.values()].sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

// Discord's limits: 10 embeds, 4096 per description, 25 fields of 1024, 6000 characters in all
function trimLines(text, max) {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  while (lines.length > 1 && lines.join('\n').length > max - 2) lines.splice(lines.length - 1, 1);
  const out = lines.join('\n');
  return out.length > max - 2 ? `${out.slice(0, max - 2)}…` : `${out}\n…`;
}
function fit(embeds) {
  const list = embeds.slice(0, 10).map((e) => ({
    ...e,
    ...(e.description != null ? { description: trimLines(String(e.description), 4096) } : {}),
    ...(e.fields ? { fields: e.fields.slice(0, 25).map((f) => ({ ...f, name: String(f.name).slice(0, 256), value: trimLines(String(f.value), 1024) })) } : {}),
  }));
  const size = () => list.reduce((n, e) => n + (e.title || '').length + (e.description || '').length + ((e.footer && e.footer.text) || '').length
    + (e.fields || []).reduce((m, f) => m + f.name.length + f.value.length, 0), 0);
  while (size() > 5800) {
    // Shorten the longest block by its last line
    let best = null;
    list.forEach((e) => {
      if (e.description && (!best || e.description.length > best.len)) best = { len: e.description.length, set: (v) => { e.description = v; }, get: () => e.description };
      (e.fields || []).forEach((f) => { if (!best || f.value.length > best.len) best = { len: f.value.length, set: (v) => { f.value = v; }, get: () => f.value }; });
    });
    if (!best || best.len < 4) break;
    best.set(trimLines(best.get(), best.len - 40));
  }
  return list;
}

// The message for `day` (a Chicago date), or null when nobody played. bonuses: the podium
// points to add once it's sent; cards: what the picture shows (board-image.js).
export async function buildPost(env, day) {
  const { results } = await env.DB.prepare('SELECT r.*, p.* FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1 WHERE r.day = ?').bind(day).all();
  if (!results.length) return null;
  const embeds = [];
  const cards = [];
  const streaks = [];
  let bonuses = [];
  const helpers = { day, esc, medal, fmtSeconds, displayName, avatarUrl, name: (r) => esc(displayName(r)), dayShort: shortDay(day) };
  for (const entry of Object.values(GAMES)) {
    const rows = results.filter((r) => r.game === entry.id);
    if (!rows.length) continue;
    const ranked = rankGame(entry, rows);
    bonuses = bonuses.concat(ranked.bonuses);
    const streak = await groupStreak(env, entry.id, day);
    streaks.push(streak > 1 ? `**Your group is on a ${streak} day ${entry.streakName} streak! 🔥**` : `**Day 1 of a new ${entry.streakName} group streak! 🔥**`);
    embeds.push(...entry.embeds({ ...helpers, byPuzzle: ranked.byPuzzle }));
    if (entry.cards) cards.push(...entry.cards({ ...helpers, byPuzzle: ranked.byPuzzle }).map((c) => ({ ...c, streak })));
  }
  const players = new Set(results.map((r) => r.user_id)).size;
  const solves = results.filter((r) => r.won).length;
  const posting = addDays(day, 1);
  // Mondays: last week's points (Mon–Sun, the day being posted is that Sunday)
  if (new Date(`${posting}T12:00:00Z`).getUTCDay() === 1) {
    const top = (await totals(env, addDays(day, -6), day, bonuses)).slice(0, 10);
    if (top.length) embeds.push({ title: 'Last week’s points', color: 0xc9a227, description: top.map((x, i) => `${medal(i)} ${esc(x.name)}: ${x.pts}`).join('\n') });
  }
  // The 1st: last month's season winners
  if (posting.endsWith('-01')) {
    const top = (await totals(env, `${day.slice(0, 7)}-01`, day, bonuses)).slice(0, 3);
    if (top.length) embeds.push({ title: `Season winners · ${monthLabel(day)}`, color: 0xc9a227, description: top.map((x, i) => `${medal(i)} ${esc(x.name)}: ${x.pts} points`).join('\n') });
  }
  return {
    message: {
      content: [...streaks, `Daily results for ${dayLabel(day)} · ${players} ${players === 1 ? 'player' : 'players'}, ${solves} ${solves === 1 ? 'solve' : 'solves'}`].join('\n'),
      embeds: fit(embeds).slice(0, 9),          // room for the picture's embed
      allowed_mentions: { parse: [] },
    },
    bonuses,
    cards,
  };
}

// The picture for a built post (PNG bytes), or null if it can't be made (the post goes out as text)
const MAX_PNG = 1024 * 1024;
export async function postImage(post) {
  if (!post || !post.cards.length) return null;
  try {
    const t0 = Date.now();
    const png = await renderResults(post.cards);
    console.log('Board image', png.length, 'bytes in', Date.now() - t0, 'ms');
    return png.length <= MAX_PNG ? png : null;
  } catch (err) {
    console.error('Board image failed', err && err.message, err && err.stack && err.stack.split('\n').slice(0, 4).join(' | '));
    return null;
  }
}

// GET /api/board/preview?day=…[&format=png]: the message as it would be sent, or its picture
// (nothing is sent or saved)
export async function previewPost(env, dayParam, format) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam || '') ? dayParam : addDays(chicagoDate(), -1);
  const post = await buildPost(env, day);
  if (format === 'png') {
    const png = await postImage(post);
    if (!png) return new Response(JSON.stringify({ error: post ? 'Couldn’t draw the picture' : 'Nobody played that day' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }
  const sent = await env.DB.prepare("SELECT posted_at FROM discord_posts WHERE day = ? AND kind = 'daily'").bind(day).first();
  return { day, posted_at: sent ? sent.posted_at : null, message: post ? post.message : null, bonuses: post ? post.bonuses.length : 0, picture: post && post.cards.length ? `add &format=png to see it` : null };
}

// The picture goes on by editing the post (Discord lets a webhook edit its own messages), so
// the text is out before the picture is drawn: if drawing fails, or the run is stopped for
// using too much CPU, the post is already there and the next cron run tries the picture again.
async function attachPicture(env, hook, day, messageId, post) {
  const png = await postImage(post);
  if (!png) return false;
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    embeds: [...post.message.embeds, { color: 0x121213, image: { url: 'attachment://results.png' } }],
    attachments: [{ id: 0, filename: 'results.png' }],
    allowed_mentions: { parse: [] },
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'results.png');
  const res = await fetch(`${hook}/messages/${messageId}`, { method: 'PATCH', body: form });
  if (!res.ok) { console.error('Adding the picture failed', res.status, (await res.text().catch(() => '')).slice(0, 300)); return false; }
  await env.DB.prepare("UPDATE discord_posts SET picture_at = ? WHERE day = ? AND kind = 'daily'").bind(new Date().toISOString(), day).run();
  return true;
}

// The cron (14:05 and 15:05 UTC, so one of them is 9:05 in Chicago whatever the season).
// Posts yesterday's results when Chicago's time has reached DISCORD_POST_HOUR:MINUTE (default
// 9:05) and it hasn't been posted yet, then adds the picture. The later run retries a failed
// post, or a picture that didn't make it.
export async function dailyPost(env, when = Date.now()) {
  const hook = env.DISCORD_CROSSWORD_WEBHOOK;
  if (!hook) return { skipped: 'no webhook' };
  if (!WEBHOOK.test(hook) && !(env.ALLOW_LOCALHOST === 'true' && /^http:\/\/localhost:\d+\//.test(hook))) { console.error('DISCORD_CROSSWORD_WEBHOOK isn’t a Discord webhook URL'); return { skipped: 'bad webhook' }; }
  const p = chicagoParts(new Date(when));
  const now = Number(p.hour) * 60 + Number(p.minute);
  const target = (Number(env.DISCORD_POST_HOUR ?? 9) || 0) * 60 + (Number(env.DISCORD_POST_MINUTE ?? 5) || 0);
  if (now < target || now >= target + 120) return { skipped: 'not time' };
  const day = addDays(`${p.year}-${p.month}-${p.day}`, -1);
  const done = await env.DB.prepare("SELECT message_id, picture_at FROM discord_posts WHERE day = ? AND kind = 'daily'").bind(day).first();
  if (done) {
    if (done.message_id && !done.picture_at) {
      const built = await buildPost(env, day);
      if (built) await attachPicture(env, hook, day, done.message_id, built);
      return { ok: true, day, retried: 'picture' };
    }
    return { skipped: 'posted' };
  }
  const post = await buildPost(env, day);
  if (!post) return { skipped: 'nobody played' };
  const res = await fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post.message) });
  if (!res.ok) {
    console.error('Discord post failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return { error: res.status };
  }
  const sent = await res.json().catch(() => ({}));
  const messageId = /^\d{5,25}$/.test(String(sent.id || '')) ? String(sent.id) : null;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO discord_posts (day, kind, posted_at, message_id) VALUES (?, 'daily', ?, ?)").bind(day, new Date().toISOString(), messageId),
    ...post.bonuses.map((x) => env.DB.prepare('UPDATE game_results SET points = points + ? WHERE game = ? AND puzzle_id = ? AND user_id = ?').bind(x.bonus, x.game, x.puzzle_id, x.user_id)),
  ]);
  if (messageId) await attachPicture(env, hook, day, messageId, post);
  return { ok: true, day };
}
