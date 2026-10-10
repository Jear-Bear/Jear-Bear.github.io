// traffic-view.js — the Traffic tab: website visits from Cloudflare Web
// Analytics (cookieless, aggregated), stored by the Worker. Numbers come from
// traffic.js; Claude's weekly traffic report is shown as plain text.

import { h, fmtDate, fmtDateTime } from './dom.js';
import { request } from './api.js';
import { button, busy, toast } from './ui.js';
import { summarize, DIM_LABELS } from './traffic.js';
import { insightData, invalidateInsights } from './insights-view.js';

const num = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const NS = 'http://www.w3.org/2000/svg';
const RANGES = [[7, '7 days'], [28, '28 days'], [90, '90 days'], [365, '12 months']];
let range = 28;

const section = (title, ...kids) => h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, title), ...kids);

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  kids.flat().forEach((c) => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].find((n) => n * p >= v) * p;
};

// "+12%" / "−8%" / "new"
function delta(change, { isNew = false } = {}) {
  if (isNew) return h('span', { class: 'crm-delta is-new' }, 'new');
  if (change == null) return null;
  const pct = Math.round(change * 100);
  if (!pct) return h('span', { class: 'crm-delta' }, '±0%');
  return h('span', { class: ['crm-delta', pct > 0 ? 'is-up' : 'is-down'] }, `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`);
}

function tile(label, value, sub, change) {
  return h('div', { class: 'crm-tile' },
    h('span', { class: 'crm-tile-label' }, label),
    h('span', { class: 'crm-tile-value' }, value),
    h('span', { class: 'crm-tile-sub' }, delta(change), sub ? ` ${sub}` : ''));
}

// Daily page views (bars) with visits (line)
function dailyChart(daily) {
  const frame = h('div', { class: 'crm-chart-frame' });
  const draw = () => {
    const W = Math.max(300, frame.clientWidth || 640);
    const H = W < 520 ? 200 : 240;
    const pad = { l: 40, r: 8, t: 12, b: 24 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const max = niceMax(Math.max(1, ...daily.map((d) => d.views)));
    const n = daily.length;
    const step = iw / Math.max(1, n);
    const bw = Math.max(1.5, Math.min(22, step * 0.7));
    const x = (i) => pad.l + step * i + step / 2;
    const y = (v) => pad.t + ih - (v / max) * ih;
    const total = daily.reduce((t, d) => t + d.views, 0);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `Daily page views and visits, ${n} days, ${num.format(total)} views in total.` });
    [0, max / 2, max].forEach((v) => {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-gridline' }));
      svg.append(s('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, compact.format(v)));
    });
    const every = Math.ceil(n / (W < 520 ? 5 : 9));
    daily.forEach((d, i) => {
      if (d.views > 0) {
        svg.append(s('rect', { x: x(i) - bw / 2, y: y(d.views), width: bw, height: Math.max(0.5, y(0) - y(d.views)), class: 'crm-bar-views' },
          s('title', {}, `${fmtDate(d.day, { year: true })}: ${num.format(d.views)} views, ${num.format(d.visits)} visits`)));
      }
      if ((i % every === 0 && (i === n - 1 || n - 1 - i >= every * 0.7)) || i === n - 1) {
        svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'chart-axis' }, fmtDate(d.day)));
      }
    });
    if (n > 1) svg.append(s('path', { d: `M${daily.map((d, i) => `${x(i).toFixed(1)},${y(d.visits).toFixed(1)}`).join(' L')}`, class: 'crm-line-visits' }));
    frame.replaceChildren(svg);
  };
  requestAnimationFrame(draw);
  let last = 0;
  new ResizeObserver(() => { const w = frame.clientWidth; if (Math.abs(w - last) > 8) { last = w; draw(); } }).observe(frame);
  return h('div', { class: 'crm-chart' }, frame,
    h('ul', { class: 'crm-legend' },
      h('li', {}, h('span', { class: 'crm-swatch is-views' }), 'Page views'),
      h('li', {}, h('span', { class: 'crm-swatch is-line-visits' }), 'Visits')));
}

