// signin.js — signing in, in a popup over the page: Google's button and/or a link sent by
// email. Shared by the crossword (deck.js puts Crossword+'s plan steps above the form) and
// Kana Wordle; both use account.js, so one session signs you in on both pages.
//
// The page passes its strings (t) and, if it isn't the crossword, its class names; the
// defaults are the crossword's, so it looks the same there as it always has.

import { info, googleButton, sendEmailLink } from '../crossword/account.js?v=8';

const CLS = {
  overlay: 'cw-overlay cw-signin-pop', sheet: 'cw-sheet cw-signin-sheet', x: 'cw-pop-x', title: 'cw-sheet-title',
  status: 'cw-deck-status', muted: 'cw-deck-muted', google: 'cw-google', or: 'cw-deck-or', row: 'cw-deck-row',
  legal: 'cw-deck-muted cw-legal', button: 'btn', mount: '.cw',
};

let googleOk = true;          // false once Google's script fails (blocked, offline): then just email
let open = null;              // the popup, while it's open

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c != null && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

export const legalLine = (t, k, cls = CLS.legal) => h('p', { class: cls }, t(k), ' ',
  h('a', { href: '../../terms/' }, t('lTerms')), ' · ', h('a', { href: '../../privacy/' }, t('lPrivacy')), ' · ', h('a', { href: '../../refunds/' }, t('lRefunds')));

export function closeSignIn() { if (open) open.close(); }

// t: the page's strings (signInWhy, emailLabel, sendLink, sending, or, noSignIn, agreeSignIn,
// lTerms, lPrivacy, lRefunds, failed, close and the sentKey line). title: the heading; top:
// anything above the form. page: where the email link brings them back ('crossword' or 'wordle').
export async function openSignIn({ t, title, top = [], sentKey = 'sent', page = 'crossword', cls = {} }) {
  const c = { ...CLS, ...cls };
  const cfg = await info();
  closeSignIn();
  const msg = h('p', { class: c.status, role: 'status', 'aria-live': 'polite' });
  const say = (text, error = false) => { msg.textContent = text; msg.classList.toggle('is-error', error); };
  const form = signInForm({ t, cfg, say, sentKey, page, c });
  const overlay = h('div', { class: c.overlay });
  const close = () => { overlay.remove(); open = null; document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  overlay.append(h('div', { class: c.sheet, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cw-signin-title' },
    h('button', { type: 'button', class: c.x, 'aria-label': t('close'), onclick: close }, '×'),
    ...top.slice(0, 1),
    h('h2', { class: c.title, id: 'cw-signin-title' }, title),
    ...top.slice(1),
    form.nodes, msg));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc);
  (document.querySelector(c.mount) || document.body).append(overlay);
  open = { close };
  form.ready();
  return open;
}

// Google and the email link. ready(): once it's on the page (Google's button sizes itself to it)
function signInForm({ t, cfg, say, sentKey, page, c }) {
  const useGoogle = cfg && cfg.google && googleOk;
  if (!cfg || (!useGoogle && !cfg.email)) return { nodes: [h('p', { class: c.muted }, t('noSignIn'))], ready() {} };
  const g = h('div', { class: c.google });
  const or = useGoogle && cfg.email ? h('p', { class: c.or }, t('or')) : null;
  const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: t('emailLabel'), 'aria-label': t('emailLabel'), maxlength: '254' });
  const send = h('button', { type: 'button', class: c.button, onclick: async () => {
    const v = email.value.trim();
    if (!v) { email.focus(); return; }
    send.disabled = true; say(t('sending'));
    try { await sendEmailLink(v, page); say(t(sentKey)); } catch (e) { say(e.message || t('failed'), true); }
    send.disabled = false;
  } }, t('sendLink'));
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
  return {
    nodes: [
      h('p', { class: c.muted }, t('signInWhy')),
      useGoogle ? g : null,
      or,
      cfg.email ? h('div', { class: c.row }, email, send) : null,
      legalLine(t, 'agreeSignIn', c.legal)],
    ready() {
      // A failed load just leaves the email link
      if (useGoogle) googleButton(g, { onError: (e) => { if (/load/i.test(e.message || '')) { googleOk = false; g.remove(); if (or) or.remove(); } else say(e.message || t('failed'), true); } });
      if (!useGoogle) setTimeout(() => email.focus(), 50);
    },
  };
}
