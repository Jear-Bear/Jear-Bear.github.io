// discord.js — Discord account linking and sign-in (OAuth2, scope "identify" only), and the
// Discord Activity's sign-in and channel results (Kana Wordle and the Daily Kana Crossword). docs/discord-activity.md.
//
//   GET  /public/board/discord/config                  → { clientId } (null while it isn't set up)
//   POST /public/board/discord/start  { mode, redirect, back }  → { url } to send the person to
//        mode 'link' (signed in: link Discord to this account) or 'signin' (an account that has
//        Discord linked already). redirect: this site's /discord/ page, which Discord returns to.
//   POST /public/board/discord/finish { code, state }  → { mode, back, token?, user?, discord }
//   POST /public/board/discord/unlink                   clears the Discord data at once
//   POST /public/board/activity/token   { code }        the Activity's sign-in (Embedded App SDK)
//   POST /public/board/activity/finish  { channelId, game, puzzleId, … }  a daily finished in the Activity
//   POST /public/board/activity/channel { channelId, day, ids }      who in the channel finished
//   POST /public/board/activity/forget                  deletes this Discord account's Activity results
//
// What's kept from Discord: the account's ID, username and avatar hash, on its leaderboard
// profile (board_profiles), and nothing else; Discord's access token is never stored. One
// Discord account per site account and the other way round, and accounts are never merged:
// signing in with a Discord that isn't linked yet is refused (sign in another way, then link
// it in Settings). Crossword+ stays with the site account, as before.
//
// Discord's Developer Terms (5(a), 5(b), 9(b)): this data is used only for showing the
// player's name and avatar on the leaderboard and in the Activity, never sold or shared,
// and deleted when they unlink, delete the account, or the app is shut down.

import { HttpError } from './data.js';
import { needUser, sessionUser, limit, issue, publicUser, sha256, randomToken } from './plus.js';
import { hmacHex, text } from './public.js';
import { addDays } from '../../../scripts/crossword/streak.js';
import wordle from './board-wordle.js';
import crossword from './board-crossword.js';

const ACTIVITY_GAMES = { wordle, crossword };        // the games the Activity plays

const API = 'https://discord.com/api/v10';
const STATE_TTL = 600;                  // seconds
const ACTIVITY_TTL = 12 * 3600;
const SNOWFLAKE = /^\d{5,25}$/;
const AVATAR = /^(a_)?[0-9a-f]{20,40}$/;

const api = (env) => env.DISCORD_API_BASE || API;       // override: local tests only
export const discordOn = (env) => Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
// The Activity runs at https://<client id>.discordsays.com (Discord's proxy)
export const activityOrigin = (env) => (env.DISCORD_CLIENT_ID && SNOWFLAKE.test(env.DISCORD_CLIENT_ID) ? `https://${env.DISCORD_CLIENT_ID}.discordsays.com` : null);

async function readBody(request) {
  try { return JSON.parse((await request.text()).slice(0, 8000)) || {}; } catch { return {}; }
}
function needOn(env) { if (!discordOn(env)) throw new HttpError(503, 'Discord sign-in isn’t set up'); }

// --- Discord's API ---------------------------------------------------------------------------
// A code from Discord → the person's { id, username, avatar }. The access token goes back to
// the Activity (the SDK needs it) but is never stored here.
async function exchange(env, code, redirectUri) {
  if (!/^[\w-]{10,100}$/.test(code)) throw new HttpError(400, 'Bad Discord code');
  const form = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code });
  if (redirectUri) form.set('redirect_uri', redirectUri);
  const res = await fetch(`${api(env)}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) throw new HttpError(400, 'Discord didn’t accept that sign-in. Please try again.');
  const me = await fetch(`${api(env)}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const u = await me.json().catch(() => ({}));
  if (!me.ok || !SNOWFLAKE.test(String(u.id || ''))) throw new HttpError(502, 'Couldn’t reach Discord');
  return {
    accessToken: tok.access_token,
    user: { id: String(u.id), username: text(String(u.username || ''), 40) || null, avatar: AVATAR.test(String(u.avatar || '')) ? u.avatar : null },
  };
}

