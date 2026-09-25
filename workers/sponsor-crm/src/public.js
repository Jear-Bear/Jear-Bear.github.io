// public.js — the only CRM endpoints that work without signing in, both for
// the public sponsor page (www.jareddesu.com/sponsorships/):
//
//   GET  /public/availability  months with open sponsor slots (counts only:
//                              no brand names, titles or prices)
//   POST /public/inquiry       the sponsor form, filed in Review as a new
//                              company + inbound deal proposal (the form
//                              still emails you through Web3Forms too)
//
// Inquiries are rate-limited per IP (hashed) and in total, size-limited and
// validated; nothing from the form is ever rendered as HTML.

import { normalizeDomain } from '../../../scripts/manage/schema.js';
import { videoStatus, todayIn, addMonths, monthOf } from '../../../scripts/manage/rules.js';
import { HttpError } from './data.js';
import { createProposal } from './claude.js';

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|qq|163|naver|hey)\.[a-z.]+$/;
const PER_IP_HOUR = 5;
const PER_DAY = 40;

export async function availability(db, tz) {
  const today = todayIn(tz);
  const [videos, deals] = await db.batch([
    db.prepare('SELECT id, publish_date, format, sponsor_status, archived FROM videos WHERE archived = 0 AND publish_date >= ?').bind(today),
    db.prepare('SELECT video_id, stage, archived FROM deals WHERE archived = 0 AND video_id IS NOT NULL'),
  ]);
  const first = monthOf(today);
  const months = Array.from({ length: 6 }, (_, i) => ({ month: addMonths(first, i), open: 0, booked: 0 }));
  for (const v of videos.results) {
    if (v.sponsor_status === 'sponsor_free' || (v.format && v.format !== 'guide')) continue;
    const m = months.find((x) => x.month === monthOf(v.publish_date));
    if (!m) continue;
    const st = videoStatus(v, deals.results);
    if (st === 'booked') m.booked += 1; else m.open += 1;
  }
  return { asOf: today, months };
}

async function hmacHex(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CRM_SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function bump(db, key, limit, ttl, now) {
  const r = await db.prepare('INSERT INTO public_hits (key, n, expires_at) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, now + ttl).first();
  return r.n <= limit;
}

const text = (v, n) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, n) : '');

export async function inquiry(request, env) {
  const db = env.DB;
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > 20000) throw new HttpError(413, 'Too long');
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 20000)); } catch { throw new HttpError(400, 'Bad form'); }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Bad form');
  if (body.website) return { ok: true };                       // honeypot: pretend it worked
  const name = text(body.name, 120);
  const email = text(body.email, 254).toLowerCase();
  const brand = text(body.brand, 120);
  const message = text(body.message, 4000);
  if (!name || !brand || !message || !/^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(email)) throw new HttpError(400, 'Please fill in your name, email, brand and message');

  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await db.prepare('DELETE FROM public_hits WHERE expires_at < ?').bind(now).run();
  const hour = Math.floor(now / 3600);
  const okIp = await bump(db, `ip:${await hmacHex(env, `${ip}:${hour}`)}`, PER_IP_HOUR, 3600, now);
  const okDay = await bump(db, `day:${Math.floor(now / 86400)}`, PER_DAY, 86400, now);
  if (!okIp || !okDay) throw new HttpError(429, 'Too many inquiries right now. Please email instead.');

  const domain = normalizeDomain(email.split('@')[1]);
  const campaign = text(body.campaign, 200);
  const timeframe = text(body.timeframe, 100);
  const budget = text(body.budget, 60);
  const deliverables = text(Array.isArray(body.deliverables) ? body.deliverables.join(', ') : body.deliverables, 300);
  const notes = [
    'Inquiry from the sponsor page.',
    campaign && `Campaign: ${campaign}.`, timeframe && `Timeframe: ${timeframe}.`, budget && `Budget: ${budget}.`,
    deliverables && `Interested in: ${deliverables}.`, `Message: ${message}`,
  ].filter(Boolean).join(' ').slice(0, 4900);

  // A tracked company gets a new-deal proposal; a new brand gets a new company + deal
  const known = domain ? await db.prepare('SELECT company_id FROM company_domains WHERE domain = ?').bind(domain).first() : null;
  const byName = known ? null : await db.prepare('SELECT id FROM companies WHERE lower(name) = lower(?) AND archived = 0').bind(brand).first();
  const companyId = known ? known.company_id : byName ? byName.id : null;
  const evidence = { email_date: new Date().toISOString(), subject: `Sponsor page inquiry from ${brand}`, quote: message.slice(0, 290), message_id: `web:${await hmacHex(env, `${email}:${message}`)}` };
  const deal = { source: 'Inbound', stage: 'In conversation', replied_on: todayIn('America/Chicago'), notes };
  if (companyId) {
    await createProposal(db, { kind: 'new_deal', company_id: companyId, values: deal, evidence, reason: `${name} (${email}) asked about sponsoring through the website form.`, confidence: 'high' });
  } else {
    await createProposal(db, {
      kind: 'new_company_deal',
      values: { company: { name: brand, domains: domain && !FREE_MAIL.test(domain) ? [domain] : [] }, contact: { name, email, role: null }, deal },
      evidence, reason: `${name} (${email}) asked about sponsoring through the website form.`, confidence: 'high',
    });
  }
  return { ok: true };
}

