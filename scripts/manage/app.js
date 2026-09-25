// app.js — the sponsor CRM shell: sign-in, navigation, settings.
// Loaded as a module by /sponsorships/manage/. Nothing is fetched and no data
// is shown until the Worker accepts the password.

import { h, clear, $ } from './dom.js';
import { api, request, login, hasSession, clearSession, whenSignedOut, API_BASE } from './api.js';
import { store, reload, subscribe } from './store.js';
import { dashboardView, pipelineView, companiesView, videosView, paymentsView, ratesView } from './views.js';
import { openDeal, openCompany } from './panels.js';
import { openImport, exportAs, CSV_TABLES } from './io.js';
import { calendarView } from './cal-view.js';
import { reviewView, refreshReviewCount, whenReviewCountChanges } from './review.js';
import { insightsView } from './insights-view.js';
import { DEFAULT_AVOID, DEFAULT_TEMPLATES, templatesFrom, avoidFrom } from './pitching.js';
import { closePanel, panelOpen, panelDirty, toast, button, busy } from './ui.js';

// Refuse to run inside a frame (GitHub Pages can't send frame-ancestors)
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error('Framed');
}

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', render: dashboardView },
  { id: 'review', label: 'Review', render: reviewView },
  { id: 'calendar', label: 'Calendar', render: calendarView },
  { id: 'insights', label: 'Insights', render: insightsView },
  { id: 'pipeline', label: 'Pipeline', render: pipelineView },
  { id: 'companies', label: 'Companies', render: companiesView },
  { id: 'videos', label: 'Videos', render: videosView },
  { id: 'payments', label: 'Payments', render: paymentsView },
  { id: 'rates', label: 'Rate card', render: ratesView },
  { id: 'settings', label: 'Settings', render: settingsView },
];

const app = $('#crm-app');
let current = null;   // { id, rerender }

// --- Sign in ---------------------------------------------------------------------------
function showLogin(message) {
  closePanel({ force: true });
  document.body.classList.remove('is-signed-in');
  const pw = h('input', { type: 'password', id: 'crm-pw', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'crm-login-error', role: 'alert' }, message || '');
  const submit = h('button', { type: 'submit', class: 'crm-btn is-primary' }, 'Sign in');
  const form = h('form', {
    class: 'crm-login',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!pw.value) return;
      submit.disabled = true;
      err.textContent = '';
      try {
        await login(pw.value);
        pw.value = '';
        await start();
      } catch (ex) {
        err.textContent = ex.message;
        pw.select();
      } finally { submit.disabled = false; }
    },
  },
  h('p', { class: 'crm-login-mark', lang: 'ja' }, '営業'),
  h('h1', {}, 'Sponsor desk'),
  h('label', { for: 'crm-pw' }, 'Password'), pw, err, submit,
  API_BASE ? null : h('p', { class: 'crm-login-error' }, 'The CRM server address isn’t set in this page.'));
  app.replaceChildren(h('main', { class: 'crm-login-wrap', id: 'main' }, form));
  pw.focus();
}

whenSignedOut(() => showLogin('Your session ended. Sign in again.'));

// --- Shell -----------------------------------------------------------------------------
function shell() {
  const nav = h('nav', { class: 'crm-tabs', 'aria-label': 'Sections' },
    VIEWS.map((v) => h('a', { href: `#/${v.id}`, dataset: { view: v.id } }, v.label,
      v.id === 'review' ? h('span', { class: 'crm-badge', id: 'crm-review-badge', hidden: true }) : null)));
  whenReviewCountChanges((n) => {
    const b = document.getElementById('crm-review-badge');
    if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = !n;
    b.setAttribute('aria-label', `${n} to review`);
  });
  const signOut = h('button', { type: 'button', class: 'crm-link-btn', onclick: () => { clearSession(); showLogin('Signed out.'); } }, 'Sign out');
  const sync = h('span', { class: 'crm-sync', 'aria-live': 'polite' });
  subscribe((s) => { sync.textContent = s.loading ? 'Syncing…' : s.error ? 'Offline' : ''; });
  app.replaceChildren(
    h('header', { class: 'crm-top' },
      h('a', { class: 'crm-brand', href: '#/dashboard' }, h('span', { class: 'crm-brand-ja', lang: 'ja' }, '営業'), h('span', {}, 'Sponsor desk')),
      h('div', { class: 'crm-top-right' }, sync, signOut)),
    nav,
    h('main', { class: 'crm-main', id: 'main', tabindex: '-1' }));
  document.body.classList.add('is-signed-in');
}

