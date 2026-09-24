// views.js — the main screens: dashboard, pipeline, companies, videos,
// payments and the rate card.

import { h, fmtDate, fmtMoney, fmtPct, fmtMonth } from './dom.js';
import { api } from './api.js';
import { STAGES, OPEN_STAGES, VIDEO_STATUS_LABELS } from './schema.js';
import { store, reload, live, companyName, deal, dealTitle, dash, dealFlags, videoStatus, company } from './store.js';
import { openDeal, openCompany, openVideo, openPayment, openPackage } from './panels.js';
import { button, busy, toast } from './ui.js';

// --- Shared bits -------------------------------------------------------------------------
function viewHead(title, ja, actions = []) {
  return h('div', { class: 'crm-view-head' },
    h('h1', { class: 'crm-view-title' }, title, ja ? h('span', { class: 'crm-view-ja', lang: 'ja' }, ja) : null),
    h('div', { class: 'crm-view-actions' }, actions));
}

function flagChips(flags) {
  return flags.map((f) => h('span', { class: ['crm-flag', `is-${f.kind}`], title: f.title || null }, f.label));
}

function searchBox(value, onInput, placeholder = 'Search') {
  return h('input', {
    type: 'search', class: 'crm-search', value, placeholder, 'aria-label': placeholder, dataset: { search: '1' },
    oninput: (e) => onInput(e.target.value),
  });
}

function emptyState(text, action) {
  return h('div', { class: 'crm-empty' }, h('p', {}, text), action || null);
}

const matches = (q, ...fields) => !q || fields.some((f) => f && String(f).toLowerCase().includes(q.toLowerCase()));

// --- Dashboard -----------------------------------------------------------------------------
function tile(label, value, { sub, tone, onClick } = {}) {
  const tag = onClick ? 'button' : 'div';
  return h(tag, { class: ['crm-tile', tone && `is-${tone}`], type: onClick ? 'button' : null, onclick: onClick || null },
    h('span', { class: 'crm-tile-label' }, label),
    h('span', { class: 'crm-tile-value' }, value),
    sub ? h('span', { class: 'crm-tile-sub' }, sub) : null);
}

function meter(value, target) {
  const pct = target ? Math.min(1, value / target) : 0;
  const bar = h('span', { class: 'crm-meter-fill' });
  bar.style.width = `${Math.round(pct * 100)}%`;
  return h('span', { class: ['crm-meter', value >= target && target > 0 && 'is-met'], role: 'img', 'aria-label': `${value} of ${target}` }, bar);
}

function dealLine(d, extra) {
  return h('li', {}, h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openDeal(d) },
    h('span', {}, dealTitle(d)), h('span', { class: 'crm-muted' }, extra)));
}

