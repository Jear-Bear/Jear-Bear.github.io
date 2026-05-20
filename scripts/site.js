// =====================================================================
// JaredDesu.com — shared site behavior
// =====================================================================

// --- Scroll reveal -----------------------------------------------------
(function initReveal() {
  const reveals = document.querySelectorAll('.reveal, .reveal-bounce');
  if (!reveals.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
  );

  reveals.forEach((el) => observer.observe(el));
})();

// --- Mobile nav --------------------------------------------------------
(function initMobileNav() {
  const burger = document.querySelector('.nav-burger');
  const mobileNav = document.querySelector('.nav-mobile');
  if (!burger || !mobileNav) return;

  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileNav.classList.toggle('open');
  });

  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
  });

  document.addEventListener('click', (e) => {
    if (!mobileNav.contains(e.target) && !burger.contains(e.target)) {
      mobileNav.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') mobileNav.classList.remove('open');
  });
})();

// --- Active nav link highlighting --------------------------------------
(function initActiveLink() {
  const path = window.location.pathname.replace(/\/$/, '').toLowerCase();
  const allLinks = document.querySelectorAll('.nav-links a, .nav-mobile a');

  allLinks.forEach((link) => {
    const href = link.getAttribute('href') || '';
    const cleaned = href.replace(/^\.\.\//, '/').replace(/\/$/, '').toLowerCase();
    if (cleaned && path.endsWith(cleaned)) {
      link.classList.add('active');
    }
  });
})();
