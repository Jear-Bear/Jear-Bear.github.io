// insights.js — Phase 4 numbers: weekly quests and streaks, milestone stamps,
// rate-raise rules, channel milestone projections and the go-full-time
// tracker. Shared by the app and the Worker (so Claude's connector reads the
// same numbers). Pure functions over plain data; every number is computed
// here, Claude only writes commentary.

import { WON_STAGES } from './schema.js';
import { addDays, daysBetween, weekStart, monthOf, addMonths, videoStatus } from './rules.js';

const live = (r) => r && !r.archived;
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const round2 = (n) => Math.round(n * 100) / 100;

// Least-squares line through (x, y) points: y = a + b·x
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = sum(points, (p) => p[0]) / n;
  const my = sum(points, (p) => p[1]) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  if (!den) return null;
  const b = num / den;
  return { a: my - b * mx, b };
}

// --- Weekly pitches, streaks and the week's quest ---------------------------------------------
export function pitchWeeks(state, today, weeks = 52) {
  const ws = weekStart(today);
  const counts = new Map();
  state.deals.filter(live).forEach((d) => {
    if (!d.pitched_on) return;
    const w = weekStart(d.pitched_on);
    counts.set(w, (counts.get(w) || 0) + 1);
  });
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(ws, -7 * (weeks - 1 - i));
    return { week, pitches: counts.get(week) || 0 };
  });
}

// Consecutive weeks with the pitch target met, ending last week (plus this
// week once it's met). A week in progress never breaks the streak.
export function pitchStreak(state, today, target = 5) {
  const all = pitchWeeks(state, today, 104);
  const current = all[all.length - 1];
  let weeks = 0;
  for (let i = all.length - 2; i >= 0 && target > 0 && all[i].pitches >= target; i--) weeks++;
  const thisWeekMet = target > 0 && current.pitches >= target;
  let best = 0;
  let run = 0;
  all.forEach((w) => { run = target > 0 && w.pitches >= target ? run + 1 : 0; best = Math.max(best, run); });
  return { weeks: weeks + (thisWeekMet ? 1 : 0), thisWeekMet, thisWeek: current.pitches, target, best };
}

// --- Creator income by month ---------------------------------------------------------------
export const INCOME_SOURCES = ['deals', 'adsense', 'affiliates', 'memberships', 'other'];
export const INCOME_SOURCES_ENTERED = ['adsense', 'affiliates', 'memberships', 'other'];
export const INCOME_LABELS = { deals: 'Paid deals', adsense: 'AdSense', affiliates: 'Affiliates', memberships: 'Memberships', other: 'Other' };

export function incomeByMonth(state, income, today, { minMonths = 12 } = {}) {
  const current = monthOf(today);
  const byMonth = new Map();
  const add = (month, source, amount) => {
    if (!month || month > current) return;
    const row = byMonth.get(month) || Object.fromEntries(INCOME_SOURCES.map((s) => [s, 0]));
    row[source] += Number(amount) || 0;
    byMonth.set(month, row);
  };
  state.payments.filter((p) => live(p) && p.paid_on).forEach((p) => add(monthOf(p.paid_on), 'deals', p.amount));
  (income || []).forEach((r) => add(r.month, r.source, r.amount));
  const first = [...byMonth.keys()].sort()[0];
  let start = addMonths(current, -(minMonths - 1));
  if (first && first < start) start = first;
  const out = [];
  for (let m = start; m <= current; m = addMonths(m, 1)) {
    const row = byMonth.get(m) || Object.fromEntries(INCOME_SOURCES.map((s) => [s, 0]));
    const clean = Object.fromEntries(INCOME_SOURCES.map((s) => [s, round2(row[s])]));
    out.push({ month: m, ...clean, total: round2(sum(INCOME_SOURCES, (s) => row[s])), partial: m === current });
  }
  return out;
}

// --- Go-full-time tracker -------------------------------------------------------------------
export const FULL_TIME_MONTHS = 6;         // plan: six straight months at target
export const SAVINGS_MONTHS = [6, 12];     // plan: six to twelve months of expenses

