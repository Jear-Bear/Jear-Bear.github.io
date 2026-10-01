// =====================================================================
// JaredDesu.com — shared site behavior
// =====================================================================

// Scroll reveals were retired with the redesign. Scripts that render
// content later still call this; it has nothing left to do.
window.observeReveal = function () {};

// --- Mobile menu (masthead) ---------------------------------------------
(function initMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const sheet = document.getElementById('site-menu');
  if (!toggle || !sheet) return;
  const close = sheet.querySelector('.menu-close');

  function open() {
    sheet.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    (sheet.querySelector('nav a') || close).focus();
  }
  function shut() {
    sheet.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    toggle.focus();
  }

  toggle.addEventListener('click', open);
  if (close) close.addEventListener('click', shut);
  sheet.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
    sheet.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) shut(); });
})();

// --- Old navbar menu (pages not yet on the masthead) --------------------
(function initLegacyNav() {
  const burger = document.querySelector('.nav-burger');
  const mobileNav = document.querySelector('.nav-mobile');
  if (!burger || !mobileNav) return;
  burger.addEventListener('click', (e) => { e.stopPropagation(); mobileNav.classList.toggle('open'); });
  mobileNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => mobileNav.classList.remove('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') mobileNav.classList.remove('open'); });
})();

// --- Current page in the navigation --------------------------------------
(function markCurrent() {
  const path = window.location.pathname.replace(/\/$/, '').toLowerCase();
  document.querySelectorAll('.masthead-nav a, .menu-sheet a, .nav-links a, .nav-mobile a').forEach((link) => {
    const href = (link.getAttribute('href') || '').replace(/^(\.\.\/)+/, '/').replace(/\/$/, '').toLowerCase();
    if (href && href !== '/' && path.endsWith(href)) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
  });
})();

// --- Theme toggle: Auto (system) → Light → Dark ---------------------------
(function initTheme() {
  const api = window.jdTheme;
  if (!api) return;                                   // pages without the theme script stay light
  const ICONS = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };
  const NAMES = { auto: 'Auto (follows your device)', light: 'Light', dark: 'Dark' };
  const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  const buttons = [];
  const segs = [];

  function make() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-toggle';
    b.addEventListener('click', () => { api.set(NEXT[api.get()]); paint(); });
    buttons.push(b);
    return b;
  }
  function paint() {
    const pref = api.get();
    buttons.forEach((b) => {
      b.innerHTML = ICONS[pref] || ICONS.auto;
      b.setAttribute('aria-label', `Theme: ${NAMES[pref]}. Switch to ${NAMES[NEXT[pref]]}.`);
      b.title = `Theme: ${NAMES[pref]}`;
    });
    segs.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.pref === pref)));
  }

  // Desktop: the last item in the nav. Phones: beside the Menu button, and in the menu sheet.
  const navList = document.querySelector('.masthead-nav ul');
  if (navList) {
    const li = document.createElement('li');
    li.className = 'theme-li';
    li.append(make());
    navList.append(li);
  }
  const menuBtn = document.querySelector('.masthead > .menu-toggle');
  if (menuBtn) menuBtn.before(make());
  const sheetNav = document.querySelector('.menu-sheet nav');
  if (sheetNav) {
    const label = document.createElement('p');
    label.className = 'theme-seg-label';
    label.textContent = 'Theme / テーマ';
    const seg = document.createElement('div');
    seg.className = 'theme-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Theme');
    ['auto', 'light', 'dark'].forEach((pref) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.pref = pref;
      b.textContent = pref === 'auto' ? 'Auto' : pref === 'light' ? 'Light' : 'Dark';
      b.addEventListener('click', () => { api.set(pref); paint(); });
      segs.push(b);
      seg.append(b);
    });
    sheetNav.after(label, seg);
  }
  paint();
})();
