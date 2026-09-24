// about.js — live subscriber count in the bio
// Reads the daily-updated count from data/sponsorships/stats.public.json.
(function () {
  const el = document.querySelector('[data-live-subscribers]');
  const num = el && el.querySelector('.live-count-num');
  if (!num || !window.SponsorData) return;

  window.SponsorData.load({ content: false })
    .then(({ stats }) => {
      const m = stats.metrics.subscribers;
      if (!window.SponsorData.hasValue(m)) return;
      el.title = `YouTube subscribers · ${window.SponsorData.formatPeriod(m.period)}`;
      num.textContent = Math.round(m.value).toLocaleString('en-US');
    })
    .catch((err) => console.error('Subscriber count failed to load:', err));
})();
