// activity.js — what the Discord Activities share (activity/wordle/, activity/crossword/,
// activity/kanji/; docs/discord-activity.md): Discord sign-in, the channel's "Today in this
// channel" list and the note on linking. Each game's page script calls startActivity().
//
// Each Activity is its own Discord app (Kana Wordle, Kana Crossword, Kanji Crossword). Discord
// loads it in its own frame, at https://<that app's client id>.discordsays.com, and every
// request goes through Discord's proxy (each app's URL Mappings in the Developer Portal):
//   /            → www.jareddesu.com/activity/<game>    (the game's page)
//   /site        → www.jareddesu.com                    (the games' scripts, styles and data)
//   /api         → sponsor-crm.jared-65b.workers.dev     (sign-in, results)
// Each game's page has <base href="/.proxy/site/tools/<game>/">, so the game's own relative
// paths work unchanged, and patchUrlMappings sends account.js's Worker calls (and this file's)
// through /.proxy/api.
//
// The game loads at once. Alongside it: the Embedded App SDK's authorize() (scope identify) →
// the Worker swaps the code (activity/token) → authenticate(). A Discord account linked to a
// site account plays as that account (dailies sync, the leaderboard counts it); one that isn't
// still plays, and its dailies show in the channel. Nothing else loads here: no ads, no sponsor
// cards, no third-party scripts, no checkout or upgrade prompts, only the game.

import { DiscordSDK, patchUrlMappings } from './discord-sdk.js?v=1';

const WORKER = 'sponsor-crm.jared-65b.workers.dev';
const API = `https://${WORKER}/public/board`;
const STORE = 'jareddesu.crossword.account';       // account.js's session (same shape it writes)
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', mixed: 'Mixed' };
const SIZE = { mini: 'mini', daily: 'daily' };
const GAME = {
  wordle: { name: 'Kana Wordle', url: 'https://www.jareddesu.com/tools/wordle/' },
  crossword: { name: 'the crossword', url: 'https://www.jareddesu.com/tools/crossword/' },
};
let game = 'wordle';
const $ = (id) => document.getElementById(id);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c != null && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

let sdk = null;
let activityToken = null;
let me = null;
let people = [];               // who's in the Activity now (from the SDK)
let finishes = [];             // { id, game, puzzleId, guesses, hints, won, seconds, revealed } for today, from the Worker

