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
