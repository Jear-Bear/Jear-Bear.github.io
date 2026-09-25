// auth.js — password check, login throttling and signed session tokens.
//
// The password is compared in constant time (both sides HMAC'd with the
// session key, then compared with timingSafeEqual). Failed logins are
// counted in D1 per IP and globally; too many locks further attempts for a
// while. Sessions are stateless HMAC-signed tokens that expire after 12
// hours; bumping the stored session epoch signs out every device.

const enc = new TextEncoder();
const SESSION_TTL_S = 12 * 60 * 60;

const IP_MAX_FAILS = 5;
const IP_WINDOW_S = 15 * 60;
const IP_BASE_LOCK_S = 15 * 60;       // doubles with each lockout, up to a day
const IP_MAX_LOCK_S = 24 * 60 * 60;
const GLOBAL_MAX_FAILS = 30;          // across all IPs, stops distributed guessing
const GLOBAL_WINDOW_S = 60 * 60;
const GLOBAL_LOCK_S = 60 * 60;

export const MIN_PASSWORD_LENGTH = 16;
export const MIN_KEY_LENGTH = 32;

export function configured(env) {
  return Boolean(env.SPONSOR_MANAGEMENT_PASSWORD && env.SPONSOR_MANAGEMENT_PASSWORD.length >= MIN_PASSWORD_LENGTH
    && env.CRM_SESSION_KEY && env.CRM_SESSION_KEY.length >= MIN_KEY_LENGTH);
}

// --- Encoding helpers ------------------------------------------------------------
export function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

let cachedKey = null;
let cachedSecret = null;
async function hmacKey(secret) {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cachedSecret = secret;
  return cachedKey;
}

function timingSafeEqual(a, b) {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function passwordMatches(env, input) {
  if (typeof input !== 'string' || input.length > 1024) return false;
  const key = await hmacKey(env.CRM_SESSION_KEY);
  const [a, b] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(`password:${input}`)),
    crypto.subtle.sign('HMAC', key, enc.encode(`password:${env.SPONSOR_MANAGEMENT_PASSWORD}`)),
  ]);
  return timingSafeEqual(a, b);
}

// The stats Action's key for /api/ingest/stats (a separate secret)
export async function ingestKeyMatches(env, input) {
  if (!env.CRM_INGEST_KEY || env.CRM_INGEST_KEY.length < 32 || typeof input !== 'string' || input.length > 1024) return false;
  const key = await hmacKey(env.CRM_SESSION_KEY);
  const [a, b] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(`ingest:${input}`)),
    crypto.subtle.sign('HMAC', key, enc.encode(`ingest:${env.CRM_INGEST_KEY}`)),
  ]);
  return timingSafeEqual(a, b);
}

// --- Tokens ------------------------------------------------------------------------
export async function issueToken(env, epoch, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, iat, exp: iat + SESSION_TTL_S, ep: epoch })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.CRM_SESSION_KEY), enc.encode(`session.${payload}`));
  return { token: `${payload}.${b64url(sig)}`, expiresAt: (iat + SESSION_TTL_S) * 1000 };
}

// Returns the payload, or null for a bad, expired or revoked token
export async function verifyToken(env, token, epoch, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env.CRM_SESSION_KEY), fromB64url(sig), enc.encode(`session.${payload}`));
  } catch { return null; }
  if (!ok) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return null; }
  if (!data || data.v !== 1 || typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
  if (data.ep !== epoch) return null;
  return data;
}

// --- Throttling (D1) -----------------------------------------------------------------
async function row(db, key) {
  return db.prepare('SELECT fails, window_start, lockouts, locked_until FROM auth_throttle WHERE key = ?').bind(key).first();
}

// { locked: true, retryAfter: seconds } when this IP or the whole login is locked
export async function lockState(db, ip, nowS) {
  const [mine, all] = await Promise.all([row(db, `ip:${ip}`), row(db, 'global')]);
  const until = Math.max(mine ? mine.locked_until : 0, all ? all.locked_until : 0);
  return until > nowS ? { locked: true, retryAfter: until - nowS } : { locked: false };
}

function nextState(r, nowS, { max, window, lockFor }) {
  let fails = r ? r.fails : 0;
  let windowStart = r ? r.window_start : nowS;
  let lockouts = r ? r.lockouts : 0;
  let lockedUntil = r ? r.locked_until : 0;
  if (nowS - windowStart > window) { fails = 0; windowStart = nowS; }
  fails += 1;
  if (fails >= max) {
    lockouts += 1;
    lockedUntil = nowS + lockFor(lockouts);
    fails = 0;
    windowStart = nowS;
  }
  return [fails, windowStart, lockouts, lockedUntil];
}

export async function recordFailure(db, ip, nowS) {
  const ipKey = `ip:${ip}`;
  const [mine, all] = await Promise.all([row(db, ipKey), row(db, 'global')]);
  const upsert = 'INSERT INTO auth_throttle (key, fails, window_start, lockouts, locked_until) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT (key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, '
    + 'lockouts = excluded.lockouts, locked_until = excluded.locked_until';
  await db.batch([
    db.prepare(upsert).bind(ipKey, ...nextState(mine, nowS, {
      max: IP_MAX_FAILS, window: IP_WINDOW_S,
      lockFor: (n) => Math.min(IP_BASE_LOCK_S * 2 ** (n - 1), IP_MAX_LOCK_S),
    })),
    db.prepare(upsert).bind('global', ...nextState(all, nowS, {
      max: GLOBAL_MAX_FAILS, window: GLOBAL_WINDOW_S, lockFor: () => GLOBAL_LOCK_S,
    })),
  ]);
}

export async function recordSuccess(db, ip) {
  await db.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(`ip:${ip}`).run();
}
