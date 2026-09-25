// pitching.js — pitch templates, the numbers that fill them, prospecting
// rules (avoid list, category cooldowns) and pitch performance. Shared by
// the app and the Worker, so Claude's drafts use the same numbers you see.
// The defaults here are generic; your edited templates live in D1.

import { WON_STAGES } from './schema.js';
import { addDays, daysBetween, CATEGORY_GAP_DAYS, monthOf } from './rules.js';

export const MEDIA_KIT_URL = 'https://www.jareddesu.com/sponsorships/';
export const REPITCH_DAYS = 90;          // don't re-pitch a brand that didn't answer for this long

export const DEFAULT_AVOID = [
  'AI tutors or chatbots', 'Crypto or NFTs', 'Gambling', '"Fluent in X days" apps',
  'Commission-only offers', 'Direct Migaku competitors',
];

export const DEFAULT_TEMPLATES = [
  {
    id: 'guide-slot', name: 'Guide-video slot',
    subject: 'A sponsored segment in my next Japanese guide video',
    body: `Hi {{first_name}},

I'm Jared, and I run まだまだJared ({{subscribers}} subscribers), a channel of practical guides for Japanese learners. My guides keep getting found for months after they go up, and {{english_share}} of views come from the US, UK, Canada and Australia.

I have one sponsor slot in "{{video}}", publishing in {{month}}. {{company}} would fit it well: [one line on why this brand fits this video].

An integration is {{price}}: a 60–90 second segment, a pinned comment and a tracked link in the description. You get a results recap 30 days after it goes live.

Media kit with current numbers: {{kit}}

Would you be open to it?

Jared`,
  },
  {
    id: 'short', name: 'Short intro',
    subject: '{{company}} × まだまだJared?',
    body: `Hi {{first_name}},

I make Japanese-learning guides on YouTube ({{subscribers}} subscribers, {{monthly_views}} views in the last 30 days). I think {{company}} would be a natural fit for my audience: [why].

I have a slot open in {{month}}. Media kit: {{kit}}

Worth a quick chat?

Jared`,
  },
  {
    id: 'renewal', name: 'Renewal',
    subject: 'Another round with {{company}}?',
    body: `Hi {{first_name}},

Thanks again for the last collaboration. [One line on how it did: views, clicks.]

My next guide, "{{video}}", goes out in {{month}}, and I'd love to have {{company}} in it again. An integration is {{price}}, and I can bundle a Short with it.

Want me to hold the slot?

Jared`,
  },
];

const nf = new Intl.NumberFormat('en-US');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const round = (n) => (n >= 10000 ? `${nf.format(Math.round(n / 100) / 10)}K`.replace('.0K', 'K') : nf.format(n));

// The values a template can use, for one deal
export function pitchValues(state, d, { channel = null, daily = [], audience = null, myName = 'Jared', today } = {}) {
  const co = state.companies.find((c) => c.id === d.company_id) || {};
  const contact = d.contact_id ? state.contacts.find((c) => c.id === d.contact_id) : state.contacts.find((c) => c.company_id === d.company_id && !c.archived);
  const v = d.video_id ? state.videos.find((x) => x.id === d.video_id) : null;
  const pkg = d.package ? state.rateCard.find((r) => !r.archived && r.package.toLowerCase() === d.package.toLowerCase()) : null;
  const price = d.quoted ?? (pkg && pkg.standard);
  const since = today ? addDays(today, -31) : null;
  const last30 = daily.filter((x) => x.views != null && (!since || x.day > since)).slice(-30).reduce((s, x) => s + x.views, 0);
  const when = (v && v.publish_date) || d.publish_date;
  return {
    first_name: contact && contact.name ? contact.name.split(/\s+/)[0] : 'there',
    to: contact && contact.email ? contact.email : '',
    company: co.name || 'your team',
    video: v ? v.title : (d.slot_note || 'my next guide video'),
    month: when ? MONTHS[+when.slice(5, 7) - 1] : 'the next few weeks',
    subscribers: channel && channel.subscribers ? round(channel.subscribers) : '[subscribers]',
    monthly_views: last30 ? round(last30) : '[monthly views]',
    english_share: audience && audience.englishShare != null ? `${Math.round(audience.englishShare * 100)}%` : 'over half',
    package: d.package || 'Integration',
    price: price != null ? `$${nf.format(price)}` : '[price]',
    kit: MEDIA_KIT_URL,
    channel: 'まだまだJared',
    my_name: myName,
  };
}

export function renderTemplate(text, values) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}

export const templatesFrom = (settings) => (settings && Array.isArray(settings.pitchTemplates) && settings.pitchTemplates.length ? settings.pitchTemplates : DEFAULT_TEMPLATES);
export const avoidFrom = (settings) => (settings && Array.isArray(settings.avoid) ? settings.avoid : DEFAULT_AVOID);

// Gmail compose link (opens a prefilled draft in the browser; nothing is sent)
export function gmailComposeUrl({ to, subject, body }) {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' });
  return `https://mail.google.com/mail/?${q}`;
}

