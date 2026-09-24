// rules.js — every computed number in the sponsor CRM: follow-ups, overdue
// actions, price and conflict checks, and dashboard metrics. Shared by the
// browser app and the Worker (so Claude's connector reads the same numbers).
// Pure functions over plain data; dates are ISO "YYYY-MM-DD" strings.

import { OPEN_STAGES, WON_STAGES, CLOSED_STAGES } from './schema.js';

export const DEFAULT_TZ = 'America/Chicago';
export const FOLLOW_UP_DAYS = [4, 10];     // after pitching (plan: day 4 and day 10, then stop)
export const CLOSE_OUT_DAYS = 14;          // no answer after follow-up 2: suggest "No reply"
export const CATEGORY_GAP_DAYS = 60;       // same-category sponsors at least this far apart

// --- Dates -------------------------------------------------------------------
export function todayIn(tz = DEFAULT_TZ, now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const toUtc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export function addDays(iso, n) { return new Date(toUtc(iso) + n * 86400000).toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 86400000); }
export function weekStart(iso) {                      // Monday
  const dow = new Date(toUtc(iso)).getUTCDay();       // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}
export const monthOf = (iso) => (iso ? iso.slice(0, 7) : null);
export function addMonths(month, n) {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const live = (r) => r && !r.archived;
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const round2 = (n) => Math.round(n * 100) / 100;

// --- Per-deal checks -----------------------------------------------------------
// Which follow-up is next for a deal, and whether it's due.
export function followUp(deal, today) {
  if (!live(deal) || !deal.pitched_on) return null;
  const step = { 'Pitched': 1, 'Follow-up 1 sent': 2, 'Follow-up 2 sent': 3 }[deal.stage];
  if (!step) return null;
  if (step === 3) {
    const due = addDays(deal.pitched_on, CLOSE_OUT_DAYS);
    return { step, label: 'Mark as No reply?', due, isDue: today >= due };
  }
  const due = addDays(deal.pitched_on, FOLLOW_UP_DAYS[step - 1]);
  return { step, label: `Follow-up ${step}`, due, isDue: today >= due };
}

export function isOverdue(deal, today) {
  return live(deal) && !!deal.next_action_date && deal.next_action_date < today && !CLOSED_STAGES.includes(deal.stage);
}

export function floorFor(pkg, rateCard) {
  if (!pkg) return null;
  const row = rateCard.find((r) => live(r) && r.package.toLowerCase() === String(pkg).toLowerCase());
  return row && row.floor != null ? row.floor : null;
}

// Price check: the final (or, until then, quoted) amount against the package floor
export function priceCheck(deal, rateCard) {
  const amount = deal.final ?? deal.quoted;
  const floor = floorFor(deal.package, rateCard);
  if (amount == null || floor == null) return null;
  return { amount, floor, below: amount < floor, basis: deal.final != null ? 'final' : 'quoted' };
}

// --- Conflicts -------------------------------------------------------------------
// Returns [{ type, severity: 'conflict' | 'warn', message, dealIds, videoIds }]
export function conflicts(state) {
  const out = [];
  const companies = new Map(state.companies.map((c) => [c.id, c]));
  const videos = new Map(state.videos.map((v) => [v.id, v]));
  const committed = state.deals.filter((d) => live(d) && (WON_STAGES.includes(d.stage) || d.stage === 'Negotiating'));
  const name = (d) => (companies.get(d.company_id) || {}).name || 'Unknown company';
  const sev = (...ds) => (ds.every((d) => WON_STAGES.includes(d.stage)) ? 'conflict' : 'warn');
  const pubDate = (d) => d.publish_date || (videos.get(d.video_id) || {}).publish_date || null;

  // One sponsor per video
  const byVideo = new Map();
  committed.filter((d) => d.video_id).forEach((d) => byVideo.set(d.video_id, [...(byVideo.get(d.video_id) || []), d]));
  for (const [vid, ds] of byVideo) {
    if (ds.length < 2) continue;
    const v = videos.get(vid);
    out.push({
      type: 'video', severity: sev(...ds), dealIds: ds.map((d) => d.id), videoIds: [vid],
      message: `${ds.map(name).join(' and ')} are both on "${v ? v.title : 'one video'}". One sponsor per video.`,
    });
  }

  // Same-category sponsors within 60 days of each other
  for (let i = 0; i < committed.length; i++) {
    for (let j = i + 1; j < committed.length; j++) {
      const a = committed[i];
      const b = committed[j];
      if (a.company_id === b.company_id) continue;
      const ca = (companies.get(a.company_id) || {}).category;
      const cb = (companies.get(b.company_id) || {}).category;
      if (!ca || ca !== cb || ca === 'Other') continue;
      const da = pubDate(a);
      const db = pubDate(b);
      if (!da || !db) continue;
      const gap = Math.abs(daysBetween(da, db));
      if (gap > CATEGORY_GAP_DAYS) continue;
      out.push({
        type: 'category', severity: sev(a, b), dealIds: [a.id, b.id], videoIds: [],
        message: `${name(a)} and ${name(b)} are both ${ca}, ${gap} day${gap === 1 ? '' : 's'} apart (keep ${CATEGORY_GAP_DAYS}+).`,
      });
    }
  }

  // At least one video in four stays sponsor-free
  const sponsored = new Set(committed.filter((d) => WON_STAGES.includes(d.stage) && d.video_id).map((d) => d.video_id));
  const run = state.videos
    .filter((v) => live(v) && v.publish_date)
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date));
  const hasSponsor = (v) => v.sponsor_status === 'booked' || sponsored.has(v.id);
  for (let i = 0; i + 4 <= run.length; i++) {
    const win = run.slice(i, i + 4);
    if (win.every(hasSponsor)) {
      out.push({
        type: 'sponsor-free', severity: 'warn', dealIds: [], videoIds: win.map((v) => v.id),
        message: `Four sponsored videos in a row (${win[0].publish_date} to ${win[3].publish_date}). Keep one in four sponsor-free.`,
      });
      i += 3;
    }
  }

  // Sponsors go only in guide videos
  for (const d of committed) {
    const v = videos.get(d.video_id);
    if (v && v.format && v.format !== 'guide') {
      out.push({
        type: 'format', severity: 'warn', dealIds: [d.id], videoIds: [v.id],
        message: `${name(d)} is on "${v.title}", which isn't a guide video. Paid segments go only in guides.`,
      });
    }
  }
  return out;
}

