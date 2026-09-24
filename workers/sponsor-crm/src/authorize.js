// authorize.js — the page Claude sends you to when you add the connector.
// It shows who is asking and asks for the same CRM password as the app.
//
// Protections: only Claude's callback addresses (and localhost for testing)
// can be approved; a CSRF cookie plus a signed copy of the parsed request
// stop tampering; wrong passwords share the app's lockout; the page has a
// strict CSP, can't be framed, and escapes every value it shows.

import { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { passwordMatches, lockState, recordFailure, recordSuccess, b64url, fromB64url } from './auth.js';

const enc = new TextEncoder();
const CSRF_COOKIE = '__Host-crm_csrf';
const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com'];

export function redirectAllowed(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.includes(u.hostname)) return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch { return false; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`authorize:${env.CRM_SESSION_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { key, sig: b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data))) };
}

function page(body, { status = 200, nonce, headers = {} } = {}) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Connect Claude · Sponsor desk</title>
<style nonce="${nonce}">
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4efe4;color:#1f1c18;font:15px/1.6 'Hiragino Sans','Yu Gothic',system-ui,sans-serif;padding:24px}
main{width:min(380px,100%)}h1{font:600 1.5rem/1.3 'Hiragino Mincho ProN','Yu Mincho',serif;margin:0 0 12px}
p{color:#4b453d;margin:0 0 12px}.mark{letter-spacing:.3em;color:#95483f;font-size:13px}
dl{margin:0 0 16px;font-size:13px;border-top:1px solid #d8cfbe}dl div{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #d8cfbe}dt{color:#6b6358;width:6.5rem;flex:none}dd{margin:0;word-break:break-all}
label{display:block;font-size:13px;color:#4b453d;margin-bottom:4px}input[type=password]{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:1px solid #b8ac97;background:#f9f6ef}
.row{display:flex;gap:8px;margin-top:14px}button{font:500 14px system-ui,sans-serif;padding:10px 16px;border:1px solid #1f1c18;background:#1f1c18;color:#f9f6ef;cursor:pointer}
button.ghost{background:transparent;color:#1f1c18;border-color:#b8ac97}.err{color:#a3322a;font-size:13px;min-height:1.2em}
</style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self' https://claude.ai https://claude.com http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'`,
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function errorPage(message, status = 400) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  return page(`<p class="mark">営業</p><h1>Can’t connect</h1><p>${esc(message)}</p>`, { status, nonce });
}

function form({ oauthReq, client, csrf, signed, nonce, error = '' }) {
  const host = (() => { try { return new URL(oauthReq.redirectUri).host; } catch { return '?'; } })();
  return `<p class="mark">営業</p><h1>Connect ${esc(client.clientName || 'an app')} to Sponsor desk?</h1>
<p>It will be able to read your sponsor CRM and file proposals, suggestions and notes for you to review. It can’t delete anything or change deals directly.</p>
<dl><div><dt>App</dt><dd>${esc(client.clientName || client.clientId)}</dd></div><div><dt>Returns to</dt><dd>${esc(host)}</dd></div></dl>
<form method="post" action="/authorize">
<input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="req" value="${esc(signed)}">
<label for="pw">Sponsor desk password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<p class="err" role="alert">${esc(error)}</p>
<div class="row"><button type="submit" name="decision" value="allow">Connect</button><button class="ghost" type="submit" name="decision" value="deny" formnovalidate>Cancel</button></div>
</form>`;
}

function cookieOf(request, name) {
  const c = (request.headers.get('Cookie') || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return c ? c.slice(name.length + 1) : null;
}

function errorRedirect(oauthReq, code, description) {
  const u = new URL(oauthReq.redirectUri);
  u.searchParams.set('error', code);
  u.searchParams.set('error_description', description);
  if (oauthReq.state) u.searchParams.set('state', oauthReq.state);
  if (oauthReq.issuer) u.searchParams.set('iss', oauthReq.issuer);
  return Response.redirect(u.href, 302);
}

export async function handleAuthorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));

  if (request.method === 'GET') {
    let oauthReq;
    try {
      oauthReq = await oauth.parseAuthRequest(request);
    } catch (err) {
      if (err instanceof AuthorizationError && err.redirectUri && redirectAllowed(err.redirectUri)) {
        return errorRedirect({ redirectUri: err.redirectUri, state: err.state, issuer: err.issuer }, err.code, err.description);
      }
      return errorPage(err instanceof AuthorizationError ? err.description : 'That authorization request isn’t valid.');
    }
    if (!redirectAllowed(oauthReq.redirectUri)) return errorPage('Only Claude can connect to Sponsor desk.', 403);
    const client = await oauth.lookupClient(oauthReq.clientId);
    if (!client) return errorPage('Unknown app.');
    const csrf = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const payload = b64url(enc.encode(JSON.stringify(oauthReq)));
    const { sig } = await hmac(env, `${payload}.${csrf}`);
    return page(form({ oauthReq, client, csrf, signed: `${payload}.${sig}`, nonce }), {
      nonce, headers: { 'Set-Cookie': `${CSRF_COOKIE}=${csrf}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=900` },
    });
  }

  if (request.method !== 'POST') return errorPage('Method not allowed', 405);
  const data = await request.formData();
  const csrf = String(data.get('csrf') || '');
  const cookie = cookieOf(request, CSRF_COOKIE);
  const [payload, sig] = String(data.get('req') || '').split('.');
  if (!csrf || !cookie || csrf !== cookie || !payload || !sig) return errorPage('This form expired. Start again from Claude.');
  const { key } = await hmac(env, '');
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(`${payload}.${csrf}`));
  if (!ok) return errorPage('This form was changed. Start again from Claude.');
  let oauthReq;
  try { oauthReq = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return errorPage('This form is broken. Start again from Claude.'); }
  if (!redirectAllowed(oauthReq.redirectUri)) return errorPage('Only Claude can connect to Sponsor desk.', 403);
  const clearCookie = `${CSRF_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;

  if (data.get('decision') !== 'allow') return errorRedirect(oauthReq, 'access_denied', 'The request was cancelled');

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const nowS = Math.floor(Date.now() / 1000);
  const lock = await lockState(env.DB, ip, nowS);
  const client = await oauth.lookupClient(oauthReq.clientId);
  if (!client) return errorPage('Unknown app.');
  const again = async (error) => {
    const fresh = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const { sig: s2 } = await hmac(env, `${payload}.${fresh}`);
    return page(form({ oauthReq, client, csrf: fresh, signed: `${payload}.${s2}`, nonce, error }), {
      status: 401, nonce, headers: { 'Set-Cookie': `${CSRF_COOKIE}=${fresh}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=900` },
    });
  };
  if (lock.locked) return again(`Too many attempts. Try again in ${Math.ceil(lock.retryAfter / 60)} min.`);
  if (!(await passwordMatches(env, String(data.get('password') || '')))) {
    await recordFailure(env.DB, ip, nowS);
    return again('Wrong password.');
  }
  await recordSuccess(env.DB, ip);

  const { redirectTo } = await oauth.completeAuthorization({
    request: oauthReq,
    userId: 'owner',
    metadata: { label: client.clientName || 'Claude', connectedAt: new Date().toISOString() },
    scope: ['crm'],
    props: { userId: 'owner' },
  });
  return new Response(null, { status: 302, headers: { Location: redirectTo, 'Set-Cookie': clearCookie, 'Cache-Control': 'no-store' } });
}
