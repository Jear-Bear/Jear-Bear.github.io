// mcp.js — the remote MCP server Claude connects to (as a custom connector).
// Narrow tools only: reads, plus non-destructive writes that land in the
// review queue. No tool deletes anything or directly changes a stage, an
// amount or a date. Everything Claude sends is validated in claude.js.

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { loadState, settingsFor } from './data.js';
import { loadCalendar, createItem } from './calendar.js';
import { listUploads } from './youtube.js';
import { loadInsights } from './stats.js';
import { allInsights } from '../../../scripts/manage/insights.js';
import { listDrafts, closeDraft } from './drafts.js';
import { pitchValues, renderTemplate, templatesFrom, avoidFrom, prospectingRules, pitchPerformance, MEDIA_KIT_URL } from '../../../scripts/manage/pitching.js';
import {
  logEmail, createProposal, suggestVideoIdea, saveInsight, getCursor, setCursor, PROPOSAL_KINDS,
} from './claude.js';
import { dashboard, todayIn, daysBetween } from '../../../scripts/manage/rules.js';
import { expand, ruleItems } from '../../../scripts/manage/calendar.js';
import { STAGES, CAL_TYPES, CAL_KINDS } from '../../../scripts/manage/schema.js';

const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message, details: err.details }) }] });
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

const live = (list) => list.filter((r) => !r.archived);