// --- Prospecting rules -------------------------------------------------------------------------
export function prospectingRules(state, today) {
  const live = (r) => r && !r.archived;
  const deals = state.deals.filter(live);
  const companies = new Map(state.companies.map((c) => [c.id, c]));
  const committed = deals.filter((d) => WON_STAGES.includes(d.stage) || d.stage === 'Negotiating');
  const videos = new Map(state.videos.map((v) => [v.id, v]));
  const pub = (d) => d.publish_date || (videos.get(d.video_id) || {}).publish_date || null;

  // Categories that can't take another sponsor until a date (60 days apart)
  const cooldowns = {};
  committed.forEach((d) => {
    const cat = (companies.get(d.company_id) || {}).category;
    const p = pub(d);
    if (!cat || cat === 'Other' || !p) return;
    const until = addDays(p, CATEGORY_GAP_DAYS);
    if (until >= today && (!cooldowns[cat] || until > cooldowns[cat].until)) cooldowns[cat] = { until, because: (companies.get(d.company_id) || {}).name, publish: p };
  });

  // Brands to leave alone for now: pitched recently with no answer, or in an open deal
  const recentNoReply = deals.filter((d) => d.pitched_on && !d.replied_on && daysBetween(d.pitched_on, today) < REPITCH_DAYS)
    .map((d) => ({ company: (companies.get(d.company_id) || {}).name, pitched_on: d.pitched_on, until: addDays(d.pitched_on, REPITCH_DAYS) }));
  const active = deals.filter((d) => !['Paid', 'Lost', 'No reply'].includes(d.stage)).map((d) => (companies.get(d.company_id) || {}).name);

  // Exclusivity that blocks a brand's competitors until a date
  const exclusivity = deals.filter((d) => d.exclusivity_until && d.exclusivity_until >= today)
    .map((d) => ({ company: (companies.get(d.company_id) || {}).name, category: (companies.get(d.company_id) || {}).category, until: d.exclusivity_until, terms: d.exclusivity }));

  return { cooldowns, recentNoReply, active: [...new Set(active)], exclusivity };
}

// --- Pitch performance ----------------------------------------------------------------------------
export function pitchPerformance(state, { by = 'pitch_style', since = null } = {}) {
  const live = (r) => r && !r.archived;
  const companies = new Map(state.companies.map((c) => [c.id, c]));
  const key = (d) => {
    if (by === 'category') return (companies.get(d.company_id) || {}).category || 'No category';
    if (by === 'source') return d.source || 'No source';
    if (by === 'month') return monthOf(d.pitched_on);
    return d.pitch_style || 'Not recorded';
  };
  const groups = new Map();
  state.deals.filter((d) => live(d) && d.pitched_on && (!since || d.pitched_on >= since)).forEach((d) => {
    const k = key(d);
    const g = groups.get(k) || { key: k, pitched: 0, replied: 0, won: 0, revenue: 0 };
    g.pitched += 1;
    if (d.replied_on) g.replied += 1;
    if (WON_STAGES.includes(d.stage)) { g.won += 1; g.revenue += Number(d.final ?? d.quoted) || 0; }
    groups.set(k, g);
  });
  return [...groups.values()]
    .map((g) => ({ ...g, replyRate: g.pitched ? g.replied / g.pitched : null, winRate: g.pitched ? g.won / g.pitched : null }))
    .sort((a, b) => b.pitched - a.pitched);
}

// --- 30-day results recap -------------------------------------------------------------------------
export const RECAP_TEMPLATE = {
  subject: 'Results: {{company}} in "{{video}}"',
  body: `Hi {{first_name}},

Here's how "{{video}}" did in its first 30 days:

- {{views_line}}
- {{clicks_line}}
- {{extra_line}}

Thanks again for sponsoring it. My next guide, "{{next_video}}", goes out in {{next_month}}. Want me to hold that slot for {{company}}? An integration is {{price}}, and I can bundle a Short.

Jared`,
};

export function recapValues(state, d, { uploads = [], linkClicks = [], channel, daily, audience, today } = {}) {
  const base = pitchValues(state, d, { channel, daily, audience, today });
  const v = d.video_id ? state.videos.find((x) => x.id === d.video_id) : null;
  const up = v && v.youtube_id ? uploads.find((u) => u.youtube_id === v.youtube_id) : null;
  const published = (up && up.published_at ? up.published_at.slice(0, 10) : null) || (v && v.publish_date) || d.publish_date;
  const views30 = up ? (up.views_30d ?? up.views) : null;
  const basis = up && up.views_30d != null ? 'in 30 days' : 'so far';
  const slugs = (state.links || []).filter((l) => !l.archived && l.deal_id === d.id).map((l) => l.slug);
  const end = published ? addDays(published, 30) : null;
  const clicks = slugs.length && published ? linkClicks.filter((c) => slugs.includes(c.slug) && c.day >= published && c.day <= end).reduce((n, c) => n + c.clicks, 0) : null;
  const next = state.videos.filter((x) => !x.archived && x.publish_date && x.publish_date > (today || '') && x.sponsor_status !== 'sponsor_free' && (x.format || 'guide') === 'guide')
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date))[0];
  const pkg = d.package ? state.rateCard.find((r) => !r.archived && r.package.toLowerCase() === d.package.toLowerCase()) : null;
  return {
    ...base,
    video: v ? v.title : (d.slot_note || 'the video'),
    price: pkg && pkg.standard != null ? `$${nf.format(pkg.standard)}` : base.price,
    views_line: views30 != null ? `${nf.format(views30)} views ${basis}${v && v.view_estimate ? ` (estimate: ${nf.format(v.view_estimate)})` : ''}` : '[views in the first 30 days]',
    clicks_line: clicks != null ? `${nf.format(clicks)} clicks on your tracked link` : '[clicks or sign-ups, if they shared them]',
    extra_line: '[one thing viewers said about it in the comments]',
    next_video: next ? next.title : 'my next guide',
    next_month: next ? MONTHS[+next.publish_date.slice(5, 7) - 1] : 'the coming weeks',
    published, views30, clicks,
  };
}