function targetsEditor(targets, onDone) {
  const rows = targets.months.map((m) => ({ ...m }));
  const weekly = h('input', { type: 'number', min: 0, max: 100, value: targets.weeklyPitches, 'aria-label': 'Weekly pitch target' });
  const tbody = h('tbody');
  const drawRows = () => tbody.replaceChildren(...rows.map((m, i) => h('tr', {},
    h('th', { scope: 'row' }, h('input', { type: 'month', value: m.month, 'aria-label': 'Month', onchange: (e) => { rows[i].month = e.target.value; } })),
    ['pitches', 'deals', 'revenue'].map((k) => h('td', {}, h('input', {
      type: 'number', min: 0, value: m[k], 'aria-label': `${m.month} ${k}`, onchange: (e) => { rows[i][k] = Number(e.target.value) || 0; },
    }))),
    h('td', {}, button('Remove', () => { rows.splice(i, 1); drawRows(); }, { kind: 'chip' })))));
  drawRows();
  const table = h('table', { class: 'crm-table is-compact' },
    h('thead', {}, h('tr', {}, ['Month', 'Pitches', 'Deals', 'Sponsor $', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody);
  const save = button('Save targets', async () => {
    await busy(save, () => api.setting('targets', { weeklyPitches: Number(weekly.value) || 0, months: rows.filter((r) => /^\d{4}-\d{2}$/.test(r.month)) }));
    await reload();
    toast('Targets saved', { kind: 'ok', ms: 2500 });
    onDone();
  }, { kind: 'primary' });
  const addMonth = button('Add month', () => {
    const last = rows[rows.length - 1];
    const next = last ? new Date(Date.UTC(+last.month.slice(0, 4), +last.month.slice(5, 7), 1)).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7);
    rows.push({ month: next, pitches: 20, deals: 0, revenue: 0 });
    drawRows();
  });
  return h('div', { class: 'crm-targets-edit' },
    h('label', { class: 'crm-inline-field' }, 'Pitches a week ', weekly),
    h('div', { class: 'crm-table-wrap' }, table),
    h('div', { class: 'crm-row-actions' }, save, addMonth, button('Cancel', () => onDone())));
}

export function dashboardView(root) {
  let editing = false;
  const render = () => {
    const d = dash();
    const s = store.state;
    const t = s.settings.targets;
    const byId = (id) => deal(id);
    const monthly = editing
      ? targetsEditor(t, () => { editing = false; render(); })
      : h('div', { class: 'crm-table-wrap' }, h('table', { class: 'crm-table' },
        h('thead', {}, h('tr', {}, ['Month', 'Pitches', 'Replies', 'Deals', 'Booked', 'Collected'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, d.months.map((m) => h('tr', {},
          h('th', { scope: 'row' }, fmtMonth(m.month)),
          h('td', {}, h('span', { class: 'crm-num' }, `${m.pitches} / ${m.target.pitches}`), meter(m.pitches, m.target.pitches)),
          h('td', { class: 'crm-num' }, m.replies),
          h('td', { class: 'crm-num' }, `${m.deals} / ${m.target.deals}`),
          h('td', {}, h('span', { class: 'crm-num' }, `${fmtMoney(m.booked)} / ${fmtMoney(m.target.revenue)}`), meter(m.booked, m.target.revenue)),
          h('td', { class: 'crm-num' }, fmtMoney(m.collected)))))));

    const lists = [];
    if (d.followUpsDue.length) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Follow-ups due'),
        h('ul', { class: 'crm-mini-list' }, d.followUpsDue.map((f) => dealLine(byId(f.dealId), `${f.label} · since ${fmtDate(f.due)}`)))));
    }
    if (d.overdue.length) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Overdue next actions'),
        h('ul', { class: 'crm-mini-list' }, d.overdue.map((o) => dealLine(byId(o.dealId), `${o.action || 'Next action'} · ${fmtDate(o.date)}`)))));
    }
    if (d.toInvoice.length) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Delivered, not invoiced'),
        h('ul', { class: 'crm-mini-list' }, d.toInvoice.map((id) => dealLine(byId(id), 'Send the invoice')))));
    }
    if (d.invoicedUnpaid.count) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Invoiced, not paid'),
        h('ul', { class: 'crm-mini-list' }, d.invoicedUnpaid.paymentIds.map((id) => {
          const p = store.byId.payments.get(id);
          return h('li', {}, h('button', { type: 'button', class: 'crm-row-btn', onclick: () => openPayment(p) },
            h('span', {}, `${fmtMoney(p.amount)} · ${dealTitle(deal(p.deal_id) || {})}`), h('span', { class: 'crm-muted' }, `Invoiced ${fmtDate(p.invoiced_on)}`)));
        }))));
    }
    if (d.belowFloor.length) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Below floor'),
        h('ul', { class: 'crm-mini-list' }, d.belowFloor.map((b) => dealLine(byId(b.dealId), `${fmtMoney(b.amount)} vs ${fmtMoney(b.floor)} floor`)))));
    }
    if (d.conflicts.length) {
      lists.push(h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Conflicts'),
        h('ul', { class: 'crm-checks' }, d.conflicts.map((c) => h('li', { class: c.severity === 'conflict' ? 'is-bad' : 'is-warn' }, c.message)))));
    }

    root.replaceChildren(
      viewHead('Dashboard', '概況'),
      h('p', { class: 'crm-week' }, `Week of ${fmtDate(d.week.start)} – ${fmtDate(d.week.end)}`),
      h('div', { class: 'crm-tiles' },
        tile('Pitches this week', `${d.pitchesThisWeek} / ${d.weeklyPitchTarget}`, { tone: d.pitchesThisWeek >= d.weeklyPitchTarget ? 'good' : null, sub: meter(d.pitchesThisWeek, d.weeklyPitchTarget) }),
        tile('Follow-ups due', d.followUpsDue.length, { tone: d.followUpsDue.length ? 'due' : null, onClick: () => { location.hash = '#/pipeline?filter=attention'; } }),
        tile('Overdue actions', d.overdue.length, { tone: d.overdue.length ? 'bad' : null, onClick: () => { location.hash = '#/pipeline?filter=attention'; } }),
        tile('Reply rate', fmtPct(d.replyRate), { sub: 'Replies ÷ pitches' }),
        tile('Close rate', fmtPct(d.closeRate), { sub: d.closeRate90 != null ? `${fmtPct(d.closeRate90)} last 90 days` : 'Won ÷ replies' }),
        tile('Average deal', d.averageDeal != null ? fmtMoney(d.averageDeal) : '—'),
        tile('Invoiced, unpaid', fmtMoney(d.invoicedUnpaid.total), { sub: `${d.invoicedUnpaid.count} invoice${d.invoicedUnpaid.count === 1 ? '' : 's'}` }),
        tile('Open deals', d.openDeals)),
      lists.length ? h('div', { class: 'crm-dash-lists' }, lists) : h('p', { class: 'crm-note is-muted' }, 'Nothing needs you right now.'),
      h('section', { class: 'crm-section' },
        h('div', { class: 'crm-section-head' }, h('h2', { class: 'crm-section-title' }, 'By month, against the plan'),
          editing ? null : button('Edit targets', () => { editing = true; render(); }, { kind: 'chip' })),
        monthly),
    );
  };
  render();
  return render;
}

