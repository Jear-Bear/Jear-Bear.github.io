// about.js — live subscriber counter in the bio
// Reads the daily-updated count from data/sponsorships/stats.public.json and
// counts up to it when the bio scrolls into view.
(function () {
  const el = document.querySelector('[data-live-subscribers]');
  const num = el && el.querySelector('.live-count-num');
  if (!num || !window.SponsorData) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  function countTo(target) {
    if (reduceMotion) { num.textContent = fmt(target); return; }
    const from = Math.round(target * 0.8);
    const duration = 1600;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);   // ease-out cubic
    (function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      num.textContent = fmt(from + (target - from) * ease(t));
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  }

  window.SponsorData.load({ content: false })
    .then(({ stats }) => {
      const m = stats.metrics.subscribers;
      if (!window.SponsorData.hasValue(m)) return;
      el.title = `YouTube subscribers · ${window.SponsorData.formatPeriod(m.period)}`;
      el.classList.add('is-live');

      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        countTo(m.value);
      }, { threshold: 1 });
      observer.observe(el);
    })
    .catch((err) => console.error('Subscriber count failed to load:', err));
})();
