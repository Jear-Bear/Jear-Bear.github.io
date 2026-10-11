// stripe.js — Crossword+ payments with Stripe: Checkout for the subscription,
// the Customer Portal for managing it, and webhooks to keep accounts in sync.
//
// People sign in first (plus.js), so every subscription belongs to an
// account's email: each account gets one Stripe customer, made with that
// email, and webhooks set the account's status from its subscription.
//
//   POST /public/plus/checkout { plan }       → { url }    Stripe Checkout (month or year), signed in
//   POST /public/plus/sync { session_id }     → { user }   back from Checkout: update right away
//   POST /public/plus/portal {}               → { url }    manage or cancel (Stripe's page), signed in
//   POST /public/stripe/webhook                            Stripe → here (signed)
//   POST /api/plus/stripe-setup                            Sponsor desk: "Connect Stripe"
//
// The only secret is STRIPE_SECRET_KEY (a GitHub secret, pushed to the Worker
// on deploy). "Connect Stripe" makes the prices (found by lookup key, so it's
// safe to run again), the portal settings and the webhook, and keeps the
// webhook's signing secret in D1 (stripe_config), never in the repo.
// Card details never touch this Worker: Stripe's own pages take them.

import { HttpError } from './data.js';
import { text } from './public.js';
import { sessionUser, publicUser, siteFor, sendWelcome } from './plus.js';

const API_VERSION = '2024-06-20';                 // pinned: subscription.current_period_end lives on the subscription
export const PLANS = {
  month: { amount: 299, interval: 'month', lookup: 'crossword_plus_month', label: '$2.99' },
  year: { amount: 2499, interval: 'year', lookup: 'crossword_plus_year', label: '$24.99' },
};
const EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
const PRODUCT_TAG = 'crossword_plus';
const SITE = 'https://www.jareddesu.com';

export const stripeMode = (env) => (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '') ? 'live' : 'test');

// Stripe's form encoding: a[b]=1, list[0]=x, list[0][k]=y
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Payments aren’t set up yet');
  const base = `${env.STRIPE_API_BASE || 'https://api.stripe.com'}/v1/${path}`;
  const body = form(params);
  const noBody = method === 'GET' || method === 'DELETE';
  const res = await fetch(noBody ? `${base}${body.toString() ? `?${body}` : ''}` : base, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': API_VERSION },
    body: noBody ? undefined : body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe', method, path, res.status, json.error && json.error.message);
    throw new HttpError(res.status >= 500 ? 502 : 400, `Stripe: ${(json.error && json.error.message) || res.status}`);
  }
  return json;
}

async function loadConfig(db, mode) {
  const r = await db.prepare('SELECT value FROM stripe_config WHERE mode = ?').bind(mode).first();
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}
const saveConfig = (db, mode, value) => db.prepare('INSERT INTO stripe_config (mode, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (mode) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
  .bind(mode, JSON.stringify(value), new Date().toISOString()).run();

// --- Sponsor desk: Connect Stripe ------------------------------------------------------------
export async function stripeSetup(env, db, workerOrigin) {
  const mode = stripeMode(env);
  const cfg = (await loadConfig(db, mode)) || {};
  cfg.prices = cfg.prices || {};
  for (const [plan, p] of Object.entries(PLANS)) {
    const found = await stripe(env, 'GET', 'prices', { lookup_keys: [p.lookup], active: 'true', limit: 1 });
    let price = found.data && found.data[0];
    if (!price) {
      price = await stripe(env, 'POST', 'prices', {
        currency: 'usd', unit_amount: p.amount, recurring: { interval: p.interval }, lookup_key: p.lookup, nickname: `Crossword+ (${plan})`,
        ...(cfg.product ? { product: cfg.product } : { product_data: { name: 'Crossword+', metadata: { product: PRODUCT_TAG } } }),
        metadata: { product: PRODUCT_TAG },
      });
    }
    cfg.prices[plan] = price.id;
    cfg.product = typeof price.product === 'string' ? price.product : price.product.id;
  }
  // The Customer Portal: cancel (at the end of the period), switch month/year, update the card, invoices
  if (!cfg.portal) {
    const pc = await stripe(env, 'POST', 'billing_portal/configurations', {
      business_profile: { headline: 'Crossword+ on jareddesu.com' },
      default_return_url: `${SITE}/tools/crossword/`,
      features: {
        invoice_history: { enabled: 'true' },
        payment_method_update: { enabled: 'true' },
        subscription_cancel: { enabled: 'true', mode: 'at_period_end' },
        subscription_update: { enabled: 'true', default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{ product: cfg.product, prices: [cfg.prices.month, cfg.prices.year] }] },
      },
    });
    cfg.portal = pc.id;
  }
  // The webhook (its signing secret is only shown when it's made, so remake it if we don't have it)
  const url = `${workerOrigin}/public/stripe/webhook`;
  if (!cfg.webhook_secret || cfg.webhook_url !== url) {
    const list = await stripe(env, 'GET', 'webhook_endpoints', { limit: 100 });
    for (const w of list.data || []) if (w.url === url) await stripe(env, 'DELETE', `webhook_endpoints/${w.id}`);
    const w = await stripe(env, 'POST', 'webhook_endpoints', { url, enabled_events: EVENTS, api_version: API_VERSION, description: 'Crossword+ (jareddesu.com sponsor Worker)' });
    cfg.webhook_id = w.id; cfg.webhook_secret = w.secret; cfg.webhook_url = url;
  }
  await saveConfig(db, mode, cfg);
  // Going live: test-mode payments were never real, so those accounts start fresh
  // (free access given in the desk stays). Their test welcome doesn't count either.
  let cleared = 0;
  if (mode === 'live') {
    const r = await db.prepare("UPDATE plus_users SET stripe_customer = NULL, stripe_subscription = NULL, status = NULL, plan = NULL, period_end = NULL, stripe_mode = NULL, welcomed_at = CASE WHEN granted = 1 THEN welcomed_at ELSE NULL END WHERE COALESCE(stripe_mode, 'test') <> 'live' AND (stripe_customer IS NOT NULL OR stripe_subscription IS NOT NULL OR status IS NOT NULL)").run();
    cleared = (r.meta && r.meta.changes) || 0;
  }
  return { mode, prices: cfg.prices, product: cfg.product, portal: cfg.portal, webhook: cfg.webhook_url, cleared_test_accounts: cleared };
}