export function monthlyTarget(finance) {
  if (!finance || finance.takeHome == null) return null;
  const tax = (finance.taxPct ?? 28) / 100;
  if (tax >= 1) return null;
  return round2((finance.takeHome + (finance.healthMonthly || 0)) / (1 - tax));
}

export function fullTime(state, { income = [], finance = null, scenarios = [], today }) {
  const months = incomeByMonth(state, income, today);
  const target = monthlyTarget(finance);
  const complete = months.filter((m) => !m.partial);
  // Trailing six-month average for each month (once there are six months before it)
  months.forEach((m, i) => {
    const win = months.slice(Math.max(0, i - FULL_TIME_MONTHS + 1), i + 1).filter((x) => !x.partial);
    m.trailing = win.length === FULL_TIME_MONTHS ? round2(sum(win, (x) => x.total) / FULL_TIME_MONTHS) : null;
  });
  const last6 = complete.slice(-FULL_TIME_MONTHS);
  const trailing = last6.length ? round2(sum(last6, (m) => m.total) / last6.length) : null;
  let atTarget = 0;
  if (target != null) for (let i = complete.length - 1; i >= 0 && complete[i].total >= target; i--) atTarget++;

  // Projection: a straight line through the last six complete months, extended
  // until the trailing six-month average reaches the target
  let projection = null;
  const withData = last6.filter((m) => m.total > 0);
  if (target != null && last6.length >= 3 && withData.length >= 2) {
    const fit = fitLine(last6.map((m, i) => [i, m.total]));
    const perMonth = fit ? round2(fit.b) : 0;
    projection = { perMonth, basis: last6.length, month: null, reached: trailing != null && trailing >= target && last6.length === FULL_TIME_MONTHS };
    if (!projection.reached && fit && fit.b > 0) {
      const hist = complete.slice(-FULL_TIME_MONTHS).map((m) => m.total);
      for (let k = 1; k <= 120; k++) {
        hist.push(Math.max(0, fit.a + fit.b * (last6.length - 1 + k)));
        const win = hist.slice(-FULL_TIME_MONTHS);
        if (win.length === FULL_TIME_MONTHS && sum(win, (x) => x) / FULL_TIME_MONTHS >= target) {
          projection.month = addMonths(complete[complete.length - 1].month, k);
          break;
        }
      }
    }
  }

  const savings = finance && finance.savings != null && finance.expenses ? {
    amount: finance.savings, expenses: finance.expenses, months: round2(finance.savings / finance.expenses),
    goal: SAVINGS_MONTHS, goalAmounts: SAVINGS_MONTHS.map((n) => round2(n * finance.expenses)),
  } : null;

  // When each plan scenario's line reaches the target (by its own points)
  const scen = (scenarios || []).map((sc) => {
    const hit = target != null ? sc.points.find((p) => p.total >= target) : null;
    return { ...sc, reachesTarget: hit ? hit.month : null };
  });

  const checks = [
    { id: 'income', label: `Six straight months at or above the target (${atTarget} so far)`, done: target != null && atTarget >= FULL_TIME_MONTHS },
    { id: 'savings', label: `Six to twelve months of expenses saved${savings ? ` (${savings.months.toFixed(1)} months now)` : ''}`, done: Boolean(savings && savings.months >= SAVINGS_MONTHS[0]) },
    { id: 'health', label: 'A health-insurance plan priced and built into the monthly number', done: Boolean(finance && finance.healthPriced && finance.healthMonthly != null) },
  ];
  return { months, target, trailing, atTarget, goalMonths: FULL_TIME_MONTHS, projection, savings, scenarios: scen, checks, hasFinance: Boolean(finance && finance.takeHome != null) };
}

// --- Channel milestones -------------------------------------------------------------------
const SUB_STEPS = [1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000];
const VIEW_STEPS = [10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000, 1500000, 2000000];
const next = (steps, v, n = 2) => steps.filter((s) => s > v).slice(0, n);

