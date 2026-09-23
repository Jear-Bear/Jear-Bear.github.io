// =====================================================================
// sponsor-charts.js — small inline-SVG charts for the sponsor pages
//
//   SponsorCharts.trend(el, metric)        daily line with hover/keyboard
//   SponsorCharts.sparkline(metric)        tiny line for a video card
//   SponsorCharts.mix(el, parts)           one bar split into formats
//   SponsorCharts.overview(stats, SD)      fills #trend-panel / #mix-panel
//
// No libraries. Marks use the page accent; text stays in ink tokens.
// All labels are inserted as text, never HTML.
// =====================================================================

window.SponsorCharts = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const full = new Intl.NumberFormat('en');

  function svg(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dayAt(start, i) {
    const [y, m, d] = start.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + i));
  }
  const shortDate = (dt) => `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  const longDate = (dt) => `${shortDate(dt)}, ${dt.getUTCFullYear()}`;

  // Round a max up to a clean axis value (1, 2, 2.5, 5 × 10^n)
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = [1, 2, 2.5, 5, 10].find((n) => n * p >= v);
    return f * p;
  }

  function summary(values, start) {
    const total = values.reduce((s, v) => s + v, 0);
    let peak = 0;
    values.forEach((v, i) => { if (v > values[peak]) peak = i; });
    return {
      avg: values.length ? total / values.length : 0,
      peak: values[peak] || 0,
      peakDate: dayAt(start, peak),
      total,
    };
  }

  // --- Trend: full-width daily line ------------------------------------
  function trend(container, metric) {
    const values = metric.value;
    const start = metric.period.start;
    const s = summary(values, start);

    container.replaceChildren();
    const head = el('div', 'chart-head');
    head.append(
      el('p', 'chart-kpi', `${compact.format(Math.round(s.avg))} a day on average`),
      el('p', 'chart-kpi-sub', `Peak ${compact.format(s.peak)} on ${shortDate(s.peakDate)}`)
    );
    const frame = el('div', 'chart-frame');
    const tip = el('div', 'chart-tip');
    tip.hidden = true;
    frame.append(tip);
    container.append(head, frame, table(values, start));

    let index = values.length - 1;
    let geom = null;

    function draw() {
      const W = Math.max(280, frame.clientWidth);
      const H = W < 480 ? 180 : 220;
      const pad = { l: 40, r: 10, t: 10, b: 24 };
      const iw = W - pad.l - pad.r;
      const ih = H - pad.t - pad.b;
      const max = niceMax(Math.max(...values));
      const x = (i) => pad.l + (values.length > 1 ? (i / (values.length - 1)) * iw : iw / 2);
      const y = (v) => pad.t + ih - (v / max) * ih;
      geom = { x, y, W, H, pad };

      const root = svg('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg',
        role: 'img', tabindex: '0',
        'aria-label': `${metric.label}, ${longDate(dayAt(start, 0))} to ${longDate(dayAt(start, values.length - 1))}. ` +
          `Average ${full.format(Math.round(s.avg))} a day, peak ${full.format(s.peak)} on ${longDate(s.peakDate)}. ` +
          'Use the left and right arrow keys to read each day.',
      });

      // Gridlines + y ticks (0, half, max)
      [0, max / 2, max].forEach((v) => {
        root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-gridline' }));
        const t = svg('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' });
        t.textContent = compact.format(v);
        root.append(t);
      });

      // X labels: first, middle, last day
      [0, Math.floor((values.length - 1) / 2), values.length - 1].forEach((i, k) => {
        const t = svg('text', {
          x: x(i), y: H - 6, class: 'chart-axis',
          'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle',
        });
        t.textContent = shortDate(dayAt(start, i));
        root.append(t);
      });

      const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      root.append(svg('path', {
        d: `M${x(0)},${y(0)} L${pts.join(' L')} L${x(values.length - 1)},${y(0)} Z`, class: 'chart-area',
      }));
      root.append(svg('path', { d: `M${pts.join(' L')}`, class: 'chart-line' }));

      // Hover layer: crosshair + dot, snapped to the nearest day
      const cross = svg('line', { y1: pad.t, y2: pad.t + ih, class: 'chart-cross', visibility: 'hidden' });
      const dot = svg('circle', { r: 4, class: 'chart-dot', visibility: 'hidden' });
      const endDot = svg('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 4, class: 'chart-dot' });
      const hit = svg('rect', { x: pad.l, y: 0, width: iw, height: H, fill: 'transparent' });
      root.append(cross, endDot, dot, hit);

      function show(i) {
        index = Math.max(0, Math.min(values.length - 1, i));
        const cx = x(index);
        const cy = y(values[index]);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
        cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        dot.setAttribute('visibility', 'visible');
        tip.replaceChildren(el('strong', null, `${full.format(values[index])} views`), el('span', null, longDate(dayAt(start, index))));
        tip.hidden = false;
        const tw = tip.offsetWidth;
        tip.style.left = `${Math.min(Math.max(cx - tw / 2, 0), W - tw)}px`;
        tip.style.top = `${Math.max(cy - tip.offsetHeight - 12, 0)}px`;
      }
      function hide() {
        cross.setAttribute('visibility', 'hidden');
        dot.setAttribute('visibility', 'hidden');
        tip.hidden = true;
      }

      hit.addEventListener('pointermove', (e) => {
        const r = root.getBoundingClientRect();
        const px = e.clientX - r.left;
        show(Math.round(((px - pad.l) / iw) * (values.length - 1)));
      });
      hit.addEventListener('pointerleave', hide);
      root.addEventListener('focus', () => show(index));
      root.addEventListener('blur', hide);
      root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { show(index - 1); e.preventDefault(); }
        if (e.key === 'ArrowRight') { show(index + 1); e.preventDefault(); }
        if (e.key === 'Home') { show(0); e.preventDefault(); }
        if (e.key === 'End') { show(values.length - 1); e.preventDefault(); }
      });

      frame.querySelector('svg') ? frame.querySelector('svg').replaceWith(root) : frame.prepend(root);
    }

    draw();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (geom && Math.abs(frame.clientWidth - geom.W) > 1) draw(); });
    });
    ro.observe(frame);
  }

  // Collapsed table so every value is reachable without hovering
  function table(values, start) {
    const details = el('details', 'chart-table');
    details.append(el('summary', null, 'Show daily numbers'));
    const wrap = el('div', 'chart-table-wrap');
    const t = el('table');
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', null, 'Date'), el('th', null, 'Views'));
    thead.append(hr);
    const tbody = el('tbody');
    values.forEach((v, i) => {
      const tr = el('tr');
      tr.append(el('td', null, longDate(dayAt(start, i))), el('td', null, full.format(v)));
      tbody.append(tr);
    });
    t.append(thead, tbody);
    wrap.append(t);
    details.append(wrap);
    return details;
  }

  // --- Sparkline: shape only, for video cards ---------------------------
  function sparkline(metric) {
    const values = metric.value;
    const start = metric.period.start;
    if (!values || values.length < 2) return null;
    const s = summary(values, start);
    const W = 200;
    const H = 32;
    const max = Math.max(...values) || 1;
    const x = (i) => (i / (values.length - 1)) * W;
    const y = (v) => 2 + (H - 4) * (1 - v / max);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);

    const root = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'sparkline', role: 'img',
      'aria-label': `Daily views from ${longDate(dayAt(start, 0))} to ${longDate(dayAt(start, values.length - 1))}: ` +
        `average ${full.format(Math.round(s.avg))} a day, ${full.format(values[values.length - 1])} on the last day.`,
    });
    const title = svg('title');
    title.textContent = `Daily views · avg ${compact.format(Math.round(s.avg))}/day`;
    root.append(title);
    root.append(svg('path', { d: `M0,${H} L${pts.join(' L')} L${W},${H} Z`, class: 'chart-area' }));
    root.append(svg('path', { d: `M${pts.join(' L')}`, class: 'chart-line', 'vector-effect': 'non-scaling-stroke' }));
    return root;
  }

  // --- Mix: one bar split by format -------------------------------------
  // parts: [{ label, value, color }] in a fixed order (never re-sorted)
  function mix(container, parts) {
    const total = parts.reduce((s, p) => s + p.value, 0);
    if (!total) return false;
    const bar = el('div', 'mix-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', '));
    const legend = el('ul', 'mix-legend');

    parts.forEach((p) => {
      const pct = p.value / total;
      if (pct > 0) {
        const seg = el('span', 'mix-seg');
        seg.style.flexGrow = String(p.value);
        seg.style.background = p.color;
        seg.title = `${p.label}: ${full.format(p.value)} views (${Math.round(pct * 100)}%)`;
        bar.append(seg);
      }
      const li = el('li');
      const key = el('span', 'mix-key');
      key.style.background = p.color;
      li.append(key, el('span', 'mix-label', p.label),
        el('span', 'mix-value', `${compact.format(p.value)} · ${pct > 0 && pct < 0.01 ? '<1' : Math.round(pct * 100)}%`));
      legend.append(li);
    });

    container.replaceChildren(bar, legend);
    return true;
  }

  // Format colors, fixed order (validated: light surface, CVD-separated;
  // live's low contrast is covered by the labelled legend)
  const FORMATS = [
    { key: 'longFormViews', label: 'Long-form', color: '#95483f' },
    { key: 'shortsViews', label: 'Shorts', color: '#3f7fb0' },
    { key: 'liveViews', label: 'Live', color: '#c9a227' },
  ];

  // Trend + format mix in the overview, on both the public page and dashboard.
  // Panels stay hidden until their data exists.
  function overview(stats, SD) {
    const wrap = document.getElementById('overview-charts');
    if (!wrap) return;
    const daily = stats.metrics.dailyViews;
    const trendPanel = document.getElementById('trend-panel');
    const hasTrend = Boolean(trendPanel && SD.hasValue(daily) && daily.value.length > 1);

    const mixPanel = document.getElementById('mix-panel');
    const parts = FORMATS
      .map((f) => ({ ...f, metric: stats.metrics[f.key] }))
      .filter((f) => SD.hasValue(f.metric))
      .map((f) => ({ label: f.label, color: f.color, value: f.metric.value, period: f.metric.period }));
    // Needs at least two formats from the same period, so a lone manual
    // long-form figure never reads as "100% long-form"
    const samePeriod = parts.every((p) => p.period && parts[0].period &&
      p.period.start === parts[0].period.start && p.period.end === parts[0].period.end);
    const hasMix = Boolean(mixPanel && parts.length >= 2 && samePeriod &&
      mix(document.getElementById('mix-chart'), parts));
    if (hasMix) document.getElementById('mix-period').textContent = SD.formatPeriod(parts[0].period);

    // Lay out first, then draw the trend so it measures its real column width
    if (trendPanel) trendPanel.hidden = !hasTrend;
    if (mixPanel) mixPanel.hidden = !hasMix;
    wrap.classList.toggle('has-trend', hasTrend && hasMix);
    wrap.hidden = !(hasTrend || hasMix);
    if (hasTrend) {
      document.getElementById('trend-period').textContent = SD.formatPeriod(daily.period);
      trend(document.getElementById('trend-chart'), daily);
    }
    if ((hasTrend || hasMix) && window.observeReveal) window.observeReveal(wrap);
  }

  return { trend, sparkline, mix, overview };
})();