// --- Pipeline ------------------------------------------------------------------------------
const pipeState = { q: '', filter: 'open' };

export function pipelineView(root, params) {
  if (params.get('filter')) pipeState.filter = params.get('filter');
  const render = () => {
    const deals = live(store.state.deals).map((d) => ({ d, flags: dealFlags(d) }));
    const list = deals.filter(({ d, flags }) => {
      if (pipeState.filter === 'open') return !['Paid', 'Lost', 'No reply'].includes(d.stage);
      if (pipeState.filter === 'attention') return flags.length > 0;
      if (pipeState.filter === 'all') return true;
      return d.stage === pipeState.filter;
    }).sort((a, b) => STAGES.indexOf(a.d.stage) - STAGES.indexOf(b.d.stage)
      || (a.d.next_action_date || '9999').localeCompare(b.d.next_action_date || '9999'));

    const filter = h('select', { class: 'crm-filter', 'aria-label': 'Filter', onchange: (e) => { pipeState.filter = e.target.value; render(); } },
      [['open', 'Open (not closed)'], ['attention', 'Needs attention'], ['all', 'All'], ...STAGES.map((s) => [s, s])]
        .map(([v, l]) => h('option', { value: v, selected: pipeState.filter === v }, l)));
    const search = searchBox(pipeState.q, (v) => { pipeState.q = v; renderRows(); }, 'Search deals');

    const rowsEl = h('div', { class: 'crm-rows' });
    const renderRows = () => {
      const shown = list.filter(({ d }) => {
        const c = company(d.company_id) || {};
        return matches(pipeState.q, c.name, d.package, d.slot_note, d.next_action, d.notes, c.category);
      });
      rowsEl.replaceChildren(...(shown.length ? [
        h('div', { class: 'crm-row is-head', 'aria-hidden': 'true' }, ['Company', 'Stage', 'Slot', 'Next action', 'Amount', ''].map((t) => h('span', {}, t))),
        ...shown.map(({ d, flags }) => h('button', { type: 'button', class: ['crm-row', flags.length && 'has-flags'], onclick: () => openDeal(d) },
          h('span', { class: 'crm-row-main' }, h('strong', {}, companyName(d.company_id)), d.package ? h('span', { class: 'crm-muted' }, d.package) : null),
          h('span', { class: 'crm-stage', dataset: { stage: d.stage } }, d.stage),
          h('span', { class: 'crm-row-slot' }, (d.video_id && (store.byId.videos.get(d.video_id) || {}).title) || d.slot_note || ''),
          h('span', { class: 'crm-row-next' }, d.next_action || '', d.next_action_date ? h('span', { class: 'crm-muted' }, ` · ${fmtDate(d.next_action_date)}`) : null),
          h('span', { class: 'crm-num' }, d.final != null ? fmtMoney(d.final) : d.quoted != null ? h('span', { class: 'crm-muted' }, `${fmtMoney(d.quoted)} quoted`) : ''),
          h('span', { class: 'crm-flags' }, flagChips(flags)))),
      ] : [emptyState(deals.length ? 'No deals match.' : 'No deals yet. Add one, or import your tracker in Settings.', button('New deal', () => openDeal(null), { kind: 'primary' }))]));
    };
    renderRows();

    const counts = OPEN_STAGES.map((s) => [s, deals.filter(({ d }) => d.stage === s).length]).filter(([, n]) => n);
    root.replaceChildren(
      viewHead('Pipeline', '商談', [button('New deal', () => openDeal(null), { kind: 'primary' })]),
      h('div', { class: 'crm-toolbar' }, search, filter),
      counts.length ? h('p', { class: 'crm-stage-counts' }, counts.map(([s, n]) => h('button', {
        type: 'button', class: 'crm-link-btn', onclick: () => { pipeState.filter = s; render(); },
      }, `${s} ${n}`))) : null,
      rowsEl);
  };
  render();
  return render;
}

