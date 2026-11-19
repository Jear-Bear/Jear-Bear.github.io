// commands.js — /leaderboard in Discord, for each of the Activity apps (discord.js apps()).
//
//   POST /discord/interactions    Discord's Interactions Endpoint URL (the same for every app)
//
// Not a bot: Discord sends each command here and the reply goes back in the response, in the
// channel where it was run. Every request is checked against the app's Ed25519 public key
// (DISCORD_*_PUBLIC_KEY in wrangler.toml), as Discord requires.
//
// /leaderboard scope:(server|global) period:(today|week|month)
//   Each app covers its own game: Kana Wordle, the crossword's kana puzzles (Kana Crossword) or
//   its kanji puzzles (Kanji Crossword). Only players who turned the leaderboard on (Settings
//   on the site) appear, by their Discord name or nickname, as plain text: nothing pings anyone.
//   "This server": players seen in that server, by playing an Activity there or running
//   /leaderboard there (guild_players; an app without a bot can't list a server's members).
//   Inside a server it's the default; in DMs it's always everyone. Today is Chicago's date,
//   like the morning post.
//
// The commands are registered on each deploy by scripts/register-commands.mjs.

import { GAMES, rankGame, chicagoDate, shortDay, esc, medal, fmtSeconds, displayName, avatarUrl } from './board.js';
import { addDays } from '../../../scripts/crossword/streak.js';

const SNOWFLAKE = /^\d{5,25}$/;
const LINK = 'https://www.jareddesu.com';

// Which game (and part of it) each app's /leaderboard covers
const BOARDS = {
  wordle: { game: 'wordle', title: 'Kana Wordle', url: `${LINK}/tools/wordle/`, keep: () => true },
  crossword: { game: 'crossword', title: 'Kana Crossword', url: `${LINK}/tools/crossword/`, keep: (id) => !/-kanji-/.test(id) },
  kanji: { game: 'crossword', title: 'Kanji Crossword', url: `${LINK}/tools/crossword/`, keep: (id) => /-kanji-/.test(id) },
};
const PERIOD = { today: 'Today', week: 'Last 7 days', month: 'This month' };

// The app a request is for, with its public key, by the application_id Discord sends
function appsWithKeys(env) {
  return [
    { id: env.DISCORD_CLIENT_ID, key: env.DISCORD_PUBLIC_KEY, board: 'wordle' },
    { id: env.DISCORD_KANA_CROSSWORD_CLIENT_ID, key: env.DISCORD_KANA_CROSSWORD_PUBLIC_KEY, board: 'crossword' },
    { id: env.DISCORD_KANJI_CROSSWORD_CLIENT_ID, key: env.DISCORD_KANJI_CROSSWORD_PUBLIC_KEY, board: 'kanji' },
  ].filter((a) => a.id && /^[0-9a-f]{64}$/i.test(String(a.key || '')));
}

