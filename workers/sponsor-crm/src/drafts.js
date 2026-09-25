// drafts.js — requests for Claude to draft an email in Gmail (a pitch, a
// follow-up or a 30-day recap). You ask from a deal in the app; the next
// Claude run picks the request up, saves a Gmail draft (never sends) and
// marks it done with a short note.

import { HttpError } from './data.js';
import { isUuid } from '../../../scripts/manage/schema.js';

const KINDS = ['pitch', 'recap', 'follow_up'];
const nowIso = () => new Date().toISOString();
const clip = (v, n) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, n) || null);

export async function listDrafts(db, { status } = {}) {
  const r = status
    ? await db.prepare('SELECT * FROM draft_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200').bind(status).all()
    : await db.prepare('SELECT * FROM draft_requests ORDER BY created_at DESC LIMIT 200').all();
  return r.results;
}

export async function requestDraft(db, body) {
  if (!body || !KINDS.includes(body.kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  if (!isUuid(body.deal_id) || !(await db.prepare('SELECT 1 FROM deals WHERE id = ?').bind(body.deal_id).first())) throw new HttpError(400, 'Pick a deal');
  const open = await db.prepare("SELECT id FROM draft_requests WHERE deal_id = ? AND kind = ? AND status = 'open'").bind(body.deal_id, body.kind).first();
  if (open) throw new HttpError(409, 'Claude already has this one queued');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO draft_requests (id, kind, deal_id, notes, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, body.kind, body.deal_id, clip(body.notes, 1000), nowIso()).run();
  return db.prepare('SELECT * FROM draft_requests WHERE id = ?').bind(id).first();
}

export async function closeDraft(db, id, { status, result }) {
  if (!isUuid(id)) throw new HttpError(400, 'Bad ID');
  if (!['done', 'cancelled'].includes(status)) throw new HttpError(400, 'status must be done or cancelled');
  const r = await db.prepare("UPDATE draft_requests SET status = ?, result = ?, done_at = ? WHERE id = ? AND status = 'open'")
    .bind(status, clip(result, 500), nowIso(), id).run();
  if (!r.meta.changes) throw new HttpError(409, 'That request isn’t open');
  return { id, status };
}