async function call(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(activityToken ? { Authorization: `Bearer ${activityToken}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

// Discord's avatar, or its default one (the SDK gives these; nothing about them is stored)
function avatar(u) {
  if (u.avatar && /^(a_)?[0-9a-f]{20,40}$/.test(u.avatar)) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`; } catch { return ''; }
}
const nameOf = (u) => u.global_name || u.username || '?';

// --- who in the channel finished today ------------------------------------------------------
async function loadFinishes() {
  if (!activityToken || !sdk.channelId) return;
  try {
    const r = await call('activity/channel', { channelId: sdk.channelId, day: localDate(), ids: people.map((p) => p.id) });
    finishes = r.finishes || [];
  } catch { /* keep the last list */ }
  drawChannel();
}

// "Mixed 4 · 3/8 💡" for Kana Wordle, "Kanji mini · 1:23 ✨" for the crossword (✨ no reveals)
const clock = (s) => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
function chipText(f) {
  if (f.game === 'crossword') {
    const [, , kanji, level, size] = /^(\d{4}-\d{2}-\d{2})-(?:(kanji)-)?(\w+)-(mini|daily)$/.exec(f.puzzleId) || [];
    return `${kanji ? 'Kanji' : 'Kana'} ${LEVEL[level] ? `${LEVEL[level]} ` : ''}${SIZE[size] || ''} · ${clock(f.seconds)}${f.revealed ? '' : ' ✨'}`;
  }
  const [, , level, len] = /^wordle-(\d{4}-\d{2}-\d{2})-(\w+)-([45])$/.exec(f.puzzleId) || [];
  return `Wordle ${LEVEL[level] || level} ${len} · ${f.won ? f.guesses : 'X'}/8${f.hints ? ' 💡' : ''}`;
}

function drawChannel() {
  const box = $('act-channel');
  if (!box) return;
  const list = people.length ? people : (me ? [me] : []);
  const rows = list.map((p) => {
    const mine = finishes.filter((f) => f.id === p.id);
    const chips = mine.map((f) => h('span', { class: `act-chip${f.won ? ' is-won' : ''}` }, chipText(f)));
    return h('li', { class: 'act-person' },
      h('img', { class: 'act-avatar', src: avatar(p), alt: '', width: '28', height: '28', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
      h('span', { class: 'act-name' }, nameOf(p)),
      chips.length ? h('span', { class: 'act-chips' }, chips) : h('span', { class: 'act-chips act-muted' }, 'not yet'));
  });
  box.replaceChildren(
    h('p', { class: 'act-head' }, 'Today in this channel'),
    rows.length ? h('ul', { class: 'act-list' }, rows) : h('p', { class: 'act-muted' }, 'Nobody here yet.'));
}

// --- sign-in -----------------------------------------------------------------------------------
async function signIn(clientId) {
  const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
  const r = await call('activity/token', { code, clientId });
  await sdk.commands.authenticate({ access_token: r.access_token });
  activityToken = r.activity;
  me = { id: r.discord.id, username: r.discord.username, avatar: r.discord.avatar };
  try {
    // A linked account plays as itself (this frame keeps its own storage, apart from the site)
    if (r.account) localStorage.setItem(STORE, JSON.stringify({ token: r.account.token, uid: r.account.user && r.account.user.email ? r.account.user.email.toLowerCase() : undefined }));
    else localStorage.removeItem(STORE);
  } catch { /* private mode */ }
  return r;
}

function drawLinkNote(linked) {
  const note = $('act-note');
  if (!note) return;
  if (linked) { note.replaceChildren(h('span', {}, 'Your account is linked: your dailies are saved and count on the leaderboard.')); return; }
  note.replaceChildren(
    h('span', {}, `Your dailies show in this channel. To save your streak and join the leaderboard, link this Discord in ${GAME[game].name}’s Settings on jareddesu.com. `),
    h('button', { type: 'button', class: 'btn-link', onclick: () => sdk.commands.openExternalLink({ url: GAME[game].url }).catch(() => {}) }, 'Open jareddesu.com'),
    ' · ',
    h('button', { type: 'button', class: 'btn-link', onclick: async () => { try { await call('activity/forget'); finishes = finishes.filter((f) => f.id !== me.id); drawChannel(); } catch { /* try again */ } } }, 'Remove my results from this channel'));
}

// Waits at most ms for a step, so a stuck Discord call can't hold anything up
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out`)), ms))]);
const say = (text) => { const el = $('act-status'); if (el) el.textContent = text; };

// The game loads at once; Discord sign-in runs alongside it and fills in the name, the account
// and the channel list when it's done. A daily finished before then is sent once it is.
const pending = [];
const activity = {
  name: 'Discord',
  mode: null,
  finished(result) {
    if (!activityToken || !sdk || !sdk.channelId) { pending.push(result); return; }
    call('activity/finish', { ...result, game, channelId: sdk.channelId }).then(loadFinishes).catch(() => {});
  },
};

async function connect() {
  say('Connecting to Discord…');
  const cfg = await within(15000, fetch(`${API}/discord/config`).then((r) => r.json()), 'Reaching the server');
  // This Activity's app: the client ID is the first part of Discord's address for it
  const host = /^(\d{5,25})\.discordsays\.com$/.exec(location.hostname);
  const clientId = host ? host[1] : cfg.clientId;
  if (!clientId || !(cfg.activities || [cfg.clientId]).includes(clientId)) { say('Discord sign-in isn’t set up for this Activity yet: your results stay on this device.'); return; }
  sdk = new DiscordSDK(clientId);
  await within(15000, sdk.ready(), 'Discord');
  say('Signing in with Discord…');
  const r = await within(120000, signIn(clientId), 'Discord sign-in');
  say('');
  activity.name = nameOf(me);
  // A linked account: the game picks up its session (sync, leaderboard) through account.js
  const { refresh } = await import('../crossword/account.js?v=8');
  await refresh();
  drawLinkNote(Boolean(r.account));
  pending.splice(0).forEach((x) => activity.finished(x));
  try {
    people = (await within(10000, sdk.commands.getInstanceConnectedParticipants(), 'Participants')).participants || [];
    sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (e) => { people = e.participants || []; loadFinishes(); });
  } catch { people = []; }
  loadFinishes();
  setInterval(loadFinishes, 30000);
}

// game: 'wordle' or 'crossword'; mode: the crossword's ('kana' or 'kanji'); load: imports the
// game's own app.js (after jdActivity is set)
export async function startActivity({ game: which, mode = null, load }) {
  game = which;
  activity.mode = mode;
  const inDiscord = new URLSearchParams(location.search).has('frame_id');
  if (!inDiscord) return;        // the page outside Discord just says to open it there
  $('act-outside').hidden = true;
  document.documentElement.dataset.surface = 'activity';
  patchUrlMappings([{ prefix: '/.proxy/api', target: WORKER }]);
  // The SDK's fetch resolves relative URLs against the frame's root, not <base>: resolve
  // them first, so the game's own fetches (../../data/…) keep going through /site
  const remapped = window.fetch;
  window.fetch = (input, init) => remapped(typeof input === 'string' ? new URL(input, document.baseURI).href : input, init);
  window.jdActivity = activity;
  try { await load(); } catch (e) { say(`Couldn’t start: ${e.message || e}`); return; }
  connect().catch((e) => say(`Playing without Discord sign-in (${e.message || e}): your results stay on this device.`));
}
