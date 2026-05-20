// Contact page — EmailJS submission with honeypot spam protection

(function() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const submitBtn = document.getElementById('form-submit');
  const submitText = submitBtn.querySelector('.submit-text');
  const formMeta = document.getElementById('form-meta');
  const originalMetaText = formMeta.textContent;
  const originalMetaClass = formMeta.className;

  // Initialize EmailJS (using your existing public key)
  if (typeof emailjs !== 'undefined') {
    emailjs.init('z8lBeXbRQ2a3nnAat');
  }

  function setMeta(text, cls = '') {
    formMeta.textContent = text;
    formMeta.className = 'form-meta' + (cls ? ' ' + cls : '');
  }

  function resetMeta() {
    formMeta.textContent = originalMetaText;
    formMeta.className = originalMetaClass;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Honeypot check — if the hidden 'website' field has content, it's a bot
    const honeypot = form.querySelector('input[name="website"]');
    if (honeypot && honeypot.value) {
      // Silently fail; don't tell the bot what tipped us off
      setMeta('Your message has been sent successfully!', 'success');
      form.reset();
      return;
    }

    const formData = new FormData(form);
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');

    if (!name || !email || !message) {
      setMeta('Please fill out all fields.', 'error');
      return;
    }

    // Set loading state
    submitBtn.disabled = true;
    submitText.textContent = 'Sending…';
    resetMeta();

    if (typeof emailjs === 'undefined') {
      setMeta('Email service unavailable. Please try again later.', 'error');
      submitBtn.disabled = false;
      submitText.textContent = 'Send message';
      return;
    }

    try {
      await emailjs.send('service_kp4acia', 'template_v5vk5m7', {
        to_name: 'Jared',
        from_name: name,
        user_email: email,
        message: message,
        reply_to: email,
      });

      setMeta(`Thanks ${name.split(' ')[0]}, your message is on its way.`, 'success');
      form.reset();
      submitText.textContent = 'Sent ✓';
      setTimeout(() => {
        submitBtn.disabled = false;
        submitText.textContent = 'Send message';
      }, 3000);
    } catch (err) {
      console.error('EmailJS error:', err);
      setMeta('Something went wrong. Try again, or email directly?', 'error');
      submitBtn.disabled = false;
      submitText.textContent = 'Send message';
    }
  });
})();
