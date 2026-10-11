// account.js — Crossword+ accounts on the crossword page.
//
// Sign in (optional for everyone, needed for Crossword+) with Google or with a
// link sent to your email; both land on the same account if the email is the
// same. Paying goes through Stripe Checkout, tied to the account's email.
// The session token from the sponsor Worker (workers/sponsor-crm/src/plus.js)
// is kept in this browser and sent as an Authorization header.

import { lang } from '../games/i18n.js?v=1';

const API = 'https://sponsor-crm.jared-65b.workers.dev/public/plus';
const STORE = 'jareddesu.crossword.account';
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function read() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function write(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode */ } }

let user = null;           // the signed-in account (from /me), or null
let infoCache = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(user); } catch { /* keep going */ } });
export const onAccount = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const currentUser = () => user;
export const signedIn = () => Boolean(read().token);
export const isMember = () => Boolean(user && user.member);

async function call(path, body = {}, { method = 'POST' } = {}) {
  const token = read().token;
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify({ day: localDate(), lang: lang(), ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { write({}); user = null; emit(); }
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

function signIn(r) {
  write({ token: r.token });
  user = r.user;
  emit();
  return user;
}

// What's set up: { open, test, google (client ID), email, prices }
export async function info() {
  if (!infoCache) infoCache = fetch(`${API}/info`).then((r) => (r.ok ? r.json() : { open: false })).catch(() => ({ open: false }));
  return infoCache;
}

export async function refresh() {
  if (!read().token) { user = null; emit(); return null; }
  try { user = (await call('me')).user; } catch (e) { if (e.status === 401) user = null; }
  emit();
  return user;
}

export const sendEmailLink = (email) => call('login/email', { email });
export async function logout() {
  try { await call('logout'); } catch { /* signed out here either way */ }
  write({});
  user = null;
  emit();
}

// Paying: Stripe's form in a window on this page (Embedded Checkout) when the Worker has
// the publishable key, else Stripe's own checkout page. Either way Stripe brings the
// person back to ?plus=success, which handleReturn picks up.
export async function checkout(plan) {
  const i = await info();
  const r = await call('checkout', { plan, embedded: Boolean(i.embedded) });
  if (r.clientSecret) return openEmbedded(r);
  location.href = r.url;
  return null;
}

let stripeJs = null;
const loadStripe = () => stripeJs || (stripeJs = new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = 'https://js.stripe.com/v3/';
  s.onload = () => ok(window.Stripe);
  s.onerror = () => { stripeJs = null; no(new Error('Couldn’t load Stripe. Please try again.')); };
  document.head.append(s);
}));
let embedded = null;
async function openEmbedded({ clientSecret, publishableKey }) {
  const Stripe = await loadStripe();
  if (embedded) { embedded.destroy(); embedded = null; }
  document.querySelector('.cw-pay')?.remove();
  const mount = document.createElement('div');
  mount.className = 'cw-pay-mount';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cw-pay-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  const sheet = document.createElement('div');
  sheet.className = 'cw-pay-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Crossword+');
  sheet.append(close, mount);
  const overlay = document.createElement('div');
  overlay.className = 'cw-overlay cw-pay';
  overlay.append(sheet);
  const shut = () => { if (embedded) { embedded.destroy(); embedded = null; } overlay.remove(); };
  close.addEventListener('click', shut);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) shut(); });
  (document.querySelector('.cw') || document.body).append(overlay);
  embedded = await Stripe(publishableKey).initEmbeddedCheckout({ fetchClientSecret: async () => clientSecret });
  embedded.mount(mount);
  return shut;
}
export async function portal() {
  const r = await call('portal');
  location.href = r.url;
}
export const bonusPuzzle = (id) => call('bonus', { id });
// My deck's free puzzle (one per account per day) and progress synced between devices
export const deckUse = (day, peek = false) => call('deck-use', { day, peek });
export const loadSave = () => call('load');
export const putSave = (data) => call('save', { data });
export const archiveDay = (date) => call('day', { date });

// "Sign in with Google": Google's own button, from Google's script
let gis = null;
function loadGoogle() {
  if (!gis) {
    gis = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => reject(new Error('Couldn’t load Google sign-in'));
      document.head.append(s);
    });
  }
  return gis;
}
export async function googleButton(el, { onError } = {}) {
  const i = await info();
  if (!i.google) return false;
  try {
    const google = await loadGoogle();
    google.accounts.id.initialize({
      client_id: i.google,
      callback: async (resp) => { try { signIn(await call('login/google', { credential: resp.credential })); } catch (e) { if (onError) onError(e); } },
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', locale: lang() === 'ja' ? 'ja' : 'en', width: Math.min(320, el.clientWidth || 320) });
    return true;
  } catch (e) { if (onError) onError(e); return false; }
}

// Coming back to the page: from an email sign-in link (?login=…) or from
// Stripe Checkout (?plus=success|cancel). Returns what happened, for a message.
export async function handleReturn() {
  const q = new URLSearchParams(location.search);
  const clean = () => { ['login', 'plus', 'session_id'].forEach((k) => q.delete(k)); history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}${location.hash}`); };
  if (q.get('login')) {
    const token = q.get('login');
    clean();
    try { signIn(await call('login/verify', { token })); return { kind: 'signedIn' }; } catch (e) { return { kind: 'error', message: e.message }; }
  }
  if (q.get('plus') === 'success') {
    const id = q.get('session_id') || '';
    clean();
    try { user = (await call('sync', { session_id: id })).user; emit(); return { kind: 'paid' }; } catch (e) { return { kind: 'error', message: e.message }; }
  }
  if (q.get('plus') === 'cancel') { clean(); return { kind: 'cancelled' }; }
  return null;
}