function route() {
  if (!store.state) return;
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const id = VIEWS.some((v) => v.id === path) ? path : 'dashboard';
  const view = VIEWS.find((v) => v.id === id);
  document.querySelectorAll('.crm-tabs a').forEach((a) => {
    if (a.dataset.view === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const main = $('.crm-main');
  if (!main) return;
  document.title = `${view.label} · Sponsor desk`;
  current = { id, rerender: view.render(main, new URLSearchParams(query || '')) };
}

async function start() {
  shell();
  const main = $('.crm-main');
  main.append(h('p', { class: 'crm-note is-muted' }, 'Loading…'));
  await reload();
  if (store.error) {
    clear(main).append(h('p', { class: 'crm-note is-error' }, store.error.message), button('Try again', () => start(), { kind: 'primary' }));
    return;
  }
  route();
  refreshReviewCount();
}

// Re-render the current view whenever the data changes
subscribe((s) => { if (!s.loading && s.state && current && current.rerender) current.rerender(); });
window.addEventListener('hashchange', route);

// --- Settings --------------------------------------------------------------------------
function settingsView(root) {
  const render = () => {
    const s = store.state;
    const cats = h('textarea', { rows: 6, 'aria-label': 'Categories, one per line' }, s.settings.categories.join('\n'));
    const saveCats = button('Save categories', async () => {
      const list = cats.value.split('\n').map((x) => x.trim()).filter(Boolean);
      await busy(saveCats, () => api.setting('categories', list));
      await reload();
      toast('Categories saved', { kind: 'ok', ms: 2500 });
    });
    const exportBtns = [
      ['Excel (.xlsx)', 'xlsx'], ['JSON', 'json'],
    ].map(([label, f]) => { const b = button(label, () => exportAs(f, b), { kind: 'chip' }); return b; });
    const csvBtns = CSV_TABLES.map((t) => { const b = button(t, () => exportAs(t, b), { kind: 'chip' }); return b; });
    const planInput = h('input', {
      type: 'file', accept: '.json,application/json', 'aria-label': 'Plan file',
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          if (f.size > 2 * 1024 * 1024) throw new Error('That file is too large for a plan.');
          const plan = JSON.parse(await f.text());
          const n = await api.plan(plan);
          toast(`Plan imported: ${n.items} items, ${n.series} recurring blocks, ${n.videos} videos${n.skipped ? ` (${n.skipped} already there)` : ''}.`, { kind: 'ok', ms: 9000 });
          await reload();
        } catch (err) {
          toast(Array.isArray(err.details) ? `${err.message}: ${err.details.slice(0, 3).join(' · ')}` : err.message || 'Couldn’t read that plan file', { kind: 'error', ms: 12000 });
        } finally { e.target.value = ''; }
      },
    });
    const cap = s.settings.capacity || { min: 10, max: 15 };
    const job = s.settings.jobHours || { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };
    const capMin = h('input', { type: 'number', min: 0, max: 80, step: 0.5, value: cap.min });
    const capMax = h('input', { type: 'number', min: 0, max: 80, step: 0.5, value: cap.max });
    const jobStart = h('input', { type: 'time', value: job.start, step: 900 });
    const jobEnd = h('input', { type: 'time', value: job.end, step: 900 });
    const jobDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => h('label', { class: 'crm-check' },
      h('input', { type: 'checkbox', value: i, checked: job.days.includes(i) }), ` ${d}`));
    const saveHours = button('Save', async () => {
      await busy(saveHours, async () => {
        await api.setting('capacity', { min: Number(capMin.value), max: Number(capMax.value) });
        await api.setting('jobHours', { days: jobDays.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value)), start: jobStart.value, end: jobEnd.value });
      });
      await reload();
      toast('Saved', { kind: 'ok', ms: 2500 });
    });
    const inv = s.settings.invoicing || {};
    const invF = {
      name: h('input', { value: inv.name || '', placeholder: 'Your name or business name' }),
      email: h('input', { type: 'email', value: inv.email || '' }),
      address: h('textarea', { rows: 2 }, inv.address || ''),
      payment: h('textarea', { rows: 3, placeholder: 'e.g. PayPal: you@example.com, or bank details' }, inv.payment || ''),
      termsDays: h('input', { type: 'number', min: 0, max: 120, value: inv.termsDays ?? 30 }),
      prefix: h('input', { value: inv.prefix || 'INV-', maxlength: 10 }),
      startAt: h('input', { type: 'number', min: 1, value: inv.startAt ?? 1 }),
    };
    const saveInv = button('Save', async () => {
      await busy(saveInv, () => api.setting('invoicing', Object.fromEntries(Object.entries(invF).map(([k, el]) => [k, ['termsDays', 'startAt'].includes(k) ? Number(el.value) : el.value]))));
      await reload();
      toast('Saved', { kind: 'ok', ms: 2500 });
    });
    const avoidEl = h('textarea', { rows: 6, 'aria-label': 'Avoid list, one per line' }, avoidFrom(s.settings).join('\n'));
    const saveAvoid = button('Save avoid list', async () => {
      await busy(saveAvoid, () => api.setting('avoid', avoidEl.value.split('\n').map((x) => x.trim()).filter(Boolean)));
      await reload();
      toast('Saved', { kind: 'ok', ms: 2500 });
    });
    const tpls = templatesFrom(s.settings).map((t) => ({ ...t }));
    const tplBox = h('div', { class: 'crm-templates' });
    const drawTpls = () => tplBox.replaceChildren(...tpls.map((t, i) => h('fieldset', { class: 'crm-template' },
      h('legend', {}, t.name || `Template ${i + 1}`),
      h('label', { class: 'crm-field' }, 'Name', h('input', { value: t.name, maxlength: 40, oninput: (e) => { t.name = e.target.value; } })),
      h('label', { class: 'crm-field' }, 'Subject', h('input', { value: t.subject, maxlength: 200, oninput: (e) => { t.subject = e.target.value; } })),
      h('label', { class: 'crm-field' }, 'Message', h('textarea', { rows: 8, oninput: (e) => { t.body = e.target.value; } }, t.body)),
      tpls.length > 1 ? button('Remove template', () => { tpls.splice(i, 1); drawTpls(); }, { kind: 'chip' }) : null)));
    drawTpls();
    const saveTpls = button('Save templates', async () => {
      await busy(saveTpls, () => api.setting('pitchTemplates', tpls));
      await reload();
      toast('Templates saved', { kind: 'ok', ms: 2500 });
    }, { kind: 'primary' });
    const mcpUrl = h('input', { type: 'text', readonly: true, value: `${API_BASE}/mcp`, 'aria-label': 'Connector URL' });
    const copyBtn = button('Copy', async () => { try { await navigator.clipboard.writeText(mcpUrl.value); toast('Copied', { kind: 'ok', ms: 1500 }); } catch { mcpUrl.select(); } }, { kind: 'chip' });
    const grantsEl = h('ul', { class: 'crm-mini-list' }, h('li', { class: 'crm-note is-muted' }, 'Loading…'));
    const drawGrants = async () => {
      try {
        const grants = await request('GET', 'claude/grants');
        grantsEl.replaceChildren(...(grants.length ? grants.map((g) => h('li', { class: 'crm-grant' },
          h('span', {}, h('strong', {}, g.client), h('span', { class: 'crm-muted' }, ` · connected ${new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)),
          button('Revoke', async () => {
            if (!window.confirm(`Disconnect ${g.client}? Claude will need your password to connect again.`)) return;
            try { await request('DELETE', `claude/grants/${encodeURIComponent(g.id)}`); toast('Disconnected'); drawGrants(); } catch (err) { toast(err.message, { kind: 'error' }); }
          }, { kind: 'chip' }))) : [h('li', { class: 'crm-note is-muted' }, 'No Claude sessions connected.')]));
      } catch (err) { grantsEl.replaceChildren(h('li', { class: 'crm-note is-error' }, err.message)); }
    };
    drawGrants();
    const outAll = button('Sign out on every device', async () => {
      if (!window.confirm('Sign out everywhere, including this browser?')) return;
      await busy(outAll, () => api.logoutAll());
      clearSession();
      showLogin('Signed out everywhere.');
    });
    root.replaceChildren(
      h('div', { class: 'crm-view-head' }, h('h1', { class: 'crm-view-title' }, 'Settings', h('span', { class: 'crm-view-ja', lang: 'ja' }, '設定'))),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Import'),
        h('p', { class: 'crm-note' }, 'Bring in your spreadsheet tracker. You’ll see how each column maps, and a preview, before anything is saved. Re-importing skips deals that are already here.'),
        button('Import a tracker…', () => openImport(), { kind: 'primary' })),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Plan'),
        h('p', { class: 'crm-note' }, 'Import your private plan file (.json) to put the plan’s objectives, weekly checklist, recurring blocks, publish dates, KPI gates and videos on the calendar. Importing again only adds what’s missing; it never overwrites your changes.'),
        planInput),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Channel hours'),
        h('p', { class: 'crm-note is-muted' }, 'The weekly budget for the capacity bar, and the day-job hours shaded on the calendar.'),
        h('div', { class: 'crm-form-grid is-narrow' },
          h('label', { class: 'crm-field' }, 'Budget from (h)', capMin), h('label', { class: 'crm-field' }, 'to (h)', capMax),
          h('label', { class: 'crm-field' }, 'Job starts', jobStart), h('label', { class: 'crm-field' }, 'Job ends', jobEnd)),
        h('div', { class: 'crm-chip-row' }, jobDays),
        h('div', { class: 'crm-row-actions' }, saveHours)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Pitch templates'),
        h('p', { class: 'crm-note is-muted' }, 'Used by Write pitch on a deal, and by Claude when you ask it to draft one. Placeholders: {{first_name}} {{company}} {{video}} {{month}} {{subscribers}} {{monthly_views}} {{english_share}} {{package}} {{price}} {{kit}}. Text in [square brackets] is flagged until you replace it.'),
        tplBox,
        h('div', { class: 'crm-row-actions' }, saveTpls,
          button('Add template', () => { tpls.push({ name: 'New template', subject: '', body: '' }); drawTpls(); }, { kind: 'chip' }),
          button('Reset to defaults', () => { tpls.splice(0, tpls.length, ...DEFAULT_TEMPLATES.map((t) => ({ ...t }))); drawTpls(); }, { kind: 'chip' }))),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Avoid list'),
        h('p', { class: 'crm-note is-muted' }, `Brands and offers Claude skips when prospecting, and flags when they pitch you. One per line.${s.settings.avoid ? '' : ' (Showing the plan’s defaults.)'}`),
        avoidEl, h('div', { class: 'crm-row-actions' }, saveAvoid,
          button('Reset to defaults', () => { avoidEl.value = DEFAULT_AVOID.join('\n'); }, { kind: 'chip' }))),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Invoices'),
        h('p', { class: 'crm-note is-muted' }, 'Printed on every invoice. Private: stored only in the CRM database.'),
        h('div', { class: 'crm-form-grid' },
          h('label', { class: 'crm-field' }, 'Name', invF.name), h('label', { class: 'crm-field' }, 'Email', invF.email),
          h('label', { class: 'crm-field is-wide' }, 'Address', invF.address), h('label', { class: 'crm-field is-wide' }, 'How to pay you', invF.payment),
          h('label', { class: 'crm-field' }, 'Payment terms (days)', invF.termsDays), h('label', { class: 'crm-field' }, 'Number prefix', invF.prefix),
          h('label', { class: 'crm-field' }, 'First number', invF.startAt)),
        h('div', { class: 'crm-row-actions' }, saveInv)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Export'),
        h('p', { class: 'crm-note' }, 'Everything, including archived records and the activity timeline.'),
        h('div', { class: 'crm-chip-row' }, exportBtns),
        h('p', { class: 'crm-note is-muted' }, 'One table as CSV:'),
        h('div', { class: 'crm-chip-row' }, csvBtns)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Categories'),
        h('p', { class: 'crm-note is-muted' }, 'One per line. Used for company categories and the same-category conflict check.'),
        cats, h('div', { class: 'crm-row-actions' }, saveCats)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Claude connector'),
        h('p', { class: 'crm-note' }, 'Add this address in Claude (Customize → Connectors → Add custom connector). Claude will ask for this password once.'),
        h('div', { class: 'crm-add-row' }, mcpUrl, copyBtn),
        h('h3', { class: 'crm-subhead' }, 'Connected sessions'),
        grantsEl),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Security'),
        h('p', { class: 'crm-note' }, 'Sessions last 12 hours and end when you close this tab.'),
        outAll),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Keyboard'),
        h('dl', { class: 'crm-keys' },
          [['n', 'New record in this section'], ['/', 'Search'], ['Esc', 'Close the panel'], ['g then d / r / k / p / c / v', 'Go to Dashboard, Review, Calendar, Pipeline, Companies, Videos']]
            .map(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)]))),
    );
  };
  render();
  return render;
}

// --- Keyboard ----------------------------------------------------------------------------
let gPressed = 0;
document.addEventListener('keydown', (e) => {
  if (!store.state || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === 'Escape' && panelOpen()) { e.preventDefault(); closePanel(); return; }
  if (typing || panelOpen()) return;
  if (e.key === '/') {
    const s = document.querySelector('[data-search]');
    if (s) { e.preventDefault(); s.focus(); }
  } else if (e.key === 'n') {
    const create = { pipeline: () => openDeal(null), companies: () => openCompany(null) }[current && current.id];
    const btn = document.querySelector('.crm-view-actions .crm-btn.is-primary');
    if (create) { e.preventDefault(); create(); } else if (btn) { e.preventDefault(); btn.click(); }
  } else if (e.key === 'g') {
    gPressed = Date.now();
  } else if (Date.now() - gPressed < 1200) {
    const to = { d: 'dashboard', r: 'review', k: 'calendar', p: 'pipeline', c: 'companies', v: 'videos' }[e.key];
    if (to) { e.preventDefault(); location.hash = `#/${to}`; }
    gPressed = 0;
  }
});

// Leaving with unsaved edits in the panel
window.addEventListener('beforeunload', (e) => {
  if (panelDirty()) { e.preventDefault(); e.returnValue = ''; }
});

if (hasSession()) start(); else showLogin();
