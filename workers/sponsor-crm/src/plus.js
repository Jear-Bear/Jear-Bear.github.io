// plus.js — Crossword+ members and the My deck daily limit.
//
// Until payments exist, membership is a key Jared creates in the Sponsor desk
// (shown once; only its SHA-256 is stored). The crossword page keeps the key
// in the visitor's browser and asks here before each deck puzzle.
//
//   POST /public/plus/check  { key, day }  → { ok, label, left }        (no sign-in)
//   POST /public/plus/deck   { key, day }  → { ok, left } or { ok: false, error: 'limit' | 'key' }
//   GET  /api/plus                          members with today's use (signed in)
//   POST /api/plus           { label, email }  → { member, key } (the key, this once)
//   PATCH /api/plus/:id      { revoked }
//
// day is the visitor's local date, so the limit resets at their midnight. It
// must be within a day of UTC, so it can't be used to get extra puzzles.

import { HttpError } from './data.js';
import { isUuid } from '../../../scripts/manage/schema.js';
import { hmacHex, bump, text } from './public.js';

export const DECK_PER_DAY = 2;
const KEY = /^CWP(?:-[A-Z2-9]{4}){4}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ch = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `CWP-${ch.slice(0, 4)}-${ch.slice(4, 8)}-${ch.slice(8, 12)}-${ch.slice(12, 16)}`;
}

function dayOf(v) {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const diff = Math.abs(Date.parse(`${v}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
  return diff <= 86400000 ? v : today;
}

async function readBody(request) {
  try { return JSON.parse((await request.text()).slice(0, 1000)) || {}; } catch { return {}; }
}

async function member(request, env, body) {
  const key = text(body.key, 40).toUpperCase();
  if (!KEY.test(key)) return null;
  // A few wrong keys per IP per hour, so keys can't be guessed
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const m = await env.DB.prepare('SELECT id, label, revoked FROM plus_members WHERE key_hash = ?').bind(await sha256(key)).first();
  if (!m || m.revoked) {
    await env.DB.prepare('DELETE FROM public_hits WHERE expires_at < ?').bind(now).run();
    if (!(await bump(env.DB, `plus-bad:${await hmacHex(env, `${ip}:${Math.floor(now / 3600)}`)}`, 20, 3600, now))) throw new HttpError(429, 'Too many tries. Please try again later.');
    return null;
  }
  return m;
}

const usedOn = async (db, id, day) => ((await db.prepare('SELECT made FROM plus_usage WHERE member_id = ? AND day = ?').bind(id, day).first()) || { made: 0 }).made;

export async function plusCheck(request, env) {
  const body = await readBody(request);
  const m = await member(request, env, body);
  if (!m) return { ok: false, error: 'key' };
  const made = await usedOn(env.DB, m.id, dayOf(body.day));
  return { ok: true, label: m.label || null, left: Math.max(0, DECK_PER_DAY - made), perDay: DECK_PER_DAY };
}

export async function plusDeck(request, env) {
  const body = await readBody(request);
  const m = await member(request, env, body);
  if (!m) return { ok: false, error: 'key' };
  const day = dayOf(body.day);
  // Count it only while under the limit (one statement, so two tabs can't both get the last one)
  const r = await env.DB.prepare(`INSERT INTO plus_usage (member_id, day, made) VALUES (?, ?, 1)
    ON CONFLICT (member_id, day) DO UPDATE SET made = made + 1 WHERE made < ? RETURNING made`).bind(m.id, day, DECK_PER_DAY).first();
  if (!r) return { ok: false, error: 'limit', left: 0 };
  await env.DB.prepare('UPDATE plus_members SET last_used = ? WHERE id = ?').bind(new Date().toISOString(), m.id).run();
  return { ok: true, left: Math.max(0, DECK_PER_DAY - r.made) };
}

// --- Sponsor desk -----------------------------------------------------------------------------
export async function listPlus(db) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await db.prepare(`SELECT m.id, m.label, m.email, m.created_at, m.revoked, m.last_used,
    COALESCE((SELECT SUM(made) FROM plus_usage u WHERE u.member_id = m.id), 0) AS made_total,
    COALESCE((SELECT made FROM plus_usage u WHERE u.member_id = m.id AND u.day = ?), 0) AS made_today
    FROM plus_members m ORDER BY m.created_at DESC`).bind(today).all();
  return { perDay: DECK_PER_DAY, members: results.map((r) => ({ ...r, revoked: Boolean(r.revoked) })) };
}

export async function createPlus(db, body) {
  const label = text(body && body.label, 80) || null;
  const email = text(body && body.email, 254).toLowerCase() || null;
  if (!label && !email) throw new HttpError(400, 'Add a name or an email so you know whose key it is');
  const key = newKey();
  const m = { id: crypto.randomUUID(), label, email, created_at: new Date().toISOString(), revoked: false, last_used: null };
  await db.prepare('INSERT INTO plus_members (id, key_hash, label, email, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(m.id, await sha256(key), m.label, m.email, m.created_at).run();
  return { member: m, key };
}

export async function updatePlus(db, id, body) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad member ID');
  const revoked = body && body.revoked ? 1 : 0;
  const r = await db.prepare('UPDATE plus_members SET revoked = ? WHERE id = ? RETURNING id').bind(revoked, id).first();
  if (!r) throw new HttpError(404, 'No such member');
  return { ok: true, revoked: Boolean(revoked) };
}
