#!/usr/bin/env node
// register-commands.mjs — puts /leaderboard on each Activity's Discord app (src/commands.js).
// Run by the deploy (.github/workflows/sponsor-crm-deploy.yml) after the Worker is up:
//
//   DISCORD_CLIENT_SECRET=… DISCORD_KANA_CROSSWORD_CLIENT_SECRET=… node scripts/register-commands.mjs
//
// Client IDs come from wrangler.toml; an app is skipped while its secret is empty. It signs in
// as the app (OAuth2 client credentials, scope applications.commands.update) and creates or
// updates the one command by name, so the Activity's own Launch command is left alone.
// Never prints a secret or token. A failure is reported but doesn't fail the deploy.

import fs from 'node:fs';

const API = 'https://discord.com/api/v10';
const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const idOf = (name) => (new RegExp(`^${name}\\s*=\\s*"(\\d{5,25})"`, 'm').exec(toml) || [])[1];

const APPS = [
  { name: 'Kana Wordle', id: idOf('DISCORD_CLIENT_ID'), secret: process.env.DISCORD_CLIENT_SECRET },
  { name: 'Kana Crossword', id: idOf('DISCORD_KANA_CROSSWORD_CLIENT_ID'), secret: process.env.DISCORD_KANA_CROSSWORD_CLIENT_SECRET },
  { name: 'Kanji Crossword', id: idOf('DISCORD_KANJI_CROSSWORD_CLIENT_ID'), secret: process.env.DISCORD_KANJI_CROSSWORD_CLIENT_SECRET },
];

const command = (title) => ({
  name: 'leaderboard',
  type: 1,
  description: `${title} leaderboard: this server or everyone`,
  description_localizations: { ja: `${title}のランキング（このサーバーか全体）` },
  integration_types: [0, 1],        // works where the app is added to a server, or by a user
  contexts: [0, 1, 2],              // servers, DMs with the app, other DMs and group DMs
  options: [
    { type: 3, name: 'scope', description: 'Whose results (default: this server)', description_localizations: { ja: '誰の結果か（標準：このサーバー）' }, required: false,
      choices: [{ name: 'This server', name_localizations: { ja: 'このサーバー' }, value: 'server' }, { name: 'Everyone', name_localizations: { ja: '全体' }, value: 'global' }] },
    { type: 3, name: 'period', description: 'Which days (default: today)', description_localizations: { ja: '期間（標準：今日）' }, required: false,
      choices: [{ name: 'Today', name_localizations: { ja: '今日' }, value: 'today' }, { name: 'Last 7 days', name_localizations: { ja: '過去7日' }, value: 'week' }, { name: 'This month', name_localizations: { ja: '今月' }, value: 'month' }] },
  ],
});

let failed = 0;
for (const app of APPS) {
  if (!app.id || !app.secret) { console.log(`${app.name}: skipped (no client ID or secret)`); continue; }
  try {
    const tok = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'applications.commands.update' }),
    });
    const t = await tok.json().catch(() => ({}));
    if (!tok.ok || !t.access_token) throw new Error(`sign-in ${tok.status} ${t.error || ''}`);
    const res = await fetch(`${API}/applications/${app.id}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify(command(app.name)),
    });
    if (!res.ok) throw new Error(`command ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`${app.name}: /leaderboard registered`);
  } catch (e) {
    failed++;
    console.log(`::warning::${app.name}: couldn't register /leaderboard (${e.message})`);
  }
}
if (failed) console.log(`${failed} app(s) not updated; the next deploy tries again.`);
