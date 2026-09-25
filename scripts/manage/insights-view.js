// insights-view.js — Phase 4 screens: the Insights tab (rate check, channel
// milestones, the go-full-time tracker) and the dashboard's Monday insight
// and weekly quest. Numbers come from insights.js; Claude's text is shown as
// plain text.

import { h, fmtDate, fmtMoney, fmtMonth } from './dom.js';
import { request } from './api.js';
import { store, reload, today } from './store.js';
import { button, busy, toast, toastError } from './ui.js';
import {
  allInsights, pitchStreak, stamps as stampList, INCOME_SOURCES, INCOME_SOURCES_ENTERED, INCOME_LABELS, fitLine,
} from './insights.js';
import { addDays, weekStart } from './rules.js';
import { expand, ruleItems } from './calendar.js';
import { ring, incomeChart, trendChart, goalBar } from './charts.js';
import { linkRow } from './growth.js';
import { openLink } from './panels.js';
import { fetchRange } from './cal-view.js';
import { applyChange, onCalendarChange, openCalItem, openRuleItem } from './cal-panel.js';

// --- Data (cached per session; refetched after a change) -----------------------------------------
let cache = null;
export async function insightData({ force = false } = {}) {
  if (!force && cache) return cache;
  cache = await request('GET', 'insights');
  return cache;
}
export const invalidateInsights = () => { cache = null; };

const num = new Intl.NumberFormat('en-US');
const section = (title, ...kids) => h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, title), ...kids);
const monthLabel = (m) => (m ? fmtMonth(m) : '—');

// --- Dashboard: Claude's Monday insight --------------------------------------------------------
export function mondayInsight(data) {
  const weekly = (data.insights || []).filter((i) => i.kind === 'weekly');
  if (!weekly.length) return null;
  const [latest, ...past] = weekly;
  return h('section', { class: 'crm-insight', 'aria-label': 'This week’s insight from Claude' },
    h('p', { class: 'crm-insight-meta' }, `Monday insight · week of ${fmtDate(latest.week_of || latest.created_at.slice(0, 10), { year: true })} · Claude`),
    h('p', { class: 'crm-insight-text' }, latest.text),
    past.length ? h('details', { class: 'crm-insight-past' }, h('summary', {}, `Earlier insights (${past.length})`),
      h('ul', {}, past.map((i) => h('li', {}, h('span', { class: 'crm-muted' }, `${fmtDate(i.week_of || i.created_at.slice(0, 10), { year: true })} · `), i.text)))) : null);
}

// --- Dashboard: the week's quest ----------------------------------------------------------------
const QUEST_TYPES = ['task', 'deliverable', 'milestone'];

