// charts.js — small inline-SVG charts for the Sponsor desk, in the style of
// scripts/sponsor-charts.js: hairline grid, ink text, the page accent for
// marks. No libraries. Labels go in as text, never HTML; every chart has a
// text alternative (an aria-label and a table or list next to it).

import { h, fmtMoney, fmtMonth } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  kids.flat().forEach((c) => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].find((n) => n * p >= v) * p;
}

const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// --- Weekly goal ring ------------------------------------------------------------------------
export function ring(value, target, { size = 76, label } = {}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const met = target > 0 && value >= target;
  return h('div', { class: ['crm-ring', met && 'is-met'] },
    s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': label || `${value} of ${target}` },
      s('circle', { cx: size / 2, cy: size / 2, r, class: 'crm-ring-track' }),
      s('circle', {
        cx: size / 2, cy: size / 2, r, class: 'crm-ring-fill',
        'stroke-dasharray': `${(c * pct).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})`,
      })),
    h('span', { class: 'crm-ring-text', 'aria-hidden': 'true' }, h('strong', {}, value), ` / ${target}`));
}

// --- Monthly income: stacked bars, target line, trailing average, scenarios ----------------------
export const SOURCE_CLASS = { deals: 'src-deals', adsense: 'src-adsense', affiliates: 'src-affiliates', memberships: 'src-memberships', other: 'src-other' };

export function incomeChart({ months, sources, labels, target, scenarios = [] }) {
  const frame = h('div', { class: 'crm-chart-frame' });
  const allMonths = [...new Set([...months.map((m) => m.month), ...scenarios.flatMap((sc) => sc.points.map((p) => p.month))])].sort();
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const maxVal = Math.max(1, target || 0, ...months.map((m) => m.total), ...scenarios.flatMap((sc) => sc.points.map((p) => p.total)));

  const draw = () => {
    const W = Math.max(300, frame.clientWidth || 640);
    const H = W < 520 ? 220 : 260;
    const pad = { l: 44, r: 8, t: 12, b: 24 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const max = niceMax(maxVal);
    const n = allMonths.length;
    const step = iw / n;
    const bw = Math.max(4, Math.min(28, step * 0.62));
    const x = (i) => pad.l + step * i + step / 2;
    const y = (v) => pad.t + ih - (v / max) * ih;
    const svg = s('svg', {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
      'aria-label': `Monthly creator income by source${target ? ` against a target of ${fmtMoney(target)} a month` : ''}. The table below has the numbers.`,
    });
    [0, max / 2, max].forEach((v) => {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-gridline' }));
      svg.append(s('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, `$${compact.format(v)}`));
    });
    const every = n > 18 ? 3 : n > 10 ? 2 : 1;
    allMonths.forEach((m, i) => {
      if (i % every === 0 || i === n - 1) {
        const mo = +m.slice(5, 7);
        svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'chart-axis' }, mo === 1 || i === 0 ? `${MONTH_ABBR[mo - 1]} ’${m.slice(2, 4)}` : MONTH_ABBR[mo - 1]));
      }
      const row = byMonth.get(m);
      if (!row) return;
      let acc = 0;
      sources.forEach((src) => {
        const v = row[src] || 0;
        if (v <= 0) return;
        svg.append(s('rect', {
          x: x(i) - bw / 2, y: y(acc + v), width: bw, height: Math.max(0.5, y(acc) - y(acc + v)),
          class: ['crm-bar', SOURCE_CLASS[src], row.partial ? 'is-partial' : ''].join(' '),
        }, s('title', {}, `${fmtMonth(m)} · ${labels[src]}: ${fmtMoney(v)}${row.partial ? ' (month in progress)' : ''}`)));
        acc += v;
      });
    });
    // Trailing six-month average
    const tr = allMonths.map((m, i) => [i, byMonth.get(m) && byMonth.get(m).trailing]).filter(([, v]) => v != null);
    if (tr.length > 1) svg.append(s('path', { d: `M${tr.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')}`, class: 'crm-line-trailing' }));
    // Plan scenarios (dashed)
    scenarios.forEach((sc, k) => {
      const pts = sc.points.map((p) => [allMonths.indexOf(p.month), p.total]).filter(([i]) => i >= 0);
      if (pts.length < 2) return;
      svg.append(s('path', { d: `M${pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')}`, class: `crm-line-scenario sc-${k}` }, s('title', {}, `${sc.name} scenario (from the plan)`)));
    });
    if (target) {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(target), y2: y(target), class: 'crm-line-target' }));
      svg.append(s('text', { x: W - pad.r, y: y(target) - 5, 'text-anchor': 'end', class: 'chart-axis crm-target-label' }, `Target ${fmtMoney(target)}`));
    }
    frame.replaceChildren(svg);
  };
  requestAnimationFrame(draw);
  let last = 0;
  const ro = new ResizeObserver(() => { const w = frame.clientWidth; if (Math.abs(w - last) > 8) { last = w; draw(); } });
  ro.observe(frame);

  const legend = h('ul', { class: 'crm-legend' },
    sources.map((src) => h('li', {}, h('span', { class: ['crm-swatch', SOURCE_CLASS[src]] }), labels[src])),
    h('li', {}, h('span', { class: 'crm-swatch is-line-trailing' }), '6-month average'),
    target ? h('li', {}, h('span', { class: 'crm-swatch is-line-target' }), 'Target') : null,
    scenarios.map((sc, k) => h('li', {}, h('span', { class: `crm-swatch is-line-scenario sc-${k}` }), `${sc.name} (plan)`)));
  return h('div', { class: 'crm-chart' }, frame, legend);
}

