// app.js — the sponsor CRM shell: sign-in, navigation, settings.
// Loaded as a module by /sponsorships/manage/. Nothing is fetched and no data
// is shown until the Worker accepts the password.

import { h, clear, $ } from './dom.js';
import { api, login, hasSession, clearSession, whenSignedOut, API_BASE } from './api.js';
import { store, reload, subscribe } from './store.js';
import { dashboardView, pipelineView, companiesView, videosView, paymentsView, ratesView } from './views.js';
import { openDeal, openCompany } from './panels.js';
import { openImport, exportAs, CSV_TABLES } from './io.js';
import { closePanel, panelOpen, panelDirty, toast, button, busy } from './ui.js';

// Refuse to run inside a frame (GitHub Pages can't send frame-ancestors)
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error('Framed');
}

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', render: dashboardView },
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
    VIEWS.map((v) => h('a', { href: `#/${v.id}`, dataset: { view: v.id } }, v.label)));
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
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Export'),
        h('p', { class: 'crm-note' }, 'Everything, including archived records and the activity timeline.'),
        h('div', { class: 'crm-chip-row' }, exportBtns),
        h('p', { class: 'crm-note is-muted' }, 'One table as CSV:'),
        h('div', { class: 'crm-chip-row' }, csvBtns)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Categories'),
        h('p', { class: 'crm-note is-muted' }, 'One per line. Used for company categories and the same-category conflict check.'),
        cats, h('div', { class: 'crm-row-actions' }, saveCats)),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Security'),
        h('p', { class: 'crm-note' }, 'Sessions last 12 hours and end when you close this tab.'),
        outAll),
      h('section', { class: 'crm-section' }, h('h2', { class: 'crm-section-title' }, 'Keyboard'),
        h('dl', { class: 'crm-keys' },
          [['n', 'New record in this section'], ['/', 'Search'], ['Esc', 'Close the panel'], ['g then d / p / c / v', 'Go to Dashboard, Pipeline, Companies, Videos']]
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
    const to = { d: 'dashboard', p: 'pipeline', c: 'companies', v: 'videos' }[e.key];
    if (to) { e.preventDefault(); location.hash = `#/${to}`; }
    gPressed = 0;
  }
});

// Leaving with unsaved edits in the panel
window.addEventListener('beforeunload', (e) => {
  if (panelDirty()) { e.preventDefault(); e.returnValue = ''; }
});

if (hasSession()) start(); else showLogin();
