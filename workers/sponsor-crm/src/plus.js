// plus.js — Crossword+ accounts, membership and the My deck daily limit.
//
// An account is an email. People sign in either way (both optional, same account):
//   - Sign in with Google: the page gets an ID token from Google and sends it
//     here; it's checked against Google's keys (GOOGLE_CLIENT_ID).
//   - Email link: a one-time link sent with Resend (RESEND_API_KEY), good for
//     20 minutes.
// Signing in returns a session token the page keeps (the site and this Worker
// are on different domains, so it's sent as a header, not a cookie).
//
// Membership is on the account: a Stripe subscription tied to the email
// (stripe.js), or free access given in the Sponsor desk. Members get past
// days (sealed in the repo, opened here), bonus puzzles, and unlimited deck
// puzzles (everyone gets 1 a day; that's counted in the browser).
//
//   GET  /public/plus/info                           what's set up (sale open, Google, email links, prices)
//   POST /public/plus/login/google  { credential }   → { token, user }
//   POST /public/plus/login/email   { email }        → { ok } (sends the link)
//   POST /public/plus/login/verify  { token }        → { token, user }  (from the link)
//   POST /public/plus/me            {}               → { user } (membership)
//   POST /public/plus/logout        {}               signs this account out everywhere
//   POST /public/plus/day           { date }         → a past day's puzzles, opened (members)
//   POST /public/plus/bonus         { id }           → a sealed bonus puzzle, opened (members)
//   GET  /api/plus                                   accounts for the Sponsor desk (signed in)
//   POST /api/plus                  { email, note }  free access for an email
//   PATCH /api/plus/:id             { revoked } | { granted }
//
// The session token goes in the Authorization header: "Bearer …".

import { HttpError } from './data.js';
import { isUuid } from '../../../scripts/manage/schema.js';
import { hmacHex, bump, text } from './public.js';

const SESSION_DAYS = 90;
const LOGIN_MINUTES = 20;
const EMAIL = /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const ACTIVE = new Set(['active', 'trialing', 'past_due']);    // past_due: Stripe is still retrying the card
const SITE = 'https://www.jareddesu.com';

export const isMember = (u) => Boolean(u) && !u.revoked && (Boolean(u.granted) || ACTIVE.has(u.status));
export const siteFor = (origin) => (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : SITE);

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function readBody(request) {
  try { return JSON.parse((await request.text()).slice(0, 8000)) || {}; } catch { return {}; }
}

// Rate limits per (hashed) IP per hour
async function limit(request, env, name, max) {
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await env.DB.prepare('DELETE FROM public_hits WHERE expires_at < ?').bind(now).run();
  if (!(await bump(env.DB, `${name}:${await hmacHex(env, `${ip}:${Math.floor(now / 3600)}`)}`, max, 3600, now))) throw new HttpError(429, 'Too many tries. Please try again later.');
}

// --- sessions -----------------------------------------------------------------------------------
async function sign(env, data) { return hmacHex(env, `plus-session:${data}`); }

async function issue(env, u) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const data = `${u.id}.${exp}.${u.session_ver || 1}`;
  await env.DB.prepare('UPDATE plus_users SET last_login = ? WHERE id = ?').bind(new Date().toISOString(), u.id).run();
  return `${data}.${await sign(env, data)}`;
}

// The signed-in account, or null
export async function sessionUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const parts = tok.split('.');
  if (parts.length !== 4 || !isUuid(parts[0])) return null;
  const [id, exp, ver, sig] = parts;
  const want = await sign(env, `${id}.${exp}.${ver}`);
  if (sig.length !== want.length || [...sig].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) !== 0) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const u = await env.DB.prepare('SELECT * FROM plus_users WHERE id = ?').bind(id).first();
  return u && String(u.session_ver) === ver ? u : null;
}

async function needUser(request, env) {
  const u = await sessionUser(request, env);
  if (!u) throw new HttpError(401, 'Please sign in again');
  return u;
}