export function milestones({ daily = [], channel = null, today }) {
  const since = addDays(today, -97);
  const rows = daily.filter((d) => d.day >= since && d.day < today);
  const views = rows.filter((d) => d.views != null);
  const out = { subscribers: null, monthlyViews: null };

  // Monthly views: a straight line through the last 90 days of daily views
  if (views.length >= 28) {
    const last = views.slice(-90);
    const t0 = last[0].day;
    const fit = fitLine(last.map((d) => [daysBetween(t0, d.day), d.views]));
    const lastDay = last[last.length - 1].day;
    const last30 = sum(last.slice(-30), (d) => d.views);
    const tEnd = daysBetween(t0, lastDay);
    const trendNow = fit ? Math.max(0, Math.round(30 * (fit.a + fit.b * tEnd))) : null;
    const perMonthChange = fit ? Math.round(30 * 30 * fit.b) : null;   // change in monthly views per month
    out.monthlyViews = {
      last30, trendNow, perMonthChange, from: t0, to: lastDay, days: last.length,
      method: `Straight line through ${last.length} days of daily views (${t0} to ${lastDay}); monthly views = 30 × the line's daily value.`,
      next: next(VIEW_STEPS, Math.max(last30, trendNow || 0)).map((m) => {
        if (!fit || fit.b <= 0) return { milestone: m, date: null };
        const t = (m / 30 - fit.a) / fit.b;
        return { milestone: m, date: t > tEnd ? addDays(t0, Math.ceil(t)) : lastDay };
      }),
    };
  }

  // Subscribers: the average net gain per day, projected in a straight line
  const current = channel && channel.subscribers != null ? channel.subscribers : null;
  if (current != null) {
    const subRows = rows.filter((d) => d.subs_gained != null && d.subs_lost != null).slice(-90);
    let perDay = null;
    let method = null;
    if (subRows.length >= 28) {
      perDay = sum(subRows, (d) => d.subs_gained - d.subs_lost) / subRows.length;
      method = `Average net subscribers a day over ${subRows.length} days (${subRows[0].day} to ${subRows[subRows.length - 1].day}), in a straight line.`;
    } else if (channel.gained28 != null) {
      perDay = channel.gained28 / 28;
      method = 'Subscribers gained in the last 28 days ÷ 28 (from the public stats; losses aren’t counted until the stats Action sends daily history).';
    }
    out.subscribers = {
      current, asOf: channel.asOf, exact: channel.subscribersExact === true,
      perDay: perDay != null ? Math.round(perDay * 10) / 10 : null, perMonth: perDay != null ? Math.round(perDay * 30) : null, method,
      next: next(SUB_STEPS, current).map((m) => ({
        milestone: m,
        date: perDay && perDay > 0 ? addDays(channel.asOf || today, Math.ceil((m - current) / perDay)) : null,
      })),
    };
  }
  return out;
}

// --- Rate-raise rules (from the plan) -----------------------------------------------------------
export const RATE_RULE_IDS = ['beat_estimates', 'booked_ahead', 'close_rate'];
export const RATE_RULES = {
  beat_estimates: { label: 'Three sponsored videos in a row beat their 30-day view estimate', raise: 0.15, raiseMax: 0.20 },
  booked_ahead: { label: 'Booked six or more weeks ahead', raise: 0.15 },
  close_rate: { label: 'More than half of price conversations close (last 90 days)', raise: 0.15 },
};
const MIN_REPLIES = 4;          // don't call a close rate from one or two conversations
const BOOKED_DAYS = 42;
const roundUp25 = (n) => Math.ceil(n / 25) * 25;

export function suggestRates(rateCard, raise) {
  return rateCard.filter((r) => live(r) && r.standard != null).map((r) => ({
    id: r.id, package: r.package, standard: r.standard, floor: r.floor,
    newStandard: roundUp25(r.standard * (1 + raise)),
    newFloor: r.floor != null ? roundUp25(r.floor * (1 + raise)) : null,
  }));
}

