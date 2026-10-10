// go.js — jareddesu.com/go/<name> short links. GitHub Pages serves 404.html
// for any unknown path; this forwards /go/<name> to the sponsor CRM Worker,
// which counts the click and redirects to the sponsor.
(function () {
  // jareddesu.com/lesson typed with capitals (/Lesson, /LESSON/) → the real page
  if (/^\/lesson\/?$/i.test(location.pathname)) { document.documentElement.classList.add('is-go'); location.replace('/lesson/' + location.search); return; }
  var m = location.pathname.match(/^\/go\/([a-z0-9-]{1,40})\/?$/i);
  if (!m) return;
  document.documentElement.classList.add('is-go');
  location.replace('https://sponsor-crm.jared-65b.workers.dev/go/' + m[1].toLowerCase() + location.search);
})();
