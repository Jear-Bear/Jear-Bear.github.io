// growth.js — tracked sponsor links (/go/<slug>) and invoices.
//
// Links: GET /go/<slug> on the Worker redirects to the stored target and adds
// one to that day's count. The site's 404 page sends jareddesu.com/go/<slug>
// here. Only stored links redirect (no open redirect), and only counts are
// kept: no IPs, cookies or user agents.

import { HttpError, getSetting, createRecord } from './data.js';
import { isUuid, isIsoDate } from '../../../scripts/manage/schema.js';
import { hmacHex, bump } from './public.js';
import { sessionUser, isMember } from './plus.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|whatsapp|telegram|curl|wget|python|headless|monitor|scan/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const VIA = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;   // where the click came from, e.g. tools, guide, yt-shorts

// One more click for the link today, and for the place it came from if known
function countClick(env, ctx, slug, via) {
  const day = new Date().toISOString().slice(0, 10);
  const q = [env.DB.prepare('INSERT INTO link_clicks (slug, day, clicks) VALUES (?, ?, 1) ON CONFLICT (slug, day) DO UPDATE SET clicks = clicks + 1').bind(slug, day)];
  if (via && VIA.test(via)) q.push(env.DB.prepare('INSERT INTO link_click_via (slug, via, day, clicks) VALUES (?, ?, ?, 1) ON CONFLICT (slug, via, day) DO UPDATE SET clicks = clicks + 1').bind(slug, via, day));
  ctx.waitUntil(env.DB.batch(q).catch(() => {}));
}

function page(status, title, text) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)}</title><p>${esc(text)}</p><p><a href="https://www.jareddesu.com/">jareddesu.com</a></p>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export async function handleGo(request, env, ctx, slugRaw) {
  const slug = String(slugRaw || '').toLowerCase();
  if (!SLUG.test(slug)) return page(404, 'Link not found', 'That link doesn’t exist.');
  const link = await env.DB.prepare('SELECT target FROM links WHERE slug = ? AND archived = 0').bind(slug).first();
  if (!link) return page(404, 'Link not found', 'That link doesn’t exist or has ended.');
  let target;
  try { target = new URL(link.target); } catch { return page(404, 'Link not found', 'That link is broken.'); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return page(404, 'Link not found', 'That link is broken.');
  // Pass campaign parameters through (e.g. ?utm_source=youtube)
  new URL(request.url).searchParams.forEach((v, k) => { if (/^utm_[a-z]{1,20}$/.test(k) && !target.searchParams.has(k)) target.searchParams.set(k, v.slice(0, 100)); });
  const ua = request.headers.get('User-Agent') || '';
  if (request.method === 'GET' && ua && !BOT.test(ua)) countClick(env, ctx, slug, (new URL(request.url).searchParams.get('via') || '').toLowerCase());
  return new Response(null, { status: 302, headers: { Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade', 'X-Robots-Tag': 'noindex' } });
}

// A click on a sponsor card on the site (scripts/partner.js). The card links
// straight to the sponsor, so it's fast and works without this; the page sends
// a beacon here so the click is counted with the place it came from.
// Body (text/plain, so no preflight): {"slug":"ohanasi","via":"tools"}
export async function recordClick(request, env, ctx) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOT.test(ua)) return { ok: true };
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 500)); } catch { /* ignore */ }
  const slug = String(body.slug || '').toLowerCase();
  const via = String(body.via || '').toLowerCase();
  if (!SLUG.test(slug) || !VIA.test(via)) return { ok: false };
  const link = await env.DB.prepare('SELECT 1 FROM links WHERE slug = ? AND archived = 0').bind(slug).first();
  if (!link) return { ok: false };
  countClick(env, ctx, slug, via);
  return { ok: true };
}

// A sponsor card seen on the site (scripts/partner.js): at least half on screen for a second,
// once per card per page load. Body (text/plain, like a click):
//   {"slug":"ohanasi","via":"tools","t":"<session token, if signed in>"}
// Only stored links and the card places on the site count, and never a Crossword+ member's
// view (members see no sponsor cards on the games; the token is only checked, never kept).
// Counts only: no IPs, cookies or user agents are stored (the IP is hashed for the hourly limit).
export const CARD_PLACES = new Set(['crossword', 'crossword-solved', 'wordle', 'wordle-solved', 'tools', 'guide', 'guide-card']);
const VIEWS_PER_HOUR = 200;
export async function recordView(request, env, ctx) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOT.test(ua)) return { ok: true };
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 1000)); } catch { /* ignore */ }
  const slug = String(body.slug || '').toLowerCase();
  const via = String(body.via || '').toLowerCase();
  if (!SLUG.test(slug) || !CARD_PLACES.has(via)) return { ok: false };
  const link = await env.DB.prepare('SELECT 1 FROM links WHERE slug = ? AND archived = 0').bind(slug).first();
  if (!link) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!(await bump(env.DB, `view:${await hmacHex(env, `${ip}:${Math.floor(now / 3600)}`)}`, VIEWS_PER_HOUR, 3600, now))) return { ok: false };
  if (typeof body.t === 'string' && body.t.length < 300) {
    const u = await sessionUser({ headers: new Headers({ Authorization: `Bearer ${body.t}` }) }, env).catch(() => null);
    if (isMember(u)) return { ok: true, member: true };
  }
  const day = new Date().toISOString().slice(0, 10);
  ctx.waitUntil(env.DB.prepare('INSERT INTO partner_views (slug, via, day, views) VALUES (?, ?, ?, 1) ON CONFLICT (slug, via, day) DO UPDATE SET views = views + 1').bind(slug, via, day).run().catch(() => {}));
  return { ok: true };
}