// --- linked profiles ----------------------------------------------------------------------------
const linkedBy = (env, discordId) => env.DB.prepare('SELECT p.user_id, u.* FROM board_profiles p JOIN plus_users u ON u.id = p.user_id WHERE p.discord_id = ?').bind(discordId).first();
// Keep the name and avatar current (each sign-in), so a changed avatar doesn't linger
const refreshLinked = (env, d) => env.DB.prepare('UPDATE board_profiles SET discord_username = ?, discord_avatar = ? WHERE discord_id = ?').bind(d.username, d.avatar, d.id).run();
export const discordOf = (r) => (r && r.discord_id ? { id: r.discord_id, username: r.discord_username || null, avatar: r.discord_avatar || null } : null);

async function link(env, userId, d) {
  const other = await env.DB.prepare('SELECT user_id FROM board_profiles WHERE discord_id = ?').bind(d.id).first();
  if (other && other.user_id !== userId) throw new HttpError(409, 'That Discord account is already linked to another account here. Unlink it there first.');
  const before = await env.DB.prepare('SELECT discord_id FROM board_profiles WHERE user_id = ?').bind(userId).first();
  const at = new Date().toISOString();
  const stmts = [env.DB.prepare(`INSERT INTO board_profiles (user_id, nickname, opt_in, updated_at, discord_id, discord_username, discord_avatar) VALUES (?, '', 0, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET discord_id = excluded.discord_id, discord_username = excluded.discord_username, discord_avatar = excluded.discord_avatar, updated_at = excluded.updated_at`)
    .bind(userId, at, d.id, d.username, d.avatar)];
  // Linking a different Discord account replaces the old one: its Activity results go too
  if (before && before.discord_id && before.discord_id !== d.id) stmts.push(env.DB.prepare('DELETE FROM activity_finishes WHERE discord_id = ?').bind(before.discord_id));
  await env.DB.batch(stmts);
}

// --- the website: link, sign in, unlink -----------------------------------------------------------
export function config(env) { return { clientId: discordOn(env) ? env.DISCORD_CLIENT_ID : null }; }

// redirect must be this site's own /discord/ page (the origin the request came from)
export async function start(request, env, origin) {
  needOn(env);
  await limit(request, env, 'discord-start', 30);
  const b = await readBody(request);
  const mode = b.mode === 'link' ? 'link' : b.mode === 'signin' ? 'signin' : null;
  if (!mode) throw new HttpError(400, 'Bad request');
  let redirect;
  try { redirect = new URL(String(b.redirect || '')); } catch { throw new HttpError(400, 'Bad return page'); }
  if (redirect.origin !== origin || redirect.pathname !== '/discord/' || redirect.search || redirect.hash) throw new HttpError(400, 'Bad return page');
  const back = typeof b.back === 'string' && /^\/(?!\/)[\w\-./?=&%]{0,200}$/.test(b.back) ? b.back : '/';
  const u = mode === 'link' ? await needUser(request, env) : null;
  const state = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM discord_states WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO discord_states (state_hash, mode, user_id, redirect_uri, back, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256(state), mode, u ? u.id : null, redirect.toString(), back, now + STATE_TTL),
  ]);
  const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: redirect.toString(), scope: 'identify', state, prompt: 'none' });
  return { url: `https://discord.com/oauth2/authorize?${q}` };
}