// Ranked list with a share bar and the change vs the previous period
function barList(rows, { limit = 8, label = (r) => r.key, sub = null, empty = 'No data yet.' } = {}) {
  if (!rows.length) return h('p', { class: 'crm-muted' }, empty);
  const max = Math.max(...rows.map((r) => r.views)) || 1;
  const list = (items) => h('ol', { class: 'crm-barlist' }, items.map((r) => {
    const fill = h('span', { class: 'crm-barlist-fill' });
    fill.style.width = `${Math.max(1, (r.views / max) * 100)}%`;
    return h('li', {},
      h('div', { class: 'crm-barlist-row' },
        h('span', { class: 'crm-barlist-name', title: r.key }, label(r), sub ? h('span', { class: 'crm-barlist-sub' }, sub(r)) : null),
        h('span', { class: 'crm-barlist-num crm-num' }, num.format(r.views), h('span', { class: 'crm-barlist-pct' }, ` ${Math.round(r.share * 100)}%`), delta(r.change, { isNew: r.isNew }))),
      h('div', { class: 'crm-barlist-track', 'aria-hidden': 'true' }, fill));
  }));
  const head = list(rows.slice(0, limit));
  if (rows.length <= limit) return head;
  const more = h('details', { class: 'crm-barlist-more' }, h('summary', {}, `All ${rows.length}`), list(rows.slice(limit)));
  return h('div', {}, head, more);
}

// One stacked bar (devices)
function shareBar(rows) {
  const total = rows.reduce((t, r) => t + r.views, 0) || 1;
  const bar = h('div', { class: 'crm-sharebar', role: 'img', 'aria-label': rows.map((r) => `${r.key} ${Math.round((r.views / total) * 100)}%`).join(', ') });
  rows.forEach((r, i) => {
    const seg = h('span', { class: `crm-share-seg k${i % 4}`, title: `${r.key}: ${num.format(r.views)}` });
    seg.style.width = `${(r.views / total) * 100}%`;
    bar.append(seg);
  });
  return h('div', {}, bar, h('ul', { class: 'crm-legend' }, rows.map((r, i) => h('li', {}, h('span', { class: `crm-swatch crm-share-seg k${i % 4}` }), `${r.key} ${Math.round((r.views / total) * 100)}%`))));
}

function weekdayBars(avg) {
  const max = Math.max(1, ...avg.map((d) => d.views));
  return h('div', { class: 'crm-weekdays', role: 'img', 'aria-label': `Average views by weekday: ${avg.map((d) => `${d.name} ${d.views}`).join(', ')}` },
    avg.map((d) => {
      const col = h('span', { class: 'crm-weekday-col' });
      col.style.height = `${Math.max(2, (d.views / max) * 100)}%`;
      return h('div', { class: 'crm-weekday' }, h('div', { class: 'crm-weekday-track' }, col), h('span', { class: 'crm-weekday-label' }, d.name.slice(0, 3)), h('span', { class: 'crm-weekday-n crm-num' }, compact.format(d.views)));
    }));
}

function report(insights) {
  const list = (insights || []).filter((i) => i.kind === 'traffic');
  if (!list.length) return null;
  const [latest, ...past] = list;
  const para = (text) => text.split(/\n{2,}|\n(?=- )/).map((p) => h('p', { class: 'crm-insight-text' }, p.trim()));
  return h('section', { class: 'crm-insight', 'aria-label': 'Weekly traffic report from Claude' },
    h('p', { class: 'crm-insight-meta' }, `Traffic report · week of ${fmtDate(latest.week_of || latest.created_at.slice(0, 10), { year: true })} · Claude`),
    para(latest.text),
    past.length ? h('details', { class: 'crm-insight-past' }, h('summary', {}, `Earlier reports (${past.length})`),
      h('ul', {}, past.map((i) => h('li', {}, h('span', { class: 'crm-muted' }, `${fmtDate(i.week_of || i.created_at.slice(0, 10), { year: true })} · `), i.text)))) : null);
}