const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
async function verified(key, signature, timestamp, body) {
  if (!/^[0-9a-f]{128}$/i.test(signature || '') || !/^\d{1,12}$/.test(timestamp || '')) return false;
  try {
    const k = await crypto.subtle.importKey('raw', hex(key), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', k, hex(signature), new TextEncoder().encode(timestamp + body));
  } catch { return false; }
}

const reply = (data) => new Response(JSON.stringify({ type: 4, data: { allowed_mentions: { parse: [] }, ...data } }), { headers: { 'Content-Type': 'application/json' } });

// --- the leaderboard -----------------------------------------------------------------------------
async function seen(env, guildId, discordId) {
  if (!SNOWFLAKE.test(guildId || '') || !SNOWFLAKE.test(discordId || '')) return;
  await env.DB.prepare('INSERT INTO guild_players (guild_id, discord_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, discord_id) DO UPDATE SET seen_at = excluded.seen_at')
    .bind(guildId, discordId, new Date().toISOString()).run();
}

// Opted-in results for the board's game between two days, in this server or everywhere
async function results(env, board, from, to, guildId) {
  const where = guildId
    ? 'AND p.discord_id IN (SELECT discord_id FROM guild_players WHERE guild_id = ?)'
    : '';
  const { results: rows } = await env.DB.prepare(`SELECT r.*, p.* FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1
    WHERE r.game = ? AND r.day BETWEEN ? AND ? ${where}`).bind(board.game, from, to, ...(guildId ? [guildId] : [])).all();
  return rows.filter((r) => board.keep(r.puzzle_id));
}

export async function leaderboard(env, boardName, { scope, period, guildId }) {
  const board = BOARDS[boardName];
  const entry = GAMES[board.game];
  const today = chicagoDate();
  const server = scope === 'server' && guildId;
  const where = server ? 'this server' : 'everyone';
  const head = `**${board.title} · ${PERIOD[period]} · ${where}**`;
  const empty = (what) => ({ content: `${head}\nNobody on the leaderboard ${what} yet. Turn it on in Settings at ${board.url} to show up here.` });
  if (period === 'today') {
    const rows = await results(env, board, today, today, server ? guildId : null);
    if (!rows.length) return empty('has played today');
    const { byPuzzle } = rankGame(entry, rows);
    const embeds = entry.embeds({ day: today, byPuzzle, esc, medal, fmtSeconds, displayName, avatarUrl, name: (r) => esc(displayName(r)), dayShort: shortDay(today) });
    return { content: `${head}\n${new Set(rows.map((r) => r.user_id)).size} playing so far, ${shortDay(today)} (Chicago)`, embeds: embeds.slice(0, 10) };
  }
  const from = period === 'week' ? addDays(today, -6) : `${today.slice(0, 7)}-01`;
  const rows = await results(env, board, from, today, server ? guildId : null);
  if (!rows.length) return empty(period === 'week' ? 'has played this week' : 'has played this month');
  const totals = new Map();
  rows.forEach((r) => {
    const t = totals.get(r.user_id) || { name: displayName(r), pts: 0, played: 0 };
    t.pts += r.points || 0;
    t.played += 1;
    totals.set(r.user_id, t);
  });
  const top = [...totals.values()].sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)).slice(0, 15);
  return {
    content: head,
    embeds: [{
      title: `Points · ${shortDay(from)} to ${shortDay(today)}`,
      color: 0xc9a227,
      description: top.map((x, i) => `${medal(i)} ${esc(x.name)}: ${x.pts} (${x.played} played)`).join('\n'),
      footer: { text: totals.size > top.length ? `+${totals.size - top.length} more` : 'Points for finishing, clean solves and streaks' },
    }],
  };
}

// --- Discord's requests ----------------------------------------------------------------------------
export async function interactions(request, env) {
  const body = await request.text();
  if (body.length > 20000) return new Response('Too big', { status: 413 });
  let msg;
  try { msg = JSON.parse(body); } catch { return new Response('Bad request', { status: 400 }); }
  const app = appsWithKeys(env).find((a) => a.id === String(msg.application_id || ''));
  if (!app || !(await verified(app.key, request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body))) {
    return new Response('Bad signature', { status: 401 });
  }
  if (msg.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { 'Content-Type': 'application/json' } });      // PING
  if (msg.type !== 2 || !msg.data || msg.data.name !== 'leaderboard') return reply({ content: 'Unknown command', flags: 64 });
  const opts = Object.fromEntries((msg.data.options || []).map((o) => [o.name, o.value]));
  const guildId = SNOWFLAKE.test(String(msg.guild_id || '')) ? String(msg.guild_id) : null;
  const user = (msg.member && msg.member.user) || msg.user || {};
  if (guildId) await seen(env, guildId, String(user.id || ''));
  const scope = opts.scope === 'global' || !guildId ? 'global' : 'server';
  const period = PERIOD[opts.period] ? opts.period : 'today';
  return reply(await leaderboard(env, app.board, { scope, period, guildId }));
}

export { seen as seenInGuild };
