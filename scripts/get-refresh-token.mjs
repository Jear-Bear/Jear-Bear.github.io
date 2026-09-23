#!/usr/bin/env node
// =====================================================================
// get-refresh-token.mjs — one-time local helper for the sponsor-stats Action
//
// Signs you in with Google (read-only YouTube Analytics scope), then prints
// a refresh token to paste into the YT_OAUTH_REFRESH_TOKEN Actions secret.
// Run it on your own computer, never in CI. Nothing is written to disk.
//
//   YT_OAUTH_CLIENT_ID=... YT_OAUTH_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
//
// (If the variables aren't set, the script asks for them.)
// Uses a Desktop OAuth client, a loopback redirect and PKCE.
// See docs/sponsor-stats-setup.md for the full setup.
// =====================================================================

import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const CHANNEL_ID = 'UCSIxTP9PCM2kcTszONRxZ1w';
const SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const clientId = process.env.YT_OAUTH_CLIENT_ID || await ask('OAuth client ID: ');
  const clientSecret = process.env.YT_OAUTH_CLIENT_SECRET || await ask('OAuth client secret: ');
  if (!clientId || !clientSecret) throw new Error('Client ID and secret are required.');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  // Loopback server on a random free port
  let redirectUri;
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const err = url.searchParams.get('error');
      const got = url.searchParams.get('code');
      const ok = !err && got && url.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(ok ? 'Signed in. You can close this tab and go back to the terminal.' : `Sign-in failed: ${err || 'state mismatch'}`);
      server.close();
      ok ? resolve(got) : reject(new Error(`Sign-in failed: ${err || 'state mismatch'}`));
    });
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',            // always return a refresh token
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).forEach(([k, v]) => auth.searchParams.set(k, v));

      console.log('\nOpen this URL in your browser and sign in with the Google account that owns');
      console.log('the まだまだJared channel (pick the channel if Google asks which one):\n');
      console.log(auth.toString());
      console.log('\nWaiting for the redirect…');
    });
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokens.error_description || tokens.error}`);
  if (!tokens.refresh_token) throw new Error('Google returned no refresh token. Remove the app at myaccount.google.com/permissions and try again.');

  // Confirm the token can read this channel's analytics
  const end = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10);
  const check = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  Object.entries({ ids: `channel==${CHANNEL_ID}`, startDate: start, endDate: end, metrics: 'views' })
    .forEach(([k, v]) => check.searchParams.set(k, v));
  const checkRes = await fetch(check, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (checkRes.ok) {
    console.log(`\n✓ Token can read YouTube Analytics for channel ${CHANNEL_ID}.`);
  } else {
    const body = await checkRes.json().catch(() => ({}));
    console.warn(`\n⚠ Analytics check failed (HTTP ${checkRes.status}): ${body.error && body.error.message}`);
    console.warn('  You may have signed in with an account or channel that does not own まだまだJared.');
  }

  if (tokens.refresh_token_expires_in) {
    const days = Math.round(tokens.refresh_token_expires_in / 86400);
    console.warn(`\n⚠ This refresh token expires in about ${days} day(s). The OAuth consent screen is`);
    console.warn('  probably still in "Testing". Publish it ("In production"), then run this again.');
  }

  console.log('\nAdd this as the YT_OAUTH_REFRESH_TOKEN repository secret:\n');
  console.log(tokens.refresh_token);
  console.log('\nTreat it like a password. Do not commit it or paste it anywhere else.');
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