function snoozed(decision, today) {
  if (!decision || !decision.on) return null;
  const days = decision.status === 'accepted' ? 60 : 30;
  const until = addDays(decision.on, days);
  return today < until ? { status: decision.status, on: decision.on, until } : null;
}

export function rateRules(state, { uploads = [], today, decisions = {} }) {
  const deals = state.deals.filter(live);
  const videos = state.videos.filter(live);
  const byYt = new Map(uploads.map((u) => [u.youtube_id, u]));
  const out = [];

  // 1. The last three sponsored, published videos each beat their 30-day estimate
  const sponsored = videos
    .filter((v) => v.youtube_id && deals.some((d) => d.video_id === v.id && WON_STAGES.includes(d.stage)))
    .map((v) => {
      const u = byYt.get(v.youtube_id);
      const published = (u && u.published_at ? u.published_at.slice(0, 10) : v.publish_date) || null;
      const age = published ? daysBetween(published, today) : null;
      const views30 = u && u.views_30d != null ? u.views_30d : null;
      return { v, published, age, views30, lifetime: u ? u.views : null };
    })
    .filter((x) => x.published && x.age >= 30)
    .sort((a, b) => b.published.localeCompare(a.published));
  const last3 = sponsored.slice(0, 3);
  const beat = (x) => x.v.view_estimate != null && (x.views30 ?? x.lifetime) != null && (x.views30 ?? x.lifetime) > x.v.view_estimate;
  const r1 = {
    id: 'beat_estimates', ...RATE_RULES.beat_estimates,
    triggered: last3.length === 3 && last3.every((x) => x.views30 != null && beat(x)),
    evidence: last3.map((x) => {
      const got = x.views30 ?? x.lifetime;
      const basis = x.views30 != null ? 'at 30 days' : 'lifetime (no 30-day count was captured)';
      return x.v.view_estimate == null
        ? `${x.v.title}: no 30-day estimate set`
        : `${x.v.title}: ${got == null ? 'no view count' : `${got.toLocaleString('en-US')} views ${basis}`} vs ${x.v.view_estimate.toLocaleString('en-US')} estimated`;
    }),
    progress: `${last3.filter((x) => x.views30 != null && beat(x)).length} of the last ${last3.length || 3} sponsored videos beat their estimate`,
  };
  if (last3.length < 3) r1.evidence.push(`${last3.length} sponsored video${last3.length === 1 ? '' : 's'} with a YouTube link and 30+ days of views so far (needs 3).`);
  out.push(r1);

  // 2. Booked six or more weeks ahead: the next open sponsor slot is 6+ weeks out
  const upcoming = videos.filter((v) => v.publish_date && v.publish_date >= today).sort((a, b) => a.publish_date.localeCompare(b.publish_date));
  const statuses = upcoming.map((v) => ({ v, status: videoStatus(v, deals) }));
  const booked = statuses.filter((x) => x.status === 'booked');
  const nextOpen = statuses.find((x) => x.status === 'open' || x.status === 'pitched');
  const lastPlanned = upcoming.length ? upcoming[upcoming.length - 1].publish_date : null;
  const horizon = nextOpen ? nextOpen.v.publish_date : lastPlanned;
  const aheadDays = horizon ? daysBetween(today, horizon) : 0;
  out.push({
    id: 'booked_ahead', ...RATE_RULES.booked_ahead,
    triggered: booked.length > 0 && aheadDays >= BOOKED_DAYS,
    evidence: [
      `${booked.length} upcoming video${booked.length === 1 ? '' : 's'} booked`,
      nextOpen ? `Next open slot: ${nextOpen.v.title} on ${nextOpen.v.publish_date} (${Math.floor(aheadDays / 7)} weeks out)`
        : lastPlanned ? `Every planned slot through ${lastPlanned} is booked or sponsor-free` : 'No upcoming videos planned',
    ],
    progress: `${Math.max(0, Math.floor(aheadDays / 7))} of 6 weeks booked ahead`,
  });

  // 3. Close rate above 50% over 90 days (by reply date), with enough conversations
  const since = addDays(today, -90);
  const replied = deals.filter((d) => d.replied_on && d.replied_on >= since);
  const won = replied.filter((d) => WON_STAGES.includes(d.stage));
  const rate = replied.length ? won.length / replied.length : null;
  out.push({
    id: 'close_rate', ...RATE_RULES.close_rate,
    triggered: replied.length >= MIN_REPLIES && rate > 0.5,
    evidence: [`${won.length} won of ${replied.length} deals that replied since ${since}${replied.length < MIN_REPLIES ? ` (needs at least ${MIN_REPLIES} to count)` : ''}`],
    progress: rate == null ? 'No replies in the last 90 days' : `${Math.round(rate * 100)}% close rate over 90 days`,
  });

  return out.map((r) => {
    const snooze = snoozed(decisions[r.id], today);
    return { ...r, snoozed: snooze, active: r.triggered && !snooze, suggestion: r.triggered ? suggestRates(state.rateCard, r.raise) : [] };
  });
}

