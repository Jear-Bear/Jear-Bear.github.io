// contact.js — delivers the contact form via Web3Forms (works on static hosting)
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const ACCESS_KEY = '7137a0ba-b831-4c6d-9f6c-3b04fffbae4c'; // free key from web3forms.com
  const btnText = form.querySelector('.submit-text');
  const meta = document.getElementById('form-meta');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    if (fd.get('website')) return;          // honeypot tripped → silently drop

    fd.append('access_key', ACCESS_KEY);
    fd.append('subject', `New message from ${fd.get('name')} — jareddesu.com`);

    if (btnText) btnText.textContent = 'Sending…';
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
      if (meta) meta.textContent = "Thanks — I'll reply within 48 hours.";
    } catch (err) {
      console.error('Contact form error:', err);
      if (btnText) btnText.textContent = 'Send message';
      if (meta) meta.textContent = 'Something went wrong — email jared@jareddesu.com directly.';
    }
  });
})();
