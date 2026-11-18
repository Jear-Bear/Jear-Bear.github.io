// ads.js — ad space on the crossword page, for people without Crossword+.
//
// The rules (keep these):
//   - Ads go between puzzles only: one slot under the puzzle and its clues, never in
//     or over the grid, never in a popup, never on the solved screen.
//   - Crossword+ members see no ads and no sponsor cards anywhere on the page
//     (html.cw-member hides .cw-ad and every [data-partner] slot), and their browser
//     never downloads the ad script.
//   - Each slot says it's an ad, with "Remove ads with Crossword+" under it.
//
// Off by default: until ADSENSE_CLIENT and ADSENSE_SLOT are filled in, nothing loads and
// nothing changes on the live site. Add ?ads=preview to the page address to see the empty
// slot (labelled "preview") and the "No ads" Crossword+ perk without turning anything on.
//
// Turning it on (after AdSense has approved the site): see docs/crossword-plus.md, "Ads".

import { lang } from '../games/i18n.js?v=1';
import { isMember, onAccount, signedIn } from './account.js?v=6';

// Google AdSense. Neither is a secret (both end up in the page anyway).
export const ADSENSE_CLIENT = '';   // your publisher ID: 'ca-pub-' and 16 digits
export const ADSENSE_SLOT = '';     // the ID of the display ad unit made for this slot (digits)

const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const preview = (() => { try { return new URLSearchParams(location.search).get('ads') === 'preview'; } catch { return false; } })();
export const adsLive = () => /^ca-pub-\d{16}$/.test(ADSENSE_CLIENT) && /^\d+$/.test(ADSENSE_SLOT);
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

// Membership is only known once the account server has answered, so a signed-in
// browser waits for that before anything loads (a member never gets the script).
let known = !signedIn();
let scriptAdded = false;
function loadScript() {
  if (scriptAdded) return;
  scriptAdded = true;
  document.head.append(h('script', { async: '', src: `${SCRIPT}?client=${ADSENSE_CLIENT}`, crossorigin: 'anonymous' }));
}

// The label and the Crossword+ link are redrawn on a language change; the ad itself is
// made once per slot and kept, so switching language doesn't load a new ad.
function draw(slot) {
  let space = slot.querySelector('.cw-ad-space');
  if (!space) {
    space = h('div', { class: 'cw-ad-space' });
    if (adsLive()) {
      space.append(h('ins', { class: 'adsbygoogle', style: 'display:block', 'data-ad-client': ADSENSE_CLIENT, 'data-ad-slot': ADSENSE_SLOT, 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' }));
      loadScript();
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }
  if (!adsLive()) space.replaceChildren(h('p', { class: 'cw-ad-preview' }, t('preview')));
  const remove = h('button', { type: 'button', class: 'btn-link cw-ad-remove', onclick: () => document.dispatchEvent(new CustomEvent('crossword:plus', { detail: {} })) }, t('remove'));
  slot.replaceChildren(h('p', { class: 'cw-ad-label' }, t('label')), space, h('p', { class: 'cw-ad-foot' }, remove));
}

function update() {
  const member = isMember();
  document.documentElement.classList.toggle('cw-member', member);
  document.querySelectorAll('aside[data-ad-slot]').forEach((slot) => {
    const show = adsOn() && known && !member;
    if (show) draw(slot);
    slot.hidden = !show;
  });
}

// Called once on load and again when the language changes (the labels are redrawn)
export function mountAds() {
  if (adsOn()) update();
}
if (adsOn()) onAccount(() => { known = true; update(); });