export async function stripeStatus(env, db) {
  if (!env.STRIPE_SECRET_KEY) return { connected: false, key: false };
  const mode = stripeMode(env);
  const cfg = await loadConfig(db, mode);
  return { connected: Boolean(cfg && cfg.webhook_secret && cfg.prices && cfg.prices.month), key: true, mode };
}

// What the page needs to know before showing sign-in and the plans
export async function plusInfo(env) {
  const st = await stripeStatus(env, env.DB);
  return {
    open: st.connected, test: st.connected && st.mode === 'test',
    google: env.GOOGLE_CLIENT_ID || null, email: Boolean(env.RESEND_API_KEY), embedded: Boolean(env.STRIPE_PUBLISHABLE_KEY),
    prices: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, p.label])),
  };
}

// --- subscriptions → accounts ------------------------------------------------------------------
const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
const planOf = (sub) => { const it = sub && sub.items && sub.items.data && sub.items.data[0]; return it && it.price && it.price.recurring ? it.price.recurring.interval : null; };

async function applySubscription(env, db, sub) {
  if (!sub || typeof sub !== 'object' || !sub.customer) return;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const u = await db.prepare('SELECT id, stripe_subscription, status FROM plus_users WHERE stripe_customer = ?').bind(customer).first();
  if (!u) return;
  // An account has one subscription; a newer live one wins over an ended old one
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  if (u.stripe_subscription && u.stripe_subscription !== sub.id && !live && ['active', 'trialing', 'past_due'].includes(u.status)) return;
  await db.prepare('UPDATE plus_users SET stripe_subscription = ?, status = ?, plan = ?, period_end = ? WHERE id = ?')
    .bind(sub.id, sub.status, planOf(sub), iso(sub.current_period_end), u.id).run();
  // A new member: the one welcome email (sendWelcome makes sure it's only once)
  if (['active', 'trialing'].includes(sub.status)) await sendWelcome(env, db, u.id, 'paid');
}

// One Stripe customer per account and mode: a test-mode customer doesn't exist in live mode
async function customerFor(env, u) {
  const mode = stripeMode(env);
  if (u.stripe_customer && (u.stripe_mode || 'test') === mode) return u.stripe_customer;
  const c = await stripe(env, 'POST', 'customers', { email: u.email, name: u.name || undefined, metadata: { product: PRODUCT_TAG, account: u.id } });
  // Two tabs at once: keep whichever was saved first
  await env.DB.prepare("UPDATE plus_users SET stripe_customer = ?, stripe_mode = ? WHERE id = ? AND (stripe_customer IS NULL OR COALESCE(stripe_mode, 'test') <> ?)")
    .bind(c.id, mode, u.id, mode).run();
  return (await env.DB.prepare('SELECT stripe_customer FROM plus_users WHERE id = ?').bind(u.id).first()).stripe_customer;
}

async function readBody(request) {
  try { return JSON.parse((await request.text()).slice(0, 1000)) || {}; } catch { return {}; }
}

