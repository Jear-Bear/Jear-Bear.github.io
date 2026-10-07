// plus.js — the low-key Crossword+ waitlist.
//
// The daily puzzles stay free. This only asks regular solvers whether they'd
// like optional extras (every past puzzle, bonus puzzles), and if so, takes an
// email for one note when it's ready. To keep it from being pushy:
//   - the solved screen shows it only after your 3rd solve, at most once a day,
//     and never again after "Not for me" (for 60 days) or after you sign up;
//   - it never covers the grid or interrupts a puzzle;
//   - the page section (always there, below How to play) never pops up.
// Emails go to the sponsor Worker's private database (waitlist.js), never the repo.

import { lang } from '../games/i18n.js?v=1';

const API = 'https://sponsor-crm.jared-65b.workers.dev';
const KEY = 'jareddesu.crossword.plus';
const SUPPORT_URL = 'https://www.youtube.com/@jareddesu/join';
const WANTS = ['archive', 'bonus', 'sync', 'print'];
const HIDE_DAYS = 60;

const T = {
  en: {
    title: 'Want more puzzles?',
    body: 'The daily puzzles are free, and they’ll stay that way. I’m thinking about an optional Crossword+ for people who want more: every past puzzle, plus a few bonus ones each week. Would you use it?',
    short: 'The daily puzzles will always be free. Would you use an optional Crossword+ with every past puzzle and a few bonus ones each week?',
    wantsLabel: 'What sounds good? (optional)',
    'want.archive': 'Every past puzzle', 'want.bonus': 'Bonus puzzles', 'want.sync': 'Streaks on all my devices', 'want.print': 'Printable puzzles',
    email: 'Your email', submit: 'Tell me when it’s ready', not: 'Not for me',
    fine: 'One email when it launches. No newsletter, and you can remove yourself anytime.',
    thanks: 'Thanks! I’ll write once, when it’s ready.', sending: 'Sending…',
    badEmail: 'That email doesn’t look quite right.', failed: 'Couldn’t send that. Please try again in a bit.',
    hidden: 'Got it, I won’t ask again.',
  },
  ja: {
    title: 'もっと解きたい？',
    body: '毎日のパズルは無料で、これからもずっと無料です。もっと解きたい人向けに、過去のパズル全部と毎週のボーナスパズルが遊べる「クロスワード＋」（任意の有料プラン）を考えています。使ってみたいですか？',
    short: '毎日のパズルはずっと無料です。過去のパズル全部と毎週のボーナスパズルが遊べる任意の「クロスワード＋」、使ってみたいですか？',
    wantsLabel: '気になるもの（任意）',
    'want.archive': '過去のパズル全部', 'want.bonus': 'ボーナスパズル', 'want.sync': '記録をどの端末でも', 'want.print': '印刷できるパズル',
    email: 'メールアドレス', submit: '始まったら教えて', not: '興味なし',
    fine: '始まったときにメールを1通だけ送ります。メルマガはなく、いつでも削除できます。',
    thanks: 'ありがとう！準備ができたら1回だけお知らせします。', sending: '送信中…',
    badEmail: 'メールアドレスを確認してください。', failed: '送信できませんでした。少ししてからもう一度お試しください。',
    hidden: 'わかりました。もう聞きません。',
  },
};
const t = (k) => (T[lang()] || T.en)[k] || T.en[k];

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function write(v) { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...v })); } catch { /* private mode */ } }
const today = () => new Date().toISOString().slice(0, 10);

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

// Should the solved screen mention it? solves = puzzles this browser has solved
export function plusEligible(solves) {
  const s = read();
  if (s.joined || solves < 3 || s.shownOn === today()) return false;
  return !(s.hideUntil && Date.now() < s.hideUntil);
}

// The form. compact: the solved-screen version (with "Not for me")
export function plusForm({ compact = false } = {}) {
  const chosen = new Set();
  const status = h('p', { class: 'cw-plus-status', role: 'status', 'aria-live': 'polite' });
  const email = h('input', { type: 'email', class: 'cw-plus-email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: t('email'), 'aria-label': t('email'), maxlength: '254' });
  const honey = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'cw-plus-hp', 'aria-hidden': 'true' });
  const chips = h('div', { class: 'cw-plus-chips', role: 'group', 'aria-label': t('wantsLabel') },
    WANTS.map((w) => h('button', {
      type: 'button', class: 'cw-plus-chip', 'aria-pressed': 'false',
      onclick: (e) => { const on = !chosen.has(w); on ? chosen.add(w) : chosen.delete(w); e.currentTarget.setAttribute('aria-pressed', String(on)); },
    }, t(`want.${w}`))));
  const submit = h('button', { type: 'submit', class: 'btn cw-plus-submit' }, t('submit'));
  const box = h('div', { class: `cw-plus${compact ? ' is-compact' : ''}` });

  const form = h('form', {
    class: 'cw-plus-form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const v = email.value.trim();
      if (!/^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(v)) { status.textContent = t('badEmail'); email.focus(); return; }
      submit.disabled = true; status.textContent = t('sending');
      try {
        const res = await fetch(`${API}/public/crossword-interest`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: v, wants: [...chosen], lang: lang(), website: honey.value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        write({ joined: true });
        box.replaceChildren(h('p', { class: 'cw-plus-thanks' }, t('thanks')));
      } catch {
        status.textContent = t('failed');
        submit.disabled = false;
      }
    },
  }, compact ? null : h('span', { class: 'cw-plus-wants' }, t('wantsLabel')), compact ? null : chips,
  h('div', { class: 'cw-plus-row' }, email, submit), honey, status);

  const not = compact ? h('button', {
    type: 'button', class: 'btn-link cw-plus-not',
    onclick: () => { write({ hideUntil: Date.now() + HIDE_DAYS * 86400000 }); box.replaceChildren(h('p', { class: 'cw-plus-thanks' }, t('hidden'))); },
  }, t('not')) : null;

  if (read().joined) box.append(h('p', { class: 'cw-plus-thanks' }, t('thanks')));
  else box.append(h('p', { class: 'cw-plus-title' }, t('title')), h('p', { class: 'cw-plus-body' }, t(compact ? 'short' : 'body')), form, h('p', { class: 'cw-plus-fine' }, t('fine'), not ? ' ' : null, not));
  return box;
}

// For the solved screen: the compact form, remembered as shown today
export function plusCard() {
  write({ shownOn: today() });
  return plusForm({ compact: true });
}

// The page section's form and support link (see tools/crossword/index.html)
export function mountPlusSection() {
  const slot = document.getElementById('plus-form');
  if (slot) slot.replaceChildren(plusForm());
  document.querySelectorAll('[data-support-link]').forEach((a) => { a.href = SUPPORT_URL; });
}