function setupNote(data) {
  if (data.configured) return null;
  return section('Connect Cloudflare',
    h('p', { class: 'crm-note' }, 'The tracking snippet is on every public page, so Cloudflare is already counting visits. To show them here, give the Worker read access once:'),
    h('ol', { class: 'crm-steps' },
      h('li', {}, 'Cloudflare → My Profile → API Tokens → Create Token → Custom token. Permission: Account → Account Analytics → Read. Nothing else.'),
      h('li', {}, 'GitHub → the site repo → Settings → Secrets and variables → Actions → New secret named CF_ANALYTICS_TOKEN with that token.'),
      h('li', {}, 'Actions → Deploy sponsor CRM → Run workflow. Then press Refresh here.')),
    h('p', { class: 'crm-method' }, 'The token can only read analytics. It lives in GitHub secrets and the Worker, never in the site or the browser.'));
}

// --- Crossword+ waitlist ----------------------------------------------------------------------
// Emails people left on the crossword page for one note when Crossword+
// launches (workers/sponsor-crm/src/waitlist.js). Shown only here, never stored
// in the repo. Each person's leave link goes at the bottom of that one email.
const WANT_LABELS = { archive: 'Every past puzzle', bonus: 'Bonus puzzles', deck: 'Crosswords from their Anki deck', sync: 'Streaks on all devices', print: 'Printable puzzles' };
const leaveUrl = (token) => `https://sponsor-crm.jared-65b.workers.dev/public/crossword-leave?t=${token}`;

// Sign-ups per day (bars) and the running total (line), from the first
// sign-up (or 14 days back) to today, at most 90 days
function signupChart(rows) {
  const dayOf = (iso) => iso.slice(0, 10);
  const counts = new Map();
  rows.forEach((r) => counts.set(dayOf(r.created_at), (counts.get(dayOf(r.created_at)) || 0) + 1));
  const today = new Date().toISOString().slice(0, 10);
  const first = rows.length ? rows.map((r) => dayOf(r.created_at)).sort()[0] : today;
  const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  let start = first < addDay(today, -13) ? first : addDay(today, -13);
  if (start < addDay(today, -89)) start = addDay(today, -89);
  let total = rows.filter((r) => dayOf(r.created_at) < start).length;
  const days = [];
  for (let d = start; d <= today; d = addDay(d, 1)) { const c = counts.get(d) || 0; total += c; days.push({ day: d, n: c, total }); }

  const frame = h('div', { class: 'crm-chart-frame' });
  const draw = () => {
    const W = Math.max(300, frame.clientWidth || 640);
    const H = W < 520 ? 190 : 220;
    const pad = { l: 34, r: 34, t: 12, b: 24 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxN = niceMax(Math.max(1, ...days.map((d) => d.n)));
    const maxT = niceMax(Math.max(1, total));
    const n = days.length, step = iw / Math.max(1, n);
    const bw = Math.max(1.5, Math.min(22, step * 0.7));
    const x = (i) => pad.l + step * i + step / 2;
    const yN = (v) => pad.t + ih - (v / maxN) * ih;
    const yT = (v) => pad.t + ih - (v / maxT) * ih;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `Crossword+ sign-ups per day over ${n} days; ${num.format(total)} in total.` });
    [0, maxN / 2, maxN].forEach((v) => {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: yN(v), y2: yN(v), class: 'chart-gridline' }));
      svg.append(s('text', { x: pad.l - 6, y: yN(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, compact.format(v)));
    });
    [0, maxT].forEach((v) => svg.append(s('text', { x: W - pad.r + 6, y: yT(v) + 4, 'text-anchor': 'start', class: 'chart-axis' }, compact.format(v))));
    const every = Math.ceil(n / (W < 520 ? 5 : 9));
    days.forEach((d, i) => {
      if (d.n > 0) svg.append(s('rect', { x: x(i) - bw / 2, y: yN(d.n), width: bw, height: Math.max(0.5, yN(0) - yN(d.n)), class: 'crm-bar-views' },
        s('title', {}, `${fmtDate(d.day, { year: true })}: ${num.format(d.n)} sign-up${d.n === 1 ? '' : 's'}, ${num.format(d.total)} in total`)));
      if ((i % every === 0 && n - 1 - i >= every * 0.7) || i === n - 1) svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'chart-axis' }, fmtDate(d.day)));
    });
    if (n > 1) svg.append(s('path', { d: `M${days.map((d, i) => `${x(i).toFixed(1)},${yT(d.total).toFixed(1)}`).join(' L')}`, class: 'crm-line-visits' }));
    frame.replaceChildren(svg);
  };
  requestAnimationFrame(draw);
  let last = 0;
  new ResizeObserver(() => { const w = frame.clientWidth; if (Math.abs(w - last) > 8) { last = w; draw(); } }).observe(frame);
  return h('div', { class: 'crm-chart' }, frame,
    h('ul', { class: 'crm-legend' },
      h('li', {}, h('span', { class: 'crm-swatch is-views' }), 'Sign-ups that day (left scale)'),
      h('li', {}, h('span', { class: 'crm-swatch is-line-visits' }), 'Total so far (right scale)')));
}

