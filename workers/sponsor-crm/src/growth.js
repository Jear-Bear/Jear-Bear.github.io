// growth.js — tracked sponsor links (/go/<slug>) and invoices.
//
// Links: GET /go/<slug> on the Worker redirects to the stored target and adds
// one to that day's count. The site's 404 page sends jareddesu.com/go/<slug>
// here. Only stored links redirect (no open redirect), and only counts are
// kept: no IPs, cookies or user agents.

import { HttpError, getSetting, createRecord } from './data.js';
import { isUuid, isIsoDate } from '../../../scripts/manage/schema.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|whatsapp|telegram|curl|wget|python|headless|monitor|scan/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

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
  if (request.method === 'GET' && ua && !BOT.test(ua)) {
    const day = new Date().toISOString().slice(0, 10);
    ctx.waitUntil(env.DB.prepare('INSERT INTO link_clicks (slug, day, clicks) VALUES (?, ?, 1) ON CONFLICT (slug, day) DO UPDATE SET clicks = clicks + 1')
      .bind(slug, day).run().catch(() => {}));
  }
  return new Response(null, { status: 302, headers: { Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade', 'X-Robots-Tag': 'noindex' } });
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
