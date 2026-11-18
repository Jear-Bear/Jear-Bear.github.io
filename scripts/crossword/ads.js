// ads.js — ad space on the crossword page, for people without Crossword+.
//
// The rules (keep these):
//   - Ads go between puzzles only: one slot under the puzzle and its clues, never in
//     or over the grid, never in a popup, never on the solved screen.
//   - Crossword+ members see no ads and no sponsor cards anywhere on the page
//     (html.cw-member hides .cw-ad and every [data-partner] slot).
//   - Each slot says it's an ad and offers "Remove ads with Crossword+".
//
// Off by default: until AD.network and AD.client are filled in, nothing changes on the
// live site. Add ?ads=preview to the page address to see the empty slots (labelled
// "preview") and the "No ads" Crossword+ perk without turning anything on.
//
// Turning it on (after an ad network has approved the site): see docs/crossword-plus.md,
// "Ads". The network's script is loaded only for non-members, only when a slot is shown.

import { lang } from '../games/i18n.js?v=1';
import { isMember, onAccount } from './account.js?v=6';

export const AD = {
  network: null,   // e.g. 'adsense', once approved
  client: '',      // the network's publisher ID, e.g. 'ca-pub-…' (not a secret)
  slot: '',        // the ad unit's ID for the between-puzzles slot
};

const preview = (() => { try { return new URLSearchParams(location.search).get('ads') === 'preview'; } catch { return false; } })();
export const adsLive = () => Boolean(AD.network && AD.client && AD.slot);
export const adsOn = () => adsLive() || preview;

const T = {
  en: { label: 'Ad', remove: 'Remove ads with Crossword+', preview: 'Ad space (preview). Nothing is loaded here yet.' },
  ja: { label: '広告', remove: 'クロスワード＋で広告をなくす', preview: '広告枠（プレビュー）。まだ何も読み込んでいません。' },
};
const t = (k) => (T[lang()] || T.en)[k] || T.en[k];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') el.addEventListener('click', v);
    else if (v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null));
  return el;
}

function fill(slot) {
  const remove = h('button', { type: 'button', class: 'btn-link cw-ad-remove', onclick: () => document.dispatchEvent(new CustomEvent('crossword:plus', { detail: {} })) }, t('remove'));
  const space = h('div', { class: 'cw-ad-space' }, preview && !adsLive() ? h('p', { class: 'cw-ad-preview' }, t('preview')) : null);
  slot.replaceChildren(h('p', { class: 'cw-ad-head' }, h('span', { class: 'cw-ad-label' }, t('label')), remove), space);
  // The network's own tag goes into .cw-ad-space here, once AD is filled in (docs/crossword-plus.md).
}

function update() {
  const member = isMember();
  document.documentElement.classList.toggle('cw-member', member);
  document.querySelectorAll('[data-ad-slot]').forEach((slot) => {
    const show = adsOn() && !member;
    if (show && !slot.firstChild) fill(slot);
    slot.hidden = !show;
  });
}

// Called once on load and again when the language changes (the labels are redrawn)
export function mountAds() {
  if (!adsOn()) return;
  document.querySelectorAll('[data-ad-slot]').forEach((slot) => slot.replaceChildren());
  update();
}
if (adsOn()) onAccount(update);