// The account for an email (made on first sign-in)
async function userFor(db, email, extra = {}) {
  email = email.toLowerCase();
  let u = await db.prepare('SELECT * FROM plus_users WHERE email = ?').bind(email).first();
  if (!u) {
    u = { id: crypto.randomUUID(), email, name: extra.name || null, google_sub: extra.google_sub || null, session_ver: 1 };
    await db.prepare('INSERT INTO plus_users (id, email, name, google_sub, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(u.id, email, u.name, u.google_sub, new Date().toISOString()).run();
    return u;
  }
  if ((extra.google_sub && !u.google_sub) || (extra.name && !u.name)) {
    await db.prepare('UPDATE plus_users SET google_sub = COALESCE(google_sub, ?), name = COALESCE(name, ?) WHERE id = ?').bind(extra.google_sub || null, extra.name || null, u.id).run();
    u = { ...u, google_sub: u.google_sub || extra.google_sub, name: u.name || extra.name };
  }
  return u;
}

export async function publicUser(db, u) {
  return {
    email: u.email, name: u.name || null, google: Boolean(u.google_sub),
    member: isMember(u), granted: Boolean(u.granted) && !u.revoked, paid: Boolean(u.stripe_subscription),
    status: u.status || null, plan: u.plan || null, renews: u.period_end || null,
  };
}

// --- Google ----------------------------------------------------------------------------------------
let googleKeys = null;
async function googleKey(env, kid) {
  if (!googleKeys || !googleKeys.keys.some((k) => k.kid === kid) || googleKeys.at < Date.now() - 3600000) {
    const res = await fetch(env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600 } });   // override: local tests only
    if (!res.ok) throw new HttpError(502, 'Couldn’t reach Google');
    googleKeys = { ...(await res.json()), at: Date.now() };
  }
  const jwk = googleKeys.keys.find((k) => k.kid === kid);
  if (!jwk) throw new HttpError(401, 'Google sign-in didn’t check out');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

export async function loginGoogle(request, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in isn’t set up');
  await limit(request, env, 'plus-g', 30);
  const body = await readBody(request);
  const parts = String(body.credential || '').split('.');
  if (parts.length !== 3) throw new HttpError(400, 'Bad Google sign-in');
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { throw new HttpError(400, 'Bad Google sign-in'); }
  if (head.alg !== 'RS256') throw new HttpError(400, 'Bad Google sign-in');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await googleKey(env, head.kid), fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Date.now() / 1000;
  if (!ok || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID
    || !(claims.exp > now) || !claims.email || claims.email_verified !== true) throw new HttpError(401, 'Google sign-in didn’t check out');
  // The same Google account keeps its account even if its email changes
  let u = await env.DB.prepare('SELECT * FROM plus_users WHERE google_sub = ?').bind(String(claims.sub)).first();
  if (!u) u = await userFor(env.DB, claims.email, { google_sub: String(claims.sub), name: claims.given_name || null });
  return { token: await issue(env, u), user: await publicUser(env.DB, u, body.day) };
}

// --- email ------------------------------------------------------------------------------------------
export const supportEmail = (env) => env.SUPPORT_EMAIL || 'support@jareddesu.com';
const fromEmail = (env) => env.LOGIN_EMAIL_FROM || 'Jared’s Crossword <crossword@jareddesu.com>';

