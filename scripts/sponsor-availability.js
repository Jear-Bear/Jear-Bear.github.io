// sponsor-availability.js — live sponsor-slot availability on /sponsorships/
// and a copy of each inquiry for the private sponsor CRM.
//
// Availability comes from the CRM Worker as counts per month only (no brand
// names, titles or prices). If it can't be reached, the section stays hidden.
// The inquiry form keeps emailing through Web3Forms (contact.js); this also
// files it in the CRM's review queue. Either can fail without affecting the other.
(function () {
  var API = 'https://sponsor-crm.jared-65b.workers.dev';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var box = document.querySelector('[data-render="availability"]');
  if (box && window.fetch) {
    fetch(API + '/public/availability', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.months)) return;
        var months = data.months.filter(function (m) { return m.open + m.booked > 0; });
        if (!months.length) return;
        var list = el('ul', 'avail-list');
        months.forEach(function (m) {
          var li = el('li', 'avail-item' + (m.open ? ' is-open' : ' is-booked'));
          li.appendChild(el('span', 'avail-month', MONTHS[+m.month.slice(5, 7) - 1] + ' ' + m.month.slice(0, 4)));
          li.appendChild(el('span', 'avail-state', m.open ? (m.open === 1 ? '1 slot open' : m.open + ' slots open') : 'Booked'));
          list.appendChild(li);
        });
        box.replaceChildren(el('p', 'avail-title', 'Sponsor slots'), list,
          el('p', 'avail-note', 'One sponsor per video. Updated live.'));
        box.hidden = false;
      })
      .catch(function () { /* stay hidden */ });
  }

  var form = document.getElementById('sponsor-form');
  if (form && window.fetch) {
    form.addEventListener('submit', function () {
      var fd = new FormData(form);
      if (fd.get('website')) return;
      if (!form.checkValidity()) return;
      var body = {
        name: fd.get('name'), email: fd.get('email'), brand: fd.get('brand'), campaign: fd.get('campaign'),
        timeframe: fd.get('timeframe'), budget: fd.get('budget'), deliverables: fd.getAll('deliverables'), message: fd.get('message'),
      };
      try {
        fetch(API + '/public/inquiry', {
          method: 'POST', credentials: 'omit', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }).catch(function () {});
      } catch (e) { /* the email still goes out */ }
    });
  }
})();