// --- A daily series with its trend line ---------------------------------------------------------
export function trendChart({ points, fit, label, format = (v) => compact.format(v) }) {
  const frame = h('div', { class: 'crm-chart-frame is-small' });
  const draw = () => {
    const W = Math.max(260, frame.clientWidth || 480);
    const H = 120;
    const pad = { l: 36, r: 6, t: 8, b: 18 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const max = niceMax(Math.max(1, ...points.map((p) => p.v)));
    const n = points.length;
    const x = (i) => pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
    const y = (v) => pad.t + ih - (Math.max(0, v) / max) * ih;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': label });
    [0, max].forEach((v) => {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-gridline' }));
      svg.append(s('text', { x: pad.l - 5, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, format(v)));
    });
    if (n) {
      svg.append(s('text', { x: pad.l, y: H - 4, class: 'chart-axis' }, points[0].label));
      svg.append(s('text', { x: W - pad.r, y: H - 4, 'text-anchor': 'end', class: 'chart-axis' }, points[n - 1].label));
      svg.append(s('path', { d: `M${points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' L')}`, class: 'chart-line' }));
    }
    if (fit && n > 1) svg.append(s('line', { x1: x(0), y1: y(fit.a), x2: x(n - 1), y2: y(fit.a + fit.b * (n - 1)), class: 'crm-line-fit' }));
    frame.replaceChildren(svg);
  };
  requestAnimationFrame(draw);
  let last = 0;
  new ResizeObserver(() => { const w = frame.clientWidth; if (Math.abs(w - last) > 8) { last = w; draw(); } }).observe(frame);
  return frame;
}

// --- Progress bar with goal marks (savings) -------------------------------------------------
export function goalBar(value, marks, max) {
  const top = Math.max(max, value, ...marks.map((m) => m.at)) || 1;
  const fill = h('span', { class: 'crm-goal-fill' });
  fill.setAttribute('data-w', String(Math.round((value / top) * 100)));
  const bar = h('div', { class: 'crm-goal', role: 'img', 'aria-label': marks.map((m) => `${m.label} at ${fmtMoney(m.at)}`).join(', ') },
    fill, marks.map((m) => {
      const tick = h('span', { class: 'crm-goal-mark', title: m.label });
      tick.setAttribute('data-x', String(Math.round((m.at / top) * 100)));
      return tick;
    }));
  // Widths set through CSSOM (the CSP blocks inline style attributes, not this)
  requestAnimationFrame(() => {
    fill.style.width = `${fill.getAttribute('data-w')}%`;
    bar.querySelectorAll('.crm-goal-mark').forEach((t) => { t.style.left = `${t.getAttribute('data-x')}%`; });
  });
  return bar;
}