export function weeklyQuest(data) {
  const s = store.state;
  const t = today();
  const target = s.settings.targets.weeklyPitches ?? 5;
  const streak = pitchStreak(s, t, target);
  const ws = weekStart(t);
  const we = addDays(ws, 6);
  const list = h('ul', { class: 'crm-quest-list' }, h('li', { class: 'crm-muted' }, 'Loading this week’s tasks…'));
  const count = h('span', { class: 'crm-muted' });

  const drawList = async (force = false) => {
    try {
      const cal = await fetchRange(ws, we, { force });
      const items = [...expand(cal, ws, we), ...ruleItems(s, ws, we, t)]
        .filter((it) => QUEST_TYPES.includes(it.type) && !it.hidden && it.suggested !== 1 && it.suggested !== 2 && it.status !== 'cancelled')
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.start.localeCompare(b.start));
      const done = items.filter((it) => it.status === 'done' || it.status === 'skipped').length;
      count.textContent = items.length ? ` · ${done} of ${items.length} tasks done` : '';
      list.replaceChildren(...(items.length ? items.map((it) => {
        const isRule = it.source === 'rules';
        const checked = it.status === 'done';
        const box = h('input', {
          type: 'checkbox', checked, disabled: isRule, 'aria-label': `${checked ? 'Undo' : 'Mark done'}: ${it.title}`,
          title: isRule ? 'Done when the deal changes (open it to update)' : null,
          onchange: async (e) => {
            box.disabled = true;
            try { await applyChange(it, { status: e.target.checked ? 'done' : 'not_started' }, { verb: e.target.checked ? 'Done' : 'Reopened' }); } catch (err) { toastError(err); e.target.checked = !e.target.checked; } finally { box.disabled = isRule; }
          },
        });
        return h('li', { class: ['crm-quest-item', checked && 'is-done', it.overdue && 'is-overdue'] },
          box,
          h('button', { type: 'button', class: 'crm-link-btn', onclick: () => (isRule ? openRuleItem(it) : openCalItem(it)) }, it.title),
          h('span', { class: 'crm-muted' }, fmtDate(it.start)));
      }) : [h('li', { class: 'crm-muted' }, 'No tasks on the calendar this week.')]));
    } catch (err) {
      list.replaceChildren(h('li', { class: 'crm-note is-error' }, err.message));
    }
  };
  drawList();
  const off = onCalendarChange(() => { if (document.contains(list)) drawList(true); else off(); });

  const earned = stampList(s, { today: t, targets: s.settings.targets, income: data ? data.income : [], weeklyTarget: target });
  const streakText = streak.weeks
    ? `${streak.weeks}-week streak of ${target}-pitch weeks${streak.thisWeekMet ? '' : ' (this week still counts once you reach it)'}`
    : streak.best ? `No streak right now · best: ${streak.best} week${streak.best === 1 ? '' : 's'}` : `No ${target}-pitch weeks yet`;

  return h('section', { class: 'crm-quest', 'aria-label': 'This week' },
    h('div', { class: 'crm-quest-head' },
      ring(streak.thisWeek, target, { label: `${streak.thisWeek} of ${target} pitches this week` }),
      h('div', {},
        h('h2', { class: 'crm-section-title' }, 'This week', count),
        h('p', { class: 'crm-quest-streak' }, streakText))),
    list,
    h('ul', { class: 'crm-stamps', 'aria-label': 'Milestones' }, earned.map((st) => h('li', {
      class: ['crm-stamp', (st.on || st.month) && 'is-earned'],
      title: st.on || st.month ? `Earned ${st.month ? fmtMonth(st.month) : fmtDate(st.on, { year: true })}` : 'Not yet',
    }, h('span', { class: 'crm-stamp-label' }, st.label),
    h('span', { class: 'crm-stamp-date' }, st.month ? fmtMonth(st.month) : st.on ? fmtDate(st.on, { year: true }) : 'Not yet')))));
}

