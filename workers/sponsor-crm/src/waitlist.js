// waitlist.js — the Crossword+ waitlist: people who'd like one email when
// optional extras (full archive, bonus puzzles) launch. The daily puzzles stay
// free either way.
//
//   POST /public/crossword-interest   { email, wants: [...], lang }  (no sign-in)
//   GET  /public/crossword-leave?t=…  one-click removal, linked from that email
//   GET  /api/waitlist                the list, for the Sponsor desk (signed in)
//
// Emails live only in D1, are used for that one note, and are deleted on
// request. Rate-limited per (hashed) IP and per day, like the sponsor form.

import { HttpError } from './data.js';
import { hmacHex, bump, text } from './public.js';

export const WANTS = ['archive', 'bonus', 'sync', 'print'];
const PER_IP_HOUR = 5;
const PER_DAY = 300;
const EMAIL = /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export async function joinWaitlist(request, env) {
  const db = env.DB;
  if (Number(request.headers.get('Content-Length') || 0) > 4000) throw new HttpError(413, 'Too long');
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 4000)); } catch { throw new HttpError(400, 'Bad form'); }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Bad form');
  // Spam trap: bots fill every field. Only the new trap field counts; the old
  // one ("website") got filled by browser autofill for real people.
  if (body.trap) return { ok: true };
  const email = text(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'That email doesn’t look right');
  const wants = Array.isArray(body.wants) ? [...new Set(body.wants.filter((w) => WANTS.includes(w)))] : [];
  const lang = body.lang === 'ja' ? 'ja' : 'en';

  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await db.prepare('DELETE FROM public_hits WHERE expires_at < ?').bind(now).run();
  const okIp = await bump(db, `wl-ip:${await hmacHex(env, `${ip}:${Math.floor(now / 3600)}`)}`, PER_IP_HOUR, 3600, now);
  const okDay = await bump(db, `wl-day:${Math.floor(now / 86400)}`, PER_DAY, 86400, now);
  if (!okIp || !okDay) throw new HttpError(429, 'Too many tries right now. Please try again later.');

  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Signing up again just updates what they'd like; it doesn't say whether the email was already there
  await db.prepare(`INSERT INTO crossword_waitlist (email, token, wants, lang, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET wants = excluded.wants, lang = excluded.lang`)
    .bind(email, token, JSON.stringify(wants), lang, new Date().toISOString()).run();
  return { ok: true };
}

const page = (title, msg) => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222;background:#f7f4ec}a{color:#2a62b0}</style></head>
<body><h1 style="font-size:1.4rem">${title}</h1><p>${msg}</p><p><a href="https://www.jareddesu.com/tools/crossword/">Back to the crossword</a></p></body></html>`,
{ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function leaveWaitlist(env, url) {
  const t = (url.searchParams.get('t') || '').replace(/[^0-9a-f]/g, '').slice(0, 32);
  if (t.length === 32) await env.DB.prepare('DELETE FROM crossword_waitlist WHERE token = ?').bind(t).run();
  // Same answer whether or not the link matched, so it can't be used to probe
  return page('You’re off the list', 'Your email has been deleted from the Crossword+ list. The daily crosswords are still free, so come back anytime.');
}

export async function listWaitlist(db) {
  const { results } = await db.prepare('SELECT email, token, wants, lang, created_at FROM crossword_waitlist ORDER BY created_at DESC').all();
  const wants = Object.fromEntries(WANTS.map((w) => [w, 0]));
  const rows = results.map((r) => {
    let w = [];
    try { w = JSON.parse(r.wants); } catch { /* keep empty */ }
    w.forEach((k) => { if (k in wants) wants[k] += 1; });
    return { email: r.email, wants: w, lang: r.lang, created_at: r.created_at, token: r.token };
  });
  const week = Date.now() - 7 * 86400000;
  return { count: rows.length, last7: rows.filter((r) => Date.parse(r.created_at) >= week).length, wants, rows };
}