// --- Companies -----------------------------------------------------------------------------
const compState = { q: '', showArchived: false };

export function companiesView(root) {
  const render = () => {
    const s = store.state;
    const counts = new Map();
    live(s.deals).forEach((d) => counts.set(d.company_id, (counts.get(d.company_id) || 0) + 1));
    const all = s.companies.filter((c) => compState.showArchived || !c.archived);
    const rowsEl = h('div', { class: 'crm-rows' });
    const renderRows = () => {
      const shown = all.filter((c) => matches(compState.q, c.name, c.category, c.notes, ...(c.domains || [])))
        .sort((a, b) => a.name.localeCompare(b.name));
      rowsEl.replaceChildren(...(shown.length ? [
        h('div', { class: 'crm-row is-head is-company', 'aria-hidden': 'true' }, ['Company', 'Category', 'Fit', 'Domains', 'Deals'].map((t) => h('span', {}, t))),
        ...shown.map((c) => h('button', { type: 'button', class: ['crm-row', 'is-company', c.archived && 'is-archived'], onclick: () => openCompany(c) },
          h('span', { class: 'crm-row-main' }, h('strong', {}, c.name)),
          h('span', { class: 'crm-muted' }, c.category || ''),
          h('span', {}, c.fit || ''),
          h('span', { class: 'crm-muted crm-row-domains' }, (c.domains || []).join(', ')),
          h('span', { class: 'crm-num' }, counts.get(c.id) || ''))),
      ] : [emptyState(all.length ? 'No companies match.' : 'No companies yet.', button('New company', () => openCompany(null), { kind: 'primary' }))]));
    };
    renderRows();
    root.replaceChildren(
      viewHead('Companies', '取引先', [button('New company', () => openCompany(null), { kind: 'primary' })]),
      h('div', { class: 'crm-toolbar' }, searchBox(compState.q, (v) => { compState.q = v; renderRows(); }, 'Search companies'),
        h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: compState.showArchived, onchange: (e) => { compState.showArchived = e.target.checked; render(); } }), ' Show archived')),
      rowsEl);
  };
  render();
  return render;
}

// --- Videos ----------------------------------------------------------------------------------
export function videosView(root) {
  const render = () => {
    const s = store.state;
    const d = dash();
    const conflictVideos = new Set(d.conflicts.flatMap((c) => c.videoIds));
    const videos = live(s.videos).sort((a, b) => (a.publish_date || '9999').localeCompare(b.publish_date || '9999'));
    const sponsorOf = (v) => live(s.deals).filter((x) => x.video_id === v.id && ['Won', 'Delivered', 'Paid', 'Negotiating'].includes(x.stage)).map((x) => companyName(x.company_id)).join(', ');
    root.replaceChildren(
      viewHead('Videos', '動画', [button('New video', () => openVideo(null), { kind: 'primary' })]),
      h('p', { class: 'crm-note is-muted' }, 'One sponsor per video, paid slots only in guides, and at least one video in four sponsor-free.'),
      videos.length ? h('div', { class: 'crm-rows' },
        h('div', { class: 'crm-row is-head is-video', 'aria-hidden': 'true' }, ['Publish', 'Video', 'Format', 'Sponsor', 'Status'].map((t) => h('span', {}, t))),
        videos.map((v) => {
          const st = videoStatus(v, s.deals);
          return h('button', { type: 'button', class: ['crm-row', 'is-video', conflictVideos.has(v.id) && 'has-flags'], onclick: () => openVideo(v) },
            h('span', { class: 'crm-num' }, v.publish_date ? fmtDate(v.publish_date, { year: true }) : 'No date'),
            h('span', { class: 'crm-row-main' }, h('strong', {}, v.title)),
            h('span', { class: 'crm-muted' }, v.format || ''),
            h('span', {}, sponsorOf(v)),
            h('span', { class: 'crm-flags' }, h('span', { class: ['crm-vstatus', `is-${st}`] }, VIDEO_STATUS_LABELS[st]),
              conflictVideos.has(v.id) ? h('span', { class: 'crm-flag is-warn' }, 'Check') : null));
        })) : emptyState('No videos yet. Add your upcoming uploads to plan sponsor slots.', button('New video', () => openVideo(null), { kind: 'primary' })));
  };
  render();
  return render;
}