// --- Insights tab: rate check ----------------------------------------------------------------------
function rateCard(rule, onDone) {
  const status = rule.snoozed
    ? h('span', { class: 'crm-flag' }, `${rule.snoozed.status === 'accepted' ? 'Raised' : 'Dismissed'} ${fmtDate(rule.snoozed.on)} · resumes ${fmtDate(rule.snoozed.until)}`)
    : rule.triggered ? h('span', { class: 'crm-flag is-ok' }, 'Triggered') : h('span', { class: 'crm-flag' }, 'Not yet');
  const body = [
    h('p', { class: 'crm-muted' }, rule.progress),
    h('ul', { class: 'crm-evidence' }, rule.evidence.map((e) => h('li', {}, e))),
  ];
  if (rule.active && rule.suggestion.length) {
    const rows = rule.suggestion.map((p) => ({
      p, use: h('input', { type: 'checkbox', checked: true, 'aria-label': `Update ${p.package}` }),
      std: h('input', { type: 'number', min: 0, step: 25, value: p.newStandard, 'aria-label': `${p.package} new standard` }),
      floor: p.floor != null ? h('input', { type: 'number', min: 0, step: 25, value: p.newFloor, 'aria-label': `${p.package} new floor` }) : null,
    }));
    const accept = button('Accept into the rate card', async () => {
      const packages = rows.filter((r) => r.use.checked).map((r) => ({ id: r.p.id, standard: Number(r.std.value) || null, floor: r.floor ? Number(r.floor.value) || null : null }));
      if (!packages.length) { toast('Pick at least one package', { kind: 'error' }); return; }
      await busy(accept, () => request('POST', `rate-rules/${rule.id}/accept`, { packages }));
      toast('Rate card updated', { kind: 'ok', ms: 3000 });
      onDone(true);
    }, { kind: 'primary' });
    const dismiss = button('Not now', async () => {
      await busy(dismiss, () => request('POST', `rate-rules/${rule.id}/dismiss`, {}));
      toast('Dismissed for 30 days', { ms: 3000 });
      onDone(false);
    });
    body.push(
      h('p', {}, `Suggested: raise ${Math.round(rule.raise * 100)}%${rule.raiseMax ? `–${Math.round(rule.raiseMax * 100)}%` : ''}, rounded up to $25.`),
      h('div', { class: 'crm-rate-rows' }, rows.map((r) => h('div', { class: 'crm-rate-row' },
        h('label', { class: 'crm-rate-pkg' }, r.use, h('span', {}, h('strong', {}, r.p.package),
          h('span', { class: 'crm-muted' }, ` now ${fmtMoney(r.p.standard)}${r.p.floor != null ? ` · floor ${fmtMoney(r.p.floor)}` : ''}`))),
        h('label', { class: 'crm-rate-new' }, 'Standard', r.std),
        r.floor ? h('label', { class: 'crm-rate-new' }, 'Floor', r.floor) : h('span')))),
      h('div', { class: 'crm-row-actions' }, accept, dismiss));
  }
  return h('article', { class: ['crm-card', rule.active && 'is-active'] },
    h('div', { class: 'crm-card-head' }, h('h3', {}, rule.label), status), ...body);
}

// --- Insights tab: channel milestones ---------------------------------------------------------------
function milestoneCards(ms, data, onRefresh) {
  const cards = [];
  const when = (d) => (d ? fmtDate(d, { year: true }) : 'Not on the current trend');
  const sub = ms.subscribers;
  cards.push(h('article', { class: 'crm-card' },
    h('div', { class: 'crm-card-head' }, h('h3', {}, 'Subscribers'), sub ? h('span', { class: 'crm-num crm-big' }, num.format(sub.current)) : null),
    sub ? [
      h('p', { class: 'crm-muted' }, `${sub.exact ? 'Exact' : 'Rounded'} count as of ${fmtDate(sub.asOf, { year: true })}${sub.perMonth != null ? ` · about ${num.format(sub.perMonth)} net a month` : ''}`),
      h('ul', { class: 'crm-milestones' }, sub.next.map((m) => h('li', {}, h('strong', {}, num.format(m.milestone)), h('span', {}, when(m.date))))),
      sub.method ? h('p', { class: 'crm-method' }, `Method: ${sub.method}`) : null,
    ] : h('p', { class: 'crm-muted' }, 'No subscriber count yet. Refresh the channel stats.')));

  const mv = ms.monthlyViews;
  const series = (data.daily || []).filter((d) => d.views != null).slice(-90);
  cards.push(h('article', { class: 'crm-card' },
    h('div', { class: 'crm-card-head' }, h('h3', {}, 'Monthly views'), mv ? h('span', { class: 'crm-num crm-big' }, num.format(mv.last30)) : null),
    mv ? [
      h('p', { class: 'crm-muted' }, `Last 30 days · trend now ${num.format(mv.trendNow)} a month${mv.perMonthChange != null ? `, ${mv.perMonthChange >= 0 ? 'up' : 'down'} about ${num.format(Math.abs(mv.perMonthChange))} a month` : ''}`),
      series.length > 1 ? trendChart({
        points: series.map((d) => ({ v: d.views, label: fmtDate(d.day) })),
        fit: fitLine(series.map((d, i) => [i, d.views])),
        label: `Daily views, ${series[0].day} to ${series[series.length - 1].day}, with the straight-line trend used for the projection`,
      }) : null,
      h('ul', { class: 'crm-milestones' }, mv.next.map((m) => h('li', {}, h('strong', {}, `${num.format(m.milestone)} a month`), h('span', {}, when(m.date))))),
      h('p', { class: 'crm-method' }, `Method: ${mv.method}`),
    ] : h('p', { class: 'crm-muted' }, 'Needs at least 28 days of daily views. Refresh the channel stats.')));

  const src = data.channel ? `Stats as of ${fmtDate(data.channel.asOf, { year: true })} (${data.channel.source === 'action' ? 'private history from the stats Action' : 'public stats file'}).` : 'No channel stats yet.';
  const refresh = button('Refresh channel stats', async () => { await busy(refresh, () => request('POST', 'stats/refresh')); onRefresh(); }, { kind: 'chip' });
  return [h('div', { class: 'crm-cards' }, cards), h('div', { class: 'crm-row-actions' }, h('span', { class: 'crm-muted' }, src), refresh)];
}