// --- Milestone stamps (quiet, dated, earned once) ---------------------------------------------
export function stamps(state, { today, targets, income = [], weeklyTarget = 5 }) {
  const deals = state.deals.filter(live);
  const out = [];
  const weeks = pitchWeeks(state, today, 104);
  const firstWeek = weeks.find((w) => weeklyTarget > 0 && w.pitches >= weeklyTarget && w.week < weekStart(today));
  out.push({ id: 'pitch_week', label: `First ${weeklyTarget}-pitch week`, on: firstWeek ? addDays(firstWeek.week, 6) : null });

  let run = 0;
  let streakOn = null;
  for (const w of weeks) {
    run = weeklyTarget > 0 && w.pitches >= weeklyTarget && w.week < weekStart(today) ? run + 1 : 0;
    if (run >= 4) { streakOn = addDays(w.week, 6); break; }
  }
  out.push({ id: 'streak4', label: 'Four 5-pitch weeks in a row', on: streakOn });

  const big = deals.filter((d) => WON_STAGES.includes(d.stage) && (d.final ?? d.quoted ?? 0) >= 500)
    .map((d) => d.replied_on || d.publish_date || d.pitched_on || today).sort()[0];
  out.push({ id: 'deal500', label: 'First $500 deal', on: big || null });

  const onTarget = (targets && targets.months || []).filter((t) => t.revenue > 0 && t.month < monthOf(today)).find((t) => {
    const booked = deals.filter((d) => WON_STAGES.includes(d.stage) && monthOf(d.publish_date) === t.month);
    return sum(booked, (d) => d.final ?? d.quoted) >= t.revenue;
  });
  out.push({ id: 'month_target', label: 'First month on target', on: onTarget ? `${onTarget.month}-28` : null, month: onTarget ? onTarget.month : null });

  const months = incomeByMonth(state, income, today).filter((m) => !m.partial);
  const k = months.find((m) => m.total >= 1000);
  out.push({ id: 'k_month', label: 'First $1,000 month', on: k ? `${k.month}-28` : null, month: k ? k.month : null });
  return out;
}

// --- Everything at once (for the connector and the Insights screen) ---------------------------------
export function allInsights(state, data, today) {
  const target = (state.settings.targets && state.settings.targets.weeklyPitches) ?? 5;
  return {
    today,
    streak: pitchStreak(state, today, target),
    stamps: stamps(state, { today, targets: state.settings.targets, income: data.income, weeklyTarget: target }),
    rateRules: rateRules(state, { uploads: data.uploads, today, decisions: data.rateRules || {} }),
    milestones: milestones({ daily: data.daily, channel: data.channel, today }),
    fullTime: fullTime(state, { income: data.income, finance: data.finance, scenarios: data.scenarios, today }),
  };
}
