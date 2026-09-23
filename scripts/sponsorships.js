// =====================================================================
// sponsorships.js — renders /sponsorships/ from data/sponsorships/*.json
//
// The HTML carries crawlable copy and static fallbacks. Each
// [data-render="…"] container is replaced only when its data loads, so a
// failed fetch leaves the fallback in place. All data is inserted as text
// (never HTML): video titles come from YouTube.
// =====================================================================

(function () {
  const SD = window.SponsorData;

  // --- Tiny DOM helper --------------------------------------------------
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false || c === '') return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function fill(name, nodes) {
    const target = document.querySelector(`[data-render="${name}"]`);
    if (!target || !nodes || !nodes.length) return;
    target.replaceChildren(...nodes);
    if (window.observeReveal) window.observeReveal(target);
  }

  const has = SD.hasValue;
  const ytUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // --- Overview ---------------------------------------------------------
  function renderHeadline(stats, content) {
    const cards = (content.headlineStats || [])
      .map((key) => stats.metrics[key])
      .filter(has)
      .map((m) =>
        h('div', { class: 'stat-card reveal' },
          h('p', { class: 'stat-value' }, SD.formatValue(m)),
          h('p', { class: 'stat-label' }, m.label),
          h('p', { class: 'stat-period' }, SD.formatPeriod(m.period))
        )
      );
    fill('headline-stats', cards);
  }

  function renderUpdated(stats) {
    if (!stats.generatedAt) return;
    const source = stats.generatedBy === 'manual-seed'
      ? 'from a YouTube Studio export'
      : 'from YouTube, refreshed daily';
    fill('updated', [
      h('span', { class: 'data-dot', 'aria-hidden': 'true' }),
      `Updated ${SD.formatDate(stats.generatedAt)} · ${source}`,
    ]);
  }

  function renderPartners(content) {
    const partners = content.partners || [];
    if (!partners.length) return;
    const nodes = ['Past partners: '];
    partners.forEach((p, i) => {
      if (i) nodes.push(' · ');
      nodes.push(h('a', { href: '#partnerships' }, p.name));
    });
    fill('partners', nodes);
  }

  // --- Audience ---------------------------------------------------------
  function renderCountries(stats, content) {
    const m = stats.metrics.topCountries;
    const regions = (content.audience && content.audience.regions) || [];
    if (!has(m) || !Array.isArray(m.value) || !regions.length) return;

    const shareOf = Object.fromEntries(m.value.map((r) => [r.code, r.share]));
    const rows = regions
      .filter((r) => typeof shareOf[r.code] === 'number')
      .map((r) => ({ label: r.label, share: shareOf[r.code] }))
      .sort((a, b) => b.share - a.share);
    if (!rows.length) return;

    const shown = rows.reduce((sum, r) => sum + r.share, 0);
    const other = Math.max(0, 1 - shown);
    if (other > 0.005) rows.push({ label: 'Other', share: other, other: true });

    fill('countries', rows.map((r) => {
      const pct = `${Math.round(r.share * 100)}%`;
      return h('li', { class: 'bar-row' + (r.other ? ' is-other' : ''), title: `${r.label}: ${pct} of views` },
        h('span', { class: 'bar-label' }, r.label),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' },
          h('span', { class: 'bar-fill', style: `width:${(r.share * 100).toFixed(1)}%` })),
        h('span', { class: 'bar-value' }, pct)
      );
    }));

    const period = SD.formatPeriod(m.period);
    fill('countries-period', [`Share of views${period ? ' · ' + period : ''}`]);
  }

  function renderWho(stats, content) {
    const a = content.audience || {};
    const items = (a.whoTheyAre || []).map((t) => h('li', null, t));
    (a.whoMetrics || []).forEach((key) => {
      const m = stats.metrics[key];
      if (!has(m)) return;
      const period = SD.formatPeriod(m.period);
      items.push(h('li', { class: 'who-metric' },
        h('strong', null, `${m.label}: ${SD.formatValue(m)}`),
        period ? h('span', { class: 'stat-period' }, period) : null
      ));
    });
    fill('who', items);
    fill('interests', (a.interests || []).map((t) => h('li', null, t)));
  }

  // --- What performs ----------------------------------------------------
  function videoMetricLine(m, video) {
    if (!has(m)) return null;
    const period = SD.formatPeriod(m.period, video);
    return h('p', { class: 'video-stat' },
      h('span', { class: 'video-stat-value' }, `${SD.formatValue(m)} `),
      h('span', { class: 'video-stat-label' }, m.label.toLowerCase().startsWith('views') ? m.label.toLowerCase() : m.label),
      period ? h('span', { class: 'stat-period' }, period) : null
    );
  }

  function thumb(id) {
    const img = h('img', {
      src: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`,
      alt: '', width: 320, height: 180, loading: 'lazy', decoding: 'async',
    });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    return img;
  }

  function renderVideo(entry, stats) {
    const live = stats.videos[entry.id] || {};
    const metrics = live.metrics || {};
    const title = live.title || entry.title;
    const highlight = entry.highlight ? metrics[entry.highlight] : null;
    const lifetime = metrics.views;

    return h('li', { class: 'video' },
      h('a', { class: 'video-link', href: ytUrl(entry.id), target: '_blank', rel: 'noopener' },
        h('span', { class: 'video-thumb' }, thumb(entry.id)),
        h('span', { class: 'video-title' }, title)
      ),
      videoMetricLine(highlight, live),
      highlight !== lifetime ? videoMetricLine(lifetime, live) : null,
      live.publishedAt ? h('p', { class: 'video-published' }, `Published ${SD.formatDate(live.publishedAt)}`) : null
    );
  }

  function renderCategories(stats, content) {
    fill('categories', (content.videoCategories || []).map((cat) =>
      h('article', { class: 'category reveal' },
        h('div', { class: 'category-head' },
          h('h3', null, cat.title, cat.tag ? h('span', { class: 'category-tag' }, cat.tag) : null),
          cat.description ? h('p', null, cat.description) : null
        ),
        h('ul', { class: 'video-grid' }, (cat.videos || []).map((v) => renderVideo(v, stats)))
      )
    ));
  }

  // --- Past partnerships -------------------------------------------------
  function field(label, value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string' && /^\s*tbd\s*$/i.test(value)) return null;   // never show TBD
    return h('div', null, h('dt', null, label), h('dd', null, value));
  }

  function renderCaseStudies(stats, content) {
    fill('case-studies', (content.caseStudies || []).map((c) => {
      const live = (c.video && stats.videos[c.video.id]) || {};
      const views = c.showViews && live.metrics && live.metrics.views;
      const videoLink = c.video
        ? h('a', { href: ytUrl(c.video.id), target: '_blank', rel: 'noopener' }, live.title || c.video.title)
        : null;
      const viewsNode = has(views)
        ? h('span', null, `${SD.formatValue(views)} views `, h('span', { class: 'stat-period' }, SD.formatPeriod(views.period, live)))
        : null;

      return h('article', { class: 'case-card reveal' },
        h('h3', { class: 'case-partner' }, c.partner),
        h('dl', { class: 'case-fields' },
          field('Campaign', c.campaignType),
          field('Video', videoLink),
          field('Views', viewsNode),
          field('Audience action', c.audienceAction),
          field('Result', c.result),
          field('Why it worked', c.whyItWorked)
        )
      );
    }));
  }

  // --- Opportunities ----------------------------------------------------
  function activePackages(content) {
    const now = today();
    return (content.packages || []).filter((p) => !p.availableUntil || now <= p.availableUntil);
  }

  function renderPackages(content) {
    fill('packages', activePackages(content).map((p) =>
      h('article', { class: 'package-card reveal' + (p.featured ? ' is-featured' : '') },
        h('h3', null, p.name),
        typeof p.priceFrom === 'number'
          ? h('p', { class: 'package-price' }, h('span', null, 'From '), usd.format(p.priceFrom))
          : null,
        p.description ? h('p', { class: 'package-desc' }, p.description) : null,
        p.availableUntil
          ? h('p', { class: 'package-availability' }, `Available through ${SD.formatDate(p.availableUntil)}`)
          : null,
        p.includes && p.includes.length
          ? h('ul', { class: 'package-includes' }, p.includes.map((i) => h('li', null, i)))
          : null
      )
    ));
    if (content.packagesNote) fill('packages-note', [content.packagesNote]);
  }

  function renderDeliverables(content) {
    const names = activePackages(content).map((p) => p.name).concat('Something custom');
    fill('deliverables', names.map((n) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'deliverables', value: n }),
        h('span', null, n))
    ));
  }

  // --- Brand fit --------------------------------------------------------
  function renderBrandFit(content) {
    fill('brand-fit', (content.brandFit || []).map((t) => h('li', null, t)));
    const ex = content.brandFitExclusions || [];
    if (ex.length) {
      const list = ex.length > 1 ? `${ex.slice(0, -1).join(', ')} and ${ex[ex.length - 1]}` : ex[0];
      fill('brand-fit-exclusions', [`Not a fit: ${list}.`]);
    }
  }

  // --- Sticky section nav ------------------------------------------------
  (function initSectionNav() {
    const nav = document.querySelector('.section-nav');
    const navbar = document.querySelector('.navbar');
    if (!nav) return;
    const list = nav.querySelector('.section-nav-list');
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1)));
    let current = null;

    function setOffsets() {
      const navH = navbar ? navbar.offsetHeight : 64;
      document.documentElement.style.setProperty('--nav-h', `${navH}px`);
      document.documentElement.style.setProperty('--section-nav-h', `${nav.offsetHeight}px`);
    }

    function update() {
      const line = (navbar ? navbar.offsetHeight : 64) + nav.offsetHeight + 24;
      let idx = 0;
      sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= line) idx = i; });
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) idx = sections.length - 1;
      if (idx === current) return;
      current = idx;

      links.forEach((a, i) => {
        a.classList.toggle('active', i === idx);
        if (i === idx) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });

      // Keep the active chip visible when the list scrolls sideways (mobile)
      const a = links[idx];
      if (list.scrollWidth > list.clientWidth) {
        const left = a.offsetLeft - list.clientWidth / 2 + a.offsetWidth / 2;
        list.scrollTo({ left, behavior: 'smooth' });
      }
    }

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', () => { setOffsets(); update(); });

    setOffsets();
    update();
  })();

  // --- Load + render ------------------------------------------------------
  if (!SD) return;
  SD.load()
    .then(({ stats, content }) => {
      renderHeadline(stats, content);
      renderUpdated(stats);
      renderPartners(content);
      renderCountries(stats, content);
      renderWho(stats, content);
      renderCategories(stats, content);
      renderCaseStudies(stats, content);
      renderPackages(content);
      renderDeliverables(content);
      renderBrandFit(content);
    })
    .catch((err) => console.error('Sponsorship data failed to load; showing static content.', err));
})();