// --- Insights tab: go full-time ----------------------------------------------------------------------
function financeForm(finance, onSaved) {
  const f = finance || {};
  const field = (name, label, value, { hint, type = 'number', step = '1' } = {}) => {
    const input = h('input', { name, type, min: 0, step, value: value ?? '', inputmode: 'decimal' });
    return { input, el: h('label', { class: 'crm-field' }, label, input, hint ? h('span', { class: 'crm-field-hint' }, hint) : null) };
  };
  const fields = {
    takeHome: field('takeHome', 'Take-home pay a month ($)', f.takeHome, { hint: 'What the day job pays you after tax.' }),
    expenses: field('expenses', 'Personal expenses a month ($)', f.expenses),
    savings: field('savings', 'Savings ($)', f.savings),
    taxPct: field('taxPct', 'Tax set-aside (%)', f.taxPct ?? 28, { hint: 'Income plus self-employment tax. The plan suggests 25–30%; a CPA can size it.' }),
    healthMonthly: field('healthMonthly', 'Health insurance a month ($)', f.healthMonthly, { hint: 'Added to the target.' }),
  };
  const priced = h('input', { type: 'checkbox', checked: f.healthPriced === true });
  const note = h('input', { type: 'text', maxlength: 200, value: f.healthNote || '', placeholder: 'Plan name or quote' });
  const save = button('Save', async () => {
    const value = Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, x.input.value === '' ? null : Number(x.input.value)]));
    value.healthPriced = priced.checked;
    value.healthNote = note.value.trim() || null;
    await busy(save, () => request('PUT', 'settings/finance', { value }));
    toast('Saved', { kind: 'ok', ms: 2500 });
    onSaved();
  }, { kind: 'primary' });
  return h('details', { class: 'crm-finance', open: !finance || finance.takeHome == null },
    h('summary', {}, 'Your numbers'),
    h('p', { class: 'crm-note is-muted' }, 'Private: stored only in the CRM database behind your password. Target = (take-home + health insurance) ÷ (1 − tax set-aside).'),
    h('div', { class: 'crm-form-grid' }, Object.values(fields).map((x) => x.el),
      h('label', { class: 'crm-field crm-check' }, priced, 'Health-insurance plan priced'),
      h('label', { class: 'crm-field' }, 'Plan or quote', note)),
    h('div', { class: 'crm-row-actions' }, save));
}

