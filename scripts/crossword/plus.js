// plus.js — the low-key Crossword+ waitlist.
//
// The daily puzzles stay free. This only asks regular solvers whether they'd
// like optional extras (past puzzles, unlimited deck puzzles, bonus puzzles), and if so, takes an
// email for one note when it's ready. To keep it from being pushy:
//   - the solved screen (お見事) shows a short version on every solve, until you
//     sign up (then just a one-line "you're on the list") or tap "Not for me"
//     (hidden for 30 days);
//   - it never covers the grid or interrupts a puzzle;
//   - the page section (always there, below How to play) never pops up.
// Emails go to the sponsor Worker's private database (waitlist.js), never the repo.

import { lang } from '../games/i18n.js?v=1';
import { info, isMember } from './account.js?v=2';

const API = 'https://sponsor-crm.jared-65b.workers.dev';
const KEY = 'jareddesu.crossword.plus';
const SUPPORT_URL = 'https://www.youtube.com/@jareddesu/join';
const WANTS = ['archive', 'deck', 'bonus', 'sync', 'print'];
const HIDE_DAYS = 30;

const T = {
  en: {
    title: 'Want more puzzles?',
    body: 'The daily puzzles are free, and they’ll stay that way. I’m working on an optional Crossword+ for people who want more: every past puzzle, unlimited crosswords from your own Anki deck, and a few bonus puzzles each week. Would you use it?',
    short: 'The daily puzzles will always be free. Would you use an optional Crossword+ with every past puzzle, unlimited crosswords from your Anki deck and weekly bonus puzzles?',
    wantsLabel: 'What sounds good? (optional)',
    'want.archive': 'Every past puzzle', 'want.bonus': 'Bonus puzzles', 'want.deck': 'Crosswords from my Anki deck', 'want.sync': 'Streaks on all my devices', 'want.print': 'Printable puzzles',
    email: 'Your email', submit: 'Tell me when it’s ready', not: 'Not for me',
    fine: 'One email when it launches. No newsletter, and you can remove yourself anytime.',
    thanks: 'Thanks! I’ll write once, when it’s ready.', sending: 'Sending…',
    badEmail: 'That email doesn’t look quite right.', failed: 'Couldn’t send that. Please try again in a bit.',
    hidden: 'Got it. I won’t ask for a while.',
    onList: 'You’re on the Crossword+ list. I’ll email once when it’s ready.',
    openTitle: 'Crossword+ is here',
    openShort: 'Every past puzzle, unlimited crosswords from your Anki deck and weekly bonus puzzles, for {price} a month. Today’s puzzles stay free.',
    openBody: 'Every past puzzle, as many crosswords from your own Anki deck as you like, and a few bonus puzzles every week, for {month} a month or {year} a year. Today’s puzzles stay free, and you can cancel anytime.',
    openCta: 'See Crossword+',
  },
  ja: {
    title: 'もっと解きたい？',
    body: '毎日のパズルは無料で、これからもずっと無料です。もっと解きたい人向けに、過去のパズル全部、Ankiデッキのクロスワード作り放題、毎週のボーナスパズルが遊べる「クロスワード＋」（任意の有料プラン）を準備しています。使ってみたいですか？',
    short: '毎日のパズルはずっと無料です。過去のパズル全部、Ankiデッキのクロスワード作り放題、毎週のボーナスパズルが遊べる任意の「クロスワード＋」、使ってみたいですか？',
    wantsLabel: '気になるもの（任意）',
    'want.archive': '過去のパズル全部', 'want.bonus': 'ボーナスパズル', 'want.deck': 'Ankiデッキでクロスワード', 'want.sync': '記録をどの端末でも', 'want.print': '印刷できるパズル',
    email: 'メールアドレス', submit: '始まったら教えて', not: '興味なし',
    fine: '始まったときにメールを1通だけ送ります。メルマガはなく、いつでも削除できます。',
    thanks: 'ありがとう！準備ができたら1回だけお知らせします。', sending: '送信中…',
    badEmail: 'メールアドレスを確認してください。', failed: '送信できませんでした。少ししてからもう一度お試しください。',
    hidden: 'わかりました。しばらく聞きません。',
    onList: 'クロスワード＋のリストに登録済みです。準備ができたら1回だけお知らせします。',
    openTitle: 'クロスワード＋が始まりました',
    openShort: '過去のパズル全部、Ankiデッキのクロスワード作り放題、毎週のボーナスパズルが月{price}で。今日のパズルはずっと無料です。',
    openBody: '過去のパズル全部、Ankiデッキのクロスワード作り放題、毎週のボーナスパズルが、月{month}または年{year}で遊べます。今日のパズルはずっと無料で、いつでも解約できます。',
    openCta: 'クロスワード＋を見る',
  },
};
const t = (k, vars = {}) => String((T[lang()] || T.en)[k] || T.en[k]).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function write(v) { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...v })); } catch { /* private mode */ } }

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