export async function plusCheckout(request, env, origin) {
  const u = await sessionUser(request, env);
  if (!u) throw new HttpError(401, 'Sign in first, so Crossword+ is tied to your email');
  const body = await readBody(request);
  const plan = body.plan === 'year' ? 'year' : 'month';
  const cfg = await loadConfig(env.DB, stripeMode(env));
  if (!env.STRIPE_SECRET_KEY || !cfg || !cfg.prices) throw new HttpError(503, 'Crossword+ isn’t open yet');
  if (['active', 'trialing', 'past_due'].includes(u.status)) throw new HttpError(409, 'You’re already a member. Use “Manage subscription” to change plans.');
  const site = siteFor(origin);
  // Embedded Checkout (Stripe's form on our page) needs the publishable key; otherwise Stripe's own page
  const embedded = Boolean(body.embedded && env.STRIPE_PUBLISHABLE_KEY);
  const back = `${site}/tools/crossword/?plus=success&session_id={CHECKOUT_SESSION_ID}`;
  const s = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'subscription',
    ...(embedded ? { ui_mode: 'embedded', return_url: back } : { success_url: back, cancel_url: `${site}/tools/crossword/?plus=cancel` }),
    customer: await customerFor(env, u),
    client_reference_id: u.id,
    line_items: [{ price: cfg.prices[plan], quantity: 1 }],
    allow_promotion_codes: 'true',
    metadata: { product: PRODUCT_TAG, account: u.id },
    subscription_data: { metadata: { product: PRODUCT_TAG, account: u.id } },
    ...(env.STRIPE_AUTOMATIC_TAX === 'true' ? { automatic_tax: { enabled: 'true' }, customer_update: { address: 'auto' } } : {}),
  });
  return embedded ? { clientSecret: s.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY } : { url: s.url };
}

// Back from Checkout: read the session from Stripe so the account is a member
// right away (the webhook does the same, but can take a few seconds)
export async function plusSync(request, env) {
  const u = await sessionUser(request, env);
  if (!u) throw new HttpError(401, 'Please sign in again');
  const body = await readBody(request);
  const id = text(body.session_id, 255);
  if (/^cs_[A-Za-z0-9_]{8,250}$/.test(id)) {
    const s = await stripe(env, 'GET', `checkout/sessions/${id}`, { expand: ['subscription'] });
    const customer = typeof s.customer === 'string' ? s.customer : s.customer && s.customer.id;
    if (customer && customer === u.stripe_customer && s.status === 'complete') await applySubscription(env, env.DB, s.subscription);
  }
  const fresh = await env.DB.prepare('SELECT * FROM plus_users WHERE id = ?').bind(u.id).first();
  return { user: await publicUser(env.DB, fresh, body.day) };
}

export async function plusPortal(request, env, origin) {
  const u = await sessionUser(request, env);
  if (!u) throw new HttpError(401, 'Please sign in again');
  if (!u.stripe_customer) throw new HttpError(400, 'There’s no subscription on this account');
  const cfg = await loadConfig(env.DB, stripeMode(env));
  const s = await stripe(env, 'POST', 'billing_portal/sessions', { customer: u.stripe_customer, return_url: `${siteFor(origin)}/tools/crossword/`, ...(cfg && cfg.portal ? { configuration: cfg.portal } : {}) });
  return { url: s.url };
}

// --- webhook --------------------------------------------------------------------------------
async function verify(secret, header, payload) {
  const items = String(header || '').split(',').map((kv) => kv.trim());
  const t = Number((items.find((kv) => kv.startsWith('t=')) || '').slice(2));
  const sigs = items.filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === mac.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}

export async function stripeWebhook(request, env) {
  const payload = await request.text();
  const header = request.headers.get('Stripe-Signature');
  let ok = false;
  for (const mode of ['live', 'test']) {
    const cfg = await loadConfig(env.DB, mode);
    if (cfg && cfg.webhook_secret && (await verify(cfg.webhook_secret, header, payload))) { ok = true; break; }
  }
  if (!ok) return new Response('Bad signature', { status: 400 });
  const ev = JSON.parse(payload);
  const o = ev.data && ev.data.object;
  if (o && ev.type && ev.type.startsWith('customer.subscription.') && o.metadata && o.metadata.product === PRODUCT_TAG) await applySubscription(env, env.DB, o);
  else if (o && ev.type === 'checkout.session.completed' && o.metadata && o.metadata.product === PRODUCT_TAG && o.subscription) {
    await applySubscription(env, env.DB, typeof o.subscription === 'string' ? await stripe(env, 'GET', `subscriptions/${o.subscription}`) : o.subscription);
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
