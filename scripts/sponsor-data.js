// =====================================================================
// sponsor-data.js — shared data layer for sponsor pages
//
// Loads data/sponsorships/stats.public.json (written daily by the
// sponsor-stats Action), applies data/sponsorships/overrides.json (manual
// values win), and exposes formatting helpers. The public page and the
// About counter use it today; a future sponsor dashboard can call
// SponsorData.load({ statsUrl }) with a private stats file instead.
//
// Every metric is { value, unit, label, period: { start, end, display },
// source, asOf }.
// =====================================================================

window.SponsorData = (function () {
  const BASE = '/data/sponsorships/';

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  // Keys starting with "_" are notes for humans, never data
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    Object.keys(obj).forEach((k) => {
      if (!k.startsWith('_')) out[k] = clean(obj[k]);
    });
    return out;
  }

  const hasValue = (m) => m && m.value !== null && m.value !== undefined && m.value !== '';

  // Manual metrics with a value replace the same key; null values are ignored
  function applyOverrides(stats, overrides) {
    const merged = clean(stats || {});
    merged.metrics = merged.metrics || {};
    merged.videos = merged.videos || {};
    const o = clean(overrides || {});

    Object.entries(o.metrics || {}).forEach(([key, m]) => {
      if (hasValue(m)) merged.metrics[key] = m;
    });

    Object.entries(o.videos || {}).forEach(([id, metrics]) => {
      Object.entries(metrics || {}).forEach(([key, m]) => {
        if (!hasValue(m)) return;
        const video = (merged.videos[id] = merged.videos[id] || { id, metrics: {} });
        video.metrics = video.metrics || {};
        video.metrics[key] = m;
      });
    });

    return merged;
  }

  async function load(opts = {}) {
    const statsUrl = opts.statsUrl || BASE + 'stats.public.json';
    const overridesUrl = opts.overridesUrl || BASE + 'overrides.json';
    const contentUrl = opts.contentUrl || BASE + 'content.json';

    const [stats, overrides, content] = await Promise.all([
      getJSON(statsUrl),
      getJSON(overridesUrl).catch(() => ({})),   // overrides are optional
      opts.content === false ? null : getJSON(contentUrl).then(clean),
    ]);

    return { stats: applyOverrides(stats, overrides), content };
  }

  // --- Formatting -------------------------------------------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return { y, m: m - 1, d };
  }

  function formatDate(iso) {
    const p = parseDate(iso);
    return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : '';
  }

  function formatRange(start, end) {
    const a = parseDate(start);
    const b = parseDate(end);
    if (!a && !b) return '';
    if (!a) return `As of ${formatDate(end)}`;
    if (!b) return `Since ${formatDate(start)}`;
    if (a.y !== b.y) return `${formatDate(start)}–${formatDate(end)}`;
    if (a.m !== b.m) return `${MONTHS[a.m]} ${a.d}–${MONTHS[b.m]} ${b.d}, ${b.y}`;
    return `${MONTHS[a.m]} ${a.d}–${b.d}, ${b.y}`;
  }

  function addDays(iso, days) {
    const p = parseDate(iso);
    const t = new Date(Date.UTC(p.y, p.m, p.d + days));
    return t.toISOString().slice(0, 10);
  }

  // Period text shown under every number. A "first N days" period gets its
  // exact dates once the video's publish date is known.
  function formatPeriod(period, video) {
    if (!period) return '';
    if (period.daysAfterPublish && video && video.publishedAt) {
      const start = String(video.publishedAt).slice(0, 10);
      return formatRange(start, addDays(start, period.daysAfterPublish - 1));
    }
    return period.display || formatRange(period.start, period.end);
  }

  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  function formatValue(metric) {
    if (!hasValue(metric)) return '';
    const v = metric.value;
    switch (metric.unit) {
      case 'percent': return `${Math.round(v * 100)}%`;
      case 'hours': return `${compact.format(v)} hrs`;
      case 'text': return String(v);
      default: return typeof v === 'number' ? compact.format(v) : String(v);
    }
  }

  return { load, applyOverrides, hasValue, formatValue, formatPeriod, formatDate, formatRange };
})();
