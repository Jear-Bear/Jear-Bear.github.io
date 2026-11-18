// discord.js — linking a Discord account to the site account, and signing in with it
// (the sponsor Worker's discord.js; docs/discord-activity.md).
//
// Linking is in Settings (board.js) and only for someone signed in; signing in with Discord
// works only for an account that already has it linked (accounts are never merged). Both go
// to Discord and come back to /discord/ (finishDiscord), which returns to the page they left.
// Only the Discord ID, username and avatar are kept; unlinking deletes them.

import { boardCall, refresh } from '../crossword/account.js?v=8';

const STORE = 'jareddesu.crossword.account';      // account.js's session (same shape it writes)
const BACK = 'jareddesu.discord.back';            // where to go back to if it fails
let cfg = null;

// { clientId } or { clientId: null } while it isn't set up
export function discordConfig() {
  if (!cfg) cfg = boardCall('discord/config', null, 'GET').catch(() => ({ clientId: null }));
  return cfg;
}

// mode: 'link' or 'signin'. Goes to Discord (the promise only settles on an error)
export async function startDiscord(mode) {
  const back = `${location.pathname}${location.search}`;
  const r = await boardCall('discord/start', { mode, redirect: `${location.origin}/discord/`, back });
  try { sessionStorage.setItem(BACK, back); } catch { /* private mode */ }
  location.href = r.url;
  return new Promise(() => {});
}

export const unlinkDiscord = () => boardCall('discord/unlink');

// The /discord/ page: finish what startDiscord began. → { kind: 'linked'|'signedIn', back } or throws
export async function finishDiscord() {
  const q = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  if (q.get('error')) { const e = new Error(q.get('error') === 'access_denied' ? 'cancelled' : 'failed'); e.code = q.get('error'); throw e; }
  const r = await boardCall('discord/finish', { code: q.get('code') || '', state: q.get('state') || '' });
  if (r.token) {
    try { localStorage.setItem(STORE, JSON.stringify({ token: r.token, uid: r.user && r.user.email ? r.user.email.toLowerCase() : undefined })); } catch { /* private mode */ }
    await refresh();
  }
  return { kind: r.mode === 'link' ? 'linked' : 'signedIn', back: r.back || '/' };
}

// The page they started from (for a link back when it didn't work)
export function discordBack() {
  try { const b = sessionStorage.getItem(BACK) || '/'; return /^\/(?!\/)/.test(b) ? b : '/'; } catch { return '/'; }
}

// A Discord avatar (64 px) from the ID and hash Discord gave, or Discord's default one
export function discordAvatar(d) {
  if (!d || !/^\d{5,25}$/.test(String(d.id || ''))) return null;
  if (d.avatar && /^(a_)?[0-9a-f]{20,40}$/.test(d.avatar)) return `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(d.id) >> 22n) % 6n)}.png`;
}