export async function finish(request, env) {
  needOn(env);
  await limit(request, env, 'discord-finish', 30);
  const b = await readBody(request);
  const state = text(b.state, 100);
  const row = state ? await env.DB.prepare('DELETE FROM discord_states WHERE state_hash = ? RETURNING *').bind(await sha256(state)).first() : null;
  if (!row || row.expires_at < Date.now() / 1000) throw new HttpError(400, 'That Discord sign-in expired. Please try again.');
  if (row.mode === 'link') {
    // The same account that started it, still signed in
    const u = await sessionUser(request, env);
    if (!u || u.id !== row.user_id) throw new HttpError(401, 'Please sign in again, then link Discord from Settings.');
    const { user: d } = await exchange(env, text(b.code, 200), row.redirect_uri);
    await link(env, u.id, d);
    return { ok: true, mode: 'link', back: row.back, discord: d };
  }
  const { user: d } = await exchange(env, text(b.code, 200), row.redirect_uri);
  const u = await linkedBy(env, d.id);
  if (!u) throw new HttpError(404, 'No account here has this Discord linked yet. Sign in with Google or email, then link Discord in Settings.');
  await refreshLinked(env, d);
  return { ok: true, mode: 'signin', back: row.back, token: await issue(env, u), user: publicUser(env, u), discord: d };
}

// Unlinking: the Discord ID, username and avatar go at once, and so do its Activity results.
// On the leaderboard without a nickname (the Discord name was showing), it has no name left,
// so the leaderboard turns off the usual way (results deleted) until they pick a nickname.
export async function unlink(request, env) {
  const u = await needUser(request, env);
  const p = await env.DB.prepare('SELECT discord_id, nickname, opt_in FROM board_profiles WHERE user_id = ?').bind(u.id).first();
  const at = new Date().toISOString();
  const off = Boolean(p && p.opt_in && !p.nickname);
  const stmts = [env.DB.prepare(`UPDATE board_profiles SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL${off ? ', opt_in = 0' : ''}, updated_at = ? WHERE user_id = ?`).bind(at, u.id)];
  if (off) stmts.push(env.DB.prepare('DELETE FROM game_results WHERE user_id = ?').bind(u.id));
  if (p && p.discord_id) stmts.push(env.DB.prepare('DELETE FROM activity_finishes WHERE discord_id = ?').bind(p.discord_id));
  await env.DB.batch(stmts);
  return { ok: true, leaderboardOff: off };
}

// --- the Activity --------------------------------------------------------------------------------
// Its own short session for the Discord account playing (linked to a site account or not), so
// its results can show in the channel. Bearer act.<discord id>.<expiry>.<signature>
async function activitySign(env, data) { return hmacHex(env, `discord-activity:${data}`); }
async function activityUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const parts = (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '').split('.');
  if (parts.length !== 4 || parts[0] !== 'act' || !SNOWFLAKE.test(parts[1])) throw new HttpError(401, 'Please open the Activity again');
  const want = await activitySign(env, `act.${parts[1]}.${parts[2]}`);
  if (parts[3].length !== want.length || [...parts[3]].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) !== 0) throw new HttpError(401, 'Please open the Activity again');
  if (!(Number(parts[2]) > Date.now() / 1000)) throw new HttpError(401, 'Please open the Activity again');
  return parts[1];
}

// The SDK's authorize() code → { access_token (for the SDK's authenticate()), activity token,
// discord, account (the linked site account's session, or null) }
export async function activityToken(request, env) {
  needOn(env);
  await limit(request, env, 'discord-activity', 60);
  const b = await readBody(request);
  const { accessToken, user: d } = await exchange(env, text(b.code, 200), null);
  const exp = Math.floor(Date.now() / 1000) + ACTIVITY_TTL;
  const data = `act.${d.id}.${exp}`;
  const u = await linkedBy(env, d.id);
  if (u) await refreshLinked(env, d);
  return {
    access_token: accessToken,
    activity: `${data}.${await activitySign(env, data)}`,
    discord: d,
    account: u ? { token: await issue(env, u), user: publicUser(env, u) } : null,
  };
}