export function createServer(env) {
  const db = env.DB;
  const server = new McpServer({ name: 'jareddesu-sponsor-desk', version: '1.0.0' }, {
    instructions: 'Private sponsor CRM for まだまだJared. Read tools return JSON. Write tools never apply changes directly: '
      + 'proposals, suggested calendar items and video ideas wait for Jared to review them in the app. Never claim a change was made. '
      + 'Log emails as metadata only (snippet under 300 characters).',
  });
  const tool = (name, description, inputSchema, annotations, fn) => server.registerTool(name, { description, inputSchema, annotations },
    async (args) => { try { return text(await fn(args || {})); } catch (err) { return fail(err); } });

  // --- Reads ------------------------------------------------------------------------------
  tool('get_tracked_companies', 'Tracked sponsor companies with their email domains and contacts. Use the domains to find related Gmail messages.', {}, READ, async () => {
    const s = await loadState(db);
    return live(s.companies).map((c) => ({
      id: c.id, name: c.name, category: c.category, fit: c.fit, domains: c.domains,
      contacts: live(s.contacts).filter((x) => x.company_id === c.id).map((x) => ({ id: x.id, name: x.name, email: x.email, role: x.role })),
    }));
  });

  tool('list_deals', 'Sponsor deals, optionally filtered. Includes stage, dates, amounts and next action.', {
    stage: z.enum(STAGES).optional(), company_id: uuid.optional(), open_only: z.boolean().optional(),
  }, READ, async ({ stage, company_id: companyId, open_only: openOnly }) => {
    const s = await loadState(db);
    const names = new Map(s.companies.map((c) => [c.id, c.name]));
    return live(s.deals)
      .filter((d) => (!stage || d.stage === stage) && (!companyId || d.company_id === companyId) && (!openOnly || !['Paid', 'Lost', 'No reply'].includes(d.stage)))
      .map((d) => ({
        id: d.id, company_id: d.company_id, company: names.get(d.company_id), stage: d.stage, source: d.source, package: d.package,
        slot: d.slot_note, video_id: d.video_id, pitched_on: d.pitched_on, replied_on: d.replied_on, quoted: d.quoted, final: d.final,
        publish_date: d.publish_date, next_action: d.next_action, next_action_date: d.next_action_date,
      }));
  });

  tool('get_dashboard', 'Computed dashboard metrics: pitches this week vs target, follow-ups due, overdue actions, reply and close rates, average deal, invoiced but unpaid, conflicts, and monthly results vs the plan targets.', {}, READ, async () => {
    const s = await loadState(db);
    const settings = await settingsFor(db);
    return dashboard(s, { today: todayIn(settings.tz), targets: settings.targets });
  });

  tool('get_calendar', 'Calendar items between two dates (max 92 days): plan items, recurring blocks, rule-generated follow-ups and deadlines, Claude suggestions and manual items.', {
    from: date, to: date,
  }, READ, async ({ from, to }) => {
    if (daysBetween(from, to) > 92 || to < from) throw new Error('Use a range of 0–92 days');
    const [cal, s] = await Promise.all([loadCalendar(db, from, to), loadState(db)]);
    const today = todayIn(s.settings.tz);
    return [...expand(cal, from, to), ...ruleItems(s, from, to, today)]
      .filter((it) => !it.hidden)
      .map((it) => ({ id: it.id, source: it.source, type: it.type, kind: it.kind, title: it.title, start: it.start, end: it.end, status: it.status, suggested: it.suggested === 1, deal_id: it.deal_id, video_id: it.video_id }));
  });

  tool('list_videos', 'Planned video slots (with sponsor status and linked deals) and the channel’s recent uploads with view counts, for sponsor matching and video ideas.', {}, READ, async () => {
    const [s, up] = await Promise.all([loadState(db), listUploads(db)]);
    const views = new Map(up.uploads.map((u) => [u.youtube_id, u]));
    const names = new Map(s.companies.map((c) => [c.id, c.name]));
    return {
      planned: live(s.videos).map((v) => ({
        id: v.id, title: v.title, publish_date: v.publish_date, format: v.format, sponsor_status: v.sponsor_status,
        youtube_id: v.youtube_id, views: v.youtube_id && views.get(v.youtube_id) ? views.get(v.youtube_id).views : null,
        sponsors: live(s.deals).filter((d) => d.video_id === v.id).map((d) => ({ company: names.get(d.company_id), stage: d.stage })),
      })),
      uploads: up.uploads.slice(0, 60).map((u) => ({ youtube_id: u.youtube_id, title: u.title, published: u.published_at, views: u.views, likes: u.likes, comments: u.comments, seconds: u.duration_s })),
    };
  });

  tool('list_payments', 'Recorded payments per deal (invoiced and paid dates, amounts, fees), to match incoming payment emails and avoid duplicates.', {}, READ, async () => {
    const s = await loadState(db);
    const deals = new Map(s.deals.map((d) => [d.id, d]));
    const names = new Map(s.companies.map((c) => [c.id, c.name]));
    return live(s.payments).map((p) => {
      const d = deals.get(p.deal_id);
      return { id: p.id, deal_id: p.deal_id, company: d ? names.get(d.company_id) : null, deal_stage: d ? d.stage : null, amount: p.amount, invoiced_on: p.invoiced_on, paid_on: p.paid_on, method: p.method, fees: p.fees, net: p.net };
    });
  });

  tool('get_insights', 'Computed Phase 4 numbers: the 5-pitch-week streak, milestone stamps, the three rate-raise rules (with evidence and whether each triggered), subscriber and monthly-view milestone projections (with the method), and full-time tracker progress (monthly creator income vs the target, trailing 6-month average, months at target, projected crossing). Use these numbers as given; don’t recompute.', {}, READ, async () => {
    const [s, data] = await Promise.all([loadState(db), loadInsights(db)]);
    const today = todayIn(s.settings.tz);
    const x = allInsights(s, data, today);
    const ft = x.fullTime;
    return {
      today, streak: x.streak,
      stamps: x.stamps.map((st) => ({ label: st.label, earned: st.month || st.on || null })),
      rate_rules: x.rateRules.map((r) => ({ rule: r.label, triggered: r.triggered, snoozed: Boolean(r.snoozed), progress: r.progress, evidence: r.evidence, raise_pct: Math.round(r.raise * 100) })),
      milestones: x.milestones,
      full_time: {
        target_per_month: ft.target, trailing_6_month_average: ft.trailing, months_at_target: ft.atTarget, goal_months: ft.goalMonths,
        projection: ft.projection, savings_months_of_expenses: ft.savings ? ft.savings.months : null,
        checks: ft.checks.map((c) => ({ check: c.label, done: c.done })),
        last_months: ft.months.slice(-6).map((m) => ({ month: m.month, total: m.total, deals: m.deals, partial: m.partial })),
        scenarios: ft.scenarios.map((sc) => ({ name: sc.name, reaches_target: sc.reachesTarget, last_point: sc.points[sc.points.length - 1] })),
      },
      past_weekly_insights: data.insights.filter((i) => i.kind === 'weekly').slice(0, 4).map((i) => ({ week_of: i.week_of, text: i.text })),
    };
  });

  tool('get_prospecting_context', 'What to know before researching new sponsors: the avoid list, categories in cooldown (one sponsor per category every 60 days) with the date they reopen, brands to skip for now (pitched recently without a reply, or already in an open deal), active exclusivity, tracked companies, open video slots in the next 90 days, the rate card and pitch performance so far.', {}, READ, async () => {
    const s = await loadState(db);
    const today = todayIn(s.settings.tz);
    const rules = prospectingRules(s, today);
    const horizon = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 90)).toISOString().slice(0, 10);
    const slots = live(s.videos).filter((v) => v.publish_date && v.publish_date >= today && v.publish_date <= horizon)
      .map((v) => ({ title: v.title, publish_date: v.publish_date, format: v.format, sponsor_status: v.sponsor_status, taken: live(s.deals).some((d) => d.video_id === v.id && ['Negotiating', 'Won', 'Delivered', 'Paid'].includes(d.stage)) }))
      .filter((v) => !v.taken && v.sponsor_status !== 'sponsor_free' && (v.format || 'guide') === 'guide');
    return {
      today, avoid: avoidFrom(s.settings), categories: s.settings.categories, category_cooldowns: rules.cooldowns,
      skip_for_now: { pitched_without_reply: rules.recentNoReply, in_open_deals: rules.active }, exclusivity: rules.exclusivity,
      tracked_companies: live(s.companies).map((c) => ({ name: c.name, category: c.category, domains: c.domains })),
      open_slots: slots, rate_card: live(s.rateCard).map((r) => ({ package: r.package, standard: r.standard })),
      pitch_performance: { by_category: pitchPerformance(s, { by: 'category' }), by_style: pitchPerformance(s, { by: 'pitch_style' }) },
      media_kit: MEDIA_KIT_URL,
    };
  });

  tool('get_draft_requests', 'Emails Jared asked you to draft (pitch, follow_up or recap), with everything needed: the deal, company, contact, video slot, price, current channel numbers, clicks on the tracked link, and his template for pitches. Draft each in Gmail with create_draft (never send), then call complete_draft_request.', {}, READ, async () => {
    const [s, open, data] = await Promise.all([loadState(db), listDrafts(db, { status: 'open' }), loadInsights(db)]);
    const today = todayIn(s.settings.tz);
    const templates = templatesFrom(s.settings);
    return open.map((r) => {
      const d = s.deals.find((x) => x.id === r.deal_id);
      if (!d) return { id: r.id, kind: r.kind, error: 'Deal not found' };
      const vals = pitchValues(s, d, { channel: data.channel, daily: data.daily, audience: data.audience, today });
      const tpl = templates.find((t) => t.id === d.pitch_style || t.name === d.pitch_style) || templates[0];
      const links = live(s.links || []).filter((l) => l.deal_id === d.id).map((l) => ({
        url: `https://www.jareddesu.com/go/${l.slug}`, clicks: (s.linkClicks || []).filter((c) => c.slug === l.slug).reduce((n, c) => n + c.clicks, 0),
      }));
      const v = d.video_id ? s.videos.find((x) => x.id === d.video_id) : null;
      const up = v && v.youtube_id ? data.uploads.find((u) => u.youtube_id === v.youtube_id) : null;
      return {
        id: r.id, kind: r.kind, requested: r.created_at, jared_notes: r.notes,
        deal: { id: d.id, stage: d.stage, package: d.package, quoted: d.quoted, final: d.final, pitched_on: d.pitched_on, next_action: d.next_action },
        to: vals.to || null, values: vals,
        template: r.kind === 'pitch' ? { name: tpl.name, subject: renderTemplate(tpl.subject, vals), body: renderTemplate(tpl.body, vals) } : null,
        video: v ? { title: v.title, publish_date: v.publish_date, view_estimate_30d: v.view_estimate, views_at_30_days: up ? up.views_30d : null, views_now: up ? up.views : null, url: v.youtube_id ? `https://youtu.be/${v.youtube_id}` : null } : null,
        tracked_links: links,
      };
    });
  });

  tool('complete_draft_request', 'Mark a draft request done after saving the Gmail draft (or cancelled if it can’t be drafted), with a one-line note such as the draft\'s subject.', {
    id: uuid, status: z.enum(['done', 'cancelled']), note: z.string().max(500),
  }, WRITE, ({ id, status, note }) => closeDraft(db, id, { status, result: note }));

  tool('get_rate_card', 'Sponsorship packages with standard prices and private floors.', {}, READ, async () => {
    const s = await loadState(db);
    return live(s.rateCard).map((r) => ({ package: r.package, standard: r.standard, floor: r.floor, included: r.included }));
  });

  tool('get_sync_state', 'The Gmail sync cursor (where the last run stopped), the tracked email domains, and what is already waiting for review (to avoid duplicates).', {}, READ, async () => {
    const [cur, s, pending] = await Promise.all([
      getCursor(db), loadState(db),
      db.prepare("SELECT kind, deal_id, company_id, json_extract(evidence, '$.message_id') AS message_id FROM proposals WHERE status = 'pending'").all(),
    ]);
    return {
      cursor: cur.cursor, cursor_updated_at: cur.updated_at, today: todayIn(s.settings.tz),
      tracked_domains: live(s.companies).flatMap((c) => c.domains.map((d) => ({ domain: d, company_id: c.id, company: c.name }))),
      pending_proposals: pending.results,
    };
  });

  // --- Writes (non-destructive) --------------------------------------------------------------------
  tool('log_email', 'Log one email on a tracked company’s timeline: metadata only (no body). Idempotent by Gmail message ID. Pass company_id (from get_tracked_companies) when you know the company; otherwise it matches the other party’s domain. Add a short note if the email contains anything notable (a budget, a timeline, a new contact, a risk).', {
    message_id: z.string().min(1).max(200), thread_id: z.string().max(200).optional(), date: z.string().max(40),
    direction: z.enum(['in', 'out']), from: z.string().max(300), to: z.string().max(500), cc: z.string().max(500).optional(),
    subject: z.string().max(300), snippet: z.string().max(299).optional(), gmail_link: z.string().max(500).optional(),
    company_id: uuid.optional(), deal_id: uuid.optional(), note: z.string().max(1000).optional(),
  }, WRITE, (a) => logEmail(db, a));

  tool('create_proposal', `Propose a change for Jared to review (nothing changes until he passes it). kind: ${PROPOSAL_KINDS.join(', ')}. values by kind: stage_change {stage}; amounts {quoted?, final?}; dates {pitched_on?, replied_on?, publish_date?}; next_action {next_action, next_action_date?}; new_contact {name?, email?, role?} with company_id; add_domain {domain} with company_id (when a tracked company emails from an untracked domain); new_deal {source?, stage?, package?, slot_note?, pitched_on?, replied_on?, quoted?, next_action?, next_action_date?, notes?, paid_amount?, paid_on?, paid_method?} with company_id (a tracked company that has no deal yet); new_company_deal {company:{name, domains[], category?, website?}, contact?:{name, email, role}, deal:{package?, replied_on?, quoted?, notes?, paid_amount?, paid_on?, paid_method?}}. For a deal that was already paid, include paid_amount and paid_on (and paid_method): passing it records the payment too; income {month (YYYY-MM), source (adsense, affiliates, memberships, other), amount, program? (e.g. "Migaku"), notes?} for creator income that isn't a sponsor deal, with deal_id only when it replaces a deal that was really this income (passing archives that deal); payment {amount, paid_on, method?, fees?, net?, invoiced_on?, notes?} with deal_id (money received for a deal; amount is the gross the sponsor paid, in USD). Always include evidence (email date, subject, a quote under 300 characters), a one-line reason and a confidence.`, {
    kind: z.enum(PROPOSAL_KINDS), deal_id: uuid.optional(), company_id: uuid.optional(),
    values: z.record(z.string(), z.any()),
    evidence: z.object({ email_date: z.string().max(40).optional(), subject: z.string().max(300).optional(), quote: z.string().max(300).optional(), gmail_link: z.string().max(500).optional(), message_id: z.string().max(200).optional() }),
    reason: z.string().max(300), confidence: z.enum(['low', 'medium', 'high']),
  }, WRITE, (a) => createProposal(db, a));

  tool('suggest_calendar_item', 'Suggest a task or event. It shows on the calendar as "Claude (suggested)" until Jared accepts or dismisses it. Dates are America/Chicago wall time: YYYY-MM-DD or YYYY-MM-DDTHH:MM.', {
    type: z.enum(CAL_TYPES), kind: z.enum(CAL_KINDS).optional(), title: z.string().min(1).max(200),
    start: z.string().max(16), end: z.string().max(16).optional(), notes: z.string().max(2000).optional(),
    reason: z.string().max(300), deal_id: uuid.optional(), company_id: uuid.optional(), video_id: uuid.optional(),
  }, WRITE, async ({ reason, ...item }) => {
    const dup = await db.prepare('SELECT id FROM cal_items WHERE suggested = 1 AND title = ? AND start = ?').bind(item.title, item.start).first();
    if (dup) return { suggested: false, duplicate: true, id: dup.id };
    const it = await createItem(db, { ...item, counts_hours: item.type === 'event' && Boolean(item.end) }, { source: 'claude', suggested: true, reason: String(reason).slice(0, 300) });
    return { suggested: true, id: it.id };
  });

  tool('suggest_video_idea', 'Suggest a video idea, based on what is performing (list_videos) and/or topics sponsors raise in email. Include up to 5 short evidence points.', {
    title: z.string().min(1).max(200), why: z.string().max(600), source: z.enum(['performance', 'sponsor_conversations', 'both']),
    evidence: z.array(z.string().max(200)).max(5).optional(),
  }, WRITE, (a) => suggestVideoIdea(db, a));

  tool('save_insight', 'Save commentary for the dashboard. kind "weekly" is the Monday insight (3–5 sentences: what moved, what is at risk, the one thing to do this week). Numbers must come from get_dashboard.', {
    kind: z.enum(['weekly', 'note']), text: z.string().min(1).max(1500), week_of: date.optional(),
  }, WRITE, (a) => saveInsight(db, a));

  tool('update_sync_cursor', 'Move the Gmail sync cursor after a run (an ISO date-time or a Gmail query like "after:2026/10/07").', {
    cursor: z.string().min(1).max(200),
  }, WRITE, ({ cursor }) => setCursor(db, cursor));

  return server;
}