// Effective sponsor status of a video: a booked deal wins over the stored value
export function videoStatus(video, deals) {
  const linked = deals.filter((d) => live(d) && d.video_id === video.id);
  if (linked.some((d) => WON_STAGES.includes(d.stage))) return 'booked';
  if (video.sponsor_status === 'sponsor_free') return 'sponsor_free';
  if (video.sponsor_status === 'booked') return 'booked';
  if (linked.some((d) => OPEN_STAGES.includes(d.stage)) || video.sponsor_status === 'pitched') return 'pitched';
  return 'open';
}

// --- Dashboard ---------------------------------------------------------------------
export function defaultTargets(today) {
  const start = monthOf(today);
  return {
    weeklyPitches: 5,
    months: Array.from({ length: 6 }, (_, i) => ({ month: addMonths(start, i), pitches: 20, deals: 0, revenue: 0 })),
  };
}

export function dashboard(state, { today, targets }) {
  const deals = state.deals.filter(live);
  const payments = state.payments.filter(live);
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const pitched = deals.filter((d) => d.pitched_on);
  const replied = deals.filter((d) => d.replied_on);
  const won = deals.filter((d) => WON_STAGES.includes(d.stage));
  const wonWithFinal = won.filter((d) => d.final != null);
  const followUps = deals.map((d) => ({ deal: d, fu: followUp(d, today) })).filter((x) => x.fu);
  const invoicedUnpaid = payments.filter((p) => p.invoiced_on && !p.paid_on);
  const invoicedDeals = new Set(payments.filter((p) => p.invoiced_on || p.paid_on).map((p) => p.deal_id));
  const toInvoice = deals.filter((d) => d.stage === 'Delivered' && !invoicedDeals.has(d.id));

  // Close rate over the trailing 90 days (by reply date), used by the rate-raise rule
  const since90 = addDays(today, -90);
  const replied90 = replied.filter((d) => d.replied_on >= since90);
  const won90 = replied90.filter((d) => WON_STAGES.includes(d.stage));

  const months = (targets.months || []).map((t) => {
    const inMonth = (iso) => monthOf(iso) === t.month;
    const booked = won.filter((d) => inMonth(d.publish_date));
    return {
      month: t.month,
      pitches: pitched.filter((d) => inMonth(d.pitched_on)).length,
      replies: replied.filter((d) => inMonth(d.replied_on)).length,
      deals: booked.length,
      booked: round2(sum(booked, (d) => d.final ?? d.quoted)),
      collected: round2(sum(payments.filter((p) => inMonth(p.paid_on)), (p) => p.amount)),
      target: { pitches: t.pitches, deals: t.deals, revenue: t.revenue },
    };
  });

  return {
    today,
    week: { start: ws, end: we },
    pitchesThisWeek: pitched.filter((d) => d.pitched_on >= ws && d.pitched_on <= we).length,
    weeklyPitchTarget: targets.weeklyPitches ?? 5,
    followUpsDue: followUps.filter((x) => x.fu.isDue).map((x) => ({ dealId: x.deal.id, ...x.fu })),
    overdue: deals.filter((d) => isOverdue(d, today)).map((d) => ({ dealId: d.id, action: d.next_action, date: d.next_action_date })),
    openDeals: deals.filter((d) => OPEN_STAGES.includes(d.stage)).length,
    replyRate: pitched.length ? replied.filter((d) => d.pitched_on).length / pitched.length : null,
    closeRate: replied.length ? won.filter((d) => d.replied_on).length / replied.length : null,
    closeRate90: replied90.length ? won90.length / replied90.length : null,
    averageDeal: wonWithFinal.length ? round2(sum(wonWithFinal, (d) => d.final) / wonWithFinal.length) : null,
    invoicedUnpaid: { total: round2(sum(invoicedUnpaid, (p) => p.amount)), count: invoicedUnpaid.length, paymentIds: invoicedUnpaid.map((p) => p.id) },
    toInvoice: toInvoice.map((d) => d.id),
    belowFloor: deals.filter((d) => d.stage !== 'Lost' && d.stage !== 'No reply')
      .map((d) => ({ d, p: priceCheck(d, state.rateCard) }))
      .filter((x) => x.p && x.p.below)
      .map((x) => ({ dealId: x.d.id, ...x.p })),
    conflicts: conflicts(state),
    months,
  };
}