// The sponsor cards by month: views, clicks and click-through rate per place and in total
// (GET /api/sponsor-cards, and the MCP site-traffic tool). Clicks are the cards' own
// (link_click_via for the card places), so ?via= links in videos don't skew the rate.
const ctr = (clicks, views) => (views ? Math.round((clicks / views) * 1000) / 10 : null);
export async function sponsorCards(db, { months = 12 } = {}) {
  const n = Math.max(1, Math.min(24, Number(months) || 12));
  const d = new Date();
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1), 1)).toISOString().slice(0, 10);
  const places = [...CARD_PLACES];
  const marks = places.map(() => '?').join(',');
  const [views, clicks] = await db.batch([
    db.prepare(`SELECT slug, via, substr(day, 1, 7) AS month, SUM(views) AS n FROM partner_views WHERE day >= ? GROUP BY slug, via, month`).bind(since),
    db.prepare(`SELECT slug, via, substr(day, 1, 7) AS month, SUM(clicks) AS n FROM link_click_via WHERE day >= ? AND via IN (${marks}) GROUP BY slug, via, month`).bind(since, ...places),
  ]);
  const byMonth = new Map();
  const row = (r) => {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map());
    const m = byMonth.get(r.month);
    const k = `${r.slug}|${r.via}`;
    if (!m.has(k)) m.set(k, { slug: r.slug, via: r.via, views: 0, clicks: 0 });
    return m.get(k);
  };
  views.results.forEach((r) => { row(r).views += r.n; });
  clicks.results.forEach((r) => { row(r).clicks += r.n; });
  const out = [...byMonth].sort((a, b) => b[0].localeCompare(a[0])).map(([month, m]) => {
    const rows = [...m.values()].map((r) => ({ ...r, ctr: ctr(r.clicks, r.views) })).sort((a, b) => b.views - a.views || b.clicks - a.clicks);
    const v = rows.reduce((x, r) => x + r.views, 0);
    const c = rows.reduce((x, r) => x + r.clicks, 0);
    return { month, places: rows, total: { views: v, clicks: c, ctr: ctr(c, v) } };
  });
  return { since, months: out };
}

// --- Invoices ---------------------------------------------------------------------------------
const clip = (v, n) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, n) || null);
const money = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= 1e7 ? Math.round(n * 100) / 100 : null;
};

export async function createInvoice(db, body) {
  if (!body || !isUuid(body.deal_id)) throw new HttpError(400, 'Pick a deal');
  const deal = await db.prepare('SELECT id FROM deals WHERE id = ?').bind(body.deal_id).first();
  if (!deal) throw new HttpError(400, 'That deal doesn’t exist');
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 20).map((l) => ({ description: clip(l && l.description, 300), amount: money(l && l.amount) }));
  if (!lines.length || lines.some((l) => !l.description || l.amount == null)) throw new HttpError(400, 'Each line needs a description and an amount');
  const date = isIsoDate(body.date) ? body.date : null;
  const due = isIsoDate(body.due) ? body.due : null;
  if (!date) throw new HttpError(400, 'Pick an invoice date');
  if (due && due < date) throw new HttpError(400, 'The due date is before the invoice date');
  const b = body.bill_to || {};
  const billTo = { name: clip(b.name, 120), contact: clip(b.contact, 120), email: clip(b.email, 254), address: clip(b.address, 400) };
  if (!billTo.name) throw new HttpError(400, 'Who is the invoice for?');
  const settings = await getSetting(db, 'invoicing', {});
  const prefix = settings.prefix || 'INV-';
  // Next number, atomically
  const row = await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('invoice_seq', '1', ?) "
    + 'ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at RETURNING value')
    .bind(new Date().toISOString()).first();
  const number = `${prefix}${String(Number(row.value) + (settings.startAt ? settings.startAt - 1 : 0)).padStart(4, '0')}`;
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const invoice = { bill_to: billTo, lines, date, due, notes: clip(body.notes, 500), from: { name: settings.name || null, email: settings.email || null, address: settings.address || null }, payment: settings.payment || null };
  const pay = await createRecord(db, 'payments', { deal_id: body.deal_id, amount: total, invoiced_on: date, invoice_no: number, notes: `Invoice ${number}` });
  await db.prepare('UPDATE payments SET invoice = ? WHERE id = ?').bind(JSON.stringify(invoice), pay.id).run();
  return { ...pay, invoice, invoice_no: number };
}
