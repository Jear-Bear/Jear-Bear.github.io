/* partner.js — the current sponsor's card on the site (Ohanasi).
 *
 * Put a slot where the card should go; this fills it:
 *   <section data-partner="section" data-via="crossword"></section>   a page section with a card
 *   <li data-partner="entry" data-via="tools"></li>                   an entry in the tools list
 *   <div data-partner="card" data-via="guide-card"></div>             just the card
 *   <p data-partner="line" data-via="crossword-solved"></p>           one line, for a result screen
 * Any other link to the sponsor gets  data-go="ohanasi" data-via="<place>".
 *
 * Links go straight to the sponsor's own tracking link (fast, and it works
 * even if the counter is down). A click also sends a beacon to the sponsor
 * Worker, which adds one to that day's count for the place it came from
 * (no cookies, IPs or user agents are kept). See docs/sponsor-crm-setup.md.
 *
 * Keep the copy matched to what the link lands on (now: a free 1-on-1 lesson),
 * so people find what the card promised.
 *
 * Swapping or ending a sponsorship: change SPONSOR below, or set it to null
 * to hide every slot.
 */
(function () {
  var SPONSOR = {
    slug: 'ohanasi',                       // the tracked link's short name in the Sponsor desk
    href: 'https://ohanasi.co/jared',
    glyph: '話',
    en: {
      kicker: 'Sponsor · Ohanasi',
      title: 'Your first 1-on-1 Japanese lesson is free',
      body: 'Ohanasi gives you a free online lesson with a Japanese teacher (normally ¥3,850). Any level is welcome, even starting from zero. It’s run by the same people behind the free weekend exchanges I’ve joined. They only take 5 a day.',
      cta: 'Book your free lesson',
      fine: 'Ohanasi sponsors my channel.',
      section: 'Practice speaking',
      line: 'Want to use these words out loud? Ohanasi gives you a free 1-on-1 online lesson with a Japanese teacher, at any level.',
      lineCta: 'Book it free',
      tag: 'Sponsor',
      entryTitle: 'Ohanasi',
      entryDesc: 'The tools here get you reading. To speak, you need people: Ohanasi gives you a free 1-on-1 online lesson with a Japanese teacher (normally ¥3,850), at any level.',
      entryTags: ['sponsor', 'speaking', 'free lesson'],
      entryOpen: 'Book a free lesson',
    },
    ja: {
      kicker: 'スポンサー · Ohanasi',
      title: '1対1の日本語レッスンが初回無料',
      body: 'Ohanasiでは、日本人講師とのオンライン1対1レッスンを無料で受けられます（通常3,850円）。ゼロからの初心者も、どのレベルでも大丈夫。僕も参加したことがある無料の週末交流会と同じ運営です。1日5枠限定。',
      cta: '無料レッスンを予約する',
      fine: 'Ohanasiは僕のチャンネルのスポンサーです。',
      section: '話す練習',
      line: '覚えた言葉を使ってみたい？Ohanasiなら、日本人講師との1対1オンラインレッスンが無料で受けられます。',
      lineCta: '無料で予約',
      tag: 'スポンサー',
    },
  };
  var COUNT = 'https://sponsor-crm.jared-65b.workers.dev/public/click';
  var RE_VIA = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

  // --- counting -------------------------------------------------------------------
  function ping(slug, via) {
    via = String(via || 'site').toLowerCase();
    if (!RE_VIA.test(via)) via = 'site';
    var body = JSON.stringify({ slug: slug, via: via });
    try {   // text/plain: no CORS preflight, and the beacon survives the page unloading
      if (navigator.sendBeacon && navigator.sendBeacon(COUNT, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(COUNT, { method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) { /* ignore */ }
  }
  function onClick(e) {
    if (e.type === 'auxclick' && e.button !== 1) return;   // middle-click opens it too
    var a = e.target && e.target.closest && e.target.closest('a[data-go]');
    if (!a || a.dataset.counted === String(e.timeStamp)) return;
    a.dataset.counted = String(e.timeStamp);
    ping(a.dataset.go, a.dataset.via);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);

  // --- rendering ------------------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function link(via, cls, kids) {
    return el('a', { href: SPONSOR.href, class: cls, target: '_blank', rel: 'sponsored noopener', 'data-go': SPONSOR.slug, 'data-via': via }, kids);
  }
  function text() {
    var ja = document.documentElement.dataset.ui === 'ja';
    var t = {};
    Object.keys(SPONSOR.en).forEach(function (k) { t[k] = (ja && SPONSOR.ja[k]) || SPONSOR.en[k]; });
    t.lang = ja ? 'ja' : null;
    return t;
  }
  var arrow = function () { return el('span', { 'aria-hidden': 'true' }, [' →']); };

  function card(t, via) {
    return el('div', { class: 'pt-card', lang: t.lang }, [
      el('p', { class: 'pt-kicker' }, [t.kicker]),
      el('p', { class: 'pt-title' }, [t.title]),
      el('p', { class: 'pt-body' }, [t.body]),
      link(via, 'btn pt-cta', [t.cta, arrow()]),
      el('p', { class: 'pt-fine' }, [t.fine]),
    ]);
  }

  var RENDER = {
    card: function (slot, t, via) { slot.replaceChildren(card(t, via)); },
    section: function (slot, t, via) {   // set apart from the page's own sections: a labelled, tinted ad block
      slot.classList.remove('sec');
      slot.classList.add('pt-section');
      var c = card(t, via);
      c.classList.add('is-boxed');
      slot.replaceChildren(c);
    },
    entry: function (slot, t, via) {   // matches the tools list (styles/tools.css)
      slot.className = 'tool-entry is-partner';
      slot.style.setProperty('--tile-color', '#d9822b');
      slot.replaceChildren(link(via, 'tool-link', [
        el('span', { class: 'tool-glyph', lang: 'ja', 'aria-hidden': 'true' }, [SPONSOR.glyph]),
        el('span', { class: 'tool-body' }, [
          el('span', { class: 'tool-title' }, [SPONSOR.en.entryTitle]),
          el('span', { class: 'tool-desc' }, [SPONSOR.en.entryDesc]),
          el('span', { class: 'tool-tags' }, SPONSOR.en.entryTags.map(function (x) { return el('span', { class: 'tool-tag' }, [x]); })),
        ]),
        el('span', { class: 'tool-open' }, [SPONSOR.en.entryOpen, arrow()]),
      ]));
    },
    line: function (slot, t, via) {
      slot.classList.add('pt-line');
      if (t.lang) slot.setAttribute('lang', t.lang); else slot.removeAttribute('lang');
      slot.replaceChildren(el('span', { class: 'pt-tag' }, [t.tag]), ' ', t.line, ' ', link(via, 'pt-line-cta', [t.lineCta, arrow()]));
    },
  };

  function render() {
    document.querySelectorAll('[data-partner]').forEach(function (slot) {
      if (!SPONSOR) { slot.hidden = true; return; }
      var fn = RENDER[slot.dataset.partner];
      if (fn) { fn(slot, text(), slot.dataset.via || 'site'); slot.hidden = false; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
  // The games switch between English and Japanese without reloading
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui'] });
  window.jdPartner = { render: render };
})();