// --- Payments ----------------------------------------------------------------------------------
export function paymentsView(root) {
  const render = () => {
    const pays = live(store.state.payments).sort((a, b) => (b.paid_on || b.invoiced_on || '').localeCompare(a.paid_on || a.invoiced_on || ''));
    const paid = pays.filter((p) => p.paid_on);
    const year = new Date().getFullYear();
    const ytd = paid.filter((p) => p.paid_on.startsWith(String(year)));
    root.replaceChildren(
      viewHead('Payments', '入金', [button('New payment', () => openPayment(null), { kind: 'primary' })]),
      h('div', { class: 'crm-tiles is-small' },
        tile(`Collected ${year}`, fmtMoney(ytd.reduce((t, p) => t + p.amount, 0))),
        tile(`Net ${year}`, fmtMoney(ytd.reduce((t, p) => t + (p.net ?? p.amount), 0))),
        tile('Invoiced, unpaid', fmtMoney(pays.filter((p) => p.invoiced_on && !p.paid_on).reduce((t, p) => t + p.amount, 0)))),
      pays.length ? h('div', { class: 'crm-rows' },
        h('div', { class: 'crm-row is-head is-payment', 'aria-hidden': 'true' }, ['Deal', 'Amount', 'Invoiced', 'Paid', 'Net'].map((t) => h('span', {}, t))),
        pays.map((p) => h('button', { type: 'button', class: ['crm-row', 'is-payment', p.invoiced_on && !p.paid_on && 'has-flags'], onclick: () => openPayment(p) },
          h('span', { class: 'crm-row-main' }, h('strong', {}, dealTitle(deal(p.deal_id) || {}))),
          h('span', { class: 'crm-num' }, fmtMoney(p.amount, { cents: true })),
          h('span', {}, fmtDate(p.invoiced_on, { year: true })),
          h('span', {}, p.paid_on ? fmtDate(p.paid_on, { year: true }) : h('span', { class: 'crm-flag is-due' }, 'Unpaid')),
          h('span', { class: 'crm-num' }, p.net != null ? fmtMoney(p.net, { cents: true }) : '')))) : emptyState('No payments yet. Add one from a won deal.'),
    );
  };
  render();
  return render;
}

// --- Rate card ----------------------------------------------------------------------------------
export function ratesView(root) {
  const render = () => {
    const rows = live(store.state.rateCard).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.package.localeCompare(b.package));
    root.replaceChildren(
      viewHead('Rate card', '料金表', [button('New package', () => openPackage(null), { kind: 'primary' })]),
      h('p', { class: 'crm-note is-muted' }, 'Floors are private. Below the floor, cut deliverables, never price.'),
      rows.length ? h('div', { class: 'crm-rows' },
        h('div', { class: 'crm-row is-head is-rate', 'aria-hidden': 'true' }, ['Package', 'Standard', 'Floor', 'Included'].map((t) => h('span', {}, t))),
        rows.map((r) => h('button', { type: 'button', class: ['crm-row', 'is-rate'], onclick: () => openPackage(r) },
          h('span', { class: 'crm-row-main' }, h('strong', {}, r.package)),
          h('span', { class: 'crm-num' }, fmtMoney(r.standard)),
          h('span', { class: 'crm-num' }, fmtMoney(r.floor)),
          h('span', { class: 'crm-muted' }, r.included || '')))) : emptyState('No packages yet. Import your tracker’s Rate card tab in Settings.'),
    );
  };
  render();
  return render;
}