const channelOf = (b) => { const c = String(b.channelId || ''); if (!SNOWFLAKE.test(c)) throw new HttpError(400, 'Not in a channel'); return c; };
const purge = (env) => env.DB.prepare('DELETE FROM activity_finishes WHERE day < ?').bind(addDays(new Date().toISOString().slice(0, 10), -2));

// A daily finished in the Activity (game: 'wordle', the default, or 'crossword'): checked
// exactly like a leaderboard result (board-wordle.js, board-crossword.js)
export async function activityFinish(request, env) {
  const discordId = await activityUser(request, env);
  await limit(request, env, 'discord-finish-act', 120);
  const b = await readBody(request);
  const channel = channelOf(b);
  const game = b.game === 'crossword' ? 'crossword' : 'wordle';
  const r = await ACTIVITY_GAMES[game].check(b, env);
  await env.DB.batch([
    purge(env),
    env.DB.prepare('INSERT OR IGNORE INTO activity_finishes (channel_id, puzzle_id, discord_id, day, game, guesses, hints, won, pattern, seconds, revealed, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(channel, r.puzzleId, discordId, r.day, game, r.guesses ?? 0, r.hints ?? 0, r.won, r.pattern ?? null, r.seconds ?? null, r.revealed ?? null, new Date().toISOString()),
  ]);
  return { ok: true };
}

// Who finished `day`'s dailies: in this channel's Activity, plus any of `ids` (the people in
// the Activity now, from the SDK) whose linked account is on the leaderboard and played on
// the site. Only Discord IDs and results come back; names and avatars come from the SDK.
export async function activityChannel(request, env) {
  await activityUser(request, env);
  await limit(request, env, 'discord-channel', 600);
  const b = await readBody(request);
  const channel = channelOf(b);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')) ? b.day : null;
  if (!day) throw new HttpError(400, 'Bad day');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => SNOWFLAKE.test(x)).slice(0, 50);
  const here = await env.DB.prepare('SELECT discord_id, game, puzzle_id, guesses, hints, won, pattern, seconds, revealed FROM activity_finishes WHERE channel_id = ? AND day = ?').bind(channel, day).all();
  let site = { results: [] };
  if (ids.length) {
    site = await env.DB.prepare(`SELECT p.discord_id, r.game, r.puzzle_id, r.guesses, r.hints, r.won, r.pattern, r.seconds, r.revealed FROM game_results r JOIN board_profiles p ON p.user_id = r.user_id AND p.opt_in = 1
      WHERE r.game IN ('wordle', 'crossword') AND r.day = ? AND p.discord_id IN (${ids.map(() => '?').join(',')})`).bind(day, ...ids).all();
  }
  const seen = new Set();
  const finishes = [...here.results, ...site.results].filter((r) => { const k = `${r.discord_id}:${r.puzzle_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({ id: r.discord_id, game: r.game || 'wordle', puzzleId: r.puzzle_id, guesses: r.guesses, hints: r.hints, won: Boolean(r.won), pattern: r.pattern ? r.pattern.split('|') : null, seconds: r.seconds ?? null, revealed: r.revealed ?? null }));
  return { finishes };
}

export async function activityForget(request, env) {
  const discordId = await activityUser(request, env);
  await env.DB.prepare('DELETE FROM activity_finishes WHERE discord_id = ?').bind(discordId).run();
  return { ok: true };
}

export async function route(what, request, env, origin) {
  const m = request.method;
  if (what === 'discord/config' && m === 'GET') return config(env);
  if (m !== 'POST') return null;
  const routes = {
    'discord/start': () => start(request, env, origin),
    'discord/finish': () => finish(request, env),
    'discord/unlink': () => unlink(request, env),
    'activity/token': () => activityToken(request, env),
    'activity/finish': () => activityFinish(request, env),
    'activity/channel': () => activityChannel(request, env),
    'activity/forget': () => activityForget(request, env),
  };
  return routes[what] ? routes[what]() : null;
}
