// contact.js — delivers forms via Web3Forms (works on static hosting)
//
// Handles every <form data-web3forms>. Optional attributes:
//   data-subject  subject template; {field} is replaced by that field's value
//   data-success  status text after a successful send
// A field submitted more than once (e.g. checkboxes) is sent as one
// comma-separated value. A filled-in honeypot field ("website") drops the send.
(function () {
  const ACCESS_KEY = '7137a0ba-b831-4c6d-9f6c-3b04fffbae4c'; // free key from web3forms.com
  const DEFAULT_SUBJECT = 'New message from {name} — jareddesu.com';

  function fillTemplate(template, fd) {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(fd.get(key) || '').trim() || '—');
  }

  function collapseMulti(fd) {
    const out = new FormData();
    new Set(fd.keys()).forEach((key) => {
      out.append(key, fd.getAll(key).join(', '));
    });
    return out;
  }

  document.querySelectorAll('form[data-web3forms]').forEach((form) => {
    const btn = form.querySelector('[type="submit"]');
    const btnText = form.querySelector('.submit-text');
    const idleText = btnText ? btnText.textContent : '';
    const meta = form.querySelector('.form-meta');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const raw = new FormData(form);
      if (raw.get('website')) return;          // honeypot tripped → silently drop

      const fd = collapseMulti(raw);
      fd.delete('website');
      fd.append('access_key', ACCESS_KEY);
      fd.append('subject', fillTemplate(form.dataset.subject || DEFAULT_SUBJECT, fd));

      if (btnText) btnText.textContent = 'Sending…';
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: fd,
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        form.reset();
        if (btnText) btnText.textContent = 'Sent ✓';
        if (meta) meta.textContent = form.dataset.success || "Thanks — I'll reply within 48 hours.";
      } catch (err) {
        console.error('Contact form error:', err);
        if (btnText) btnText.textContent = idleText;
        if (btn) btn.disabled = false;
        if (meta) meta.textContent = 'Something went wrong — email Jared@jareddesu.com directly.';
      }
    });
  });
})();