async function sendEmail(env, { to, subject, text: body, html }) {
  const res = await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail(env), reply_to: supportEmail(env), to: [to], subject, text: body, html }),
  });
  if (!res.ok) { console.error('Resend', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The one welcome email: for a new paying member (stripe.js), or for free
// access given in the Sponsor desk. Claimed in the database first, so two
// webhooks arriving together can't both send it.
export async function sendWelcome(env, db, userId, kind = 'paid') {
  if (!env.RESEND_API_KEY) return false;
  const u = await db.prepare('UPDATE plus_users SET welcomed_at = ? WHERE id = ? AND welcomed_at IS NULL RETURNING email, name').bind(new Date().toISOString(), userId).first();
  if (!u) return false;
  const site = `${SITE}/tools/crossword/`;
  const first = String(u.name || '').trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : 'Hi there,';
  const support = supportEmail(env);
  const gift = kind === 'granted';
  // Short and personal, in Jared's words. Login links are the only other mail they'll get (and Stripe's receipts).
  const paras = [
    gift
      ? 'You’ve been given Crossword+! Sign in on the crossword page with this email (Google or an email link) and every past puzzle, unlimited My deck crosswords and the weekly bonus puzzles are all yours.'
      : 'Thank you so much for joining Crossword+! Every past puzzle, unlimited My deck crosswords and the weekly bonus puzzles are all unlocked now.',
    `This is the only email you’ll get from me, but if you need help with anything, feel free to reach out to ${support}.`,
  ];
  const text = `${hi}\n\n${paras[0]}\n${site}\n\n${paras[1]}\n\nBest,\nJared`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1f1c18;max-width:520px">
<p>${esc(hi)}</p>
<p>${esc(paras[0])} <a href="${site}">Open the crossword</a></p>
<p>${esc(paras[1]).replace(esc(support), `<a href="mailto:${support}">${esc(support)}</a>`)}</p>
<p>Best,<br>Jared</p></div>`;
  const ok = await sendEmail(env, { to: u.email, subject: gift ? 'You’ve got Crossword+' : 'Thank you for joining Crossword+', text, html });
  if (!ok) await db.prepare('UPDATE plus_users SET welcomed_at = NULL WHERE id = ?').bind(userId).run();   // try again on the next event
  return ok;
}

// --- email links ------------------------------------------------------------------------------------
export async function loginEmail(request, env, origin) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'Email sign-in isn’t set up yet. Please use Google for now.');
  await limit(request, env, 'plus-mail-ip', 6);
  const body = await readBody(request);
  const email = text(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'That email doesn’t look right');
  const now = Math.floor(Date.now() / 1000);
  if (!(await bump(env.DB, `plus-mail:${await sha256(email)}`, 3, 3600, now))) throw new HttpError(429, 'We just sent you a link. Check your inbox (and spam), or try again in an hour.');
  const token = randomToken();
  await env.DB.prepare('DELETE FROM plus_logins WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO plus_logins (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), email, now + LOGIN_MINUTES * 60).run();
  const link = `${siteFor(origin)}/tools/crossword/?login=${token}`;
  const ja = body.lang === 'ja';
  const sent = await sendEmail(env, {
    to: email,
    subject: ja ? 'クロスワード＋のログインリンク' : 'Your Crossword+ sign-in link',
    text: ja
      ? `下のリンクを開くとログインできます（${LOGIN_MINUTES}分間有効）。\n\n${link}\n\n心当たりがなければ、このメールは無視してください。`
      : `Open this link to sign in (it works for ${LOGIN_MINUTES} minutes):\n\n${link}\n\nIf you didn’t ask for this, you can ignore this email.`,
    html: `<p>${ja ? `下のボタンでログインできます（${LOGIN_MINUTES}分間有効）。` : `Sign in to Crossword+ with this button (it works for ${LOGIN_MINUTES} minutes):`}</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1f1c18;color:#fff;text-decoration:none;border-radius:4px">${ja ? 'ログイン' : 'Sign in'}</a></p>
<p style="color:#6b6358;font-size:13px">${ja ? '心当たりがなければ、このメールは無視してください。' : 'If you didn’t ask for this, you can ignore this email.'}</p>`,
  });
  if (!sent) throw new HttpError(502, 'Couldn’t send the email. Please try again in a bit.');
  return { ok: true };
}

export async function loginVerify(request, env) {
  await limit(request, env, 'plus-verify', 30);
  const body = await readBody(request);
  const token = text(body.token, 100);
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw new HttpError(400, 'That sign-in link isn’t right');
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('DELETE FROM plus_logins WHERE token_hash = ? RETURNING email, expires_at').bind(await sha256(token)).first();
  if (!row || row.expires_at < now) throw new HttpError(400, 'That sign-in link has expired or was already used. Ask for a new one.');
  const u = await userFor(env.DB, row.email);
  return { token: await issue(env, u), user: await publicUser(env.DB, u, body.day) };
}

// --- the signed-in account ---------------------------------------------------------------------
export async function me(request, env) {
  const u = await needUser(request, env);
  const body = await readBody(request);
  return { user: await publicUser(env.DB, u, body.day) };
}

export async function logout(request, env) {
  const u = await needUser(request, env);
  await env.DB.prepare('UPDATE plus_users SET session_ver = session_ver + 1 WHERE id = ?').bind(u.id).run();
  return { ok: true };
}

// A past day (data/crossword/puzzles/DATE.json, sealed once it's in the past everywhere), opened for a member
export async function dayArchive(request, env, openSealed, site) {
  const u = await needUser(request, env);
  if (!isMember(u)) return { ok: false, error: 'member' };
  const body = await readBody(request);
  const date = text(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Bad date');
  const res = await fetch(`${site}/data/crossword/puzzles/${date}.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new HttpError(404, 'No puzzles for that day');
  const f = await res.json();
  return { ok: true, day: f.ct ? await openSealed(env.DB, f) : f };
}

// A sealed bonus puzzle (data/crossword/bonus/ID.json), opened for a member
export async function bonusPuzzle(request, env, openSealed, site) {
  const u = await needUser(request, env);
  if (!isMember(u)) return { ok: false, error: 'member' };
  const body = await readBody(request);
  const id = text(body.id, 20);
  if (!/^bonus-\d{3,}$/.test(id)) throw new HttpError(400, 'Bad puzzle ID');
  const res = await fetch(`${site}/data/crossword/bonus/${id}.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new HttpError(404, 'No such puzzle');
  return { ok: true, puzzle: await openSealed(env.DB, await res.json()) };
}

// --- Sponsor desk -------------------------------------------------------------------------------
export async function listPlus(db) {
  const { results } = await db.prepare('SELECT * FROM plus_users ORDER BY created_at DESC').all();
  return {
    users: results.map((r) => ({
      id: r.id, email: r.email, name: r.name, google: Boolean(r.google_sub), created_at: r.created_at, last_login: r.last_login,
      granted: Boolean(r.granted), grant_note: r.grant_note, revoked: Boolean(r.revoked), paid: Boolean(r.stripe_subscription),
      status: r.status, plan: r.plan, period_end: r.period_end, member: isMember(r),
    })),
  };
}

// Free access for an email (testers, friends): works as soon as they sign in with it
export async function grantPlus(env, db, body) {
  const email = text(body && body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'That email doesn’t look right');
  const u = await userFor(db, email);
  await db.prepare('UPDATE plus_users SET granted = 1, revoked = 0, grant_note = ? WHERE id = ?').bind(text(body.note, 120) || null, u.id).run();
  // A paying member already got their welcome; anyone else gets the "you've got Crossword+" one
  const emailed = await sendWelcome(env, db, u.id, 'granted');
  return { ok: true, id: u.id, emailed };
}

export async function updatePlus(db, id, body) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad account ID');
  const sets = [];
  const vals = [];
  if (body && 'revoked' in body) { sets.push('revoked = ?'); vals.push(body.revoked ? 1 : 0); }
  if (body && 'granted' in body) { sets.push('granted = ?'); vals.push(body.granted ? 1 : 0); }
  if (body && body.signOut) sets.push('session_ver = session_ver + 1');
  if (!sets.length) throw new HttpError(400, 'Nothing to change');
  const r = await db.prepare(`UPDATE plus_users SET ${sets.join(', ')} WHERE id = ? RETURNING id`).bind(...vals, id).first();
  if (!r) throw new HttpError(404, 'No such account');
  return { ok: true };
}