// Bonus puzzles sealed for Crossword+ (the nightly task adds a couple a week)
function bonusTile(b) {
  if (!b) return null;
  if (b.error) return tile('Bonus puzzles', '—', `Couldn’t check: ${b.error}`);
  const levels = ['beginner', 'intermediate', 'advanced', 'mixed'].map((l) => `${b.items.filter((i) => i.level === l).length} ${l}`).join(' · ');
  const broken = b.count - b.readable;
  return tile('Bonus puzzles ready', num.format(b.readable), b.count ? `${levels}${broken ? ` · ${broken} won’t open` : ''}` : 'none sealed yet');
}

function waitlistSection(w) {
  if (!w) return null;
  if (w.error) return section('Crossword+ waitlist', h('p', { class: 'crm-note is-error' }, `Couldn’t load the waitlist: ${w.error}`));
  const copy = button('Copy emails', async () => {
    try { await navigator.clipboard.writeText(w.rows.map((r) => r.email).join(', ')); toast('Copied', { kind: 'ok', ms: 2000 }); } catch { toast('Couldn’t copy', { kind: 'error' }); }
  }, { kind: 'chip', disabled: !w.count });
  const csv = button('Download CSV', () => {
    const lines = [['email', 'language', 'wants', 'signed_up', 'leave_link'], ...w.rows.map((r) => [r.email, r.lang, r.wants.join(' '), r.created_at.slice(0, 10), leaveUrl(r.token)])];
    const blob = new Blob([lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'crossword-plus-waitlist.csv' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { kind: 'chip', disabled: !w.count });
  const wants = Object.entries(w.wants).map(([k, n]) => ({ key: WANT_LABELS[k] || k, views: n, share: w.count ? n / w.count : 0 })).sort((a, b) => b.views - a.views);
  return section('Crossword+ waitlist',
    h('div', { class: 'crm-tiles' },
      tile('Signed up', num.format(w.count), 'want one email at launch'),
      tile('Last 7 days', num.format(w.last7), 'new sign-ups'),
      tile('Most wanted', w.count && wants[0].views ? wants[0].key : '—', w.count && wants[0].views ? `${Math.round(wants[0].share * 100)}% picked it` : 'optional picks'),
      tile('In Japanese', num.format(w.rows.filter((r) => r.lang === 'ja').length), 'signed up with the Japanese page'),
      bonusTile(w.bonus)),
    w.count ? signupChart(w.rows) : null,
    w.count ? h('div', {}, h('h3', { class: 'crm-subhead' }, 'What they’d want'), barList(wants, { limit: 5 })) : h('p', { class: 'crm-muted' }, 'No sign-ups yet. The crossword asks regulars after their 3rd solve, at most once a day, and the page has a short “Free, and staying free” section.'),
    w.count ? h('details', { class: 'crm-details' }, h('summary', {}, `Show ${num.format(w.count)} email${w.count === 1 ? '' : 's'}`),
      h('ul', { class: 'crm-waitlist' }, w.rows.map((r) => h('li', {}, r.email, h('span', { class: 'crm-muted' }, ` · ${r.lang} · ${fmtDate(r.created_at.slice(0, 10))}`))))) : null,
    h('div', { class: 'crm-traffic-bar' }, copy, csv),
    h('p', { class: 'crm-method' }, 'Sign-ups are saved the moment someone presses the button. This list reads them live when you open Traffic (or press Refresh), and the desk refreshes itself every 5 minutes. Promised on the page: one email when Crossword+ is ready, no newsletter. Put each person’s leave link (in the CSV) at the bottom of that email; it deletes them from the list.'));
}

// Crossword+ accounts and payments (workers/sponsor-crm/src/plus.js, stripe.js).
// People sign in with Google or an email link; a Stripe subscription, or free
// access you give here, makes them a member. "Connect Stripe" sets up the
// prices, the customer portal and the webhook (safe to press again).
function membersSection(m, reload) {
  if (!m) return null;
  if (m.error) return section('Crossword+ members', h('p', { class: 'crm-note is-error' }, `Couldn’t load Crossword+: ${m.error}`));
  const st = m.stripe || {};
  const connect = button(st.connected ? 'Reconnect Stripe' : 'Connect Stripe', async () => {
    const r = await busy(connect, () => request('POST', 'plus/stripe-setup'));
    toast(`Stripe connected (${r.mode} mode)`, { kind: 'ok', ms: 3000 });
    reload(false);
  }, { kind: st.connected ? 'chip' : 'primary', disabled: !st.key });
  const email = h('input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email', maxlength: '254' });
  const note = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note', maxlength: '120' });
  const give = button('Give free access', async () => {
    await busy(give, () => request('POST', 'plus', { email: email.value.trim(), note: note.value.trim() }));
    toast('Done. It works as soon as they sign in with that email.', { kind: 'ok', ms: 3500 });
    email.value = ''; note.value = '';
    reload(false);
  }, { kind: 'chip' });
  const users = m.users || [];
  const paid = users.filter((u) => u.member && u.paid);
  const monthly = paid.filter((u) => u.plan === 'month').length;
  const yearly = paid.filter((u) => u.plan === 'year').length;
  const act = (u, label, body) => button(label, async (ev) => { await busy(ev.currentTarget, () => request('PATCH', `plus/${u.id}`, body)); reload(false); }, { kind: 'chip' });
  const statusOf = (u) => (u.revoked ? 'turned off' : u.paid ? `${u.status}${u.plan ? ` · ${u.plan}ly` : ''}${u.period_end ? ` · ${u.status === 'canceled' ? 'ended' : 'renews'} ${fmtDate(u.period_end.slice(0, 10))}` : ''}` : u.granted ? 'free access' : 'signed up, not a member');
  return section('Crossword+ members',
    h('div', { class: 'crm-tiles' },
      tile('Paying members', num.format(paid.length), `${monthly} monthly · ${yearly} yearly`),
      tile('Monthly revenue', `$${(monthly * 2.99 + yearly * 24.99 / 12).toFixed(2)}`, 'before Stripe’s fees (yearly spread over 12)'),
      tile('Free access', num.format(users.filter((u) => u.member && !u.paid).length), 'given here'),
      tile('Accounts', num.format(users.length), 'signed in at least once')),
    h('div', { class: 'crm-traffic-bar' },
      h('span', { class: st.connected ? 'crm-muted' : 'crm-note is-error' }, !st.key ? 'Stripe: add the STRIPE_SECRET_KEY GitHub secret, then run the deploy.' : st.connected ? `Stripe: connected (${st.mode} mode)` : `Stripe: key found (${st.mode} mode), not connected yet`),
      connect),
    h('div', { class: 'crm-traffic-bar' }, email, note, give),
    users.length ? h('ul', { class: 'crm-waitlist' }, users.map((u) => h('li', {},
      h('span', {}, u.email, u.google ? h('span', { class: 'crm-muted' }, ' · Google') : null),
      h('span', { class: 'crm-muted' }, ` · ${statusOf(u)}${u.last_login ? ` · last in ${fmtDate(u.last_login.slice(0, 10))}` : ''}${u.grant_note ? ` · ${u.grant_note}` : ''} `),
      u.granted && !u.revoked ? act(u, 'Remove free access', { granted: false }) : null,
      act(u, u.revoked ? 'Turn back on' : 'Turn off', { revoked: !u.revoked }),
      act(u, 'Sign out everywhere', { signOut: true })))) : h('p', { class: 'crm-muted' }, 'No accounts yet.'),
    h('p', { class: 'crm-method' }, 'Turning someone off doesn’t cancel their Stripe subscription; cancel or refund that in Stripe. Founding price for the waitlist: make a promotion code in Stripe (e.g. $1 off forever); Checkout has a box for codes.'));
}

// --- The Traffic tab --------------------------------------------------------------------------
export function trafficView(root) {
  let data = null;
  let insights = [];
  let waitlist = null;
  let members = null;
  let error = null;
  const loadMembers = async (all = true) => {
    members = await request('GET', 'plus').catch((err) => ({ error: err.message }));
    if (!all) render();
  };
  const load = async () => {
    try {
      const [d, ins, wl] = await Promise.all([request('GET', `traffic?days=${range}`), insightData().catch(() => ({ insights: [] })), request('GET', 'waitlist').catch((err) => ({ error: err.message })), loadMembers()]);
      data = d; insights = ins.insights || []; waitlist = wl; error = null;
      if (wl && !wl.error) wl.bonus = await request('GET', 'crossword-bonus').catch((err) => ({ error: err.message }));
    } catch (err) { error = err; }
    render();
  };
  const render = () => {
    const head = h('div', { class: 'crm-view-head' }, h('h1', { class: 'crm-view-title' }, 'Traffic', h('span', { class: 'crm-view-ja', lang: 'ja' }, '訪問')));
    if (error) { root.replaceChildren(head, h('p', { class: 'crm-note is-error' }, error.message)); return; }
    if (!data) { root.replaceChildren(head, h('p', { class: 'crm-muted' }, 'Loading…')); return; }
    const x = summarize(data);
    const t = x.totals;
    const refresh = button('Refresh', async () => {
      try {
        const r = await busy(refresh, () => request('POST', 'traffic/refresh'));
        toast(`Updated ${fmtDate(r.from)}–${fmtDate(r.to)}`, { kind: 'ok', ms: 2500 });
        invalidateInsights();
        await load();
      } catch (err) { toast(err.message, { kind: 'error', ms: 8000 }); }
    }, { kind: 'chip', disabled: !data.configured });
    const picker = h('div', { class: 'crm-seg', role: 'group', 'aria-label': 'Period' },
      RANGES.map(([d, l]) => h('button', { type: 'button', class: ['crm-seg-btn', d === range && 'is-on'], 'aria-pressed': String(d === range), onclick: () => { range = d; data = null; render(); load(); } }, l)));
    const st = data.status;
    const syncLine = h('p', { class: 'crm-note is-muted' },
      st ? (st.ok ? `Last updated ${fmtDateTime(st.last_run)}. ` : `Last update failed (${fmtDateTime(st.last_run)}): ${st.error} `) : 'Not updated yet. ',
      `Days are in UTC. ${data.since ? `Data since ${fmtDate(data.since, { year: true })}.` : ''}`);
    const hasData = t.views > 0 || t.prevViews > 0;
    const vs = `vs previous ${x.days} days`;

    root.replaceChildren(...[
      head,
      h('div', { class: 'crm-traffic-bar' }, picker, refresh),
      syncLine,
      setupNote(data),
      report(insights),
      hasData ? null : h('p', { class: 'crm-empty' }, data.configured ? 'No visits recorded in this period yet. Cloudflare starts counting when the snippet goes live, and the Worker pulls the numbers daily.' : 'Visits will show here once Cloudflare is connected.'),
      h('div', { class: 'crm-tiles' },
        tile('Page views', num.format(t.views), vs, t.viewsChange),
        tile('Visits', num.format(t.visits), vs, t.visitsChange),
        tile('Views per visit', t.viewsPerVisit ? t.viewsPerVisit.toFixed(2) : '—', 'pages seen per visit'),
        tile('From other sites', t.externalShare == null ? '—' : `${Math.round(t.externalShare * 100)}%`, 'of visits (YouTube, search, social…)')),
      section('Every day', dailyChart(x.daily),
        h('p', { class: 'crm-method' }, [
          `${num.format(Math.round(t.perDay * 10) / 10)} views a day on average.`,
          x.trendPerWeek != null ? ` Trend: ${x.trendPerWeek >= 0 ? 'up' : 'down'} about ${num.format(Math.abs(Math.round(x.trendPerWeek * 10) / 10))} views a day each week.` : '',
          x.peak ? ` Busiest day: ${fmtDate(x.peak.day, { year: true })} (${num.format(x.peak.views)} views).` : '',
        ].join(''))),
      h('div', { class: 'crm-traffic-grid' },
        section('Top pages', barList(x.pages, { limit: 10, label: (r) => r.name, sub: (r) => (r.name !== r.key ? r.key : null) })),
        section('Site sections', barList(x.sections, { limit: 8 }))),
      h('div', { class: 'crm-traffic-grid' },
        section(DIM_LABELS.referer, barList(x.referers, { limit: 10 }),
          h('p', { class: 'crm-method' }, 'Direct / unknown includes bookmarks, typed links and apps that hide where the visitor came from (many YouTube app taps land here).')),
        section('What’s moving',
          x.rising.length ? h('div', {}, h('h3', { class: 'crm-subhead' }, 'Growing faster than the site'), barList(x.rising, { limit: 5, label: (r) => r.name })) : null,
          x.newReferrers.length ? h('div', {}, h('h3', { class: 'crm-subhead' }, 'New sources this period'), barList(x.newReferrers, { limit: 8 })) : null,
          x.bestWeekday ? h('div', {}, h('h3', { class: 'crm-subhead' }, `Average views by weekday · busiest: ${x.bestWeekday}`), weekdayBars(x.avgByWeekday)) : null,
          !x.rising.length && !x.newReferrers.length && !x.bestWeekday ? h('p', { class: 'crm-muted' }, 'Needs a week or two of data.') : null)),
      h('div', { class: 'crm-traffic-grid' },
        section(DIM_LABELS.country, barList(x.country, { limit: 8 })),
        section(DIM_LABELS.device, x.device.length ? shareBar(x.device.slice(0, 4)) : h('p', { class: 'crm-muted' }, 'No data yet.'),
          h('h3', { class: 'crm-subhead' }, DIM_LABELS.browser), barList(x.browser, { limit: 5 }),
          h('h3', { class: 'crm-subhead' }, DIM_LABELS.os), barList(x.os, { limit: 5 }))),
      waitlistSection(waitlist),
      membersSection(members, loadMembers),
      h('p', { class: 'crm-method' }, 'From Cloudflare Web Analytics: no cookies and no individual visitors, only totals. Cloudflare samples busy periods, so small numbers can be estimates. A visit is someone arriving from another site or typing the address; page views count every page they open. The private Sponsor desk isn’t tracked.'),
    ].filter(Boolean));
  };
  render();
  load();
  return render;
}
