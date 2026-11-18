// wordle.js — Kana Wordle as a Discord Activity (activity/wordle/). docs/discord-activity.md.
//
// Discord loads the page in its own frame, at https://<client id>.discordsays.com, and every
// request goes through Discord's proxy (the URL Mappings in the Developer Portal):
//   /            → www.jareddesu.com/activity/wordle   (this page)
//   /site        → www.jareddesu.com                    (the game's scripts, styles and words)
//   /api         → sponsor-crm.jared-65b.workers.dev     (sign-in, results)
// The page's <base> points at /.proxy/site/tools/wordle/, so the game's own relative paths work
// unchanged, and patchUrlMappings sends account.js's Worker calls (and this file's) through /.proxy/api.
//
// Then: the Embedded App SDK's authorize() (scope identify) → the Worker swaps the code
// (activity/token) → authenticate(). A Discord account linked to a site account plays as that
// account (dailies sync, the leaderboard counts it); one that isn't still plays, and its
// dailies show in the channel. Nothing else loads here: no ads, no sponsor cards, no
// third-party scripts, no checkout or upgrade prompts, only the game.

import { DiscordSDK, patchUrlMappings } from './discord-sdk.js?v=1';

const WORKER = 'sponsor-crm.jared-65b.workers.dev';
const API = `https://${WORKER}/public/board`;
const STORE = 'jareddesu.crossword.account';       // account.js's session (same shape it writes)
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', mixed: 'Mixed' };
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
let finishes = [];             // { id, puzzleId, guesses, hints, won } for today, from the Worker

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

function drawChannel() {
  const box = $('act-channel');
  if (!box) return;
  const list = people.length ? people : (me ? [me] : []);
  const rows = list.map((p) => {
    const mine = finishes.filter((f) => f.id === p.id);
    const chips = mine.map((f) => {
      const [, , level, len] = /^wordle-(\d{4}-\d{2}-\d{2})-(\w+)-([45])$/.exec(f.puzzleId) || [];
      return h('span', { class: `act-chip${f.won ? ' is-won' : ''}` }, `${LEVEL[level] || level} ${len} · ${f.won ? f.guesses : 'X'}/8${f.hints ? ' 💡' : ''}`);
    });
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
  const r = await call('activity/token', { code });
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
    h('span', {}, 'Your dailies show in this channel. To save your streak and join the leaderboard, link this Discord in Kana Wordle’s Settings on jareddesu.com. '),
    h('button', { type: 'button', class: 'btn-link', onclick: () => sdk.commands.openExternalLink({ url: 'https://www.jareddesu.com/tools/wordle/' }).catch(() => {}) }, 'Open jareddesu.com'),
    ' · ',
    h('button', { type: 'button', class: 'btn-link', onclick: async () => { try { await call('activity/forget'); finishes = finishes.filter((f) => f.id !== me.id); drawChannel(); } catch { /* try again */ } } }, 'Remove my results from this channel'));
}

async function main() {
  const inDiscord = new URLSearchParams(location.search).has('frame_id');
  if (!inDiscord) return;        // the page outside Discord just says to open it there
  $('act-outside').hidden = true;
  document.documentElement.dataset.surface = 'activity';
  patchUrlMappings([{ prefix: '/.proxy/api', target: WORKER }]);
  // The SDK's fetch resolves relative URLs against the frame's root, not <base>: resolve
  // them first, so the game's own fetches (../../data/wordle/…) keep going through /site
  const remapped = window.fetch;
  window.fetch = (input, init) => remapped(typeof input === 'string' ? new URL(input, document.baseURI).href : input, init);

  const cfg = await fetch(`${API}/discord/config`).then((r) => r.json()).catch(() => ({}));
  if (!cfg.clientId) { $('act-status').textContent = 'The Activity isn’t set up yet.'; return; }
  sdk = new DiscordSDK(cfg.clientId);
  await sdk.ready();

  let linked = false;
  try { linked = Boolean((await signIn(cfg.clientId)).account); } catch (e) {
    // Not signed in (they said no, or it failed): the game still works, just not the channel list
    $('act-status').textContent = 'Playing without Discord sign-in: your results stay on this device.';
  }
  window.jdActivity = {
    name: me ? nameOf(me) : 'Discord',
    // A finished daily → this channel's list (the game sends it to the leaderboard itself)
    finished(result) {
      if (!activityToken || !sdk.channelId) return;
      call('activity/finish', { ...result, channelId: sdk.channelId }).then(loadFinishes).catch(() => {});
    },
  };
  if (me) {
    drawLinkNote(linked);
    try {
      people = (await sdk.commands.getInstanceConnectedParticipants()).participants || [];
      sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (e) => { people = e.participants || []; loadFinishes(); });
    } catch { people = []; }
    loadFinishes();
    setInterval(loadFinishes, 30000);
  }
  await import('../wordle/app.js?v=12');
}

main().catch((e) => { const s = $('act-status'); if (s) s.textContent = `Couldn’t start: ${e.message || e}`; });
