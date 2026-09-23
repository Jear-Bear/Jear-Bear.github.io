// =====================================================================
// dashboard.js — sponsor dashboard at /sponsorships/dashboard/
//
// The private stats live in data/sponsorships/stats.private.enc.json,
// encrypted by the daily Action. The password never leaves the browser:
// it derives the key that decrypts the file here. Without it the page has
// nothing to show. All data is inserted as text, never HTML.
// =====================================================================

(function () {
  const SD = window.SponsorData;
  const gate = document.getElementById('gate');
  const dash = document.getElementById('dash');
  const form = document.getElementById('gate-form');
  const status = document.getElementById('gate-status');
  const submit = document.getElementById('gate-submit');
  const submitText = submit && submit.querySelector('.submit-text');
  if (!SD || !form || !window.crypto || !window.crypto.subtle) {
    if (status) status.textContent = 'This browser can\'t open the dashboard. Try an up-to-date Chrome, Safari, Firefox or Edge.';
    return;
  }

  // --- Tiny DOM helper --------------------------------------------------
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false || c === '') return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  // --- Labels for YouTube's codes -----------------------------------------
  const TRAFFIC = {
    YT_SEARCH: 'YouTube search', SUGGESTED: 'Suggested videos', RELATED_VIDEO: 'Suggested videos',
    BROWSE: 'Browse features', SUBSCRIBER: 'Subscription feed', SHORTS: 'Shorts feed',
    EXT_URL: 'External sites and apps', NO_LINK_OTHER: 'Direct or unknown', NO_LINK_EMBEDDED: 'Embedded players',
    PLAYLIST: 'Playlists', YT_PLAYLIST_PAGE: 'Playlist pages', YT_CHANNEL: 'Channel pages',
    NOTIFICATION: 'Notifications', END_SCREEN: 'End screens', ANNOTATION: 'Cards',
    CAMPAIGN_CARD: 'Campaign cards', YT_OTHER_PAGE: 'Other YouTube features', HASHTAGS: 'Hashtag pages',
    SOUND_PAGE: 'Sound pages', VIDEO_REMIXES: 'Remixes', LIVE_REDIRECT: 'Live redirects',
    PRODUCT_PAGE: 'Product pages', ADVERTISING: 'YouTube ads', IMMERSIVE_LIVE: 'Live feed',
  };
  const DEVICES = { MOBILE: 'Phone', DESKTOP: 'Computer', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Game console', UNKNOWN_PLATFORM: 'Unknown' };
  const SUBSCRIBED = { SUBSCRIBED: 'Subscribers', UNSUBSCRIBED: 'Not subscribed' };
  const GENDERS = { female: 'Female', male: 'Male', user_specified: 'User-specified' };
  const regionNames = (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { return null; }
  })();

  const titleCase = (code) => String(code).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const fromMap = (map) => (code) => map[code] || titleCase(code);
  const country = (code) => (code === 'GB' ? 'United Kingdom' : (regionNames && regionNames.of(code)) || code);
  const age = (code) => String(code).replace(/^age/, '').replace(/-$/, '+').replace('-', '–');

  // --- Bars: ranked shares, long tails folded into "Other" --------------
  function renderBars(key, metric, labelFn, maxRows = 6) {
    const panel = dash.querySelector(`[data-bars="${key}"]`);
    if (!panel) return;
    if (!SD.hasValue(metric) || !Array.isArray(metric.value) || !metric.value.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    let rows = metric.value.map((r) => ({ label: labelFn(r.code), share: r.share }));
    // Merge rows that map to the same label (e.g. two "Suggested videos" codes)
    const merged = {};
    rows.forEach((r) => { merged[r.label] = (merged[r.label] || 0) + r.share; });
    rows = Object.entries(merged).map(([label, share]) => ({ label, share }));
    if (key !== 'ages') rows.sort((a, b) => b.share - a.share);

    const listed = rows.reduce((s, r) => s + r.share, 0);
    let shown = rows;
    if (rows.length > maxRows) {
      shown = rows.slice(0, maxRows - 1);
      const rest = rows.slice(maxRows - 1).reduce((s, r) => s + r.share, 0);
      shown.push({ label: 'Other', share: rest, other: true });
    } else if (key === 'countries' && 1 - listed > 0.005) {
      shown.push({ label: 'Other', share: 1 - listed, other: true });
    }

    panel.replaceChildren(
      h('h3', { class: 'panel-title' }, metric.label),
      h('p', { class: 'panel-sub' }, `Share of views · ${SD.formatPeriod(metric.period)}`),
      h('ol', { class: 'bar-list' }, shown.map((r) => {
        const pct = `${Math.round(r.share * 100)}%`;
        return h('li', { class: 'bar-row' + (r.other ? ' is-other' : ''), title: `${r.label}: ${pct}` },
          h('span', { class: 'bar-label' }, r.label),
          h('span', { class: 'bar-track', 'aria-hidden': 'true' },
            h('span', { class: 'bar-fill', style: `width:${(r.share * 100).toFixed(1)}%` })),
          h('span', { class: 'bar-value' }, pct));
      }))
    );
  }

  // --- Overview cards ---------------------------------------------------
  function renderOverview(pub, priv) {
    const cards = [
      pub.metrics.subscribers, pub.metrics.viewsAllFormats, pub.metrics.longFormViews, pub.metrics.shortsViews,
      pub.metrics.watchTimeHours, pub.metrics.subscribersGained,
      priv.metrics.averageViewDuration, priv.metrics.averageViewPercentage,
    ].filter(SD.hasValue);

    document.getElementById('dash-overview').replaceChildren(...cards.map((m) =>
      h('div', { class: 'stat-card' },
        h('p', { class: 'stat-value' }, SD.formatValue(m)),
        h('p', { class: 'stat-label' }, m.label),
        h('p', { class: 'stat-period' }, SD.formatPeriod(m.period)))
    ));
  }

  // --- Featured videos table -------------------------------------------
  function renderVideos(pub, priv, content) {
    const tbody = document.querySelector('#video-table tbody');
    const ids = [];
    ((content && content.videoCategories) || []).forEach((c) => (c.videos || []).forEach((v) => {
      if (!ids.some((x) => x.id === v.id)) ids.push(v);
    }));

    let periodText = '';
    const rows = ids.map((entry) => {
      const pv = pub.videos[entry.id] || {};
      const pm = pv.metrics || {};
      const xm = (priv.videos[entry.id] || {}).metrics || {};
      if (!periodText && pm.recentViews && pm.recentViews.source !== 'manual') periodText = SD.formatPeriod(pm.recentViews.period);
      const cell = (m) => h('td', null, SD.hasValue(m) ? SD.formatValue(m) : '—');
      return h('tr', null,
        h('th', { scope: 'row' },
          h('a', { href: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`, target: '_blank', rel: 'noopener' },
            pv.title || entry.title)),
        cell(pm.recentViews), cell(xm.watchTimeHours), cell(xm.averageViewDuration), cell(xm.averageViewPercentage));
    });
    tbody.replaceChildren(...rows);
    document.getElementById('video-period').textContent = periodText ? `Last 90 days · ${periodText}` : 'Last 90 days';
  }

  function render(pub, priv, content) {
    document.getElementById('dash-updated').textContent = `Updated ${SD.formatDate(priv.generatedAt || pub.generatedAt)}`;
    renderOverview(pub, priv);
    renderBars('countries', pub.metrics.topCountries, country, 8);
    renderBars('ages', priv.metrics.ageGroups, age, 8);
    renderBars('genders', priv.metrics.genders, fromMap(GENDERS), 4);
    renderBars('subscribed', priv.metrics.subscribedStatus, fromMap(SUBSCRIBED), 3);
    renderBars('traffic', priv.metrics.trafficSources, fromMap(TRAFFIC), 8);
    renderBars('devices', priv.metrics.deviceTypes, fromMap(DEVICES), 5);
    renderVideos(pub, priv, content);
  }

  // --- Unlock / lock ------------------------------------------------------
  function setBusy(busy) {
    submit.disabled = busy;
    if (submitText) submitText.textContent = busy ? 'Unlocking…' : 'Open dashboard';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('gate-password');
    const password = input.value;
    if (!password) return;
    setBusy(true);
    status.textContent = '';

    try {
      const [priv, { stats: pub, content }] = await Promise.all([SD.loadPrivate(password), SD.load()]);
      if (!priv) {
        status.textContent = 'The dashboard hasn\'t been generated yet. It appears after the first daily update.';
        return;
      }
      input.value = '';
      render(pub, priv, content);
      gate.hidden = true;
      dash.hidden = false;
      window.scrollTo(0, 0);
    } catch (err) {
      status.textContent = err.code === 'WRONG_PASSWORD'
        ? 'That password didn\'t work.'
        : 'Something went wrong loading the dashboard. Try again in a minute.';
      if (err.code !== 'WRONG_PASSWORD') console.error(err);
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('dash-lock').addEventListener('click', () => {
    // Drop everything decrypted from the page
    dash.querySelectorAll('[data-bars]').forEach((p) => p.replaceChildren());
    document.getElementById('dash-overview').replaceChildren();
    document.querySelector('#video-table tbody').replaceChildren();
    dash.hidden = true;
    gate.hidden = false;
    document.getElementById('gate-password').focus();
  });
})();