function incomeTable(ft, onSaved) {
  const months = ft.months.slice(-12).reverse();
  const cell = (m, src) => {
    const input = h('input', {
      type: 'text', inputmode: 'decimal', value: m[src] ? String(m[src]) : '', placeholder: '0', 'aria-label': `${INCOME_LABELS[src]}, ${fmtMonth(m.month)}`,
      onchange: async (e) => {
        const raw = e.target.value.trim();
        try {
          await request('PUT', 'income', { month: m.month, source: src, amount: raw === '' ? null : raw });
          toast(`${INCOME_LABELS[src]} for ${fmtMonth(m.month)} saved`, { kind: 'ok', ms: 2000 });
          onSaved();
        } catch (err) { toastError(err); }
      },
    });
    return h('td', {}, input);
  };
  return h('div', { class: 'crm-table-wrap' }, h('table', { class: 'crm-table is-compact crm-income' },
    h('thead', {}, h('tr', {}, ['Month', 'Paid deals', ...INCOME_SOURCES_ENTERED.map((s) => INCOME_LABELS[s]), 'Total'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, months.map((m) => h('tr', {},
      h('th', { scope: 'row' }, fmtMonth(m.month), m.partial ? h('span', { class: 'crm-muted' }, ' (so far)') : null),
      h('td', { class: 'crm-num', title: 'From Payments (paid date)' }, fmtMoney(m.deals)),
      INCOME_SOURCES_ENTERED.map((src) => cell(m, src)),
      h('td', { class: ['crm-num', ft.target && m.total >= ft.target && 'is-good'] }, fmtMoney(m.total)))))));
}

function fullTimeSection(ft, finance, onSaved) {
  const tiles = h('div', { class: 'crm-tiles is-3' },
    h('div', { class: 'crm-tile' }, h('span', { class: 'crm-tile-label' }, 'Monthly target'), h('span', { class: 'crm-tile-value' }, ft.target != null ? fmtMoney(ft.target) : '—'),
      h('span', { class: 'crm-tile-sub' }, ft.target != null ? `${fmtMoney(finance.takeHome)} take-home${finance.healthMonthly ? ` + ${fmtMoney(finance.healthMonthly)} insurance` : ''}, ${finance.taxPct}% set aside` : 'Add your numbers below')),
    h('div', { class: 'crm-tile' }, h('span', { class: 'crm-tile-label' }, '6-month average'), h('span', { class: 'crm-tile-value' }, ft.trailing != null ? fmtMoney(ft.trailing) : '—'),
      h('span', { class: 'crm-tile-sub' }, ft.target && ft.trailing != null ? `${Math.round((ft.trailing / ft.target) * 100)}% of target` : 'Last six complete months')),
    h('div', { class: ['crm-tile', ft.atTarget >= ft.goalMonths && 'is-good'] }, h('span', { class: 'crm-tile-label' }, 'Months at target'), h('span', { class: 'crm-tile-value' }, `${ft.atTarget} / ${ft.goalMonths}`),
      h('span', { class: 'crm-tile-sub' }, 'In a row, ending last month')));

  let proj = null;
  if (ft.projection) {
    const p = ft.projection;
    proj = h('p', { class: 'crm-projection' },
      p.reached ? 'The six-month average is at the target.'
        : p.month ? `At the current growth (${p.perMonth >= 0 ? '+' : ''}${fmtMoney(p.perMonth)} a month), the six-month average reaches the target around ${fmtMonth(p.month)}.`
          : `At the current growth (${fmtMoney(p.perMonth)} a month), the average doesn’t reach the target.`,
      h('span', { class: 'crm-method' }, ` Method: a straight line through the last ${p.basis} complete months of income, extended until the six-month average reaches the target.`));
  } else if (ft.target != null) {
    proj = h('p', { class: 'crm-muted' }, 'A projection needs at least three complete months, two with income.');
  }

  const scen = ft.scenarios.length ? h('div', { class: 'crm-table-wrap' }, h('table', { class: 'crm-table is-compact' },
    h('thead', {}, h('tr', {}, ['Plan scenario', 'Last point', 'Reaches your target', 'Note'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, ft.scenarios.map((sc) => {
      const last = sc.points[sc.points.length - 1];
      return h('tr', {}, h('th', { scope: 'row' }, sc.name), h('td', { class: 'crm-num' }, `${fmtMoney(last.total)} · ${fmtMonth(last.month)}`),
        h('td', {}, sc.reachesTarget ? fmtMonth(sc.reachesTarget) : 'After its last point'), h('td', { class: 'crm-muted' }, sc.note || ''));
    })))) : h('p', { class: 'crm-muted' }, 'The plan’s scenarios come from the plan file (Settings → Plan).');

  const sv = ft.savings;
  const savings = sv ? h('div', { class: 'crm-savings' },
    h('p', {}, h('strong', {}, `${sv.months.toFixed(1)} months`), ` of expenses saved (${fmtMoney(sv.amount)} of ${fmtMoney(sv.goalAmounts[0])}–${fmtMoney(sv.goalAmounts[1])})`),
    goalBar(sv.amount, [{ label: '6 months', at: sv.goalAmounts[0] }, { label: '12 months', at: sv.goalAmounts[1] }], sv.goalAmounts[1]))
    : h('p', { class: 'crm-muted' }, 'Add savings and monthly expenses to track the cushion.');

  return [
    h('ul', { class: 'crm-checks' }, ft.checks.map((c) => h('li', { class: c.done ? 'is-ok' : '' }, c.label, c.done ? ' · done' : ''))),
    tiles,
    incomeChart({ months: ft.months, sources: INCOME_SOURCES, labels: INCOME_LABELS, target: ft.target, scenarios: ft.scenarios }),
    proj,
    h('h3', { class: 'crm-subhead' }, 'Savings and health insurance'), savings,
    finance && finance.healthMonthly != null ? h('p', {}, `Health insurance: ${fmtMoney(finance.healthMonthly)} a month${finance.healthPriced ? ', priced' : ', estimate'}${finance.healthNote ? ` · ${finance.healthNote}` : ''}`) : null,
    h('h3', { class: 'crm-subhead' }, 'Plan scenarios'), scen,
    h('h3', { class: 'crm-subhead' }, 'Income by month'),
    h('p', { class: 'crm-note is-muted' }, 'Paid deals come from Payments (by paid date). Enter AdSense, affiliates, memberships and other income each month; the YouTube connection can’t read revenue.'),
    incomeTable(ft, onSaved),
    financeForm(finance, onSaved),
  ];
}

// --- The Insights tab ---------------------------------------------------------------------------
export function insightsView(root) {
  let data = null;
  const render = () => {
    if (!data) { root.replaceChildren(h('p', { class: 'crm-muted' }, 'Loading…')); return; }
    const x = allInsights(store.state, data, today());
    const refresh = async (full = false) => { invalidateInsights(); if (full) await reload(); data = await insightData({ force: true }); render(); };
    root.replaceChildren(
      h('div', { class: 'crm-view-head' }, h('h1', { class: 'crm-view-title' }, 'Insights', h('span', { class: 'crm-view-ja', lang: 'ja' }, '見通し'))),
      section('Rate check', h('p', { class: 'crm-note is-muted' }, 'The plan’s three rules for raising rates. When one triggers, accept the suggested rates into the rate card or dismiss it for 30 days.'),
        h('div', { class: 'crm-cards' }, x.rateRules.map((r) => rateCard(r, (changed) => refresh(changed))))),
      section('Channel milestones', ...milestoneCards(x.milestones, data, () => refresh())),
      section('Tracked links',
        h('p', { class: 'crm-note is-muted' }, 'Short links for video descriptions (jareddesu.com/go/…). Only click counts are kept. Add one from a deal.'),
        (store.state.links || []).filter((l) => !l.archived).length
          ? h('ul', { class: 'crm-mini-list' }, store.state.links.filter((l) => !l.archived).map((l) => linkRow(l, { onOpen: (x) => openLink(x) })))
          : h('p', { class: 'crm-muted' }, 'No tracked links yet.'),
        button('New tracked link', () => openLink(null), { kind: 'chip' })),
      section('Go full-time', ...fullTimeSection(x.fullTime, data.finance, () => refresh())),
    );
  };
  render();
  insightData().then((d) => { data = d; render(); }).catch((err) => root.replaceChildren(h('p', { class: 'crm-note is-error' }, err.message)));
  return render;
}