// Once Crossword+ is for sale (Stripe connected), the asks become a link to
// the Crossword+ panel instead of the waitlist. The page opens the panel on
// this event (app.js).
let open = null;
info().then((i) => { open = i; });
const openPanel = () => document.dispatchEvent(new CustomEvent('crossword:plus'));

// Should the solved screen mention it? solves = puzzles this browser has solved
export function plusEligible() {
  const s = read();
  if (isMember()) return false;                  // already a member
  return s.joined || !(s.hideUntil && Date.now() < s.hideUntil);
}

// The form. compact: the solved-screen version (with "Not for me")
export function plusForm({ compact = false } = {}) {
  const chosen = new Set();
  const status = h('p', { class: 'cw-plus-status', role: 'status', 'aria-live': 'polite' });
  const email = h('input', { type: 'email', class: 'cw-plus-email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: t('email'), 'aria-label': t('email'), maxlength: '254' });
  // Spam trap only bots fill in. Named so browser autofill and password
  // managers leave it alone (a field called "website" got autofilled, and the
  // server quietly dropped those sign-ups).
  const honey = h('input', { type: 'text', name: 'cw-trap-x9', tabindex: '-1', autocomplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true', class: 'cw-plus-hp', 'aria-hidden': 'true' });
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
          body: JSON.stringify({ email: v, wants: [...chosen], lang: lang(), trap: honey.value }),
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

// For the solved screen: the short form, or "you’re on the list" once signed up
export function plusCard() {
  if (open && open.open) {
    const box = h('div', { class: 'cw-plus is-compact' },
      h('p', { class: 'cw-plus-title' }, t('openTitle')),
      h('p', { class: 'cw-plus-body' }, t('openShort', { price: open.prices.month })),
      h('p', { class: 'cw-plus-fine' }, h('button', { type: 'button', class: 'btn cw-plus-submit', onclick: openPanel }, t('openCta')), ' ',
        h('button', { type: 'button', class: 'btn-link cw-plus-not', onclick: () => { write({ hideUntil: Date.now() + HIDE_DAYS * 86400000 }); box.replaceChildren(h('p', { class: 'cw-plus-thanks' }, t('hidden'))); } }, t('not'))));
    return box;
  }
  if (read().joined) return h('p', { class: 'cw-plus-onlist' }, t('onList'));
  return plusForm({ compact: true });
}

// The page section's form and support link (see tools/crossword/index.html)
export function mountPlusSection() {
  const slot = document.getElementById('plus-form');
  const fill = () => {
    if (!slot) return;
    if (open && open.open) slot.replaceChildren(h('div', { class: 'cw-plus' },
      h('p', { class: 'cw-plus-title' }, t('openTitle')),
      h('p', { class: 'cw-plus-body' }, t('openBody', { month: open.prices.month, year: open.prices.year })),
      h('button', { type: 'button', class: 'btn cw-plus-submit', onclick: () => { openPanel(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, t('openCta'))));
    else slot.replaceChildren(plusForm());
  };
  fill();
  info().then((i) => { open = i; fill(); });
  document.querySelectorAll('[data-support-link]').forEach((a) => { a.href = SUPPORT_URL; });
}
